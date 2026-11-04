import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { value } from '../src/dataflow/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { createSceneLayer, registerSceneExtensions } from '../src/scene/index.js';
import { createWorkspaceLayer, registerWorkspaceExtensions, PLOT_SOURCE_TYPE } from '../src/workspace/index.js';

function setup(options) {
  const registry = registerWorkspaceExtensions(registerSceneExtensions(new ExtensionRegistry({ capabilities: ['scene.data'] })));
  const binding = registry.bind(), workspace = createWorkspaceLayer(binding, options), project = new Project({ validators: workspace.validators });
  const draft = project.begin();
  workspace.scene.author(draft).root();
  return { registry, binding, workspace, project, draft, author: workspace.author(draft), science: binding.author(draft) };
}
const scalar = data => value({ kind: 'scalar', data, unit: 'K', meaning: 'temperature' });
const vector = data => value({ kind: 'vector', data, unit: 'm', meaning: 'position', frame: { id: 'lab', kind: 'position' } });
function samples(context, time = { value: 2, unit: 's' }) {
  return context.workspace.sources(context.project).map(source => {
    const result = context.binding.evaluate(context.project, source.nodeId, { port: source.port, time });
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    return result;
  });
}
async function compiled(context, results = samples(context), time = { value: 2, unit: 's' }) {
  const output = await context.workspace.compile(context.project, { results, time });
  assert.equal(output.valid, true, JSON.stringify(output.diagnostics));
  assert.deepEqual(output.identity, context.project.token);
  assert.deepEqual(output.scene.identity, output.identity);
  assert.equal(output.time.value, time.value);
  return output;
}
function hasError(validation, code) {
  assert.equal(validation.valid, false);
  assert.ok((validation.errors ?? validation.diagnostics).some(error => error.code === code), JSON.stringify(validation));
}

test('workspace handles register four overlay kinds and bind independent plots through F01 source edges', async () => {
  const context = setup(), { author, science, draft, workspace, project } = context;
  author.inspector({ id: 'inspector', x: 30, y: 40 });
  author.provenance({ id: 'provenance', folded: true });
  author.conversation({ id: 'conversation', hidden: true });
  const a = science.constant(scalar(3), { id: 'a' }), b = science.constant(vector([1, -2, 3]), { id: 'b' });
  const first = author.plot({ id: 'first', title: 'Temperature' }), second = author.plot({ id: 'second', component: 1 });
  author.bind(first, a); author.bind(second, b);
  draft.accept();
  assert.deepEqual(workspace.sources(project), [{ nodeId: 'a', port: 'value' }, { nodeId: 'b', port: 'value' }]);
  const output = await compiled(context);
  assert.equal(output.overlays.length, 5);
  assert.deepEqual(output.overlays.find(overlay => overlay.id === 'second').data.data, [1, -2, 3]);
  assert.equal(output.overlays.find(overlay => overlay.id === 'second').component, 1);
  assert.equal(output.overlays.find(overlay => overlay.id === 'first').source.nodeId, 'a');
  assert.equal(output.overlays.find(overlay => overlay.id === 'first').sampleMode, 'current-physical-time');
  assert.ok(Object.isFrozen(output.overlays[0]));
  assert.ok(project.snapshot().nodes.some(node => node.type === PLOT_SOURCE_TYPE && node.references.target === 'first' && node.references.source === 'a'));
});

test('duplicate/rebind/remove preserve shared scientific identity and remove only owned overlay relations', async () => {
  const context = setup(), { author, science, draft, project, workspace } = context;
  const a = science.constant(scalar(1), { id: 'a' }), b = science.constant(scalar(2), { id: 'b' });
  const first = author.plot({ id: 'first' }); author.bind(first, a);
  const second = author.duplicate(first, { id: 'second', title: 'Independent view', x: 500 });
  author.bind(second, b);
  draft.accept();
  const before = await compiled(context);
  assert.deepEqual(before.overlays.map(overlay => overlay.data.data), [1, 2]);
  const edit = project.begin(), edits = workspace.author(edit);
  const removed = edits.remove('second');
  assert.ok(removed.includes('second')); assert.equal(removed.length, 2);
  edit.accept();
  assert.deepEqual(workspace.sources(project), [{ nodeId: 'a', port: 'value' }]);
  assert.equal(project.get('b').value.data.value.data, 2);
  const after = await compiled(context);
  assert.equal(after.overlays.length, 1);
  assert.equal(after.overlays[0].source.nodeId, 'a');
});

