import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Project } from '../src/core/index.js';
import { value } from '../src/dataflow/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { createSceneLayer, registerSceneExtensions, sceneExtensions } from '../src/scene/index.js';
import { registryExtensions } from '../examples/fixtures/registry-extensions.js';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const triple = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
const port = (kind, units, meaning, options = {}) => ({ kind, shape: kind === 'scalar' ? [] : [3], unit: units, meaning,
  reference: null, frame: null, normalization: null, ...options });
const requestedTime = { value: 2, unit: 's' };

function fixture(id, parameters, outputs, evaluate) {
  return {
    manifest: {
      schemaVersion: 1, apiVersion: 1, id, version: '1.0.0',
      implementation: { id: `${id}.implementation`, version: '1.0.0', build: 'scene-test-1' }, kind: 'model',
      parameters: object(parameters), ports: { inputs: {}, outputs }, dependencies: [], capabilities: ['dataflow.sync'],
      documentation: { summary: 'Independent quantitative scene fixture.', links: [], examples: [{ parameters: {} }] }, diagnostics: [],
      science: { equations: ['Values are explicitly supplied software fixtures.'], references: [{ title: 'Fixture specification', locator: 'test/scene-layer.test.js' }],
        assumptions: ['Software visualization check, not an astronomical model.'], applicability: [], evaluation: { mode: 'analytic', sampling: ['instant'] },
        review: { status: 'experimental', notes: 'Independent software fixture.', evidence: [] } },
    }, implementation: { evaluate },
  };
}

function setup(limits) {
  const registry = new ExtensionRegistry({ capabilities: ['dataflow.sync', 'assets.data', 'views.data', 'scene.data'] });
  for (const extension of registryExtensions) registry.register(extension);
  registerSceneExtensions(registry);
  const calls = { point: 0, scalar: 0, vector: 0 };
  registry.register(fixture('test.scene-point', {
    position: { ...triple, default: [1, 2, 3] }, unit: { type: 'string', enum: ['m', 'km'], default: 'm' }, frame: { type: 'string', default: 'lab' },
  }, { position: port('vector', { $param: 'unit' }, 'position', { reference: { $node: 'id' }, frame: { id: { $param: 'frame' }, kind: 'position' } }) },
  ({ node, request }) => {
    calls.point++;
    return { position: value({ kind: 'vector', data: node.data.parameters.position, unit: node.data.parameters.unit, meaning: 'position', reference: node.id,
      frame: { id: node.data.parameters.frame, kind: 'position' }, time: request.time }) };
  }));
  const coords = [[0, 0, 0], [1, 0, 0], [0, 2, 0]];
  const coordinates = { kind: 'space', unit: 'm', frame: { id: 'lab', kind: 'position' }, values: coords };
  registry.register(fixture('test.scalar-field', { missing: { type: 'boolean', default: false } }, {
    value: port('field', 'K', 'temperature', { shape: [3], coordinates }),
  }, ({ node }) => {
    calls.scalar++;
    return { value: value({ kind: 'field', data: [0, node.data.parameters.missing ? null : 5, 10], unit: 'K', meaning: 'temperature', coordinates,
      metadata: { warnings: [{ code: 'FIXTURE_FIELD', path: '$', message: 'Declared scalar samples, not a physical observation.' }], approximation: [] } }) };
  }));
  registry.register(fixture('test.vector-field', { missing: { type: 'boolean', default: false } }, {
    value: port('field', 'm/s', 'velocity', { shape: [3, 3], frame: { id: 'lab', kind: 'direction' }, coordinates }),
  }, ({ node }) => {
    calls.vector++;
    return { value: value({ kind: 'field', data: [[1, 0, 0], node.data.parameters.missing ? [null, null, null] : [0, 2, 0], [0, 0, -3]],
      unit: 'm/s', meaning: 'velocity', frame: { id: 'lab', kind: 'direction' }, coordinates }) };
  }));
  const binding = registry.bind(), layer = createSceneLayer(binding, limits ? { limits } : {});
  const project = new Project({ validators: layer.validators }), draft = project.begin();
  return { registry, binding, layer, project, draft, author: layer.author(draft), science: binding.author(draft), calls };
}

