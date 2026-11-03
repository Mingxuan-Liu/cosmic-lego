// Run in the author's process: node examples/computation-runtime.mjs
// Physical sampling is independent of display cadence. These are software fixtures.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Project } from '../src/core/index.js';
import { value } from '../src/dataflow/index.js';
import { createRuntime } from '../src/runtime/index.js';
import { createRegistry } from './fixtures/runtime-extensions.js';

export const registryModule = new URL('./fixtures/runtime-extensions.js', import.meta.url);
const rateUnit = { symbol: '1/s', dimensions: { time: -1 }, scale: 1 };
const settings = {
  accumulator: { step: 0.25, tolerance: 1e-12 },
  noise: { step: 0.25, tolerance: 1e-12, seed: 12345 },
};

export function buildExample() {
  const registry = createRegistry();
  const binding = registry.bind();
  const project = new Project({
    id: 'runtime-fixtures', title: 'Analytic access, bounded steps, and reproducible resume',
    validators: binding.validators,
  });
  const draft = project.begin();
  const author = binding.author(draft);
  author.instantiate('fixture.moving-point', {
    id: 'analytic-point', parameters: { r0: [1, -2, 3], v: [2, -1, 0.5] },
  });
  const rate = author.constant(value({
    kind: 'scalar', data: 2.5, unit: rateUnit, meaning: 'accumulation-rate',
  }), { id: 'rate' });
  author.instantiate('fixture.accumulator', {
    id: 'accumulator', parameters: { initial: 1 }, inputs: { source: rate },
  });
  const noise = author.instantiate('fixture.seeded-accumulator', { id: 'noise' });
  const factor = author.constant(value({
    kind: 'scalar', data: 2, unit: '1', meaning: 'scale-factor',
  }), { id: 'factor' });
  author.arithmetic('multiply', noise, factor, { id: 'double-noise' });
  draft.accept();
  return { registry, binding, project };
}

async function snapshot(runtime, project, id, time, options = {}) {
  const job = runtime.submit(project, id, { time: { value: time, unit: 's' }, settings, ...options });
  const result = await job.promise;
  assert.equal(result.valid, true, `${id}: ${JSON.stringify(result.diagnostics)}`);
  assert.equal(job.status, 'completed');
  return result;
}

async function independent(project, id, time, options = {}) {
  const runtime = createRuntime({ registryModule });
  try { return await snapshot(runtime, project, id, time, options); }
  finally { await runtime.dispose(); }
}

