import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unit, value, validateValue, descriptorOf, sameDimensions, checkPort,
  convertValue, transformValue, binaryValue, mapValue, reduceValue, fieldValue,
} from '../src/dataflow/values.js';

const scalar = (data, overrides = {}) => value({ kind: 'scalar', data, unit: 'm', meaning: 'length', ...overrides });
const vector = (data, overrides = {}) => value({ kind: 'vector', data, unit: 'm', meaning: 'position', frame: { id: 'lab', kind: 'position' }, ...overrides });
const collection = (data, overrides = {}) => value({ kind: 'collection', data, unit: 'm', meaning: 'length', objectIds: data.map((_, i) => `object-${i}`), ...overrides });
const series = (data, times, overrides = {}) => value({ kind: 'series', data, unit: 'm', meaning: 'length', coordinates: { kind: 'time', unit: 's', values: times }, ...overrides });
const field = (data, overrides = {}) => value({ kind: 'field', data, unit: 'K', meaning: 'sample-temperature', coordinates: { kind: 'space', unit: 'm', frame: { id: 'lab', kind: 'position' }, values: data.map((_, i) => [i, 0, 0]) }, ...overrides });
const fails = (code, fn) => assert.throws(fn, error => error.code === code);

test('units normalize bounded conversions and reject contradictory descriptors', () => {
  assert.deepEqual(unit('km/s'), { symbol: 'km/s', dimensions: { length: 1, time: -1 }, scale: 1000 });
  assert.equal(sameDimensions('km', 'm'), true);
  assert.equal(sameDimensions('m', 's'), false);
  fails('UNKNOWN_UNIT', () => unit('astronomical-unit'));
  fails('INVALID_UNIT', () => unit({ symbol: 'm', dimensions: { time: 1 }, scale: 1 }));
  fails('INVALID_UNIT', () => unit({ symbol: 'derived', dimensions: { magic: 1 }, scale: 1 }));
  fails('INVALID_UNIT', () => unit({ symbol: 'derived', dimensions: { length: 0.5 }, scale: 1 }));
});

test('values carry explicit context and detached finite data with exact shapes', () => {
  const source = { kind: 'vector', data: [1, null, 3], unit: 'm', meaning: 'coordinate' };
  const v = value(source);
  source.data[0] = 99;
  assert.deepEqual(v.data, [1, null, 3]);
  assert.deepEqual(v.shape, [3]);
  assert.equal(v.reference, null);
  assert.equal(v.frame, null);
  assert.equal(v.time, null);
  assert.ok(v.metadata.warnings.some(d => d.code === 'MISSING_DATA'));
  assert.deepEqual(v.metadata.approximation, []);
  fails('SHAPE_MISMATCH', () => value({ ...source, shape: [2] }));
  fails('SHAPE_MISMATCH', () => value({ ...source, shape: null }));
  assert.equal(validateValue({ ...source, data: [1, Infinity, 3] }).valid, false);
  assert.equal(validateValue({ ...source, data: [1, () => 2, 3] }).valid, false);
  fails('MISSING_CONTEXT', () => value({ kind: 'collection', data: [1, 2], unit: 'm', meaning: 'length' }));
  fails('MISSING_CONTEXT', () => value({ kind: 'series', data: [1], unit: 'm', meaning: 'length' }));
  fails('INVALID_COORDINATES', () => series([1, 2], [0, 0]));
  fails('SHAPE_MISMATCH', () => series([1, 2], [0]));
});

test('scalar and vector field values preserve coordinates and selection provenance', () => {
  const scalarField = field([10, null, 30]);
  const selected = fieldValue(scalarField, [2, 1]);
  assert.deepEqual(selected.data, [30, null]);
  assert.deepEqual(selected.coordinates.values, [[2, 0, 0], [1, 0, 0]]);
  const arrows = field([[1, 0, 0], [0, 2, 0]], {
    unit: 'm/s', meaning: 'velocity', frame: { id: 'lab', kind: 'direction' },
    metadata: { warnings: [{ code: 'FIXTURE', path: '$', message: 'Software fixture only.' }], approximation: ['Piecewise samples'] },
  });
  assert.deepEqual(arrows.shape, [2, 3]);
  assert.deepEqual(fieldValue(arrows, [1]).data, [[0, 2, 0]]);
  assert.deepEqual(fieldValue(arrows, [1]).metadata, arrows.metadata);
  fails('FIELD_SELECTION', () => fieldValue(arrows, [2]));
  fails('FIELD_SELECTION', () => fieldValue(arrows, [0, 0]));
});

