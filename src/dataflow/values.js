// Scientific data contracts and bounded arithmetic. No domain or renderer code.
import { KernelError } from '../core/index.js';
import { copyData } from '../core/data.js';

const dimensionNames = ['length', 'time', 'mass', 'temperature'];
const units = {
  '1': [{}, 1], m: [{ length: 1 }, 1], km: [{ length: 1 }, 1000], cm: [{ length: 1 }, 0.01],
  s: [{ time: 1 }, 1], min: [{ time: 1 }, 60], h: [{ time: 1 }, 3600],
  kg: [{ mass: 1 }, 1], K: [{ temperature: 1 }, 1],
  'm/s': [{ length: 1, time: -1 }, 1], 'km/s': [{ length: 1, time: -1 }, 1000],
  'm/s^2': [{ length: 1, time: -2 }, 1],
};
const kinds = ['scalar', 'vector', 'collection', 'field', 'series'];
const requiredDescriptor = ['kind', 'shape', 'unit', 'meaning', 'reference', 'frame', 'normalization'];
const valueFields = [...requiredDescriptor, 'data', 'coordinates', 'objectIds', 'time', 'metadata'];
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && !!v.trim();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Coordinates have physical scale. A one-second absolute tolerance floor
// would merge distinct small instants near zero.
const close = (a, b, floor = 0) => Number.isFinite(a) && Number.isFinite(b) &&
  (a === b || Math.abs(a - b) <= 16 * Number.EPSILON * Math.max(floor, Math.abs(a), Math.abs(b)));
function canonicalCoordinate(x, scale) {
  if (!Number.isFinite(x)) return NaN;
  const transformed = x * scale;
  return transformed === 0 && x !== 0 ? NaN : transformed;
}
const diagnostic = (code, path, message) => ({ code, path, message });
const fail = (code, message, path = '$') => { throw new KernelError(code, message, { validation: { valid: false, errors: [diagnostic(code, path, message)] } }); };
const requireFields = (obj, allowed, label) => {
  if (!record(obj)) fail('INVALID_VALUE', `${label} must be an object.`, label);
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) fail('INVALID_VALUE', `${label}.${key} is not supported.`, `${label}.${key}`);
};

export function unit(input) {
  if (typeof input === 'string') {
    if (!Object.hasOwn(units, input)) fail('UNKNOWN_UNIT', `Unsupported unit ${input}; supply an explicit derived descriptor.`);
    return { symbol: input, dimensions: { ...units[input][0] }, scale: units[input][1] };
  }
  const descriptor = copyData(input);
  requireFields(descriptor, ['symbol', 'dimensions', 'scale'], 'unit');
  if (!text(descriptor.symbol) || !record(descriptor.dimensions) || !Number.isFinite(descriptor.scale) || descriptor.scale <= 0) {
    fail('INVALID_UNIT', 'Units require a symbol, dimension exponents and a finite positive SI scale.');
  }
  const dimensions = {};
  for (const key of dimensionNames) if (descriptor.dimensions[key]) dimensions[key] = descriptor.dimensions[key];
  for (const [key, exponent] of Object.entries(descriptor.dimensions)) {
    if (!dimensionNames.includes(key) || !Number.isInteger(exponent) || Math.abs(exponent) > 12) {
      fail('INVALID_UNIT', `Unsupported dimension/exponent ${key}:${exponent}.`);
    }
  }
  const result = { symbol: descriptor.symbol, dimensions, scale: descriptor.scale };
  if (Object.hasOwn(units, result.symbol)) {
    const canonical = unit(result.symbol);
    if (!equal(result.dimensions, canonical.dimensions) || result.scale !== canonical.scale) {
      fail('INVALID_UNIT', `Descriptor contradicts the known unit ${result.symbol}.`);
    }
  }
  return result;
}

export function sameDimensions(a, b) { return equal(unit(a).dimensions, unit(b).dimensions); }

function frame(input, path = 'frame') {
  if (input === null) return null;
  requireFields(input, ['id', 'kind'], path);
  if (!text(input.id) || !['position', 'direction', 'display'].includes(input.kind)) {
    fail('INVALID_FRAME', 'Frames require an ID and position, direction, or display convention.', path);
  }
  return { id: input.id, kind: input.kind };
}

