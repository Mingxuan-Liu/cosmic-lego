import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { KernelError } from '../core/index.js';

export const STORE_LIMITS = Object.freeze({ maxBytes: 16 * 1024 * 1024, maxProjects: 128 });
const validName = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const sha256 = buffer => `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
const versionPattern = /^sha256:[a-f0-9]{64}$/;
const ownerPattern = /^owner-([1-9][0-9]*)-([a-f0-9-]{36})$/;
const temporaryPattern = /^\.pending-([1-9][0-9]*)-[a-f0-9-]{36}\.tmp$/;
const fail = (code, message) => { throw new KernelError(code, message); };
const requireName = name => {
  if (typeof name !== 'string' || !validName.test(name)) fail('STORE_NAME', 'Use 1–64 lowercase letters, digits, underscores or hyphens, starting with a letter or digit.');
};
const requireVersion = version => {
  if (version !== null && (typeof version !== 'string' || !versionPattern.test(version))) fail('STORE_VERSION', 'Specify null for a new file or its exact saved SHA-256 version.');
};
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameContents = (a, b) => sameFile(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && b.nlink === 1n;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function decode(buffer) {
  try { return decoder.decode(buffer); }
  catch { fail('STORE_ENCODING', 'Saved project bytes must be valid UTF-8.'); }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

// A populated directory can never replace another populated directory by
// rename. This creates a process-shared publication lock with no partly written
// ownership record. Removing only the observed unique marker also makes two
// processes recovering the same dead owner safe.
function removeClaim(directory, marker) {
  try { unlinkSync(path.join(directory, marker)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { rmdirSync(directory); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
}

/** Local POSIX store. The caller supplies a trusted directory and validates the
 * portable manifest. Only bounded named UTF-8 JSON documents cross this API. */
export async function createPortableStore({ directory, maxBytes = STORE_LIMITS.maxBytes, maxProjects = STORE_LIMITS.maxProjects } = {}) {
  if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY) fail('STORE_DIRECTORY', 'The local store requires POSIX no-follow file opens and directory sync support.');
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) === path.parse(directory).root) fail('STORE_DIRECTORY', 'Configure an absolute dedicated project directory.');
  if (![maxBytes, maxProjects].every(value => Number.isSafeInteger(value) && value > 0) || maxBytes > STORE_LIMITS.maxBytes || maxProjects > 4096) fail('STORE_LIMITS', 'Use supported positive store limits.');
  const configured = path.resolve(directory);
  await mkdir(configured, { recursive: true, mode: 0o700 });
  if (!(await lstat(configured)).isDirectory()) fail('STORE_PATH', 'The configured project directory must be a directory, without a final symlink.');
  const root = await realpath(configured), original = await lstat(root, { bigint: true });
  const lockPath = path.join(root, '.publish-lock');
  function checkDirectory() {
    let current;
    try { current = lstatSync(root, { bigint: true }); }
    catch { fail('STORE_PATH', 'The trusted project directory is no longer available.'); }
    if (!current.isDirectory() || !sameFile(current, original) || realpathSync(root) !== root) fail('STORE_PATH', 'The trusted project directory was replaced.');
  }
  const fileName = name => path.join(root, `${name}.json`);

  async function readFile(name, allowMissing = false) {
    checkDirectory();
    let handle;
    try { handle = await open(fileName(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
      if (error.code === 'ENOENT') { if (allowMissing) return null; fail('STORE_NOT_FOUND', 'No saved project has that name.'); }
      if (error.code === 'ELOOP') fail('STORE_PATH', 'A named project cannot be a symlink.');
      throw error;
    }
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.nlink !== 1n) fail('STORE_PATH', 'A named project must be a regular file with one link.');
      if (stat.size > BigInt(maxBytes)) fail('STORE_BUDGET', 'The saved file exceeds the project byte limit.');
      const buffer = Buffer.alloc(Number(stat.size) + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total !== Number(stat.size) || !sameContents(stat, await handle.stat({ bigint: true }))) fail('STORE_CONFLICT', 'The saved file changed while being read.');
      checkDirectory();
      const content = buffer.subarray(0, total);
      return { content, stat, version: sha256(content) };
    } finally { await handle.close(); }
  }

  async function names() {
    checkDirectory();
    const result = [];
    for await (const entry of await opendir(root)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const name = entry.name.slice(0, -5);
      if (!validName.test(name)) continue;
      result.push(name);
      if (result.length > maxProjects) fail('STORE_BUDGET', 'The directory exceeds the named project limit.');
    }
    return result.sort();
  }

  function recoverLock() {
    let lock;
    try { lock = lstatSync(lockPath); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!lock.isDirectory()) fail('STORE_PATH', 'The publication lock must be a local directory.');
    let markers;
    try { markers = readdirSync(lockPath); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!markers.length) return; // the next rename may replace this empty directory
    const owner = markers.length === 1 && ownerPattern.exec(markers[0]);
    if (!owner) fail('STORE_PATH', 'The publication lock has an unknown owner record.');
    if (!processAlive(Number(owner[1]))) removeClaim(lockPath, markers[0]);
  }

  async function claimLock() {
    const ownerId = `${process.pid}-${randomUUID()}`, marker = `owner-${ownerId}`;
    const claim = path.join(root, `.claim-${ownerId}`);
    checkDirectory(); mkdirSync(claim, { mode: 0o700 });
    let acquired = false;
    try {
      writeFileSync(path.join(claim, marker), '', { flag: 'wx', mode: 0o600 });
      const deadline = performance.now() + 2000;
      for (;;) {
        checkDirectory();
        try { renameSync(claim, lockPath); acquired = true; return () => { checkDirectory(); removeClaim(lockPath, marker); }; }
        catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) {
            if (['ENOTDIR', 'EISDIR'].includes(error.code)) fail('STORE_PATH', 'Invalid publication lock path.');
            throw error;
          }
        }
        recoverLock();
        if (performance.now() >= deadline) fail('STORE_BUSY', 'Another process is publishing a project. Retry with the same expected disk version.');
        await delay(10);
      }
    } finally { if (!acquired) { checkDirectory(); removeClaim(claim, marker); } }
  }

  // Recover only our own temporary naming scheme and only after the process
  // that created it no longer exists. Never infer a saved version from a temp.
  for await (const entry of await opendir(root)) {
    const owner = temporaryPattern.exec(entry.name);
    if (entry.isFile() && owner && !processAlive(Number(owner[1]))) {
      checkDirectory();
      await unlink(path.join(root, entry.name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  return Object.freeze({
    async list() {
      const entries = [];
      for (const name of await names()) {
        const file = await readFile(name, true);
        if (file) entries.push({ name, version: file.version });
      }
      return entries;
    },
    async read(name, { expectedVersion } = {}) {
      requireName(name);
      if (expectedVersion !== undefined) requireVersion(expectedVersion);
      const file = await readFile(name);
      if (expectedVersion !== undefined && file.version !== expectedVersion) fail('STORE_CONFLICT', 'The saved project has a different disk version.');
      return { name, version: file.version, document: decode(file.content) };
    },
    async save(name, document, { expectedVersion, beforePublish } = {}) {
      requireName(name); requireVersion(expectedVersion);
      if (beforePublish !== undefined && (typeof beforePublish !== 'function' || ['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(beforePublish.constructor?.name))) fail('STORE_GUARD', 'beforePublish must be a synchronous host check.');
      if (typeof document !== 'string' && !Buffer.isBuffer(document)) fail('STORE_DOCUMENT', 'Supply a serialized UTF-8 JSON document.');
      if (Buffer.byteLength(document) > maxBytes) fail('STORE_BUDGET', 'The document exceeds the project byte limit.');
      const content = Buffer.from(document), string = decode(content);
      if (typeof document === 'string' && string !== document) fail('STORE_ENCODING', 'The document contains an unpaired Unicode surrogate.');
      let parsed;
      try { parsed = JSON.parse(string); } catch { fail('STORE_DOCUMENT', 'The saved document must contain a JSON object.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('STORE_DOCUMENT', 'The saved document must contain a JSON object.');
      const version = sha256(content), staged = path.join(root, `.pending-${process.pid}-${randomUUID()}.tmp`);
      checkDirectory();
      const temporary = await open(staged, 'wx', 0o600);
      let release, stagedStat;
      try {
        try { await temporary.writeFile(content); await temporary.sync(); stagedStat = await temporary.stat({ bigint: true }); } finally { await temporary.close(); }
        release = await claimLock();
        const previous = await readFile(name, true);
        if ((previous?.version ?? null) !== expectedVersion) fail('STORE_CONFLICT', 'The saved project changed. Read its current disk version before saving again.');
        if (!previous && (await names()).length >= maxProjects) fail('STORE_BUDGET', 'The directory has reached its named project limit.');
        checkDirectory();
        const destination = fileName(name);
        const directoryFd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
          if (beforePublish) {
            const result = beforePublish();
            if (result instanceof Promise) result.catch(() => {});
            if (result !== undefined) fail('STORE_GUARD', 'beforePublish must return undefined or throw to reject the save.');
          }
          checkDirectory();
          const current = lstatSync(destination, { bigint: true, throwIfNoEntry: false });
          if (previous ? !current || !current.isFile() || !sameContents(previous.stat, current) : current) fail('STORE_CONFLICT', 'The saved file changed before publication.');
          const candidate = lstatSync(staged, { bigint: true, throwIfNoEntry: false });
          if (!candidate?.isFile() || !sameContents(stagedStat, candidate)) fail('STORE_PATH', 'The staged document changed before publication.');
          // Cooperative writers hold the same lock. An external program that
          // bypasses it can still race the final path check at the OS level.
          renameSync(staged, destination);
          try { fsyncSync(directoryFd); }
          catch { fail('STORE_DURABILITY', 'The file was published but directory sync failed. Reopen its disk version before retrying.'); }
        } finally { closeSync(directoryFd); }
        return { name, version };
      } finally {
        try { if (release) release(); }
        finally { checkDirectory(); await unlink(staged).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      }
    },
  });
}
