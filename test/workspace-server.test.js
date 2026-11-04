import test from 'node:test';
import assert from 'node:assert/strict';
import { startSceneServer } from '../scripts/scene-server.mjs';

async function start(t) {
  const app = await startSceneServer({ workspace: true, port: 0 });
  t.after(() => app.close()); return app;
}
async function state(app) {
  const response = await fetch(`${app.url}/api/workspace/state`);
  assert.equal(response.status, 200); return response.json();
}
async function post(app, endpoint, input, headers = {}) {
  const response = await fetch(`${app.url}/api/workspace/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}
async function edit(app, identity, change) {
  const response = await post(app, 'edit', { identity, ...change });
  assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body;
}
async function evaluate(app, identity, seconds = 2) {
  const response = await post(app, 'evaluate', { identity, time: { value: seconds, unit: 's' } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.snapshot.valid, true, JSON.stringify(response.body.snapshot.diagnostics)); return response.body;
}
const parameters = (state, id) => state.graph.nodes.find(node => node.id === id).data.parameters;

test('workspace mode evaluates the shared scene and real collection/derived outputs under one physical time', async t => {
  const app = await start(t), initial = await state(app);
  assert.equal(app.workspace, true);
  assert.deepEqual(initial.history, { canUndo: false, canRedo: false });
  assert.ok(initial.outputs['moving-collection'].value);
  assert.ok(initial.outputs['scalar-field'].value);
  assert.ok(initial.outputs['mean-position-magnitude'].value);
  assert.equal(initial.sources.length, 4);
  const evaluated = await evaluate(app, initial.identity);
  assert.deepEqual(evaluated.identity, initial.identity);
  assert.equal(evaluated.snapshot.scene.valid, true);
  assert.equal(evaluated.snapshot.overlays.length, 5);
  assert.deepEqual(evaluated.snapshot.scene.identity, initial.identity);
  const positions = evaluated.results.find(result => result.producer.nodeId === 'moving-collection');
  const mean = evaluated.results.find(result => result.producer.nodeId === 'mean-position-magnitude');
  const expected = positions.value.data.reduce((sum, row) => sum + Math.hypot(...row), 0) / positions.value.data.length;
  assert.ok(Math.abs(mean.value.data - expected) < 1e-12);
  const plot = evaluated.snapshot.overlays.find(overlay => overlay.id === 'positions-plot');
  assert.equal(plot.source.nodeId, 'moving-collection');
  assert.equal(plot.component, 0);
  assert.deepEqual(plot.data, positions.value);
  assert.deepEqual(plot.data.objectIds, Array.from({ length: 9 }, (_, i) => `point-${i}`));
  assert.equal(evaluated.snapshot.overlays.find(overlay => overlay.id === 'mean-plot').hidden, true);
  for (const result of evaluated.results) {
    assert.equal(result.valid, true); assert.ok(result.metadata.runtime.jobId);
    assert.equal(result.metadata.runtime.achievedTime.value, 2);
    assert.deepEqual(result.identity, initial.identity);
  }
  assert.deepEqual((await state(app)).graph, initial.graph);
});

test('generic operations create, duplicate, rebind and remove an independently bound plot', async t => {
  const app = await start(t), initial = await state(app);
  const created = await edit(app, initial.identity, { action: 'overlay.create', kind: 'plot',
    options: { id: 'independent-plot', title: 'Field samples', x: 60, y: 60, width: 360, height: 240 },
    source: 'scalar-field', binding: { port: 'value' } });
  assert.equal(created.createdId, 'independent-plot');
  assert.equal(created.identity.revision, initial.identity.revision + 1);
  const copied = await edit(app, created.identity, { action: 'overlay.duplicate', id: 'independent-plot',
    options: { id: 'independent-copy', title: 'Second field view', hidden: true } });
  assert.equal(copied.createdId, 'independent-copy');
  const bound = await edit(app, copied.identity, { action: 'overlay.bind', id: 'independent-copy', source: 'moving-collection', options: { component: 2 } });
  const evaluated = await evaluate(app, bound.identity);
  const field = evaluated.snapshot.overlays.find(overlay => overlay.id === 'independent-plot');
  const moving = evaluated.snapshot.overlays.find(overlay => overlay.id === 'independent-copy');
  assert.equal(field.source.nodeId, 'scalar-field');
  assert.equal(field.data.kind, 'field'); assert.equal(field.data.unit.symbol, 'K');
  assert.equal(moving.source.nodeId, 'moving-collection'); assert.equal(moving.component, 2);
  assert.equal(moving.data.kind, 'collection');
  assert.deepEqual(parameters(bound, 'positions-plot'), parameters(initial, 'positions-plot'));
  const removed = await edit(app, bound.identity, { action: 'overlay.remove', id: 'independent-plot' });
  const final = await edit(app, removed.identity, { action: 'overlay.remove', id: 'independent-copy' });
  assert.deepEqual(final.graph, initial.graph);
  assert.deepEqual(final.history, { canUndo: true, canRedo: false });
});

test('layout edits and Undo/Redo use accepted graph revisions without altering scientific definitions', async t => {
  const app = await start(t), initial = await state(app);
  const updated = await edit(app, initial.identity, { action: 'overlay.update', id: 'positions-plot',
    parameters: { x: 140, y: 90, width: 420, height: 290, folded: true, hidden: true } });
  const p = parameters(updated, 'positions-plot');
  assert.equal(p.x, 140); assert.equal(p.y, 90); assert.equal(p.folded, true); assert.equal(p.hidden, true);
  assert.deepEqual(updated.graph.nodes.filter(node => !node.type.startsWith('workspace.')),
    initial.graph.nodes.filter(node => !node.type.startsWith('workspace.')));
  const undone = await edit(app, updated.identity, { action: 'undo' });
  assert.deepEqual(undone.graph, initial.graph);
  assert.equal(undone.identity.revision, updated.identity.revision + 1);
  assert.deepEqual(undone.history, { canUndo: false, canRedo: true });
  const redone = await edit(app, undone.identity, { action: 'redo' });
  assert.deepEqual(redone.graph, updated.graph);
  const back = await edit(app, redone.identity, { action: 'undo' });
  const branch = await edit(app, back.identity, { action: 'overlay.update', id: 'positions-plot', parameters: { title: 'New branch' } });
  assert.equal(branch.history.canRedo, false);
});

test('invalid overlay requests and stale tokens leave the authoritative workspace unchanged', async t => {
  const app = await start(t), initial = await state(app);
  for (const invalid of [
    { action: 'overlay.create', kind: 'script', options: {} },
    { action: 'overlay.create', kind: 'plot', source: 'missing', options: { id: 'bad' } },
    { action: 'overlay.create', kind: 'plot', options: { sourceCode: 'globalThis.bad=true' } },
    { action: 'overlay.create', kind: 'plot', source: 'scalar-field', binding: { module: 'untrusted' } },
    { action: 'overlay.update', id: 'positions-plot', parameters: { width: -5 } },
    { action: 'overlay.update', id: 'positions-plot', parameters: { render: 'source code' } },
    { action: 'overlay.remove', id: 'camera' },
    { action: 'overlay.bind', id: 'inspector', source: 'scalar-field' },
    { action: 'overlay.run-source', value: 'globalThis.bad=true' },
  ]) {
    const response = await post(app, 'edit', { identity: initial.identity, ...invalid });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.deepEqual((await state(app)).graph, initial.graph);
    assert.deepEqual((await state(app)).identity, initial.identity);
  }
  const changed = await edit(app, initial.identity, { action: 'overlay.update', id: 'positions-plot', parameters: { folded: true } });
  const stale = await post(app, 'edit', { identity: initial.identity, action: 'overlay.remove', id: 'positions-plot' });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'STALE_TOKEN');
  assert.deepEqual((await state(app)).identity, changed.identity);
});

test('workspace routes preserve origin, request and static-file boundaries', async t => {
  const app = await start(t), initial = await state(app);
  const crossOrigin = await post(app, 'edit', { identity: initial.identity, action: 'overlay.remove', id: 'positions-plot' }, { Origin: 'https://untrusted.example' });
  assert.equal(crossOrigin.status, 403);
  const oversized = await post(app, 'edit', { identity: initial.identity, action: 'overlay.update', id: 'positions-plot', parameters: { title: 'x'.repeat(70000) } });
  assert.equal(oversized.status, 400); assert.equal(oversized.body.code, 'REQUEST_BUDGET');
  const executable = await post(app, 'evaluate', { identity: initial.identity, registryModule: 'file:///tmp/untrusted.js' });
  assert.equal(executable.status, 400);
  for (const route of ['/api/scene/state', '/src/workspace/index.js', '/examples/fixtures/workspace-registry.js', '/AGENTS.md']) {
    assert.equal((await fetch(`${app.url}${route}`)).status, 404, route);
  }
  assert.equal((await fetch(`${app.url}/src/scene/three-adapter.js`)).status, 200);
  assert.deepEqual((await state(app)).graph, initial.graph);
});

test('a newer workspace time request supersedes the previous worker sequence', async t => {
  const app = await start(t), initial = await state(app);
  const earlier = post(app, 'evaluate', { identity: initial.identity, time: { value: 1, unit: 's' } });
  const later = post(app, 'evaluate', { identity: initial.identity, time: { value: 3, unit: 's' } });
  const responses = await Promise.all([earlier, later]);
  const stale = responses.find(response => response.status === 409), current = responses.find(response => response.status === 200);
  assert.ok(stale, JSON.stringify(responses.map(response => response.status)));
  assert.ok(['STALE_RESULT', 'SUPERSEDED'].includes(stale.body.code));
  assert.ok(current); assert.equal(current.body.snapshot.valid, true, JSON.stringify(current.body.snapshot.diagnostics));
  assert.equal(current.body.time.value, 3);
  assert.ok(current.body.results.every(result => result.metadata.runtime.achievedTime.value === 3));
});