function normalization(input) {
  if (input === null) return null;
  requireFields(input, ['reference', 'definition'], 'normalization');
  if (!text(input.reference) || !text(input.definition)) fail('INVALID_NORMALIZATION', 'Normalization requires its reference and definition.');
  return { reference: input.reference, definition: input.definition };
}

export function instant(input) {
  if (input === null) return null;
  requireFields(input, ['value', 'unit'], 'time');
  const u = unit(input.unit);
  if (!Number.isFinite(canonicalCoordinate(input.value, u.scale)) || !sameDimensions(u, 's')) fail('INVALID_TIME', 'Physical time must be representable in seconds and use time units.');
  return { value: input.value, unit: u };
}

function coordinates(input) {
  if (input === null) return null;
  requireFields(input, ['kind', 'unit', 'values', 'frame'], 'coordinates');
  const u = unit(input.unit);
  if (!Array.isArray(input.values)) fail('INVALID_COORDINATES', 'Sample coordinates require an array.');
  if (input.kind === 'time') {
    if (Object.hasOwn(input, 'frame')) fail('INVALID_COORDINATES', 'Time samples do not use a spatial frame.');
    const seconds = input.values.map(x => canonicalCoordinate(x, u.scale));
    if (!sameDimensions(u, 's') || seconds.some((x, i) => !Number.isFinite(x) || (i > 0 && x <= seconds[i - 1]))) {
      fail('INVALID_COORDINATES', 'Time coordinates must remain representable and strictly increasing after conversion to physical seconds.');
    }
    return { kind: 'time', unit: u, values: [...input.values] };
  }
  if (input.kind === 'space') {
    const f = frame(input.frame, 'coordinates.frame');
    if (!sameDimensions(u, 'm') || f?.kind !== 'position' || input.values.some(row => !Array.isArray(row) || row.length !== 3 || row.some(x => !Number.isFinite(x)))) {
      fail('INVALID_COORDINATES', 'Spatial coordinates need finite 3-vectors, length units and a position frame.');
    }
    return { kind: 'space', unit: u, frame: f, values: input.values.map(row => [...row]) };
  }
  fail('INVALID_COORDINATES', 'Coordinate kind must be time or space.');
}

function inferShape(kind, data) {
  if (kind === 'scalar') return [];
  if (kind === 'vector') return [3];
  if (!Array.isArray(data)) fail('SHAPE_MISMATCH', 'Container values need an array.');
  return data.some(Array.isArray) ? [data.length, 3] : [data.length];
}

function validateShape(shape, kind, { wildcard = false } = {}) {
  if (!Array.isArray(shape) || shape.some(n => !(wildcard && n === null) && (!Number.isSafeInteger(n) || n < 0))) {
    fail('SHAPE_MISMATCH', 'Shape must contain nonnegative integer lengths.');
  }
  const scalar = kind === 'scalar' && shape.length === 0;
  const vector = kind === 'vector' && shape.length === 1 && shape[0] === 3;
  const container = ['collection', 'field', 'series'].includes(kind) && (shape.length === 1 || (shape.length === 2 && shape[1] === 3));
  if (!scalar && !vector && !container) fail('SHAPE_MISMATCH', `Unsupported ${kind} shape ${JSON.stringify(shape)}.`);
}

function dataMatches(data, shape) {
  if (!shape.length) return data === null || Number.isFinite(data);
  return Array.isArray(data) && data.length === shape[0] && data.every(item => dataMatches(item, shape.slice(1)));
}

function metadata(input) {
  requireFields(input, ['warnings', 'approximation'], 'metadata');
  if (!Array.isArray(input.warnings) || input.warnings.some(d => !record(d) || !text(d.code) || typeof d.path !== 'string' || !text(d.message)) ||
      !Array.isArray(input.approximation) || input.approximation.some(x => !text(x))) {
    fail('INVALID_METADATA', 'Metadata requires diagnostic warnings and approximation strings.');
  }
  return copyData(input);
}