test('ports require declared meaning/reference/frame/normalization beyond dimensions', () => {
  const actual = descriptorOf(vector([1, 2, 3], { reference: 'point-a' }));
  assert.deepEqual(checkPort(actual, actual), []);
  for (const [fieldName, replacement, code] of [
    ['unit', unit('s'), 'UNIT_MISMATCH'], ['unit', unit('km'), 'UNIT_CONVERSION_REQUIRED'],
    ['meaning', 'displacement', 'MEANING_MISMATCH'], ['reference', 'point-b', 'REFERENCE_MISMATCH'],
    ['frame', { id: 'other', kind: 'position' }, 'FRAME_MISMATCH'],
    ['normalization', { reference: 'reference-point', definition: 'divide by reference radius' }, 'NORMALIZATION_MISMATCH'],
  ]) assert.ok(checkPort(actual, { ...actual, [fieldName]: replacement }).some(d => d.code === code));
  const incomplete = { ...actual }; delete incomplete.frame;
  assert.ok(checkPort(actual, incomplete).some(d => d.code === 'MISSING_CONTEXT'));
  const generic = { ...descriptorOf(collection([1, 2])), shape: [null] };
  assert.deepEqual(checkPort(descriptorOf(collection([1, 2])), generic), []);
});

test('ports compare explicit sample coordinates and physical time in compatible units', () => {
  const actual = descriptorOf(series([1, 2], [0, 60], { time: { value: 120, unit: 's' } }));
  const equivalent = { ...actual, coordinates: { kind: 'time', unit: 'min', values: [0, 1] }, time: { value: 2, unit: 'min' } };
  assert.deepEqual(checkPort(actual, equivalent), []);
  assert.ok(checkPort(actual, { ...equivalent, time: { value: 3, unit: 'min' } }).some(d => d.code === 'TIME_MISMATCH'));
  assert.ok(checkPort(actual, { ...equivalent, coordinates: { kind: 'time', unit: 's', values: [0, 1] } }).some(d => d.code === 'SAMPLE_ALIGNMENT'));
  const missingTime = { ...actual }; delete missingTime.time;
  assert.ok(checkPort(missingTime, actual).some(d => d.code === 'MISSING_CONTEXT'));
});

test('unit conversion preserves signed/missing data and physical context', () => {
  const original = vector([-1, null, 3], { unit: 'km', reference: 'p', time: { value: 2, unit: 's' } });
  const converted = convertValue(original, 'm');
  assert.deepEqual(converted.data, [-1000, null, 3000]);
  assert.deepEqual(converted.frame, original.frame);
  assert.deepEqual(converted.time, original.time);
  assert.deepEqual(original.data, [-1, null, 3]);
  assert.equal(convertValue(scalar(1e308, { unit: 'km' }), 'km').data, 1e308);
  fails('UNIT_MISMATCH', () => convertValue(original, 's'));
});

test('addition/subtraction preserve signs and require explicit comparisons for unlike meanings/references', () => {
  const difference = binaryValue('subtract', scalar(1, { unit: 'km' }), scalar(1500));
  assert.equal(difference.data, -0.5);
  assert.deepEqual(difference.unit, unit('km'));
  fails('COMPARISON_REQUIRED', () => binaryValue('subtract', scalar(1, { reference: 'a' }), scalar(2, { reference: 'b' })));
  const compared = binaryValue('subtract', scalar(1, { reference: 'a' }), scalar(2, { reference: 'b' }), { comparison: { meaning: 'a-minus-b', reference: null } });
  assert.equal(compared.data, -1);
  assert.equal(compared.meaning, 'a-minus-b');
  assert.ok(compared.metadata.warnings.some(d => d.code === 'UNVALIDATED_COMPARISON'));
  fails('FRAME_MISMATCH', () => binaryValue('add', vector([1, 0, 0]), vector([1, 0, 0], { frame: { id: 'camera', kind: 'display' } }), { comparison: { meaning: 'generic', reference: null } }));
  fails('NORMALIZATION_MISMATCH', () => binaryValue('add', scalar(1), scalar(2, { normalization: { reference: 'a', definition: 'normalized to a' } }), { comparison: { meaning: 'generic', reference: null } }));
  fails('TIME_MISMATCH', () => binaryValue('add', scalar(1, { time: { value: 1, unit: 's' } }), scalar(2, { time: { value: 2, unit: 's' } })));
});

