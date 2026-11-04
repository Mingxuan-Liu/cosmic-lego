import test from 'node:test';
import assert from 'node:assert/strict';
import { startSceneServer } from '../scripts/scene-server.mjs';

async function request(app, route, input, headers = {}) {
  const response = await fetch(app.url + '/api/agent/' + route, input === undefined ? { headers } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}
async function fixture(t) {
  let callbacks, turn, disconnected = 0, cancelled = 0;
  const app = await startSceneServer({ workspace: true, port: 0, agentAdapters: [{ id: 'mock', label: 'Test adapter', create: () => ({
    async connect(handlers) { callbacks = handlers; return { providerSessionId: 'provider-session', capabilities: { tools: true, streaming: true, cancellation: true } }; },
    async startTurn(input) { turn = input; }, async cancel() { cancelled++; }, async respond() {}, async disconnect() { disconnected++; },
  }) }] });
  t.after(() => app.close());
  return { app, get callbacks() { return callbacks; }, get turn() { return turn; }, get cancelled() { return cancelled; }, get disconnected() { return disconnected; } };
}
const update = (expected, key) => ({ command: 'transaction.commit', expected, idempotencyKey: key,
  args: { operations: [{ command: 'overlay.update', args: { id: 'positions-plot', parameters: { title: 'Updated by the agent' } } }] } });

test('companion routes expose only configured agents and reject paths, credentials, cross-origin actions and oversized input', async t => {
  const { app } = await fixture(t), initial = app.project.token;
  const state = await request(app, 'state'); assert.equal(state.status, 200);
  assert.equal(state.body.result.status, 'disconnected'); assert.deepEqual(state.body.result.agents, [{ id: 'mock', label: 'Test adapter' }]);
  for (const body of [
    { agentId: 'mock', executable: '/untrusted/runtime' }, { agentId: 'mock', token: 'untrusted-value' },
    { agentId: 'mock', workspace: '/' }, { agentId: 'mock', permissionPolicy: 'unrestricted' }, { agentId: 'missing' },
  ]) assert.equal((await request(app, 'connect', body)).body.ok, false);
  assert.equal((await request(app, 'connect', { agentId: 'mock' }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request(app, 'connect', { agentId: 'mock' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request(app, 'submit', { text: 'x'.repeat(70000) })).status, 429);
  for (const route of ['events?after=-1', 'events?after=0&after=1', 'events?key=1', 'state?key=1']) assert.equal((await request(app, route)).body.ok, false);
  assert.equal((await request(app, 'connect')).status, 405);
  assert.equal((await request(app, 'stop', { authority: 'caller' })).body.ok, false);
  assert.deepEqual(app.project.token, initial);
  for (const file of ['/src/agent-session/codex.js', '/src/agent-session/config.js', '/.local/f08-qa/report.json']) assert.equal((await fetch(app.url + file)).status, 404);
});

test('HTTP sessions stream public messages, report accepted gateway edits and stop revokes callback authority', async t => {
  const f = await fixture(t), { app } = f;
  const connected = (await request(app, 'connect', { agentId: 'mock' })).body.result;
  assert.equal(connected.status, 'ready'); const { sessionId } = connected;
  const initial = app.project.token;
  const submitted = await request(app, 'submit', { sessionId, text: 'Update the plot', clientRequestId: 'submit-once' });
  assert.equal(submitted.body.result.accepted, true); const turnId = submitted.body.result.turnId;
  assert.deepEqual(f.turn.context.identity, initial);
  assert.ok(f.turn.context.capabilities.length > 0);
  await f.callbacks.onEvent({ type: 'delta', turnId, eventId: 'public-1', id: 'response', text: 'Updating the plot.' });
  const call = { turnId, callId: 'write-once', name: 'cosmic_command', arguments: update(initial, 'accepted-once') };
  const changed = await f.callbacks.onTool(call); assert.equal(changed.ok, true);
  const replay = await f.callbacks.onTool(call); assert.deepEqual(replay, changed);
  const state = await (await fetch(app.url + '/api/gateway/state')).json();
  assert.equal(state.identity.revision, initial.revision + 1); assert.equal(state.history.canUndo, true);
  assert.ok(state.lastChange.summary.updated.includes('positions-plot'));
  const events = (await request(app, 'events?after=0')).body.result.events;
  assert.equal(events.filter(event => event.type === 'change').length, 1);
  assert.ok(events.some(event => event.type === 'delta' && event.text === 'Updating the plot.'));
  assert.equal((await request(app, 'stop', { sessionId, turnId })).body.result.activeTurn, null); assert.equal(f.cancelled, 1);
  const late = await f.callbacks.onTool({ ...call, callId: 'late', arguments: update(app.project.token, 'late') });
  assert.equal(late.ok, false); assert.equal(late.error.code, 'TURN_REVOKED');
  assert.equal(app.project.token.revision, initial.revision + 1);
  await request(app, 'disconnect', {}); assert.equal(f.disconnected, 1);
  const disconnected = (await request(app, 'state')).body.result;
  assert.equal(disconnected.status, 'disconnected'); assert.equal(disconnected.messages.at(-1).text, 'Updating the plot.');
});

test('reordered browser submissions and Stops never launch cancelled work or cancel a newer turn/session', async t => {
  const f = await fixture(t), { app } = f;
  const connect = async () => (await request(app, 'connect', { agentId: 'mock' })).body.result.sessionId;
  const submit = (sessionId, clientRequestId) => request(app, 'submit', { sessionId, clientRequestId, text: 'Inspect the project' });
  const first = await connect();
  assert.equal((await request(app, 'stop', {})).status, 400);
  assert.equal((await request(app, 'submit', { text: 'Missing session', clientRequestId: 'unscoped' })).status, 400);
  assert.equal((await request(app, 'stop', { sessionId: first, clientRequestId: 'delayed' })).body.result.status, 'ready');
  assert.equal((await submit(first, 'delayed')).body.error.code, 'TURN_REVOKED'); assert.equal(f.turn, undefined);
  const old = (await submit(first, 'old')).body.result.turnId;
  await request(app, 'stop', { sessionId: first, turnId: old });
  const current = (await submit(first, 'current')).body.result.turnId;
  assert.equal((await request(app, 'stop', { sessionId: first, turnId: old })).body.result.activeTurn.id, current);
  const next = await connect(); assert.notEqual(first, next);
  const latest = (await submit(next, 'latest')).body.result.turnId;
  assert.equal((await submit(first, 'old-submit')).body.error.code, 'STALE_SESSION');
  assert.equal((await request(app, 'stop', { sessionId: first, clientRequestId: 'latest' })).body.error.code, 'STALE_SESSION');
  assert.equal((await request(app, 'state')).body.result.activeTurn.id, latest);
});

test('unconfigured workspace remains offline and the scene-only server does not expose agent sessions', async t => {
  const workspace = await startSceneServer({ workspace: true, port: 0 }); t.after(() => workspace.close());
  const offline = (await request(workspace, 'state')).body.result;
  assert.deepEqual(offline.agents, []); assert.equal(offline.status, 'disconnected');
  assert.equal((await request(workspace, 'connect', { agentId: 'codex' })).body.ok, false);
  const scene = await startSceneServer({ port: 0 }); t.after(() => scene.close());
  assert.equal((await request(scene, 'state')).status, 404);
  assert.equal((await fetch(scene.url + '/api/scene/state')).status, 200);
});

test('native runtime configuration requires an explicit executable and a separate authoring directory', async () => {
  await assert.rejects(startSceneServer({ workspace: true, port: 0, agentWorkspace: '/tmp' }), { code: 'SERVER_CONFIG' });
  await assert.rejects(startSceneServer({ workspace: true, port: 0, codexExecutable: 'codex' }), { code: 'SERVER_CONFIG' });
  await assert.rejects(startSceneServer({ workspace: true, port: 0, codexExecutable: '/bin/true', agentWorkspace: '/' }), { code: 'SERVER_CONFIG' });
});
