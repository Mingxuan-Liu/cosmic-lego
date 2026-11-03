import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { value } from '../src/dataflow/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { runComputation } from '../src/runtime/engine.js';
import { limitsOf } from '../src/runtime/contracts.js';

const object = (properties = {}, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const scalarPort = { kind: 'scalar', shape: [], unit: '1', meaning: 'software-number', reference: null, frame: null, normalization: null };
const number = (data, time = null) => value({ ...scalarPort, data, time });
function manifest(id, inputs, outputs, mode = 'analytic', settings = object()) {
  return {
    schemaVersion: 1, apiVersion: 1, id, version: '1.0.0',
    implementation: { id: `${id}.implementation`, version: '1.0.0', build: 'edge-tests-1' }, kind: 'model',
    parameters: object(), ports: { inputs, outputs }, dependencies: [], capabilities: [],
    documentation: { summary: 'Runtime edge-case software fixture.', links: [], examples: [{ parameters: {} }] }, diagnostics: [],
    science: {
      equations: ['A supplied scalar or sum of supplied scalars.'],
      references: [{ title: 'Software fixture definition', locator: 'test/runtime-edge.test.js' }],
      assumptions: ['Tests infrastructure only; no scientific model.'], applicability: [],
      evaluation: { mode, sampling: ['instant'] }, review: { status: 'experimental', notes: 'No scientific review claim.', evidence: [] },
    },
    runtime: { paths: [mode], settings, ...(mode === 'stateful' ? { stateful: { initialTime: { value: 0, unit: 's' }, sampling: 'exact', random: { algorithm: null } } } : {}) },
  };
}
function source(id, port, data, settings = object()) {
  return { manifest: manifest(id, {}, { [port]: scalarPort }, 'analytic', settings),
    implementation: { evaluate: ({ request }) => ({ [port]: number(data, request.time) }) } };
}
function initializedSum() {
  return {
    manifest: manifest('edge.initial-sum', { x: scalarPort, y: scalarPort }, { value: scalarPort }, 'stateful'),
    implementation: { stateful: {
      initialize: ({ inputs, request }) => ({ state: { sum: inputs.x.data + inputs.y.data }, random: null, time: request.time }),
      advance: ({ state, random, targetTime }) => ({ state, random, time: targetTime, done: true }),
      extract: ({ state, time }) => ({ value: number(state.sum, time) }),
      checkpoint: ({ state, random, time }) => ({ state, random, time }),
      restore: ({ checkpoint }) => checkpoint,
    } },
  };
}
function compute(registry, project, nodeId, request = {}) {
  return runComputation({ registry, graph: project.snapshot(), identity: project.token, nodeId,
    request: { port: 'value', time: { value: 0, unit: 's' }, mode: 'auto', settings: {}, ...request },
    cached: [], limits: limitsOf(), progress() {} });
}

test('runtime scientific memo keys distinguish allowed colons in node and port IDs', () => {
  const registry = new ExtensionRegistry()
    .register(source('edge.first', 'c', 1))
    .register(source('edge.second', 'b:c', 2))
    .register(initializedSum());
  const binding = registry.bind(), project = new Project({ validators: binding.validators }), draft = project.begin();
  const author = binding.author(draft);
  const first = author.instantiate('edge.first', { id: 'a:b' });
  const second = author.instantiate('edge.second', { id: 'a' });
  author.instantiate('edge.initial-sum', { id: 'sum', inputs: { x: { node: first, port: 'c' }, y: { node: second, port: 'b:c' } } });
  draft.accept();
  const result = compute(registry, project, 'sum');
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.value.data, 3, 'Different node/port tuples must not alias the same scientific snapshot.');
});

test('dependent ports and final extraction share one retained model snapshot at each physical time', () => {
  const calledAt = [];
  const upstream = {
    manifest: manifest('edge.multi-output', {}, { x: scalarPort, y: scalarPort }),
    implementation: { evaluate: ({ request }) => {
      calledAt.push(request.time.value * request.time.unit.scale);
      const sample = data => value({ ...scalarPort, data, time: request.time,
        metadata: { warnings: [{ code: 'SOFTWARE_INPUT', message: 'Test-only upstream warning.', path: 'source' }],
          approximation: ['The values are a software fixture.'] } });
      return { x: sample(1), y: sample(2) };
    } },
  };
  const registry = new ExtensionRegistry().register(upstream).register(initializedSum());
  const binding = registry.bind(), project = new Project({ validators: binding.validators }), draft = project.begin();
  const author = binding.author(draft), source = author.instantiate('edge.multi-output', { id: 'source' });
  author.instantiate('edge.initial-sum', { id: 'sum', inputs: { x: { node: source, port: 'x' }, y: { node: source, port: 'y' } } });
  draft.accept();
  const result = compute(registry, project, 'sum', { time: { value: 1, unit: 's' } });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.value.data, 3);
  assert.deepEqual(calledAt, [0, 1], 'All ports and consumers use the retained output map for each physical time.');
  assert.ok(result.diagnostics.some(warning => warning.code === 'SOFTWARE_INPUT'));
  assert.ok(result.value.metadata.approximation.includes('The values are a software fixture.'));
  assert.ok(result.checkpoints[0].metadata.warnings.some(warning => warning.code === 'SOFTWARE_INPUT'));
});

test('a job needs numerical settings only for its requested dependency closure', () => {
  const required = object({ tolerance: { type: 'number', minimum: 0 } });
  const registry = new ExtensionRegistry().register(source('edge.requested', 'value', 7))
    .register(source('edge.unrelated', 'value', 99, required));
  const binding = registry.bind(), project = new Project({ validators: binding.validators }), draft = project.begin();
  const author = binding.author(draft);
  author.instantiate('edge.requested', { id: 'requested' });
  author.instantiate('edge.unrelated', { id: 'unrelated' });
  draft.accept();
  const result = compute(registry, project, 'requested');
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(result.value.data, 7);
  assert.deepEqual(Object.keys(result.metadata.runtime.settings), ['requested']);
  const missing = compute(registry, project, 'unrelated');
  assert.equal(missing.valid, false);
  assert.ok(missing.diagnostics.some(error => error.code === 'RUNTIME_SETTINGS'));
  const configured = compute(registry, project, 'unrelated', { settings: { unrelated: { tolerance: 1e-6 } } });
  assert.equal(configured.valid, true, JSON.stringify(configured.diagnostics));
  assert.equal(configured.value.data, 99);
  const unknown = compute(registry, project, 'requested', { settings: { missing: {} } });
  assert.equal(unknown.valid, false);
  assert.ok(unknown.diagnostics.some(error => error.code === 'RUNTIME_SETTINGS'));
});
