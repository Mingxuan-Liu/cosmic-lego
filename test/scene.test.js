import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateScene, evaluateScene, sampleScene, sceneSchema } from '../src/scene.js';
const example = name => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));

test('all authored examples obey the same contract; schema file matches runtime', () => {
  for (const name of ['single-transit', 'viewing-angles', 'planet-comparison']) assert.equal(validateScene(example(name)).valid, true);
  assert.deepEqual(JSON.parse(readFileSync(new URL('../scene.schema.json', import.meta.url), 'utf8')), sceneSchema);
});

test('unsupported physics, unknown bindings and duplicate identifiers are rejected', () => {
  let scene = example('single-transit'); scene.systems[0].eccentricity = 0.4;
  assert.ok(validateScene(scene).errors.some(e => e.code === 'UNSUPPORTED_FIELD'));
  scene = example('single-transit'); scene.views[0].observerId = 'missing';
  assert.ok(validateScene(scene).errors.some(e => e.code === 'UNKNOWN_OBSERVER'));
  scene = example('single-transit'); scene.observers.push({ ...scene.observers[0] });
  assert.ok(validateScene(scene).errors.some(e => e.code === 'DUPLICATE_ID'));
  scene = example('single-transit'); scene.systems[0].starRadiusSolar = 5; scene.systems[0].periodDays = 0.2;
  assert.ok(validateScene(scene).errors.some(e => e.code === 'PHYSICAL_CONSTRAINT'));
});

test('malformed scenes fail explicitly without executing or coercing content', () => {
  for (const value of [null, {}, [], { systems: [] }, 'code', 0]) assert.equal(validateScene(value).valid, false);
  const scene = example('single-transit'); scene.systems[0].periodDays = '3';
  assert.equal(validateScene(scene).valid, false);
  assert.throws(() => evaluateScene(scene), /finite number/);
});

test('pure display edits leave all physical observations unchanged', () => {
  const scene = example('viewing-angles'); const before = evaluateScene(scene, 0.012);
  scene.presentation.planetDisplayScale = 12; scene.presentation.orbitSeconds = 120;
  assert.deepEqual(evaluateScene(scene, 0.012), before);
});

test('one shared physical clock gives different phases for different periods', () => {
  const scene = example('planet-comparison'); scene.systems[1].periodDays = 6;
  const result = evaluateScene(scene, 0.75);
  assert.ok(Math.abs(result.views[0].state.phase - 0.25) < 1e-12);
  assert.ok(Math.abs(result.views[1].state.phase - 0.125) < 1e-12);
});

test('radius comparison changes depth but leaves the stellar RV identical', () => {
  const scene = example('planet-comparison');
  const middle = evaluateScene(scene, 0).views;
  assert.ok(Math.abs((1 - middle[1].state.flux) / (1 - middle[0].state.flux) - 4) < 1e-10);
  const quarter = evaluateScene(scene, 0.75).views;
  assert.equal(quarter[0].state.stellarRVMps, quarter[1].state.stellarRVMps);
  assert.ok(Math.abs(quarter[2].state.stellarRVMps) > Math.abs(quarter[0].state.stellarRVMps));
});

test('sampling includes equal endpoints and bounds work for external agents', () => {
  const points = sampleScene(example('single-transit'), { samples: 101 }).views[0].points;
  assert.equal(points.length, 101); assert.equal(points[0].phase, 0); assert.equal(points.at(-1).phase, 1);
  assert.ok(Math.abs(points[0].flux - points.at(-1).flux) < 1e-12);
  for (const samples of [0, 1, 2, 4.5, 1e9]) assert.throws(() => sampleScene(example('single-transit'), { samples }), /samples/);
  assert.throws(() => evaluateScene(example('single-transit'), Infinity), /timeDays/);
});
