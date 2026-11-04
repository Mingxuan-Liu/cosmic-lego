import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startSceneServer } from '../scripts/scene-server.mjs';

async function start(t) {
  const app = await startSceneServer({ workspace: true, port: 0 });
  t.after(() => app.close()); return app;
}
async function post(app, body, route = '/api/gateway', headers = {}) {
  const response = await fetch(app.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const update = (expected, idempotencyKey, projection = 'orthographic') => ({
  command: 'transaction.commit', expected, idempotencyKey,
  args: { operations: [{ command: 'update:scene.camera', args: { id: 'camera', parameters: { projection } } }] },
});

test('HTTP discovery and inspection return the same gateway envelopes as local dispatch', async t => {
  const app = await start(t);
  const direct = await app.gateway.dispatch({ command: 'discover' }, app.gateway.localAuthority);
  const discovery = await fetch(`${app.url}/api/gateway/discovery`);
  assert.equal(discovery.status, 200);
  assert.deepEqual(await discovery.json(), direct);
  const inspected = await post(app, { command: 'inspect' });
  assert.equal(inspected.status, 200); assert.equal(inspected.body.ok, true);
  assert.deepEqual(inspected.body, await app.gateway.dispatch({ command: 'inspect' }, app.gateway.localAuthority));
  assert.deepEqual(inspected.body.result.graph, app.project.snapshot());
  const state = await (await fetch(`${app.url}/api/gateway/state`)).json();
  assert.deepEqual(state, { identity: app.project.token, history: app.project.history, lastChange: null });
});

test('gateway HTTP writes require context and idempotency and never accept caller-minted authority', async t => {
  const app = await start(t), before = app.project.snapshot(), identity = app.project.token;
  for (const request of [
    { ...update(identity, 'missing-context'), expected: undefined },
    { ...update(identity, 'missing-key'), idempotencyKey: undefined },
    { ...update(identity, 'fake-authority'), authority: { projectId: identity.projectId, turn: 'chosen-by-caller' } },
    { ...update(identity, 'fake-turn'), turn: 'chosen-by-caller' },
    { command: 'session.create', args: { permissions: ['*'] } },
    { command: 'run-source', args: { source: 'globalThis.executed=true' } },
    { ...update(identity, 'module-path'), registryModule: 'file:///tmp/untrusted.js' },
  ]) {
    const response = await post(app, request);
    assert.equal(response.body.ok, false, JSON.stringify(response.body));
    assert.ok(response.body.error.code); assert.ok(response.body.error.category);
    assert.ok(Array.isArray(response.body.error.diagnostics)); assert.ok(Array.isArray(response.body.error.repairs));
    assert.deepEqual(app.project.snapshot(), before); assert.deepEqual(app.project.token, identity);
  }
  const legacy = await post(app, { identity, action: 'projection', value: 'orthographic', turn: 'chosen-by-caller' }, '/api/workspace/edit');
  assert.equal(legacy.status, 400); assert.deepEqual(app.project.snapshot(), before);
});

test('HTTP idempotent retry and compatibility retry preserve one accepted mutation and coherent poll state', async t => {
  const app = await start(t), initial = app.project.token, request = update(initial, 'http-projection');
  const first = await post(app, request);
  assert.equal(first.status, 200); assert.equal(first.body.ok, true);
  const committed = app.project.token;
  assert.equal(committed.revision, initial.revision + 1);
  const replay = await post(app, request);
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.deepEqual(replay.body.identity, first.body.identity); assert.deepEqual(app.project.token, committed);
  const conflict = await post(app, update(initial, 'http-projection', 'perspective'));
  assert.equal(conflict.status, 409); assert.equal(conflict.body.ok, false);
  assert.match(conflict.body.error.code, /IDEMPOTENCY/); assert.deepEqual(app.project.token, committed);
  const changed = await (await fetch(`${app.url}/api/gateway/state`)).json();
  assert.deepEqual(changed.identity, committed); assert.equal(changed.history.canUndo, true);
  assert.ok(changed.lastChange.summary.updated.includes('camera'));

  const compatibilityRequest = { identity: committed, action: 'overlay.update', id: 'positions-plot', parameters: { folded: true } };
  const compatibility = await post(app, compatibilityRequest, '/api/workspace/edit');
  assert.equal(compatibility.status, 200, JSON.stringify(compatibility.body));
  assert.equal(compatibility.body.gateway.ok, true);
  const afterCompatibility = app.project.token;
  const directSecond = await post(app, update(afterCompatibility, 'third-write', 'perspective'));
  assert.equal(directSecond.body.ok, true);
  const latest = app.project.token;
  const oldReplay = await post(app, compatibilityRequest, '/api/workspace/edit');
  assert.equal(oldReplay.status, 200); assert.equal(oldReplay.body.replayed, true);
  assert.deepEqual(oldReplay.body.gateway.identity, compatibility.body.gateway.identity);
  assert.deepEqual(oldReplay.body.identity, latest, 'Compatibility graph carries its actual current identity.');
  assert.deepEqual(oldReplay.body.graph, app.project.snapshot()); assert.deepEqual(app.project.token, latest);
});

test('failed gateway batches and legacy edits use the same accepted-state validation boundary', async t => {
  const app = await start(t), before = app.project.snapshot(), identity = app.project.token;
  const invalid = await post(app, { command: 'transaction.commit', expected: identity, idempotencyKey: 'invalid-batch', args: { operations: [
    { command: 'update:scene.camera', args: { id: 'camera', parameters: { projection: 'orthographic' } } },
    { command: 'overlay.create', args: { kind: 'plot', options: { id: 'bad-plot' }, source: 'not-installed' } },
  ] } });
  assert.equal(invalid.body.ok, false); assert.deepEqual(app.project.snapshot(), before); assert.deepEqual(app.project.token, identity);
  const legacy = await post(app, { identity, action: 'overlay.create', kind: 'plot', options: { id: 'bad-plot' }, source: 'not-installed', idempotencyKey: 'legacy-invalid' }, '/api/workspace/edit');
  assert.equal(legacy.body.gateway.ok, false);
  assert.deepEqual(app.project.snapshot(), before); assert.deepEqual(app.project.token, identity);
  const accepted = await post(app, update(identity, 'accepted'));
  const undo = await post(app, { command: 'history.undo', expected: accepted.body.identity, idempotencyKey: 'undo' });
  assert.equal(undo.body.ok, true); assert.deepEqual(app.project.snapshot(), before);
  assert.equal(undo.body.identity.revision, accepted.body.identity.revision + 1);
  const stale = await post(app, update(identity, 'stale-new-key'));
  assert.equal(stale.status, 409); assert.equal(stale.body.ok, false);
});

test('gateway endpoint keeps bounded JSON, content-type and origin failures structured', async t => {
  const app = await start(t), before = app.project.snapshot();
  const wrongType = await fetch(`${app.url}/api/gateway`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(wrongType.status, 415); assert.equal((await wrongType.json()).error.code, 'CONTENT_TYPE');
  const malformed = await fetch(`${app.url}/api/gateway`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, 'REQUEST');
  const oversized = await post(app, { command: 'inspect', args: { text: 'x'.repeat(70000) } });
  assert.equal(oversized.body.ok, false); assert.equal(oversized.body.error.code, 'REQUEST_BUDGET');
  const origin = await post(app, { command: 'inspect' }, '/api/gateway', { Origin: 'https://untrusted.example' });
  assert.equal(origin.status, 403);
  assert.equal(origin.body.ok, false); assert.equal(origin.body.error.category, 'unauthorized');
  assert.deepEqual(app.project.snapshot(), before);
});

test('chunked UTF-8 JSON preserves a Chinese title across a split multibyte character', async t => {
  const app = await start(t), title = '中文标题';
  const payload = Buffer.from(JSON.stringify({ command: 'transaction.commit', expected: app.project.token, idempotencyKey: 'utf8-title',
    args: { operations: [{ command: 'overlay.update', args: { id: 'positions-plot', parameters: { title } } }] } }));
  const split = payload.indexOf(Buffer.from('中')) + 1;
  const result = await new Promise((resolve, reject) => {
    const request = http.request(`${app.url}/api/gateway`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject); request.write(payload.subarray(0, split));
    setTimeout(() => request.end(payload.subarray(split)), 10);
  });
  assert.equal(result.status, 200); assert.equal(result.body.ok, true);
  assert.equal(app.project.snapshot().nodes.find(node => node.id === 'positions-plot').data.parameters.title, title);
  const beforeInvalid = app.project.snapshot();
  const malformed = Buffer.concat([Buffer.from('{"command":"inspect","args":{"label":"'), Buffer.from([0xff]), Buffer.from('"}}')]);
  const rejected = await fetch(`${app.url}/api/gateway`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: malformed });
  assert.equal(rejected.status, 400); assert.equal((await rejected.json()).error.code, 'REQUEST');
  assert.deepEqual(app.project.snapshot(), beforeInvalid);
});
