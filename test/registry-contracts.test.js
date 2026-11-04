import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSchema, validateData, applyDefaults, SCHEMA_LIMITS } from '../src/registry/schema.js';
import { prepareManifest, resolvePorts, matchesVersion, API_VERSION, MANIFEST_VERSION } from '../src/registry/manifest.js';

const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const scalarPort = (patch = {}) => ({ kind: 'scalar', shape: [], unit: 'm', meaning: 'length', reference: null, frame: null, normalization: null, ...patch });
const manifest = () => ({
  schemaVersion: MANIFEST_VERSION, apiVersion: API_VERSION,
  id: 'fixture.offset', version: '1.0.0', implementation: { id: 'fixture.science', version: '1.0.0', build: 'fixture-build-1' },
  kind: 'model', parameters: object({ offset: { type: 'number', default: 0, minimum: -10, maximum: 10 } }),
  ports: { inputs: {}, outputs: { value: scalarPort({ reference: { $node: 'id' } }) } },
  dependencies: [], capabilities: ['dataflow.sync'],
  documentation: { summary: 'A software-contract offset fixture.', links: [{ title: 'Local fixture specification', url: 'https://example.org/fixture' }], examples: [{ parameters: { offset: 1 } }] },
  diagnostics: [{ code: 'OFFSET_LIMIT', description: 'Offset must stay within the fixture bound.' }],
  science: {
    equations: ['output = offset'], references: [{ title: 'Fixture equation', locator: 'test/registry-contracts.test.js' }],
    assumptions: ['Software contract fixture; no astronomical model.'], applicability: [],
    evaluation: { mode: 'analytic', sampling: ['instant'] },
    review: { status: 'experimental', notes: 'No scientific review claimed.', evidence: [] },
  },
});
const fails = (fn, code) => assert.throws(fn, error => !code || error.code === code);

test('parameter schemas validate bounds, precise types, enums and unknown fields', () => {
  const schema = object({
    radius: { type: 'number', minimum: 0, maximum: 10 }, count: { type: 'integer', minimum: 1 },
    mode: { type: 'string', enum: ['point', 'line'] }, enabled: { type: 'boolean' }, empty: { type: 'null' },
    position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
  }, ['radius', 'position']);
  assert.equal(validateSchema(schema).valid, true);
  assert.deepEqual(validateData(schema, { radius: 2, position: [1, 2, 3], count: 2, mode: 'point', enabled: false, empty: null }), []);
  for (const [input, code] of [
    [{ radius: -1, position: [1, 2, 3] }, 'SCHEMA_BOUND'],
    [{ radius: 1, position: [1, 2] }, 'SCHEMA_BOUND'],
    [{ radius: 1, position: [1, 2, 3], count: 1.5 }, 'SCHEMA_TYPE'],
    [{ radius: 1, position: [1, 2, 3], mode: 'unknown' }, 'SCHEMA_ENUM'],
    [{ radius: 1 }, 'SCHEMA_REQUIRED'],
    [{ radius: 1, position: [1, 2, 3], source: 'eval(1)' }, 'SCHEMA_EXTRA'],
  ]) assert.ok(validateData(schema, input).some(error => error.code === code));
});

test('default application is detached, recursive, explicit and never replaces supplied values', () => {
  const schema = object({
    position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, default: [0, 0, 0] },
    options: object({ visible: { type: 'boolean', default: true } }),
    level: { type: 'number', minimum: 0, default: 1 },
  });
  const source = { options: {}, level: 0 };
  const result = applyDefaults(schema, source);
  assert.deepEqual(result, { options: { visible: true }, level: 0, position: [0, 0, 0] });
  assert.deepEqual(source, { options: {}, level: 0 });
  result.position[0] = 7;
  assert.deepEqual(schema.properties.position.default, [0, 0, 0]);
  assert.equal(applyDefaults(schema, {}).options, undefined, 'Do not invent a missing optional object.');
  assert.equal(applyDefaults(schema, { level: -1 }).level, -1, 'Validation diagnoses invalid provided values; defaults do not hide them.');
});

test('unsupported schema execution features, malformed bounds and invalid defaults fail at registration', () => {
  for (const schema of [
    { type: 'string', pattern: '.*' }, { type: 'object', properties: {}, additionalProperties: true },
    { type: 'number', $ref: 'https://example.org/schema' }, { type: ['number', 'null'] },
    { type: 'array' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 2 },
    { type: 'number', minimum: 2, maximum: 1 }, { type: 'integer', default: 1.5 },
    { type: 'number', minimum: 1, default: 0 }, { type: 'string', enum: ['a', 'a'] },
    object({ count: { type: 'number' } }, ['missing']),
  ]) assert.equal(validateSchema(schema).valid, false, JSON.stringify(schema));
  fails(() => applyDefaults({ type: 'number', default: 'bad' }, 2), 'INVALID_SCHEMA');
});

