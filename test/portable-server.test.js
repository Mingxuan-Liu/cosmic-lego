import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSceneServer } from '../scripts/scene-server.mjs';
import { createPortableManifest, portableOptions } from '../src/portable/format.js';

async function fixture(t, extra = {}) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'cosmic-f09-http-'));
  const start = () => startSceneServer({ workspace: true, port: 0, projectDirectory, ...extra });
  const app = await start();
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.close(); } };
  t.after(async () => { await close(); await rm(projectDirectory, { recursive: true, force: true }); });
  return { app, start, close };
}
async function send(app, url, body, headers = {}) {
  const response = await fetch(app.url + url, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function project(app, action, input) {
  const { status, body } = await send(app, `/api/projects/${action}`, input);
  assert.equal(status, 200, JSON.stringify(body.error)); return body.result;
}
async function command(app, request) {
  const result = await send(app, '/api/gateway', request); assert.equal(result.status, 200, JSON.stringify(result.body.error)); return result.body;
}
const time = value => ({ value, unit: 's' });
const edit = (app, title) => command(app, { command: 'overlay.update', expected: app.project.token, idempotencyKey: title, args: { id: 'positions-plot', parameters: { title } } });

test('named save survives a companion restart and reopens the accepted source, layout, inputs, assets and sample', async t => {
  const { app, start, close } = await fixture(t);
  const original = app.project.snapshot();
  const initial = await project(app, 'state'); assert.equal(initial.sourceStatus, 'matches');
  await edit(app, 'Saved plot layout');
  const saved = await project(app, 'save', { name: 'classroom', expectedVersion: null, expected: app.project.token, time: time(2.25) });
  assert.equal(saved.dirty, false); assert.equal(saved.sourceStatus, 'diverged');
  const exported = await project(app, 'export', { expected: app.project.token });
  assert.equal(exported.sharing.transcriptIncluded, false); assert.equal(exported.sharing.receipts[0].command, 'overlay.update');
  assert.equal(exported.dataSources.length, 2); assert.ok(exported.source.original.files.some(file => file.path.endsWith('scene-and-assets.mjs')));
  assert.equal(JSON.parse(exported.resources.find(file => file.path === exported.source.original.producedGraphPath).content).title, original.title);
  const before = (await command(app, { command: 'render', expected: app.project.token })).result;
  const accepted = app.project.snapshot(); await close();
  const second = await start();
  try {
    assert.deepEqual(await project(second, 'list'), [{ name: 'classroom', version: saved.version }]);
    const old = second.project.token;
    const restored = await project(second, 'open', { expected: old, name: 'classroom', expectedVersion: saved.version });
    assert.equal(restored.identity.revision, old.revision); assert.notEqual(restored.identity.generation, old.generation);
    assert.deepEqual(restored.playback.time, time(2.25)); assert.equal(restored.dirty, false);
    assert.deepEqual(second.project.snapshot(), accepted); assert.deepEqual(second.project.history, { canUndo: false, canRedo: false });
    const after = (await command(second, { command: 'render', expected: restored.identity })).result;
    assert.deepEqual(after.snapshot.scene.assets.map(x => x.contentId), before.snapshot.scene.assets.map(x => x.contentId));
    assert.deepEqual(after.results.map(x => x.value), before.results.map(x => x.value));
    assert.equal((await send(second, '/api/gateway', { command: 'render', expected: old })).status, 409);
    assert.equal(second.agentSession.snapshot().status, 'disconnected');
    const reopenedFile = await project(second, 'export', { expected: restored.identity });
    assert.deepEqual(reopenedFile.source, exported.source); assert.deepEqual(reopenedFile.resources, exported.resources);
  } finally { await second.close(); }
});

test('saved run defaults reproduce an unbound seeded accumulator through the ordinary gateway', async t => {
  const { app } = await fixture(t);
  await command(app, { command: 'create:fixture.seeded-accumulator', expected: app.project.token, idempotencyKey: 'seeded-node', args: { id: 'walker', parameters: {} } });
  const settings = { walker: { seed: 12345, step: 0.25, tolerance: 1e-12 } };
  const before = await command(app, { command: 'evaluate', expected: app.project.token, args: { id: 'walker', time: time(2), settings } });
  const saved = await project(app, 'save', { name: 'walk', expectedVersion: null, expected: app.project.token,
    playback: { time: time(2), settings, targets: [{ nodeId: 'walker', port: 'value' }] } });
  const opened = await project(app, 'open', { name: 'walk', expectedVersion: saved.version, expected: app.project.token });
  const after = await command(app, { command: 'evaluate', expected: opened.identity, args: { id: 'walker' } });
  assert.deepEqual(before.result.value, after.result.value); assert.deepEqual(after.result.checkpoints[0].random, before.result.checkpoints[0].random);
  assert.equal(after.result.metadata.runtime.achievedTime.value, 2);
  assert.equal(opened.playback.policy, 'replay-from-initial');
  // A projected stateful target can exceed the model's forward replay
  // limits even when the format, integrity and implementation pins are valid.
  const plan = { ...opened.playback, time: time(-1) };
  const failed = createPortableManifest({ ...app.context, playback: plan });
  const rejected = await send(app, '/api/projects/import', { expected: opened.identity, document: failed });
  assert.equal(rejected.body.error.code, 'TIME_RANGE'); assert.deepEqual(app.project.token, opened.identity);
  assert.equal((await project(app, 'state')).name, 'walk');
});

test('saved run preferences follow the pinned producer through removal, ID reuse and undo', async t => {
  const { app } = await fixture(t);
  const write = (name, args, key) => command(app, { command: name, expected: app.project.token, idempotencyKey: key, args });
  const evaluate = (id, port) => command(app, { command: 'evaluate', expected: app.project.token, args: { id, port } });
  await write('create:fixture.seeded-accumulator', { id: 'walker' }, 'create-walker');
  const request = { name: 'walk', expectedVersion: null, expected: { ...app.project.token },
    playback: { time: time(1), settings: { walker: { seed: 93 } }, targets: [{ nodeId: 'walker', port: 'value' }] } };
  const saving = app.portable.action('save', request);
  request.name = 'other'; request.expected.revision++;
  assert.equal((await saving).name, 'walk');
  const initial = (await evaluate('walker', 'value')).result;
  const external = app.portable.playback;
  external.settings.walker.seed = 4; external.targets.length = 0; external.time.value = 20;
  assert.equal(app.portable.playback.settings.walker.seed, 93);
  assert.equal(app.portable.playback.time.value, 1); assert.equal(app.portable.playback.targets.length, 1);

  await write('remove', { id: 'walker' }, 'remove-walker');
  assert.deepEqual(request.expected, app.project.token);
  assert.equal(app.portable.status().dirty, true);
  assert.deepEqual(app.portable.playback.settings, {}); assert.deepEqual(app.portable.playback.targets, []);
  const unrelated = await command(app, { command: 'render', expected: app.project.token });
  assert.ok(unrelated.result.results.some(result => result.producer.nodeId === 'point-0' || result.value?.objectIds?.includes('point-0')));
  await write('create:fixture.moving-point', { id: 'walker' }, 'reuse-walker');
  assert.deepEqual(app.portable.playback.settings, {});
  assert.equal((await evaluate('walker', 'position')).result.valid, true);
  await write('history.undo', {}, 'undo-reuse');
  await write('history.undo', {}, 'undo-remove');
  assert.equal(app.portable.playback.settings.walker.seed, 93);
  const restored = (await evaluate('walker', 'value')).result;
  assert.deepEqual(restored.value, initial.value);
  assert.deepEqual(restored.checkpoints[0].random, initial.checkpoints[0].random);
  await assert.rejects(app.portable.action('other', {}), { code: 'PROJECT_REQUEST' });
});

test('dataset credits follow the original scientific definition when a field ID is reused or restored', async t => {
  const { app } = await fixture(t);
  const write = (name, args, key) => command(app, { command: name, expected: app.project.token, idempotencyKey: key, args });
  const replacement = app.project.get('scalar-field').value.data.value;
  replacement.data[0] += 10;
  await write('remove', { id: 'scalar-field', cascade: true }, 'remove-field');
  await write('dataflow.constant', { id: 'scalar-field', value: replacement }, 'new-field');
  const replaced = await project(app, 'export', { expected: app.project.token });
  assert.deepEqual(replaced.dataSources.map(record => record.nodeId), ['vector-field']);
  await write('history.undo', {}, 'undo-new-field');
  await write('history.undo', {}, 'undo-remove-field');
  const restored = await project(app, 'export', { expected: app.project.token });
  assert.deepEqual(restored.dataSources.map(record => record.nodeId), ['scalar-field', 'vector-field']);
});

test('file validation preserves accepted work and live agent authority; successful import revokes old tools', async t => {
  let callbacks, turn;
  const adapter = { id: 'test', label: 'Test only', create: () => ({
    async connect(next) { callbacks = next; return { providerSessionId: 'provider-private', capabilities: { tools: true } }; },
    async startTurn(input) { turn = input.turnId; }, async cancel() {}, async respond() {}, async disconnect() {},
  }) };
  const { app } = await fixture(t, { agentAdapters: [adapter] });
  await app.agentSession.connect({ agentId: 'test' }); await app.agentSession.submit({ text: 'Inspect the project' });
  await callbacks.onEvent({ type: 'message', turnId: turn, id: 'foreign/id with spaces', text: 'Public explanation' });
  const expected = app.project.token;
  const omitted = await project(app, 'export', { expected }); assert.deepEqual(omitted.sharing.transcript, []);
  const shared = await project(app, 'export', { expected, includeTranscript: true }); assert.equal(shared.sharing.transcript.length, 2);
  assert.equal(JSON.stringify(shared).includes('provider-private'), false);
  const opts = portableOptions(shared);
  const source = { ...opts.source, text: 'throw new Error("ordinary loading executed author code")' };
  const valid = createPortableManifest({ ...app.context, ...opts, source });
  const bad = structuredClone(valid); bad.version = 998;
  const response = await send(app, '/api/projects/import', { expected, document: bad });
  assert.equal(response.body.ok, false); assert.deepEqual(app.project.token, expected);
  assert.equal(app.agentSession.snapshot().activeTurn.id, turn);
  assert.equal((await callbacks.onTool({ turnId: turn, callId: 'allowed', name: 'cosmic_command', arguments: { command: 'inspect', args: { id: 'camera' } } })).ok, true);
  const opened = await project(app, 'import', { expected, document: valid });
  assert.notEqual(opened.identity.generation, expected.generation); assert.equal(opened.name, null);
  const archived = app.agentSession.snapshot(); assert.equal(archived.status, 'disconnected'); assert.equal(archived.sessionId, null); assert.equal(archived.providerSessionId, null);
  assert.equal(archived.messages.at(-1).text, 'Public explanation'); assert.equal(archived.activeTurn, null);
  const late = await callbacks.onTool({ turnId: turn, callId: 'late', name: 'cosmic_command', arguments: { command: 'remove', expected: opened.identity, idempotencyKey: 'late', args: { id: 'positions-plot' } } });
  assert.equal(late.ok, false); assert.equal(late.error.code, 'TURN_REVOKED');
  const redacted = await project(app, 'export', { expected: opened.identity }); assert.equal(redacted.sharing.transcript.length, 0);
});

test('stale save cannot replace a named file or clear unsaved edits, and file routes enforce local input bounds', async t => {
  const { app } = await fixture(t);
  const first = await project(app, 'save', { expected: app.project.token, name: 'lesson', expectedVersion: null });
  await edit(app, 'First unsaved edit');
  const request = app.portable.action('save', { expected: app.project.token, name: 'lesson', expectedVersion: first.version });
  const rejection = assert.rejects(request, { code: 'STALE_TOKEN' });
  await app.gateway.dispatch({ command: 'overlay.update', args: { id: 'positions-plot', parameters: { title: 'Newer edit' } }, expected: app.project.token, idempotencyKey: 'during-save' }, app.gateway.localAuthority);
  await rejection; assert.equal((await project(app, 'state')).dirty, true);
  assert.deepEqual(await project(app, 'list'), [{ name: 'lesson', version: first.version }]);
  assert.equal((await send(app, '/api/projects/import', { expected: app.project.token, document: {} }, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await send(app, '/api/projects/save', { name: '../x', expected: app.project.token, expectedVersion: null })).body.ok, false);
  assert.equal((await send(app, '/api/projects/open', { name: 'lesson', expected: app.project.token, module: './injected.js' })).body.ok, false);
  assert.equal((await send(app, '/api/projects/save', { input: 'x'.repeat(66000) })).status, 429);
  assert.equal((await fetch(app.url + '/.local/projects/lesson.json')).status, 404);
});
