import { World } from '../src/sdk.js';

export default function build() {
  const world = new World({ title: 'Three planets. One shared shadow.' });
  const sun = world.star({ id: 'sun', name: 'Host star', massSolar: 1, radiusSolar: 1 });
  const inner = world.planet({ id: 'ember', name: 'Ember', massJupiter: 0.4, radiusJupiter: 0.8, color: '#efa375' });
  inner.orbit(sun, { id: 'ember-orbit', semiMajorAxisAU: 0.04 });
  const outer = world.planet({ id: 'iris', name: 'Iris', massJupiter: 1, radiusJupiter: 1.25, color: '#a89df7' });
  outer.orbit(sun, { id: 'iris-orbit', semiMajorAxisAU: 0.067, eccentricity: 0.15, inclinationDeg: 89.5, longitudeAscendingNodeDeg: 20 });
  const tilted = world.planet({ id: 'moss', name: 'Moss', massJupiter: 0.2, radiusJupiter: 0.65, color: '#82ccb3' });
  tilted.orbit(sun, { id: 'moss-orbit', semiMajorAxisAU: 0.095, eccentricity: 0.3, inclinationDeg: 78, longitudeAscendingNodeDeg: -24, meanAnomalyDegAtEpoch: 120 });
  const observer = world.observer({ id: 'earthward', name: 'Distant observer', direction: [0, 0, 1] });
  world.transits(sun, observer, { id: 'combined', name: 'Combined starlight', occulters: 'orbiting' });
  world.present({ startDays: -0.2, durationDays: 12, playbackSeconds: 70, camera: { azimuthDeg: -28, elevationDeg: 24, zoom: 1 } });
  world.annotate({ id: 'overlap', timeDays: -0.2, title: 'A system assembled from handles', text: 'Ember and Iris cross the same stellar disk. Their shared shadow is counted once. Moss follows its own tilted, eccentric orbit.', focusId: sun });
  world.annotate({ id: 'repetition', timeDays: 2, title: 'Independent orbits, one measurement', text: 'Each planet returns on its own clock. The photometer observes their combined projected silhouettes.' });
  return world;
}
