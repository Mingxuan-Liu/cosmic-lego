// Trusted local extensions selected by a composition root, never loaded by data.
// These are software reference fixtures, not reviewed astronomical models.
import { value, convertValue, binaryValue } from '../../src/dataflow/index.js';

const identity = id => ({ id, version: '1.0.0', build: 'fixture-build-1' });
const objectSchema = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const vectorSchema = (defaultValue, bound = 1e6) => ({
  type: 'array', items: { type: 'number', minimum: -bound, maximum: bound },
  minItems: 3, maxItems: 3, ...(defaultValue ? { default: defaultValue } : {}),
});
const positionsSchema = {
  type: 'array', items: vectorSchema(), minItems: 1, maxItems: 32,
};
const frameSchema = { type: 'string', default: 'lab' };
const lengthUnitSchema = { type: 'string', enum: ['m', 'km'], default: 'm' };
const scalarLengthPort = {
  kind: 'scalar', shape: [], unit: 'm', meaning: 'length',
  reference: null, frame: null, normalization: null,
};
const positionPort = (reference = { $node: 'id' }) => ({
  kind: 'vector', shape: [3], unit: { $param: 'unit' }, meaning: 'position', reference,
  frame: { id: { $param: 'frame' }, kind: 'position' }, normalization: null,
});
const provenance = {
  source: 'Cosmic Lego deterministic original software fixture', license: 'BSD-3-Clause',
};
const geometryDataSchema = objectSchema({
  positions: positionsSchema,
  size: { type: 'number', minimum: 0.01, maximum: 100 },
});
const tolerance = { absolute: 1e-12, relative: 1e-12 };
const issue = (code, path, message) => ({ code, path, message });

function science({ equation, assumption, guardId, guardDescription, mode }) {
  return {
    equations: [equation],
    references: [{ title: 'Fixture mathematical definition', locator: equation }],
    assumptions: [assumption],
    applicability: [{ id: guardId, description: guardDescription }],
    evaluation: { mode, sampling: ['instant'] },
    review: {
      status: 'experimental',
      notes: 'Software-contract fixture; no independent scientific review is claimed.',
      evidence: [],
    },
  };
}

function manifestBase(id, kind, summary, example, capabilities) {
  return {
    schemaVersion: 1, apiVersion: 1, id, version: '1.0.0',
    implementation: identity(`${id}.implementation`), kind,
    dependencies: [], capabilities,
    documentation: { summary, links: [], examples: [{ parameters: example }] },
    diagnostics: [],
  };
}