function basic(limits) {
  const result = setup(limits);
  const group = result.author.group({ id: 'group' });
  const geometry = result.author.geometry({ id: 'geometry', primitive: 'sphere', radius: 0.1 });
  const material = result.author.material({ id: 'material', color: '#ffffff' });
  const mesh = result.author.mesh({ id: 'mesh', parent: group, geometry, material });
  result.author.camera({ id: 'camera', position: [0, 0, 6] });
  return { ...result, group, geometry, material, mesh };
}

function sources(context, time = requestedTime) {
  return context.layer.sources(context.project).map(source => {
    const result = context.binding.evaluate(context.project, source.nodeId, { port: source.port, time });
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    return result;
  });
}

function validScene(snapshot, project) {
  assert.equal(snapshot.valid, true, JSON.stringify(snapshot.diagnostics));
  assert.deepEqual(snapshot.identity, project.token);
  assert.ok(Array.isArray(snapshot.nodes));
  assert.ok(Array.isArray(snapshot.assets));
  assert.ok(Array.isArray(snapshot.bindings));
  return snapshot;
}

function invalidScene(snapshot, code) {
  assert.equal(snapshot.valid, false);
  assert.deepEqual(snapshot.nodes, []);
  assert.deepEqual(snapshot.assets, []);
  assert.ok(snapshot.diagnostics.length > 0);
  if (code) assert.ok(snapshot.diagnostics.some(item => item.code === code), JSON.stringify(snapshot.diagnostics));
}

test('scene authoring composes groups, duplicates, reparents and removes instances with shared assets', async () => {
  const context = basic();
  const { author, draft, group, mesh, layer, project } = context;
  const secondGroup = author.group({ id: 'other-group' });
  const duplicate = author.duplicate(mesh, { id: 'duplicate', parent: secondGroup });
  author.reparent(duplicate, group);
  draft.accept();
  const snapshot = validScene(await layer.compile(project, { time: requestedTime, results: [] }), project);
  const originalNode = snapshot.nodes.find(node => node.id === 'mesh');
  const copy = snapshot.nodes.find(node => node.id === 'duplicate');
  assert.equal(copy.parent, 'group');
  assert.equal(copy.geometry, originalNode.geometry);
  assert.equal(copy.material, originalNode.material);
  assert.equal(snapshot.assets.filter(asset => asset.kind === 'geometry').length, 1);
  const edit = project.begin();
  layer.author(edit).remove('duplicate');
  edit.accept();
  const after = validScene(await layer.compile(project, { time: requestedTime, results: [] }), project);
  assert.ok(after.nodes.some(node => node.id === 'mesh'));
  assert.ok(!after.nodes.some(node => node.id === 'duplicate'));
  assert.equal(after.assets.find(asset => asset.kind === 'geometry').contentId, snapshot.assets.find(asset => asset.kind === 'geometry').contentId);
});

test('compilation consumes supplied snapshots without reevaluating scientific callbacks', async () => {
  const context = basic();
  const point = context.science.instantiate('test.scene-point', { id: 'point' });
  context.author.bind(context.mesh, point, { property: 'position', port: 'position', unit: 'm', frame: 'lab' });
  context.draft.accept();
  const results = sources(context), before = context.calls.point;
  const snapshot = validScene(await context.layer.compile(context.project, { results, time: requestedTime }), context.project);
  assert.equal(context.calls.point, before);
  assert.deepEqual(snapshot.nodes.find(node => node.id === 'mesh').position, [1, 2, 3]);
  assert.deepEqual(context.layer.sources(context.project), [{ nodeId: 'point', port: 'position' }]);
  assert.equal(snapshot.bindings.length, 1);
});

test('binding transformations retain explicit units, frame conversion and display exaggeration', async () => {
  const context = basic();
  const point = context.science.instantiate('test.scene-point', { id: 'point', parameters: { position: [1, 0, 0], unit: 'km' } });
  context.author.bind(context.mesh, point, { property: 'position', port: 'position', unit: 'km', frame: 'lab', displayUnit: 'm', displayFrame: 'rotated',
    rotation: [[0, -1, 0], [1, 0, 0], [0, 0, 1]], translation: [10, 0, 0], translationUnit: 'm', scale: 0.001 });
  context.draft.accept();
  const results = sources(context);
  const original = structuredClone(results[0].value);
  const snapshot = validScene(await context.layer.compile(context.project, { results, time: requestedTime }), context.project);
  assert.deepEqual(snapshot.nodes.find(node => node.id === 'mesh').position, [0.01, 1, 0]);
  assert.deepEqual(results[0].value, original);
  const inspection = JSON.stringify(snapshot.bindings[0]);
  for (const text of ['point', 'km', 'rotated', '0.001']) assert.ok(inspection.includes(text));
});

