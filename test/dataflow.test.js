import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Project } from '../src/core/index.js';
import { createDataflow, value, unit } from '../src/dataflow/index.js';

// Independent software fixtures: these implementations are injected into the
// composition root and are never imported or selected by the shared core.
const implementation = id => ({ id, version: '1.0.0' });
const descriptor = (kind, units, meaning, options = {}) => ({
  kind, shape: kind === 'scalar' ? [] : [3], unit: units, meaning,
  reference: null, frame: null, normalization: null, ...options,
});
const scalar = (data, options = {}) => value({ ...descriptor('scalar', 'm', 'length'), data, ...options });
const movingModels = {
  'test.moving-point': {
    implementation: implementation('tests.moving-point'),
    outputs(node) {
      const { lengthUnit = 'm', frame = 'world' } = node.data.parameters;
      return {
        position: descriptor('vector', lengthUnit, 'position', { reference: node.id, frame: { id: frame, kind: 'position' } }),
        velocity: descriptor('vector', `${lengthUnit}/s`, 'velocity', { reference: node.id, frame: { id: frame, kind: 'direction' } }),
      };
    },
    evaluate({ node, request }) {
      const outputs = movingModels['test.moving-point'].outputs(node);
      const { initial, velocity } = node.data.parameters;
      const time = request.time.value; // This fixture's tests request seconds.
      return {
        position: value({ ...outputs.position, data: initial.map((r, index) => r + velocity[index] * time), time: request.time }),
        velocity: value({ ...outputs.velocity, data: velocity, time: request.time }),
      };
    },
  },
  'test.scalar-field': {
    implementation: implementation('tests.scalar-field'),
    outputs(node) {
      const { values, coordinates } = node.data.parameters;
      return { value: descriptor('field', '1', 'sample-intensity', {
        shape: [values.length], coordinates: { kind: 'space', unit: 'm', frame: { id: 'world', kind: 'position' }, values: coordinates },
      }) };
    },
    evaluate({ node }) {
      return { value: value({ ...movingModels['test.scalar-field'].outputs(node).value, data: node.data.parameters.values,
        metadata: { warnings: [{ code: 'FIXTURE_SAMPLES', path: '$', message: 'Fixture samples, not a continuum solver.' }], approximation: ['Known static software fixture.'] } }) };
    },
  },
  'test.vector-field': {
    implementation: implementation('tests.vector-field'),
    outputs(node) {
      const { values, coordinates } = node.data.parameters;
      return { value: descriptor('field', 'm/s', 'velocity', {
        shape: [values.length, 3], frame: { id: 'world', kind: 'direction' },
        coordinates: { kind: 'space', unit: 'm', frame: { id: 'world', kind: 'position' }, values: coordinates },
      }) };
    },
    evaluate({ node }) { return { value: value({ ...movingModels['test.vector-field'].outputs(node).value, data: node.data.parameters.values }) }; },
  },
};

function setup(options = {}) {
  const flow = createDataflow({ models: movingModels, ...options });
  const project = new Project({ validators: flow.validators });
  const draft = project.begin();
  return { flow, project, draft, author: flow.author(draft) };
}

function point(author, id, initial = [0, 0, 0], velocity = [1, 0, 0], lengthUnit = 'm') {
  return author.component('test.moving-point', { id, parameters: { initial, velocity, lengthUnit } });
}

function valid(flow, project, id, options = {}) {
  const result = flow.evaluate(project, id, { time: { value: 0, unit: 's' }, ...options });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.ok(result.value);
  return result;
}

function invalid(flow, project, id, options = {}) {
  const result = flow.evaluate(project, id, { time: { value: 0, unit: 's' }, ...options });
  assert.equal(result.valid, false);
  assert.equal(result.value, null);
  assert.deepEqual(result.identity, project.token);
  assert.ok(result.diagnostics.length > 0);
  for (const diagnostic of result.diagnostics) {
    assert.equal(typeof diagnostic.code, 'string');
    assert.equal(typeof diagnostic.path, 'string');
    assert.equal(typeof diagnostic.message, 'string');
    assert.ok(diagnostic.message.length > 0);
  }
  return result;
}

function rejectsAcceptance(project, draft) {
  const prior = project.snapshot();
  const token = project.token;
  assert.throws(() => draft.accept(), error => {
    assert.ok(error.validation?.errors.length > 0);
    assert.ok(error.validation.errors.every(item => typeof item.code === 'string' && typeof item.message === 'string'));
    return true;
  });
  assert.deepEqual(project.snapshot(), prior);
  assert.deepEqual(project.token, token);
}

test('an explicit collection reference remains a required context instead of being erased', () => {
  const { flow, project, draft, author } = setup();
  const a = author.constant(scalar(2, { reference: 'baseline-A' }), { id: 'a' });
  const b = author.constant(scalar(3, { reference: 'baseline-B' }), { id: 'b' });
  const element = descriptor('scalar', 'm', 'length', { reference: 'baseline-A' });
  author.select({ mode: 'fixed', members: [a, b], element }, { id: 'both' });
  rejectsAcceptance(project, draft);
  b.set({ data: { value: scalar(3, { reference: 'baseline-A' }) } });
  draft.accept();
  const result = valid(flow, project, 'both');
  assert.equal(result.value.reference, 'baseline-A');
  assert.deepEqual(result.value.objectIds, ['a', 'b']);
});

