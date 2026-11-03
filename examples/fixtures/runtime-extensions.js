// Trusted worker composition root. These stateful models are software tests only.
import { ExtensionRegistry } from '../../src/registry/index.js';
import { value, convertValue } from '../../src/dataflow/index.js';
import { registryExtensions } from './registry-extensions.js';

const RATE_UNIT = { symbol: '1/s', dimensions: { time: -1 }, scale: 1 };
const objectSchema = properties => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const stepSettings = {
  step: { type: 'number', minimum: 1e-4, maximum: 10, default: 0.25 },
  tolerance: { type: 'number', minimum: 0, maximum: 1e-8, default: 1e-12 },
};
const parameters = objectSchema({
  initial: { type: 'number', minimum: -1e6, maximum: 1e6, default: 0 },
});
const outputPort = {
  kind: 'scalar', shape: [], unit: '1', meaning: 'accumulated-value',
  reference: { $node: 'id' }, frame: null, normalization: null,
};
const sourcePort = {
  kind: 'scalar', shape: [], unit: RATE_UNIT, meaning: 'accumulation-rate',
  reference: null, frame: null, normalization: null, time: null,
};
const error = (code, message) => Object.assign(new Error(message), { code });
const seconds = time => convertValue(value({
  kind: 'scalar', data: time.value, unit: time.unit, meaning: 'physical-time',
}), 's').data;
const instant = time => ({ value: time, unit: 's' });
const unitWarning = {
  code: 'SOFTWARE_FIXTURE', path: '$',
  message: 'This accumulator verifies runtime behavior; it is not an astronomical or noise model.',
};

function rate(inputs) {
  if (!inputs.source || inputs.source.data === null) throw error('MISSING_DATA', 'The accumulator requires a finite constant rate.');
  return convertValue(inputs.source, RATE_UNIT).data;
}

function accumulatorValue(node, state, time, stochastic = false, request = null) {
  const warnings = [unitWarning];
  if (stochastic && request && seconds(request.time) > seconds(time)) warnings.push({
    code: 'FIXTURE_SAMPLE_BEFORE_REQUEST', path: 'time',
    message: 'The fixed-step fixture reports its last complete step before the requested time.',
  });
  return value({
    kind: 'scalar', data: state.value, unit: '1', meaning: 'accumulated-value',
    reference: node.id, time,
    metadata: {
      warnings,
      approximation: [stochastic
        ? 'Uniform pseudo-random increments on a fixed time lattice; not a physical noise model.'
        : 'Constant-rate stepping accumulator; a partial final step reaches the requested time.'],
    },
  });
}

function checkpoint({ state, random, time }) {
  return { version: 1, state, random, time };
}

function checkPayload(payload) {
  if (!payload || payload.version !== 1 || !payload.state || !Number.isFinite(payload.state.value)
      || !Number.isSafeInteger(payload.state.steps) || payload.state.steps < 0 || !payload.time) {
    throw error('FIXTURE_CHECKPOINT', 'The fixture checkpoint payload is malformed.');
  }
  if (seconds(payload.time) < 0) throw error('FIXTURE_CHECKPOINT', 'The fixture cannot restore before its initial time.');
}

function manifest(id, mode, summary, ports, runtime, equations, assumptions) {
  return {
    schemaVersion: 1, apiVersion: 1, id, version: '1.0.0',
    implementation: { id: `${id}.implementation`, version: '1.0.0', build: 'runtime-fixture-1' },
    kind: 'model', parameters, ports, dependencies: [],
    capabilities: ['runtime.stateful', ...(mode === 'hybrid' ? ['dataflow.sync'] : [])],
    documentation: { summary, links: [], examples: [{ parameters: { initial: 0 } }] },
    diagnostics: [
      { code: 'SOFTWARE_FIXTURE', description: unitWarning.message },
      { code: 'FIXTURE_CHECKPOINT', description: 'A checkpoint payload does not match the fixture state contract.' },
      { code: 'FIXTURE_SAMPLE_BEFORE_REQUEST', description: 'A fixed-lattice result precedes an off-lattice request.' },
      { code: 'MISSING_DATA', description: 'The deterministic accumulator has no valid constant rate.' },
    ],
    science: {
      equations, references: [{ title: 'Software fixture definition', locator: equations.join(' ') }],
      assumptions, applicability: [], evaluation: { mode, sampling: ['instant'] },
      review: {
        status: 'experimental',
        notes: 'Runtime software fixture. No astronomical interpretation or independent scientific review is claimed.',
        evidence: [],
      },
    },
    runtime,
  };
}