test('scalar and vector fields map coordinates, colors and arrows without domain-specific code', async () => {
  const context = basic();
  const field = context.science.instantiate('test.scalar-field', { id: 'field' });
  const vectors = context.science.instantiate('test.vector-field', { id: 'vector-field' });
  const samples = context.author.points({ id: 'samples', geometry: context.geometry, material: context.material });
  const arrows = context.author.vectors({ id: 'arrows', material: context.material });
  context.author.bind(samples, field, { property: 'scalar-field', unit: 'K', frame: 'lab', quantity: 'temperature', colorRange: [0, 10], palette: 'grayscale' });
  context.author.bind(arrows, vectors, { property: 'vectors', unit: 'm/s', frame: 'lab', quantity: 'velocity' });
  context.draft.accept();
  const results = sources(context), counts = { ...context.calls };
  const snapshot = validScene(await context.layer.compile(context.project, { results, time: requestedTime }), context.project);
  assert.deepEqual(context.calls, counts);
  const mapped = snapshot.nodes.find(node => node.id === 'samples');
  assert.deepEqual(mapped.positions, [[0, 0, 0], [1, 0, 0], [0, 2, 0]]);
  assert.deepEqual(mapped.colors, [[0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1]]);
  const mappedVectors = snapshot.nodes.find(node => node.id === 'arrows');
  assert.deepEqual(mappedVectors.origins, mapped.positions);
  assert.deepEqual(mappedVectors.directions, [[1, 0, 0], [0, 2, 0], [0, 0, -3]]);
  assert.ok(snapshot.diagnostics.some(item => item.code === 'FIXTURE_FIELD'));
});

test('null field data is diagnosed and never rendered as an invented zero', async () => {
  for (const vector of [false, true]) {
    const context = basic();
    const field = context.science.instantiate(vector ? 'test.vector-field' : 'test.scalar-field', { id: 'field', parameters: { missing: true } });
    const target = vector ? context.author.vectors({ id: 'target', material: context.material })
      : context.author.points({ id: 'target', geometry: context.geometry, material: context.material });
    context.author.bind(target, field, { property: vector ? 'vectors' : 'scalar-field', unit: vector ? 'm/s' : 'K', frame: 'lab',
      quantity: vector ? 'velocity' : 'temperature', ...(vector ? {} : { colorRange: [0, 10] }) });
    context.draft.accept();
    const snapshot = await context.layer.compile(context.project, { results: sources(context), time: requestedTime });
    invalidScene(snapshot, 'MISSING_DATA');
  }
});

test('camera/material edits preserve scientific values while requiring fresh revision-tagged snapshots', async () => {
  const context = basic();
  const point = context.science.instantiate('test.scene-point', { id: 'point' });
  context.author.bind(context.mesh, point, { property: 'position', port: 'position', unit: 'm', frame: 'lab' });
  context.draft.accept();
  const old = sources(context);
  const edit = context.project.begin(), author = context.layer.author(edit);
  author.update('camera', { position: [10, -2, 1], projection: 'orthographic', span: 20 });
  author.update('material', { color: '#ff8800', opacity: 0.5 });
  edit.accept();
  invalidScene(await context.layer.compile(context.project, { results: old, time: requestedTime }));
  const fresh = sources(context);
  assert.deepEqual(fresh[0].value, old[0].value);
  validScene(await context.layer.compile(context.project, { results: fresh, time: requestedTime }), context.project);
});

test('missing, invalid, wrong-port and wrong-time snapshots fail instead of invoking a fallback evaluator', async () => {
  const context = basic();
  const point = context.science.instantiate('test.scene-point', { id: 'point' });
  context.author.bind(context.mesh, point, { property: 'position', port: 'position', unit: 'm', frame: 'lab' });
  context.draft.accept();
  const result = sources(context)[0], before = context.calls.point;
  const wrongPort = structuredClone(result); wrongPort.producer.port = 'missing';
  const invalid = structuredClone(result); invalid.valid = false;
  const wrongTime = structuredClone(result); wrongTime.value.time.value = 99;
  const wrongIdentity = structuredClone(result); wrongIdentity.identity.generation = 'another-load';
  for (const results of [[], [wrongPort], [invalid], [wrongTime], [wrongIdentity]]) {
    invalidScene(await context.layer.compile(context.project, { results, time: requestedTime }));
    assert.equal(context.calls.point, before);
  }
});

