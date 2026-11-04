// F11 repeatable, agent-free half of the exercise. Input is the named file
// saved by the real browser journey. All app code executes from a clean stage.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { stageReadinessWorkspace } from './readiness-workspace.mjs';
import { verifyReadinessPlayer } from './readiness-player-check.mjs';

const run = promisify(execFile);
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const pretty = data => JSON.stringify(data, null, 2) + '\n';
const near = (actual, expected, unit = '') => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-12,
  `Expected ${expected} ${unit}, got ${actual}`);

// These fixture references come from the independent author's stated equations,
// sample coordinates and initial conditions. They use no simulation code.
function expectedClock(t) {
  if (t <= 1.5) return 2 * t / 1.5;
  return t <= 2.5 ? 2 : 2 + 2 * (t - 2.5) / 1.5;
}
function reference(time, late) {
  const positions = { 'puck-low': [time - 2, -1, 0], 'puck-mid': [time - 2, 0, 0], 'puck-high': [time - 2, 1, 0] };
  if (late) positions['late-puck'] = [-3 + time / 2, 0, 0];
  const mean = Object.values(positions).reduce((total, v) => total + Math.hypot(...v), 0) / Object.keys(positions).length;
  let state = 20261103n, value = 1.5;
  const draws = Math.floor(time * 4);
  for (let i = 0; i < draws; i++) {
    state = (1664525n * state + 1013904223n) % 4294967296n;
    value += Number(state) / 4294967296 - 0.5;
  }
  return { positions, mean, margin: mean - 1, value, draws, state: Number(state), achieved: draws / 4 };
}
function checkSamples(results, time, late, scene) {
  const byId = new Map(results.map(result => [result.producer.nodeId, result]));
  for (const result of results) {
    near(result.request.time.value, time, 's'); assert.equal(result.request.time.unit.symbol, 's');
    if (result.producer.nodeId !== 'timing-dither') near((result.metadata?.runtime ?? result).achievedTime.value, time, 's');
  }
  const expected = reference(time, late), points = byId.get('scan-pucks').value;
  assert.equal(points.unit.symbol, 'm'); assert.equal(points.data.length, Object.keys(expected.positions).length);
  assert.deepEqual(new Set(points.objectIds), new Set(Object.keys(expected.positions)));
  for (const [index, id] of points.objectIds.entries()) {
    assert.equal(points.data[index].length, 3);
    points.data[index].forEach((n, axis) => near(n, expected.positions[id][axis], 'm'));
  }
  const lab = { id: 'lab', kind: 'position' };
  assert.deepEqual(points.frame, lab);
  const mean = byId.get('mean-gate-radius').value;
  assert.equal(mean.unit.symbol, 'm'); near(mean.data, expected.mean, 'm');
  const margin = byId.get('radius-margin').value; assert.equal(margin.unit.symbol, 'm'); near(margin.data, expected.margin, 'm');
  const dither = byId.get('timing-dither'); near(dither.value.data, expected.value);
  near((dither.metadata?.runtime ?? dither).achievedTime.value, expected.achieved, 's');
  // Browser frames include resumable checkpoints. The export sidecar records
  // the same generator state in the component execution history.
  const state = (scene ? dither.checkpoints : dither.components)?.find(c => c.nodeId === 'timing-dither');
  assert.equal(state?.random?.algorithm, 'lcg32');
  assert.deepEqual(state.random.state, { value: expected.state, draws: expected.draws });
  const arrival = byId.get('arrival-field').value, velocity = byId.get('velocity-field').value;
  for (const field of [arrival, velocity]) {
    assert.deepEqual(field.coordinates.frame, lab); assert.equal(field.coordinates.unit.symbol, 'm');
  }
  assert.deepEqual(velocity.frame, { id: 'lab', kind: 'direction' });
  const rows = [-1, 0, 1], cols = [-2, -1, 0, 1, 2];
  assert.equal(arrival.unit.symbol, 's'); assert.equal(velocity.unit.symbol, 'm/s');
  assert.deepEqual(arrival.coordinates.values, rows.flatMap(y => cols.map(x => [x, y, 0])));
  assert.deepEqual(arrival.data, rows.flatMap(() => [0, 1, 2, 3, 4]));
  assert.deepEqual(velocity.coordinates.values, rows.map(y => [-2.75, y, 0]));
  assert.deepEqual(velocity.data, rows.map(() => [1, 0, 0]));
  if (scene) {
    const shape = id => scene.nodes.find(n => n.id === id);
    const pucks = shape('pucks-stage'), tiles = shape('arrival-tiles'), arrows = shape('velocity-glyphs');
    assert.deepEqual(pucks.objectIds, points.objectIds); assert.deepEqual(pucks.positions, points.data);
    assert.deepEqual(tiles.positions, arrival.coordinates.values); assert.equal(tiles.colors.length, 15);
    const palette = [[0.208, 0.345, 0.659], [0.3195, 0.559, 0.694], [0.431, 0.773, 0.729],
      [0.690, 0.763, 0.5585], [0.949, 0.753, 0.388]];
    for (const [index, color] of tiles.colors.entries()) {
      assert.equal(color.length, 3);
      color.forEach((channel, c) => near(channel, palette[index % cols.length][c], 'RGB'));
    }
    assert.deepEqual(arrows.origins, velocity.coordinates.values); assert.deepEqual(arrows.directions, velocity.data); near(arrows.vectorScale, 0.45);
  }
  return { points: points.data.length, mean: mean.data, margin: margin.data, dither: dither.value.data, draws: expected.draws, achieved: expected.achieved };
}

