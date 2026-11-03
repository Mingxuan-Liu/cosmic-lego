import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Project } from '../src/core/index.js';
import { value, unit } from '../src/dataflow/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';

const capabilities = ['dataflow.sync', 'assets.data', 'views.data'];
const objectSchema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const triple = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } };
const contract = (kind, units, meaning, options = {}) => ({
  kind, shape: kind === 'scalar' ? [] : [3], unit: units, meaning,
  reference: null, frame: null, normalization: null, ...options,
});
const pin = manifest => ({ id: manifest.id, version: manifest.version, implementation: manifest.implementation });
const science = (equation = 'A finite deterministic software fixture.') => ({
  equations: [equation], references: [{ title: 'Independent fixture specification', locator: 'test/registry.test.js' }],
  assumptions: ['Software contract fixture; no astronomical interpretation.'], applicability: [],
  evaluation: { mode: 'analytic', sampling: ['instant'] },
  review: { status: 'experimental', notes: 'Local test declaration, not external scientific review.', evidence: [] },
});

function manifest(id, kind, overrides = {}) {
  return {
    schemaVersion: 1, apiVersion: 1, id, version: '1.0.0',
    implementation: { id: `${id}.implementation`, version: '1.0.0', build: 'fixture-build-1' },
    kind, parameters: objectSchema({}), ports: { inputs: {}, outputs: {} }, dependencies: [],
    capabilities: [kind === 'model' || kind === 'operator' ? 'dataflow.sync' : kind === 'asset-factory' ? 'assets.data' : 'views.data'],
    documentation: { summary: `Independent ${kind} fixture.`, links: [{ title: 'Fixture documentation', url: 'https://example.org/fixture' }], examples: [{ parameters: {} }] },
    diagnostics: [], ...overrides,
  };
}

function pointPorts(node) {
  return {
    position: contract('vector', 'm', 'position', { reference: node.id, frame: { id: node.data.parameters.frame, kind: 'position' } }),
    velocity: contract('vector', 'm/s', 'velocity', { reference: node.id, frame: { id: node.data.parameters.frame, kind: 'direction' } }),
  };
}

function pointExtension(id = 'test.point') {
  const scientific = science('r(t) = origin + velocity * t');
  scientific.applicability = [{ id: 'speed-limit', description: 'Fixture speed must not exceed 10 m/s.' }];
  const record = {
    manifest: manifest(id, 'model', {
      parameters: objectSchema({
        origin: { ...triple, default: [0, 0, 0] },
        velocity: { ...triple, default: [1, 0, 0] }, frame: { type: 'string', default: 'lab' },
      }),
      ports: { inputs: {}, outputs: {
        position: contract('vector', 'm', 'position', { reference: { $node: 'id' }, frame: { id: { $param: 'frame' }, kind: 'position' } }),
        velocity: contract('vector', 'm/s', 'velocity', { reference: { $node: 'id' }, frame: { id: { $param: 'frame' }, kind: 'direction' } }),
      } },
      diagnostics: [{ code: 'SPEED_LIMIT', description: 'The software fixture exceeds its declared speed bound.' }], science: scientific,
    }),
    implementation: {
      guards: { 'speed-limit': node => Math.hypot(...node.data.parameters.velocity) <= 10 ? []
        : [{ code: 'SPEED_LIMIT', path: 'parameters.velocity', message: 'Use speed at most 10 m/s for this fixture.' }] },
      evaluate({ node, request }) {
        const { origin, velocity } = node.data.parameters;
        const seconds = request.time.value * unit(request.time.unit).scale;
        const ports = pointPorts(node);
        return {
          position: value({ ...ports.position, data: origin.map((coordinate, index) => coordinate + velocity[index] * seconds), time: request.time }),
          velocity: value({ ...ports.velocity, data: velocity, time: request.time }),
        };
      },
    },
    referenceCases: [],
  };
  const subject = { id: 'subject', data: { parameters: { frame: 'lab' } } };
  record.referenceCases = [
    { id: 'linear-reference', description: 'Known two-second displacement.', parameters: { velocity: [2, 0, 0] },
      request: { time: { value: 2, unit: 's' } }, expected: { outputs: {
        position: value({ ...pointPorts(subject).position, data: [4, 0, 0], time: { value: 2, unit: 's' } }),
        velocity: value({ ...pointPorts(subject).velocity, data: [2, 0, 0], time: { value: 2, unit: 's' } }),
      } }, tolerance: { absolute: 1e-12, relative: 1e-12 } },
    { id: 'applicability-failure', description: 'The declared fixture speed guard rejects 11 m/s.', parameters: { velocity: [11, 0, 0] },
      expectedError: 'SPEED_LIMIT', tolerance: { absolute: 0, relative: 0 } },
  ];
  return record;
}