test('independently injected moving points agree across length units and report complete identity', () => {
  const { flow, project, draft, author } = setup();
  point(author, 'meters', [1000, -2000, 3000], [100, -50, 0]);
  point(author, 'kilometers', [1, -2, 3], [0.1, -0.05, 0], 'km');
  author.arithmetic('subtract', { node: 'meters', port: 'position' }, { node: 'kilometers', port: 'position' }, {
    id: 'difference', comparison: { meaning: 'position-comparison', reference: 'same-fixture-path' },
  });
  draft.accept();
  for (const time of [0, 2, 7]) {
    const a = valid(flow, project, 'meters', { port: 'position', time: { value: time, unit: 's' } });
    const b = valid(flow, project, 'kilometers', { port: 'position', time: { value: time, unit: 's' } });
    assert.deepEqual(a.value.data, [1000 + 100 * time, -2000 - 50 * time, 3000]);
    assert.ok(a.value.data.every((number, index) => Math.abs(number - b.value.data[index] * 1000) < 1e-10));
    const comparison = valid(flow, project, 'difference', { time: { value: time, unit: 's' } });
    assert.ok(comparison.value.data.every(number => Math.abs(number) < 1e-10));
    assert.deepEqual(a.identity, project.token);
    assert.equal(a.producer.nodeId, 'meters');
    assert.equal(a.producer.port, 'position');
    assert.deepEqual(a.producer.implementation, implementation('tests.moving-point'));
    assert.equal(a.request.time.value, time);
    assert.deepEqual(a.value.unit, unit('m'));
    assert.deepEqual(a.value.frame, { id: 'world', kind: 'position' });
    assert.equal(a.value.reference, 'meters');
  }
});

test('an author can build a new arithmetic expression with loops and public handles', () => {
  const { flow, project, draft, author } = setup();
  const constants = [-3, 5, -7, 9].map((number, index) => author.constant(scalar(number), { id: `constant-${index}` }));
  let total = constants[0];
  for (let index = 1; index < constants.length; index++) {
    total = author.arithmetic('add', total, constants[index], { id: `sum-${index}` });
  }
  draft.accept();
  const result = valid(flow, project, total.id);
  assert.equal(result.value.data, 4);
  assert.deepEqual(result.value.unit, unit('m'));
  assert.equal(flow.inspect(project.snapshot()).valid, true);
  assert.deepEqual(flow.dependencies(project.snapshot(), 'sum-3').sort(), ['constant-3', 'sum-2']);
});

test('dataflow authoring preserves F01 handle ownership and rejects foreign matching IDs', () => {
  const first = setup(), second = setup();
  first.author.constant(scalar(1), { id: 'same' });
  const foreign = second.author.constant(scalar(2), { id: 'same' });
  const prior = first.draft.snapshot();
  assert.throws(() => first.author.map('abs', foreign, { id: 'foreign-map' }));
  assert.throws(() => first.author.select({ mode: 'fixed', members: [foreign] }, { id: 'foreign-selection' }));
  assert.deepEqual(first.draft.snapshot(), prior);
  first.draft.accept();
  const update = first.project.begin();
  first.flow.author(update).map('abs', first.project.get('same'), { id: 'accepted-handle' });
  update.accept();
  assert.equal(valid(first.flow, first.project, 'accepted-handle').value.data, 1);
});

test('raw edits cannot hide input dependencies from checked graph acceptance', () => {
  const { flow, project, draft, author } = setup();
  const a = author.constant(scalar(1), { id: 'a' });
  const b = author.constant(scalar(2), { id: 'b' });
  const sum = author.arithmetic('add', a, b, { id: 'sum' });
  sum.set({ dependsOn: [] });
  assert.ok(flow.inspect(draft.snapshot()).errors.some(item => item.code === 'DEPENDENCY_DECLARATION'));
  rejectsAcceptance(project, draft);
  sum.set({ dependsOn: ['a', 'b'] });
  draft.accept();
  assert.equal(valid(flow, project, 'sum').value.data, 3);
});

test('static scalar and vector fields retain coordinates and selected sample values', () => {
  const { flow, project, draft, author } = setup();
  const coordinates = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
  const field = author.component('test.scalar-field', { id: 'field', parameters: { coordinates, values: [3, -1, 8] } });
  author.component('test.vector-field', { id: 'vectors', parameters: { coordinates, values: [[1, 2, 3], [4, 5, 6], [-1, -2, -3]] } });
  author.field(field, [2, 0], { id: 'selected' });
  draft.accept();
  const scalarField = valid(flow, project, 'field');
  assert.equal(scalarField.value.kind, 'field');
  assert.deepEqual(scalarField.value.data, [3, -1, 8]);
  assert.deepEqual(scalarField.value.coordinates.values, coordinates);
  assert.deepEqual(scalarField.value.coordinates.unit, unit('m'));
  const vectorField = valid(flow, project, 'vectors');
  assert.deepEqual(vectorField.value.shape, [3, 3]);
  assert.deepEqual(vectorField.value.data[2], [-1, -2, -3]);
  const selected = valid(flow, project, 'selected');
  assert.deepEqual(selected.value.data, [8, 3]);
  assert.deepEqual(selected.value.coordinates.values, [coordinates[2], coordinates[0]]);
  assert.ok(selected.value.metadata.warnings.some(item => item.code === 'FIXTURE_SAMPLES'));
});