test('schema and data traversal have explicit limits and never call accessors', () => {
  let nested = { type: 'number' };
  for (let i = 0; i < SCHEMA_LIMITS.schemaDepth + 1; i++) nested = { type: 'array', items: nested };
  assert.ok(validateSchema(nested).errors.some(error => error.code === 'SCHEMA_BUDGET'));
  let reads = 0;
  const input = {};
  Object.defineProperty(input, 'count', { enumerable: true, get() { reads++; return 1; } });
  assert.ok(validateData(object({ count: { type: 'number' } }), input).some(error => error.code === 'INVALID_DATA'));
  assert.equal(reads, 0);
});

test('manifest preparation preserves executable-looking text as inert, frozen metadata', () => {
  const source = manifest();
  source.documentation.summary = 'globalThis.__registrySourceRan = true';
  delete globalThis.__registrySourceRan;
  const normalized = prepareManifest(source);
  assert.equal(globalThis.__registrySourceRan, undefined);
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.parameters.properties.offset));
  source.parameters.properties.offset.default = 9;
  assert.equal(normalized.parameters.properties.offset.default, 0);
  const result = resolvePorts(normalized, { id: 'one', data: { parameters: { offset: 2 } } });
  assert.equal(result.outputs.value.reference, 'one');
  assert.deepEqual(result.outputs.value.unit, { symbol: 'm', dimensions: { length: 1 }, scale: 1 });
  assert.ok(Object.isFrozen(result.outputs.value));
});

test('documented author examples may rely on defaults while retaining their authored arguments', () => {
  const m = manifest();
  m.parameters.required = ['offset'];
  m.documentation.examples = [{ parameters: {} }];
  const prepared = prepareManifest(m);
  assert.deepEqual(prepared.documentation.examples[0].parameters, {});
  assert.deepEqual(applyDefaults(prepared.parameters, prepared.documentation.examples[0].parameters), { offset: 0 });
  delete m.parameters.properties.offset.default;
  fails(() => prepareManifest(m));
});

test('identity versions, unsupported schema/API versions and dependency duplicates fail explicitly', () => {
  assert.equal(matchesVersion('1.2.3', '1.2.3'), true);
  for (const version of ['^1.2.3', '1.2', '01.2.3', '1.2.3-beta', '2.2.3']) assert.equal(matchesVersion('1.2.3', version), false);
  for (const patch of [{ schemaVersion: 2 }, { apiVersion: 2 }]) fails(() => prepareManifest({ ...manifest(), ...patch }), 'UNSUPPORTED_VERSION');
  for (const id of ['unnamespaced', 'dataflow.private', '-bad']) fails(() => prepareManifest({ ...manifest(), id }));
  fails(() => prepareManifest({ ...manifest(), version: '^1.0.0' }), 'INVALID_VERSION');
  const duplicate = manifest(); duplicate.dependencies = [{ id: 'fixture.base', version: '1.0.0' }, { id: 'fixture.base', version: '1.0.0' }];
  fails(() => prepareManifest(duplicate));
  const self = manifest(); self.dependencies = [{ id: self.id, version: self.version }]; fails(() => prepareManifest(self));
});

test('manifest scientific metadata is complete and reviewed evidence remains a declared record', () => {
  for (const change of [
    m => { delete m.science; }, m => { m.science.equations = []; }, m => { m.science.references = []; },
    m => { m.science.assumptions = []; }, m => { m.science.evaluation.mode = 'stateful'; },
    m => { m.science.review.status = 'reviewed'; }, m => { m.documentation.summary = ''; },
  ]) { const m = manifest(); change(m); fails(() => prepareManifest(m)); }
  const reviewed = manifest(); reviewed.science.review = { status: 'reviewed', notes: 'A supplied review record, not registry certification.', evidence: [{ title: 'Contract review', locator: 'test/registry-contracts.test.js', reviewer: 'Fixture reviewer', date: '2026-11-03' }] };
  assert.equal(prepareManifest(reviewed).science.review.evidence[0].reviewer, 'Fixture reviewer');
  reviewed.science.review.evidence[0].date = '2026-02-30'; fails(() => prepareManifest(reviewed));
});

test('port templates resolve top-level parameters and own node IDs using existing scientific contracts', () => {
  const m = manifest();
  m.parameters = object({ unit: { type: 'string', enum: ['m', 'km'], default: 'm' }, frame: { type: 'string', default: 'lab' } }, ['unit', 'frame']);
  m.documentation.examples = [{ parameters: { unit: 'm', frame: 'lab' } }];
  m.ports.outputs.position = { kind: 'vector', shape: [3], unit: { $param: 'unit' }, meaning: 'position', reference: { $node: 'id' }, frame: { id: { $param: 'frame' }, kind: 'position' }, normalization: null };
  const normalized = prepareManifest(m);
  const result = resolvePorts(normalized, { id: 'point-a', data: { parameters: { unit: 'km', frame: 'room' } } });
  assert.equal(result.outputs.position.unit.scale, 1000);
  assert.deepEqual(result.outputs.position.frame, { id: 'room', kind: 'position' });
  assert.equal(result.outputs.position.reference, 'point-a');
  fails(() => resolvePorts(normalized, { id: 'point-a', data: { parameters: { unit: 's', frame: 'room' } } }), 'PARAMETERS');
});