function magnitudeExtension(id = 'test.magnitude') {
  return {
    manifest: manifest(id, 'operator', {
      parameters: objectSchema({ target: { type: 'string', default: 'point' }, frame: { type: 'string', default: 'lab' } }),
      ports: {
        inputs: { source: contract('vector', 'm/s', 'velocity', { reference: { $param: 'target' }, frame: { id: { $param: 'frame' }, kind: 'direction' } }) },
        outputs: { value: contract('scalar', 'm/s', 'speed', { reference: { $param: 'target' } }) },
      }, science: { ...science('speed = sqrt(vx^2 + vy^2 + vz^2)'), evaluation: { mode: 'stateless', sampling: ['instant'] } },
    }),
    implementation: { evaluate: ({ node, inputs }) => ({ value: value({ kind: 'scalar', data: Math.hypot(...inputs.source.data),
      unit: 'm/s', meaning: 'speed', reference: node.data.parameters.target, time: inputs.source.time }) }) },
    referenceCases: [{ id: 'three-four-five', description: 'Independent Pythagorean reference.', parameters: { target: 'source' },
      inputs: { source: value({ ...contract('vector', 'm/s', 'velocity', { reference: 'source', frame: { id: 'lab', kind: 'direction' } }), data: [3, 4, 0] }) },
      expected: { outputs: { value: value({ kind: 'scalar', data: 5, unit: 'm/s', meaning: 'speed', reference: 'source' }) } },
      tolerance: { absolute: 1e-12, relative: 1e-12 } }],
  };
}

function geometryExtension(id = 'test.geometry') {
  return {
    manifest: manifest(id, 'asset-factory', {
      parameters: objectSchema({ radius: { type: 'number', minimum: 0.01, maximum: 100, default: 1 } }),
      artifact: { kind: 'geometry', format: 'test.geometry.v1', schema: objectSchema({ radius: { type: 'number' }, vertices: { type: 'array', items: triple, minItems: 3, maxItems: 3 } }),
        provenance: { source: 'Original software fixture geometry', license: 'BSD-3-Clause' } },
    }),
    implementation: { create: ({ node }) => ({ radius: node.data.parameters.radius,
      vertices: [[node.data.parameters.radius, 0, 0], [0, node.data.parameters.radius, 0], [-node.data.parameters.radius, 0, 0]] }) },
    referenceCases: [{ id: 'radius-two', description: 'Three known geometry coordinates.', parameters: { radius: 2 },
      expected: { artifact: { radius: 2, vertices: [[2, 0, 0], [0, 2, 0], [-2, 0, 0]] } }, tolerance: { absolute: 0, relative: 0 } }],
  };
}

function viewExtension(id = 'test.view') {
  return {
    manifest: manifest(id, 'view-adapter', {
      parameters: objectSchema({ target: { type: 'string', default: 'point' }, markerScale: { type: 'number', minimum: 0.1, default: 1 } }),
      ports: { inputs: { position: contract('vector', 'm', 'position', { reference: { $param: 'target' }, frame: { id: 'lab', kind: 'position' } }) }, outputs: {} },
      dependencies: [{ id: 'test.geometry', version: '1.0.0', build: 'fixture-build-1' }],
      assets: { geometry: { kind: 'geometry', format: 'test.geometry.v1' } },
      artifact: { kind: 'view', format: 'test.view.v1', schema: objectSchema({ position: triple, radius: { type: 'number' }, markerScale: { type: 'number' } }),
        provenance: { source: 'Original fixture view mapping', license: 'BSD-3-Clause' } },
    }),
    implementation: { create: ({ node, inputs, assets }) => ({ position: inputs.position.data, radius: assets.geometry.data.radius, markerScale: node.data.parameters.markerScale }) },
    referenceCases: [{ id: 'bound-geometry', description: 'View receives a scientific position and declared geometry artifact.', parameters: { target: 'external', markerScale: 3 },
      inputs: { position: value({ ...contract('vector', 'm', 'position', { reference: 'external', frame: { id: 'lab', kind: 'position' } }), data: [1, 2, 3] }) },
      assets: { geometry: { extension: 'test.geometry', parameters: { radius: 2 } } },
      expected: { artifact: { position: [1, 2, 3], radius: 2, markerScale: 3 } }, tolerance: { absolute: 0, relative: 0 } }],
  };
}

function allFixtures() {
  const registry = new ExtensionRegistry({ capabilities });
  for (const record of [pointExtension(), magnitudeExtension(), geometryExtension(), viewExtension()]) registry.register(record);
  return registry;
}

function authored(registry = allFixtures()) {
  const binding = registry.bind();
  const project = new Project({ validators: binding.validators });
  const draft = project.begin(), author = binding.author(draft);
  const point = author.instantiate('test.point', { id: 'point', parameters: { velocity: [3, 4, 0] } });
  const magnitude = author.instantiate('test.magnitude', { id: 'speed', inputs: { source: { node: point, port: 'velocity' } } });
  const geometry = author.instantiate('test.geometry', { id: 'geometry', parameters: { radius: 2 } });
  const view = author.instantiate('test.view', { id: 'view', inputs: { position: { node: point, port: 'position' } }, assets: { geometry } });
  return { registry, binding, project, draft, author, point, magnitude, geometry, view };
}

function assertRejected(project, draft) {
  const snapshot = project.snapshot(), token = project.token;
  assert.throws(() => draft.accept());
  assert.deepEqual(project.snapshot(), snapshot);
  assert.deepEqual(project.token, token);
}