test('fixed and live collections preserve identities and update with different membership rules', () => {
  const { flow, project, draft, author } = setup();
  const a = point(author, 'a', [0, 0, 0], [3, 4, 0]);
  const b = point(author, 'b', [0, 0, 0], [0, 0, 7]);
  const fixed = author.select({ mode: 'fixed', members: [{ node: a, port: 'velocity' }] }, { id: 'fixed' });
  const live = author.select({ mode: 'live', type: 'test.moving-point', port: 'velocity' }, { id: 'live' });
  author.reduce('sum', author.map('magnitude', fixed, { id: 'fixed-speeds' }), { id: 'fixed-total' });
  author.reduce('sum', author.map('magnitude', live, { id: 'live-speeds' }), { id: 'live-total' });
  draft.accept();
  assert.equal(valid(flow, project, 'fixed-total').value.data, 5);
  assert.equal(valid(flow, project, 'live-total').value.data, 12);
  assert.deepEqual(valid(flow, project, 'fixed').value.objectIds, ['a']);
  assert.deepEqual(valid(flow, project, 'live').value.objectIds, ['a', 'b']);

  const extension = project.begin();
  point(flow.author(extension), 'c', [0, 0, 0], [0, 0, 11]);
  extension.accept();
  assert.equal(valid(flow, project, 'fixed-total').value.data, 5);
  assert.equal(valid(flow, project, 'live-total').value.data, 23);
  assert.deepEqual(flow.dependencies(project.snapshot(), 'live').sort(), ['a', 'b', 'c']);

  const removal = project.begin();
  flow.author(removal).remove('c');
  removal.accept();
  assert.equal(valid(flow, project, 'live-total').value.data, 12);
  assert.deepEqual(valid(flow, project, 'live').value.objectIds, ['a', 'b']);
  // The b handle belongs to the already accepted draft, so new authoring uses ID.
  assert.equal(b.id, 'b');
});

test('selected values may use compatible units while retaining explicit object membership', () => {
  const { flow, project, draft, author } = setup();
  point(author, 'm', [0, 0, 0], [1000, 0, 0]);
  point(author, 'km', [0, 0, 0], [1, 0, 0], 'km');
  const selection = author.select({ mode: 'fixed', members: [{ node: 'm', port: 'velocity' }, { node: 'km', port: 'velocity' }] }, { id: 'mixed' });
  author.reduce('mean', author.map('magnitude', selection), { id: 'mean-speed' });
  draft.accept();
  const collection = valid(flow, project, 'mixed');
  assert.deepEqual(collection.value.data, [[1000, 0, 0], [1000, 0, 0]]);
  assert.deepEqual(collection.value.objectIds, ['m', 'km']);
  assert.equal(valid(flow, project, 'mean-speed').value.data, 1000);
});

test('explicit references protect fixed selections from deletion, with deliberate calculation cascade', () => {
  const { flow, project, draft, author } = setup();
  const a = point(author, 'a');
  point(author, 'b');
  const fixed = author.select({ mode: 'fixed', members: [{ node: a, port: 'velocity' }] }, { id: 'fixed' });
  author.reduce('sum', author.map('magnitude', fixed, { id: 'speeds' }), { id: 'total' });
  draft.accept();
  const prior = project.snapshot();
  const removal = project.begin();
  assert.throws(() => flow.author(removal).remove('a'));
  assert.deepEqual(project.snapshot(), prior);
  flow.author(removal).remove('a', { cascade: true });
  removal.accept();
  assert.deepEqual(project.snapshot().nodes.map(node => node.id), ['b']);
  project.undo(project.token);
  assert.deepEqual(project.snapshot(), prior);
  assert.equal(valid(flow, project, 'total').value.data, 1);
});

test('empty live collections remain empty and their reductions do not invent zero samples', () => {
  const { flow, project, draft, author } = setup();
  point(author, 'only');
  const selection = author.select({ mode: 'live', type: 'test.moving-point', port: 'velocity' }, { id: 'live' });
  author.reduce('mean', author.map('magnitude', selection), { id: 'mean' });
  draft.accept();
  const removal = project.begin();
  flow.author(removal).remove('only');
  removal.accept();
  const empty = valid(flow, project, 'live');
  assert.deepEqual(empty.value.data, []);
  assert.deepEqual(empty.value.objectIds, []);
  invalid(flow, project, 'mean');
});

test('fixed and live selections of timeless constants do not invent a physical timestamp', () => {
  const { flow, project, draft, author } = setup();
  const a = author.constant(scalar(5), { id: 'a' });
  const b = author.constant(scalar(7), { id: 'b' });
  const fixed = author.select({ mode: 'fixed', members: [a, b] }, { id: 'fixed' });
  const live = author.select({ mode: 'live', type: 'dataflow.constant', port: 'value' }, { id: 'live' });
  author.reduce('mean', fixed, { id: 'fixed-mean' });
  author.reduce('mean', live, { id: 'live-mean' });
  draft.accept();
  for (const id of ['fixed', 'live']) {
    const collection = valid(flow, project, id, { time: { value: 42, unit: 's' } });
    assert.deepEqual(collection.value.data, [5, 7]);
    assert.equal(collection.value.time, null);
    const mean = valid(flow, project, `${id}-mean`, { time: { value: 42, unit: 's' } });
    assert.equal(mean.value.data, 6);
    assert.equal(mean.value.time, null);
  }
});