test('asset content identity, dependencies and provenance survive a graph round trip', async () => {
  const context = setup();
  const texture = context.author.texture({ id: 'texture', width: 1, height: 1, pixels: [10, 20, 30, 255], source: 'Original test texel', license: 'BSD-3-Clause' });
  const material = context.author.material({ id: 'material', texture, source: 'Original test material', license: 'BSD-3-Clause' });
  const geometry = context.author.geometry({ id: 'geometry', primitive: 'box', source: 'Original test box', license: 'BSD-3-Clause' });
  context.author.mesh({ id: 'mesh', geometry, material });
  context.draft.accept();
  const original = validScene(await context.layer.compile(context.project, { results: [], time: requestedTime }), context.project);
  const reopened = Project.from(JSON.parse(JSON.stringify(context.project.snapshot())), { validators: context.layer.validators });
  const restored = validScene(await context.layer.compile(reopened, { results: [], time: requestedTime }), reopened);
  assert.deepEqual(restored.assets, original.assets);
  assert.deepEqual(restored.nodes, original.nodes);
  for (const asset of restored.assets) {
    assert.match(asset.contentId, /^sha256:/);
    assert.ok(asset.provenance.source);
    assert.equal(asset.provenance.license, 'BSD-3-Clause');
  }
  assert.ok(restored.assets.find(asset => asset.id === 'material').dependencies.includes('texture'));
});

test('scene compilation enforces asset, instance, text and node resource bounds', async () => {
  const context = basic();
  context.author.label({ id: 'label', text: 'Readable label' });
  context.author.points({ id: 'points', positions: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], geometry: context.geometry, material: context.material });
  context.draft.accept();
  for (const limits of [{ maxAssets: 1 }, { maxAssetBytes: 10 }, { maxInstances: 2 }, { maxTextChars: 2 }, { maxNodes: 1 }]) {
    const bounded = createSceneLayer(context.binding, { limits });
    invalidScene(await bounded.compile(context.project, { time: requestedTime, results: [] }));
  }
});

test('unsupported rendering capabilities produce explicit diagnostics', async () => {
  const context = basic();
  context.draft.accept();
  invalidScene(await context.layer.compile(context.project, { results: [], time: requestedTime, capabilities: [] }));
});

test('scene assets cannot store executable shader or factory fields through raw edits', () => {
  const context = basic();
  context.draft.accept();
  const before = context.project.snapshot(), token = context.project.token;
  for (const field of ['shader', 'factorySource', 'module']) {
    const edit = context.project.begin(), node = edit.get('material').value;
    edit.get('material').set({ data: { ...node.data, parameters: { ...node.data.parameters, [field]: 'globalThis.executed = true' } } });
    assert.throws(() => edit.accept());
    assert.deepEqual(context.project.snapshot(), before);
    assert.deepEqual(context.project.token, token);
  }
});

test('duplicating a bound instance retains the mapping and reuses its single scientific source', async () => {
  const context = basic();
  const point = context.science.instantiate('test.scene-point', { id: 'point' });
  context.author.bind(context.mesh, point, { property: 'position', port: 'position', unit: 'm', frame: 'lab' });
  context.author.duplicate(context.mesh, { id: 'copy' });
  context.draft.accept();
  assert.deepEqual(context.layer.sources(context.project), [{ nodeId: 'point', port: 'position' }]);
  const snapshot = validScene(await context.layer.compile(context.project, { results: sources(context), time: requestedTime }), context.project);
  assert.equal(snapshot.bindings.length, 2);
  assert.deepEqual(snapshot.nodes.find(node => node.id === 'copy').position, [1, 2, 3]);
  const edit = context.project.begin();
  context.layer.author(edit).remove('copy', { cascade: true });
  edit.accept();
  const remaining = validScene(await context.layer.compile(context.project, { results: sources(context), time: requestedTime }), context.project);
  assert.equal(remaining.bindings.length, 1);
  assert.ok(remaining.nodes.some(node => node.id === 'mesh'));
  assert.ok(context.project.snapshot().nodes.some(node => node.id === 'point'));
});

