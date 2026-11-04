import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { createRuntime } from '../src/runtime/index.js';
import { createWorkspaceLayer } from '../src/workspace/index.js';
import { plotFraction, plotRows, seriesPaths } from '../src/workspace/plot-samples.js';
import { createRegistry } from '../examples/fixtures/workspace-registry.js';

test('sample an analytic subgraph on a nonuniform physical clock inside a worker', async () => {
  const binding = createRegistry().bind(), layer = createWorkspaceLayer(binding);
  const project = new Project({ validators: layer.validators }), draft = project.begin(), science = binding.author(draft);
  const point = science.instantiate('fixture.moving-point', { id: 'moving', parameters: { r0: [1, 0, 0], v: [1, 0, 0] } });
  const distance = science.map('magnitude', { node: point, port: 'position' }, { id: 'length' });
  const series = science.sample(distance, { times: [-2, 0, 3], unit: 's' }, { id: 'history' });
  const views = layer.author(draft);
  views.bind(views.plot(), series);
  draft.accept();
  const runtime = createRuntime({ registryModule: new URL('../examples/fixtures/workspace-registry.js', import.meta.url) });
  try {
    const result = await runtime.submit(project, 'history', { time: { value: 33, unit: 's' } }).promise;
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.value.data, [1, 1, 4]);
    assert.deepEqual(result.value.coordinates.values, [-2, 0, 3]);
    const rows = plotRows({ data: result.value, source: { nodeId: 'history' }, component: -1 });
    assert.deepEqual(rows.map(r => r.x), [-2, 0, 3]);
    rows[1].y = null;
    assert.equal(seriesPaths(rows, x => x, y => y).get(0), 'M-2 1M3 4');
    assert.equal(plotFraction(0, -2, 3), 0.4);
  } finally { await runtime.dispose(); }
  const invalid = project.begin(), author = binding.author(invalid);
  const noise = author.instantiate('fixture.seeded-accumulator', { id: 'stepped' });
  author.sample(noise, { times: [0, 1], unit: 's' });
  assert.ok(invalid.validate().errors.some(e => e.code === 'SAMPLE_SOURCE'));
});

test('a trusted aggregate guard belongs to one registry binding and cannot be chosen by project data', () => {
  const registry = createRegistry(), original = registry.bind(), graph = new Project().snapshot();
  registry.registerValidator('example.constraint', input => [{ code: 'PAIR_LIMIT', path: input.id, message: 'Example limit.' }]);
  assert.equal(original.inspect(graph).valid, true);
  assert.equal(registry.bind().inspect(graph).errors[0].code, 'PAIR_LIMIT');
  assert.throws(() => registry.registerValidator('example.constraint', () => []), { code: 'REGISTRY_VALIDATOR' });
});

test('sampler rejects schedules overflowing seconds or collapsing distinct physical instants on conversion', () => {
  const binding = createRegistry().bind(), project = new Project({ validators: binding.validators });
  for (const schedule of [{ times: [1e308], unit: 'h' },
    { times: [0.1, 0.2], unit: { symbol: 'tiny-time', dimensions: { time: 1 }, scale: Number.MIN_VALUE } }]) {
    const draft = project.begin(), author = binding.author(draft);
    const source = author.constant({ kind: 'scalar', data: 1, unit: 'm', meaning: 'length' });
    author.sample(source, schedule);
    assert.ok(draft.validate().errors.some(e => e.code === 'INVALID_COORDINATES'));
    assert.equal(project.snapshot().nodes.length, 0);
  }
});

test('arithmetic checks declared sampled coordinates across units and only accepts interpolation within coverage', () => {
  const binding = createRegistry().bind(), project = new Project({ validators: binding.validators });
  const draft = project.begin(), author = binding.author(draft);
  const measured = author.constant({ kind: 'scalar', data: 3, unit: 'm', meaning: 'length' });
  const seconds = author.sample(measured, { times: [0, 30, 60], unit: 's' }, { id: 'seconds' });
  const minutes = author.sample(measured, { times: [0, 0.5, 1], unit: 'min' }, { id: 'minutes' });
  const coarse = author.sample(measured, { times: [0, 1], unit: 'min' }, { id: 'coarse' });
  const uncovered = author.sample(measured, { times: [0, 0.5, 0.75], unit: 'min' }, { id: 'short' });
  const giant = { symbol: 'giant-tick', dimensions: { time: 1 }, scale: 1e200 };
  const tiny = { symbol: 'tiny-tick', dimensions: { time: 1 }, scale: 1e-200 };
  author.sample(measured, { times: [1e-200, 2e-200], unit: giant }, { id: 'one-two-seconds' });
  author.sample(measured, { times: [3e200, 4e200], unit: tiny }, { id: 'three-four-seconds' });
  const alignment = { policy: 'linear', target: 'left' };
  author.arithmetic('subtract', seconds, minutes, { id: 'matching' });
  author.arithmetic('subtract', seconds, coarse, { id: 'interpolated', alignment });
  draft.accept();
  assert.deepEqual(binding.evaluate(project, 'matching').value.data, [0, 0, 0]);
  const interpolated = binding.evaluate(project, 'interpolated').value;
  assert.deepEqual(interpolated.coordinates.values, [0, 30, 60]);
  assert.ok(interpolated.metadata.warnings.some(w => w.code === 'INTERPOLATED'));
  for (const [left, right, options] of [['matching', 'coarse', {}], ['matching', uncovered.id, { alignment }],
    ['one-two-seconds', 'three-four-seconds', {}]]) {
    const invalid = project.begin();
    binding.author(invalid).arithmetic('subtract', left, right, options);
    assert.ok(invalid.validate().errors.some(error => error.code === 'SAMPLE_ALIGNMENT'));
  }
});
