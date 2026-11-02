import { World } from '../src/sdk.js';

export default function build() {
  const world = new World({ title: 'Eccentricity: what stays fixed?' });
  const sun = world.star({ id: 'sun', name: 'Host star' });
  const reference = world.planet({ id: 'circle', name: 'Circular reference', radiusJupiter: 0.8, color: '#82ccb3' });
  reference.orbit(sun, { id: 'circle-orbit', semiMajorAxisAU: 0.04 });
  const constantA = world.planet({ id: 'same-a', name: 'Eccentric · same a', radiusJupiter: 0.65, color: '#a89df7' });
  constantA.orbit(sun, { id: 'same-a-orbit', semiMajorAxisAU: 0.04 }).eccentricity(0.6, { hold: 'semimajorAxis' });
  const constantQ = world.planet({ id: 'same-q', name: 'Eccentric · same periapsis', radiusJupiter: 1.05, color: '#efa375' });
  constantQ.orbit(sun, { id: 'same-q-orbit', semiMajorAxisAU: 0.04 }).eccentricity(0.6, { hold: 'periapsis' });
  const observer = world.observer({ id: 'observer', name: 'Distant observer' });
  world.transits(sun, observer, { id: 'combined', name: 'All three planets' });
  world.present({ startDays: -0.1, durationDays: 12, playbackSeconds: 80 });
  world.annotate({ id: 'same-a-note', timeDays: -0.1, title: 'Same semimajor axis → same period', text: 'The circular and lavender orbits both have a = 0.04 AU. Eccentricity changes their speed along the orbit and transit duration, while preserving period.', focusId: constantA });
  world.annotate({ id: 'same-q-note', timeDays: 3, title: 'Same periapsis → a longer orbit', text: 'The orange orbit holds q = 0.04 AU. With e = 0.6, a becomes 0.10 AU and the period grows by about 3.95×.', focusId: constantQ });
  return world;
}
