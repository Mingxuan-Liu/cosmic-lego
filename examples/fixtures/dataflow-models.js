// Trusted composition-root fixtures. These test software contracts, not astronomy.
import { value, unit, convertValue, transformValue } from '../../src/dataflow/index.js';

const implementation = id => ({ id, version: '1.0.0' });
const triple = input => Array.isArray(input) && input.length === 3
  && input.every(number => typeof number === 'number' && Number.isFinite(number));
const issue = (node, field, code, message) => ({
  code, path: `nodes[${JSON.stringify(node.id)}].data.parameters.${field}`, message,
});
const modelError = (code, message) => Object.assign(new Error(message), { code });

function pointParameters(node) {
  return { positionUnit: 'm', velocityUnit: 'm/s', frame: 'lab', ...node.data.parameters };
}

function fieldParameters(node) {
  return {
    valueUnit: '1', coordinateUnit: 'm', frame: 'lab',
    meaning: node.type === 'fixture.scalar-field' ? 'fixture.scalar' : 'fixture.vector',
    ...node.data.parameters,
  };
}

function pointDescriptor(node, port) {
  const parameters = pointParameters(node);
  const position = port === 'position';
  return {
    kind: 'vector', shape: [3],
    unit: unit(position ? parameters.positionUnit : parameters.velocityUnit),
    meaning: position ? 'position' : 'velocity', reference: node.id,
    frame: { id: parameters.frame, kind: position ? 'position' : 'direction' },
    normalization: null,
  };
}

function fieldDescriptor(node, vector) {
  const parameters = fieldParameters(node);
  return {
    kind: 'field', shape: vector ? [parameters.coordinates.length, 3] : [parameters.coordinates.length],
    unit: unit(parameters.valueUnit), meaning: parameters.meaning, reference: node.id,
    frame: vector ? { id: parameters.frame, kind: 'direction' } : null,
    normalization: null,
    coordinates: {
      kind: 'space', unit: unit(parameters.coordinateUnit),
      frame: { id: parameters.frame, kind: 'position' },
      values: parameters.coordinates,
    },
  };
}

function validateFrame(node, parameters) {
  return typeof parameters.frame === 'string' && parameters.frame.trim() ? []
    : [issue(node, 'frame', 'FIXTURE_FRAME', 'Provide a named coordinate frame.')];
}

function validatePoint(node) {
  const parameters = pointParameters(node);
  const errors = validateFrame(node, parameters);
  for (const field of ['position', 'velocity']) {
    if (!triple(parameters[field])) errors.push(issue(node, field, 'FIXTURE_VECTOR',
      'Provide three finite coordinates.'));
  }
  // Unit compatibility is checked with the shared conversion implementation.
  for (const [field, target] of [['positionUnit', 'm'], ['velocityUnit', 'm/s']]) {
    try {
      convertValue(value({ kind: 'scalar', data: 1, unit: parameters[field], meaning: 'fixture.unit-check' }), target);
    } catch (cause) {
      errors.push(issue(node, field, 'FIXTURE_UNIT', cause.message));
    }
  }
  return errors;
}

function validateField(node, vector) {
  const parameters = fieldParameters(node);
  const errors = validateFrame(node, parameters);
  if (!Array.isArray(parameters.coordinates) || !parameters.coordinates.length
      || !parameters.coordinates.every(triple)) {
    errors.push(issue(node, 'coordinates', 'FIXTURE_COORDINATES',
      'Provide a nonempty array of three-dimensional sample positions.'));
  }
  const datum = vector ? row => Array.isArray(row) && row.length === 3
    && row.every(item => item === null || (typeof item === 'number' && Number.isFinite(item))) : item => typeof item === 'number' && Number.isFinite(item);
  if (!Array.isArray(parameters.values) || parameters.values.length !== parameters.coordinates?.length
      || !parameters.values.every(item => item === null || datum(item))) {
    errors.push(issue(node, 'values', 'FIXTURE_FIELD_VALUES',
      'Supply one scalar/vector (or null missing datum) for each declared coordinate.'));
  }
  for (const field of ['valueUnit', 'coordinateUnit']) {
    try {
      unit(parameters[field]);
      if (field === 'coordinateUnit') {
        convertValue(value({ kind: 'scalar', data: 1, unit: parameters[field], meaning: 'fixture.unit-check' }), 'm');
      }
    } catch (cause) { errors.push(issue(node, field, 'FIXTURE_UNIT', cause.message)); }
  }
  if (typeof parameters.meaning !== 'string' || !parameters.meaning.trim()) {
    errors.push(issue(node, 'meaning', 'FIXTURE_MEANING', 'Declare the meaning of field values.'));
  }
  return errors;
}