test('four independently registered extension kinds build real calculations and artifacts', () => {
  const { binding, project, draft } = authored();
  draft.accept();
  assert.equal(project.get('point').value.kind, 'component');
  assert.equal(project.get('speed').value.kind, 'calculation');
  assert.equal(project.get('geometry').value.kind, 'presentation');
  assert.equal(project.get('view').value.kind, 'presentation');
  const request = { time: { value: 2, unit: 's' } };
  const position = binding.evaluate(project, 'point', { ...request, port: 'position' });
  assert.equal(position.valid, true, JSON.stringify(position.diagnostics));
  assert.deepEqual(position.value.data, [6, 8, 0]);
  const speed = binding.evaluate(project, 'speed', request);
  assert.equal(speed.valid, true, JSON.stringify(speed.diagnostics));
  assert.equal(speed.value.data, 5);
  const geometry = binding.produce(project, 'geometry', request);
  assert.equal(geometry.valid, true, JSON.stringify(geometry.diagnostics));
  assert.deepEqual(geometry.artifact.data.vertices, [[2, 0, 0], [0, 2, 0], [-2, 0, 0]]);
  const view = binding.produce(project, 'view', request);
  assert.equal(view.valid, true, JSON.stringify(view.diagnostics));
  assert.deepEqual(view.artifact.data, { position: [6, 8, 0], radius: 2, markerScale: 1 });
  assert.equal(view.artifact.kind, 'view');
  assert.equal(view.artifact.format, 'test.view.v1');
  assert.equal(view.artifact.provenance.license, 'BSD-3-Clause');
  assert.deepEqual(view.identity, project.token);
  assert.deepEqual(project.get('point').value.data.extension, pin(pointExtension().manifest));
});

test('discovery exposes schemas, ports, dependencies, capabilities and declared review without functions', () => {
  const registry = allFixtures();
  const discovery = registry.discover();
  assert.equal(discovery.apiVersion, 1);
  assert.equal(discovery.extensions.length, 4);
  assert.deepEqual([...discovery.capabilities].sort(), [...capabilities].sort());
  const point = discovery.extensions.find(item => item.manifest.id === 'test.point');
  assert.deepEqual(point.manifest.parameters.properties.velocity.default, [1, 0, 0]);
  assert.deepEqual(point.manifest.ports.outputs.position.reference, { $node: 'id' });
  assert.equal(point.review.declaredStatus, 'experimental');
  assert.equal(point.review.independentlyVerified, false);
  assert.equal(point.contractTests, null);
  assert.ok(point.manifest.diagnostics.some(item => item.code === 'SPEED_LIMIT'));
  assert.equal(registry.discover({ kind: 'operator' }).extensions.length, 1);
  assert.equal(registry.discover({ kind: 'view-adapter' }).extensions[0].manifest.dependencies[0].id, 'test.geometry');
  function checkData(input) {
    assert.notEqual(typeof input, 'function');
    if (input && typeof input === 'object') Object.values(input).forEach(checkData);
  }
  checkData(discovery);
  point.manifest.parameters.properties.velocity.default[0] = 999;
  assert.deepEqual(registry.discover().extensions.find(item => item.manifest.id === 'test.point').manifest.parameters.properties.velocity.default, [1, 0, 0]);
});

test('defaults are applied as detached project data and parameter schemas reject invalid edits', () => {
  const registry = allFixtures(), binding = registry.bind();
  const project = new Project({ validators: binding.validators });
  const draft = project.begin(), author = binding.author(draft);
  author.instantiate('test.point', { id: 'point' });
  author.instantiate('test.geometry', { id: 'geometry' });
  draft.accept();
  assert.deepEqual(project.get('point').value.data.parameters, { origin: [0, 0, 0], velocity: [1, 0, 0], frame: 'lab' });
  assert.equal(project.get('geometry').value.data.parameters.radius, 1);
  for (const parameters of [{ radius: -1 }, { radius: 1, unknown: true }, { radius: 'large' }]) {
    const edit = project.begin();
    const old = edit.get('geometry').value;
    edit.get('geometry').set({ data: { ...old.data, parameters } });
    assertRejected(project, edit);
  }
});

test('the same declared applicability guard protects author acceptance and contract tests', () => {
  const registry = allFixtures(), binding = registry.bind();
  const project = new Project({ validators: binding.validators });
  const draft = project.begin();
  const point = binding.author(draft).instantiate('test.point', { id: 'point' });
  point.set({ data: { ...point.value.data, parameters: { ...point.value.data.parameters, velocity: [11, 0, 0] } } });
  assert.ok(draft.validate().errors.some(item => item.code === 'SPEED_LIMIT'));
  assertRejected(project, draft);
  const report = registry.runContractTests('test.point');
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.ok(report.cases.some(item => item.id === 'applicability-failure' && item.passed));
  assert.equal(report.scientificCertification, false);
});

test('duplicate identities and unsupported schema/API/version declarations leave registry unchanged', () => {
  const registry = new ExtensionRegistry({ capabilities });
  registry.register(pointExtension());
  const original = registry.discover();
  for (const make of [
    () => pointExtension(),
    () => { const record = pointExtension('test.schema'); record.manifest.schemaVersion = 2; return record; },
    () => { const record = pointExtension('test.api'); record.manifest.apiVersion = 2; return record; },
    () => { const record = pointExtension('test.range'); record.manifest.version = '^1.0.0'; return record; },
    () => { const record = pointExtension('test.short-version'); record.manifest.version = '1.0'; return record; },
    () => { const record = pointExtension('test.implementation'); record.manifest.implementation.version = 'latest'; return record; },
    () => { const record = pointExtension(); record.manifest.version = '2.0.0'; return record; },
  ]) {
    assert.throws(() => registry.register(make()));
    assert.deepEqual(registry.discover(), original);
  }
});

