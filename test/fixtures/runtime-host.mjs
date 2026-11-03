// Trusted test-only composition root. The CPU marker is deliberately outside
// project execution: tests install this module, and no project can choose it.
import { writeFileSync } from 'node:fs';
import { value } from '../../src/dataflow/index.js';
import { createRegistry as fixtureRegistry } from '../../examples/fixtures/runtime-extensions.js';

const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const descriptor = { kind: 'scalar', shape: [], unit: '1', meaning: 'software-test-value', reference: null, frame: null, normalization: null };
const result = (data = 1, time = null) => ({ value: value({ ...descriptor, data, time }) });

function manifest(id, mode, properties) {
  return {
    schemaVersion: 1, apiVersion: 1, id, version: '1.0.0',
    implementation: { id: `${id}.implementation`, version: '1.0.0', build: 'runtime-test-1' },
    kind: 'model', parameters: schema(properties), ports: { inputs: {}, outputs: { value: descriptor } },
    dependencies: [], capabilities: [mode === 'stateful' ? 'runtime.stateful' : 'runtime.analytic'],
    documentation: { summary: 'Independent bounded-runtime software fixture.', links: [], examples: [{ parameters: {} }] },
    diagnostics: [],
    science: { equations: ['A test-only constant output.'], references: [{ title: 'Test implementation', locator: 'test/fixtures/runtime-host.mjs' }],
      assumptions: ['Software lifecycle probe; no physical model.'], applicability: [],
      evaluation: { mode, sampling: ['instant'] }, review: { status: 'experimental', notes: 'Test-only lifecycle fixture.', evidence: [] } },
    runtime: { paths: [mode === 'stateful' ? 'stateful' : 'analytic'], settings: schema({}),
      ...(mode === 'stateful' ? { stateful: { initialTime: { value: 0, unit: 's' }, sampling: 'exact', random: { algorithm: null } } } : {}) },
  };
}

const storageLifecycle = {
  initialize: ({ node }) => ({ state: { entries: Array(node.data.parameters.entries).fill(1) }, random: null, time: { value: 0, unit: 's' } }),
  advance: ({ state, random, targetTime }) => ({ state, random, time: targetTime, done: true }),
  extract: ({ state, time }) => result(state.entries.length, time),
  checkpoint: ({ state, random, time }) => ({ state, random, time }),
  restore: ({ checkpoint }) => checkpoint,
};

export function createRegistry() {
  const registry = fixtureRegistry();
  registry.register({
    manifest: manifest('test.runtime.cpu', 'analytic', {
      durationMs: { type: 'integer', minimum: 1, maximum: 60000, default: 20000 },
      startedFile: { type: 'string', default: '' },
    }),
    implementation: { evaluate({ node, request }) {
      if (node.data.parameters.startedFile) writeFileSync(node.data.parameters.startedFile, 'callback-entered');
      const until = Date.now() + node.data.parameters.durationMs;
      while (Date.now() < until) { /* Real CPU-bound callback; worker termination must preempt it. */ }
      return result(1, request.time);
    } },
  });
  registry.register({
    manifest: manifest('test.runtime.storage', 'stateful', { entries: { type: 'integer', minimum: 0, maximum: 10000, default: 64 } }),
    implementation: { stateful: storageLifecycle },
  });
  registry.register({
    manifest: manifest('test.runtime.no-progress', 'stateful', { entries: { type: 'integer', minimum: 0, maximum: 10000, default: 1 } }),
    implementation: { stateful: { ...storageLifecycle,
      advance: ({ state, random, time }) => ({ state, random, time, done: false }),
    } },
  });
  registry.register({
    manifest: manifest('test.runtime.inert-text', 'analytic', { source: { type: 'string', default: '' } }),
    implementation: { evaluate: ({ request }) => result(1, request.time) },
  });
  registry.register({
    manifest: {
      schemaVersion: 1, apiVersion: 1, id: 'test.runtime.display', version: '1.0.0',
      implementation: { id: 'test.runtime.display.implementation', version: '1.0.0', build: 'runtime-test-1' },
      kind: 'view-adapter', parameters: schema({ frameRate: { type: 'integer', minimum: 1, maximum: 240, default: 24 } }),
      ports: { inputs: {}, outputs: {} }, dependencies: [], capabilities: ['views.data'],
      documentation: { summary: 'Declarative display frame-rate fixture.', links: [], examples: [{ parameters: {} }] },
      diagnostics: [], artifact: { kind: 'view', format: 'test.display', schema: schema({ frameRate: { type: 'integer' } }),
        provenance: { source: 'Original runtime test display fixture', license: 'BSD-3-Clause' } },
    },
    implementation: { create: ({ node }) => ({ frameRate: node.data.parameters.frameRate }) },
  });
  return registry;
}