function declaredField(node, vector) {
  const supplied = fieldParameters(node).values;
  // A wholly missing vector remains three missing components, never zeros.
  const data = vector ? supplied.map(row => row === null ? [null, null, null] : row) : supplied;
  const hasMissing = data.some(item => item === null || (Array.isArray(item) && item.includes(null)));
  return value({
    ...fieldDescriptor(node, vector), data,
    metadata: {
      warnings: hasMissing ? [{
        code: 'FIXTURE_MISSING_DATA', path: 'data', message: 'Some declared field samples are missing.',
      }] : [],
      approximation: ['Declared samples only; no interpolation or field solver.'],
    },
  });
}

export const fixtureModels = {
  'fixture.moving-point': {
    implementation: implementation('fixture.linear-motion'),
    validate: validatePoint,
    outputs: node => ({ position: pointDescriptor(node, 'position'), velocity: pointDescriptor(node, 'velocity') }),
    evaluate({ node, request }) {
      const parameters = pointParameters(node);
      if (!request.time) throw modelError('MISSING_TIME', 'Moving-point evaluation requires an explicit physical time.');
      const seconds = convertValue(value({
        kind: 'scalar', data: request.time.value, unit: request.time.unit, meaning: 'elapsed-time',
      }), 's').data;
      const velocitySI = convertValue(value({
        ...pointDescriptor(node, 'velocity'), data: parameters.velocity,
      }), 'm/s').data;
      const displacement = convertValue(value({
        kind: 'vector', data: velocitySI.map(speed => speed * seconds), unit: 'm',
        meaning: 'displacement', frame: { id: parameters.frame, kind: 'direction' },
      }), parameters.positionUnit).data;
      const metadata = {
        warnings: [], approximation: ['Constant velocity in a fixed Cartesian frame; no force model.'],
      };
      return {
        position: value({
          ...pointDescriptor(node, 'position'),
          data: parameters.position.map((coordinate, index) => coordinate + displacement[index]),
          time: request.time, metadata,
        }),
        velocity: value({ ...pointDescriptor(node, 'velocity'), data: parameters.velocity, time: request.time, metadata }),
      };
    },
  },
  'fixture.scalar-field': {
    implementation: implementation('fixture.declared-scalar-field'),
    validate: node => validateField(node, false),
    outputs: node => ({ value: fieldDescriptor(node, false) }),
    evaluate: ({ node }) => ({ value: declaredField(node, false) }),
  },
  'fixture.vector-field': {
    implementation: implementation('fixture.declared-vector-field'),
    validate: node => validateField(node, true),
    outputs: node => ({ value: fieldDescriptor(node, true) }),
    evaluate: ({ node }) => ({ value: declaredField(node, true) }),
  },
};

/** Register exact semantic contracts, rather than silently relabeling references. */
export function makePositionAdapters(reference = null) {
  const suffix = reference ?? 'unreferenced';
  const descriptor = (symbol, frame) => ({
    kind: 'vector', shape: [3], unit: unit(symbol), meaning: 'position', reference,
    frame: { id: frame, kind: 'position' }, normalization: null,
  });
  return {
    [`fixture.kilometers-to-meters.${suffix}`]: {
      implementation: implementation('fixture.length-conversion'),
      input: descriptor('km', 'lab'), output: descriptor('m', 'lab'),
      apply: input => convertValue(input, 'm'),
    },
    [`fixture.lab-to-shifted.${suffix}`]: {
      implementation: implementation('fixture.rigid-frame-change'),
      input: descriptor('m', 'lab'), output: descriptor('m', 'shifted-lab'),
      apply: input => transformValue(input, {
        from: 'lab', to: 'shifted-lab',
        rotation: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
        translation: [10, 0, 0], unit: 'm',
      }),
    },
  };
}

export const fixtureAdapters = makePositionAdapters();
