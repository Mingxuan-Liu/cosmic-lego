import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { value } from '../src/dataflow/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { createSceneLayer, registerSceneExtensions } from '../src/scene/index.js';

function setup() {
  const registry = registerSceneExtensions(new ExtensionRegistry({ capabilities: ['scene.data'] }));
  const binding = registry.bind(), layer = createSceneLayer(binding), project = new Project({ validators: layer.validators });
  const draft = project.begin(), author = layer.author(draft), scientific = binding.author(draft);
  const geometry = author.geometry(), material = author.material();
  const target = author.points({ id: 'points', geometry, material });
  const input = value({ kind: 'field', data: [0, 1], unit: 'K', meaning: 'temperature',
    coordinates: { kind: 'space', unit: 'm', frame: { id: 'lab', kind: 'position' }, values: [[0, 0, 0], [1, 0, 0]] } });
  const source = scientific.constant(input, { id: 'field' });
  author.bind(target, source, { id: 'field-colors', property: 'scalar-field', unit: 'K', quantity: 'temperature', palette: 'grayscale' });
  draft.accept();
  const result = binding.evaluate(project, 'field', { time: { value: 0, unit: 's' } });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  return { registry, binding, layer, project, result };
}
const rejected = (result, code) => {
  assert.equal(result.valid, false, 'Invalid input must not become a valid presentation snapshot.');
  assert.ok(result.diagnostics.some(error => error.code === code), JSON.stringify(result.diagnostics));
};

test('supplied scientific values must satisfy the installed producer as well as the visual receiver', async () => {
  const { layer, project, result } = setup();
  const altered = structuredClone(result);
  altered.value = value({ ...altered.value, data: [0], shape: [1],
    coordinates: { ...altered.value.coordinates, values: [[99, 0, 0]] } });
  const snapshot = await layer.compile(project, { results: [altered] });
  rejected(snapshot, 'SHAPE_MISMATCH');
});

test('scene compilation captures detached result and time data before asynchronous asset resolution', async () => {
  const { layer, project, result } = setup();
  const time = { value: 0, unit: 's' }, supplied = [structuredClone(result)];
  const pending = layer.compile(project, { results: supplied, time });
  supplied[0].value.data = [1, 0];
  supplied[0].value.metadata.approximation.push('Mutation after submission');
  time.value = 7;
  const snapshot = await pending;
  assert.equal(snapshot.valid, true, JSON.stringify(snapshot.diagnostics));
  assert.equal(snapshot.time.value, 0);
  assert.deepEqual(snapshot.nodes.find(node => node.id === 'points').colors, [[0, 0, 0], [1, 1, 1]]);
  assert.ok(!snapshot.bindings[0].approximation.includes('Mutation after submission'));
});

test('overflowing requested physical time cannot accept a finite scientific snapshot', async () => {
  const { layer, binding, project, result } = setup();
  const time = { value: Number.MAX_VALUE, unit: 'h' };
  rejected(await layer.compile(project, { results: [result], time }), 'INVALID_TIME');
  rejected(binding.produce(project, 'field-colors', { results: [result], time }), 'INVALID_TIME');
});

test('color ranges with an overflowing width do not silently map the midpoint to an endpoint', () => {
  const { layer, project } = setup(), draft = project.begin();
  const node = draft.get('field-colors').value;
  draft.get('field-colors').set({ data: { ...node.data, parameters: { ...node.data.parameters, colorRange: [-Number.MAX_VALUE, Number.MAX_VALUE] } } });
  const checked = draft.validate();
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some(error => error.code === 'COLOR_RANGE'), JSON.stringify(checked.errors));
});

test('a descriptor without scientific data is not a supplied Value for generic visual factories', () => {
  const registry = new ExtensionRegistry();
  const scalar = { kind: 'scalar', shape: [], unit: '1', meaning: 'software-value', reference: null, frame: null, normalization: null };
  registry.register({
    manifest: { schemaVersion: 1, apiVersion: 1, id: 'edge.descriptor-view', version: '1.0.0',
      implementation: { id: 'edge.descriptor-view.implementation', version: '1.0.0', build: 'edge-1' }, kind: 'view-adapter',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      ports: { inputs: { input: scalar }, outputs: {} }, dependencies: [], capabilities: [],
      documentation: { summary: 'A software factory that consumes context but does not inspect numeric data.', links: [], examples: [{ parameters: {} }] }, diagnostics: [],
      artifact: { kind: 'view', format: 'edge.test', provenance: { source: 'Original software test', license: 'BSD-3-Clause' },
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } } },
    implementation: { create: () => ({ ok: true }) },
  });
  const binding = registry.bind(), project = new Project({ validators: binding.validators }), draft = project.begin(), author = binding.author(draft);
  const source = author.constant(value({ ...scalar, data: 2 }), { id: 'source' });
  author.instantiate('edge.descriptor-view', { id: 'view', inputs: { input: source } });
  draft.accept();
  const result = binding.evaluate(project, 'source');
  delete result.value.data;
  const produced = binding.produce(project, 'view', { results: [result] });
  assert.equal(produced.valid, false, 'A port descriptor alone is not a scientific result.');
});

test('bindings cannot leave authored per-instance colors misaligned with replaced positions', async () => {
  const { layer, binding, project } = setup(), draft = project.begin(), author = layer.author(draft);
  draft.remove('field-colors');
  author.update('points', { positions: [[0, 0, 0], [1, 0, 0]], colors: [[1, 0, 0], [0, 1, 0]] });
  const source = binding.author(draft).constant(value({ kind: 'collection', data: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], unit: 'm', meaning: 'position',
    frame: { id: 'lab', kind: 'position' }, objectIds: ['a', 'b', 'c'] }), { id: 'positions' });
  author.bind('points', source, { property: 'positions', unit: 'm' });
  draft.accept();
  const result = binding.evaluate(project, 'positions');
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  const snapshot = await layer.compile(project, { results: [result] });
  assert.equal(snapshot.valid, false, 'A compiled valid scene must keep per-instance arrays aligned.');
  assert.ok(snapshot.diagnostics.length);
});
