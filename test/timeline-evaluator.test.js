import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { value } from '../src/dataflow/index.js';
import { createWorkspaceLayer } from '../src/workspace/index.js';
import { createPortableManifest, openPortableManifest } from '../src/portable/format.js';
import { createTimeline, editTimeline, sampleTracks, validateTimeline } from '../src/timeline/definition.js';
import { compileTimelineConfigurations } from '../src/timeline/configurations.js';
import { createTimelineEvaluator } from '../src/timeline/evaluator.js';
import { createRegistry } from '../examples/fixtures/workspace-registry.js';

const registryModule = new URL('../examples/fixtures/workspace-registry.js', import.meta.url);
const keys = (...pairs) => pairs.map(([at, value]) => ({ at, value }));
const op = (command, args) => ({ command, args });
function host() {
  const registry = createRegistry(), binding = registry.bind(), layer = createWorkspaceLayer(binding);
  const project = new Project({ id: 'timeline-test', validators: layer.validators });
  const draft = project.begin(), flow = binding.author(draft), scene = layer.scene.author(draft);
  scene.camera({ id: 'camera', position: [0, 0, 8], target: [0, 0, 0] });
  scene.label({ id: 'label', text: 'baseline' });
  const geo = scene.geometry({ id: 'dot' }), paint = scene.material({ id: 'color' });
  const field = flow.constant(value({ kind: 'field', data: [10, 12], coordinates: { kind: 'space', frame: { id: 'lab', kind: 'position' }, unit: 'm', values: [[0, 0, 0], [1, 0, 0]] },
    unit: 'K', meaning: 'temperature' }), { id: 'field' });
  const points = scene.points({ id: 'samples', geometry: geo, material: paint });
  scene.bind(points, field, { id: 'field-binding', property: 'scalar-field', unit: 'K', frame: 'lab', colorRange: [10, 12], palette: 'blue-gold' });
  flow.instantiate('fixture.seeded-accumulator', { id: 'noise' });
  layer.author(draft).inspector({ id: 'panel' });
  assert.equal(draft.preview().validation.valid, true, JSON.stringify(draft.preview().validation));
  draft.accept();
  return { project, registry, binding, layer };
}
function sequence() {
  const t = createTimeline({ id: 'timeline', title: 'Isolated configurations', duration: 2 });
  t.track({ id: 'clock', kind: 'physical-time', keys: keys([0, 0], [1, 0.5], [1.5, 0.5], [2, 1]) });
  t.track({ id: 'view', kind: 'camera', target: 'camera', keys: keys([0, { position: [0, 0, 8], target: [0, 0, 0] }], [2, { position: [2, 0, 4], target: [1, 0, 0] }]) });
  t.track({ id: 'caption', kind: 'annotation', keys: keys([0, ''], [1, 'Compare configurations']) });
  t.track({ id: 'mask', kind: 'visibility', target: 'label', keys: keys([0, true], [1, false]) });
  t.track({ id: 'focus', kind: 'emphasis', target: 'panel', keys: keys([0, false], [1, true]) });
  t.boundary({ id: 'group', at: 1, label: 'Alternative grouping', operations: [
    op('create:scene.group', { id: 'alternative', assets: { parent: 'scene-root' } }),
  ] });
  t.boundary({ id: 'attach', at: 1, label: 'Group samples', operations: [op('scene.reparent', { id: 'samples', parent: 'alternative' })] });
  return t;
}
const capture = (context, timeline) => createPortableManifest({ ...context, timeline: timeline.snapshot(), playback: {
  targets: [{ nodeId: 'noise', port: 'value' }], settings: { noise: { seed: 132 } },
} });
const errorCode = code => error => error.code === code;
test('timeline commands and handles isolate mutations and preserve stable IDs, valid keys and former snapshots', () => {
  const t = createTimeline({ duration: 4 }), input = { id: 'safe', kind: 'annotation', keys: keys([0, 'First']) };
  const handle = t.track(input), original = t.snapshot();
  input.keys[0].value = 'External edit';
  assert.equal(handle.value.keys[0].value, 'First'); assert.ok(Object.isFrozen(original.data.tracks[0]));
  assert.throws(() => handle.set({ keys: keys([1, 'Missing initial key']) }), errorCode('TIMELINE_SCHEMA'));
  const reloaded = editTimeline(t.snapshot());
  reloaded.apply(op('timeline.track.set', { ...handle.value, keys: keys([0, 'Second']) }));
  assert.equal(handle.value.keys[0].value, 'First');
  handle.remove(); t.track(input);
  assert.throws(() => handle.remove(), errorCode('STALE_HANDLE'));
  assert.equal(original.data.tracks[0].keys[0].value, 'First');
  assert.throws(() => t.apply(op('eval', { source: 'throw' })), errorCode('TIMELINE_COMMAND'));
  const invalid = structuredClone(original); invalid.data.tracks[0].keys.push({ at: 0, value: 'Duplicate timestamp' });
  assert.equal(validateTimeline(invalid).valid, false);
  let getter = false;
  assert.equal(validateTimeline({ get version() { getter = true; } }).valid, false); assert.equal(getter, false);
  assert.equal(validateTimeline({ version: 1, data: new Array(100000) }).valid, false);
});
test('sampling is piecewise linear for physical and camera time and right-continuous for discrete presentation tracks', () => {
  const definition = sequence().snapshot();
  const sample = t => Object.fromEntries(sampleTracks(definition, t).map(track => [track.id, track.value]));
  assert.equal(sample(0.2).clock, 0.1); assert.equal(sample(1.25).clock, 0.5); assert.equal(sample(2).clock, 1);
  assert.deepEqual(sample(1).view.position, [1, 0, 6]);
  assert.equal(sample(1 - 1e-10).mask, true); assert.equal(sample(1).mask, false);
  assert.throws(() => sample(-1), errorCode('TIMELINE_TIME'));
  assert.throws(() => sample(NaN), errorCode('TIMELINE_TIME'));
});
test('boundary compilation uses isolated F01 acceptance, rejects implicit topology and honors authored order at equal times', () => {
  const context = host(), original = context.project.snapshot(), token = context.project.token, history = context.project.history;
  const timeline = sequence(), run = t => compileTimelineConfigurations({ ...context, definition: t.snapshot() });
  const phases = run(timeline);
  assert.deepEqual(phases, run(timeline)); assert.deepEqual(phases.map(p => p.id), ['group', 'attach']);
  assert.equal(phases[1].graph.nodes.find(n => n.id === 'samples').references['asset.parent'], 'alternative');
  const reversed = structuredClone(timeline.snapshot()); reversed.data.boundaries.reverse();
  assert.throws(() => run(editTimeline(reversed)));
  const invalid = createTimeline({ duration: 1 });
  invalid.boundary({ id: 'auto', at: 0, label: 'Missing explicit ID', operations: [op('create:fixture.moving-point', {})] });
  assert.throws(() => run(invalid), errorCode('TIMELINE_IMPLICIT_ID'));
  const missing = createTimeline({ duration: 1 });
  missing.track({ id: 'wrong', kind: 'visibility', target: 'noise', keys: keys([0, true]) });
  assert.throws(() => run(missing), errorCode('TIMELINE_TARGET'));
  assert.deepEqual(context.project.snapshot(), original); assert.deepEqual(context.project.token, token); assert.deepEqual(context.project.history, history);
});
test('seeking across a stateful pause and simultaneous topology changes reproduces values and presentation without author commits', async () => {
  const context = host(), manifest = capture(context, sequence()), token = context.project.token, history = context.project.history;
  assert.deepEqual(openPortableManifest(manifest, context).manifest.timeline.configurations.map(c => c.id), ['group', 'attach']);
  const selectedModule = new URL(registryModule.href);
  const evaluator = await createTimelineEvaluator({ ...context, manifest, registryModule: selectedModule });
  selectedModule.pathname = '/unavailable/module-after-capture.js';
  try {
    const left = await evaluator.evaluate(0.5), boundary = await evaluator.evaluate(1);
    assert.equal(left.configuration.boundaries.length, 0);
    assert.deepEqual(boundary.configuration.boundaries.map(c => c.id), ['group', 'attach']);
    assert.equal(boundary.cameraId, 'camera'); assert.equal(boundary.annotations[0].text, 'Compare configurations');
    assert.equal(boundary.snapshot.scene.nodes.find(n => n.id === 'label').visible, false);
    assert.equal(boundary.snapshot.overlays.find(o => o.id === 'panel').emphasized, true);
    assert.equal(boundary.snapshot.scene.nodes.find(n => n.id === 'samples').parent, 'alternative');
    const find = (frame, id) => frame.results.find(r => r.producer.nodeId === id);
    assert.ok(find(boundary, 'noise').metadata.runtime.components.some(c => c.random?.algorithm === 'lcg32'));
    const laterInPause = await evaluator.evaluate(1.5);
    assert.deepEqual(boundary.physicalTime, laterInPause.physicalTime);
    assert.notDeepEqual(boundary.snapshot.scene.nodes.find(n => n.id === 'camera').position, laterInPause.snapshot.scene.nodes.find(n => n.id === 'camera').position);
    for (const id of ['field', 'noise']) assert.deepEqual(find(boundary, id).value, find(laterInPause, id).value);
    const fieldNode = frame => frame.snapshot.scene.nodes.find(n => n.id === 'samples');
    assert.deepEqual(fieldNode(boundary).colors, fieldNode(laterInPause).colors);
    assert.deepEqual(fieldNode(boundary).positions, [[0, 0, 0], [1, 0, 0]]);
    await evaluator.evaluate(2);
    const again = await evaluator.evaluate(0.5);
    assert.deepEqual(find(left, 'noise').value, find(again, 'noise').value);
    assert.deepEqual(find(left, 'noise').checkpoints[0].random, find(again, 'noise').checkpoints[0].random);
    assert.deepEqual(left.configuration, again.configuration);
    assert.deepEqual(context.project.token, token); assert.deepEqual(context.project.history, history);
    const edit = context.project.begin(); context.layer.author(edit).update('panel', { title: 'Later edit' }); edit.accept();
    const captured = await evaluator.evaluate(1);
    assert.deepEqual(captured.configuration, boundary.configuration);
    assert.deepEqual(find(captured, 'noise').value, find(boundary, 'noise').value);
    assert.notEqual(captured.snapshot.overlays[0].title, 'Later edit');
  } finally { await evaluator.dispose(); }
  await assert.rejects(evaluator.evaluate(0), errorCode('TIMELINE_DISPOSED'));
});
test('a newer seek and disposal invalidate pending frames on the captured evaluator only', async () => {
  const context = host(), evaluator = await createTimelineEvaluator({ ...context, manifest: capture(context, sequence()), registryModule });
  const old = assert.rejects(evaluator.evaluate(0.4), errorCode('SUPERSEDED'));
  const next = assert.rejects(evaluator.evaluate(1), errorCode('TIMELINE_DISPOSED'));
  await old;
  await evaluator.dispose(); await next;
  assert.equal(context.project.token.revision, 1);
});