test('arithmetic preserves signed comparisons and requires explicit meaning for different references', () => {
  const { flow, project, draft, author } = setup();
  const a = author.constant(scalar(1, { reference: 'object-a' }), { id: 'a' });
  const b = author.constant(scalar(300, { unit: 'cm', reference: 'object-b' }), { id: 'b' });
  author.arithmetic('subtract', a, b, { id: 'difference' });
  rejectsAcceptance(project, draft);
  draft.remove('difference');
  author.arithmetic('subtract', a, b, { id: 'difference', comparison: { meaning: 'chosen-length-difference', reference: 'a-minus-b' } });
  draft.accept();
  const result = valid(flow, project, 'difference');
  assert.equal(result.value.data, -2);
  assert.deepEqual(result.value.unit, unit('m'));
  assert.equal(result.value.meaning, 'chosen-length-difference');
  assert.equal(result.value.reference, 'a-minus-b');
  assert.ok(result.metadata.approximation.length > 0 || result.value.metadata.warnings.length > 0);
});

test('unit, frame, normalization and meaning conflicts reject acceptance with useful diagnostics', () => {
  const cases = [
    [scalar(1), scalar(2, { unit: 's' })],
    [scalar(1), scalar(2, { meaning: 'different-quantity' })],
    [scalar(1, { normalization: { reference: 'first', definition: 'divide by baseline' } }), scalar(2, { normalization: { reference: 'second', definition: 'divide by baseline' } })],
    [value({ ...descriptor('vector', 'm', 'position', { frame: { id: 'left', kind: 'position' } }), data: [1, 0, 0] }),
      value({ ...descriptor('vector', 'm', 'position', { frame: { id: 'right', kind: 'position' } }), data: [2, 0, 0] })],
  ];
  for (const [left, right] of cases) {
    const { project, draft, author } = setup();
    const a = author.constant(left, { id: 'a' });
    const b = author.constant(right, { id: 'b' });
    author.arithmetic('add', a, b, { id: 'sum' });
    rejectsAcceptance(project, draft);
  }
});

test('an explicit comparison never bypasses frame or normalization requirements', () => {
  for (const rightContext of [
    { frame: { id: 'other-frame', kind: 'position' } },
    { normalization: { reference: 'other-baseline', definition: 'divided value' } },
  ]) {
    const { project, draft, author } = setup();
    const base = { ...descriptor('vector', 'm', 'position', { frame: { id: 'world', kind: 'position' } }), data: [1, 2, 3] };
    const a = author.constant(value({ ...base, reference: 'a' }));
    const b = author.constant(value({ ...base, ...rightContext, reference: 'b' }));
    author.arithmetic('subtract', a, b, { id: 'difference', comparison: { meaning: 'comparison', reference: 'a-vs-b' } });
    rejectsAcceptance(project, draft);
  }
});

test('model input ports require an explicit unit adapter even for compatible dimensions', () => {
  const required = descriptor('scalar', 'cm', 'length');
  const receiver = {
    implementation: implementation('tests.centimeter-consumer'),
    inputs: () => ({ distance: required }),
    outputs: () => ({ value: required }),
    evaluate: ({ inputs }) => ({ value: inputs.distance }),
  };
  const flow = createDataflow({ models: { 'test.centimeter-consumer': receiver }, adapters: {
    'test.m-to-cm': {
      implementation: implementation('tests.explicit-m-to-cm'),
      input: descriptor('scalar', 'm', 'length'), output: required,
      apply: input => value({ ...input, data: input.data * 100, unit: 'cm' }),
    },
  } });
  const project = new Project({ validators: flow.validators });
  const draft = project.begin(), author = flow.author(draft);
  const source = author.constant(scalar(2), { id: 'source' });
  author.component('test.centimeter-consumer', { id: 'receiver', parameters: {}, inputs: { distance: source } });
  const inspection = flow.inspect(draft.snapshot());
  assert.ok(inspection.errors.some(item => item.code === 'UNIT_CONVERSION_REQUIRED'));
  rejectsAcceptance(project, draft);
  draft.remove('receiver');
  const adapter = author.adapt('test.m-to-cm', source, { id: 'converted' });
  author.component('test.centimeter-consumer', { id: 'receiver', parameters: {}, inputs: { distance: adapter } });
  draft.accept();
  const result = valid(flow, project, 'receiver');
  assert.equal(result.value.data, 200);
  assert.deepEqual(result.value.unit, unit('cm'));
  assert.ok(JSON.stringify(result.metadata.implementations).includes('tests.explicit-m-to-cm'));
});