const movingPoint = {
  manifest: {
    ...manifestBase('fixture.moving-point', 'model',
      'Constant-velocity points in a declared Cartesian frame; r0 uses unit and v uses m/s.',
      { r0: [1, -2, 3], v: [2, -1, 0.5], unit: 'm', frame: 'lab' }, ['dataflow.sync']),
    parameters: objectSchema({
      r0: vectorSchema([0, 0, 0]), v: vectorSchema([1, 0, 0], 1e4),
      unit: lengthUnitSchema, frame: frameSchema,
    }),
    ports: { inputs: {}, outputs: { position: positionPort() } },
    science: science({
      equation: 'r(t) = r0 + v t, with v in m/s and t converted to seconds.',
      assumption: 'A fixed Cartesian frame and constant velocity; no force or interaction model.',
      guardId: 'bounded-speed', guardDescription: 'Fixture speed must not exceed 100 m/s.',
      mode: 'analytic',
    }),
    diagnostics: [{ code: 'FIXTURE_SPEED_LIMIT', description: 'The fixture speed exceeds its declared 100 m/s bound.' }],
  },
  implementation: {
    guards: {
      'bounded-speed': node => Math.hypot(...node.data.parameters.v) <= 100 ? [] : [issue(
        'FIXTURE_SPEED_LIMIT', 'data.parameters.v', 'This software fixture permits speeds up to 100 m/s.',
      )],
    },
    evaluate({ node, request }) {
      const parameters = node.data.parameters;
      const seconds = convertValue(value({
        kind: 'scalar', data: request.time.value, unit: request.time.unit, meaning: 'elapsed-time',
      }), 's').data;
      const displacement = convertValue(value({
        kind: 'vector', data: parameters.v.map(speed => speed * seconds),
        unit: 'm', meaning: 'displacement', frame: { id: parameters.frame, kind: 'direction' },
      }), parameters.unit).data;
      return { position: value({
        kind: 'vector', data: parameters.r0.map((coordinate, index) => coordinate + displacement[index]),
        unit: parameters.unit, meaning: 'position', reference: node.id,
        frame: { id: parameters.frame, kind: 'position' }, time: request.time,
        metadata: { warnings: [], approximation: ['Constant velocity in a fixed Cartesian frame; no forces.'] },
      }) };
    },
  },
  referenceCases: [
    {
      id: 'advance-in-seconds', description: 'Evaluate three signed coordinate components at two seconds.',
      parameters: { r0: [1, -2, 3], v: [2, -1, 0.5] },
      request: { time: { value: 2, unit: 's' } },
      expected: { outputs: { position: value({
        kind: 'vector', data: [5, -4, 4], unit: 'm', meaning: 'position', reference: 'subject',
        frame: { id: 'lab', kind: 'position' }, time: { value: 2, unit: 's' },
        metadata: { warnings: [], approximation: ['Constant velocity in a fixed Cartesian frame; no forces.'] },
      }) } }, tolerance,
    },
    {
      id: 'kilometers-and-minutes', description: 'Convert m/s and minutes while retaining kilometer output.',
      parameters: { r0: [1, 2, 3], v: [10, 0, 0], unit: 'km' },
      request: { time: { value: 1, unit: 'min' } },
      expected: { outputs: { position: value({
        kind: 'vector', data: [1.6, 2, 3], unit: 'km', meaning: 'position', reference: 'subject',
        frame: { id: 'lab', kind: 'position' }, time: { value: 1, unit: 'min' },
        metadata: { warnings: [], approximation: ['Constant velocity in a fixed Cartesian frame; no forces.'] },
      }) } }, tolerance,
    },
    {
      id: 'speed-applicability', description: 'Reject a structurally valid velocity outside the fixture applicability bound.',
      parameters: { v: [101, 0, 0] }, expectedError: 'FIXTURE_SPEED_LIMIT', tolerance,
    },
  ],
};

const scaleLength = {
  manifest: {
    ...manifestBase('fixture.scale-length', 'operator',
      'Scale a signed scalar length by a dimensionless factor.', { factor: 2 }, ['dataflow.sync']),
    parameters: objectSchema({ factor: { type: 'number', minimum: -1000, maximum: 1000, default: 2 } }),
    ports: { inputs: { source: scalarLengthPort }, outputs: { value: scalarLengthPort } },
    science: science({
      equation: 'length_out = factor × length_in.',
      assumption: 'Scalar lengths with explicit meter units and no frame or normalization.',
      guardId: 'bounded-factor', guardDescription: 'The absolute scale factor must not exceed 100.',
      mode: 'stateless',
    }),
    diagnostics: [{ code: 'FIXTURE_SCALE_LIMIT', description: 'The absolute scaling factor exceeds 100.' }],
  },
  implementation: {
    guards: {
      'bounded-factor': node => Math.abs(node.data.parameters.factor) <= 100 ? [] : [issue(
        'FIXTURE_SCALE_LIMIT', 'data.parameters.factor', 'This software fixture permits |factor| ≤ 100.',
      )],
    },
    evaluate({ node, inputs }) {
      const scaled = binaryValue('multiply', inputs.source, value({
        kind: 'scalar', data: node.data.parameters.factor, unit: '1', meaning: 'scale-factor',
      }));
      return { value: value({ ...convertValue(scaled, 'm'), meaning: 'length' }) };
    },
  },
  referenceCases: [
    {
      id: 'signed-length', description: 'Preserve a negative scalar input while scaling.',
      parameters: { factor: 2.5 },
      inputs: { source: value({ kind: 'scalar', data: -3, unit: 'm', meaning: 'length' }) },
      expected: { outputs: { value: value({ kind: 'scalar', data: -7.5, unit: 'm', meaning: 'length' }) } },
      tolerance,
    },
    {
      id: 'negative-factor', description: 'A negative factor reverses the scalar sign.',
      parameters: { factor: -2 },
      inputs: { source: value({ kind: 'scalar', data: 4, unit: 'm', meaning: 'length' }) },
      expected: { outputs: { value: value({ kind: 'scalar', data: -8, unit: 'm', meaning: 'length' }) } },
      tolerance,
    },
    {
      id: 'factor-applicability', description: 'Reject a factor outside the declared applicability bound.',
      parameters: { factor: 101 },
      inputs: { source: value({ kind: 'scalar', data: 1, unit: 'm', meaning: 'length' }) },
      expectedError: 'FIXTURE_SCALE_LIMIT', tolerance,
    },
  ],
};

