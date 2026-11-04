// F12 provider-free restart and local delivery checks for the saved native edit.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createTimeline } from '../src/timeline/definition.js';
import { startExoplanetServer } from '../apps/exoplanet.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file));
const near = (a, b, label) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= 3e-8, label + ': ' + a + ' versus ' + b);
function hostUrl(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Exported player startup timed out.')), 45000);
    let text = '';
    child.stdout.on('data', chunk => {
      text = (text + chunk.toString()).slice(-4000);
      const url = text.match(/(http:\/\/127\.0\.0\.1:\d+\/timeline\/)\s/);
      if (url) { clearTimeout(timer); resolve(url[1]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Exported player exited: ' + code)); });
  });
}
async function copyPlayerCheck({ browser, player, manifest, output }) {
  const info = await json(path.join(player, 'delivery.json'));
  assert.equal(info.status, 'complete'); assert.equal(info.snapshotId, manifest.integrity.sha256);
  const files = [];
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file);
      else { assert.ok(item.isFile()); files.push(path.relative(player, file)); }
    }
  }
  await walk(player); assert.deepEqual(files.sort(), [...info.files.map(item => item.file), 'delivery.json'].sort());
  for (const item of info.files) assert.equal(digest(await readFile(path.join(player, item.file))), item.sha256, item.file);
  const runtimeSources = ['src/dataflow/values.js', 'src/dataflow/evaluate.js'];
  for (const file of runtimeSources) {
    assert.equal(digest(await readFile(path.join(root, file))), info.files.find(item => item.file === file)?.sha256, file);
  }
  const scratch = await mkdtemp(path.join(tmpdir(), 'cosmic-exoplanet-player-'));
  const bundle = path.join(scratch, 'study.zip'), clean = path.join(scratch, 'clean');
  let child, closed, context;
  try {
    await mkdir(clean); await run('zip', ['-q', '-X', '-r', bundle, '.'], { cwd: player }); await run('unzip', ['-q', bundle, '-d', clean]);
    for (const item of info.files) assert.equal(digest(await readFile(path.join(clean, item.file))), item.sha256);
    child = spawn(process.execPath, ['packages/exoplanet/player.mjs', '--project', 'project.json', '--port', '0'], { cwd: clean,
      env: { PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC', TMPDIR: scratch }, stdio: ['ignore', 'pipe', 'ignore'] }); closed = once(child, 'exit');
    const url = await hostUrl(child), origin = new URL(url).origin, external = [], errors = [];
    context = await browser.newContext({ viewport: { width: 960, height: 620 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      external.push(new URL(route.request().url()).origin); return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', route => { external.push(new URL(route.url()).origin); route.close(); });
    const tab = await context.newPage(); tab.on('pageerror', error => errors.push(error.message)); tab.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await tab.goto(url); await tab.waitForFunction(() => globalThis.cosmicTimeline?.receipt?.ready, null, { timeout: 120000 });
    await tab.locator('#exact-time').fill('4'); await tab.locator('#go').click(); await tab.waitForFunction(() => cosmicTimeline.receipt?.presentationTime === 4, null, { timeout: 120000 });
    const sample = await tab.evaluate(() => {
      const frame = cosmicTimeline.frame;
      return { physicalTime: frame.physicalTime.value, union: frame.results.find(r => r.producer.nodeId === 'transit' && r.producer.port === 'flux').value.data,
        naive: frame.results.find(r => r.producer.nodeId === 'naive-flux').value.data, bias: frame.results.find(r => r.producer.nodeId === 'overlap-overcount').value.data,
        skyDiskCount: frame.snapshot.scene.nodes.filter(n => n.kind === 'mesh' && n.id.startsWith('disk-')).length,
        scalarText: document.querySelector('[data-id="plot-transit"] .measurement').textContent };
    });
    assert.equal(sample.physicalTime, 0); near(sample.union, 0.965785051008403, 'standalone conjunction'); near(sample.naive, 0.9383286104595905, 'standalone naive');
    near(sample.bias, sample.union - sample.naive, 'standalone overlap overcount'); assert.equal(sample.skyDiskCount, 5);
    await tab.screenshot({ path: path.join(output, 'standalone.png') }); assert.deepEqual(external, []); assert.deepEqual(errors, []);
    return { filesHashedTwice: info.files.length, zipBytes: (await stat(bundle)).size, snapshotId: info.snapshotId, sample, external, errors };
  } finally {
    await context?.close(); if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await closed; }
    await rm(scratch, { recursive: true, force: true });
  }
}
async function deliveryCopy(app, native, slots) {
  const original = native.timeline.data;
  const title = 'When shadows overlap', opening = 'Follow the foreground silhouettes across the uniformly bright stellar disk.';
  const author = createTimeline({ id: original.id, title, duration: original.duration });
  for (const track of original.tracks) {
    const handle = author.track(track);
    if (track.id === 'guide') {
      assert.equal(track.kind, 'annotation');
      handle.set({ keys: track.keys.map(key => key.at === 0 ? { ...key, value: opening } : key) });
    }
  }
  for (const boundary of original.boundaries) author.boundary(boundary);
  const name = 'shadow-overlap-delivery', file = path.join(slots, name + '.json'), timeline = author.snapshot();
  const post = async (action, data) => {
    const response = await fetch(app.url + '/api/projects/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const value = await response.json(); assert.equal(value.ok, true, value.error?.message); return value.result;
  };
  const listed = await (await fetch(app.url + '/api/projects/list')).json();
  const existing = listed.result.find(slot => slot.name === name);
  if (existing) {
    // Resume from the existing editorial copy after a failed export without
    // overwriting any file. Refuse a slot with unrelated revisions or edits.
    const prior = await json(file); assert.deepEqual(prior.timeline.data, timeline.data); assert.deepEqual(prior.graph, native.graph);
    await post('open', { expected: app.project.token, name, expectedVersion: existing.version });
  } else await post('save', { expected: app.project.token, name, expectedVersion: null, time: { value: 0, unit: 's' }, timeline, includeTranscript: false });
  const manifest = await json(file);
  for (const field of ['graph', 'source', 'resources', 'assets', 'requirements', 'dataSources', 'sharing', 'playback']) assert.deepEqual(manifest[field], native[field], field);
  assert.deepEqual(manifest.timeline.data, timeline.data);
  assert.equal(manifest.integrity.graphHash, native.integrity.graphHash);
  assert.equal(app.portable.status().sourceStatus, 'diverged');
  return { file, manifest, changes: { nativeSlot: 'shadow-study', nativeSnapshot: native.integrity.sha256, deliverySlot: name,
    snapshot: manifest.integrity.sha256, graphHash: manifest.integrity.graphHash, graphAndSourceUnchanged: true,
    title: { before: original.title, after: title }, opening: { before: original.tracks.find(track => track.id === 'guide').keys[0].value, after: opening } } };
}

export async function verifyExoplanetDelivery({ browser, slots, savedFile, output, saved }) {
  assert.ok(saved, 'A prior genuine agent save is required.');
  const native = await json(savedFile); assert.equal(native.integrity.sha256, saved.sha256); assert.equal(native.integrity.graphHash, saved.graphHash);
  output = path.join(output, 'final'); await mkdir(output, { recursive: true });
  const app = await startExoplanetServer({ port: 0, projectDirectory: slots });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1040 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const external = [], browserErrors = [];
  try {
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      if (target.origin !== app.url) { external.push(target.origin); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    const tab = await context.newPage(); tab.on('pageerror', error => browserErrors.push(error.message)); tab.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
    await tab.goto(app.url + '/workspace/'); await tab.waitForFunction(() => globalThis.cosmicWorkspace?.snapshot?.valid, null, { timeout: 120000 });
    await tab.locator('#project-toggle').click(); await tab.locator('#project-list').selectOption('shadow-study'); await tab.locator('#project-open').click();
    await tab.waitForFunction(() => document.querySelector('#project-feedback').textContent === 'Opened shadow-study.', null, { timeout: 120000 });
    assert.deepEqual(app.project.snapshot(), native.graph); assert.notEqual(app.project.token.generation, native.savedFrom.generation);
    assert.equal(app.agentSession.snapshot().agents.length, 0); assert.equal(app.agentSession.snapshot().status, 'disconnected');
    await tab.locator('#project-close').click();
    const active = await tab.evaluate(() => ({
      value: cosmicWorkspace.results.find(r => r.producer.nodeId === 'transit' && r.producer.port === 'flux').value.data,
      readout: document.querySelector('[data-overlay-id="plot-transit"] .scalar-readout').textContent,
      time: cosmicWorkspace.snapshot.time.value,
      series: document.querySelector('[data-overlay-id="plot-curve-transit"] .plot-container').textContent,
    }));
    near(active.value, 0.965785051008403, 'reopened flux'); assert.equal(active.time, 0); assert.match(active.readout, /0\.96578/);
    await tab.screenshot({ path: path.join(output, 'reopened.png') });
    const { file, manifest, changes } = await deliveryCopy(app, native, slots);
    assert.deepEqual(await json(savedFile), native);
    const before = app.project.token, history = app.project.history;
    await tab.goto(app.url + '/timeline/'); await tab.waitForFunction(() => globalThis.cosmicTimeline?.receipt?.ready, null, { timeout: 120000 });
    const shared = new Map();
    for (const t of [0, 2, 3, 4, 5, 6, 8, 0, 4]) {
      await tab.evaluate(time => cosmicTimeline.seek(time), t);
      const frame = await tab.evaluate(() => cosmicTimeline.frame);
      assert.equal(frame.timeline.title, changes.title.after);
      if (t === 0) assert.equal(frame.annotations[0].text, changes.opening.after);
      const physical = t <= 3 ? -7200 + 2400 * t : t < 5 ? 0 : 2400 * (t - 5);
      near(frame.physicalTime.value, physical, 'timeline physical seconds');
      const values = frame.results.map(result => [result.producer.nodeId, result.producer.port, result.value]);
      const result = (id, port = 'value') => frame.results.find(item => item.producer.nodeId === id && item.producer.port === port).value.data;
      const union = result('transit', 'flux'), naive = result('naive-flux'), bias = result('overlap-overcount');
      near(bias, union - naive, 'timeline excess counted depth');
      if (physical === 0) { near(union, 0.965785051008403, 'held flux'); near(naive, 0.9383286104595905, 'held naive'); }
      if (shared.has(t)) assert.deepEqual(values, shared.get(t).values);
      shared.set(t, { physical, union, naive, bias, values, configuration: frame.configuration, geometry: frame.snapshot.scene.nodes });
    }
    // Present the exact frame selected in the interactive player at the export
    // size. Check the actual rail in capture mode, including its final border.
    const heldFrame = await tab.evaluate(() => cosmicTimeline.frame);
    assert.equal(heldFrame.presentationTime, 4);
    await tab.setViewportSize({ width: 1600, height: 900 });
    await tab.goto(app.url + '/timeline/?capture=1');
    await tab.waitForFunction(() => globalThis.cosmicTimeline?.capture);
    await tab.evaluate(frame => cosmicTimeline.present(frame), heldFrame);
    const cardRail = await tab.locator('#panels').evaluate(rail => ({
      scrollHeight: rail.scrollHeight,
      clientHeight: rail.clientHeight,
      cards: [...rail.querySelectorAll('.readout')].map(card => card.dataset.id),
    }));
    assert.deepEqual(cardRail.cards, ['plot-transit', 'plot-curve-transit', 'plot-naive', 'overlap-bias-plot']);
    assert.ok(cardRail.scrollHeight <= cardRail.clientHeight + 1, 'The held frame clips the measurement rail.');
    await tab.screenshot({ path: path.join(output, 'held.png') });
    assert.deepEqual(app.project.token, before); assert.deepEqual(app.project.history, history);
    const sequenceDir = path.join(output, 'sequence'), playerDir = path.join(output, 'player');
    await run(process.execPath, ['apps/exoplanet.mjs', 'export', file, sequenceDir, '--start', '0', '--end', '8', '--fps', '4', '--width', '1600', '--height', '900'], { cwd: root, timeout: 300000 });
    const sequence = await json(path.join(sequenceDir, 'sequence.json')), progress = await json(path.join(sequenceDir, 'progress.json'));
    assert.equal(progress.status, 'complete'); assert.equal(sequence.snapshotId, manifest.integrity.sha256);
    assert.equal(sequence.title, changes.title.after);
    const frames = [];
    for (const item of sequence.frames) {
      const record = await json(path.join(sequenceDir, item.metadata)), bytes = await readFile(path.join(sequenceDir, item.image));
      assert.equal(record.imageHash, digest(bytes)); assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1600, 900]);
      const time = item.presentationTime, physical = time <= 3 ? -7200 + 2400 * time : time <= 5 ? 0 : 2400 * (time - 5);
      near(record.physicalTime.value, physical, 'PNG sample time'); assert.deepEqual(record.identity, manifest.savedFrom);
      const value = (id, port = 'value') => record.results.find(result => result.producer.nodeId === id && result.producer.port === port).value.data;
      const union = value('transit', 'flux'), naive = value('naive-flux'), bias = value('overlap-overcount');
      near(bias, union - naive, 'exported overlap excess'); assert.ok(union >= naive - 3e-8 && union <= 1 + 3e-8);
      if (physical === 0) { near(union, 0.965785051008403, 'held exported union'); near(naive, 0.9383286104595905, 'held exported naive'); }
      if (time === 0) assert.equal(record.annotations[0].text, changes.opening.after);
      const matched = [0, 2, 4, 6, 8].includes(time);
      if (matched) {
        const ref = shared.get(time); assert.deepEqual(record.configuration, ref.configuration);
        assert.deepEqual(record.results.map(r => [r.producer.nodeId, r.producer.port, r.value]), ref.values);
      }
      frames.push({ file: item.image, presentation: time, physicalSeconds: physical, union, naive, excess: bias, comparedWithInteractive: matched, imageHash: record.imageHash });
    }
    const expectedTimes = Array.from({ length: 33 }, (_, index) => index / 4);
    assert.deepEqual(frames.map(frame => frame.presentation), expectedTimes);
    assert.deepEqual(frames.filter(frame => frame.comparedWithInteractive).map(frame => frame.presentation), [0, 2, 4, 6, 8]);
    assert.deepEqual(external, []);
    assert.deepEqual(browserErrors, []);
    await run(process.execPath, ['apps/exoplanet.mjs', 'package', file, playerDir], { cwd: root, timeout: 120000 });
    const player = await copyPlayerCheck({ browser, player: playerDir, manifest, output });
    return { editorial: changes, schedule: sequence.schedule, originalSource: manifest.source.original.path, sourceStatus: app.portable.status().sourceStatus, agents: 0,
      storedTranscript: manifest.sharing.transcript.length, reopened: active, cardRail, frames, player, external, browserErrors };
  } finally { await context.close(); await app.close(); }
}