export function value(input) {
  const spec = copyData(input);
  requireFields(spec, valueFields, 'value');
  if (!kinds.includes(spec.kind) || !text(spec.meaning)) fail('INVALID_VALUE', 'Values require a supported kind and explicit quantity meaning.');
  const result = {
    kind: spec.kind, shape: Object.hasOwn(spec, 'shape') ? spec.shape : inferShape(spec.kind, spec.data), data: spec.data,
    unit: unit(spec.unit), meaning: spec.meaning,
    reference: spec.reference ?? null, frame: frame(spec.frame ?? null), normalization: normalization(spec.normalization ?? null),
    coordinates: coordinates(spec.coordinates ?? null), objectIds: spec.objectIds ?? null,
    time: instant(spec.time ?? null), metadata: metadata(spec.metadata ?? { warnings: [], approximation: [] }),
  };
  validateShape(result.shape, result.kind);
  if (!dataMatches(result.data, result.shape)) fail('SHAPE_MISMATCH', 'Data does not match its declared shape or contains non-finite values.');
  if (result.reference !== null && !text(result.reference)) fail('INVALID_REFERENCE', 'A reference must be a nonempty ID or explicit null.');
  if (result.objectIds !== null && (!Array.isArray(result.objectIds) || result.objectIds.some(id => !text(id)) || new Set(result.objectIds).size !== result.objectIds.length)) {
    fail('INVALID_REFERENCE', 'Object identities must be distinct nonempty strings.');
  }
  if (result.kind === 'collection') {
    if (result.objectIds === null || result.objectIds.length !== result.shape[0]) fail('MISSING_CONTEXT', 'Collections need one object ID per value.');
  } else if (result.objectIds !== null) fail('INVALID_REFERENCE', 'Only collections carry per-object IDs.');
  if (result.kind === 'series' && result.coordinates?.kind !== 'time') fail('MISSING_CONTEXT', 'Series require explicit time sample coordinates.');
  if (result.kind === 'field' && result.coordinates?.kind !== 'space') fail('MISSING_CONTEXT', 'Fields require explicit spatial sample coordinates.');
  if (result.coordinates && !['series', 'field'].includes(result.kind)) fail('INVALID_COORDINATES', 'Only fields and series carry sample coordinates.');
  if (result.coordinates && result.coordinates.values.length !== result.shape[0]) fail('SHAPE_MISMATCH', 'Coordinate count must equal value count.');
  if (result.frame !== null && result.kind !== 'vector' && result.shape.length !== 2) fail('INVALID_FRAME', 'Value frames describe 3-vector coordinates; scalar fields declare their spatial frame in coordinates.');
  if (result.frame?.kind === 'position' && !sameDimensions(result.unit, 'm')) fail('UNIT_MISMATCH', 'Position coordinates require length dimensions.');
  if (missing(result.data) && !result.metadata.warnings.some(d => d.code === 'MISSING_DATA')) warn(result.metadata, 'MISSING_DATA', 'One or more values are missing; null is not a numeric zero.');
  return result;
}

export function validateValue(input) {
  try { value(input); return { valid: true, errors: [] }; }
  catch (error) { return { valid: false, errors: error.validation?.errors ?? [diagnostic(error.code ?? 'INVALID_VALUE', '$', error.message)] }; }
}

export function descriptorOf(input) {
  const v = value(input);
  return Object.fromEntries([...requiredDescriptor, 'coordinates', 'objectIds', 'time'].map(key => [key, copyData(v[key])]));
}

function descriptor(input, label) {
  const d = copyData(input);
  if (!record(d)) fail('MISSING_CONTEXT', `${label} must be a descriptor.`);
  if (Object.hasOwn(d, 'data')) return descriptorOf(d);
  for (const key of requiredDescriptor) if (!Object.hasOwn(d, key)) fail('MISSING_CONTEXT', `${label} must declare ${key}.`, `${label}.${key}`);
  if (!kinds.includes(d.kind) || !text(d.meaning)) fail('INVALID_VALUE', `${label} needs kind and meaning.`);
  validateShape(d.shape, d.kind, { wildcard: true });
  d.unit = unit(d.unit); d.frame = frame(d.frame); d.normalization = normalization(d.normalization);
  if (d.frame !== null && d.kind !== 'vector' && d.shape.length !== 2) fail('INVALID_FRAME', `${label} declares a vector frame for scalar-valued data.`);
  if (d.frame?.kind === 'position' && !sameDimensions(d.unit, 'm')) fail('UNIT_MISMATCH', `${label} position coordinates require length dimensions.`);
  if (d.reference !== null && !text(d.reference)) fail('INVALID_REFERENCE', `${label}.reference must be explicit null or an ID.`);
  if (Object.hasOwn(d, 'coordinates')) d.coordinates = coordinates(d.coordinates);
  if (Object.hasOwn(d, 'time')) d.time = instant(d.time);
  if (Object.hasOwn(d, 'objectIds') && d.objectIds !== null && (!Array.isArray(d.objectIds) || d.objectIds.some(id => !text(id)) || new Set(d.objectIds).size !== d.objectIds.length)) fail('INVALID_REFERENCE', `${label}.objectIds needs distinct IDs.`);
  if (d.coordinates) {
    if ((d.kind !== 'series' || d.coordinates.kind !== 'time') && (d.kind !== 'field' || d.coordinates.kind !== 'space')) fail('INVALID_COORDINATES', `${label} coordinates do not match its value kind.`);
    if (d.shape[0] !== null && d.coordinates.values.length !== d.shape[0]) fail('SHAPE_MISMATCH', `${label} coordinate count differs from its shape.`);
  }
  if (d.objectIds) {
    if (d.kind !== 'collection') fail('INVALID_REFERENCE', `${label} object IDs require a collection.`);
    if (d.shape[0] !== null && d.objectIds.length !== d.shape[0]) fail('SHAPE_MISMATCH', `${label} object IDs do not match its shape.`);
  }
  return d;
}