export async function demonstrate() {
  const { project, binding } = buildExample();
  const runtime = createRuntime({ registryModule });
  try {
    const point = await snapshot(runtime, project, 'analytic-point', 2, { port: 'position' });
    assert.deepEqual(point.value.data, [5, -4, 4]);

    // A player can choose frame cadence without changing requested physical time.
    const displaySamples = [];
    for (const framesPerSecond of [24, 60]) {
      const frame = 2 * framesPerSecond;
      const sampled = await snapshot(runtime, project, 'analytic-point', frame / framesPerSecond, { port: 'position' });
      assert.deepEqual(sampled.value.data, point.value.data);
      displaySamples.push({ framesPerSecond, physicalTime: frame / framesPerSecond, position: sampled.value.data });
    }

    const analytic = await snapshot(runtime, project, 'accumulator', 2, { mode: 'analytic' });
    const stepped = await snapshot(runtime, project, 'accumulator', 2, { mode: 'stateful' });
    assert.equal(analytic.value.data, 6);
    assert.ok(Math.abs(stepped.value.data - analytic.value.data) <= 1e-12);
    assert.equal(stepped.metadata.runtime.path, 'stateful');
    const deterministicFirst = await snapshot(runtime, project, 'accumulator', 1, { mode: 'stateful' });
    const deterministicSequential = await snapshot(runtime, project, 'accumulator', 2, { mode: 'stateful' });
    const deterministicResumed = await independent(project, 'accumulator', 2, {
      mode: 'stateful', checkpoints: deterministicFirst.checkpoints,
    });
    assert.ok(Math.abs(deterministicSequential.value.data - stepped.value.data) <= 1e-12);
    assert.ok(Math.abs(deterministicResumed.value.data - stepped.value.data) <= 1e-12);

    const first = await snapshot(runtime, project, 'noise', 1);
    const sequential = await snapshot(runtime, project, 'noise', 2);
    const fresh = await independent(project, 'noise', 2);
    const resumed = await independent(project, 'noise', 2, { checkpoints: first.checkpoints });
    assert.deepEqual(sequential.value, fresh.value);
    assert.deepEqual(resumed.value, fresh.value);
    assert.equal(sequential.metadata.runtime.components[0].strategy, 'checkpoint');
    assert.equal(resumed.metadata.runtime.components[0].strategy, 'checkpoint');
    const generator = resumed.checkpoints[0].random;
    assert.equal(generator.algorithm, 'lcg32');
    assert.equal(generator.state.draws, 8);
    assert.equal(generator.state.value, 2355140353);
    assert.equal(fresh.value.data, -0.7182601829990745);

    // A compatible future checkpoint triggers reset/replay for a backward seek.
    const rewound = await snapshot(runtime, project, 'noise', 0.5);
    const freshEarly = await independent(project, 'noise', 0.5);
    assert.deepEqual(rewound.value, freshEarly.value);
    assert.equal(rewound.metadata.runtime.components[0].strategy, 'reset-replay');

    const offLattice = await snapshot(runtime, project, 'noise', 1.1);
    assert.equal(offLattice.metadata.runtime.requestedTime.value, 1.1);
    assert.equal(offLattice.metadata.runtime.achievedTime.value, 1);
    assert.equal(offLattice.value.time.value, 1);
    assert.ok(offLattice.diagnostics.some(diagnostic => diagnostic.code === 'TIME_APPROXIMATION'));
    const derived = await snapshot(runtime, project, 'double-noise', 2);
    assert.equal(derived.value.data, 2 * fresh.value.data);
    assert.equal(derived.value.time.value, 2);
    assert.ok(derived.diagnostics.some(diagnostic => diagnostic.code === 'SOFTWARE_FIXTURE'));

    // Checkpoint data is reusable after an explicit compatible reopen. The new
    // result receives the new load identity; the checkpoint never authorizes edits.
    const reopened = Project.from(JSON.parse(JSON.stringify(project.snapshot())), { validators: binding.validators });
    const restoredLoad = await independent(reopened, 'noise', 2, { checkpoints: first.checkpoints });
    assert.deepEqual(restoredLoad.value, fresh.value);
    assert.equal(restoredLoad.identity.generation, reopened.token.generation);
    assert.notEqual(restoredLoad.identity.generation, first.identity.generation);

    return {
      displaySamples,
      deterministic: {
        analytic: analytic.value.data, stepped: stepped.value.data,
        sequential: deterministicSequential.value.data, resumed: deterministicResumed.value.data,
        steps: stepped.metadata.runtime.steps,
      },
      stochastic: {
        fresh: fresh.value.data, sequential: sequential.value.data, resumed: resumed.value.data,
        generator, rewind: rewound.value.data,
      },
      offLattice: {
        requestedSeconds: offLattice.metadata.runtime.requestedTime.value,
        achievedSeconds: offLattice.metadata.runtime.achievedTime.value,
        warningCodes: offLattice.diagnostics.map(diagnostic => diagnostic.code),
      },
      derived: { data: derived.value.data, physicalSeconds: derived.value.time.value },
      checkpointReopen: { projectId: restoredLoad.identity.projectId, freshGeneration: true },
      measuredJobMilliseconds: {
        analytic: point.metadata.runtime.elapsedMs,
        stepped: stepped.metadata.runtime.elapsedMs,
        checkpointResume: resumed.metadata.runtime.elapsedMs,
      },
    };
  } finally { await runtime.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await demonstrate(), null, 2));
}
