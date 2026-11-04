// Publication takes a detached F09 document. The only executable modules come
// from the installed player and its explicitly chosen composition root.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail } from '../core/data.js';
import { equal, fingerprint } from '../runtime/contracts.js';
import { serializePortableManifest } from '../portable/format.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const maxFrames = 3600;
const bytesHash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const json = data => JSON.stringify(data, null, 2) + '\n';

export function makeFrameSchedule({ start, end, fps, width, height } = {}) {
  if (![start, end, fps].every(Number.isFinite) || start < 0 || end < start || fps <= 0 || fps > 120)
    fail('FRAME_SCHEDULE', 'Use finite presentation seconds with 0 ≤ start ≤ end and a frame rate in (0, 120].');
  if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 8192) || width * height > 16777216)
    fail('FRAME_DIMENSIONS', 'Use positive integer dimensions up to 8192 per side and 16,777,216 pixels per frame.');
  const steps = (end - start) * fps;
  const nearest = Math.round(steps);
  const onGrid = Math.abs(steps - nearest) <= 8 * Number.EPSILON * Math.max(1, steps);
  const last = onGrid ? nearest : Math.floor(steps);
  if (!Number.isSafeInteger(last) || last >= maxFrames || width * height * (last + 1) > 4000000000)
    fail('FRAME_BUDGET', 'An export supports at most 3600 frames and four billion scheduled pixels.');
  const times = [];
  for (let i = 0; i <= last; i++) {
    // Derive from the index so rounding cannot accumulate across the sequence.
    const t = i > 0 && i === last && onGrid ? end : start + i / fps;
    if (i && t <= times[i - 1]) fail('FRAME_SCHEDULE', 'The requested frame spacing is below the precision of these presentation times.');
    times.push(t);
  }
  return Object.freeze({ start, end, fps, width, height, times: Object.freeze(times) });
}

