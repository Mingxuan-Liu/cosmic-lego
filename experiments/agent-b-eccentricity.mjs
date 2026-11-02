/**
 * Independent SDK author challenge B.
 * A teaching construction, not a dynamically stable planetary-system claim.
 * Public API only: World, handles, semantic edits, world.at(), world.build().
 */
import assert from 'node:assert/strict';
import { World } from '../src/sdk.js';

const world = new World({
  title: 'Changing an ellipse: which distance did you hold fixed?',
});
const star = world.star({
  id: 'host', name: 'The shared host', massSolar: 1, radiusSolar: 1,
  color: '#f2c063',
});
const earthward = world.observer({
  id: 'earthward', name: 'Near the common transit direction', direction: [0, 0, 1],
});
// Connect the measurement before its planets exist. It follows the relationship.
world.transits(star, earthward, {
  id: 'all-planets', name: 'All planets · common sightline', occulters: 'orbiting',
});

const designs = [
  { id: 'axis-held', name: 'Hold the semimajor axis', color: '#91c9c0', massJupiter: .3, radiusJupiter: .8,
    orbit: { semiMajorAxisAU: .08, eccentricity: .1, inclinationDeg: 90,
      longitudeAscendingNodeDeg: 0, argumentPeriapsisDeg: 90, meanAnomalyDegAtEpoch: 0 } },
  { id: 'periapsis-held', name: 'Hold the nearest approach', color: '#e6a088', massJupiter: .4, radiusJupiter: 1.1,
    orbit: { semiMajorAxisAU: .08, eccentricity: .1, inclinationDeg: 89.5,
      longitudeAscendingNodeDeg: 40, argumentPeriapsisDeg: 90, meanAnomalyDegAtEpoch: 0 } },
  { id: 'reference-clock', name: 'Unchanged reference clock', color: '#b79de3', massJupiter: .05, radiusJupiter: .55,
    orbit: { semiMajorAxisAU: .08, eccentricity: .10, inclinationDeg: 76,
      longitudeAscendingNodeDeg: 15, argumentPeriapsisDeg: 110, meanAnomalyDegAtEpoch: 58 } },
  { id: 'outer-tilted', name: 'Outer tilted clock', color: '#8cafe1', massJupiter: .2, radiusJupiter: .75,
    orbit: { semiMajorAxisAU: .20, eccentricity: .30, inclinationDeg: 48,
      longitudeAscendingNodeDeg: 75, argumentPeriapsisDeg: 40, meanAnomalyDegAtEpoch: 175 } },
];
for (const { orbit, ...properties } of designs) {
  world.planet(properties).orbit(star, { id: `${properties.id}-orbit`, ...orbit });
}
const periodOf = (id) => world.at(0).planets.find((planet) => planet.id === id).periodDays;
const orbitOf = (id) => world.build().orbits.find((orbit) => orbit.bodyId === id);
const before = {
  axisPeriodDays: periodOf('axis-held'),
  periapsisPeriodDays: periodOf('periapsis-held'),
  periapsisAU: orbitOf('periapsis-held').semiMajorAxisAU * (1 - orbitOf('periapsis-held').eccentricity),
};

// These are construction edits to two configurations, not impulses during playback.
world.get('axis-held-orbit').eccentricity(.60, { hold: 'semimajorAxis' });
world.get('periapsis-held-orbit').eccentricity(.55, { hold: 'periapsis' });
world.get('outer-tilted').set({ name: 'Outer clock · 48° orbital plane' });

// Exercise structural replacement and automatic membership in the photometer.
const probe = world.planet({
  id: 'temporary-probe', name: 'Construction probe', massJupiter: 0, radiusJupiter: 0,
});
probe.orbit(star, { id: 'probe-orbit', semiMajorAxisAU: .12, inclinationDeg: 25 });
const dynamicCountWithProbe = world.at(0).measurements.find((m) => m.id === 'all-planets').planets.length;
world.get('temporary-probe').remove({ cascade: true });

const scout = world.observer({ id: 'scout', name: 'Initial scouting direction', direction: [1, 0, 0] });
world.transits(star, scout, { id: 'focused-pair', name: 'Pair measurement before rewiring' });
const oblique = world.observer({
  id: 'oblique', name: 'Observer displaced from transit direction', direction: [.07, .12, 1],
});
world.get('focused-pair').set({
  observerId: 'oblique', name: 'Only the two edited ellipses · displaced observer',
  occulters: ['axis-held', 'periapsis-held'],
});
// The old observer has no dependents after rewiring; cascade is unnecessary.
world.get('scout').remove();
world.transits(star, oblique, { id: 'oblique-all', name: 'All planets · displaced observer' });

