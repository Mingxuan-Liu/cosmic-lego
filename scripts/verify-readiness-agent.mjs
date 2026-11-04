// F11 opt-in acceptance with a genuine native adapter in an isolated staged app.
// The observer records semantic calls and public graph deltas. The post-Stop
// callback is a host probe, recorded separately from calls made by the agent.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stageReadinessWorkspace } from './readiness-workspace.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.resolve(process.env.COSMIC_LEGO_F11_OUTPUT ?? path.join(root, '.local/f11-qa'));
const output = path.join(base, 'agent'), slots = path.join(base, 'slots');
const executable = process.env.COSMIC_LEGO_CODEX;
if (!executable || !path.isAbsolute(executable)) throw new Error('Set COSMIC_LEGO_CODEX to the trusted, already authenticated native executable.');
const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
await Promise.all([mkdir(output, { recursive: true }), mkdir(slots, { recursive: true })]);
const savedPath = path.join(slots, 'readiness-saved.json');
if (await stat(savedPath).then(() => true, () => false)) throw new Error('readiness-saved already exists. Select a new COSMIC_LEGO_F11_OUTPUT for another run.');
const scratch = await mkdtemp(path.join(tmpdir(), 'cosmic-readiness-session-'));
const stages = ['isolation', 'selection', 'connect', 'structural edit', 'stale revision', 'invalid connection', 'undo', 'stop', 'revoked authority', 'redo', 'private save'];
const report = {
  format: 'cosmic-lego.readiness-agent-evidence.v1', started: new Date().toISOString(), status: 'running',
  provider: 'Actual locally authenticated Codex app-server with cosmic_command', versions: { node: process.version },
  checks: Object.fromEntries(stages.map(name => [name, { status: 'unexecuted' }])),
  prompts: [], tools: [], transitions: [], browserErrors: [], expectedReadCancellations: [], measurements: {},
};
let check = 'isolation', turn = null, app, browser, page, panel, nativeHandlers, selectedContext;
let auditWrite = Promise.resolve(), stagedRoot;
const cancelledNativeStart = Promise.withResolvers();
const scrub = value => String(value ?? '').replace(/(?:file:\/\/)?\/(?:Users|private|var|home)\/[^\s"'<>]+/g, '[local path]')
  .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '[private ID]')
  .replace(/\b(?:sk|sess|tok)-[A-Za-z0-9_-]{12,}\b/g, '[redacted]').slice(0, 600);
const hash = object => 'sha256:' + createHash('sha256').update(JSON.stringify(object)).digest('hex');
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-10 + 1e-12 * Math.abs(expected), `Expected ${expected}, received ${actual}`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function saveReport() {
  const text = JSON.stringify(report, null, 2) + '\n';
  auditWrite = auditWrite.then(() => writeFile(path.join(output, 'report.json'), text, { mode: 0o600 }));
  return auditWrite;
}
async function passed(data = {}) { report.checks[check] = { status: 'passed', ...data }; console.log('Passed ' + check); await saveReport(); }
function begin(name) { check = name; console.log('Checking ' + name); }
function argsForTrace(args, depth = 0) {
  if (depth > 6) return '[bounded]';
  if (typeof args === 'string') return scrub(args);
  if (args == null || typeof args === 'number' || typeof args === 'boolean') return args;
  if (Array.isArray(args)) return args.slice(0, 20).map(value => argsForTrace(value, depth + 1));
  const allowed = ['command', 'args', 'operations', 'commands', 'ids', 'name', 'names', 'id', 'kind', 'type', 'node', 'nodeId', 'objectId', 'instanceIndex', 'port', 'source', 'target', 'inputs', 'parameters', 'r0', 'v', 'frame', 'unit', 'positionUnit', 'velocityUnit', 'options', 'fields', 'time', 'value', 'query', 'family'];
  return Object.fromEntries(Object.entries(args).filter(([key]) => allowed.includes(key)).map(([key, value]) => [key, argsForTrace(value, depth + 1)]));
}
const safeIssue = issue => typeof issue === 'string' ? scrub(issue) : Object.fromEntries(['code', 'path', 'message', 'description', 'action'].filter(key => typeof issue?.[key] === 'string').map(key => [key, scrub(issue[key])]));
function observeNative(createCodexAdapter, workspace) {
  return { id: 'codex', label: 'Codex · local app-server', create(options) {
    const native = createCodexAdapter({ ...options, executable, workspace, protectedRoots: [slots, root] });
    return { ...native,
      connect(handlers) {
        nativeHandlers = handlers;
        return native.connect({ ...handlers, async onTool(call) {
          const request = call.arguments ?? {};
          const entry = { turn, command: scrub(request.command), args: argsForTrace(request.args ?? {}),
            ...(request.expected ? { expectedRevision: request.expected.revision } : {}), idempotent: typeof request.idempotencyKey === 'string' };
          report.tools.push(entry);
          const outcome = await handlers.onTool(call);
          entry.ok = outcome.ok; entry.revision = outcome.identity?.revision ?? outcome.context?.identity?.revision;
          if (outcome.error) {
            entry.error = { code: scrub(outcome.error.code), category: scrub(outcome.error.category), message: scrub(outcome.error.message),
              diagnostics: (outcome.error.diagnostics ?? []).slice(0, 12).map(safeIssue), repairs: (outcome.error.repairs ?? []).slice(0, 10).map(safeIssue) };
          }
          console.log(`Native ${entry.turn}: ${entry.command} ${entry.ok ? 'ok' : entry.error?.code}`); await saveReport();
          return outcome;
        } });
      },
      async startTurn(input) {
        if (turn === 'structural edit') selectedContext = { selection: argsForTrace(input.context.selection), time: input.context.time?.value };
        const result = await native.startTurn(input);
        if (turn === 'stop') cancelledNativeStart.resolve(input.turnId);
        return result;
      },
    };
  } };
}
async function post(route, body) {
  const response = await fetch(app.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}
function graphDelta(before, after) {
  const prev = new Map(before.nodes.map(node => [node.id, node])), next = new Map(after.nodes.map(node => [node.id, node]));
  return { added: [...next.keys()].filter(id => !prev.has(id)), removed: [...prev.keys()].filter(id => !next.has(id)),
    updated: [...next.keys()].filter(id => prev.has(id) && JSON.stringify(prev.get(id)) !== JSON.stringify(next.get(id))) };
}
async function ready() {
  await page.waitForFunction(() => globalThis.cosmicWorkspace?.snapshot?.valid && document.querySelector('#status').textContent.endsWith('ready'), null, { timeout: 60000 });
}
async function sample(count) {
  await page.waitForFunction(expected => {
    const frame = globalThis.cosmicWorkspace?.snapshot;
    return frame?.valid && frame.time.value === 2 && frame.scene.nodes.find(item => item.id === 'pucks-stage')?.positions.length === expected
      && frame.identity.revision === cosmicWorkspace.state.identity.revision;
  }, count, { timeout: 90000 });
  const values = await page.evaluate(() => {
    const w = cosmicWorkspace, frame = w.snapshot;
    const stage = frame.scene.nodes.find(item => item.id === 'pucks-stage'), plot = frame.overlays.find(item => item.id === 'gate-radius-report');
    const positions = w.results.find(item => item.producer.nodeId === 'scan-pucks');
    const mean = w.results.find(item => item.producer.nodeId === 'mean-gate-radius');
    return { revision: frame.identity.revision, time: frame.time.value, objectIds: stage.objectIds, positions: stage.positions,
      scientificPositions: positions.value.data, mean: mean.value.data, plottedMean: plot.data.data, unit: mean.value.unit.symbol,
      resultTimes: [positions.request.time.value, mean.request.time.value], plotSource: plot.source.nodeId };
  });
  assert.deepEqual(values.positions, values.scientificPositions); assert.deepEqual(values.resultTimes, [2, 2]);
  assert.equal(values.plotSource, 'mean-gate-radius'); assert.equal(values.unit, 'm'); near(values.plottedMean, values.mean);
  return values;
}
async function shot(name) {
  // The complete user requests and checked operations are in the sanitized
  // record. Native free-form output need not be copied into shared images.
  await page.screenshot({ path: path.join(output, name + '.png'), mask: [panel.locator('.transcript')], maskColor: '#182135' });
}
async function submit(label, text, wait = true) {
  turn = label; report.prompts.push({ turn, text });
  const messages = app.agentSession.snapshot().messages.filter(message => message.role === 'user').length;
  await panel.getByRole('textbox', { name: /Message draft/ }).fill(text);
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(count => cosmicWorkspace.agent.snapshot().messages.filter(item => item.role === 'user').length > count, messages);
  await saveReport();
  if (!wait) return;
  await page.waitForFunction(() => ['ready', 'failed', 'auth-needed', 'disconnected'].includes(cosmicWorkspace.agent.snapshot().status), null, { timeout: 420000 });
  const state = app.agentSession.snapshot();
  assert.equal(state.status, 'ready', scrub(state.error?.message));
}
try {
  report.versions.codex = scrub(execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim());
  const stage = await stageReadinessWorkspace(path.join(scratch, 'application'));
  assert.equal(stage.audit.authorRecipe, 'experiments/f11-author.mjs');
  stagedRoot = stage.directory;
  const load = relative => import(pathToFileURL(path.join(stagedRoot, relative)));
  const [{ startSceneServer }, { createCodexAdapter }, { buildReadinessManifest }] = await Promise.all([
    load('scripts/scene-server.mjs'), load('src/agent-session/codex.js'), load(stage.audit.authorRecipe),
  ]);
  const manifest = await buildReadinessManifest();
  assert.equal(manifest.graph.id, 'gate-bench');
  report.input = { projectId: manifest.graph.id, sha256: manifest.integrity.sha256, portableGraphHash: manifest.integrity.graphHash, nodeCount: manifest.graph.nodes.length, timelineVersion: manifest.timeline?.version };
  await writeFile(path.join(output, 'input.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  const workspace = await mkdir(path.join(scratch, 'agent-workspace'), { recursive: true });
  app = await startSceneServer({ workspace: true, port: 0, projectDirectory: slots, agentAdapters: [observeNative(createCodexAdapter, await realpath(workspace))] });
  app.agentSession.subscribe((state, event) => {
    if (event?.type !== 'connection') return;
    report.transitions.push({ during: turn ?? 'connect', status: state.status }); console.log('Agent ' + state.status);
  });
  const opened = await post('/api/projects/import', { expected: app.project.token, document: manifest }); assert.equal(opened.ok, true, scrub(opened.error?.message));
  await passed({ recipe: stage.audit.authorRecipe, stagedFiles: stage.files.length, projectId: app.project.token.projectId });
  begin('selection');
  browser = await chromium.launch({ headless: true, ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}),
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.versions.browser = browser.version(); report.graphics = 'WebGL2 / SwiftShader';
  page = await browser.newPage({ viewport: { width: 1600, height: 1040 } }); page.setDefaultTimeout(35000);
  const consoleErrors = [], responses = new Set();
  page.on('pageerror', error => report.browserErrors.push(scrub(error.message)));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ url: message.location().url, text: scrub(message.text()) }); });
  page.on('response', response => {
    if (response.status() < 400) return;
    const read = response.json().then(body => {
      const route = new URL(response.url()).pathname;
      if (route === '/api/workspace/evaluate' && response.status() === 409 && ['STALE_TOKEN', 'STALE_RESULT', 'SUPERSEDED'].includes(body.code)) {
        report.expectedReadCancellations.push({ route, status: 409, code: body.code });
      } else report.browserErrors.push(`${response.status()} ${route}: ${scrub(body.code ?? body.error?.code)}`);
    }).catch(() => report.browserErrors.push('Unclassified unsuccessful browser request.'));
    responses.add(read); read.finally(() => responses.delete(read));
  });
  await page.goto(app.url); await ready();
  await page.locator('#time').fill('2'); await page.locator('#time').dispatchEvent('input');
  const baselineGraph = app.project.snapshot(), baselineToken = app.project.token;
  report.measurements.before = await sample(3); near(report.measurements.before.mean, 2 / 3);
  await page.locator('[data-overlay-id="lane-readout"] circle[data-object-id="puck-mid"]').click();
  assert.deepEqual(await page.evaluate(() => [cosmicWorkspace.state.selection.nodeId, cosmicWorkspace.state.selection.objectId]), ['pucks-stage', 'puck-mid']);
  panel = page.locator('.workspace-panel[data-overlay-id="bench-chat"]');
  await shot('before'); await passed({ selection: 'puck-mid', baselineGraphHash: hash(baselineGraph) });
  begin('connect'); await panel.getByLabel('Agent', { exact: true }).selectOption('codex');
  await panel.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForFunction(() => ['ready', 'failed', 'auth-needed'].includes(cosmicWorkspace.agent.snapshot().status), null, { timeout: 90000 });
  const connected = app.agentSession.snapshot();
  if (connected.status !== 'ready') throw Object.assign(new Error(scrub(connected.error?.message ?? connected.label)), { code: connected.status === 'auth-needed' ? 'AUTH_REQUIRED' : 'AGENT_NOT_READY' });
  await passed({ connectionStatus: connected.status, permissionPolicy: connected.permissionPolicy, capabilities: connected.capabilities });
  begin('structural edit');
  await submit(check, 'At the selected puck and current physical time, make exactly one reversible structural edit. Add a fixture.moving-point named late-puck with r0=[-3,0,0] m and v=[0.5,0,0] m/s. The existing live collection should pick it up. Commit using the installed cosmic_command tool. Leave the scene bindings, plots, other components and panel layouts as authored. Briefly state what changed.');
  const accepted = app.project.snapshot(), delta = graphDelta(baselineGraph, accepted);
  assert.deepEqual(delta, { added: ['late-puck'], removed: [], updated: [] });
  assert.equal(selectedContext.selection.nodeId, 'pucks-stage'); assert.equal(selectedContext.selection.objectId, 'puck-mid'); assert.equal(selectedContext.time, 2);
  report.measurements.accepted = await sample(4); near(report.measurements.accepted.mean, 1);
  assert.deepEqual(report.measurements.accepted.positions[report.measurements.accepted.objectIds.indexOf('late-puck')], [-2, 0, 0]);
  assert.ok(report.tools.some(tool => tool.turn === check && tool.ok && /commit|create:fixture\.moving-point/.test(tool.command)));
  await shot('accepted'); await passed({ selectedContext, graphDelta: delta, acceptedParameters: accepted.nodes.find(node => node.id === 'late-puck').data.parameters, acceptedGraphHash: hash(accepted) });
  begin('stale revision');
  const expired = await post('/api/gateway', { command: 'create:fixture.moving-point', expected: baselineToken, idempotencyKey: 'readiness-expired-before-add', args: { id: 'stale-puck' } });
  assert.equal(expired.error?.code, 'STALE_TOKEN'); assert.deepEqual(app.project.snapshot(), accepted);
  await passed({ source: 'separate local HTTP client', code: expired.error.code, attemptedNode: 'stale-puck', unchangedGraph: true });
  begin('invalid connection');
  await submit(check, 'Run a deliberate negative connection test through the actual cosmic_command transaction.preview tool. The single operation is create:fixture.accumulator with args {id:"bad-rate-integrator",inputs:{source:{node:"puck-mid",port:"position"}}}. Use the current token. We need the real validator diagnostic and a concrete compatible-input repair; please do not correct or commit the preview and do not perform any other edit.');
  const rejected = report.tools.find(tool => tool.turn === check && tool.command === 'transaction.preview' && !tool.ok && tool.error?.code === 'KIND_MISMATCH');
  assert.ok(rejected, 'A real incompatible preview must return KIND_MISMATCH.');
  assert.equal(app.project.token.revision, report.measurements.accepted.revision); assert.deepEqual(app.project.snapshot(), accepted);
  await shot('invalid'); await passed({ code: rejected.error.code, source: 'puck-mid.position', destination: 'bad-rate-integrator.source', checkedRepair: 'Use a timeless scalar accumulation-rate in 1/s.', unchangedGraph: true });
  begin('undo'); await page.locator('#undo').click();
  report.measurements.undo = await sample(3); near(report.measurements.undo.mean, 2 / 3); assert.deepEqual(app.project.snapshot(), baselineGraph);
  await passed({ restoredGraph: true, revision: app.project.token.revision });
  begin('stop');
  const stopToken = app.project.token;
  await submit(check, 'Prepare and add one new fixture.moving-point called stopped-puck. First inspect the current graph as a standalone read and check whether the name exists. Then use a separate tool call to make the edit if it is available. I may stop this turn before the change.', false);
  const retired = await Promise.race([cancelledNativeStart.promise, pause(30000).then(() => { throw new Error('Native turn start did not acknowledge.'); })]);
  assert.equal(app.agentSession.snapshot().status, 'working');
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'ready');
  assert.equal(app.agentSession.snapshot().activeTurn, null); assert.deepEqual(app.project.token, stopToken);
  await shot('stopped'); await passed({ nativeStartAcknowledged: true, requestedWrite: 'stopped-puck', activeTurnCleared: true, revision: stopToken.revision });
  begin('revoked authority');
  const late = await nativeHandlers.onTool({ turnId: retired, callId: 'late-readiness-probe', name: 'cosmic_command',
    arguments: { command: 'create:fixture.moving-point', args: { id: 'stopped-puck' }, expected: stopToken, idempotencyKey: 'readiness-revoked-probe' } });
  assert.equal(late.error?.code, 'TURN_REVOKED'); assert.deepEqual(app.project.token, stopToken); assert.deepEqual(app.project.snapshot(), baselineGraph);
  await passed({ source: 'host explicitly replayed a checked write through the genuine retired adapter callback', code: late.error.code, attemptedNode: 'stopped-puck', revisionUnchanged: true });
  begin('redo'); await page.locator('#redo').click();
  report.measurements.redo = await sample(4); near(report.measurements.redo.mean, 1); assert.deepEqual(app.project.snapshot(), accepted);
  await passed({ sameAcceptedAgentGraph: true, revision: app.project.token.revision });
  begin('private save');
  await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'disconnected');
  await page.locator('#project-toggle').click(); assert.equal(await page.locator('#project-save-transcript').isChecked(), false);
  await page.locator('#project-name').fill('readiness-saved'); await page.locator('#project-save').click();
  await page.waitForFunction(() => document.querySelector('#project-feedback').textContent === 'Saved readiness-saved.', null, { timeout: 90000 });
  const saved = JSON.parse(await readFile(savedPath, 'utf8'));
  assert.deepEqual(saved.graph, accepted); assert.equal(saved.sharing.transcriptIncluded, false); assert.deepEqual(saved.sharing.transcript, []);
  assert.equal(saved.playback.time.value, 2); assert.deepEqual(saved.timeline, manifest.timeline);
  assert.equal(app.portable.status().sourceStatus, 'diverged');
  while (responses.size) await Promise.allSettled([...responses]);
  const reads = [...report.expectedReadCancellations];
  for (const message of consoleErrors) {
    const index = reads.findIndex(issue => message.url.endsWith(issue.route) && message.text.includes('status of 409'));
    if (index >= 0) reads.splice(index, 1); else report.browserErrors.push(message.text);
  }
  assert.deepEqual(report.browserErrors, []);
  await passed({ slot: 'readiness-saved', sha256: saved.integrity.sha256, portableGraphHash: saved.integrity.graphHash, originalRecipe: saved.source.original.path,
    savedRevision: app.project.token.revision, graphHash: hash(saved.graph), sourceStatus: app.portable.status().sourceStatus, transcriptIncluded: false });
  report.status = 'passed';
} catch (error) {
  report.status = ['AUTH_REQUIRED', 'AGENT_NOT_READY'].includes(error.code) ? 'blocked' : 'failed';
  report.checks[check] = { status: report.status, code: scrub(error.code ?? 'ACCEPTANCE'), message: scrub(error.message) };
  process.exitCode = 1; console.error(check, report.status, report.checks[check].message);
} finally {
  await browser?.close(); await app?.close();
  report.completed = new Date().toISOString(); await saveReport();
  await rm(scratch, { recursive: true, force: true });
  console.log('Evidence ' + path.relative(root, output));
}