test('registration checks exact dependencies, build identities and runtime capabilities', () => {
  const missing = new ExtensionRegistry({ capabilities });
  assert.throws(() => missing.register(viewExtension()));
  assert.equal(missing.discover().extensions.length, 0);
  missing.register(geometryExtension());
  for (const dependency of [{ id: 'test.geometry', version: '2.0.0' }, { id: 'test.geometry', version: '1.0.0', build: 'wrong-build' }]) {
    const record = viewExtension();
    record.manifest.dependencies = [dependency];
    assert.throws(() => missing.register(record));
    assert.equal(missing.discover().extensions.length, 1);
  }
  missing.register(viewExtension());
  const incapable = new ExtensionRegistry({ capabilities: ['dataflow.sync'] });
  assert.throws(() => incapable.register(geometryExtension()));
  assert.equal(incapable.discover().extensions.length, 0);
});

test('manifest guard declarations and implementation guard functions must agree', () => {
  for (const modify of [
    record => { record.implementation.guards = {}; },
    record => { record.implementation.guards.unlisted = () => []; },
    record => { record.manifest.science = undefined; },
  ]) {
    const registry = new ExtensionRegistry({ capabilities });
    const record = pointExtension();
    modify(record);
    assert.throws(() => registry.register(record));
    assert.equal(registry.discover().extensions.length, 0);
  }
});

test('all registered node kinds require exact saved extension pins at acceptance', () => {
  const { binding, project, draft } = authored();
  draft.accept();
  const original = project.snapshot();
  for (const id of ['point', 'speed', 'geometry', 'view']) {
    for (const mutation of [
      data => { delete data.extension; },
      data => { data.extension.version = '9.0.0'; },
      data => { data.extension.implementation.build = 'different-build'; },
      data => { data.extension.id = 'test.unavailable'; },
    ]) {
      const edit = project.begin();
      const data = edit.get(id).value.data;
      mutation(data);
      edit.get(id).set({ data });
      assertRejected(project, edit);
    }
  }
  assert.deepEqual(project.snapshot(), original);
  assert.equal(binding.requirements(original).valid, true);
});

test('using the lower-level dataflow author cannot bypass registry pins', () => {
  const registry = allFixtures(), binding = registry.bind();
  const project = new Project({ validators: binding.validators });
  const draft = project.begin();
  binding.flow.author(draft).component('test.point', { id: 'point', parameters: { origin: [0, 0, 0], velocity: [1, 0, 0], frame: 'lab' } });
  assertRejected(project, draft);
});

test('incompatible scientific and visual input ports reject before acceptance', () => {
  for (const badTarget of ['speed', 'view']) {
    const { project, draft } = authored();
    const old = draft.get(badTarget).value;
    draft.get(badTarget).set({ data: { ...old.data, parameters: { ...old.data.parameters, target: 'some-other-point' } } });
    assertRejected(project, draft);
    assert.ok(draft.validate().errors.some(item => item.code === 'REFERENCE_MISMATCH'));
  }
});

test('missing installed extensions remain inspectable requirements and cannot load as valid placeholders', () => {
  const original = authored();
  original.draft.accept();
  const empty = new ExtensionRegistry({ capabilities });
  const requirements = empty.inspectRequirements(original.project.snapshot());
  assert.equal(requirements.valid, false);
  assert.equal(requirements.requirements.length, 4);
  assert.ok(requirements.requirements.every(item => item.available === false && item.nodeIds.length === 1));
  assert.ok(requirements.requirements.some(item => item.id === 'test.point' && item.version === '1.0.0'));
  assert.throws(() => Project.from(original.project.snapshot(), { validators: empty.bind().validators }));
  const unchecked = Project.from(original.project.snapshot());
  const failed = empty.bind().evaluate(unchecked, 'point', { port: 'position' });
  assert.equal(failed.valid, false);
  assert.equal(failed.value, null);
});

test('registry bindings are immutable snapshots with deliberate adoption of later registrations', () => {
  const registry = new ExtensionRegistry({ capabilities });
  const old = registry.bind();
  const project = new Project({ validators: old.validators });
  assert.equal(old.inspect(project.snapshot()).valid, true);
  registry.register(pointExtension());
  const oldDraft = project.begin();
  assert.throws(() => old.author(oldDraft).instantiate('test.point', { id: 'point' }));
  const latest = registry.bind();
  const next = new Project({ validators: latest.validators });
  const nextDraft = next.begin();
  latest.author(nextDraft).instantiate('test.point', { id: 'point' });
  nextDraft.accept();
  assert.equal(latest.evaluate(next, 'point', { port: 'position' }).valid, true);
  assert.equal(old.requirements(next.snapshot()).valid, false);
  assert.throws(() => Project.from(next.snapshot(), { validators: old.validators }));
});

test('a pinned saved graph cannot silently reopen against another installed version or build', () => {
  const initialRegistry = new ExtensionRegistry({ capabilities });
  initialRegistry.register(pointExtension());
  const originalBinding = initialRegistry.bind(), original = new Project({ validators: originalBinding.validators });
  const draft = original.begin();
  originalBinding.author(draft).instantiate('test.point', { id: 'point' });
  draft.accept();
  const saved = original.snapshot();
  for (const change of ['version', 'build']) {
    const replacement = pointExtension();
    if (change === 'version') replacement.manifest.version = '2.0.0';
    else replacement.manifest.implementation.build = 'replacement-build';
    const registry = new ExtensionRegistry({ capabilities });
    registry.register(replacement);
    const inspected = registry.inspectRequirements(saved);
    assert.equal(inspected.valid, false);
    assert.equal(inspected.requirements[0].available, false);
    assert.ok(inspected.errors.some(item => item.code === (change === 'version' ? 'VERSION_MISMATCH' : 'IMPLEMENTATION_MISMATCH')));
    const binding = registry.bind();
    assert.throws(() => Project.from(saved, { validators: binding.validators }));
    const empty = new Project({ validators: binding.validators });
    const before = empty.snapshot(), token = empty.token;
    assert.throws(() => empty.load(saved, token));
    assert.deepEqual(empty.snapshot(), before);
    assert.deepEqual(empty.token, token);
  }
});