function coordinateEqual(a, b) {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind || !sameDimensions(a.unit, b.unit) || !equal(a.frame ?? null, b.frame ?? null) || a.values.length !== b.values.length) return false;
  // Converting via the scale ratio can overflow even if both physical
  // coordinates are small finite numbers, e.g. 1e-200 × 1e200 seconds.
  if (a.kind === 'time') return a.values.every((x, i) =>
    close(canonicalCoordinate(x, a.unit.scale), canonicalCoordinate(b.values[i], b.unit.scale)));
  // Keep the existing spatial tolerance in the target length units.
  const ratio = a.unit.scale / b.unit.scale;
  const inTargetUnits = Number.isFinite(ratio) && ratio > 0 ? x => x * ratio
    : x => canonicalCoordinate(x, a.unit.scale) / b.unit.scale;
  return a.values.every((row, i) => row.every((x, j) => close(inTargetUnits(x), b.values[i][j], 1)));
}

export function timeEqual(a, b) { return a === null || b === null ? a === b : close(a.value * a.unit.scale, b.value * b.unit.scale); }

export function checkPort(source, requirement) {
  const errors = [];
  let actual, needed;
  for (const [label, input] of [['source', source], ['requirement', requirement]]) {
    try {
      const d = descriptor(input, label);
      if (label === 'source') actual = d; else needed = d;
    } catch (error) { errors.push(...(error.validation?.errors ?? [diagnostic(error.code ?? 'INVALID_VALUE', label, error.message)])); }
  }
  if (errors.length) return errors;
  const reject = (code, key, message) => errors.push(diagnostic(code, key, message));
  const quantity = port => `${port.time === null ? 'timeless ' : ''}${port.kind} ${JSON.stringify(port.meaning)} in ${port.unit.symbol}`;
  if (actual.kind !== needed.kind) reject('KIND_MISMATCH', 'kind', `The output supplies a ${quantity(actual)}. The input requires a ${quantity(needed)}.`);
  if (actual.shape.length !== needed.shape.length || actual.shape.some((n, i) => needed.shape[i] !== null && n !== needed.shape[i])) reject('SHAPE_MISMATCH', 'shape', 'Input shape does not meet the declared dimensions.');
  if (!sameDimensions(actual.unit, needed.unit)) reject('UNIT_MISMATCH', 'unit', `Output unit ${actual.unit.symbol} and required input unit ${needed.unit.symbol} have different physical dimensions.`);
  else if (actual.unit.scale !== needed.unit.scale) reject('UNIT_CONVERSION_REQUIRED', 'unit', `The output uses ${actual.unit.symbol} (SI scale ${actual.unit.scale}). Convert to ${needed.unit.symbol} (SI scale ${needed.unit.scale}) before connecting this input.`);
  for (const [key, code] of [['meaning', 'MEANING_MISMATCH'], ['reference', 'REFERENCE_MISMATCH'], ['frame', 'FRAME_MISMATCH'], ['normalization', 'NORMALIZATION_MISMATCH']]) {
    if (!equal(actual[key], needed[key])) reject(code, key, `Input ${key} differs; an explicit justified adapter or comparison is required.`);
  }
  for (const key of ['coordinates', 'time', 'objectIds']) if (Object.hasOwn(needed, key)) {
    if (!Object.hasOwn(actual, key)) reject('MISSING_CONTEXT', key, `Source does not declare ${key}.`);
    else {
      const matches = key === 'coordinates' ? coordinateEqual(actual[key], needed[key]) : key === 'time' ? timeEqual(actual[key], needed[key]) : equal(actual[key], needed[key]);
      if (!matches) reject(key === 'time' ? 'TIME_MISMATCH' : 'SAMPLE_ALIGNMENT', key, `Input ${key} is not aligned with the required context.`);
    }
  }
  return errors;
}