test('portable validation rejects removed/reused saved producers, semantic output drift and an unsupported path in a later configuration', () => {
  const context = host(), draft = context.project.begin();
  const flow = context.binding.author(draft), overlays = context.layer.author(draft);
  const scalar = unit => ({ kind: 'scalar', data: 1, unit, meaning: 'reference-quantity' });
  flow.constant(value(scalar('m')), { id: 'reference' });
  overlays.bind(overlays.plot({ id: 'new-plot' }), 'reference'); draft.accept();
  function captureBoundary(operations, playback) {
    const t = createTimeline({ duration: 2 });
    t.boundary({ id: 'variant', at: 1, label: 'Alternative configuration', operations });
    return createPortableManifest({ ...context, playback, timeline: t.snapshot() });
  }
  const playback = { targets: [{ nodeId: 'noise', port: 'value' }] };
  assert.throws(() => captureBoundary([op('remove', { id: 'noise' }), op('create:fixture.seeded-accumulator', { id: 'noise' })], playback),
    errorCode('TIMELINE_SOURCE'));
  const selected = { targets: [{ nodeId: 'reference', port: 'value' }] };
  assert.throws(() => captureBoundary([op('dataflow.set-value', { id: 'reference', value: scalar('s') }),
    op('overlay.bind', { target: 'new-plot', source: 'reference' })], selected), errorCode('TIMELINE_SOURCE'));
  assert.throws(() => captureBoundary([op('overlay.bind', { target: 'new-plot', source: 'noise' })], { ...selected, mode: 'analytic' }),
    errorCode('CAPABILITY_UNSUPPORTED'));
});
test('camera motion uses world-space coordinates under transformed groups and rejects intersecting eye/target paths', async () => {
  const timeline = sequence(), invalid = createTimeline({ duration: 2 });
  const eye = z => ({ position: [0, 0, z], target: [0, 0, 0] });
  assert.throws(() => invalid.track({ id: 'cam', kind: 'camera', target: 'camera', keys: keys([0, eye(0)]) }), errorCode('TIMELINE_CAMERA'));
  assert.throws(() => invalid.track({ id: 'cam', kind: 'camera', target: 'camera', keys: keys([0, eye(1)], [2, eye(-2)]) }), errorCode('TIMELINE_CAMERA'));
  const context = host(), draft = context.project.begin(), scene = context.layer.scene.author(draft);
  const parent = scene.group({ id: 'camera-parent', position: [1, 2, 3], rotation: [0, 0, Math.PI / 2], scale: [2, 3, 1] });
  scene.reparent('camera', parent); draft.accept();
  const evaluator = await createTimelineEvaluator({ ...context, registryModule, manifest: capture(context, timeline) });
  try {
    const frame = await evaluator.evaluate(0), camera = frame.snapshot.scene.nodes.find(n => n.id === 'camera');
    assert.equal(camera.parent, 'camera-parent'); assert.deepEqual(camera.target, [0, 0, 0]);
    for (const [i, v] of [-1, 1 / 3, 5].entries()) assert.ok(Math.abs(camera.position[i] - v) < 1e-12);
  } finally { await evaluator.dispose(); }
});

test('gateway-created plot boundaries replay with explicit plot and binding IDs', () => {
  const context = host();
  function compile(binding) {
    const timeline = createTimeline({ duration: 1 });
    timeline.boundary({ id: 'show-field', at: 0, label: 'Show field samples', operations: [
      op('overlay.create', { kind: 'plot', options: { id: 'field-plot' }, source: 'field', binding }),
      op('overlay.bind', { target: 'field-plot', source: 'field', options: { port: 'value' } }),
    ] });
    return compileTimelineConfigurations({ ...context, definition: timeline.snapshot() });
  }
  const phases = compile({ id: 'field-source' });
  assert.deepEqual(compile({ id: 'field-source' }), phases);
  const edge = phases[0].graph.nodes.find(n => n.id === 'field-source');
  assert.deepEqual(edge.references, { source: 'field', target: 'field-plot' });
  assert.throws(() => compile({}), errorCode('TIMELINE_IMPLICIT_ID'));
});