const pointGeometry = {
  manifest: {
    ...manifestBase('fixture.point-geometry', 'asset-factory',
      'Produce deterministic point-cloud data in local geometry coordinates; no renderer is invoked.',
      { positions: [[0, 0, 0]], size: 1 }, ['assets.data']),
    parameters: objectSchema({
      positions: { ...positionsSchema, default: [[0, 0, 0]] },
      size: { type: 'number', minimum: 0.01, maximum: 100, default: 1 },
    }),
    ports: { inputs: {}, outputs: {} },
    artifact: { kind: 'geometry', format: 'point-cloud', schema: geometryDataSchema, provenance },
  },
  implementation: {
    create: ({ node }) => ({ positions: node.data.parameters.positions, size: node.data.parameters.size }),
  },
  referenceCases: [{
    id: 'declared-points', description: 'Retain each local point coordinate and marker size.',
    parameters: { positions: [[0, 0, 0], [1, -2, 3]], size: 0.5 },
    expected: { artifact: { positions: [[0, 0, 0], [1, -2, 3]], size: 0.5 } }, tolerance,
  }],
};

const pointView = {
  manifest: {
    ...manifestBase('fixture.point-view', 'view-adapter',
      'Bind a physical point and a geometry artifact into declarative view data; markerScale is presentation only.',
      { targetId: 'point', markerScale: 1, unit: 'm', frame: 'lab' },
      ['dataflow.sync', 'assets.data', 'views.data']),
    parameters: objectSchema({
      targetId: { type: 'string', default: 'point' },
      markerScale: { type: 'number', minimum: 0.1, maximum: 10, default: 1 },
      unit: lengthUnitSchema, frame: frameSchema,
    }),
    ports: { inputs: { position: positionPort({ $param: 'targetId' }) }, outputs: {} },
    dependencies: [{ id: 'fixture.point-geometry', version: '1.0.0', build: 'fixture-build-1' }],
    assets: { geometry: { kind: 'geometry', format: 'point-cloud' } },
    artifact: {
      kind: 'view', format: 'point-view', provenance,
      schema: objectSchema({
        position: vectorSchema(), unit: { type: 'string' }, frame: { type: 'string' },
        geometry: geometryDataSchema,
        markerScale: { type: 'number', minimum: 0.1, maximum: 10 },
      }),
    },
  },
  implementation: {
    create: ({ node, inputs, assets }) => ({
      position: inputs.position.data, unit: inputs.position.unit.symbol, frame: inputs.position.frame.id,
      geometry: assets.geometry.data, markerScale: node.data.parameters.markerScale,
    }),
  },
  referenceCases: [{
    id: 'position-and-geometry', description: 'Keep physical position separate from presentation marker scale.',
    parameters: { targetId: 'view-target', markerScale: 3 },
    inputs: { position: value({
      kind: 'vector', data: [1, 2, 3], unit: 'm', meaning: 'position', reference: 'view-target',
      frame: { id: 'lab', kind: 'position' },
    }) },
    assets: { geometry: { extension: 'fixture.point-geometry', parameters: { size: 0.25 } } },
    expected: { artifact: {
      position: [1, 2, 3], unit: 'm', frame: 'lab',
      geometry: { positions: [[0, 0, 0]], size: 0.25 }, markerScale: 3,
    } }, tolerance,
  }],
};

// Dependency order is explicit. Core/registry/dataflow never import this module.
export const registryExtensions = [movingPoint, scaleLength, pointGeometry, pointView];
