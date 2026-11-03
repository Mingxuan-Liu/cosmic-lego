// Run in the author's process: node examples/scientific-dataflow.mjs
// These software fixtures supply no astronomical model or rendering engine.
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { createDataflow, value } from '../src/dataflow/index.js';
import { fixtureModels, fixtureAdapters, makePositionAdapters } from './fixtures/dataflow-models.js';

export function buildExample() {
  const flow = createDataflow({
    models: fixtureModels,
    adapters: {
      ...fixtureAdapters,
      ...makePositionAdapters('moving-m'),
      ...makePositionAdapters('moving-km'),
    },
  });
  const project = new Project({
    id: 'generic-dataflow', title: 'Points, fields, and explicit comparisons',
    validators: flow.validators,
  });
  const draft = project.begin();
  const author = flow.author(draft);

  function point(id, position, velocity, positionUnit = 'm', velocityUnit = 'm/s') {
    return author.component('fixture.moving-point', {
      id, parameters: { position, velocity, positionUnit, velocityUnit, frame: 'lab' },
    });
  }

  const meters = point('moving-m', [1000, 2000, 0], [3, 4, 0]);
  const kilometers = point('moving-km', [1, 2, 0], [0.003, 0.004, 0], 'km', 'km/s');
  const second = point('second-point', [0, 0, 0], [-3, 0, 0]);
  const converted = author.adapt('fixture.kilometers-to-meters.moving-km', {
    node: kilometers, port: 'position',
  }, { id: 'converted-position' });
  author.arithmetic('subtract', { node: meters, port: 'position' }, converted, {
    id: 'position-difference',
    comparison: { meaning: 'displacement', reference: 'moving-m-vs-moving-km' },
  });
  author.adapt('fixture.lab-to-shifted.moving-m', { node: meters, port: 'position' }, {
    id: 'shifted-position',
  });

  const fixed = author.select({
    mode: 'fixed', members: [{ node: meters, port: 'velocity' }, { node: second, port: 'velocity' }],
  }, { id: 'fixed-velocities' });
  const live = author.select({
    mode: 'live', type: 'fixture.moving-point', port: 'velocity',
  }, { id: 'live-velocities' });
  for (const [mode, collection] of [['fixed', fixed], ['live', live]]) {
    const speeds = author.map('magnitude', collection, { id: `${mode}-speeds` });
    author.reduce('mean', speeds, { id: `${mode}-mean-speed` });
  }

  const scalarField = author.component('fixture.scalar-field', {
    id: 'scalar-field',
    parameters: {
      coordinates: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      values: [2, -4, 8], valueUnit: '1', coordinateUnit: 'm',
      frame: 'lab', meaning: 'signed-fixture-scalar',
    },
  });
  author.field(scalarField, [2, 0], { id: 'selected-field' });
  author.component('fixture.vector-field', {
    id: 'vector-field',
    parameters: {
      coordinates: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      values: [[1, 0, 0], [0, 2, 0], [-3, 0, 0]],
      valueUnit: 'm/s', coordinateUnit: 'm', frame: 'lab', meaning: 'velocity',
    },
  });
  author.constant(value({
    kind: 'series', data: [0, -2, 4], unit: 'm', meaning: 'signed-fixture-signal',
    coordinates: { kind: 'time', unit: 's', values: [0, 1, 3] },
    metadata: {
      warnings: [{ code: 'FIXTURE_SAMPLES', path: '$', message: 'Declared fixture samples; no interpolation has been applied.' }],
      approximation: [],
    },
  }), { id: 'sampled-signal' });

  draft.presentation('fixture.camera', {
    id: 'camera', data: { azimuth: 30, displayUnit: 'km' },
  });
  draft.accept();
  return { project, flow };
}

export default buildExample;

function checked(flow, project, id, request = { time: { value: 2, unit: 's' } }) {
  const result = flow.evaluate(project, id, request);
  if (!result.valid) throw new Error(`${id}: ${JSON.stringify(result.diagnostics)}`);
  return result;
}

export function demonstrate() {
  const { project, flow } = buildExample();
  const initial = {
    convertedPosition: checked(flow, project, 'converted-position').value.data,
    positionDifference: checked(flow, project, 'position-difference').value.data,
    shiftedPosition: checked(flow, project, 'shifted-position').value.data,
    fixedMeanSpeed: checked(flow, project, 'fixed-mean-speed').value.data,
    liveMeanSpeed: checked(flow, project, 'live-mean-speed').value.data,
  };
  assert.deepEqual(initial.convertedPosition, [1006, 2008, 0]);
  assert.ok(initial.positionDifference.every(component => Math.abs(component) < 1e-10));
  assert.deepEqual(initial.shiftedPosition, [-1998, 1006, 0]);
  assert.equal(initial.fixedMeanSpeed, 4);
  assert.equal(initial.liveMeanSpeed, 13 / 3);
  const draft = project.begin();
  flow.author(draft).component('fixture.moving-point', {
    id: 'added-point',
    parameters: {
      position: [0, 0, 0], velocity: [1, 0, 0],
      positionUnit: 'm', velocityUnit: 'm/s', frame: 'lab',
    },
  });
  draft.get('camera').set({ data: { azimuth: 90, displayUnit: 'm' } });
  draft.accept();

  const selected = checked(flow, project, 'selected-field');
  const vectorField = checked(flow, project, 'vector-field');
  const afterAddAndCameraEdit = {
    positionDifference: checked(flow, project, 'position-difference').value.data,
    fixedMeanSpeed: checked(flow, project, 'fixed-mean-speed').value.data,
    liveMeanSpeed: checked(flow, project, 'live-mean-speed').value.data,
  };
  assert.deepEqual(afterAddAndCameraEdit.positionDifference, initial.positionDifference);
  assert.equal(afterAddAndCameraEdit.fixedMeanSpeed, 4);
  assert.equal(afterAddAndCameraEdit.liveMeanSpeed, 3.5);
  assert.deepEqual(selected.value.data, [8, 2]);

  const reopened = Project.from(JSON.parse(JSON.stringify(project.snapshot())), { validators: flow.validators });
  const samples = checked(flow, reopened, 'sampled-signal').value;
  assert.deepEqual(samples, checked(flow, project, 'sampled-signal').value);
  return {
    identity: project.token,
    initial,
    afterAddAndCameraEdit,
    selectedField: {
      values: selected.value.data, coordinates: selected.value.coordinates.values,
      coordinateUnit: selected.value.coordinates.unit.symbol,
    },
    vectorField: {
      values: vectorField.value.data, coordinates: vectorField.value.coordinates.values,
      unit: vectorField.value.unit.symbol, frame: vectorField.value.frame,
    },
    roundTrippedSamples: {
      values: samples.data, unit: samples.unit.symbol,
      timeCoordinates: samples.coordinates.values,
      timeUnit: samples.coordinates.unit.symbol,
      warnings: samples.metadata.warnings.map(warning => warning.code),
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(demonstrate(), null, 2));
}