async function launch(stage, args, env) {
  const child = spawn(process.execPath, args, { cwd: stage, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout }), closed = once(child, 'close');
  let stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
  let timer;
  try {
    const line = await Promise.race([once(lines, 'line').then(([value]) => value),
      closed.then(([code]) => { throw new Error('Companion exited during startup (' + code + '). ' + stderr); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out starting the isolated workspace.')), 30000); })]);
    const url = line.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(url, 'Expected the production loopback server');
    return { url, async close() { if (child.exitCode === null) child.kill('SIGTERM'); await closed; } };
  } catch (error) { if (child.exitCode === null) child.kill('SIGTERM'); await closed; throw error; }
  finally { clearTimeout(timer); lines.close(); }
}
async function jsonRequest(url, route, body) {
  const response = await fetch(url + route, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: response.status, body: await response.json() };
}

export async function verifyReadinessDelivery({ slots, name = 'readiness-saved', output, baseline = false }) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error('Choose a valid F09 slot name.');
  const archiveFile = path.resolve(slots, name + '.json'), bytes = await readFile(archiveFile), original = JSON.parse(bytes);
  assert.equal(original.graph.id, 'gate-bench'); assert.equal(original.playback.time.value, 2);
  assert.equal(original.graph.nodes.some(n => n.id === 'late-puck'), !baseline);
  assert.equal(original.sharing.transcriptIncluded, false); assert.deepEqual(original.sharing.transcript, []);
  assert.ok(original.sharing.receipts.every(r => !Object.hasOwn(r, 'turnId') && !Object.hasOwn(r, 'callId')));
  if (!baseline) {
    const accepted = original.sharing.receipts.find(r => r.command === 'transaction.commit' && r.summary?.created.includes('late-puck'));
    assert.ok(accepted, 'Expected the accepted edit receipt in the saved archive');
    assert.notEqual(original.source.original.producedGraphHash, original.integrity.graphHash);
  }
  assert.equal(original.source.reconstruction.producedGraphHash, original.integrity.graphHash);
  await mkdir(output, { recursive: false });
  const temporary = await mkdtemp(path.join(tmpdir(), 'cosmic-f11-restart-')), stage = path.join(temporary, 'application');
  const report = { mode: baseline ? 'Independent recipe baseline' : 'Reopen named structural edit', nodeVersion: process.version,
    archive: digest(bytes), checks: [], sharedTimes: [], browserErrors: [], unexpectedRequests: [] };
  let app, browser;
  try {
    const staged = await stageReadinessWorkspace(stage);
    assert.ok(staged.audit.authorRecipe);
    await writeFile(path.join(output, 'boundary.json'), pretty(staged.audit));
    report.boundary = { files: staged.files.length, modules: staged.audit.modules.length, edges: staged.audit.edges.length,
      negativeImports: staged.audit.negativeProbes.length, extensions: staged.audit.registeredExtensions.length, threeRevision: staged.audit.threeRevision };
    const emptyHome = path.join(temporary, 'home'); await mkdir(emptyHome);
    const env = { PATH: '/usr/bin:/bin', HOME: emptyHome, TMPDIR: temporary };
    for (const key of ['COSMIC_LEGO_PLAYWRIGHT', 'COSMIC_LEGO_CHROME']) if (process.env[key]) env[key] = process.env[key];
    app = await launch(stage, ['scripts/scene-server.mjs', '--workspace', '--port', '0', '--project-dir', path.resolve(slots)], env);
    const get = async route => (await jsonRequest(app.url, route)).body;
    const session = (await get('/api/agent/state')).result;
    assert.equal(session.status, 'disconnected'); assert.deepEqual(session.agents, []); assert.deepEqual(session.messages, []);
    const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
    browser = await chromium.launch({ headless: true, ...(env.COSMIC_LEGO_CHROME ? { executablePath: env.COSMIC_LEGO_CHROME } : {}),
      args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    report.browser = browser.version();
    const tab = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await tab.route('**/*', route => {
      if (new URL(route.request().url()).origin === app.url) return route.continue();
      report.unexpectedRequests.push(new URL(route.request().url()).origin); return route.abort();
    });
    tab.on('pageerror', error => report.browserErrors.push(error.message));
    await tab.goto(app.url + '/workspace/');
    await tab.waitForFunction(() => window.cosmicWorkspace?.snapshot?.valid);
    await tab.locator('#project-toggle').click(); await tab.locator('#project-list').selectOption(name); await tab.locator('#project-open').click();
    await tab.waitForFunction(() => window.cosmicWorkspace?.snapshot?.valid && cosmicWorkspace.state.identity.projectId === 'gate-bench' && cosmicWorkspace.state.time.value === 2);
    const restored = (await get('/api/projects/state')).result;
    assert.equal(restored.name, name); assert.equal(restored.version, digest(bytes)); assert.equal(restored.dirty, false);
    assert.equal(restored.sourceStatus, baseline ? 'matches' : 'diverged');
    assert.notEqual(restored.identity.generation, original.savedFrom.generation);
    const state = await get('/api/gateway/state');
    assert.deepEqual(state.history, { canUndo: false, canRedo: false });
    assert.deepEqual((await get('/api/workspace/state')).graph, original.graph);
    const { body: stale, status } = await jsonRequest(app.url, '/api/gateway', { command: 'remove', args: { id: 'puck-mid' },
      expected: original.savedFrom, idempotencyKey: 'f11-rejected-earlier-generation' });
    assert.equal(status, 409); assert.equal(stale.error.code, 'STALE_TOKEN'); assert.ok(stale.error.repairs.length);
    assert.deepEqual((await get('/api/gateway/state')).identity, state.identity);
    await tab.locator('#project-close').click(); await tab.screenshot({ path: path.join(output, 'reopened.png') });
    report.checks.push('Fresh agent-free companion reopened the exact named file through the workspace UI; archive identity expired and its stale write failed.');
    const actual = await tab.evaluate(() => ({ scene: cosmicWorkspace.snapshot.scene, overlays: cosmicWorkspace.snapshot.overlays }));
    const measurement = actual.overlays.find(view => view.id === 'gate-radius-report');
    near(measurement.data.data, reference(2, !baseline).mean);
    assert.equal(actual.scene.nodes.find(n => n.id === 'pucks-stage').positions.length, baseline ? 3 : 4);
    report.sourceStatus = restored.sourceStatus;
    await tab.goto(app.url + '/timeline/');
    await tab.waitForFunction(() => window.cosmicTimeline?.receipt?.ready);
    const shared = new Map();
    // A backward seek and a repeated endpoint exercise replay and seek stability.
    for (const time of [0, 1, 1.5, 2.5, 3.25, 4, 1, 4]) {
      await tab.evaluate(t => cosmicTimeline.seek(t), time);
      const frame = await tab.evaluate(() => cosmicTimeline.frame);
      const physical = expectedClock(time); near(frame.physicalTime.value, physical, 's');
      const facts = checkSamples(frame.results, physical, !baseline, frame.snapshot.scene);
      const values = frame.results.map(r => [r.producer.nodeId, r.producer.port, r.value]);
      if (shared.has(time)) assert.deepEqual(shared.get(time).values, values);
      shared.set(time, { values, configuration: frame.configuration });
      report.sharedTimes.push({ presentation: time, physical, ...facts });
      if (time === 1.5) await tab.screenshot({ path: path.join(output, 'held-timeline.png') });
    }
    assert.deepEqual(await get('/api/gateway/state'), state);
    assert.deepEqual(report.browserErrors, []); assert.deepEqual(report.unexpectedRequests, []);
    report.checks.push('Independent motion, arithmetic, field, seeded value, achieved-time and generator-state checks passed in the interactive player, including backward and repeated seeks.');
    // Export the original disk snapshot. Reopening deliberately has a new load
    // token, so compare graph, clocks, configuration and Values across sessions.
    const seqDir = path.join(path.resolve(output), 'sequence'), playerDir = path.join(path.resolve(output), 'player');
    await run(process.execPath, ['scripts/timeline-delivery.mjs', 'export', archiveFile, seqDir, '--start', '0', '--end', '4', '--fps', '4',
      '--width', '960', '--height', '540'], { cwd: stage, env, timeout: 240000 });
    await run(process.execPath, ['scripts/timeline-delivery.mjs', 'package', archiveFile, playerDir], { cwd: stage, env, timeout: 60000 });
    const sequence = await readJson(path.join(seqDir, 'sequence.json')), progress = await readJson(path.join(seqDir, 'progress.json'));
    assert.equal(progress.status, 'complete'); assert.equal(progress.completedFrames, 17);
    assert.deepEqual(sequence.schedule, { start: 0, end: 4, fps: 4, width: 960, height: 540 });
    assert.deepEqual(sequence.frames.map(entry => entry.index), Array.from({ length: 17 }, (_, i) => i));
    const matched = new Set();
    for (const entry of sequence.frames) {
      const stem = 'frames/frame-' + String(entry.index).padStart(6, '0');
      assert.equal(entry.image, stem + '.png'); assert.equal(entry.metadata, stem + '.json');
      assert.equal(entry.presentationTime, entry.index / 4);
      const record = await readJson(path.join(seqDir, entry.metadata)), png = await readFile(path.join(seqDir, entry.image));
      assert.equal(record.imageHash, digest(png)); assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [960, 540]);
      assert.deepEqual(record.identity, original.savedFrom); assert.equal(record.snapshotId, sequence.snapshotId);
      const t = entry.index / 4, physical = expectedClock(t);
      assert.equal(record.presentationTime, t); near(record.physicalTime.value, physical, 's');
      checkSamples(record.results, physical, !baseline);
      if (shared.has(t)) {
        matched.add(t);
        assert.deepEqual(record.configuration, shared.get(t).configuration);
        assert.deepEqual(record.results.map(r => [r.producer.nodeId, r.producer.port, r.value]), shared.get(t).values);
      }
    }
    assert.deepEqual(matched, new Set(shared.keys())); assert.equal(matched.size, 6);
    const delivered = await readJson(path.join(playerDir, 'delivery.json')); assert.equal(delivered.status, 'complete');
    assert.equal(delivered.snapshotId, sequence.snapshotId);
    report.player = await verifyReadinessPlayer({ directory: playerDir, browser, env, baseline,
      expectedGraphHash: original.integrity.graphHash, screenshotPath: path.join(output, 'clean-player.png'),
      archivePath: path.join(output, 'timing-gate-player.zip') });
    assert.deepEqual(await readFile(archiveFile), bytes);
    report.frames = progress.completedFrames; report.dimensions = [960, 540]; report.fps = 4; report.snapshot = sequence.snapshotId;
    report.checks.push('All 17 PNGs and sidecars passed time, numeric, dimensions and hash checks. At six shared times, exported Values and configurations exactly matched the reopened browser. Player package and original archive verified.');
    report.passed = true;
  } catch (error) {
    report.passed = false; report.failure = { name: error.name, message: String(error.message).slice(0, 3000) }; throw error;
  } finally {
    try { await browser?.close(); } finally {
      try { await app?.close(); } finally {
        await writeFile(path.join(output, 'report.json'), pretty(report)); await rm(temporary, { recursive: true, force: true });
      }
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [slots, name, output, mode] = process.argv.slice(2);
  if (!slots || !name || !output || (mode && mode !== '--baseline') || process.argv.length > 6) throw new Error('Usage: verify-readiness-delivery.mjs SLOT_DIRECTORY SLOT_NAME NEW_OUTPUT_DIRECTORY [--baseline]');
  console.log(pretty(await verifyReadinessDelivery({ slots, name, output, baseline: mode === '--baseline' })));
}