function mapNumbers(data, fn) {
  if (Array.isArray(data)) return data.map(x => mapNumbers(x, fn));
  if (data === null) return null;
  const result = fn(data);
  if (!Number.isFinite(result)) fail('NONFINITE_RESULT', 'Arithmetic produced a non-finite result.');
  return result;
}
function missing(data) { return data === null || (Array.isArray(data) && data.some(missing)); }

export function convertValue(input, targetUnit) {
  const v = value(input), target = unit(targetUnit);
  if (!sameDimensions(v.unit, target)) fail('UNIT_MISMATCH', 'Cannot convert between different dimensions.');
  const ratio = v.unit.scale / target.scale;
  return value({ ...v, unit: target, data: mapNumbers(v.data, x => x * ratio) });
}

function mergeMetadata(...inputs) {
  return { warnings: inputs.flatMap(v => v.metadata.warnings), approximation: [...new Set(inputs.flatMap(v => v.metadata.approximation))] };
}
function warn(metadata, code, message) { metadata.warnings.push(diagnostic(code, '$', message)); }
function mergedUnit(a, b, divide) {
  const dimensions = {};
  for (const key of dimensionNames) {
    const exponent = (a.dimensions[key] ?? 0) + (divide ? -1 : 1) * (b.dimensions[key] ?? 0);
    if (exponent) dimensions[key] = exponent;
  }
  const scale = divide ? a.scale / b.scale : a.scale * b.scale;
  const symbol = `${a.symbol}${divide ? '/' : '*'}(${b.symbol})`;
  return unit({ symbol, dimensions, scale });
}

function aligned(left, right, alignment, meta) {
  if (left.kind === 'collection') {
    const rightIds = new Set(right.objectIds);
    if (left.objectIds.length !== right.objectIds.length || left.objectIds.some(id => !rightIds.has(id))) fail('SAMPLE_ALIGNMENT', 'Collection object identities differ.');
    const byId = new Map(right.objectIds.map((id, index) => [id, right.data[index]]));
    return { ...right, objectIds: [...left.objectIds], data: left.objectIds.map(id => byId.get(id)) };
  }
  if (!['series', 'field'].includes(left.kind)) return right;
  if (coordinateEqual(left.coordinates, right.coordinates)) return right;
  if (left.kind !== 'series' || alignment?.policy !== 'linear' || alignment?.target !== 'left') fail('SAMPLE_ALIGNMENT', 'Sample coordinates differ. Supply an explicit supported alignment policy.');
  requireFields(alignment, ['policy', 'target'], 'alignment');
  const xs = right.coordinates.values.map(t => t * right.coordinates.unit.scale);
  let upper = 0;
  const data = left.coordinates.values.map(t => {
    const x = t * left.coordinates.unit.scale;
    while (upper < xs.length && xs[upper] < x && !close(xs[upper], x)) upper++;
    if (upper < xs.length && close(xs[upper], x)) return right.data[upper];
    const hi = upper;
    if (hi <= 0 || hi >= xs.length) fail('SAMPLE_ALIGNMENT', 'Linear alignment does not extrapolate beyond available samples.');
    const lo = hi - 1;
    if (missing(right.data[lo]) || missing(right.data[hi])) fail('MISSING_DATA', 'Interpolation cannot bridge missing samples.');
    const span = xs[hi] - xs[lo];
    const fraction = Number.isFinite(span) ? (x - xs[lo]) / span
      : (x / 2 - xs[lo] / 2) / (xs[hi] / 2 - xs[lo] / 2);
    // Keep finite opposite-signed endpoints from overflowing in (b - a).
    return zipNumbers(right.data[lo], right.data[hi], (a, b) =>
      (a < 0) === (b < 0) ? a + fraction * (b - a) : (1 - fraction) * a + fraction * b);
  });
  warn(meta, 'INTERPOLATED', 'Right-hand series was linearly interpolated onto left-hand coordinates; no extrapolation.');
  return { ...right, coordinates: copyData(left.coordinates), shape: [...left.shape], data };
}