test('equal asset content has a stable common hash while keeping independent handles and provenance', async () => {
  const context = basic();
  context.author.geometry({ id: 'same-geometry', primitive: 'sphere', radius: 0.1, source: 'An independently authored copy' });
  context.draft.accept();
  const snapshot = validScene(await context.layer.compile(context.project, { time: requestedTime }), context.project);
  const first = snapshot.assets.find(asset => asset.id === 'geometry'), second = snapshot.assets.find(asset => asset.id === 'same-geometry');
  assert.equal(first.contentId, second.contentId);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.provenance.source, second.provenance.source);
});

test('missing assets, parent cycles and wrong parent kinds fail atomically at graph acceptance', () => {
  const context = basic();
  context.draft.accept();
  const original = context.project.snapshot(), token = context.project.token;
  for (const change of ['missing', 'cycle', 'wrong-kind']) {
    const edit = context.project.begin();
    if (change === 'cycle') {
      const author = context.layer.author(edit), nested = author.group({ id: 'nested', parent: 'group' });
      author.reparent('group', nested);
    } else {
      const handle = edit.get('mesh'), node = handle.value;
      const references = { ...node.references, [change === 'missing' ? 'asset.geometry' : 'asset.parent']: change === 'missing' ? 'not-installed' : 'camera' };
      handle.set({ references, dependsOn: [...new Set(Object.values(references))] });
    }
    assert.throws(() => edit.accept());
    assert.deepEqual(context.project.snapshot(), original);
    assert.deepEqual(context.project.token, token);
  }
});

test('binding contracts reject incompatible units, undeclared frames and conflicting property writers', () => {
  for (const change of ['unit', 'frame', 'reflection', 'color-range', 'duplicate']) {
    const context = basic(), point = context.science.instantiate('test.scene-point', { id: 'point' });
    const options = { property: 'position', port: 'position', unit: 'm', frame: 'lab' };
    if (change === 'unit') options.displayUnit = 's';
    if (change === 'frame') options.frame = 'unrelated';
    if (change === 'reflection') options.rotation = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];
    if (change === 'color-range') options.colorRange = [1, 1];
    context.author.bind(context.mesh, point, options);
    if (change === 'duplicate') context.author.bind(context.mesh, point, options);
    assert.equal(context.draft.validate().valid, false, change);
    assert.throws(() => context.draft.accept());
    assert.deepEqual(context.project.snapshot().nodes, []);
  }
});

test('compilation rejects duplicated or mismatched producer implementations without reevaluation', async () => {
  const context = basic(), point = context.science.instantiate('test.scene-point', { id: 'point' });
  context.author.bind(context.mesh, point, { property: 'position', port: 'position', unit: 'm', frame: 'lab' });
  context.draft.accept();
  const result = sources(context)[0], count = context.calls.point;
  const changed = structuredClone(result); changed.producer.implementation.build = 'a-different-binary';
  invalidScene(await context.layer.compile(context.project, { results: [changed], time: requestedTime }), 'IMPLEMENTATION_MISMATCH');
  invalidScene(await context.layer.compile(context.project, { results: [result, result], time: requestedTime }), 'RESULT_REQUIRED');
  assert.equal(context.calls.point, count);
});

test('a graph edit during asynchronous asset hashing invalidates the whole compiled scene', async () => {
  const context = basic();
  context.draft.accept();
  const pending = context.layer.compile(context.project, { results: [], time: requestedTime });
  const edit = context.project.begin();
  context.layer.author(edit).update('camera', { position: [9, 8, 7] });
  edit.accept();
  invalidScene(await pending, 'STALE_RESULT');
});