test('plot-source contracts retain arbitrary F02 units, frames, normalization, coordinates and missing samples', async () => {
  const context = setup(), { author, science, draft } = context;
  const values = [
    vector([1, 2, 3]),
    value({ kind: 'collection', data: [2, null], unit: '1', meaning: 'normalized-density', objectIds: ['one', 'two'],
      normalization: { reference: 'reference-density', definition: 'rho / rho0' } }),
    value({ kind: 'field', data: [10, 20], unit: { symbol: 'kg/m^3', dimensions: { mass: 1, length: -3 }, scale: 1 }, meaning: 'density',
      coordinates: { kind: 'space', unit: 'km', frame: { id: 'volume', kind: 'position' }, values: [[0, 0, 0], [1, 0, 0]] } }),
    scalar(300),
  ];
  values.forEach((input, index) => {
    const source = science.constant(input, { id: `source-${index}` });
    author.bind(author.plot({ id: `plot-${index}` }), source);
  });
  draft.accept();
  const output = await compiled(context);
  output.overlays.forEach((overlay, index) => assert.deepEqual(overlay.data, values[index]));
  assert.equal(output.overlays[1].data.data[1], null);
  assert.ok(output.diagnostics.some(error => error.code === 'MISSING_DATA'));
});

test('plot acceptance rejects missing/duplicate sources and weaker or stale stored source contracts', () => {
  const context = setup(), { author, science, draft } = context;
  const source = science.constant(vector([1, 2, 3]), { id: 'source' });
  const plot = author.plot({ id: 'plot' });
  hasError(draft.validate(), 'PLOT_SOURCE_REQUIRED');
  author.bind(plot, source);
  const edge = draft.snapshot().nodes.find(node => node.type === PLOT_SOURCE_TYPE);
  draft.create({ ...edge, id: 'duplicate-edge' });
  hasError(draft.validate(), 'PLOT_BINDING');
  draft.remove('duplicate-edge');
  draft.update(edge.id, { data: { ...edge.data, contract: { ...edge.data.contract, meaning: 'different-quantity' } } });
  hasError(draft.validate(), 'MEANING_MISMATCH');
  author.bind(plot, source);
  assert.equal(draft.validate().valid, true);
  const collection = science.constant(value({ kind: 'collection', data: [1, 2], unit: '1', meaning: 'samples', objectIds: ['a', 'b'] }), { id: 'collection' });
  author.bind(plot, collection);
  const updated = draft.snapshot().nodes.find(node => node.type === PLOT_SOURCE_TYPE);
  draft.update(updated.id, { data: { ...updated.data, contract: { ...updated.data.contract, shape: [null] } } });
  hasError(draft.validate(), 'SHAPE_MISMATCH');
});

test('public plot binding retains kernel handle ownership and validates component selection before mutation', () => {
  const local = setup(), foreign = setup();
  const source = local.science.constant(scalar(1)), outsider = foreign.science.constant(scalar(9)), plot = local.author.plot();
  const before = local.draft.snapshot();
  assert.throws(() => local.author.bind(plot, outsider), { code: 'FOREIGN_HANDLE' });
  assert.throws(() => local.author.bind(plot, source, { component: 2 }), { code: 'PLOT_COMPONENT' });
  assert.deepEqual(local.draft.snapshot(), before);
  local.author.bind(plot, source, { component: 0 });
  const bound = local.draft.snapshot();
  assert.throws(() => local.author.duplicate(plot, { component: 2 }), { code: 'PLOT_COMPONENT' });
  assert.deepEqual(local.draft.snapshot(), bound);
  local.draft.accept();
  const edit = local.project.begin();
  assert.throws(() => edit.remove(source.id), { code: 'REFERENCED_REMOVAL' });
  edit.remove(source.id, { cascade: true });
  hasError(edit.validate(), 'PLOT_SOURCE_REQUIRED');
});