test('binding mistakes and static descriptor mistakes reject registration despite other dynamic fields', () => {
  for (const change of [
    m => { m.ports.outputs.value.reference = { $node: 'projectId' }; },
    m => { m.ports.outputs.value.reference = { $param: 'missing' }; },
    m => { m.ports.outputs.value.reference = { $param: 'offset.x' }; },
    m => { m.ports.outputs.value.reference = { $node: 'id', extra: true }; },
    m => { m.ports.outputs.value.unit = 'not-a-unit'; },
    m => { m.ports.outputs.value.shape = [3]; },
    m => { delete m.ports.outputs.value.normalization; },
    m => { m.ports.outputs.value.source = 'eval("run")'; },
  ]) { const m = manifest(); change(m); fails(() => prepareManifest(m)); }
  const executable = manifest(); executable.parameters.properties.offset.default = () => 1;
  fails(() => prepareManifest(executable), 'INVALID_MANIFEST');
});

test('dynamic templates receive authoritative parameter and port validation per instance', () => {
  const m = manifest();
  m.parameters = object({ unit: { type: 'string' }, shape: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 1 } }, ['unit', 'shape']);
  m.documentation.examples = [{ parameters: { unit: 'm', shape: [3] } }];
  m.ports.outputs = { position: { kind: 'vector', shape: { $param: 'shape' }, unit: { $param: 'unit' }, meaning: 'position', reference: { $node: 'id' }, frame: { id: 'lab', kind: 'position' }, normalization: null } };
  const normalized = prepareManifest(m);
  assert.equal(resolvePorts(normalized, { id: 'point', data: { parameters: { unit: 'km', shape: [3] } } }).outputs.position.unit.scale, 1000);
  fails(() => resolvePorts(normalized, { id: 'point', data: { parameters: { unit: 's', shape: [3] } } }), 'UNIT_MISMATCH');
  fails(() => resolvePorts(normalized, { id: 'point', data: { parameters: { unit: 'm', shape: [2] } } }), 'SHAPE_MISMATCH');
  const dynamicField = structuredClone(m);
  dynamicField.parameters.properties.shape.minItems = 2;
  dynamicField.parameters.properties.shape.maxItems = 2;
  dynamicField.documentation.examples[0].parameters.shape = [1, 3];
  dynamicField.ports.outputs.position.kind = 'field';
  dynamicField.ports.outputs.position.frame.kind = 'direction';
  dynamicField.ports.outputs.position.coordinates = { kind: 'space', unit: 'm', frame: { id: 'lab', kind: 'position' }, values: [[0, 0, 0]] };
  const fieldManifest = prepareManifest(dynamicField);
  assert.deepEqual(resolvePorts(fieldManifest, { id: 'field', data: { parameters: { unit: 'm/s', shape: [1, 3] } } }).outputs.position.shape, [1, 3]);
});

test('visual artifact manifests keep artifacts and assets separate from scientific output ports', () => {
  const visual = manifest();
  visual.kind = 'asset-factory'; delete visual.science;
  visual.ports.outputs = {};
  visual.artifact = { kind: 'geometry', format: 'fixture.geometry.v1', schema: object({ vertices: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, maxItems: 16 } }, ['vertices']), provenance: { source: 'Original fixture code', license: 'BSD-3-Clause' } };
  const prepared = prepareManifest(visual);
  assert.deepEqual(prepared.assets, {});
  const view = { ...visual, kind: 'view-adapter', artifact: { ...visual.artifact, kind: 'view' }, assets: { geometry: { kind: 'geometry', format: 'fixture.geometry.v1' } } };
  assert.equal(prepareManifest(view).assets.geometry.kind, 'geometry');
  fails(() => prepareManifest({ ...visual, ports: { inputs: {}, outputs: { value: scalarPort() } } }));
  fails(() => prepareManifest({ ...visual, science: manifest().science }));
  fails(() => prepareManifest({ ...visual, kind: 'view-adapter' }));
});

test('dynamic coordinate arrays remain data bindings and are checked at instantiation', () => {
  const m = manifest();
  m.parameters = object({ times: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } }, ['times']);
  m.documentation.examples = [{ parameters: { times: [0, 1] } }];
  m.ports.outputs = { signal: scalarPort({ kind: 'series', shape: [2], coordinates: { kind: 'time', unit: 's', values: { $param: 'times' } } }) };
  const prepared = prepareManifest(m);
  assert.deepEqual(resolvePorts(prepared, { id: 'signal', data: { parameters: { times: [0, 2] } } }).outputs.signal.coordinates.values, [0, 2]);
  fails(() => resolvePorts(prepared, { id: 'signal', data: { parameters: { times: [2, 1] } } }), 'INVALID_COORDINATES');
});
