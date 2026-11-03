import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { value, unit } from '../src/dataflow/index.js';
import { ExtensionRegistry, prepareManifest } from '../src/registry/index.js';

const object = (properties = {}, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const amount = (data, extra = {}) => value({ kind: 'scalar', data, unit: '1', meaning: 'software-accumulator', ...extra });
const output = { kind: 'scalar', shape: [], unit: '1', meaning: 'software-accumulator', reference: null, frame: null, normalization: null };
const lifecycle = () => ({
  initialize: () => ({ total: 0 }),
  advance: ({ state }) => ({ total: state.total + 1 }),
  extract: ({ state }) => ({ value: amount(state.total) }),
  checkpoint: ({ state }) => state,
  restore: ({ checkpoint }) => checkpoint,
});
function extension(mode = 'stateful', id = `runtime.${mode}`) {
  const paths = mode === 'hybrid' ? ['analytic', 'stateful'] : mode === 'stateful' ? ['stateful'] : ['analytic'];
  return {
    manifest: {
      schemaVersion: 1, apiVersion: 1, id, version: '1.0.0',
      implementation: { id: `${id}.implementation`, version: '1.0.0', build: 'registry-lifecycle-fixture-1' },
      kind: 'model', parameters: object(), ports: { inputs: {}, outputs: { value: output } },
      dependencies: [], capabilities: [], documentation: { summary: 'A registry lifecycle software fixture, not a numerical runtime.', links: [], examples: [{ parameters: {} }] }, diagnostics: [],
      science: {
        equations: ['total_next = total + 1'], references: [{ title: 'Fixture definition', locator: 'test/runtime-registry.test.js' }],
        assumptions: ['Software lifecycle registration only; no astronomical model.'], applicability: [],
        evaluation: { mode, sampling: ['instant'] }, review: { status: 'experimental', notes: 'No scientific review claimed.', evidence: [] },
      },
      runtime: {
        paths, settings: object({ step: { type: 'number', minimum: 0.01, maximum: 1, default: 0.25 } }),
        ...(paths.includes('stateful') ? { stateful: { initialTime: { value: 0, unit: 's' }, sampling: 'exact', random: { algorithm: null } } } : {}),
      },
    },
    implementation: {
      ...(paths.includes('analytic') ? { evaluate: () => ({ value: amount(3) }) } : {}),
      ...(paths.includes('stateful') ? { stateful: lifecycle() } : {}),
    },
    referenceCases: [{ id: 'synchronous-path', description: 'A plain registry binding cannot silently advance a stateful model.', expected: { outputs: { value: amount(3) } } }],
  };
}
function instantiate(binding, id) {
  const project = new Project({ validators: binding.validators });
  const draft = project.begin();
  binding.author(draft).instantiate(id, { id: 'subject' });
  draft.accept();
  return project;
}
const fails = (fn, code) => assert.throws(fn, error => !code || error.code === code);

test('legacy scientific manifests receive an explicit analytic runtime with empty settings', () => {
  for (const mode of ['analytic', 'stateless']) {
    const record = extension(mode); delete record.manifest.runtime;
    const prepared = prepareManifest(record.manifest);
    assert.deepEqual(prepared.runtime, { paths: ['analytic'], settings: object() });
    assert.ok(Object.isFrozen(prepared.runtime));
    const registry = new ExtensionRegistry().register(record);
    const binding = registry.bind();
    assert.equal(binding.evaluate(instantiate(binding, record.manifest.id), 'subject').value.data, 3);
  }
});

test('stateful and hybrid manifests retain normalized time, sampling, random algorithm and settings contracts', () => {
  const record = extension('hybrid');
  record.manifest.runtime.paths.reverse();
  record.manifest.runtime.stateful.initialTime = { value: 1, unit: 'min' };
  record.manifest.runtime.stateful.sampling = 'at-or-before';
  record.manifest.runtime.stateful.random.algorithm = 'lcg32';
  const prepared = prepareManifest(record.manifest);
  assert.deepEqual(prepared.runtime.paths, ['analytic', 'stateful']);
  assert.deepEqual(prepared.runtime.stateful.initialTime, { value: 1, unit: unit('min') });
  assert.equal(prepared.runtime.stateful.random.algorithm, 'lcg32');
  assert.equal(prepared.runtime.settings.properties.step.default, 0.25);
  assert.ok(Object.isFrozen(prepared.runtime.stateful.random));
});

test('runtime path metadata and scientific mode must agree before registration can change', () => {
  const registry = new ExtensionRegistry();
  const original = registry.discover();
  const invalid = [
    m => { delete m.runtime; }, m => { m.runtime.paths = []; },
    m => { m.runtime.paths = ['stateful', 'stateful']; }, m => { m.runtime.paths = ['unknown']; },
    m => { m.runtime.paths = ['analytic', 'stateful']; }, m => { delete m.runtime.stateful; },
    m => { delete m.runtime.settings; }, m => { m.runtime.settings.additionalProperties = true; },
    m => { m.runtime.settings.properties.step.default = -1; },
    m => { m.runtime.stateful.initialTime.unit = 'm'; },
    m => { m.runtime.stateful.initialTime = { value: Number.MAX_VALUE, unit: 'h' }; },
    m => { m.runtime.stateful.sampling = 'interpolate'; }, m => { delete m.runtime.stateful.random; },
    m => { m.runtime.stateful.random.algorithm = ''; }, m => { m.runtime.stateful.random.seed = 1; },
  ];
  for (const mutate of invalid) {
    const record = extension(); mutate(record.manifest);
    fails(() => registry.register(record));
    assert.deepEqual(registry.discover(), original);
  }
  const hybrid = extension('hybrid'); hybrid.manifest.runtime.paths = ['stateful'];
  fails(() => registry.register(hybrid), 'RUNTIME_CONTRACT');
  const analytic = extension('analytic'); analytic.manifest.runtime.stateful = extension().manifest.runtime.stateful;
  fails(() => registry.register(analytic), 'RUNTIME_CONTRACT');
});

test('registration requires exactly the synchronous callbacks declared by each runtime path', () => {
  for (const mutate of [
    implementation => { delete implementation.stateful.advance; },
    implementation => { implementation.stateful.extra = () => {}; },
    implementation => { implementation.stateful.initialize = 'stored source'; },
    implementation => { implementation.stateful.extract = async () => ({}); },
    implementation => { implementation.stateful.restore = function* () { yield {}; }; },
    implementation => { implementation.evaluate = () => ({ value: amount(0) }); },
    implementation => { implementation.create = () => ({}); },
  ]) {
    const record = extension(); mutate(record.implementation);
    const registry = new ExtensionRegistry();
    fails(() => registry.register(record));
    assert.equal(registry.discover().extensions.length, 0);
  }
  const hybrid = extension('hybrid'); delete hybrid.implementation.evaluate;
  fails(() => new ExtensionRegistry().register(hybrid));
  const analytic = extension('analytic'); analytic.implementation.stateful = lifecycle();
  fails(() => new ExtensionRegistry().register(analytic), 'RUNTIME_CONTRACT');
});

test('ordinary registry evaluation reports RUNTIME_REQUIRED without executing stateful callbacks', () => {
  const record = extension();
  let calls = 0;
  for (const key of Object.keys(record.implementation.stateful)) record.implementation.stateful[key] = () => { calls++; return {}; };
  const registry = new ExtensionRegistry().register(record);
  const binding = registry.bind();
  const project = instantiate(binding, record.manifest.id);
  const before = project.snapshot(), token = project.token;
  const result = binding.evaluate(project, 'subject');
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(d => d.code === 'RUNTIME_REQUIRED'));
  assert.equal(result.value, null);
  assert.equal(calls, 0);
  assert.deepEqual(project.snapshot(), before);
  assert.deepEqual(project.token, token);
  const report = registry.runContractTests(record.manifest.id);
  assert.equal(report.passed, false);
  assert.ok(report.cases[0].observedErrors.some(d => d.code === 'RUNTIME_REQUIRED'));
  assert.equal(calls, 0);
});