test('workspace compilation never invokes a scientific evaluator and unknown view formats still fail', async () => {
  const registry = registerWorkspaceExtensions(registerSceneExtensions(new ExtensionRegistry({ capabilities: ['scene.data'] })));
  let calls = 0;
  registry.register({ manifest: {
    schemaVersion: 1, apiVersion: 1, id: 'test.workspace-source', version: '1.0.0', kind: 'model',
    implementation: { id: 'test.workspace-source.implementation', version: '1.0.0', build: 'test-1' },
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    ports: { inputs: {}, outputs: { value: { kind: 'scalar', shape: [], unit: 'K', meaning: 'temperature', reference: null, frame: null, normalization: null } } },
    dependencies: [], capabilities: [], documentation: { summary: 'Software callback-count fixture.', links: [], examples: [{ parameters: {} }] }, diagnostics: [],
    science: { equations: ['result = 7'], references: [{ title: 'Software definition', locator: 'test/workspace.test.js' }], assumptions: ['Software fixture only.'],
      applicability: [], evaluation: { mode: 'analytic', sampling: ['instant'] }, review: { status: 'experimental', notes: 'Not a scientific model.', evidence: [] } },
  }, implementation: { evaluate: () => { calls++; return { value: scalar(7) }; } } });
  const binding = registry.bind(), workspace = createWorkspaceLayer(binding), project = new Project({ validators: workspace.validators }), draft = project.begin();
  workspace.scene.author(draft).root();
  const source = binding.author(draft).instantiate('test.workspace-source', { id: 'source' });
  workspace.author(draft).bind(workspace.author(draft).plot({ id: 'plot' }), source);
  draft.accept();
  const context = { binding, workspace, project }, results = samples(context);
  assert.equal(calls, 1);
  await compiled(context, results);
  assert.equal(calls, 1);
  hasError(await workspace.compile(project, { results: [], time: { value: 2, unit: 's' } }), 'RESULT_REQUIRED');
  assert.equal(calls, 1);
  const extension = registry.discover({ kind: 'view-adapter' }).extensions.find(item => item.manifest.id === 'workspace.inspector').manifest;
  extension.id = 'test.unknown-view'; extension.implementation = { id: 'test.unknown-view.implementation', version: '1.0.0', build: 'test-1' };
  extension.artifact.format = 'unknown.output.v1';
  registry.register({ manifest: extension, implementation: { create: ({ node }) => ({ id: node.id, kind: 'inspector', ...node.data.parameters }) } });
  const expanded = registry.bind(), other = createWorkspaceLayer(expanded), edit = project.begin();
  expanded.author(edit).instantiate('test.unknown-view');
  // This project uses its original registry, so use the expanded validator on a
  // reopened candidate to model an explicit composition-root extension update.
  const candidate = Project.from(edit.snapshot(), { validators: other.validators });
  const rejected = await other.compile(candidate, { results: samples({ binding: expanded, workspace: other, project: candidate }), time: { value: 2, unit: 's' } });
  hasError(rejected, 'RENDER_CAPABILITY');
});