test('an injected frame adapter performs its declared transformation before a strict port', () => {
  const initial = descriptor('vector', 'm', 'position', { reference: 'origin-point', frame: { id: 'world', kind: 'position' } });
  const transformed = { ...initial, frame: { id: 'shifted', kind: 'position' } };
  const flow = createDataflow({ models: {
    'test.shifted-consumer': {
      implementation: implementation('tests.shifted-consumer'),
      inputs: () => ({ position: transformed }), outputs: () => ({ value: transformed }),
      evaluate: ({ inputs }) => ({ value: inputs.position }),
    },
  }, adapters: {
    'test.rotate-translate': {
      implementation: implementation('tests.rotate-translate'), input: initial, output: transformed,
      apply: input => value({ ...input, frame: transformed.frame, data: [10 - input.data[1], input.data[0], input.data[2]] }),
    },
  } });
  const project = new Project({ validators: flow.validators });
  const draft = project.begin(), author = flow.author(draft);
  const source = author.constant(value({ ...initial, data: [1, 2, 3] }));
  const converted = author.adapt('test.rotate-translate', source, { id: 'rotated' });
  author.component('test.shifted-consumer', { id: 'receiver', parameters: {}, inputs: { position: converted } });
  draft.accept();
  const result = valid(flow, project, 'receiver');
  assert.deepEqual(result.value.data, [8, 1, 3]);
  assert.deepEqual(result.value.frame, transformed.frame);
  assert.equal(result.value.reference, 'origin-point');
});

test('missing input ports and unavailable adapters fail before project acceptance', () => {
  const flow = createDataflow({ models: {
    'test.input': {
      implementation: implementation('tests.input'),
      inputs: () => ({ required: descriptor('scalar', 'm', 'length') }),
      outputs: () => ({ value: descriptor('scalar', 'm', 'length') }),
      evaluate: ({ inputs }) => ({ value: inputs.required }),
    },
  } });
  const project = new Project({ validators: flow.validators });
  const draft = project.begin(), author = flow.author(draft);
  author.component('test.input', { id: 'missing-input', parameters: {} });
  rejectsAcceptance(project, draft);
  draft.remove('missing-input');
  const source = author.constant(scalar(1), { id: 'source' });
  author.adapt('unregistered.module', source, { id: 'missing-adapter' });
  rejectsAcceptance(project, draft);
});

test('declared output contracts are checked against real model and adapter results', () => {
  const flow = createDataflow({ models: {
    'test.broken-output': {
      implementation: implementation('tests.broken-output'),
      outputs: () => ({ value: descriptor('scalar', 'm', 'length') }),
      evaluate: () => ({ value: scalar(3, { unit: 's' }) }),
    },
  }, adapters: {
    'test.broken-adapter': {
      implementation: implementation('tests.broken-adapter'),
      input: descriptor('scalar', 'm', 'length'), output: descriptor('scalar', 'cm', 'length'),
      apply: input => input,
    },
  } });
  const project = new Project({ validators: flow.validators });
  const draft = project.begin(), author = flow.author(draft);
  author.component('test.broken-output', { id: 'broken-model', parameters: {} });
  const constant = author.constant(scalar(2), { id: 'constant' });
  author.adapt('test.broken-adapter', constant, { id: 'broken-adapter' });
  draft.accept();
  invalid(flow, project, 'broken-model');
  invalid(flow, project, 'broken-adapter');
});

test('trusted implementation exceptions and asynchronous results fail closed', () => {
  for (const evaluate of [() => { throw null; }, async () => ({ value: scalar(1) })]) {
    const flow = createDataflow({ models: {
      'test.failure': { implementation: implementation('tests.failure'),
        outputs: () => ({ value: descriptor('scalar', 'm', 'length') }), evaluate },
    } });
    const project = new Project({ validators: flow.validators });
    const draft = project.begin();
    flow.author(draft).component('test.failure', { id: 'failure', parameters: {} });
    draft.accept();
    const prior = project.snapshot(), token = project.token;
    invalid(flow, project, 'failure');
    assert.deepEqual(project.snapshot(), prior);
    assert.deepEqual(project.token, token);
  }
});

test('callbacks receive immutable graph data and cannot revise accepted parameters through it', () => {
  const flow = createDataflow({ models: {
    'test.mutate': {
      implementation: implementation('tests.mutate'),
      outputs: () => ({ value: descriptor('scalar', 'm', 'length') }),
      evaluate: ({ node }) => {
        node.data.parameters.amount = 99;
        return { value: scalar(node.data.parameters.amount) };
      },
    },
  } });
  const project = new Project({ validators: flow.validators });
  const draft = project.begin();
  flow.author(draft).component('test.mutate', { id: 'mutator', parameters: { amount: 1 } });
  draft.accept();
  const prior = project.snapshot(), token = project.token;
  invalid(flow, project, 'mutator');
  assert.deepEqual(project.snapshot(), prior);
  assert.deepEqual(project.token, token);
});

test('a trusted callback that changes project revision or load generation cannot return a valid stale result', () => {
  for (const action of ['edit', 'load']) {
    let project, changed = false;
    const flow = createDataflow({ models: {
      'test.side-effect': {
        implementation: implementation('tests.side-effect'),
        outputs: () => ({ value: descriptor('scalar', 'm', 'length') }),
        evaluate: () => {
          if (!changed) {
            changed = true;
            if (action === 'load') project.load(project.snapshot(), project.token);
            else project.apply([{ op: 'create', node: { id: 'later', type: 'test.note', kind: 'presentation' } }], project.token);
          }
          return { value: scalar(1) };
        },
      },
    } });
    project = new Project({ validators: flow.validators });
    const draft = project.begin();
    flow.author(draft).component('test.side-effect', { id: 'source', parameters: {} });
    draft.accept();
    const captured = project.token;
    const result = flow.evaluate(project, 'source');
    assert.equal(result.valid, false);
    assert.equal(result.value, null);
    assert.deepEqual(result.identity, captured);
    assert.notDeepEqual(project.token, captured);
    assert.ok(result.diagnostics.some(item => item.code === 'STALE_RESULT'));
    if (action === 'load') assert.notEqual(project.token.generation, captured.generation);
    else assert.ok(project.token.revision > captured.revision);
  }
});