test('custom geometry consumes supplied scientific snapshots and exposes input provenance without recomputation', async () => {
  const context = setup();
  const base = sceneExtensions.find(extension => extension.manifest.id === 'scene.geometry');
  const manifest = structuredClone(base.manifest);
  manifest.id = 'test.snapshot-geometry';
  manifest.implementation = { id: 'test.snapshot-geometry.implementation', version: '1.0.0', build: '1' };
  manifest.ports.inputs = { source: port('vector', 'm', 'position', { reference: 'point', frame: { id: 'lab', kind: 'position' } }) };
  context.registry.register({ manifest, implementation: { create({ node, inputs }) {
    const { source, license, ...data } = node.data.parameters;
    return { ...data, radius: inputs.source.data[0], provenance: { source, license } };
  } } });
  const binding = context.registry.bind(), layer = createSceneLayer(binding), project = new Project({ validators: layer.validators });
  const draft = project.begin(), science = binding.author(draft), scene = layer.author(draft);
  const point = science.instantiate('test.scene-point', { id: 'point', parameters: { position: [2, 0, 0] } });
  const geometry = science.instantiate('test.snapshot-geometry', { id: 'geometry', inputs: { source: { node: point, port: 'position' } } });
  const material = scene.material({ id: 'material' });
  scene.mesh({ id: 'mesh', geometry, material });
  draft.accept();
  assert.deepEqual(layer.sources(project), [{ nodeId: 'point', port: 'position' }]);
  const result = binding.evaluate(project, 'point', { port: 'position', time: requestedTime });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  const count = context.calls.point;
  invalidScene(await layer.compile(project, { results: [], time: requestedTime }), 'RESULT_REQUIRED');
  assert.equal(context.calls.point, count);
  const snapshot = validScene(await layer.compile(project, { results: [result], time: requestedTime }), project);
  assert.equal(context.calls.point, count);
  const asset = snapshot.assets.find(asset => asset.id === 'geometry');
  assert.equal(asset.data.radius, 2);
  assert.deepEqual(asset.dependencies, []);
  assert.ok(JSON.stringify(asset.scientificInputs).includes('point'));
  assert.ok(JSON.stringify(asset.scientificInputs).includes('position'));
});

test('field frame transforms move sample origins without adding translation to direction vectors', async () => {
  const context = basic(), field = context.science.instantiate('test.vector-field', { id: 'field' });
  const target = context.author.vectors({ id: 'arrows', material: context.material });
  context.author.bind(target, field, { property: 'vectors', unit: 'm/s', frame: 'lab', displayFrame: 'rotated',
    rotation: [[0, -1, 0], [1, 0, 0], [0, 0, 1]], translation: [10, 0, 0], translationUnit: 'm', scale: 2 });
  context.draft.accept();
  const results = sources(context), original = structuredClone(results[0].value);
  const snapshot = validScene(await context.layer.compile(context.project, { results, time: requestedTime }), context.project);
  const arrows = snapshot.nodes.find(node => node.id === 'arrows');
  assert.deepEqual(arrows.origins, [[20, 0, 0], [20, 2, 0], [16, 0, 0]]);
  assert.deepEqual(arrows.directions, [[0, 2, 0], [-4, 0, 0], [0, 0, -6]]);
  assert.deepEqual(results[0].value, original);
});

test('clipped scalar colors remain visibly diagnosed with the authored physical range', async () => {
  const context = basic(), field = context.science.instantiate('test.scalar-field', { id: 'field' });
  const target = context.author.points({ id: 'samples', geometry: context.geometry, material: context.material });
  context.author.bind(target, field, { property: 'scalar-field', unit: 'K', frame: 'lab', colorRange: [2, 8], palette: 'grayscale' });
  context.draft.accept();
  const snapshot = validScene(await context.layer.compile(context.project, { results: sources(context), time: requestedTime }), context.project);
  assert.deepEqual(snapshot.nodes.find(node => node.id === 'samples').colors, [[0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1]]);
  assert.ok(snapshot.diagnostics.some(item => item.code === 'COLOR_CLIPPED' && item.severity === 'warning'));
  assert.deepEqual(snapshot.bindings[0].colorMeaning.range, [2, 8]);
  assert.equal(snapshot.bindings[0].colorMeaning.clipped, 2);
  assert.equal(snapshot.bindings[0].colorMeaning.quantity, 'temperature');
  assert.equal(snapshot.bindings[0].colorMeaning.unit.symbol, 'K');
});

