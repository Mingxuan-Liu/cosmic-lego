// Build an independent local deployment of the actual generic application.
// Run from the source checkout. Provider connection and browser export are
// separate exercises; staging does not start a provider or install packages.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';

const run = promisify(execFile);
const script = fileURLToPath(import.meta.url);
const repository = await realpath(path.dirname(path.dirname(script)));
const shared = ['core', 'dataflow', 'registry', 'runtime', 'scene', 'workspace', 'gateway', 'portable', 'agent-session', 'timeline'];
const pages = ['workspace', 'scene', 'timeline'];
const entryScripts = ['scene-server', 'timeline-http', 'timeline-server', 'timeline-delivery', 'gateway'].map(name => 'scripts/' + name + '.mjs');
const fixtures = ['workspace-registry', 'scene-registry', 'registry-extensions', 'runtime-extensions'].map(name => 'examples/fixtures/' + name + '.js');
const author = 'experiments/f11-author.mjs';
const three = 'node_modules/three/';
const threeEntries = { three: three + 'build/three.module.js', 'three/addons/controls/OrbitControls.js': three + 'examples/jsm/controls/OrbitControls.js' };
const absentFiles = ['src/physics.js', 'src/sdk.js', 'src/contract.js', 'src/app.js', 'src/scene.js', 'src/server.js',
  'scripts/serve.mjs', 'scripts/agent.mjs', 'examples/tilted-orbits.mjs', 'examples/eccentric-periapsis.mjs', 'examples/cosmic-clockwork.mjs'];