test('hybrid definitions keep legacy synchronous analytic evaluation and contract cases', () => {
  const record = extension('hybrid');
  let statefulCalls = 0;
  record.implementation.stateful.initialize = () => { statefulCalls++; return {}; };
  const registry = new ExtensionRegistry().register(record);
  const binding = registry.bind();
  assert.equal(binding.evaluate(instantiate(binding, record.manifest.id), 'subject').value.data, 3);
  assert.equal(registry.runContractTests(record.manifest.id).passed, true);
  assert.equal(statefulCalls, 0);
});

test('trusted scheduler hook receives frozen contracts and detached inputs through the existing output gate', () => {
  const record = extension();
  const registry = new ExtensionRegistry().register(record);
  let called = 0;
  const binding = registry.bind({ execute(argument) {
    called++;
    assert.deepEqual(Object.keys(argument).sort(), ['implementation', 'inputs', 'manifest', 'node', 'request']);
    assert.ok(Object.isFrozen(argument));
    assert.ok(Object.isFrozen(argument.node.data));
    assert.ok(Object.isFrozen(argument.inputs));
    assert.ok(Object.isFrozen(argument.manifest.runtime));
    assert.ok(Object.isFrozen(argument.implementation.stateful));
    assert.equal(argument.manifest.id, record.manifest.id);
    assert.equal(argument.node.id, 'subject');
    return argument.implementation.stateful.extract({ state: { total: 7 }, request: argument.request });
  } });
  const project = instantiate(binding, record.manifest.id);
  const result = binding.evaluate(project, 'subject');
  assert.equal(result.valid, true);
  assert.equal(result.value.data, 7);
  assert.equal(called, 1);
  assert.deepEqual(result.identity, project.token);
  assert.deepEqual(project.get('subject').value.data.parameters, {});
});