function zipNumbers(a, b, fn) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const count = Array.isArray(a) ? a.length : b.length;
    return Array.from({ length: count }, (_, i) => zipNumbers(Array.isArray(a) ? a[i] : a, Array.isArray(b) ? b[i] : b, fn));
  }
  if (a === null || b === null) fail('MISSING_DATA', 'Missing samples cannot be used as numeric zero.');
  const result = fn(a, b);
  if (!Number.isFinite(result)) fail('NONFINITE_RESULT', 'Arithmetic produced a non-finite result.');
  return result;
}

export function binaryValue(operation, leftInput, rightInput, options = {}) {
  const op = ({ add: 'add', subtract: 'subtract', multiply: 'multiply', divide: 'divide', '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide' })[operation];
  if (!op) fail('UNKNOWN_OPERATOR', `Unsupported arithmetic ${operation}.`);
  requireFields(options, ['comparison', 'alignment'], 'options');
  const left = value(leftInput);
  let right = value(rightInput);
  const scaling = ['multiply', 'divide'].includes(op) && (left.kind === 'scalar' || right.kind === 'scalar');
  const candidates = scaling ? [right, left].filter(v => v.kind === 'scalar') : [];
  const scalar = candidates.find(v => v.reference === null && v.frame === null && v.normalization === null && v.time === null)
    ?? candidates.find(v => v.frame === null && v.normalization === null && v.time === null) ?? candidates[0] ?? null;
  const neutralScale = scalar && scalar.frame === null && scalar.normalization === null;
  const base = scaling && left.kind === 'scalar' && (right.kind !== 'scalar' || (neutralScale && scalar === left)) ? right : left;
  if (!scaling && (left.kind !== right.kind || left.shape.length !== right.shape.length || left.shape.slice(1).some((n, i) => n !== right.shape[i + 1]) || (!['series', 'collection'].includes(left.kind) && !equal(left.shape, right.shape)))) fail('SHAPE_MISMATCH', 'Arithmetic needs equal shapes or scalar multiplication/division.');
  if (['multiply', 'divide'].includes(op) && !scaling && (left.kind === 'vector' || left.shape.length === 2)) fail('UNSUPPORTED_ARITHMETIC', 'Vector products require an explicit dot/cross/tensor operator, not elementwise multiplication.');
  if (op === 'divide' && left.kind === 'scalar' && (right.kind === 'vector' || right.shape.length === 2)) fail('UNSUPPORTED_ARITHMETIC', 'A vector denominator is not scalar scaling.');
  if ((op === 'multiply' && left.normalization !== null && right.normalization !== null) || (op === 'divide' && right.normalization !== null)) {
    fail('NORMALIZATION_MISMATCH', 'Products of normalized quantities and normalized denominators need an explicit adapter defining output normalization.');
  }
  let outputFrame = base.frame;
  if (!neutralScale) {
    if (left.frame && right.frame && ['add', 'subtract'].includes(op) && left.frame.id === right.frame.id && left.frame.kind !== 'display' && right.frame.kind !== 'display') {
      const pair = `${left.frame.kind}:${right.frame.kind}`;
      if ((op === 'add' && pair === 'position:position') || (op === 'subtract' && pair === 'direction:position')) fail('AFFINE_OPERATION', 'Positions are affine coordinates: add a displacement, or subtract two positions.');
      outputFrame = { id: left.frame.id, kind: op === 'subtract' && pair === 'position:position' ? 'direction' : pair.includes('position') ? 'position' : 'direction' };
    } else if (!equal(left.frame, right.frame)) fail('FRAME_MISMATCH', 'Frames differ; transform explicitly before arithmetic.');
    if (!equal(left.normalization, right.normalization)) fail('NORMALIZATION_MISMATCH', 'Normalization references/definitions differ.');
  }
  if (!timeEqual(left.time, right.time) && !(neutralScale && scalar.time === null)) fail('TIME_MISMATCH', 'Arithmetic inputs must refer to the same physical time.');
  const meta = mergeMetadata(left, right);
  let outputMeaning = ['add', 'subtract'].includes(op) ? left.meaning : `${op}(${left.meaning},${right.meaning})`;
  if (op === 'subtract' && left.frame?.kind === 'position' && right.frame?.kind === 'position') outputMeaning = 'displacement';
  let outputReference = base.reference ?? (neutralScale ? (left.reference ?? right.reference) : null);
  if (options.comparison !== undefined) {
    requireFields(options.comparison, ['meaning', 'reference'], 'comparison');
    if (!text(options.comparison.meaning) || !Object.hasOwn(options.comparison, 'reference') || (options.comparison.reference !== null && !text(options.comparison.reference))) fail('INVALID_COMPARISON', 'A comparison must explicitly declare its meaning and reference (or null).');
    outputMeaning = options.comparison.meaning; outputReference = options.comparison.reference;
    warn(meta, 'UNVALIDATED_COMPARISON', 'An author-declared comparison is a generic mathematical result, not a validated physical observable.');
  } else if ((['add', 'subtract'].includes(op) && left.meaning !== right.meaning) ||
      (left.reference !== right.reference && !(neutralScale && (left.reference === null || right.reference === null)))) {
    fail('COMPARISON_REQUIRED', 'Different meanings/references need an explicit comparison {meaning,reference}.');
  }
  if (options.alignment !== undefined) {
    requireFields(options.alignment, ['policy', 'target'], 'alignment');
    if (options.alignment.policy !== 'linear' || options.alignment.target !== 'left') fail('SAMPLE_ALIGNMENT', 'Supported alignment is {policy:"linear",target:"left"}.');
  }
  if (!scaling) right = aligned(left, right, options.alignment, meta);
  let outputUnit;
  if (['add', 'subtract'].includes(op)) { right = convertValue(right, left.unit); outputUnit = left.unit; }
  else outputUnit = mergedUnit(left.unit, right.unit, op === 'divide');
  const data = zipNumbers(left.data, right.data, (a, b) => {
    if (op === 'divide' && b === 0) fail('DIVISION_BY_ZERO', 'Division by zero is undefined.');
    return op === 'add' ? a + b : op === 'subtract' ? a - b : op === 'multiply' ? a * b : a / b;
  });
  return value({ ...base, data, unit: outputUnit, meaning: outputMeaning, reference: outputReference, frame: outputFrame,
    time: neutralScale ? left.time ?? right.time : base.time, metadata: meta });
}

