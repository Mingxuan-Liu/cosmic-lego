import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSTANTS, createSystem, stateAt, circleOverlapArea, sampleOrbit } from '../src/physics.js';

function near(actual, expected, tolerance, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected} (tolerance ${tolerance})`);
}

test('one solar mass and one Julian year recover one AU independently', () => {
  const system = createSystem({ planetMassJupiter: 0, periodDays: 365.25 });
  // Sidereal/Julian year differ slightly; the nominal solar GM yields 0.999987 AU.
  near(system.semiMajorAxisAU, 1, 2e-5, 'Earth-like orbital separation');
  near((system.semiMajorAxisMeters ** 3 / system.periodSeconds ** 2) /
    (system.gravitationalParameterM3S2 / (4 * Math.PI ** 2)), 1, 1e-15, 'Kepler third law');
});

test('barycenter and total momentum are zero while relative separation is constant', () => {
  const system = createSystem({ starMassSolar: 0.6, planetMassJupiter: 7, periodDays: 11 });
  for (const timeDays of [0, 0.3, 2.75, 5.5, 8, 11, -1]) {
    const state = stateAt(system, timeDays, { inclinationDeg: 57 });
    for (const axis of ['x', 'y', 'z']) {
      const barycenter = (system.starMassKg * state.star.worldMeters[axis] + system.planetMassKg * state.planet.worldMeters[axis]) / (system.starMassKg + system.planetMassKg);
      const centerVelocity = (system.starMassKg * state.star.velocityWorldMps[axis] + system.planetMassKg * state.planet.velocityWorldMps[axis]) / (system.starMassKg + system.planetMassKg);
      near(barycenter, 0, 1e-7, `barycenter ${axis}`);
      near(centerVelocity, 0, 1e-11, `momentum ${axis}`);
      near(state.planet.worldMeters[axis] - state.star.worldMeters[axis], state.relative.worldMeters[axis], 2e-6, `relative ${axis}`);
    }
    near(Math.hypot(state.relative.worldMeters.x, state.relative.worldMeters.y), system.semiMajorAxisMeters, 2e-6);
  }
});

test('energy and angular momentum remain constant across the analytic orbit', () => {
  const system = createSystem({ periodDays: 8 });
  const reducedMass = system.starMassKg * system.planetMassKg / (system.starMassKg + system.planetMassKg);
  const expectedEnergy = -CONSTANTS.G * system.starMassKg * system.planetMassKg / (2 * system.semiMajorAxisMeters);
  const expectedAngularMomentum = -reducedMass * Math.sqrt(system.gravitationalParameterM3S2 * system.semiMajorAxisMeters);
  for (const state of sampleOrbit(system, { samples: 33 })) {
    const rvx = state.planet.velocityWorldMps.x - state.star.velocityWorldMps.x;
    const rvy = state.planet.velocityWorldMps.y - state.star.velocityWorldMps.y;
    const kinetic = 0.5 * reducedMass * (rvx ** 2 + rvy ** 2);
    const potential = -CONSTANTS.G * system.starMassKg * system.planetMassKg / system.semiMajorAxisMeters;
    near((kinetic + potential) / expectedEnergy, 1, 2e-15, 'relative orbital energy');
    const angularMomentum = reducedMass * (state.relative.worldMeters.x * rvy - state.relative.worldMeters.y * rvx);
    near(angularMomentum / expectedAngularMomentum, 1, 1e-15, 'angular momentum');
  }
});

test('observer projection, RV sign, and quarter-orbit amplitude use the same state', () => {
  const system = createSystem();
  const expectedK = 2 * Math.PI * system.starOrbitRadiusMeters / system.periodSeconds;
  const approaching = stateAt(system, system.periodDays / 4);
  const receding = stateAt(system, 3 * system.periodDays / 4);
  near(approaching.stellarRVMps, -expectedK, 1e-10);
  near(receding.stellarRVMps, expectedK, 1e-10);
  near(stateAt(system, system.periodDays / 4, { inclinationDeg: 30 }).stellarRVMps, -expectedK / 2, 1e-10);
  const conjunction = stateAt(system, 0, { inclinationDeg: 60 });
  near(conjunction.projectedSeparationMeters / system.semiMajorAxisMeters, 0.5, 1e-15);
  near(conjunction.relative.lineOfSightMeters / system.semiMajorAxisMeters, Math.sqrt(3) / 2, 1e-15);
});

test('face-on observers see no transit and no radial velocity at any phase', () => {
  const system = createSystem();
  for (const inclinationDeg of [0, 180]) {
    for (const state of sampleOrbit(system, { inclinationDeg, samples: 47 })) {
      near(state.stellarRVMps, 0, 0);
      assert.equal(state.flux, 1);
      near(state.projectedSeparationMeters / system.semiMajorAxisMeters, 1, 4e-16);
    }
  }
});

test('central uniform-star transit follows the radius-squared depth and has no false back transit', () => {
  const system = createSystem({ planetRadiusJupiter: 1.4 });
  const midTransit = stateAt(system, 0);
  const expectedDepth = (system.planetRadiusMeters / system.starRadiusMeters) ** 2;
  near(1 - midTransit.flux, expectedDepth, 1e-16);
  assert.equal(midTransit.planetInFront, true);
  const behind = stateAt(system, system.periodDays / 2);
  assert.equal(behind.planetInFront, false);
  assert.equal(behind.flux, 1);
  assert.equal(stateAt(system, system.periodDays / 4).flux, 1);
});

test('zero planet radius or mass have the expected independent limiting behavior', () => {
  const noRadius = createSystem({ planetRadiusJupiter: 0 });
  assert.equal(stateAt(noRadius, 0).flux, 1);
  assert.notEqual(stateAt(noRadius, noRadius.periodDays / 4).stellarRVMps, 0);
  const noMass = createSystem({ planetMassJupiter: 0 });
  near(stateAt(noMass, noMass.periodDays / 4).stellarRVMps, 0, 0);
  assert.ok(stateAt(noMass, 0).flux < 1);
});

test('RV responds to mass according to the two-body amplitude law', () => {
  const low = createSystem({ planetMassJupiter: 1 });
  const high = createSystem({ planetMassJupiter: 6 });
  const ratio = stateAt(high, high.periodDays / 4).stellarRVMps / stateAt(low, low.periodDays / 4).stellarRVMps;
  const expected = 6 * ((low.starMassKg + low.planetMassKg) / (high.starMassKg + high.planetMassKg)) ** (2 / 3);
  near(ratio, expected, 3e-15);
});

test('circle overlap handles containment, exact lens, symmetry, tangency, and tiny grazing overlap', () => {
  near(circleOverlapArea(1, 1, 1), 2 * Math.PI / 3 - Math.sqrt(3) / 2, 5e-16);
  near(circleOverlapArea(1, 0.2, 0), Math.PI * 0.2 ** 2, 1e-16);
  near(circleOverlapArea(1, 0.2, 0.8), Math.PI * 0.2 ** 2, 1e-16);
  assert.equal(circleOverlapArea(1, 0.2, 1.2), 0);
  assert.equal(circleOverlapArea(0, 1, 0), 0);
  near(circleOverlapArea(1, 1, 1e-20), Math.PI, 1e-15, 'nearly concentric equal disks');
  for (const separation of [0, 0.79, 0.80000001, 1, 1.19, 1.199999999, 1.2, 2]) {
    const area = circleOverlapArea(1, 0.2, separation);
    near(area, circleOverlapArea(0.2, 1, separation), 1e-15, 'circle symmetry');
    assert.ok(Number.isFinite(area) && area >= 0 && area <= Math.PI * 0.2 ** 2);
    near(circleOverlapArea(1e8, 2e7, separation * 1e8) / 1e16, area, 1e-14, 'length scaling');
  }
});

test('grazing transit is continuous, bounded, and mirrored before/after conjunction', () => {
  const system = createSystem();
  const radiusRatio = system.planetRadiusMeters / system.starRadiusMeters;
  const grazingInclination = Math.acos(system.starRadiusMeters / system.semiMajorAxisMeters) * 180 / Math.PI;
  const grazing = stateAt(system, 0, { inclinationDeg: grazingInclination });
  assert.ok(grazing.flux < 1 && grazing.flux > 1 - radiusRatio ** 2);
  for (let index = 0; index <= 100; index++) {
    const offset = index * system.periodDays / 10000;
    const before = stateAt(system, -offset, { inclinationDeg: grazingInclination });
    const after = stateAt(system, offset, { inclinationDeg: grazingInclination });
    assert.ok(Number.isFinite(before.flux) && before.flux >= 0 && before.flux <= 1);
    near(before.flux, after.flux, 2e-14);
  }
});

test('sampling and evaluation repeat after one orbit, including negative times', () => {
  const system = createSystem();
  const series = sampleOrbit(system, { samples: 101, startDays: -2 });
  assert.equal(series.length, 101);
  assert.equal(series[0].timeDays, -2);
  assert.equal(series.at(-1).timeDays, 2);
  for (const time of [-0.15, 0, 0.6, 3.9]) {
    const first = stateAt(system, time, { inclinationDeg: 88 });
    const next = stateAt(system, time + system.periodDays, { inclinationDeg: 88 });
    near(first.stellarRVMps, next.stellarRVMps, 2e-12);
    near(first.flux, next.flux, 1e-14);
    near(first.relative.worldMeters.x / system.semiMajorAxisMeters, next.relative.worldMeters.x / system.semiMajorAxisMeters, 2e-15);
  }
});

test('invalid quantities, intersecting orbits, and malformed sampling requests are rejected', () => {
  for (const values of [
    { starMassSolar: 0 }, { starRadiusSolar: -1 }, { planetMassJupiter: -1 },
    { planetRadiusJupiter: -1 }, { periodDays: 0 }, { periodDays: NaN },
    { starMassSolar: Infinity }, { periodDays: '4' }, { periodDays: 0.001 },
    { starMassSolar: Number.MAX_VALUE },
  ]) assert.throws(() => createSystem(values));
  const system = createSystem();
  assert.throws(() => stateAt({}, 0));
  assert.throws(() => stateAt(system, Infinity));
  assert.throws(() => stateAt(system, 0, { inclinationDeg: -1 }));
  assert.throws(() => stateAt(system, 0, { inclinationDeg: 181 }));
  assert.throws(() => sampleOrbit(system, { samples: 1 }));
  assert.throws(() => sampleOrbit(system, { samples: 2.5 }));
  assert.throws(() => sampleOrbit(system, { durationDays: 0 }));
  assert.throws(() => circleOverlapArea(-1, 1, 0));
  assert.throws(() => circleOverlapArea(1, 1, NaN));
});
