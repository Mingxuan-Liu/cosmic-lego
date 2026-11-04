import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, writeFile, rm, symlink, link, rename, mkdir } from 'node:fs/promises';
import { readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPortableStore } from '../src/portable/store.js';

const run = promisify(execFile);
const body = title => JSON.stringify({ title, source: 'throw new Error("inert recipe")' }, null, 2) + '\n';
const version = content => `sha256:${createHash('sha256').update(content).digest('hex')}`;
async function setup(t, limits = {}) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'cosmic-store-test-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const directory = path.join(scratch, 'projects');
  return { scratch, directory, store: await createPortableStore({ directory, ...limits }) };
}

test('named files survive restart, retain exact UTF-8 bytes and require explicit disk versions', async t => {
  const { directory, store } = await setup(t), document = body('重开项目');
  const saved = await store.save('project-1', document, { expectedVersion: null });
  assert.deepEqual(saved, { name: 'project-1', version: version(document) });
  assert.equal(await readFile(path.join(directory, 'project-1.json'), 'utf8'), document);
  const restarted = await createPortableStore({ directory });
  assert.deepEqual(await restarted.list(), [saved]); assert.deepEqual(await restarted.read('project-1'), { ...saved, document });
  await assert.rejects(restarted.save('project-1', body('no implicit overwrite')), { code: 'STORE_VERSION' });
  await assert.rejects(restarted.save('project-1', body('create conflict'), { expectedVersion: null }), { code: 'STORE_CONFLICT' });
  const next = await restarted.save('project-1', body('Changed'), { expectedVersion: saved.version });
  await assert.rejects(restarted.read('project-1', { expectedVersion: saved.version }), { code: 'STORE_CONFLICT' });
  assert.equal((await restarted.read('project-1', { expectedVersion: next.version })).document, body('Changed'));
});

