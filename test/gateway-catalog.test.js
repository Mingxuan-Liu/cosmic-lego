import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Project } from '../src/core/index.js';
import { createWorkspaceLayer } from '../src/workspace/index.js';
import { createCommandCatalog, COMMAND_LIMITS } from '../src/gateway/commands.js';
import { createRegistry } from '../examples/fixtures/workspace-registry.js';

function setup() {
  const registry = createRegistry(), binding = registry.bind(), layer = createWorkspaceLayer(binding);
  const catalog = createCommandCatalog({ registry, binding, layer }), project = new Project({ validators: layer.validators }), draft = project.begin();
  const apply = (command, args = {}) => catalog.apply(draft, { command, args });
  return { registry, binding, layer, catalog, project, draft, apply };
}
const scalar = (data, unit = 'm') => ({ kind: 'scalar', data, unit, meaning: 'length' });
const definition = (context, id) => context.catalog.discover().extensions.find(item => item.manifest.id === id).manifest;

test('catalog discovery derives each installed create schema, defaults and contracts from the immutable binding', () => {
  const { catalog, binding } = setup(), discovery = catalog.discover();
  assert.equal(discovery.apiVersion, 1);
  assert.match(discovery.schemaDialect, /2020-12/);
  for (const { manifest } of [...binding.computations, ...binding.visuals]) {
    const create = discovery.commands.find(item => item.name === `create:${manifest.id}`);
    assert.ok(create);
    assert.deepEqual(create.inputSchema.properties.parameters, manifest.parameters);
    assert.deepEqual(create.ports, manifest.ports);
    assert.deepEqual(create.capabilities, manifest.capabilities);
    assert.equal(create.inputSchema.required.includes('inputs'), Object.keys(manifest.ports.inputs).length > 0);
    assert.equal(create.inputSchema.required.includes('assets'), Object.keys(manifest.assets ?? {}).length > 0);
    assert.deepEqual(create.extension.implementation, manifest.implementation);
    assert.deepEqual(create.requirements, manifest.dependencies);
    assert.ok(create.outputSchema.properties.id);
    assert.ok(create.examples.length);
    const update = discovery.commands.find(item => item.name === `update:${manifest.id}`);
    assert.deepEqual(update.inputSchema.properties.parameters.required, []);
    for (const property of Object.values(update.inputSchema.properties.parameters.properties)) assert.equal(Object.hasOwn(property, 'default'), false);
  }
  discovery.commands[0].name = 'corrupted'; discovery.extensions.length = 0;
  assert.notEqual(catalog.discover().commands[0].name, 'corrupted');
  assert.ok(catalog.discover().extensions.length);
  assert.equal(catalog.discover().commands.find(item => item.name === 'remove').defaults.cascade, false);
  assert.doesNotMatch(JSON.stringify(catalog.discover()), /"evaluate"\s*:\s*function|"create"\s*:\s*function/);
});