world.present({
  startDays: -.2, durationDays: 26, playbackSeconds: 95, bodyScale: 10,
  camera: { azimuthDeg: -28, elevationDeg: 28, zoom: 1.04 },
});
world.annotate({
  id: 'held-axis-cue', timeDays: -.2, title: 'An ellipse is not a period.',
  text: 'The green orbit changed from e = 0.10 to 0.60 at fixed semimajor axis. It still has the same period as the purple reference orbit.',
  focusId: world.get('axis-held'),
});
world.annotate({
  id: 'held-periapsis-cue', timeDays: 5, title: 'Preserve a different distance; get a different clock.',
  text: 'The coral orbit kept its 0.072 AU nearest approach. Raising eccentricity to 0.55 doubled its semimajor axis and multiplied the period by 2√2.',
  focusId: world.get('periapsis-held'),
});
world.annotate({
  id: 'observer-cue', timeDays: 14, title: 'The observer changes the signal, not the orbit.',
  text: 'Switch observer feeds to compare this same world from two directions, or isolate the two edited ellipses.',
  focusId: null,
});

const finalScene = world.build();
const finalState = world.at(0);
const axisFinal = orbitOf('axis-held');
const periapsisFinal = orbitOf('periapsis-held');
const axisPeriod = periodOf('axis-held');
const periapsisPeriod = periodOf('periapsis-held');
const relativeError = (actual, expected) => Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
assert.equal(axisFinal.semiMajorAxisAU, .08);
assert.equal(axisPeriod, before.axisPeriodDays);
assert.equal(axisPeriod, periodOf('reference-clock'));
assert.ok(relativeError(periapsisFinal.semiMajorAxisAU, .16) < 1e-14);
assert.ok(relativeError(periapsisFinal.semiMajorAxisAU * (1-periapsisFinal.eccentricity), before.periapsisAU) < 1e-14);
assert.ok(relativeError(periapsisPeriod / before.periapsisPeriodDays, 2*Math.sqrt(2)) < 1e-13);
assert.equal(dynamicCountWithProbe, 5);
assert.equal(finalState.measurements.find((m) => m.id === 'all-planets').planets.length, 4);
assert.equal(finalState.measurements.find((m) => m.id === 'focused-pair').planets.length, 2);
assert.ok(!finalScene.bodies.some((body) => body.id === 'temporary-probe'));
assert.ok(!finalScene.orbits.some((orbit) => orbit.id === 'probe-orbit'));
assert.ok(!finalScene.observers.some((observer) => observer.id === 'scout'));
assert.equal(finalScene.measurements.find((m) => m.id === 'focused-pair').observerId, 'oblique');
for (const measurement of finalState.measurements) assert.ok(measurement.flux >= 0 && measurement.flux <= 1);

export const audit = {
  before,
  after: {
    axis: { semimajorAxisAU: axisFinal.semiMajorAxisAU, eccentricity: axisFinal.eccentricity,
      periodDays: axisPeriod, periodRatio: axisPeriod / before.axisPeriodDays },
    periapsis: { semimajorAxisAU: periapsisFinal.semiMajorAxisAU, eccentricity: periapsisFinal.eccentricity,
      periapsisAU: periapsisFinal.semiMajorAxisAU * (1-periapsisFinal.eccentricity),
      periodDays: periapsisPeriod, periodRatio: periapsisPeriod / before.periapsisPeriodDays },
  },
  structural: { planets: finalState.planets.length, dynamicCountWithProbe,
    dynamicCountAfterRemoval: finalState.measurements.find((m) => m.id === 'all-planets').planets.length,
    focusedMeasurementPlanetIds: finalState.measurements.find((m) => m.id === 'focused-pair').planets.map((p) => p.id),
    observerIds: finalScene.observers.map((observer) => observer.id) },
  atZero: finalState.measurements.map((measurement) => ({ id: measurement.id, flux: measurement.flux,
    occultingPlanetIds: measurement.occultingPlanetIds })),
  planetPeriods: finalState.planets.map((planet) => ({id:planet.id,periodDays:planet.periodDays})),
};
export default world;
