import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSTANTS, createKeplerSystem, keplerStateAt, observeSystem, sampleOrbitPath, solveEccentricAnomaly, circleOverlapArea, occultedArea } from '../src/physics.js';

const TAU = 2 * Math.PI;
function near(actual, expected, tolerance, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}, tolerance ${tolerance}`);
}
function makePlanet(id = 'p1', orbit = {}, properties = {}) {
  return { id, massJupiter: 1, radiusJupiter: 1, ...properties, orbit: { semiMajorAxisAU: 0.08, eccentricity: 0, inclinationDeg: 90, longitudeAscendingNodeDeg: 0, argumentPeriapsisDeg: 90, meanAnomalyDegAtEpoch: 0, epochDays: 0, ...orbit } };
}
function system(planets = [makePlanet()], star = {}) {
  return createKeplerSystem({ star: { id: 's', massSolar: 1, radiusSolar: 1, ...star }, planets });
}
function norm(vector) { return Math.hypot(vector.x, vector.y, vector.z); }
function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }

test('Kepler solver matches independently specified roots, including high eccentricity', () => {
  for (const e of [0, 0.2, 0.8, 0.99, 0.999999]) {
    for (const expectedE of [-Math.PI, -2.7, -0.01, -1e-5, 0, 1e-5, 0.01, 1.7, Math.PI]) {
      const mean = expectedE - e * Math.sin(expectedE);
      const solved = solveEccentricAnomaly(mean, e);
      near(Math.sin(solved), Math.sin(expectedE), e > 0.999 ? 2e-9 : 2e-12, `root e=${e}, E=${expectedE}`);
      near(Math.cos(solved), Math.cos(expectedE), 3e-12);
      near(solved - e * Math.sin(solved), mean, 4e-15, 'equation residual');
    }
  }
  near(solveEccentricAnomaly(1 + 12 * TAU, 0.7), solveEccentricAnomaly(1, 0.7), 2e-14);
  near(solveEccentricAnomaly(-1e-14, 0.999999), -solveEccentricAnomaly(1e-14, 0.999999), 1e-17, 'tiny negative anomaly symmetry');
});

test('one AU orbit has Earth-like period and eccentricity does not change period at fixed a', () => {
  const model = system([makePlanet('c', { semiMajorAxisAU: 1, eccentricity: 0 }), makePlanet('e', { semiMajorAxisAU: 1, eccentricity: 0.8 })]);
  near(model.planets[0].periodDays, 365.2569, 0.001);
  assert.equal(model.planets[0].periodDays, model.planets[1].periodDays);
  const fixedPeriapsis = system([makePlanet('q', { semiMajorAxisAU: 1 / (1 - 0.8), eccentricity: 0.8 })]);
  near(fixedPeriapsis.planets[0].periodDays / model.planets[0].periodDays, 5 ** 1.5, 1e-13);
});

test('each differently oriented ellipse conserves specific energy and angular momentum', () => {
  const model = system([
    makePlanet('one', { eccentricity: 0.6, inclinationDeg: 27, longitudeAscendingNodeDeg: 31, argumentPeriapsisDeg: 74 }),
    makePlanet('two', { eccentricity: 0.9, inclinationDeg: 140, longitudeAscendingNodeDeg: 192, argumentPeriapsisDeg: 13, semiMajorAxisAU: 0.2 }),
  ]);
  const mu = model.star.gravitationalParameterM3S2;
  for (let index = 0; index < 61; index++) {
    const state = keplerStateAt(model, index * 0.43 - 5);
    assert.deepEqual(state.star.worldMeters, { x: 0, y: 0, z: 0 });
    for (let p = 0; p < state.planets.length; p++) {
      const current = state.planets[p], spec = model.planets[p];
      const energy = norm(current.velocityWorldMps) ** 2 / 2 - mu / norm(current.worldMeters);
      const expectedEnergy = -mu / (2 * spec.semiMajorAxisMeters);
      near(energy / expectedEnergy, 1, 2e-13, 'specific energy');
      const angularMomentum = norm(cross(current.worldMeters, current.velocityWorldMps));
      near(angularMomentum / Math.sqrt(mu * spec.semiMajorAxisMeters * (1 - spec.orbit.eccentricity ** 2)), 1, 5e-14, 'specific angular momentum');
    }
  }
});

test('periapsis/apoapsis distances and speeds obey independent vis-viva values', () => {
  const model = system([makePlanet('p', { eccentricity: 0.65 })]);
  const spec = model.planets[0];
  const peri = keplerStateAt(model, 0).planets[0];
  const apo = keplerStateAt(model, spec.periodDays / 2).planets[0];
  near(norm(peri.worldMeters) / spec.semiMajorAxisMeters, 0.35, 1e-15);
  near(norm(apo.worldMeters) / spec.semiMajorAxisMeters, 1.65, 1e-15);
  near(norm(peri.velocityWorldMps) / norm(apo.velocityWorldMps), 1.65 / 0.35, 1e-13);
  for (const point of [peri, apo]) near(norm(point.velocityWorldMps) ** 2 / (model.star.gravitationalParameterM3S2 * (2 / norm(point.worldMeters) - 1 / spec.semiMajorAxisMeters)), 1, 2e-15);
});

test('orbital orientation and epoch belong to each planet independently', () => {
  const model = system([
    makePlanet('xy', { inclinationDeg: 0, argumentPeriapsisDeg: 0 }),
    makePlanet('z', { inclinationDeg: 90, argumentPeriapsisDeg: 90 }),
    makePlanet('y', { inclinationDeg: 0, argumentPeriapsisDeg: 0, longitudeAscendingNodeDeg: 90 }),
    makePlanet('epoch', { inclinationDeg: 0, argumentPeriapsisDeg: 0, meanAnomalyDegAtEpoch: 90, epochDays: 7 }),
  ]);
  const atZero = keplerStateAt(model, 0);
  const a = model.planets[0].semiMajorAxisMeters;
  near(atZero.planets[0].worldMeters.x / a, 1, 0);
  near(atZero.planets[1].worldMeters.z / a, 1, 0);
  near(atZero.planets[2].worldMeters.y / a, 1, 0);
  const atEpoch = keplerStateAt(model, 7).planets[3];
  near(atEpoch.worldMeters.y / a, 1, 0);
  near(atEpoch.worldMeters.x / a, 0, 1e-15);
});

test('analytic positions and velocities agree by finite differencing physical time', () => {
  const model = system([makePlanet('p', { eccentricity: 0.7, longitudeAscendingNodeDeg: 53, inclinationDeg: 47, argumentPeriapsisDeg: 21 })]);
  const time = model.planets[0].periodDays * 0.37;
  const deltaDays = 0.01 / CONSTANTS.DAY_SECONDS;
  const before = keplerStateAt(model, time - deltaDays).planets[0];
  const after = keplerStateAt(model, time + deltaDays).planets[0];
  const exact = keplerStateAt(model, time).planets[0];
  for (const axis of ['x', 'y', 'z']) near((after.worldMeters[axis] - before.worldMeters[axis]) / 0.02, exact.velocityWorldMps[axis], 0.002, `velocity ${axis}`);
});

test('observer convention gives a front transit, backside unity, and no face-on transit', () => {
  const model = system();
  const observed = observeSystem(model, 0);
  assert.deepEqual(observed.observer.direction, [0, 0, 1]);
  assert.deepEqual(observed.observer.skyX, [1, 0, 0]);
  assert.deepEqual(observed.observer.skyY, [0, 1, 0]);
  assert.equal(observed.planets[0].foreground, true);
  const depth = (model.planets[0].radiusMeters / model.star.radiusMeters) ** 2;
  near(observed.flux, 1 - depth, 2e-16);
  assert.equal(observeSystem(model, model.planets[0].periodDays / 2).flux, 1);
  assert.equal(observeSystem(model, 0, { direction: [0, 0, -1] }).flux, 1);
  assert.equal(observeSystem(system([makePlanet('p', { inclinationDeg: 0 })]), 0).flux, 1);
  near(observeSystem(model, 0, { direction: [0, 0, 100] }).flux, observed.flux, 0);
});

test('coincident foreground planets count once; the chosen observer changes visibility', () => {
  const model = system([makePlanet('inner'), makePlanet('outer', { semiMajorAxisAU: 0.13 })]);
  const observed = observeSystem(model, 0);
  const expectedDepth = (model.planets[0].radiusMeters / model.star.radiusMeters) ** 2;
  near(1 - observed.flux, expectedDepth, 1e-15);
  assert.deepEqual(observed.occultingPlanetIds, ['inner', 'outer']);
  const other = observeSystem(model, 0, { direction: [1, 0, 0] });
  assert.equal(other.flux, 1);
  assert.deepEqual(other.planets.map(p => p.worldMeters), observed.planets.map(p => p.worldMeters));
});

test('planet masses guard the approximation but do not change trajectory or flux', () => {
  const light = system([makePlanet('p', {}, { massJupiter: 0 })]);
  const heavy = system([makePlanet('p', {}, { massJupiter: 8 })]);
  assert.deepEqual(keplerStateAt(light, 2), keplerStateAt(heavy, 2));
  assert.equal(observeSystem(light, 0).flux, observeSystem(heavy, 0).flux);
  assert.throws(() => system([makePlanet('p', {}, { massJupiter: 11 })]), /1%/);
  assert.throws(() => system([makePlanet('a', {}, { massJupiter: 6 }), makePlanet('b', {}, { massJupiter: 6 })]), /1%/);
});

test('single-disk overlap agrees with known circle lens, contact, and contained limits', () => {
  near(circleOverlapArea(1, 1, 1), 2 * Math.PI / 3 - Math.sqrt(3) / 2, 6e-16);
  near(occultedArea(1, [{ x: 0, y: 0, radius: 0.2 }]), Math.PI * 0.04, 1e-16);
  assert.equal(occultedArea(1, []), 0);
  assert.equal(occultedArea(1, [{ x: 1.2, y: 0, radius: 0.2 }]), 0);
  assert.equal(occultedArea(1, [{ x: 0, y: 0, radius: 2 }]), Math.PI);
  for (const separation of [0, 0.8, 0.800001, 1, 1.199999, 1.2]) near(occultedArea(1, [{ x: separation, y: 0, radius: 0.2 }]), circleOverlapArea(1, 0.2, separation), 1e-15);
});

test('multi-disk union handles disjoint, duplicate, contained, and overlapping planets', () => {
  const one = { x: -0.4, y: 0, radius: 0.2 }, two = { x: 0.4, y: 0, radius: 0.2 };
  near(occultedArea(1, [one, two]), Math.PI * 0.08, 2e-16);
  near(occultedArea(1, [one, { ...one }, { x: -0.4, y: 0, radius: 0.1 }]), Math.PI * 0.04, 1e-16);
  const overlapping = [{ x: -0.1, y: 0, radius: 0.3 }, { x: 0.1, y: 0, radius: 0.3 }];
  const expected = 2 * Math.PI * 0.3 ** 2 - circleOverlapArea(0.3, 0.3, 0.2);
  near(occultedArea(1, overlapping), expected, 3e-16, 'inclusion-exclusion');
  near(occultedArea(1, [{ x: -0.2, y: 0, radius: 0.2 }, { x: 0.2, y: 0, radius: 0.2 }]), Math.PI * 0.08, 2e-16, 'external tangency');
});

// Independent reference: clipped vertical interval unions integrated by trapezoids.
// It shares no arc splitting or Green's-theorem integration with the implementation.
function numericUnionArea(disks, slices = 30000) {
  let sum = 0;
  for (let index = 0; index <= slices; index++) {
    const x = -1 + 2 * index / slices;
    const starHalf = Math.sqrt(Math.max(0, 1 - x * x));
    const intervals = disks.flatMap(disk => {
      const remaining = disk.radius ** 2 - (x - disk.x) ** 2;
      if (remaining <= 0) return [];
      const half = Math.sqrt(remaining);
      const low = Math.max(-starHalf, disk.y - half), high = Math.min(starHalf, disk.y + half);
      return high > low ? [[low, high]] : [];
    }).sort((a, b) => a[0] - b[0]);
    let length = 0, low = 0, high = -Infinity;
    for (const interval of intervals) {
      if (interval[0] > high) {
        if (high > low) length += high - low;
        [low, high] = interval;
      } else high = Math.max(high, interval[1]);
    }
    if (high > low) length += high - low;
    sum += length * (index === 0 || index === slices ? 0.5 : 1);
  }
  return sum * 2 / slices;
}

test('clipped multi-occultor arc integral agrees with independent numerical integration', () => {
  const cases = [
    [{ x: 0.8, y: 0.3, radius: 0.5 }, { x: 0.5, y: 0.5, radius: 0.35 }],
    [{ x: -0.65, y: 0, radius: 0.8 }, { x: 0.65, y: 0, radius: 0.8 }, { x: 0, y: 0.5, radius: 0.3 }],
    [{ x: -0.3, y: 0, radius: 0.4 }, { x: 0.3, y: 0, radius: 0.4 }, { x: 0, y: 0.52, radius: 0.4 }],
    [{ x: 0.98, y: 0.02, radius: 0.08 }, { x: 0.95, y: -0.04, radius: 0.07 }],
    [{ x: -0.7, y: 0, radius: 1.3 }, { x: 0.7, y: 0, radius: 1.3 }],
  ];
  for (const disks of cases) near(occultedArea(1, disks), numericUnionArea(disks), 3e-6, 'independent quadrature');
});

test('union is invariant under planet ordering, sky rotation, and consistent scale', () => {
  const disks = [{ x: 0.8, y: 0.3, radius: 0.5 }, { x: 0.5, y: 0.5, radius: 0.35 }, { x: -0.4, y: 0.2, radius: 0.3 }];
  const area = occultedArea(1, disks);
  near(occultedArea(1, disks.toReversed()), area, 5e-15);
  const angle = 1.234;
  const rotated = disks.map(d => ({ x: d.x * Math.cos(angle) - d.y * Math.sin(angle), y: d.x * Math.sin(angle) + d.y * Math.cos(angle), radius: d.radius }));
  near(occultedArea(1, rotated), area, 5e-15);
  near(occultedArea(1e9, disks.map(d => ({ x: d.x * 1e9, y: d.y * 1e9, radius: d.radius * 1e9 }))) / 1e18, area, 5e-15);
});

test('grazing/contact geometry remains bounded and continuous', () => {
  let previous = 0;
  for (let index = 0; index <= 300; index++) {
    const x = 1.21 - index * 0.0001;
    const area = occultedArea(1, [{ x, y: 0, radius: 0.2 }, { x: x - 0.01, y: 0.015, radius: 0.19 }]);
    assert.ok(Number.isFinite(area) && area >= 0 && area <= Math.PI);
    assert.ok(area >= previous - 1e-13, 'moving disks inward cannot reduce this overlap');
    assert.ok(Math.abs(area - previous) < 1e-4, 'no boundary topology jump');
    previous = area;
  }
});

test('path closes exactly, traces rotated ellipse, and shared time repeats per planet', () => {
  const model = system([makePlanet('p', { eccentricity: 0.4, inclinationDeg: 38, longitudeAscendingNodeDeg: 61 })]);
  const path = sampleOrbitPath(model, 'p', 161);
  assert.equal(path.length, 161);
  assert.deepEqual(path[0], path.at(-1));
  near(norm(path[0]), model.planets[0].periapsisMeters, 3e-6);
  near(norm(path[80]), model.planets[0].apoapsisMeters, 3e-6);
  const period = model.planets[0].periodDays;
  for (const time of [-1.4, 0, 0.3, 4.5]) {
    const one = keplerStateAt(model, time).planets[0], again = keplerStateAt(model, time + period).planets[0];
    for (const axis of ['x', 'y', 'z']) near(one.worldMeters[axis] / model.planets[0].semiMajorAxisMeters, again.worldMeters[axis] / model.planets[0].semiMajorAxisMeters, 5e-15);
  }
});

test('empty systems are visible stars, and unsupported/invalid quantities fail clearly', () => {
  const empty = system([]);
  assert.equal(observeSystem(empty, 0).flux, 1);
  assert.deepEqual(keplerStateAt(empty, 0).planets, []);
  for (const orbit of [{ eccentricity: 1 }, { eccentricity: -0.1 }, { semiMajorAxisAU: 0 }, { eccentricity: 0.99 }, { inclinationDeg: 181 }, { semiMajorAxisAU: '0.1' }]) assert.throws(() => system([makePlanet('p', orbit)]));
  assert.throws(() => system([makePlanet('p'), makePlanet('p')]));
  assert.throws(() => system([makePlanet('s')]));
  assert.throws(() => system([makePlanet('p', {}, { radiusJupiter: -1 })]));
  assert.throws(() => system([], { radiusSolar: 1e-200 }), /numerical range/);
  assert.throws(() => observeSystem(empty, 0, { direction: [0, 0, 0] }));
  assert.throws(() => observeSystem(empty, 0, { direction: [0, NaN, 1] }));
  assert.throws(() => keplerStateAt(empty, Infinity));
  assert.throws(() => sampleOrbitPath(empty, 'unknown'));
  assert.throws(() => sampleOrbitPath(system(), 'p1', 3));
  assert.throws(() => occultedArea(1, [{ x: 0, y: 0, radius: -1 }]));
});