test('runtime hooks cannot bypass scientific output checks or become stored asynchronous executors', () => {
  const registry = new ExtensionRegistry().register(extension());
  for (const execute of [
    () => ({ value: amount(1, { unit: 'm' }) }),
    async () => ({ value: amount(1) }),
    () => ({ value: () => 'executable' }),
  ]) {
    const binding = registry.bind({ execute });
    const result = binding.evaluate(instantiate(binding, 'runtime.stateful'), 'subject');
    assert.equal(result.valid, false);
    assert.equal(result.value, null);
    assert.ok(result.diagnostics.length);
  }
  fails(() => registry.bind({ execute: 'import("unknown")' }), 'RUNTIME_CONTRACT');
});

test('scheduler computation records are frozen snapshots and discovery remains data only', () => {
  const record = extension();
  const extract = record.implementation.stateful.extract;
  const registry = new ExtensionRegistry().register(record);
  const binding = registry.bind();
  assert.ok(Object.isFrozen(binding.computations));
  assert.ok(Object.isFrozen(binding.computations[0]));
  assert.ok(Object.isFrozen(binding.computations[0].implementation.stateful));
  record.implementation.stateful.extract = () => ({ value: amount(99) });
  assert.equal(binding.computations[0].implementation.stateful.extract, extract);
  registry.register(extension('analytic'));
  assert.equal(binding.computations.length, 1);
  assert.equal(registry.bind().computations.length, 2);
  const discovery = registry.discover();
  assert.deepEqual(JSON.parse(JSON.stringify(discovery)), discovery);
  assert.equal(discovery.extensions[0].manifest.runtime.paths[0], 'stateful');
  assert.ok(discovery.diagnostics.includes('RUNTIME_REQUIRED'));
});

test('stateful runtime requirements retain existing explicit host capability checks', () => {
  const record = extension(); record.manifest.capabilities = ['runtime.stateful'];
  fails(() => new ExtensionRegistry().register(record), 'CAPABILITY_MISSING');
  const registry = new ExtensionRegistry({ capabilities: ['runtime.stateful'] }).register(record);
  assert.equal(registry.bind().computations[0].manifest.runtime.paths[0], 'stateful');
});

test('visual definitions cannot smuggle scientific runtime metadata or stateful callbacks', () => {
  const visual = extension('analytic');
  visual.manifest.kind = 'asset-factory';
  delete visual.manifest.science;
  visual.manifest.ports.outputs = {};
  visual.manifest.artifact = { kind: 'data', format: 'fixture.v1', schema: object(), provenance: { source: 'test', license: 'BSD-3-Clause' } };
  visual.implementation = { create: () => ({}) };
  fails(() => new ExtensionRegistry().register(visual));
  delete visual.manifest.runtime;
  visual.implementation.stateful = lifecycle();
  fails(() => new ExtensionRegistry().register(visual), 'EXTENSION_CONTRACT');
});