export function mapValue(op, input) {
  const v = value(input);
  if (op === 'magnitude') {
    if (v.kind !== 'vector' && v.shape.length !== 2) fail('SHAPE_MISMATCH', 'Magnitude needs vectors or vector-valued containers.');
    const magnitude = row => missing(row) ? null : Math.hypot(...row);
    return value({ ...v, kind: v.kind === 'vector' ? 'scalar' : v.kind, shape: v.shape.slice(0, -1),
      data: v.kind === 'vector' ? magnitude(v.data) : v.data.map(magnitude), frame: null, meaning: `magnitude(${v.meaning})` });
  }
  if (op === 'abs') {
    if (v.kind === 'vector' || v.shape.length === 2) fail('SHAPE_MISMATCH', 'abs accepts scalar-valued data; use magnitude for vectors.');
    return value({ ...v, data: mapNumbers(v.data, Math.abs), meaning: `abs(${v.meaning})` });
  }
  fail('UNKNOWN_OPERATOR', `Unsupported per-object map ${op}.`);
}

export function reduceValue(op, input) {
  const v = value(input);
  if (!['sum', 'mean'].includes(op)) fail('UNKNOWN_OPERATOR', `Unsupported reduction ${op}.`);
  if (v.kind !== 'collection' || v.shape.length !== 1) fail('SHAPE_MISMATCH', 'Reductions accept scalar per-object collections.');
  if (!v.data.length) fail('EMPTY_COLLECTION', 'An empty collection has no supported reduction.');
  if (missing(v.data)) fail('MISSING_DATA', 'A reduction cannot silently omit or zero-fill missing values.');
  // Compensated summation preserves small terms in ordinary collection sums.
  let total = 0, correction = 0;
  for (const item of v.data) { const next = item - correction, updated = total + next; correction = (updated - total) - next; total = updated; }
  const data = op === 'mean' ? total / v.data.length : total;
  if (!Number.isFinite(data)) fail('NONFINITE_RESULT', 'Reduction produced a non-finite result.');
  return value({ ...v, kind: 'scalar', shape: [], data, objectIds: null, frame: null, meaning: `${op}(${v.meaning})` });
}

