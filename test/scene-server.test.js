import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startSceneServer } from '../scripts/scene-server.mjs';

async function start(t) {
  const app = await startSceneServer({ port: 0 });
  t.after(() => app.close());
  return app;
}
async function state(app) {
  const response = await fetch(`${app.url}/api/scene/state`);
  assert.equal(response.status, 200);
  return response.json();
}
async function post(app, endpoint, input, headers = {}) {
  const response = await fetch(`${app.url}/api/scene/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}
async function evaluate(app, identity, time = { value: 2, unit: 's' }) {
  const response = await post(app, 'evaluate', { identity, time });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.snapshot.valid, true, JSON.stringify(response.body.snapshot.diagnostics));
  return response.body;
}

test('scene server returns the authoritative graph and real worker snapshots for an explicit physical time', async t => {
  const app = await start(t), initial = await state(app);
  assert.deepEqual(initial.identity, app.project.token);
  assert.equal(initial.graph.schemaVersion, 1);
  assert.equal(initial.discovery.apiVersion, 1);
  assert.equal(initial.sources.length, 3);
  const response = await evaluate(app, initial.identity);
  assert.deepEqual(response.identity, initial.identity);
  assert.deepEqual(response.snapshot.identity, initial.identity);
  assert.equal(response.results.length, initial.sources.length);
  for (const result of response.results) {
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.identity, initial.identity);
    assert.ok(result.metadata.runtime.jobId);
  }
  const motion = response.results.find(result => result.producer.nodeId === 'moving-collection');
  assert.deepEqual(response.snapshot.nodes.find(node => node.id === 'moving-points').positions, motion.value.data);
  assert.deepEqual(motion.value.objectIds, Array.from({ length: 9 }, (_, i) => `point-${i}`));
  assert.ok(Math.abs(motion.value.data[0][0] - (-3.5 + 0.14 * 2)) < 1e-12);
  assert.deepEqual((await state(app)).graph, initial.graph);
  assert.deepEqual((await state(app)).identity, initial.identity);
});

test('server duplicate and remove preserve shared assets and return revision-tagged accepted graphs', async t => {
  const app = await start(t), before = await state(app);
  const duplicated = await post(app, 'edit', { identity: before.identity, action: 'duplicate', id: 'moving-points' });
  assert.equal(duplicated.status, 200, JSON.stringify(duplicated.body));
  assert.equal(duplicated.body.identity.revision, before.identity.revision + 1);
  const priorIds = new Set(before.graph.nodes.map(node => node.id));
  const added = duplicated.body.graph.nodes.filter(node => !priorIds.has(node.id));
  const instance = added.find(node => node.type === 'scene.points');
  assert.ok(instance);
  assert.equal(added.length, 2, 'One drawable and its copied mapping are created.');
  const original = before.graph.nodes.find(node => node.id === 'moving-points');
  assert.equal(instance.references['asset.geometry'], original.references['asset.geometry']);
  assert.equal(instance.references['asset.material'], original.references['asset.material']);
  const rendered = await evaluate(app, duplicated.body.identity);
  assert.equal(rendered.results.length, before.sources.length);
  assert.deepEqual(rendered.snapshot.nodes.find(node => node.id === instance.id).positions,
    rendered.snapshot.nodes.find(node => node.id === 'moving-points').positions);
  const removed = await post(app, 'edit', { identity: duplicated.body.identity, action: 'remove', id: instance.id });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.identity.revision, duplicated.body.identity.revision + 1);
  assert.deepEqual(removed.body.graph, before.graph);
});

test('projection and marker-size edits change presentation while preserving all scientific numerical values', async t => {
  const app = await start(t), initial = await state(app);
  const before = await evaluate(app, initial.identity);
  const projection = await post(app, 'edit', { identity: initial.identity, action: 'projection', value: 'orthographic' });
  assert.equal(projection.status, 200);
  const marker = await post(app, 'edit', { identity: projection.body.identity, action: 'marker-scale', value: 0.2 });
  assert.equal(marker.status, 200);
  const after = await evaluate(app, marker.body.identity);
  assert.deepEqual(after.results.map(result => result.value), before.results.map(result => result.value));
  assert.equal(after.snapshot.nodes.find(node => node.id === 'camera').projection, 'orthographic');
  assert.equal(after.snapshot.assets.find(asset => asset.id === 'shared-sphere').data.radius, 0.2);
  const stale = await post(app, 'evaluate', { identity: initial.identity, time: { value: 2, unit: 's' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'STALE_TOKEN');
});

test('invalid edits and untrusted execution fields never change the authoritative project', async t => {
  const app = await start(t), before = await state(app);
  for (const edit of [
    { action: 'marker-scale', value: 999 }, { action: 'projection', value: 'unknown' },
    { action: 'remove', id: 'camera' }, { action: 'remove', id: 'missing' },
    { action: 'evaluate-source', value: 'globalThis.executed = true' },
    { action: 'projection', value: 'orthographic', module: 'file:///untrusted.mjs' },
  ]) {
    const response = await post(app, 'edit', { identity: before.identity, ...edit });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.ok(response.body.code);
    assert.deepEqual((await state(app)).graph, before.graph);
    assert.deepEqual((await state(app)).identity, before.identity);
  }
  const execution = await post(app, 'evaluate', { identity: before.identity, time: { value: 0, unit: 's' }, registryModule: 'file:///untrusted.mjs' });
  assert.equal(execution.status, 400);
  const capabilities = await post(app, 'evaluate', { identity: before.identity, time: { value: 0, unit: 's' }, capabilities: [] });
  assert.equal(capabilities.status, 400);
  assert.equal(capabilities.body.gateway.ok, false);
  assert.equal(capabilities.body.code, 'RENDER_CAPABILITY');
  assert.equal(capabilities.body.category, 'unavailable-capability');
  assert.deepEqual((await state(app)).graph, before.graph);
});

test('server enforces loopback host, same origin, bounded JSON and static-file allowlists', async t => {
  const app = await start(t), before = await state(app);
  const origin = await post(app, 'edit', { identity: before.identity, action: 'projection', value: 'orthographic' }, { Origin: 'https://untrusted.example' });
  assert.equal(origin.status, 403);
  assert.equal(origin.body.code, 'ORIGIN');
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.get(`${app.url}/api/scene/state`, { headers: { Host: 'untrusted.example' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  assert.equal(wrongHost, 403);
  const text = await fetch(`${app.url}/api/scene/edit`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(text.status, 415);
  const malformed = await fetch(`${app.url}/api/scene/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const oversized = await post(app, 'edit', { identity: before.identity, action: 'projection', value: 'x'.repeat(70000) });
  assert.equal(oversized.status, 400);
  assert.equal(oversized.body.code, 'REQUEST_BUDGET');
  for (const route of ['/src/core/index.js', '/AGENTS.md', '/docs/handoffs/F04.md', '/package.json', '/%2e%2e/AGENTS.md']) {
    const denied = await fetch(`${app.url}${route}`);
    assert.equal(denied.status, 404, route);
  }
  const adapter = await fetch(`${app.url}/src/scene/three-adapter.js`);
  assert.equal(adapter.status, 200);
  assert.match(adapter.headers.get('content-type'), /javascript/);
  assert.equal(adapter.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(adapter.headers.get('content-security-policy'));
  assert.deepEqual((await state(app)).graph, before.graph);
  assert.deepEqual((await state(app)).identity, before.identity);
});

test('scene host refuses non-loopback configuration before opening a listener', async () => {
  for (const options of [{ host: '0.0.0.0', port: 0 }, { host: 'example.org', port: 0 }, { port: -1 }, { port: 70000 }]) {
    await assert.rejects(startSceneServer(options), { code: 'SERVER_CONFIG' });
  }
});

test('scene host starts with a clean loaded baseline and Undo restores the first user edit', async t => {
  const app = await start(t), baseline = await state(app);
  assert.deepEqual(baseline.history, { canUndo: false, canRedo: false });
  const changed = await post(app, 'edit', { identity: baseline.identity, action: 'projection', value: 'orthographic', idempotencyKey: 'first-user-edit' });
  assert.equal(changed.status, 200); assert.equal(changed.body.history.canUndo, true);
  const restored = await post(app, 'edit', { identity: changed.body.identity, action: 'undo', idempotencyKey: 'undo-first-user-edit' });
  assert.equal(restored.status, 200); assert.deepEqual(restored.body.graph, baseline.graph);
  assert.deepEqual(restored.body.history, { canUndo: false, canRedo: true });
  assert.equal(restored.body.identity.revision, changed.body.identity.revision + 1);
});