test('workspace compilation consumes supplied samples without fallback and rejects stale/forged contexts', async () => {
  const context = setup(), { author, science, draft, workspace, project } = context;
  author.bind(author.plot({ id: 'plot' }), science.constant(scalar(5), { id: 'source' }));
  draft.accept();
  const [result] = samples(context);
  for (const [field, expected] of [['identity', 'STALE_RESULT'], ['implementation', 'IMPLEMENTATION_MISMATCH'], ['unit', 'UNIT_MISMATCH'], ['time', 'TIME_MISMATCH']]) {
    const copy = structuredClone(result);
    if (field === 'identity') copy.identity.generation = 'older-load';
    if (field === 'implementation') copy.producer.implementation.version = '999';
    if (field === 'unit') copy.value.unit = 'm';
    if (field === 'time') copy.request.time.value = 99;
    hasError(await workspace.compile(project, { results: [copy], time: { value: 2, unit: 's' } }), expected);
  }
  hasError(await workspace.compile(project, { results: [] }), 'RESULT_REQUIRED');
  hasError(await workspace.compile(project, { results: [result, result] }), 'RESULT_REQUIRED');
  const edit = project.begin(); workspace.author(edit).update('plot', { x: 100, hidden: true, folded: true }); edit.accept();
  hasError(await workspace.compile(project, { results: [result], time: { value: 2, unit: 's' } }), 'STALE_RESULT');
  const fresh = await compiled(context);
  assert.equal(fresh.overlays[0].hidden, true); assert.equal(fresh.overlays[0].folded, true);
});

test('workspace output is detached across asynchronous compilation and definitions round-trip', async () => {
  const context = setup(), { author, science, draft, workspace, project, binding } = context;
  author.bind(author.plot({ id: 'plot' }), science.constant(vector([1, 2, 3]), { id: 'source' }));
  draft.accept();
  const results = samples(context), time = { value: 2, unit: 's' };
  const pending = workspace.compile(project, { results, time });
  results[0].value.data[0] = 99; time.value = 9;
  const output = await pending;
  assert.equal(output.valid, true, JSON.stringify(output.diagnostics));
  assert.deepEqual(output.overlays[0].data.data, [1, 2, 3]);
  assert.equal(output.time.value, 2);
  const reopened = Project.from(JSON.parse(JSON.stringify(project.snapshot())), { validators: workspace.validators });
  const restored = await compiled({ ...context, project: reopened });
  assert.deepEqual(restored.overlays[0].data, output.overlays[0].data);
  assert.notEqual(restored.identity.generation, output.identity.generation);
  const plainScene = createSceneLayer(binding);
  hasError(await plainScene.compile(project), 'RENDER_CAPABILITY');
});

test('overlay and plot resource limits fail explicitly without accepting malformed layout', async () => {
  const limited = setup({ limits: { maxOverlays: 2 } });
  limited.author.inspector(); limited.author.provenance(); limited.author.conversation();
  hasError(limited.draft.validate(), 'OVERLAY_BUDGET');
  const layout = setup(); layout.author.inspector({ width: 0 }); hasError(layout.draft.validate(), 'SCHEMA_BOUND');
  const small = setup(); small.author.inspector({ width: 80, height: 40 }); small.draft.accept();
  assert.equal((await compiled(small)).overlays[0].height, 40);
  const plots = setup({ limits: { maxPlotValues: 2 } });
  const source = plots.science.constant(vector([1, 2, 3])); plots.author.bind(plots.author.plot(), source); plots.draft.accept();
  hasError(await plots.workspace.compile(plots.project, { results: samples(plots), time: { value: 2, unit: 's' } }), 'PLOT_BUDGET');
});

test('authored plot-source IDs are stable across rebinds and rejected edits leave the draft intact', () => {
  const { author, science, draft } = setup();
  const a = science.constant(scalar(1)), b = science.constant(scalar(2)), plot = author.plot();
  const original = draft.snapshot();
  assert.throws(() => author.bind(plot, a, { id: plot.id }), { code: 'DUPLICATE_ID' });
  assert.throws(() => author.bind(plot, a, { id: '' }), { code: 'PLOT_BINDING' });
  assert.deepEqual(draft.snapshot(), original);
  author.bind(plot, a, { id: 'measurement-source' });
  author.bind(plot, b);
  author.bind(plot, b, { id: 'measurement-source' });
  const bound = draft.snapshot();
  assert.equal(draft.get('measurement-source').value.references.source, b.id);
  assert.throws(() => author.bind(plot, a, { id: 'renamed' }), { code: 'PLOT_BINDING' });
  assert.deepEqual(draft.snapshot(), bound);
  draft.accept();
});