export function fieldValue(input, indices) {
  const v = value(input), selected = copyData(indices);
  if (v.kind !== 'field' || !Array.isArray(selected) || selected.some(i => !Number.isInteger(i) || i < 0 || i >= v.shape[0]) || new Set(selected).size !== selected.length) fail('FIELD_SELECTION', 'Choose distinct in-range field row indices.');
  return value({ ...v, shape: [selected.length, ...v.shape.slice(1)], data: selected.map(i => v.data[i]),
    coordinates: { ...v.coordinates, values: selected.map(i => v.coordinates.values[i]) } });
}

function rotate(vector, rotation) { return rotation.map(row => row.reduce((sum, coefficient, i) => sum + coefficient * vector[i], 0)); }

export function transformValue(input, options) {
  const v = value(input), transform = copyData(options);
  requireFields(transform, ['from', 'to', 'rotation', 'translation', 'unit'], 'transform');
  if (!text(transform.from) || !text(transform.to) || !Array.isArray(transform.rotation) || transform.rotation.length !== 3 || transform.rotation.some(row => !Array.isArray(row) || row.length !== 3 || row.some(x => !Number.isFinite(x)))) fail('INVALID_TRANSFORM', 'A transform needs frame IDs and a finite 3×3 rotation.');
  const r = transform.rotation;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (Math.abs(r[i].reduce((sum, x, k) => sum + x * r[j][k], 0) - (i === j ? 1 : 0)) > 1e-10) fail('INVALID_TRANSFORM', 'Rotation must be orthonormal.');
  }
  const determinant = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  if (Math.abs(determinant - 1) > 1e-10) fail('INVALID_TRANSFORM', 'A proper rotation must have determinant +1.');
  const hasTranslation = Object.hasOwn(transform, 'translation');
  const translation = transform.translation ?? [0, 0, 0];
  if (!Array.isArray(translation) || translation.length !== 3 || translation.some(x => !Number.isFinite(x))) fail('INVALID_TRANSFORM', 'Translation must be a finite 3-vector.');
  const translationUnit = unit(transform.unit ?? 'm');
  if (!sameDimensions(translationUnit, 'm')) fail('INVALID_TRANSFORM', 'Translation requires length units.');
  if (v.frame?.kind === 'display') fail('FRAME_MISMATCH', 'Display coordinates cannot be promoted to a physical frame.');
  const vectorData = v.kind === 'vector' || v.shape.length === 2;
  if (vectorData && (!v.frame || v.frame.id !== transform.from)) fail('FRAME_MISMATCH', 'Value does not declare the transform source frame.');
  if (!vectorData && v.kind !== 'field') fail('SHAPE_MISMATCH', 'Transform vectors or spatial fields.');
  if (v.kind === 'field' && v.coordinates.frame.id !== transform.from) fail('FRAME_MISMATCH', 'Field coordinates do not declare the transform source frame.');
  if (v.frame?.kind === 'direction' && hasTranslation && v.kind !== 'field') fail('INVALID_TRANSFORM', 'Directions rotate; translation applies only to positions.');
  if (v.frame?.kind === 'position' && !sameDimensions(v.unit, 'm')) fail('UNIT_MISMATCH', 'Position vectors need length units for a rigid transform.');
  const transformRow = (row, kind, targetUnit) => {
    if (missing(row)) return [null, null, null];
    const rotated = rotate(row, r);
    return rotated.map((x, i) => x + (kind === 'position' ? translation[i] * translationUnit.scale / targetUnit.scale : 0));
  };
  let data = v.data;
  if (vectorData) data = v.kind === 'vector' ? transformRow(v.data, v.frame.kind, v.unit) : v.data.map(row => transformRow(row, v.frame.kind, v.unit));
  const coords = v.kind === 'field' ? { ...v.coordinates, frame: { id: transform.to, kind: 'position' },
    values: v.coordinates.values.map(row => transformRow(row, 'position', v.coordinates.unit)) } : v.coordinates;
  return value({ ...v, data, frame: vectorData ? { ...v.frame, id: transform.to } : v.frame, coordinates: coords });
}