test('a model cannot return a timestamp inconsistent with the requested physical snapshot', () => {
  const flow = createDataflow({ models: {
    'test.wrong-time': {
      implementation: implementation('tests.wrong-time'),
      outputs: () => ({ value: descriptor('scalar', 'm', 'length') }),
      evaluate: ({ request }) => ({ value: scalar(1, { time: { ...request.time, value: request.time.value + 1 } }) }),
    },
  } });
  const project = new Project({ validators: flow.validators });
  const draft = project.begin();
  flow.author(draft).component('test.wrong-time', { id: 'wrong-time', parameters: {} });
  draft.accept();
  const result = invalid(flow, project, 'wrong-time', { time: { value: 2, unit: 's' } });
  assert.ok(result.diagnostics.some(item => item.code === 'TIME_MISMATCH'));
});

test('timed constants are valid only for requests at the same physical time', () => {
  const { flow, project, draft, author } = setup();
  author.constant(scalar(3, { time: { value: 2, unit: 's' } }), { id: 'snapshot' });
  draft.accept();
  assert.equal(valid(flow, project, 'snapshot', { time: { value: 2, unit: 's' } }).value.data, 3);
  assert.equal(valid(flow, project, 'snapshot', { time: { value: 1 / 30, unit: 'min' } }).value.data, 3);
  const mismatch = invalid(flow, project, 'snapshot', { time: { value: 3, unit: 's' } });
  assert.ok(mismatch.diagnostics.some(item => item.code === 'TIME_MISMATCH'));
});

test('effective live-selection cycles are rejected while ordinary relationship cycles work', () => {
  const flow = createDataflow({ models: {
    'test.feedback': {
      implementation: implementation('tests.feedback'),
      inputs: () => ({ members: descriptor('collection', 'm', 'length', { shape: [null] }) }),
      outputs: () => ({ value: descriptor('scalar', 'm', 'length') }),
      evaluate: () => ({ value: scalar(1) }),
    },
  } });
  const project = new Project({ validators: flow.validators });
  const draft = project.begin(), author = flow.author(draft);
  const live = author.select({ mode: 'live', type: 'test.feedback', port: 'value', element: descriptor('scalar', 'm', 'length') }, { id: 'live' });
  author.component('test.feedback', { id: 'feedback', parameters: {}, inputs: { members: live } });
  assert.ok(flow.inspect(draft.snapshot()).errors.some(item => item.code === 'DEPENDENCY_CYCLE'));
  rejectsAcceptance(project, draft);

  const validDraft = project.begin(), validAuthor = flow.author(validDraft);
  const a = validAuthor.constant(scalar(1), { id: 'a' });
  const b = validAuthor.constant(scalar(2), { id: 'b' });
  validDraft.connect('test.peer', a, b, { id: 'a-b' });
  validDraft.connect('test.peer', b, a, { id: 'b-a' });
  validAuthor.arithmetic('add', a, b, { id: 'sum' });
  validDraft.accept();
  assert.equal(valid(flow, project, 'sum').value.data, 3);
});

test('node and dependency-depth limits reject excessive graphs atomically', () => {
  for (const limits of [{ maxNodes: 3 }, { maxDepth: 2 }]) {
    const { project, draft, author } = setup({ limits });
    let latest = author.constant(scalar(1), { id: 'start' });
    for (let index = 0; index < 3; index++) latest = author.map('abs', latest, { id: `layer-${index}` });
    rejectsAcceptance(project, draft);
  }
});

test('value and evaluation-work limits produce diagnostics rather than unbounded calculations', () => {
  const valueSetup = setup({ limits: { maxValues: 4 } });
  const field = valueSetup.author.component('test.scalar-field', { id: 'field', parameters: {
    values: [1, 2], coordinates: [[0, 0, 0], [1, 0, 0]],
  } });
  if (!valueSetup.flow.inspect(valueSetup.draft.snapshot()).valid) rejectsAcceptance(valueSetup.project, valueSetup.draft);
  else {
    valueSetup.draft.accept();
    invalid(valueSetup.flow, valueSetup.project, field.id);
  }

  const workSetup = setup({ limits: { maxWork: 1 } });
  const a = workSetup.author.constant(scalar(1));
  const b = workSetup.author.constant(scalar(2));
  workSetup.author.arithmetic('add', a, b, { id: 'sum' });
  workSetup.draft.accept();
  invalid(workSetup.flow, workSetup.project, 'sum');
});