test('discovery alone identifies a model and constructs points, calculations, scene instances and a linked overlay', async () => {
  const context = setup(), { catalog, apply, draft, project, binding, layer } = context;
  const entries = catalog.discover().extensions.map(entry => entry.manifest);
  const moving = entries.find(manifest => manifest.kind === 'model' && manifest.ports.outputs.position?.kind === 'vector' && manifest.ports.outputs.position.meaning === 'position');
  const scene = kind => entries.find(manifest => manifest.artifact?.format === 'cosmic.scene.node.v1' && manifest.artifact.schema.properties.kind.enum.includes(kind)
    && (kind !== 'group' || !Object.keys(manifest.assets).length));
  const geometry = entries.find(manifest => manifest.artifact?.kind === 'geometry' && manifest.artifact.format === 'cosmic.geometry.v1');
  const material = entries.find(manifest => manifest.artifact?.kind === 'material' && !Object.keys(manifest.assets).length);
  const plot = entries.find(manifest => manifest.artifact?.format === 'cosmic.workspace.overlay.v1' && manifest.artifact.schema.properties.kind.enum.includes('plot'));
  assert.ok(moving && geometry && material && plot);
  const first = apply(`create:${moving.id}`, { id: 'a', parameters: { r0: [0, 0, 0] } });
  const second = apply(`create:${moving.id}`, { id: 'b', parameters: { r0: [0, 3, 0] } });
  const collection = apply('dataflow.select', { id: 'collection', spec: { mode: 'fixed', members: [{ node: first.id, port: 'position' }, { node: second.id, port: 'position' }] } });
  const magnitudes = apply('dataflow.map', { id: 'magnitudes', op: 'magnitude', source: collection.id });
  const mean = apply('dataflow.reduce', { id: 'mean', op: 'mean', source: magnitudes.id });
  apply(`create:${scene('group').id}`, { id: 'root' });
  apply(`create:${geometry.id}`, { id: 'geometry' }); apply(`create:${material.id}`, { id: 'material' });
  apply(`create:${scene('points').id}`, { id: 'points', assets: { parent: 'root', geometry: 'geometry', material: 'material' } });
  apply('scene.bind', { target: 'points', source: collection.id, options: { property: 'positions', unit: 'm', frame: 'lab' } });
  apply(`create:${plot.id}`, { id: 'plot' }); apply('overlay.bind', { target: 'plot', source: mean.id });
  assert.deepEqual(project.snapshot().nodes, [], 'Catalogue operations stage rather than accept.');
  draft.accept();
  const time = { value: 0, unit: 's' }, results = layer.sources(project).map(source => binding.evaluate(project, source.nodeId, { port: source.port, time }));
  assert.ok(results.every(result => result.valid), JSON.stringify(results.map(result => result.diagnostics)));
  const snapshot = await layer.compile(project, { results, time });
  assert.equal(snapshot.valid, true, JSON.stringify(snapshot.diagnostics));
  assert.deepEqual(snapshot.scene.nodes.find(node => node.id === 'points').positions, [[0, 0, 0], [0, 3, 0]]);
  assert.equal(snapshot.overlays.find(view => view.id === 'plot').data.data, 1.5);
});

test('create applies declared defaults while updates preserve omitted parameters and exact pins', () => {
  const context = setup();
  context.apply('create:fixture.moving-point', { id: 'point', parameters: { r0: [4, 5, 6], v: [2, 0, 0], frame: 'custom' } });
  const original = context.draft.get('point').value;
  context.apply('update:fixture.moving-point', { id: 'point', parameters: { r0: [1, 2, 3] } });
  const updated = context.draft.get('point').value;
  assert.deepEqual(updated.data.parameters.v, [2, 0, 0]); assert.equal(updated.data.parameters.frame, 'custom');
  assert.deepEqual(updated.data.extension, original.data.extension);
  assert.equal(updated.type, original.type); assert.equal(updated.kind, original.kind);
  assert.throws(() => context.apply('update:fixture.moving-point', { id: 'point', parameters: {}, kind: 'calculation' }), { code: 'COMMAND_ARGUMENT' });
  assert.deepEqual(context.draft.get('point').value, updated);
});

test('registered update rewires canonical scientific and asset references without stale dependencies', () => {
  const context = setup();
  context.apply('dataflow.constant', { id: 'left', value: scalar(2) }); context.apply('dataflow.constant', { id: 'right', value: scalar(3) });
  context.apply('create:fixture.scale-length', { id: 'scaled', inputs: { source: 'left' } });
  context.apply('update:fixture.scale-length', { id: 'scaled', inputs: { source: { node: 'right' } }, parameters: { factor: 4 } });
  const operation = context.draft.get('scaled').value;
  assert.deepEqual(operation.references, { 'input.source': 'right' }); assert.deepEqual(operation.dependsOn, ['right']);
  assert.deepEqual(operation.data.inputs, { source: { port: 'value' } });
  context.apply('create:scene.root', { id: 'root' });
  for (const id of ['old', 'new']) context.apply('create:scene.geometry', { id });
  context.apply('create:scene.material', { id: 'material' });
  context.apply('create:scene.mesh', { id: 'mesh', assets: { parent: 'root', geometry: 'old', material: 'material' } });
  context.apply('update:scene.mesh', { id: 'mesh', assets: { geometry: 'new' } });
  assert.ok(!context.draft.get('mesh').value.dependsOn.includes('old'));
  assert.equal(context.draft.get('mesh').value.references['asset.geometry'], 'new');
  context.draft.accept();
  assert.equal(context.binding.evaluate(context.project, 'scaled').value.data, 12);
});