test('requirement discovery includes installed transitive dependencies that have no project nodes', () => {
  const registry = new ExtensionRegistry({ capabilities });
  registry.register(geometryExtension());
  const middle = geometryExtension('test.middle');
  middle.manifest.dependencies = [{ id: 'test.geometry', version: '1.0.0', build: 'fixture-build-1' }];
  registry.register(middle);
  const top = geometryExtension('test.top');
  top.manifest.dependencies = [{ id: 'test.middle', version: '1.0.0', build: 'fixture-build-1' }];
  registry.register(top);
  const binding = registry.bind(), project = new Project({ validators: binding.validators });
  const draft = project.begin();
  binding.author(draft).instantiate('test.top', { id: 'top' });
  binding.author(draft).instantiate('test.top', { id: 'second-top' });
  draft.accept();
  const requirements = binding.requirements(project.snapshot());
  assert.equal(requirements.valid, true);
  assert.deepEqual(requirements.requirements.map(item => item.id).sort(), ['test.geometry', 'test.middle', 'test.top']);
  assert.ok(requirements.requirements.every(item => item.available
    && item.nodeIds.includes('top') && item.nodeIds.includes('second-top')));
  assert.ok(requirements.requirements.find(item => item.id === 'test.geometry').dependencyOf.includes('test.middle'));
  // With no root manifest installed, the saved pin can identify the missing
  // root; it cannot invent that unavailable manifest's transitive requirements.
  const missing = new ExtensionRegistry({ capabilities }).inspectRequirements(project.snapshot());
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.requirements.map(item => item.id), ['test.top']);
  assert.deepEqual(missing.requirements[0].nodeIds.sort(), ['second-top', 'top']);
});

test('contract harness exercises all four extension kinds without promoting declared review', () => {
  const registry = allFixtures();
  for (const id of ['test.point', 'test.magnitude', 'test.geometry', 'test.view']) {
    const report = registry.runContractTests(id);
    assert.equal(report.extensionId, id);
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.ok(report.cases.length > 0 && report.cases.every(item => item.passed));
    assert.equal(report.scientificCertification, false);
    assert.equal(report.implementation.build, 'fixture-build-1');
    const discovered = registry.discover().extensions.find(item => item.manifest.id === id);
    assert.deepEqual(discovered.contractTests, report);
    assert.equal(discovered.review.independentlyVerified, false);
  }
  assert.equal(registry.discover().extensions.find(item => item.manifest.id === 'test.point').review.declaredStatus, 'experimental');
});

test('no supplied cases remain untested, and an unmet expected error reports the observed outcome', () => {
  const registry = new ExtensionRegistry({ capabilities });
  const empty = geometryExtension();
  empty.referenceCases = [];
  registry.register(empty);
  const untested = registry.runContractTests('test.geometry');
  assert.equal(untested.passed, false);
  assert.equal(untested.total, 0);
  assert.deepEqual(untested.cases, []);
  assert.equal(untested.scientificCertification, false);

  const record = pointExtension();
  record.referenceCases = [{ id: 'wrong-expected-error', description: 'A valid point must not fabricate a guard failure.',
    parameters: {}, expectedError: 'SPEED_LIMIT', tolerance: { absolute: 0, relative: 0 } }];
  registry.register(record);
  const report = registry.runContractTests('test.point');
  assert.equal(report.passed, false);
  assert.ok(report.cases[0].diagnostics.some(item => item.code === 'EXPECTED_ERROR' && item.message.includes('success')));
});

test('human-readable contract case labels do not become restricted project identifiers', () => {
  const record = magnitudeExtension();
  const label = `Independent reference / ${'long readable label '.repeat(12)} / 3-4-5`;
  record.referenceCases[0].id = label;
  const registry = new ExtensionRegistry({ capabilities });
  registry.register(record);
  const report = registry.runContractTests('test.magnitude');
  assert.equal(report.passed, true, JSON.stringify(report));
  assert.equal(report.cases[0].id, label);
});

test('a self-declared reviewed manifest remains a declaration with separately reported evidence', () => {
  const registry = new ExtensionRegistry({ capabilities });
  const record = pointExtension();
  record.manifest.science.review = { status: 'reviewed', notes: 'A test-only review declaration.',
    evidence: [{ title: 'Supplied fixture review', locator: 'local:fixture-review', reviewer: 'Fixture reviewer', date: '2026-11-03' }] };
  registry.register(record);
  const entry = registry.discover().extensions[0];
  assert.equal(entry.review.declaredStatus, 'reviewed');
  assert.equal(entry.review.independentlyVerified, false);
  assert.equal(entry.contractTests, null);
  registry.runContractTests('test.point');
  assert.equal(registry.discover().extensions[0].review.independentlyVerified, false);
});