test('isolated shared layers run a real F04 worker and compile moving collections without domain packages', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'cosmic-scene-isolation-'));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const moving = fixture('test.isolated-point', {
    origin: { ...triple, default: [0, 0, 0] }, velocity: { ...triple, default: [1, 0, 0] },
  }, { position: port('vector', 'm', 'position', { reference: { $node: 'id' }, frame: { id: 'lab', kind: 'position' } }) }, () => {}).manifest;
  try {
    writeFileSync(resolve(directory, 'package.json'), '{"type":"module"}');
    for (const layer of ['core', 'dataflow', 'registry', 'runtime', 'scene']) cpSync(resolve(root, 'src', layer), resolve(directory, 'src', layer), { recursive: true });
    writeFileSync(resolve(directory, 'host.mjs'), `
      import { ExtensionRegistry } from './src/registry/index.js';
      import { registerSceneExtensions } from './src/scene/index.js';
      import { value } from './src/dataflow/index.js';
      export function createRegistry() {
        const registry = new ExtensionRegistry({capabilities:['dataflow.sync','assets.data','views.data','scene.data']});
        registerSceneExtensions(registry);
        registry.register({manifest:${JSON.stringify(moving)}, implementation:{evaluate({node,request}) {
          const t=request.time.value*request.time.unit.scale, p=node.data.parameters;
          return {position:value({kind:'vector',data:p.origin.map((n,i)=>n+p.velocity[i]*t),unit:'m',meaning:'position',reference:node.id,frame:{id:'lab',kind:'position'},time:request.time})};
        }}});
        return registry;
      }
    `);
    writeFileSync(resolve(directory, 'check.mjs'), `
      import assert from 'node:assert/strict';
      import { Project } from './src/core/index.js';
      import { createRuntime } from './src/runtime/index.js';
      import { createSceneLayer } from './src/scene/index.js';
      import { createRegistry } from './host.mjs';
      const binding=createRegistry().bind(), layer=createSceneLayer(binding);
      const project=new Project({validators:layer.validators}), draft=project.begin(), science=binding.author(draft), scene=layer.author(draft);
      const a=science.instantiate('test.isolated-point',{id:'a'});
      const b=science.instantiate('test.isolated-point',{id:'b',parameters:{origin:[0,1,0],velocity:[0,0,2]}});
      const collection=science.select({mode:'fixed',members:[{node:a,port:'position'},{node:b,port:'position'}]},{id:'collection'});
      const geometry=scene.geometry({id:'geometry'}), material=scene.material({id:'material'});
      const points=scene.points({id:'points',geometry,material});
      scene.bind(points,collection,{property:'positions',unit:'m',frame:'lab'});
      draft.accept();
      const runtime=createRuntime({registryModule:new URL('./host.mjs',import.meta.url)});
      try {
        for(const t of [2,4]) {
          const result=await runtime.submit(project,'collection',{time:{value:t,unit:'s'}}).promise;
          assert.equal(result.valid,true,JSON.stringify(result.diagnostics));
          const before=JSON.stringify(result.value);
          const snapshot=await layer.compile(project,{results:[result],time:{value:t,unit:'s'}});
          assert.equal(snapshot.valid,true,JSON.stringify(snapshot.diagnostics));
          const rendered=snapshot.nodes.find(node=>node.id==='points');
          assert.deepEqual(rendered.positions,[[t,0,0],[0,1,2*t]]);
          assert.deepEqual(rendered.objectIds,['a','b']);
          assert.equal(JSON.stringify(result.value),before);
          assert.ok(result.metadata.runtime.jobId);
        }
      } finally { await runtime.dispose(); }
      console.log('isolated moving collection passed');
    `);
    const run = spawnSync(process.execPath, ['check.mjs'], { cwd: directory, encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /isolated moving collection passed/);
    assert.deepEqual(readdirSync(resolve(directory, 'src')).sort(), ['core', 'dataflow', 'registry', 'runtime', 'scene']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('scene shared modules import only lower shared layers and the explicit renderer library', () => {
  const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const folder = resolve(root, 'src/scene');
  for (const name of readdirSync(folder).filter(name => name.endsWith('.js'))) {
    const source = readFileSync(resolve(folder, name), 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (specifier === 'three' || specifier.startsWith('three/')) continue;
      assert.ok(specifier.startsWith('.'), `${name}: unexpected package ${specifier}`);
      const dependency = realpathSync(resolve(folder, specifier));
      assert.ok(['scene', 'core', 'dataflow'].some(layer => dependency.startsWith(resolve(root, 'src', layer) + sep)), `${name}: ${specifier}`);
    }
    assert.doesNotMatch(source, /\bimport\s*\(/, `${name} must not load project-specified modules`);
  }
});