test('declared slots and parameter constraints reject unknown fields and malformed values before mutation', () => {
  const context = setup(), empty = context.draft.snapshot();
  for (const args of [
    { id: 'a', parameters: { unknown: 1 } }, { id: 'a', parameters: null }, { id: 'a', inputs: null },
    { id: 'a', assets: null }, { id: 'a', inputs: { unknown: 'x' } }, { id: 'a', parameters: { r0: [1, 2] } },
    { id: 'a', parameters: { unit: 's' } }, { id: 'bad id' },
  ]) {
    assert.throws(() => context.apply('create:fixture.moving-point', args), { code: 'COMMAND_ARGUMENT' });
    assert.deepEqual(context.draft.snapshot(), empty);
  }
  assert.throws(() => context.apply('create:fixture.scale-length', { id: 'op' }), { code: 'COMMAND_ARGUMENT' });
  assert.throws(() => context.apply('create:scene.mesh', { id: 'mesh' }), { code: 'COMMAND_ARGUMENT' });
});

test('catalogue structures remain separate from scientific applicability and port acceptance', () => {
  const context = setup();
  context.apply('create:fixture.moving-point', { id: 'fast', parameters: { v: [200, 0, 0] } });
  assert.equal(context.draft.validate().valid, false);
  assert.throws(() => context.draft.accept()); assert.deepEqual(context.project.snapshot().nodes, []);
  const other = setup();
  other.apply('dataflow.constant', { id: 'time', value: scalar(2, 's') });
  other.apply('create:fixture.scale-length', { id: 'length', inputs: { source: 'time' } });
  const checked = other.draft.validate();
  assert.equal(checked.valid, false); assert.ok(checked.errors.some(error => error.code === 'UNIT_MISMATCH'));
  assert.throws(() => other.draft.accept()); assert.deepEqual(other.project.snapshot().nodes, []);
});

test('F02 commands retain arithmetic, live/fixed collections, field selections and constant edits', () => {
  const context = setup();
  context.apply('dataflow.constant', { id: 'a', value: scalar(2) });
  context.apply('dataflow.constant', { id: 'b', value: scalar(300, 'cm') });
  context.apply('dataflow.arithmetic', { id: 'sum', op: 'add', left: 'a', right: { node: 'b' } });
  context.apply('dataflow.select', { id: 'collection', spec: { mode: 'fixed', members: ['a', 'b'] } });
  context.apply('dataflow.constant', { id: 'field', value: { kind: 'field', data: [4, 9], unit: 'K', meaning: 'temperature',
    coordinates: { kind: 'space', unit: 'm', frame: { id: 'lab', kind: 'position' }, values: [[0, 0, 0], [1, 0, 0]] } } });
  context.apply('dataflow.field', { id: 'first', source: 'field', indices: [0] });
  context.apply('dataflow.reduce', { id: 'mean', op: 'mean', source: 'collection' });
  context.apply('dataflow.set-value', { id: 'a', value: scalar(4) });
  context.draft.accept();
  assert.equal(context.binding.evaluate(context.project, 'sum').value.data, 7);
  assert.equal(context.binding.evaluate(context.project, 'mean').value.data, 3.5);
  assert.deepEqual(context.binding.evaluate(context.project, 'first').value.data, [4]);
  const live = setup();
  live.apply('create:fixture.moving-point', { id: 'a' });
  live.apply('dataflow.select', { id: 'live', spec: { mode: 'live', type: 'fixture.moving-point', port: 'position' } });
  live.apply('create:fixture.moving-point', { id: 'b' }); live.draft.accept();
  assert.deepEqual(live.binding.evaluate(live.project, 'live').value.objectIds, ['a', 'b']);
});

test('overlay creation, rebinding, duplication, arrangement and removal use generic public handles', () => {
  const context = setup();
  context.apply('dataflow.constant', { id: 'first', value: scalar(1) }); context.apply('dataflow.constant', { id: 'second', value: scalar(2) });
  context.apply('overlay.create', { kind: 'plot', options: { id: 'plot', title: 'First view' }, source: 'first' });
  context.apply('overlay.bind', { target: 'plot', source: 'second' });
  const copy = context.apply('overlay.duplicate', { id: 'plot', options: { id: 'copy', title: 'Second view', x: 75 } });
  assert.equal(copy.id, 'copy');
  context.apply('overlay.update', { id: 'copy', parameters: { folded: true, width: 500 } });
  const copied = context.draft.get('copy').value;
  assert.equal(copied.data.parameters.title, 'Second view'); assert.equal(copied.data.parameters.width, 500);
  const sourceEdges = context.draft.snapshot().nodes.filter(node => node.type === 'workspace.plot-source');
  assert.equal(sourceEdges.length, 2); assert.ok(sourceEdges.every(node => node.references.source === 'second'));
  const removed = context.apply('overlay.remove', { id: 'copy' });
  assert.equal(removed.ids.length, 2); assert.ok(removed.ids.includes('copy'));
  context.draft.accept(); assert.ok(context.project.get('plot'));
  assert.throws(() => context.catalog.apply(context.project.begin(), { command: 'overlay.create', args: { kind: 'conversation', source: 'first' } }), { code: 'COMMAND_ARGUMENT' });
});