test('scalar scaling has dimension algebra and vector products remain explicit', () => {
  const scaled = binaryValue('multiply', vector([1, 2, -3], { unit: 'm/s', meaning: 'velocity', frame: { id: 'lab', kind: 'direction' }, reference: 'p' }), scalar(2, { unit: 's', meaning: 'duration' }));
  assert.deepEqual(scaled.data, [2, 4, -6]);
  assert.equal(sameDimensions(scaled.unit, 'm'), true);
  assert.equal(scaled.reference, 'p');
  const scalarScale = binaryValue('multiply', scalar(4, { reference: 'p', time: { value: 4, unit: 's' } }), scalar(2, { unit: '1', meaning: 'factor' }));
  assert.equal(scalarScale.data, 8);
  assert.equal(scalarScale.reference, 'p');
  assert.equal(scalarScale.time.value, 4);
  const reverseScale = binaryValue('multiply', scalar(2, { unit: '1', meaning: 'factor' }), scalar(4, { reference: 'p', time: { value: 4, unit: 's' } }));
  assert.equal(reverseScale.data, 8);
  assert.equal(reverseScale.reference, 'p');
  assert.equal(reverseScale.time.value, 4);
  const relative = scalar(3, { unit: '1', meaning: 'relative-signal', normalization: { reference: 'baseline', definition: 'divide by baseline' } });
  const factor = scalar(2, { unit: '1', meaning: 'factor' });
  assert.deepEqual(binaryValue('multiply', factor, relative).normalization, relative.normalization);
  assert.deepEqual(binaryValue('multiply', relative, factor).normalization, relative.normalization);
  assert.deepEqual(binaryValue('divide', relative, factor).normalization, relative.normalization);
  fails('NORMALIZATION_MISMATCH', () => binaryValue('multiply', relative, relative));
  fails('NORMALIZATION_MISMATCH', () => binaryValue('divide', factor, relative));
  fails('NORMALIZATION_MISMATCH', () => binaryValue('divide', relative, relative, { comparison: { meaning: 'ratio', reference: null } }));
  fails('UNSUPPORTED_ARITHMETIC', () => binaryValue('multiply', vector([1, 2, 3]), vector([4, 5, 6])));
  fails('DIVISION_BY_ZERO', () => binaryValue('divide', scalar(1), scalar(0)));
});

test('affine arithmetic keeps positions distinct from displacements', () => {
  const displacement = binaryValue('subtract', vector([3, 4, 0]), vector([1, 1, 0]), { comparison: { meaning: 'displacement', reference: null } });
  assert.deepEqual(displacement.data, [2, 3, 0]);
  assert.equal(displacement.frame.kind, 'direction');
  const moved = binaryValue('add', vector([1, 1, 0]), displacement, { comparison: { meaning: 'position', reference: null } });
  assert.deepEqual(moved.data, [3, 4, 0]);
  assert.equal(moved.frame.kind, 'position');
  fails('AFFINE_OPERATION', () => binaryValue('add', vector([1, 0, 0]), vector([1, 0, 0])));
  fails('AFFINE_OPERATION', () => binaryValue('subtract', displacement, vector([1, 0, 0]), { comparison: { meaning: 'invalid', reference: null } }));
});

test('collections align values by object identity rather than array index', () => {
  const left = collection([10, 20], { objectIds: ['a', 'b'] });
  const right = collection([1, 2], { objectIds: ['b', 'a'] });
  assert.deepEqual(binaryValue('subtract', left, right).data, [8, 19]);
  fails('SAMPLE_ALIGNMENT', () => binaryValue('add', left, collection([1, 2], { objectIds: ['b', 'c'] })));
});

test('series require coordinate alignment and interpolation is explicit without extrapolation', () => {
  const left = series([10, 20, 30], [0, 1, 2]);
  const right = series([0, 4], [0, 2]);
  fails('SAMPLE_ALIGNMENT', () => binaryValue('subtract', left, right));
  const result = binaryValue('subtract', left, right, { alignment: { policy: 'linear', target: 'left' } });
  assert.deepEqual(result.data, [10, 18, 26]);
  assert.deepEqual(result.coordinates.values, [0, 1, 2]);
  assert.ok(result.metadata.warnings.some(d => d.code === 'INTERPOLATED'));
  const equivalent = binaryValue('subtract', series([10, 20], [0, 60]), series([1, 2], [0, 1], { coordinates: { kind: 'time', unit: 'min', values: [0, 1] } }));
  assert.deepEqual(equivalent.data, [9, 18]);
  fails('SAMPLE_ALIGNMENT', () => binaryValue('add', series([1, 2], [0, 3]), right, { alignment: { policy: 'linear', target: 'left' } }));
  fails('MISSING_DATA', () => binaryValue('add', left, series([0, null], [0, 2]), { alignment: { policy: 'linear', target: 'left' } }));
});