test('repeated reductions charge every consumed collection instead of only their scalar outputs', () => {
  const { flow, project, draft, author } = setup();
  const source = author.constant(value({
    kind: 'collection', data: Array(40).fill(1), unit: '1', meaning: 'fixture-count',
    objectIds: Array.from({ length: 40 }, (_, index) => `item-${index}`),
  }), { id: 'source' });
  const totals = Array.from({ length: 8 }, (_, index) => author.reduce('sum', source, { id: `total-${index}` }));
  let aggregate = totals[0];
  for (let index = 1; index < totals.length; index++) {
    aggregate = author.arithmetic('add', aggregate, totals[index], { id: `aggregate-${index}` });
  }
  draft.accept();
  assert.equal(valid(flow, project, aggregate.id).value.data, 320);

  // Each scalar reduction reads all 40 samples. Reusing a cached collection
  // saves its production, but cannot erase the eight separate 40-value reads.
  const bounded = createDataflow({ limits: { maxWork: 150 } });
  const reopened = Project.from(project.snapshot(), { validators: bounded.validators });
  const result = invalid(bounded, reopened, aggregate.id);
  assert.ok(result.diagnostics.some(item => item.code === 'WORK_BUDGET'));
});

test('division by zero and missing operands produce invalid results instead of finite substitutes', () => {
  const { flow, project, draft, author } = setup();
  const numerator = author.constant(scalar(3), { id: 'numerator' });
  const zero = author.constant(scalar(0), { id: 'zero' });
  author.arithmetic('divide', numerator, zero, { id: 'quotient' });
  draft.accept();
  invalid(flow, project, 'quotient');
  invalid(flow, project, 'missing-node');
  invalid(flow, project, 'numerator', { port: 'missing-port' });
});

test('misaligned series require explicit coordinate interpolation and retain signed results', () => {
  const { flow, project, draft, author } = setup();
  const series = (samples, times) => value({ ...descriptor('series', 'm', 'length', { shape: [samples.length] }), data: samples,
    coordinates: { kind: 'time', unit: 's', values: times } });
  const left = author.constant(series([0, 1, 2], [0, 1, 2]), { id: 'left' });
  const right = author.constant(series([0, 4], [0, 2]), { id: 'right' });
  author.arithmetic('subtract', left, right, { id: 'unaligned' });
  // A static declaration can be rejected at acceptance; otherwise runtime must
  // diagnose its samples. Either path must prohibit array-index subtraction.
  const inspection = flow.inspect(draft.snapshot());
  if (inspection.valid) {
    draft.accept();
    invalid(flow, project, 'unaligned');
  } else {
    rejectsAcceptance(project, draft);
    draft.remove('unaligned');
    draft.accept();
  }
  const alignedDraft = project.begin();
  const alignedAuthor = flow.author(alignedDraft);
  if (alignedDraft.snapshot().nodes.some(node => node.id === 'unaligned')) alignedAuthor.remove('unaligned');
  alignedAuthor.arithmetic('subtract', 'left', 'right', { id: 'aligned', alignment: { policy: 'linear', target: 'left' } });
  alignedDraft.accept();
  const result = valid(flow, project, 'aligned');
  assert.deepEqual(result.value.data, [0, -1, -2]);
  assert.deepEqual(result.value.coordinates.values, [0, 1, 2]);
  assert.ok(result.value.metadata.warnings.some(item => item.code === 'INTERPOLATED'));
  assert.equal(typeof result.metadata.sampling, 'object');
});

test('sample interpolation cannot extrapolate or turn absent data into zero', () => {
  for (const [leftTimes, rightSamples] of [
    [[-1, 1, 2], [0, 4]],
    [[0, 1, 2], [0, null]],
  ]) {
    const { flow, project, draft, author } = setup();
    const series = (data, times) => value({ ...descriptor('series', 'm', 'length', { shape: [data.length] }), data,
      coordinates: { kind: 'time', unit: 's', values: times } });
    const left = author.constant(series([0, 1, 2], leftTimes));
    const right = author.constant(series(rightSamples, [0, 2]));
    author.arithmetic('add', left, right, { id: 'sum', alignment: { policy: 'linear', target: 'left' } });
    if (!flow.inspect(draft.snapshot()).valid) rejectsAcceptance(project, draft);
    else {
      draft.accept();
      invalid(flow, project, 'sum');
    }
  }
});

test('presentation and display-unit changes leave scientific values unchanged', () => {
  const { flow, project, draft, author } = setup();
  point(author, 'p', [3, 4, 5], [1, 2, 3]);
  draft.presentation('test.camera', { id: 'camera', references: { focus: 'p' }, data: { zoom: 1, unit: 'm' } });
  draft.accept();
  const original = valid(flow, project, 'p', { port: 'position', time: { value: 2, unit: 's' } }).value;
  const changed = project.begin();
  changed.get('camera').set({ data: { zoom: 50, unit: 'km', position: [500, 900, -100] } });
  changed.accept();
  assert.deepEqual(valid(flow, project, 'p', { port: 'position', time: { value: 2, unit: 's' } }).value, original);
});