test('two independent stores cannot overwrite a newer accepted disk version', async t => {
  const { directory, store } = await setup(t), other = await createPortableStore({ directory });
  const saved = await store.save('shared', body('Initial'), { expectedVersion: null });
  const results = await Promise.allSettled([store.save('shared', body('Left'), { expectedVersion: saved.version }), other.save('shared', body('Right'), { expectedVersion: saved.version })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'STORE_CONFLICT');
  const current = await store.read('shared'); assert.ok([body('Left'), body('Right')].includes(current.document));
  assert.equal(current.version, results.find(result => result.status === 'fulfilled').value.version);
  await writeFile(path.join(directory, 'shared.json'), body('External editor'));
  await assert.rejects(store.save('shared', body('Old observation'), { expectedVersion: current.version }), { code: 'STORE_CONFLICT' });
  assert.equal((await store.read('shared')).document, body('External editor'));
});

test('an edit during asynchronous staging leaves a dirty revision and the previous disk bytes intact', async t => {
  const { directory, store } = await setup(t), saved = await store.save('lesson', body('Saved'), { expectedVersion: null });
  let revision = 1, savedRevision = 1, guardCalls = 0;
  const captured = revision, saving = store.save('lesson', body('Earlier capture'), { expectedVersion: saved.version, beforePublish() {
    guardCalls++; if (revision !== captured) throw Object.assign(new Error('The accepted project changed.'), { code: 'STALE_TOKEN' });
  } }).then(result => { savedRevision = captured; return result; });
  revision++;
  await assert.rejects(saving, { code: 'STALE_TOKEN' }); assert.equal(guardCalls, 1);
  assert.notEqual(revision, savedRevision); assert.deepEqual(await store.read('lesson'), { ...saved, document: body('Saved') });
  assert.deepEqual(await readdir(directory), ['lesson.json']);
  await assert.rejects(store.save('lesson', body('Async guard'), { expectedVersion: saved.version, beforePublish: async () => {} }), { code: 'STORE_GUARD' });
  assert.equal((await store.read('lesson')).version, saved.version);
});

test('a process killed after staging cannot truncate the prior file and another process can recover its lock', async t => {
  const { directory, store } = await setup(t), initial = await store.save('lesson', body('Recoverable'), { expectedVersion: null });
  const module = new URL('../src/portable/store.js', import.meta.url).href;
  const program = `const {createPortableStore} = await import(process.argv[1]);
    const store = await createPortableStore({directory:process.argv[2]});
    await store.save('lesson', '{"title":"interrupted"}', {expectedVersion:process.argv[3],beforePublish(){process.kill(process.pid,'SIGKILL')}});`;
  await assert.rejects(run(process.execPath, ['--input-type=module', '-e', program, module, directory, initial.version]), error => error.signal === 'SIGKILL');
  const restart = await createPortableStore({ directory });
  assert.deepEqual(await restart.read('lesson'), { ...initial, document: body('Recoverable') });
  const saved = await restart.save('lesson', body('Recovered save'), { expectedVersion: initial.version });
  assert.deepEqual(await restart.list(), [saved]); assert.deepEqual(await readdir(directory), ['lesson.json']);
});

test('a writer killed immediately after the first rename leaves a complete regular named file', async t => {
  const { directory } = await setup(t), module = new URL('../src/portable/store.js', import.meta.url).href;
  const document = body('Published before process death');
  // Instrument this child process's built-in rename only. Kill after the real
  // syscall so the ordinary store never gets to run its cleanup or report success.
  const program = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const rename=fs.renameSync; fs.renameSync=(from,to)=>{ rename(from,to); if(to.endsWith('/new-file.json')) process.kill(process.pid,'SIGKILL'); };
    syncBuiltinESMExports(); const {createPortableStore}=await import(process.argv[1]);
    const store=await createPortableStore({directory:process.argv[2]}); await store.save('new-file',process.argv[3],{expectedVersion:null});`;
  await assert.rejects(run(process.execPath, ['--input-type=module', '-e', program, module, directory, document]), error => error.signal === 'SIGKILL');
  const reopened = await createPortableStore({ directory });
  assert.deepEqual(await reopened.read('new-file'), { name: 'new-file', version: version(document), document });
  const next = await reopened.save('new-file', body('After restart'), { expectedVersion: version(document) });
  assert.deepEqual(await reopened.list(), [next]); assert.deepEqual(await readdir(directory), ['new-file.json']);
});

test('names reject path syntax, protected targets refuse symlinks/hardlinks, and directory replacement is detected', async t => {
  const { scratch, directory, store } = await setup(t), external = path.join(scratch, 'outside.json');
  await writeFile(external, body('Outside'));
  for (const name of ['../outside', '/tmp/x', '.hidden', 'a/b', 'a\\b', 'Two', 'project.json', 'x'.repeat(65)]) {
    await assert.rejects(store.read(name), { code: 'STORE_NAME' });
  }
  await symlink(external, path.join(directory, 'linked.json'));
  await assert.rejects(store.read('linked'), { code: 'STORE_PATH' });
  await assert.rejects(store.save('linked', body('Overwrite'), { expectedVersion: null }), { code: 'STORE_PATH' });
  await link(external, path.join(directory, 'hard.json'));
  await assert.rejects(store.read('hard'), { code: 'STORE_PATH' });
  assert.equal(await readFile(external, 'utf8'), body('Outside'));
  await rename(directory, path.join(scratch, 'previous-directory')); await mkdir(directory);
  await assert.rejects(store.list(), { code: 'STORE_PATH' });
  const alias = path.join(scratch, 'alias'); await symlink(directory, alias);
  await assert.rejects(createPortableStore({ directory: alias + '/' }), { code: 'STORE_PATH' });
});

test('the last publication check detects a replaced target or staging file', async t => {
  const { directory, store } = await setup(t), saved = await store.save('lesson', body('Old'), { expectedVersion: null });
  await assert.rejects(store.save('lesson', body('Would overwrite'), { expectedVersion: saved.version, beforePublish() {
    writeFileSync(path.join(directory, 'lesson.json'), body('Edited during staging'));
  } }), { code: 'STORE_CONFLICT' });
  const current = await store.read('lesson'); assert.equal(current.document, body('Edited during staging'));
  await assert.rejects(store.save('lesson', body('Untrusted staging'), { expectedVersion: current.version, beforePublish() {
    const staged = path.join(directory, readdirSync(directory).find(name => name.endsWith('.tmp')));
    unlinkSync(staged); symlinkSync(path.join(directory, 'lesson.json'), staged);
  } }), { code: 'STORE_PATH' });
  assert.deepEqual(await store.read('lesson'), current);
});

test('byte and count limits reject invalid files and still allow replacing an existing full-store project', async t => {
  const { directory, store } = await setup(t, { maxBytes: 256, maxProjects: 1 });
  const saved = await store.save('one', body('First'), { expectedVersion: null });
  await assert.rejects(store.save('two', body('Second'), { expectedVersion: null }), { code: 'STORE_BUDGET' });
  await assert.rejects(store.save('one', body('x'.repeat(257)), { expectedVersion: saved.version }), { code: 'STORE_BUDGET' });
  await assert.rejects(store.save('one', Buffer.from([0xff]), { expectedVersion: saved.version }), { code: 'STORE_ENCODING' });
  await assert.rejects(store.save('one', '[]', { expectedVersion: saved.version }), { code: 'STORE_DOCUMENT' });
  await assert.rejects(store.read('missing'), { code: 'STORE_NOT_FOUND' });
  const updated = await store.save('one', body('Changed'), { expectedVersion: saved.version });
  assert.deepEqual(await store.list(), [updated]);
  await writeFile(path.join(directory, 'one.json'), ' '.repeat(300));
  await assert.rejects(store.read('one'), { code: 'STORE_BUDGET' });
});