test('field arithmetic checks spatial coordinates and does not invent interpolation', () => {
  const left = field([10, 20]);
  const equivalent = field([1, 2], { coordinates: { kind: 'space', unit: 'km', frame: { id: 'lab', kind: 'position' }, values: [[0, 0, 0], [0.001, 0, 0]] } });
  assert.deepEqual(binaryValue('subtract', left, equivalent).data, [9, 18]);
  const shifted = field([1, 2], { coordinates: { kind: 'space', unit: 'm', frame: { id: 'lab', kind: 'position' }, values: [[1, 0, 0], [2, 0, 0]] } });
  fails('SAMPLE_ALIGNMENT', () => binaryValue('add', left, shifted, { alignment: { policy: 'linear', target: 'left' } }));
});

test('missing leaves are diagnosed, magnitude propagates missing, and reductions never zero-fill', () => {
  fails('MISSING_DATA', () => binaryValue('add', scalar(null), scalar(1)));
  const vectors = collection([[3, 4, 0], [1, null, 0]], { frame: { id: 'lab', kind: 'direction' } });
  assert.deepEqual(mapValue('magnitude', vectors).data, [5, null]);
  assert.deepEqual(mapValue('magnitude', vectors).shape, [2]);
  assert.equal(mapValue('magnitude', vector([3, 4, 0])).data, 5);
  assert.equal(reduceValue('mean', collection([-2, 4, 7])).data, 3);
  assert.equal(reduceValue('sum', collection([-2, 4, 7])).data, 9);
  fails('MISSING_DATA', () => reduceValue('sum', collection([1, null])));
  fails('EMPTY_COLLECTION', () => reduceValue('sum', collection([])));
});

test('rigid transformations separate positions, directions, and field sample coordinates', () => {
  const rotation = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
  const transform = { from: 'lab', to: 'shifted', rotation, translation: [1, 0, 0], unit: 'km' };
  const position = transformValue(vector([1, 0, 0]), transform);
  assert.deepEqual(position.data, [1000, 1, 0]);
  assert.deepEqual(position.frame, { id: 'shifted', kind: 'position' });
  const direction = vector([1, 0, 0], { unit: '1', meaning: 'direction', frame: { id: 'lab', kind: 'direction' } });
  assert.deepEqual(transformValue(direction, { from: 'lab', to: 'shifted', rotation }).data, [0, 1, 0]);
  fails('INVALID_TRANSFORM', () => transformValue(direction, transform));
  const arrows = field([[1, 0, 0], [0, 1, 0]], { unit: 'm/s', meaning: 'velocity', frame: { id: 'lab', kind: 'direction' } });
  const moved = transformValue(arrows, transform);
  assert.deepEqual(moved.data, [[0, 1, 0], [-1, 0, 0]]);
  assert.deepEqual(moved.coordinates.values, [[1000, 0, 0], [1000, 1, 0]]);
  const scalarField = transformValue(field([10, 20]), transform);
  assert.deepEqual(scalarField.data, [10, 20]);
  assert.deepEqual(scalarField.coordinates.frame, { id: 'shifted', kind: 'position' });
});

test('frame adapters reject reflection, scaling, wrong sources, and display promotion', () => {
  for (const rotation of [ [[-1, 0, 0], [0, 1, 0], [0, 0, 1]], [[2, 0, 0], [0, 1, 0], [0, 0, 1]] ]) fails('INVALID_TRANSFORM', () => transformValue(vector([1, 2, 3]), { from: 'lab', to: 'new', rotation }));
  const rotation = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  fails('FRAME_MISMATCH', () => transformValue(vector([1, 2, 3]), { from: 'unknown', to: 'new', rotation }));
  fails('FRAME_MISMATCH', () => transformValue(vector([1, 2, 3], { frame: { id: 'screen', kind: 'display' } }), { from: 'screen', to: 'physical', rotation }));
});