test('contract tolerances are meaningful and a failing reference does not disappear into review metadata', () => {
  const record = magnitudeExtension();
  const passing = structuredClone(record.referenceCases[0]);
  passing.id = 'within-tolerance';
  passing.expected.outputs.value.data = 5.000001;
  passing.tolerance = { absolute: 0.00001, relative: 0 };
  const failing = structuredClone(record.referenceCases[0]);
  failing.id = 'outside-tolerance';
  failing.expected.outputs.value.data = 6;
  failing.tolerance = { absolute: 0.00001, relative: 0 };
  record.referenceCases = [passing, failing];
  const registry = new ExtensionRegistry({ capabilities });
  registry.register(record);
  const report = registry.runContractTests('test.magnitude');
  assert.equal(report.passed, false);
  assert.equal(report.cases.find(item => item.id === 'within-tolerance').passed, true);
  const failure = report.cases.find(item => item.id === 'outside-tolerance');
  assert.equal(failure.passed, false);
  assert.ok(failure.diagnostics.length > 0);
  assert.equal(registry.discover().extensions[0].review.independentlyVerified, false);
});

test('contract success requires scientific context as well as matching numerical data', () => {
  const record = magnitudeExtension();
  const wrongReference = structuredClone(record.referenceCases[0]);
  wrongReference.id = 'wrong-reference';
  wrongReference.expected.outputs.value.reference = 'another-source';
  const wrongUnit = structuredClone(record.referenceCases[0]);
  wrongUnit.id = 'wrong-unit';
  wrongUnit.expected.outputs.value.unit = unit('km/s');
  record.referenceCases = [wrongReference, wrongUnit];
  const registry = new ExtensionRegistry({ capabilities });
  registry.register(record);
  const report = registry.runContractTests('test.magnitude');
  assert.equal(report.passed, false);
  assert.ok(report.cases.every(item => item.passed === false && item.diagnostics.length > 0));
});

test('invalid artifact data fails its declared schema instead of becoming a valid visual result', () => {
  const registry = new ExtensionRegistry({ capabilities });
  const record = geometryExtension();
  record.implementation.create = () => ({ radius: 'not-a-number', vertices: [[1, 0, 0], [0, 1, 0], [-1, 0, 0]] });
  registry.register(record);
  const binding = registry.bind(), project = new Project({ validators: binding.validators });
  const draft = project.begin();
  binding.author(draft).instantiate('test.geometry', { id: 'geometry' });
  draft.accept();
  const original = project.snapshot(), token = project.token;
  const result = binding.produce(project, 'geometry');
  assert.equal(result.valid, false);
  assert.equal(result.artifact, null);
  assert.ok(result.diagnostics.some(item => item.code === 'ARTIFACT_SCHEMA'));
  assert.deepEqual(project.snapshot(), original);
  assert.deepEqual(project.token, token);
});

test('artifact inputs are immutable and returned artifact data is detached', () => {
  const registry = allFixtures(), binding = registry.bind();
  const original = authored(registry);
  original.draft.accept();
  const first = binding.produce(original.project, 'geometry');
  first.artifact.data.vertices[0][0] = 999;
  assert.equal(binding.produce(original.project, 'geometry').artifact.data.vertices[0][0], 2);

  const broken = viewExtension('test.mutating-view');
  broken.implementation.create = ({ assets }) => {
    assets.geometry.data.radius = 100;
    return { position: [0, 0, 0], radius: 100, markerScale: 1 };
  };
  registry.register(broken);
  const later = registry.bind(), project = Project.from(original.project.snapshot(), { validators: later.validators });
  const draft = project.begin();
  later.author(draft).instantiate('test.mutating-view', { id: 'mutator', inputs: { position: { node: 'point', port: 'position' } }, assets: { geometry: 'geometry' } });
  draft.accept();
  const result = later.produce(project, 'mutator');
  assert.equal(result.valid, false);
  assert.equal(result.artifact, null);
  assert.equal(later.produce(project, 'geometry').artifact.data.radius, 2);
});

test('artifact production cannot report success after a callback changes load generation', () => {
  let project;
  const registry = new ExtensionRegistry({ capabilities });
  const record = geometryExtension();
  const create = record.implementation.create;
  record.implementation.create = argument => {
    project.load(project.snapshot(), project.token);
    return create(argument);
  };
  registry.register(record);
  const binding = registry.bind();
  project = new Project({ validators: binding.validators });
  const draft = project.begin();
  binding.author(draft).instantiate('test.geometry', { id: 'geometry' });
  draft.accept();
  const captured = project.token;
  const result = binding.produce(project, 'geometry');
  assert.equal(result.valid, false);
  assert.equal(result.artifact, null);
  assert.deepEqual(result.identity, captured);
  assert.notEqual(project.token.generation, captured.generation);
  assert.ok(result.diagnostics.some(item => item.code === 'STALE_RESULT'));
});

test('a view factory is never called with stale scientific inputs', () => {
  let project, calls = 0;
  const registry = new ExtensionRegistry({ capabilities });
  const point = pointExtension(), evaluate = point.implementation.evaluate;
  point.implementation.evaluate = argument => {
    const result = evaluate(argument);
    project.load(project.snapshot(), project.token);
    return result;
  };
  const view = viewExtension(), create = view.implementation.create;
  view.implementation.create = argument => { calls++; return create(argument); };
  for (const record of [point, magnitudeExtension(), geometryExtension(), view]) registry.register(record);
  const arrangement = authored(registry);
  project = arrangement.project;
  arrangement.draft.accept();
  const originalToken = project.token;
  const result = arrangement.binding.produce(project, 'view');
  assert.equal(result.valid, false);
  assert.equal(result.artifact, null);
  assert.equal(calls, 0);
  assert.deepEqual(result.identity, originalToken);
  assert.ok(result.diagnostics.some(item => item.code === 'STALE_RESULT'));
});