const deterministic = {
  manifest: manifest('fixture.accumulator', 'hybrid',
    'Compare an analytic constant-rate accumulator with bounded stateful steps.',
    { inputs: { source: sourcePort }, outputs: { value: outputPort } },
    {
      paths: ['analytic', 'stateful'], settings: objectSchema(stepSettings),
      stateful: { initialTime: instant(0), sampling: 'exact', random: { algorithm: null } },
    },
    ['x(t) = initial + rate × t.', 'A stateful step computes x_next = x + rate × dt.'],
    ['The rate input is timeless and has units 1/s.', 'Each step is bounded by settings.step in seconds.']),
  implementation: {
    evaluate({ node, inputs, request }) {
      return { value: accumulatorValue(node, {
        value: node.data.parameters.initial + rate(inputs) * seconds(request.time),
      }, request.time) };
    },
    stateful: {
      initialize({ node, inputs }) {
        rate(inputs);
        return { state: { value: node.data.parameters.initial, steps: 0 }, random: null, time: instant(0) };
      },
      advance({ inputs, settings, state, time, targetTime }) {
        const now = seconds(time), target = seconds(targetTime);
        if (target < now) throw error('FIXTURE_BACKWARD_STEP', 'Reset or restore an earlier checkpoint before advancing backward.');
        if (target === now) return { state, random: null, time, done: true };
        const next = Math.min(target, now + settings.step);
        return {
          state: { value: state.value + rate(inputs) * (next - now), steps: state.steps + 1 },
          random: null, time: instant(next), done: next === target,
        };
      },
      extract: ({ node, state, time }) => ({ value: accumulatorValue(node, state, time) }),
      checkpoint,
      restore({ checkpoint: saved }) {
        checkPayload(saved);
        if (saved.random !== null) throw error('FIXTURE_CHECKPOINT', 'The deterministic fixture has no random generator.');
        return { state: saved.state, random: null, time: saved.time };
      },
    },
  },
};

const stochastic = {
  manifest: manifest('fixture.seeded-accumulator', 'stateful',
    'Accumulate seeded pseudo-random increments on a fixed time lattice and preserve complete LCG state.',
    { inputs: {}, outputs: { value: outputPort } },
    {
      paths: ['stateful'],
      settings: objectSchema({
        ...stepSettings,
        seed: { type: 'integer', minimum: 0, maximum: 4294967295, default: 12345 },
      }),
      stateful: { initialTime: instant(0), sampling: 'at-or-before', random: { algorithm: 'lcg32' } },
    },
    ['s_next = (1664525 × s + 1013904223) mod 2^32; u = s_next / 2^32.', 'x_next = x + (u − 1/2).'],
    ['One pseudo-random draw is consumed per complete fixed time step.', 'This is a repeatability fixture, not a physical stochastic process.']),
  implementation: {
    stateful: {
      initialize({ node, settings }) {
        return {
          state: { value: node.data.parameters.initial, steps: 0 },
          random: { algorithm: 'lcg32', state: { value: settings.seed, draws: 0 } }, time: instant(0),
        };
      },
      advance({ settings, state, random, time, targetTime }) {
        const now = seconds(time), target = seconds(targetTime);
        if (target < now) throw error('FIXTURE_BACKWARD_STEP', 'Reset/replay or restore an earlier checkpoint; the generator is not reversed.');
        const nextTime = (state.steps + 1) * settings.step;
        if (nextTime > target) return { state, random, time, done: true };
        const nextState = (Math.imul(1664525, random.state.value) + 1013904223) >>> 0;
        const steps = state.steps + 1;
        return {
          state: { value: state.value + nextState / 4294967296 - 0.5, steps },
          random: { algorithm: 'lcg32', state: { value: nextState, draws: random.state.draws + 1 } },
          time: instant(nextTime), done: (steps + 1) * settings.step > target,
        };
      },
      extract: ({ node, state, time, request }) => ({ value: accumulatorValue(node, state, time, true, request) }),
      checkpoint,
      restore({ settings, checkpoint: saved }) {
        checkPayload(saved);
        const generator = saved.random;
        if (!generator || generator.algorithm !== 'lcg32' || !generator.state
            || !Number.isSafeInteger(generator.state.value) || generator.state.value < 0 || generator.state.value > 4294967295
            || generator.state.draws !== saved.state.steps
            || Math.abs(seconds(saved.time) - saved.state.steps * settings.step) > settings.tolerance) {
          throw error('FIXTURE_CHECKPOINT', 'Restore requires the full LCG algorithm, state, draw count, and step phase.');
        }
        return { state: saved.state, random: generator, time: saved.time };
      },
    },
  },
};

export const runtimeExtensions = [deterministic, stochastic];

/** Trusted entry point used by both the author's process and the runtime worker. */
export function createRegistry() {
  const registry = new ExtensionRegistry({
    capabilities: ['dataflow.sync', 'assets.data', 'views.data', 'runtime.analytic', 'runtime.stateful'],
  });
  for (const extension of [...registryExtensions, ...runtimeExtensions]) registry.register(extension);
  return registry;
}