async function newDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim()) fail('DELIVERY_PATH', 'Choose a new output directory.');
  const destination = path.resolve(directory);
  await mkdir(path.dirname(destination), { recursive: true });
  try { await mkdir(destination, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') fail('DELIVERY_EXISTS', 'Choose a new output directory to preserve existing work.'); throw error; }
  return destination;
}

async function atomicWrite(file, data) {
  await writeFile(file + '.partial', data);
  await rename(file + '.partial', file);
}
function checkAbort(signal) {
  if (signal?.aborted) fail('EXPORT_INTERRUPTED', 'Frame export was interrupted.');
}
function frameFiles(index) {
  const stem = 'frames/frame-' + String(index).padStart(6, '0');
  return { image: stem + '.png', metadata: stem + '.json' };
}
async function boundedWork(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Frame rendering exceeded its time limit.'), { code: 'EXPORT_TIMEOUT' })), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function readRoute(url, route, options) {
  const response = await fetch(new URL(route, url), { redirect: 'error', ...options });
  const outcome = await response.json();
  if (!response.ok || !outcome.ok) fail(outcome.error?.code ?? 'FRAME_REQUEST', outcome.error?.message ?? 'Timeline host rejected the frame.');
  return outcome.result;
}

function scientificRecord(result) {
  const run = result.metadata.runtime;
  return { producer: result.producer, request: result.request, value: result.value, valueHash: fingerprint(result.value),
    diagnostics: result.diagnostics, approximation: result.metadata.approximation, sampling: result.metadata.sampling,
    implementationHistory: result.metadata.implementations, inputIdentity: run.inputIdentity, settings: run.settings,
    path: run.path, achievedTime: run.achievedTime, components: run.components };
}

/** Capture a bounded schedule through the normal timeline evaluator and player.
 * progress.json is updated after a complete PNG and its metadata are published.
 * A process killed between commits leaves an explicitly incomplete prefix. */
export async function exportFrames({ manifest, directory, schedule, signal, onFrame, composition } = {}) {
  const plan = makeFrameSchedule(schedule);
  const source = serializePortableManifest(manifest);
  const destination = await newDirectory(directory);
  let server, browser, page, completed = 0;
  const progress = (status, error) => atomicWrite(path.join(destination, 'progress.json'), json({
    format: 'cosmic-lego.export-progress', version: 1, status, completedFrames: completed, totalFrames: plan.times.length,
    ...(error ? { error: { code: String(error.code ?? 'EXPORT_FAILED'), message: String(error.message ?? error).slice(0, 2000) } } : {}),
  }));
  const interrupt = () => { if (browser) void browser.close().catch(() => {}); };
  signal?.addEventListener('abort', interrupt, { once: true });
  try {
    await progress('incomplete'); checkAbort(signal);
    const { startTimelineServer } = await import('../../scripts/timeline-server.mjs');
    server = await startTimelineServer({ manifest: source, port: 0, visualizationDelivery: true, composition });
    const project = server.manifest, projectText = serializePortableManifest(project);
    const meta = await readRoute(server.url, '/api/timeline', { signal });
    if (plan.end > meta.duration) fail('FRAME_SCHEDULE', 'The frame schedule exceeds the authored duration.');
    const frames = plan.times.map((presentationTime, index) => ({ index, presentationTime, ...frameFiles(index) }));
    await mkdir(path.join(destination, 'frames'));
    await atomicWrite(path.join(destination, 'project.json'), projectText);
    await atomicWrite(path.join(destination, 'sequence.json'), json({
      format: 'cosmic-lego.image-sequence', version: 1, title: meta.title, snapshotId: meta.snapshotId,
      project: { file: 'project.json', sha256: bytesHash(projectText), identity: project.savedFrom, integrity: project.integrity },
      requirements: project.requirements, configurations: project.timeline.configurations, playback: project.playback,
      schedule: { start: plan.start, end: plan.end, fps: plan.fps, width: plan.width, height: plan.height },
      progress: 'progress.json', frames,
    }));
    checkAbort(signal);
    let chromium;
    try { ({ chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright')); }
    catch { fail('BROWSER_REQUIRED', 'Install Playwright or set COSMIC_LEGO_PLAYWRIGHT to its trusted local entry file.'); }
    browser = await chromium.launch({ headless: true, ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}),
      args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    checkAbort(signal);
    page = await browser.newPage({ viewport: { width: plan.width, height: plan.height }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await page.route('**/*', request => {
      if (new URL(request.request().url()).origin === server.url) return request.continue();
      return request.abort('blockedbyclient');
    });
    await page.goto(server.url + '/timeline/?capture=1');
    await page.waitForFunction(() => typeof globalThis.cosmicTimeline?.present === 'function');
    for (const item of frames) {
      checkAbort(signal);
      const frame = await boundedWork(readRoute(server.url, '/api/timeline/frame', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: item.presentationTime, snapshotId: meta.snapshotId }), signal }), 120000);
      if (frame.presentationTime !== item.presentationTime || !equal(frame.identity, project.savedFrom))
        fail('STALE_FRAME', 'The evaluator returned a different snapshot or presentation time.');
      const receipt = await boundedWork(page.evaluate(input => globalThis.cosmicTimeline.present(input), frame), 30000);
      if (!receipt.ready || !equal(receipt.identity, frame.identity) || receipt.presentationTime !== frame.presentationTime
          || !equal(receipt.physicalTime, frame.physicalTime) || receipt.configurationHash !== frame.configuration.graphHash
          || receipt.width !== plan.width || receipt.height !== plan.height)
        fail('STALE_FRAME', 'The player did not acknowledge this exact frame, configuration, time and pixel size.');
      const png = await page.screenshot({ type: 'png', caret: 'hide', timeout: 30000 });
      if (png.readUInt32BE(16) !== plan.width || png.readUInt32BE(20) !== plan.height) fail('FRAME_DIMENSIONS', 'PNG dimensions differ from the requested viewport.');
      checkAbort(signal);
      await atomicWrite(path.join(destination, item.image), png);
      const record = { ...item, identity: frame.identity, snapshotId: meta.snapshotId, physicalTime: frame.physicalTime,
        configuration: frame.configuration, cameraId: frame.cameraId, annotations: frame.annotations, warnings: frame.warnings,
        renderer: { ...receipt.renderer, browser: browser.version(), width: receipt.width, height: receipt.height },
        imageHash: bytesHash(png), results: frame.results.map(scientificRecord),
        assets: frame.snapshot.scene.assets.map(({ id, contentId, dependencies, provenance }) => ({ id, contentId, dependencies, provenance })) };
      await atomicWrite(path.join(destination, item.metadata), json(record));
      completed++;
      await progress(completed === frames.length ? 'complete' : 'incomplete');
      if (onFrame) await onFrame(Object.freeze({ index: item.index, completedFrames: completed, totalFrames: frames.length }));
    }
    return { directory: destination, status: 'complete', completedFrames: completed };
  } catch (failure) {
    const interrupted = signal?.aborted || failure.code === 'EXPORT_INTERRUPTED';
    if (completed < plan.times.length) await progress(interrupted ? 'interrupted' : 'failed', interrupted ? { code: 'EXPORT_INTERRUPTED', message: 'Frame export was interrupted.' } : failure);
    if (interrupted) fail('EXPORT_INTERRUPTED', 'Frame export was interrupted.');
    throw failure;
  } finally {
    signal?.removeEventListener('abort', interrupt);
    try { await browser?.close(); } finally { await server?.close(); }
  }
}

// Fixed deployment inventory. Project resource names, recipe text and module
// identifiers never select a filesystem path or contribute executable code.
const playerFiles = [
  'LICENSE', 'docs/third-party-notices.md', 'assets/branding/cosmic-lego-galaxy.png',
  'scripts/timeline-server.mjs', 'scripts/timeline-http.mjs',
  ...['index.html', 'style.css', 'app.js'].map(name => 'demo/timeline/' + name),
  ...['workspace-registry', 'registry-extensions', 'runtime-extensions'].map(name => 'examples/fixtures/' + name + '.js'),
  ...Object.entries({
    core: ['data', 'graph', 'index', 'project'],
    dataflow: ['author', 'contracts', 'evaluate', 'graph', 'index', 'values'],
    registry: ['binding', 'contracts', 'harness', 'index', 'manifest', 'requirements', 'results', 'schema'],
    runtime: ['contracts', 'engine', 'index', 'worker'],
    scene: ['assets', 'author', 'bindings', 'contracts', 'definitions', 'index', 'three-adapter'],
    workspace: ['definitions', 'index', 'plot-samples'],
    gateway: ['commands', 'index'],
    portable: ['format'],
    timeline: ['configurations', 'definition', 'evaluator'],
  }).flatMap(([dir, names]) => names.map(name => 'src/' + dir + '/' + name + '.js')),
  ...['LICENSE', 'package.json', 'build/three.core.js', 'build/three.module.js', 'examples/jsm/controls/OrbitControls.js'].map(name => 'node_modules/three/' + name),
];

const playerReadme = `# Cosmic Lego local timeline player

Use Node.js 20 or later and a browser with WebGL 2. From this directory, run

    node scripts/timeline-server.mjs --project project.json --port 0

Open the printed loopback URL in the browser. Stop the local server with Ctrl+C.
Keep this directory together when copying the player to another computer. No
package installation, network connection, provider account or authoring repository
is needed. The runtime validates the project and its installed model requirements
before serving it. Seeking requests a fresh frame from the included scientific
evaluator. An embedded author recipe remains inert data.

The visualization project excludes conversation messages and agent turn/call
associations. Its author recipes, scene text, data and compact accepted-command
summaries remain inspectable. The delivery inventory lists SHA-256
digests of the packaged files. Original Cosmic Lego code uses the BSD-3-Clause
license in LICENSE. Three.js and OrbitControls carry their MIT license under
node_modules/three/LICENSE and docs/third-party-notices.md.
`;

export async function packagePlayer({ manifest, directory, composition } = {}) {
  const source = serializePortableManifest(manifest);
  const { startTimelineServer } = await import('../../scripts/timeline-server.mjs');
  const host = await startTimelineServer({ manifest: source, port: 0, visualizationDelivery: true, composition });
  let meta;
  try { meta = await readRoute(host.url, '/api/timeline'); } finally { await host.close(); }
  const project = host.manifest, projectText = serializePortableManifest(project);
  const destination = await newDirectory(directory);
  const inventory = [];
  // Only mark the package ready after all assets, code, notices and the pinned
  // manifest are present; a partial copy retains its incomplete status.
  const statusFile = path.join(destination, 'delivery.json');
  await atomicWrite(statusFile, json({ format: 'cosmic-lego.local-player', version: 1, status: 'incomplete' }));
  // Only host-owned deployment profiles reach here. The project cannot supply paths.
  const entry = composition?.playerEntry ?? 'scripts/timeline-server.mjs';
  const files = [...playerFiles, ...(composition?.playerFiles ?? [])];
  if (!files.includes(entry)) fail('DELIVERY_PROFILE', 'The selected player entry must be inventoried.');
  for (const file of new Set(files)) {
    if (!/^[a-zA-Z0-9_.@/-]+$/.test(file) || path.isAbsolute(file) || file.split('/').some(part => !part || part === '.' || part === '..'))
      fail('DELIVERY_PROFILE', 'Use repository-relative file names in the trusted deployment profile.');
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, file), target);
    inventory.push({ file, sha256: bytesHash(await readFile(target)) });
  }
  const metadata = { name: 'cosmic-lego-local-player', private: true, type: 'module', engines: { node: '>=20' }, license: 'BSD-3-Clause' };
  for (const [file, data] of [['project.json', projectText], ['package.json', json(metadata)], ['README.md', playerReadme.replace('node scripts/timeline-server.mjs', 'node ' + entry)]]) {
    await atomicWrite(path.join(destination, file), data);
    inventory.push({ file, sha256: bytesHash(data) });
  }
  const delivery = { format: 'cosmic-lego.local-player', version: 1, status: 'complete', title: meta.title,
    snapshotId: meta.snapshotId, identity: project.savedFrom, projectIntegrity: project.integrity, files: inventory };
  await atomicWrite(statusFile, json(delivery));
  return { directory: destination, status: 'complete', snapshotId: meta.snapshotId, files: inventory.length };
}