test('asynchronous factories, thrown non-errors and executable return values fail closed', () => {
  for (const create of [
    async () => ({ radius: 1, vertices: [[1, 0, 0], [0, 1, 0], [-1, 0, 0]] }),
    () => { throw null; },
    () => ({ radius: 1, vertices: [[1, 0, 0], [0, 1, 0], [-1, 0, 0]], execute() {} }),
  ]) {
    const record = geometryExtension();
    record.implementation.create = create;
    const registry = new ExtensionRegistry({ capabilities });
    registry.register(record);
    const binding = registry.bind(), project = new Project({ validators: binding.validators });
    const draft = project.begin();
    binding.author(draft).instantiate('test.geometry', { id: 'geometry' });
    draft.accept();
    const original = project.snapshot(), token = project.token;
    const result = binding.produce(project, 'geometry');
    assert.equal(result.valid, false);
    assert.equal(result.artifact, null);
    assert.ok(result.diagnostics.length > 0);
    assert.deepEqual(project.snapshot(), original);
    assert.deepEqual(project.token, token);
  }
});

test('artifact relationships participate in reference checks, cascades and cycle validation', () => {
  const { binding, project, draft } = authored();
  draft.accept();
  const edit = project.begin();
  assert.throws(() => binding.author(edit).remove('geometry'));
  binding.author(edit).remove('geometry', { cascade: true });
  edit.accept();
  assert.deepEqual(project.snapshot().nodes.map(node => node.id).sort(), ['point', 'speed']);
  assert.equal(binding.evaluate(project, 'speed').value.data, 5);

  const cyclic = geometryExtension('test.nested-geometry');
  cyclic.manifest.assets = { child: { kind: 'geometry', format: 'test.geometry.v1' } };
  const registry = new ExtensionRegistry({ capabilities });
  registry.register(cyclic);
  const nested = registry.bind(), other = new Project({ validators: nested.validators });
  const staged = other.begin(), author = nested.author(staged);
  author.instantiate('test.nested-geometry', { id: 'a', assets: { child: 'b' } });
  author.instantiate('test.nested-geometry', { id: 'b', assets: { child: 'a' } });
  assertRejected(other, staged);
  assert.ok(staged.validate().errors.some(item => item.code === 'DEPENDENCY_CYCLE'));
});

test('ordinary reference-only relationship cycles remain usable with no extensions installed', () => {
  const binding = new ExtensionRegistry({ capabilities }).bind();
  const project = new Project({ validators: binding.validators });
  const draft = project.begin(), author = binding.author(draft);
  const a = author.constant(value({ kind: 'scalar', data: 1, unit: 'm', meaning: 'length' }), { id: 'a' });
  const b = author.constant(value({ kind: 'scalar', data: 2, unit: 'm', meaning: 'length' }), { id: 'b' });
  draft.connect('test.reference', a, b, { id: 'ab' });
  draft.connect('test.reference', b, a, { id: 'ba' });
  author.arithmetic('add', a, b, { id: 'sum' });
  draft.accept();
  assert.equal(binding.evaluate(project, 'sum').value.data, 3);
});

test('an artifact slot cannot silently consume a scientific model instead of its declared geometry', () => {
  const { project, draft } = authored();
  const view = draft.get('view').value;
  draft.get('view').set({ references: { ...view.references, 'asset.geometry': 'point' }, dependsOn: ['point'] });
  assertRejected(project, draft);
  assert.ok(draft.validate().errors.some(item => item.code === 'ARTIFACT_MISMATCH'));
});

test('registry size, harness case and artifact size limits fail explicitly', () => {
  const registry = new ExtensionRegistry({ capabilities, limits: { maxExtensions: 1 } });
  registry.register(pointExtension());
  assert.throws(() => registry.register(magnitudeExtension()));
  assert.equal(registry.discover().extensions.length, 1);
  const cases = new ExtensionRegistry({ capabilities, limits: { maxCases: 1 } });
  assert.throws(() => cases.register(pointExtension()));
  assert.equal(cases.discover().extensions.length, 0);
  const small = new ExtensionRegistry({ capabilities, limits: { maxArtifactEntries: 5 } });
  small.register(geometryExtension());
  const binding = small.bind(), project = new Project({ validators: binding.validators });
  const draft = project.begin();
  binding.author(draft).instantiate('test.geometry', { id: 'geometry' });
  draft.accept();
  const result = binding.produce(project, 'geometry');
  assert.equal(result.valid, false);
  assert.equal(result.artifact, null);
  assert.ok(result.diagnostics.some(item => item.code === 'ARTIFACT_BUDGET'));
});

test('registration captures supplied records without exposing mutable manifests or implementation maps', () => {
  const record = pointExtension();
  const registry = new ExtensionRegistry({ capabilities });
  registry.register(record);
  record.manifest.parameters.properties.velocity.default[0] = 999;
  record.implementation.evaluate = () => { throw new Error('Replaced caller implementation'); };
  const binding = registry.bind(), project = new Project({ validators: binding.validators });
  const draft = project.begin();
  binding.author(draft).instantiate('test.point', { id: 'point' });
  draft.accept();
  const result = binding.evaluate(project, 'point', { port: 'position', time: { value: 2, unit: 's' } });
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.value.data, [2, 0, 0]);
});

