// Opt-in F12 browser acceptance with the production native agent composition.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startExoplanetServer } from '../apps/exoplanet.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.env.COSMIC_LEGO_F12_OUTPUT ?? path.join(root, '.local/f12-qa/run'));
const slots = path.join(output, 'slots'), savedFile = path.join(slots, 'shadow-study.json');
const reportFile = path.join(output, 'report.json'), offline = process.argv.includes('--delivery-only');
const executable = process.env.COSMIC_LEGO_CODEX;
if (!offline && !path.isAbsolute(executable ?? '')) throw new Error('Supply the already authenticated local executable in COSMIC_LEGO_CODEX.');
const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
await mkdir(slots, { recursive: true });
if (!offline && await stat(savedFile).then(() => true, () => false)) throw new Error('Choose a new evidence directory, or use --delivery-only for the existing accepted file.');
const report = offline ? JSON.parse(await readFile(reportFile)) : { format: 'cosmic-lego.exoplanet-browser-evidence.v1', status: 'running',
  started: new Date().toISOString(), checks: [], attempts: [], samples: {}, prompts: [], tools: [], connections: [], browserErrors: [], cancelledReads: [] };
let current = '', turn, app, page, panel, browser, sessionUnsubscribe;
const scrub = value => String(value ?? '').replace(/(?:file:\/\/)?\/(?:Users|private|var|home)\/[^\s"'<>]+/g, '[local path]')
  .replace(/\b[0-9a-f]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/gi, '[private ID]').slice(0, 800);
const flush = () => writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
async function checked(label) {
  if (!report.checks.includes(label)) report.checks.push(label);
  console.log('Passed ' + label);
  await flush();
}
const near = (a, b, label, tolerance = 3e-8) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tolerance, `${label}: expected ${b}; got ${a}`);
const read = async file => JSON.parse(await readFile(file));
async function snapshot() {
  return page.evaluate(() => {
    const w = cosmicWorkspace, frame = w.snapshot;
    const value = (id, port) => w.results.find(result => result.producer.nodeId === id && result.producer.port === port)?.value;
    const curves = {};
    for (const id of ['curve-transit', 'curve-naive']) {
      const series = value(id, 'value'); curves[id] = { at: series.coordinates.values, data: series.data, unit: series.coordinates.unit.symbol };
    }
    const disks = {};
    for (const mesh of frame.scene.nodes.filter(item => item.kind === 'mesh' && item.id.startsWith('disk-'))) {
      disks[mesh.id] = { position: mesh.position, radius: frame.scene.assets.find(asset => asset.id === mesh.geometry).data.radius };
    }
    return { revision: frame.identity.revision, time: frame.time.value, union: value('transit', 'flux').data, naive: value('naive-flux', 'value').data,
      bias: value('overlap-overcount', 'value')?.data, visible: frame.overlays.filter(view => !view.hidden).map(view => view.id), disks, curves,
      plottedUnion: frame.overlays.find(view => view.id === 'plot-transit').data.data, plottedNaive: frame.overlays.find(view => view.id === 'plot-naive').data.data };
  });
}
async function ready() {
  await page.waitForFunction(() => globalThis.cosmicWorkspace?.snapshot?.valid && document.querySelector('#status').textContent.endsWith('ready'), null, { timeout: 120000 });
}
async function waitGraph(fourth, bias) {
  await page.waitForFunction(({ fourth, bias }) => {
    const frame = globalThis.cosmicWorkspace?.snapshot;
    return frame?.valid && frame.time.value === 0 && frame.scene.nodes.some(node => node.id === 'disk-fourth') === fourth
      && frame.overlays.some(view => view.id === 'overlap-bias-plot') === bias && document.querySelector('#status').textContent.endsWith('ready');
  }, { fourth, bias }, { timeout: 120000 });
}
function verifyConjunction(sample, fourth, bias) {
  // At conjunction Ember and Cinder share the projected center. Ash is behind
  // the primary. A uniform disk gives the squared radius ratio analytically.
  const scale = 71492000 / 695700000;
  const blocked = (radius => (radius * scale) ** 2);
  const union = 1 - blocked(fourth ? 1.8 : 1.4), naive = 1 - blocked(1.4) - blocked(.8) - (fourth ? blocked(1.8) : 0);
  near(sample.time, 0, 'physical seconds'); near(sample.union, union, 'union flux'); near(sample.naive, naive, 'summed-depth flux');
  near(sample.plottedUnion, sample.union, 'union overlay'); near(sample.plottedNaive, sample.naive, 'naive overlay');
  if (bias) near(sample.bias, union - naive, 'independently bound arithmetic');
  for (const [id, radius, front] of [['ember', 1.4, true], ['cinder', .8, true], ['ash', .5, false], ...(fourth ? [['fourth', 1.8, true]] : [])]) {
    const disk = sample.disks['disk-' + id]; near(disk.radius, radius * scale, id + ' sky radius');
    near(disk.position[0], 0, id + ' sky x'); near(disk.position[1], 0, id + ' sky y'); assert.equal(disk.position[2] > 0, front, id + ' foreground order');
  }
  for (const [id, target] of [['curve-transit', union], ['curve-naive', naive]]) {
    const series = sample.curves[id]; assert.equal(series.unit, 's'); assert.ok(series.at.length >= 3);
    assert.ok(series.at.every((v, i) => !i || v > series.at[i - 1])); near(series.data[series.at.indexOf(0)], target, id + ' conjunction sample');
  }
}
function recordSample(id, sample) {
  const { curves, ...facts } = sample;
  report.samples[id] = { ...facts, curves: Object.fromEntries(Object.entries(curves).map(([name, series]) => [name, {
    count: series.at.length, firstSeconds: series.at[0], lastSeconds: series.at.at(-1), conjunction: series.data[series.at.indexOf(0)], min: Math.min(...series.data), max: Math.max(...series.data),
  }])) };
}
function graphDelta(before, after) {
  const old = new Map(before.nodes.map(item => [item.id, item])), next = new Map(after.nodes.map(item => [item.id, item]));
  return { added: [...next.keys()].filter(id => !old.has(id)), removed: [...old.keys()].filter(id => !next.has(id)),
    updated: [...next].filter(([id, item]) => old.has(id) && JSON.stringify(old.get(id)) !== JSON.stringify(item)).map(([id]) => id) };
}
async function prompt(label, text) {
  turn = label; report.prompts.push({ turn, text });
  const before = app.agentSession.snapshot().messages.filter(item => item.role === 'user').length;
  await panel.getByRole('textbox', { name: /Message draft/ }).fill(text); await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(n => cosmicWorkspace.agent.snapshot().messages.filter(item => item.role === 'user').length > n, before);
  await page.waitForFunction(() => ['ready', 'failed', 'auth-needed', 'disconnected'].includes(cosmicWorkspace.agent.snapshot().status), null, { timeout: 600000 });
  const result = app.agentSession.snapshot(); assert.equal(result.status, 'ready', scrub(result.error?.message));
}
async function shot(name) { await page.screenshot({ path: path.join(output, name + '.png'), mask: [panel.locator('.transcript')], maskColor: '#182135' }); }
async function live() {
  current = 'baseline'; app = await startExoplanetServer({ port: 0, projectDirectory: slots, codexExecutable: executable });
  sessionUnsubscribe = app.agentSession.subscribe((state, event) => {
    if (event?.type === 'connection') { report.connections.push({ during: turn ?? 'connect', status: state.status }); console.log('Agent ' + state.status); }
    if (event?.type === 'tool' && event.phase === 'finished') {
      report.tools.push({ turn, command: scrub(event.command), ok: event.ok, ...(event.error ? { code: scrub(event.error.code), message: scrub(event.error.message) } : {}) });
      console.log(`Native ${turn} ${event.command} ${event.ok ? 'ok' : event.error?.code}`);
    }
  });
  page = await browser.newPage({ viewport: { width: 1600, height: 1040 }, deviceScaleFactor: 1 }); page.setDefaultTimeout(60000);
  page.on('pageerror', error => report.browserErrors.push(scrub(error.message)));
  const rejected = [], consoleErrors = [];
  page.on('response', async response => {
    if (response.status() < 400) return;
    const route = new URL(response.url()).pathname, body = await response.json().catch(() => ({}));
    if (route === '/api/workspace/evaluate' && response.status() === 409 && ['STALE_TOKEN', 'STALE_RESULT', 'SUPERSEDED'].includes(body.code)) {
      rejected.push(route); report.cancelledReads.push(body.code);
    } else report.browserErrors.push(`${response.status()} ${route} ${scrub(body.error?.code ?? body.code)}`);
  });
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: scrub(message.text()), route: new URL(message.location().url || app.url).pathname }); });
  await page.goto(app.url); await ready(); const baseline = app.project.snapshot();
  const first = await snapshot(); verifyConjunction(first, false, false); recordSample('baseline', first);
  panel = page.locator('[data-overlay-id="conversation"]');
  await shot('baseline');
  const camera = await page.evaluate(() => cosmicWorkspace.adapter.getCameraState());
  await page.locator('#fit').click(); assert.notDeepEqual(await page.evaluate(() => cosmicWorkspace.adapter.getCameraState()), camera);
  const fitted = await snapshot(); assert.equal(fitted.union, first.union); assert.deepEqual(fitted.curves, first.curves); assert.deepEqual(app.project.snapshot(), baseline);
  await page.locator('#reset').click();
  const box = await page.locator('#scene').boundingBox(); await page.mouse.click(box.x + box.width / 2 + .075 * box.height, box.y + box.height / 2);
  assert.equal(await page.evaluate(() => cosmicWorkspace.state.selection?.nodeId), 'disk-primary');
  await checked('Baseline sky radii, foreground ordering, independent overlap formula, sampled light curves and camera independence.');
  current = 'connect'; await panel.getByLabel('Agent', { exact: true }).selectOption('codex'); await panel.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForFunction(() => ['ready', 'failed', 'auth-needed'].includes(cosmicWorkspace.agent.snapshot().status), null, { timeout: 90000 });
  const state = app.agentSession.snapshot(); assert.equal(state.status, 'ready', scrub(state.error?.message)); report.agent = { provider: state.capabilities.provider, model: state.capabilities.model, permissionPolicy: state.permissionPolicy };
  await checked('The configured native app-server authenticated in the shared workspace.');
  current = 'native fourth planet';
  await prompt(current, 'Add one independently orbiting dark planet to this system, named fourth. Use the installed checked public operations in one atomic transaction, including its host relationship and a true-scale observer-sky disk. Keep existing bodies, arithmetic and views intact. Fixed primary primary, detector earthward, radius 1.8 R_J, mass metadata 0.2 M_J. Circular orbit, semimajor axis 0.12 AU, inclination 90 deg, ascending node 0 deg, periapsis argument 90 deg, epoch 0 days and mean anomaly 0 deg. Mirror Ember’s GM/radius inputs and attached-orbit relationship, using fourth-orbit. Create sky-fourth projection, shape-fourth physical-radius geometry, disk-fourth mesh (reuse paint-ember) and place-fourth position binding with the same observer frame and metres-to-display scale as place-ember. The live occulting-body selection already includes new orbits. Preview if helpful, then commit inside the application and briefly describe the model assumptions.');
  const withPlanet = app.project.snapshot(); assert.ok(withPlanet.nodes.some(node => node.id === 'fourth' && node.type === 'exoplanet.orbit'));
  await waitGraph(true, false); const added = await snapshot(); verifyConjunction(added, true, false); recordSample('fourth', added);
  report.planetChange = graphDelta(baseline, withPlanet); assert.deepEqual(report.planetChange.removed, []); assert.deepEqual(report.planetChange.updated, []);
  await shot('fourth'); await checked('Native structural edit adds the fourth orbit, relationship and true-radius projected geometry. Live union and naive samples update.');
  current = 'native measurement';
  await prompt(current, 'Add a reusable derived measurement and a visible independent plot through one atomic public transaction. Use the ID overlap-overcount for the generic arithmetic transit.flux minus naive-flux.value; specify a comparison meaning of overlap-overcount and reference earthward so the differing meanings are explicit. Bind it to a new plot overlap-bias-plot titled "Overlap counted twice · fractional flux" at x=1020, y=470, width=310, height=210. The quantity is the excess deficit in the naive sum; use the same normalized stellar-flux scale. Leave all existing nodes and links intact and commit this change.');
  const finalGraph = app.project.snapshot(); await waitGraph(true, true); const final = await snapshot(); verifyConjunction(final, true, true); recordSample('comparison', final);
  report.measurementChange = graphDelta(withPlanet, finalGraph); assert.deepEqual(report.measurementChange.updated, []); assert.deepEqual(report.measurementChange.removed, []);
  await shot('comparison'); await checked('Native arithmetic and separately bound plot agree with the independent four-planet calculation.');
  current = 'undo redo';
  for (const [button, fourth, bias, expected] of [['undo', true, false, withPlanet], ['undo', false, false, baseline], ['redo', true, false, withPlanet], ['redo', true, true, finalGraph]]) {
    await page.locator('#' + button).click(); await waitGraph(fourth, bias); assert.deepEqual(app.project.snapshot(), expected); verifyConjunction(await snapshot(), fourth, bias);
  }
  await checked('Two Undo and two Redo actions restore exact accepted graphs and their measured fluxes.');
  current = 'private save'; await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'disconnected');
  await page.locator('#project-toggle').click(); assert.equal(await page.locator('#project-save-transcript').isChecked(), false);
  await page.locator('#project-name').fill('shadow-study'); await page.locator('#project-save').click();
  await page.waitForFunction(() => document.querySelector('#project-feedback').textContent === 'Saved shadow-study.', null, { timeout: 120000 });
  const saved = await read(savedFile); assert.deepEqual(saved.graph, finalGraph); assert.deepEqual(saved.sharing.transcript, []); assert.equal(saved.sharing.transcriptIncluded, false);
  assert.equal(saved.playback.time.value, 0); assert.equal(app.portable.status().sourceStatus, 'diverged');
  for (const message of consoleErrors) {
    const i = rejected.indexOf(message.route);
    if (i >= 0 && message.text.includes('status of 409')) rejected.splice(i, 1); else report.browserErrors.push(message.text);
  }
  assert.deepEqual(report.browserErrors, []);
  report.saved = { slot: 'shadow-study', sha256: saved.integrity.sha256, graphHash: saved.integrity.graphHash,
    original: saved.source.original.path, sourceStatus: app.portable.status().sourceStatus, transcriptIncluded: false, revision: app.project.token.revision };
  await checked('Private named save retains the accepted scientific, presentation and source records.');
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}),
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  if (!offline) {
    report.versions = { node: process.version, browser: browser.version(), codex: scrub(execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim()) };
    await live(); await page.close(); sessionUnsubscribe(); await app.close(); app = null;
  }
  current = 'offline delivery';
  const { verifyExoplanetDelivery } = await import('./exoplanet-delivery-check.mjs');
  report.delivery = await verifyExoplanetDelivery({ browser, slots, savedFile, output, saved: report.saved });
  await checked('Agent-free restart, backward seeking, exact-clock flux comparison and exported local frames.');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.attempts.push({ during: current, message: scrub(error.message), code: scrub(error.code ?? 'ACCEPTANCE') });
  console.error(current, scrub(error.message)); process.exitCode = 1;
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png'), ...(panel ? { mask: [panel.locator('.transcript')] } : {}) }).catch(() => {});
} finally {
  sessionUnsubscribe?.(); await browser?.close(); await app?.close(); report.completed = new Date().toISOString(); await flush(); console.log('Evidence ' + path.relative(root, output));
}