test('results carry fresh revision/load identity across undo and graph round trips', () => {
  const { flow, project, draft, author } = setup();
  point(author, 'p');
  draft.accept();
  const saved = project.snapshot();
  const original = valid(flow, project, 'p', { port: 'position' });
  const revised = project.begin();
  const stored = revised.get('p').value;
  flow.author(revised).update('p', { data: { ...stored.data, parameters: { ...stored.data.parameters, initial: [9, 8, 7] } } });
  revised.accept();
  const edit = valid(flow, project, 'p', { port: 'position' });
  assert.notEqual(edit.identity.revision, original.identity.revision);
  assert.deepEqual(edit.value.data, [9, 8, 7]);
  project.undo(project.token);
  const restored = valid(flow, project, 'p', { port: 'position' });
  assert.deepEqual(restored.value, original.value);
  assert.ok(restored.identity.revision > edit.identity.revision);
  project.load(saved, project.token);
  const loaded = valid(flow, project, 'p', { port: 'position' });
  assert.notEqual(loaded.identity.generation, restored.identity.generation);
  assert.equal(loaded.identity.projectId, original.identity.projectId);
  assert.deepEqual(loaded.value, original.value);
});

test('calculation definitions, coordinates, metadata and inert source survive JSON round trip', () => {
  const { flow, project, draft, author } = setup();
  const series = value({ ...descriptor('series', 'm', 'length', { shape: [3] }), data: [1, -2, 3],
    coordinates: { kind: 'time', unit: 's', values: [0, 0.5, 2] },
    metadata: { warnings: [{ code: 'SYNTHETIC_FIXTURE', path: '$', message: 'Synthetic fixture samples.' }], approximation: ['No numerical simulation.'] } });
  const data = author.constant(series, { id: 'series' });
  author.map('abs', data, { id: 'absolute' });
  draft.presentation('test.notes', { id: 'notes', data: { source: 'globalThis.__dataflowExecuted = true' } });
  draft.accept();
  delete globalThis.__dataflowExecuted;
  const original = valid(flow, project, 'absolute');
  const reopened = Project.from(JSON.parse(JSON.stringify(project.snapshot())), { validators: flow.validators });
  assert.deepEqual(reopened.snapshot(), project.snapshot());
  const result = valid(flow, reopened, 'absolute');
  assert.deepEqual(result.value, original.value);
  assert.deepEqual(result.value.coordinates.values, [0, 0.5, 2]);
  assert.ok(result.value.metadata.warnings.some(item => item.code === 'SYNTHETIC_FIXTURE'));
  assert.equal(globalThis.__dataflowExecuted, undefined);
});

test('copied core and dataflow evaluate a locally injected model with no domain files present', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'cosmic-lego-dataflow-'));
  try {
    for (const name of ['core', 'dataflow']) {
      cpSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), resolve(directory, 'src', name), { recursive: true });
    }
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(resolve(directory, 'probe.mjs'), `
      import { Project } from './src/core/index.js';
      import { createDataflow, value } from './src/dataflow/index.js';
      const contract = node => ({kind:'vector',shape:[3],unit:'m',meaning:'position',
        reference:node.id,frame:{id:'room',kind:'position'},normalization:null});
      const flow = createDataflow({models:{'local.point':{
        implementation:{id:'local.linear-point',version:'1.0.0'},
        outputs:node=>({position:contract(node)}),
        evaluate:({node,request})=>({position:value({...contract(node),
          data:node.data.parameters.start.map((x,i)=>x+node.data.parameters.velocity[i]*request.time.value),time:request.time})}),
      }}});
      const project = new Project({validators:flow.validators});
      const draft = project.begin(), author = flow.author(draft);
      author.component('local.point',{id:'point',parameters:{start:[1,2,3],velocity:[2,0,-1]}});
      const first = author.constant(value({kind:'scalar',data:1,unit:'m',meaning:'length'}));
      const second = author.constant(value({kind:'scalar',data:250,unit:'cm',meaning:'length'}));
      author.arithmetic('subtract',first,second,{id:'difference'});
      draft.accept();
      const point = flow.evaluate(project,'point',{port:'position',time:{value:2,unit:'s'}});
      const difference = flow.evaluate(project,'difference',{time:{value:2,unit:'s'}});
      console.log(JSON.stringify({valid:point.valid&&difference.valid,position:point.value?.data,difference:difference.value?.data}));
    `);
    const result = spawnSync(process.execPath, ['probe.mjs'], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { valid: true, position: [5, 2, 1], difference: -1.5 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('shared core/dataflow imports stay independent of domain and fixture modules', () => {
  const sourceRoot = realpathSync(fileURLToPath(new URL('../src', import.meta.url)));
  const permitted = ['core', 'dataflow'].map(name => `${resolve(sourceRoot, name)}${sep}`);
  const visited = new Set();
  function inspect(file) {
    const path = realpathSync(file);
    if (visited.has(path)) return;
    visited.add(path);
    assert.ok(permitted.some(prefix => path.startsWith(prefix)), `Shared code imports non-shared source: ${path}`);
    const source = readFileSync(path, 'utf8');
    const imports = /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    for (const match of source.matchAll(imports)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith('node:')) continue;
      assert.ok(specifier.startsWith('.'), `Shared code imports a package or URL: ${specifier}`);
      inspect(resolve(dirname(path), specifier));
    }
    assert.doesNotMatch(source, /\b(?:import\s*\(\s*[^'"\s]|require\s*\(|eval\s*\(|new\s+Function\s*\()/);
  }
  inspect(resolve(sourceRoot, 'dataflow/index.js'));
});