const cleanEnv = () => { const env = { ...process.env }; delete env.NODE_PATH; delete env.NODE_OPTIONS; return env; };
const digest = data => 'sha256:' + createHash('sha256').update(data).digest('hex');
const required = (ok, message) => { if (!ok) throw new Error(message); };
const exists = async filename => {
  try { await lstat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

async function inventory(root) {
  const sharedFiles = [];
  for (const directory of shared) {
    for (const entry of await readdir(path.join(root, 'src', directory), { withFileTypes: true })) {
      required(entry.isFile() && entry.name.endsWith('.js'), 'Review new shared entry src/' + directory + '/' + entry.name);
      sharedFiles.push('src/' + directory + '/' + entry.name);
    }
  }
  return [...sharedFiles, ...entryScripts, ...fixtures, 'examples/workspace.mjs', 'examples/scene-and-assets.mjs',
    ...pages.flatMap(page => ['index.html', 'app.js', 'style.css'].map(name => 'demo/' + page + '/' + name)),
    'LICENSE', 'THIRD-PARTY-NOTICES.md', 'assets/branding/cosmic-lego-galaxy.png',
    three + 'package.json', three + 'LICENSE', ...Object.values(threeEntries), three + 'build/three.core.js',
    ...(await exists(path.join(root, author)) ? [author] : [])].sort();
}

async function checkParents(directory) {
  for (let parent = path.dirname(directory); ; parent = path.dirname(parent)) {
    required(!await exists(path.join(parent, 'node_modules')), 'Use a new staging directory with no ancestor node_modules: ' + parent);
    if (parent === path.dirname(parent)) break;
  }
}

// VM modules give us the static import and re-export requests as parsed by
// Node itself, including multiline imports. Dynamic import expressions have
// an intentionally narrow allowlist. Unknown expressions fail the audit.
async function audit(root) {
  const files = await inventory(root), allowed = new Set(files);
  const entries = files.filter(f => /\.(?:m?js)$/.test(f) && !f.startsWith('node_modules/'));
  const edges = [], scanned = new Set();
  const dynamicTrusted = [];
  function target(from, specifier) {
    if (specifier.startsWith('node:') && isBuiltin(specifier)) return specifier;
    if (Object.hasOwn(threeEntries, specifier)) return threeEntries[specifier];
    if (from.startsWith('demo/') && specifier.startsWith('/src/')) return specifier.slice(1);
    required(specifier.startsWith('./') || specifier.startsWith('../'), 'Unapproved package/URL import in ' + from + ': ' + specifier);
    return path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  }
  async function follow(from, kind, specifier) {
    const to = target(from, specifier);
    edges.push({ from, kind, specifier, to });
    if (to.startsWith('node:')) return;
    required(allowed.has(to), 'Import escapes the staged inventory: ' + from + ' → ' + to);
    if ((from.startsWith('src/') || from.startsWith('demo/')) && to.startsWith('examples/')) {
      required(kind === 'worker-host-registry', 'Shared application code cannot import a fixture composition: ' + from + ' → ' + to);
    }
    required(!to.startsWith('experiments/'), 'The application cannot import an author recipe: ' + from + ' → ' + to);
    await scan(to);
  }
  async function scan(file) {
    if (scanned.has(file)) return;
    scanned.add(file);
    const source = await readFile(path.join(root, file), 'utf8');
    const parsed = new vm.SourceTextModule(source, { identifier: file });
    const imports = parsed.moduleRequests ? parsed.moduleRequests.map(item => item.specifier) : parsed.dependencySpecifiers;
    for (const specifier of imports) await follow(file, 'static', specifier);
    for (const match of source.matchAll(/\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*\(/g)) {
      const expression = source.slice(match.index + match[0].length);
      const literal = /^\s*(['"])([^'"\\\n]+)\1\s*\)/.exec(expression);
      if (literal) { await follow(file, 'dynamic-literal', literal[2]); continue; }
      if (file === 'src/runtime/worker.js' && /^registryModule\)/.test(expression)) {
        for (const f of ['workspace-registry', 'scene-registry']) await follow(file, 'worker-host-registry', '../../examples/fixtures/' + f + '.js');
        dynamicTrusted.push({ from: file, parameter: 'registryModule', scope: 'Local file URL supplied by the staged workspace, timeline or scene host' });
      } else if (file === 'src/timeline/export.js' && /^process\.env\.COSMIC_LEGO_PLAYWRIGHT \?\? 'playwright'\)/.test(expression)) {
        dynamicTrusted.push({ from: file, parameter: 'COSMIC_LEGO_PLAYWRIGHT', scope: 'External trusted browser driver for export only' });
      } else throw new Error('Unreviewed dynamic module load in ' + file);
    }
    if (file.startsWith('node_modules/')) return;
    for (const worker of source.matchAll(/\bnew\s+Worker\s*\(/g)) {
      required(file === 'src/runtime/index.js' && /^new URL\('\.\/worker\.js', import\.meta\.url\),/.test(source.slice(worker.index + worker[0].length)),
        'Unreviewed worker entry in ' + file);
    }
    required(!/\b(?:require|createRequire|eval|Function)\s*\(/.test(source), 'Review executable loading primitive in ' + file);
    for (const match of source.matchAll(/new URL\(\s*(['"])([^'"\\]+)\1\s*,\s*import\.meta\.url\s*\)/g)) {
      if (/\.(?:m?js)$/.test(match[2])) await follow(file, 'local-module-url', match[2]);
    }
  }
  for (const file of entries) await scan(file);
  // Verify the actual browser import maps, not just Node's Three resolution.
  const importMaps = {};
  for (const page of pages) {
    const html = await readFile(path.join(root, 'demo', page, 'index.html'), 'utf8');
    const match = /<script type="importmap">([^<]+)<\/script>/.exec(html);
    required(match, 'Missing browser import map for ' + page);
    const map = JSON.parse(match[1]).imports;
    required(Object.keys(map).length === 2 && map.three === '/vendor/three/three.module.js' &&
      map['three/addons/controls/OrbitControls.js'] === '/vendor/three/OrbitControls.js', 'Unreviewed browser dependency in ' + page);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    required(scripts.length === 2 && scripts.some(([, attributes, content]) =>
      attributes.trim() === 'type="module" src="/' + page + '/app.js"' && !content.trim()),
    'Unreviewed HTML script entry in ' + page);
    const resources = [...html.matchAll(/<(?:img|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)].map(m => m[1]);
    required(resources.every(url => ['/assets/branding/cosmic-lego-galaxy.png', '/' + page + '/style.css'].includes(url)),
      'Unreviewed browser asset in ' + page);
    const css = await readFile(path.join(root, 'demo', page, 'style.css'), 'utf8');
    required(!/@import\b|url\s*\(/i.test(css), 'Review new stylesheet dependencies in ' + page);
    importMaps[page] = map;
  }
  const roots = { kernel: 'src/core/index.js', dataflow: 'src/dataflow/index.js', registry: 'src/registry/index.js',
    worker: 'src/runtime/index.js', scene: 'src/scene/index.js', workspaceHost: 'scripts/scene-server.mjs',
    workspaceBrowser: 'demo/workspace/app.js', renderer: 'src/scene/three-adapter.js', nativeAgent: 'src/agent-session/codex.js',
    agentBridge: 'src/agent-session/index.js', gateway: 'src/gateway/index.js', portable: 'src/portable/format.js',
    timelinePlayer: 'scripts/timeline-server.mjs', timelineBrowser: 'demo/timeline/app.js', delivery: 'scripts/timeline-delivery.mjs' };
  if (allowed.has(author)) roots.authorRecipe = author;
  const closures = {};
  for (const [name, entry] of Object.entries(roots)) {
    const reachable = new Set(), pending = [entry];
    while (pending.length) {
      const module = pending.pop();
      if (reachable.has(module)) continue;
      reachable.add(module);
      for (const edge of edges) if (edge.from === module && !edge.to.startsWith('node:')) pending.push(edge.to);
    }
    closures[name] = { entry, modules: [...reachable].sort() };
  }
  return { entries, modules: [...scanned].sort(), edges, closures, external: dynamicTrusted, importMaps,
    hostExecutables: [
      { from: 'src/agent-session/codex.js', role: 'Optional native agent', configuration: 'An absolute executable supplied by the host before a connection' },
      { from: 'src/timeline/export.js', role: 'Optional export browser', configuration: 'Playwright Chromium or host-configured COSMIC_LEGO_CHROME' },
    ],
    authorRecipe: allowed.has(author) ? author : null };
}

// A separate ESM process uses the staged directory as its real resolution
// origin. Import the production host/worker registry without connecting an
// agent, and actually attempt the missing imports (resolve alone can return
// a file URL even for a nonexistent relative module).
async function probe(root) {
  const program = `
    import {lstat} from 'node:fs/promises';
    import {createRequire} from 'node:module';
    import {startSceneServer} from './scripts/scene-server.mjs';
    import {startTimelineServer} from './scripts/timeline-server.mjs';
    import {createRegistry} from './examples/fixtures/workspace-registry.js';
    import {registryModule} from './examples/workspace.mjs';
    import {REVISION} from 'three';
    function requireProbe(ok, message) { if (!ok) throw new Error(message); }
    const filenames = ${JSON.stringify(absentFiles)};
    for (const filename of filenames) {
      try {
        await lstat(filename);
        throw new Error('Unexpected legacy file ' + filename);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const failed = [];
    const names = [...filenames.map(file => './' + file), './src/domains/exoplanet/index.js',
      './packages/exoplanet/registry.js', './packages/exoplanet/models.js', './packages/exoplanet/physics.js', './apps/exoplanet.mjs',
      'cosmic-lego/src/physics.js', '@cosmic-lego/exoplanet', 'cosmic-lego-exoplanet'];
    for (const name of names) {
      try {
        await import(name);
        throw new Error('Unexpected successful import ' + name);
      } catch (error) {
        requireProbe(['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code),
          'Unexpected import outcome ' + name + ' ' + error.code);
        failed.push({ specifier: name, code: error.code });
      }
    }
    const requireHere = createRequire(import.meta.url);
    for (const name of ['cosmic-lego/src/sdk.js', '@cosmic-lego/exoplanet']) {
      try {
        requireHere.resolve(name);
        throw new Error('Unexpected CommonJS resolution ' + name);
      } catch (error) {
        requireProbe(error.code === 'MODULE_NOT_FOUND', 'Unexpected CommonJS outcome ' + name);
        failed.push({ specifier: name, code: error.code, loader: 'require.resolve' });
      }
    }
    const registeredExtensions = createRegistry().discover().extensions.map(e => e.manifest.id).sort();
    requireProbe(registeredExtensions.every(id => /^(fixture|scene|workspace)\\./.test(id)), 'Unexpected registered extension');
    for (const id of ['fixture.moving-point', 'fixture.seeded-accumulator', 'workspace.plot', 'scene.points']) {
      requireProbe(registeredExtensions.includes(id), 'Missing expected fixture ' + id);
    }
    requireProbe(typeof startSceneServer === 'function' && typeof startTimelineServer === 'function', 'Missing production host');
    requireProbe(registryModule.href === new URL('./examples/fixtures/workspace-registry.js', import.meta.url).href,
      'Worker registry did not resolve locally');
    requireProbe(import.meta.resolve('three') === new URL('./node_modules/three/build/three.module.js', import.meta.url).href,
      'Three resolves outside the staged tree');
    console.log(JSON.stringify({ negativeProbes: failed, absentFiles: filenames, registeredExtensions,
      threeRevision: REVISION, nodeVersion: process.version }));
  `;
  const { stdout } = await run(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: root, env: cleanEnv(), timeout: 30000, maxBuffer: 1000000,
  });
  return JSON.parse(stdout);
}

export async function stageReadinessWorkspace(directory) {
  required(typeof directory === 'string' && path.isAbsolute(directory), 'Supply an absolute new directory outside the checkout.');
  const parent = await realpath(path.dirname(directory));
  const destination = path.join(parent, path.basename(directory));
  required(!inside(repository, destination), 'Stage outside the checkout so bare imports cannot fall back to its node_modules.');
  await checkParents(destination);
  // No force or recursive replacement of existing work.
  await mkdir(destination, { mode: 0o700 });
  try {
    const files = [];
    async function put(file, data) {
      const target = path.join(destination, file);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, data, { flag: 'wx', mode: 0o600 });
      files.push({ path: file, sha256: digest(data) });
    }
    for (const file of await inventory(repository)) {
      const resolved = await realpath(path.join(repository, file));
      required(inside(repository, resolved), 'Source asset resolves outside the checkout: ' + file);
      await put(file, await readFile(resolved));
    }
    const metadata = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'));
    // The repository's default npm scripts launch its legacy application.
    // Keep the real version, license and pinned dependency for this entry point.
    metadata.scripts = { start: 'node scripts/scene-server.mjs --workspace' };
    await put('package.json', Buffer.from(JSON.stringify(metadata, null, 2) + '\n'));
    const { stdout } = await run(process.execPath, ['--no-warnings', '--experimental-vm-modules', script, '--audit', destination], {
      cwd: destination, env: cleanEnv(), maxBuffer: 4000000, timeout: 30000,
    });
    const probes = await probe(destination);
    return { directory: destination, files: files.sort((a, b) => a.path.localeCompare(b.path)), audit: { ...JSON.parse(stdout), ...probes } };
  } catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === '--audit') console.log(JSON.stringify(await audit(args[1])));
  else {
    required(args.length === 1, 'Usage: node scripts/readiness-workspace.mjs /absolute/new-directory');
    console.log(JSON.stringify(await stageReadinessWorkspace(args[0]), null, 2));
  }
}