test('saved source-like strings cannot register, import or execute extension implementations', () => {
  delete globalThis.__registrySourceExecuted;
  const record = geometryExtension();
  record.manifest.parameters.properties.note = { type: 'string', default: '' };
  const registry = new ExtensionRegistry({ capabilities });
  registry.register(record);
  const binding = registry.bind(), project = new Project({ validators: binding.validators });
  const draft = project.begin();
  const source = 'globalThis.__registrySourceExecuted = true; import("file:///unknown-extension.mjs")';
  binding.author(draft).instantiate('test.geometry', { id: 'geometry', parameters: { note: source } });
  draft.accept();
  const loaded = Project.from(JSON.parse(JSON.stringify(project.snapshot())), { validators: binding.validators });
  assert.equal(binding.produce(loaded, 'geometry').valid, true);
  assert.equal(loaded.get('geometry').value.data.parameters.note, source);
  assert.equal(globalThis.__registrySourceExecuted, undefined);
  const noImplementation = geometryExtension('test.source-string');
  noImplementation.implementation.create = source;
  assert.throws(() => registry.register(noImplementation));
  assert.equal(registry.discover().extensions.length, 1);
  const missing = loaded.snapshot();
  const node = missing.nodes[0];
  node.type = 'test.uninstalled';
  node.data.extension.id = node.type;
  const inspected = registry.inspectRequirements(missing);
  assert.equal(inspected.valid, false);
  assert.equal(globalThis.__registrySourceExecuted, undefined);
  assert.throws(() => Project.from(missing, { validators: binding.validators }));
});

test('copied shared layers register and run local scientific/visual fixtures without domain files', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'cosmic-lego-registry-'));
  try {
    for (const name of ['core', 'dataflow', 'registry']) {
      cpSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), resolve(directory, 'src', name), { recursive: true });
    }
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    const standalone = manifest('isolated.scalar', 'model', {
      parameters: objectSchema({ amount: { type: 'number', default: 1 } }),
      ports: { inputs: {}, outputs: { value: contract('scalar', 'm', 'length') } }, science: science('value = amount'),
      documentation: { summary: 'Standalone injected scalar fixture.', links: [], examples: [{ parameters: { amount: 1 } }] },
    });
    const geometry = geometryExtension().manifest;
    geometry.documentation.examples = [{ parameters: { radius: 2 } }];
    writeFileSync(resolve(directory, 'probe.mjs'), `
      import { Project } from './src/core/index.js';
      import { value } from './src/dataflow/index.js';
      import { ExtensionRegistry } from './src/registry/index.js';
      const registry = new ExtensionRegistry({capabilities:['dataflow.sync','assets.data','views.data']});
      registry.register({manifest:${JSON.stringify(standalone)},implementation:{
        evaluate:({node})=>({value:value({kind:'scalar',data:node.data.parameters.amount,unit:'m',meaning:'length'})})
      }});
      registry.register({manifest:${JSON.stringify(geometry)},implementation:{
        create:({node})=>({radius:node.data.parameters.radius,vertices:[[2,0,0],[0,2,0],[-2,0,0]]})
      }});
      const binding=registry.bind(), project=new Project({validators:binding.validators});
      const draft=project.begin(), author=binding.author(draft);
      const scalar=author.instantiate('isolated.scalar',{id:'scalar'});
      const other=author.constant(value({kind:'scalar',data:250,unit:'cm',meaning:'length'}));
      author.arithmetic('subtract',scalar,other,{id:'difference'});
      author.instantiate('test.geometry',{id:'geometry',parameters:{radius:2}});
      draft.accept();
      const result=binding.evaluate(project,'difference'), artifact=binding.produce(project,'geometry');
      console.log(JSON.stringify({valid:result.valid&&artifact.valid,value:result.value?.data,
        radius:artifact.artifact?.data.radius,requirements:binding.requirements(project.snapshot()).valid,
        extensionCount:registry.discover().extensions.length}));
    `);
    const result = spawnSync(process.execPath, ['probe.mjs'], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { valid: true, value: -1.5, radius: 2, requirements: true, extensionCount: 2 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('registry imports remain within the shared layers and never resolve stored source', () => {
  const sourceRoot = realpathSync(fileURLToPath(new URL('../src', import.meta.url)));
  const permitted = ['core', 'dataflow', 'registry'].map(name => `${resolve(sourceRoot, name)}${sep}`);
  const visited = new Set();
  function inspect(file) {
    const path = realpathSync(file);
    if (visited.has(path)) return;
    visited.add(path);
    assert.ok(permitted.some(prefix => path.startsWith(prefix)), `Registry reaches non-shared source: ${path}`);
    const source = readFileSync(path, 'utf8');
    const imports = /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    for (const match of source.matchAll(imports)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith('node:')) continue;
      assert.ok(specifier.startsWith('.'), `Registry imports a package or external URL: ${specifier}`);
      inspect(resolve(dirname(path), specifier));
    }
    assert.doesNotMatch(source, /\b(?:import\s*\(\s*[^'"\s]|require\s*\(|eval\s*\(|new\s+Function\s*\()/);
  }
  inspect(resolve(sourceRoot, 'registry/index.js'));
});