test('scene helpers duplicate bindings, reparent and update without copying underlying shared geometry', () => {
  const context = setup();
  context.apply('create:scene.root', { id: 'root' }); context.apply('create:scene.group', { id: 'group', assets: { parent: 'root' } });
  context.apply('create:scene.geometry', { id: 'geometry' }); context.apply('create:scene.material', { id: 'material' });
  context.apply('create:scene.mesh', { id: 'mesh', assets: { parent: 'root', geometry: 'geometry', material: 'material' } });
  context.apply('create:fixture.moving-point', { id: 'point' });
  context.apply('scene.bind', { target: 'mesh', source: 'point', options: { property: 'position', port: 'position' } });
  context.apply('scene.duplicate', { id: 'mesh', options: { id: 'copy' } });
  context.apply('scene.reparent', { id: 'copy', parent: 'group' });
  context.apply('scene.update', { id: 'material', parameters: { color: '#ffffff' } });
  assert.equal(context.draft.get('copy').value.references['asset.geometry'], 'geometry');
  assert.equal(context.draft.get('copy').value.references['asset.parent'], 'group');
  assert.equal(context.draft.snapshot().nodes.filter(node => node.type === 'scene.bind-position').length, 2);
  context.draft.accept();
});

test('generic connect/disconnect are inert relationships and referential removal stays explicit', () => {
  const context = setup();
  context.apply('create:fixture.moving-point', { id: 'a' }); context.apply('create:fixture.moving-point', { id: 'b' });
  const edge = context.apply('connect', { id: 'link', type: 'annotation.link', source: 'a', target: 'b', data: { note: 'Source is inert text: globalThis.executed=true' } });
  assert.deepEqual(edge, { id: 'link', ids: ['link'] });
  assert.throws(() => context.apply('remove', { id: 'a' }));
  assert.deepEqual(context.apply('disconnect', { id: 'link' }), { ids: ['link'] });
  assert.deepEqual(context.apply('remove', { id: 'a' }), { ids: ['a'] });
  context.draft.accept(); assert.equal(context.project.snapshot().nodes.length, 1);
});

test('missing commands, raw source and oversized or accessor-bearing arguments cannot become writes', () => {
  const context = setup();
  assert.equal(context.catalog.has('execute-source'), false);
  assert.throws(() => context.apply('execute-source', { code: 'globalThis.executed = true' }), { code: 'COMMAND_UNKNOWN' });
  assert.throws(() => context.catalog.apply(context.draft, { command: 'remove', args: { id: 'x' }, identity: {} }), { code: 'COMMAND_ARGUMENT' });
  let invoked = false;
  const args = {}; Object.defineProperty(args, 'value', { enumerable: true, get() { invoked = true; return scalar(1); } });
  assert.throws(() => context.catalog.apply(context.draft, { command: 'dataflow.constant', args }), { code: 'INVALID_DATA' });
  assert.equal(invoked, false);
  assert.throws(() => context.apply('connect', { type: 'link', source: 'a', target: 'b', data: { payload: 'x'.repeat(COMMAND_LIMITS.maxArgumentBytes + 1) } }), { code: 'COMMAND_BUDGET' });
  assert.deepEqual(context.draft.snapshot().nodes, []);
});

test('catalog binding snapshots ignore later registration and carry no domain imports', () => {
  const context = setup(), before = context.catalog.discover();
  const manifest = structuredClone(definition(context, 'scene.material'));
  manifest.id = 'test.later-material'; manifest.implementation.id = 'test.later-material.impl';
  context.registry.register({ manifest, implementation: { create: () => ({}) } });
  assert.equal(context.catalog.has('create:test.later-material'), false);
  assert.deepEqual(context.catalog.discover(), before);
  const source = readFileSync(new URL('../src/gateway/commands.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"][^'"]*(?:examples|fixtures|astronomy|physics|sdk\.js)/);
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(/);
});
