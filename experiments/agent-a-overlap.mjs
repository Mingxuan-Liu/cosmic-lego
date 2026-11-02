import { World } from '../src/sdk.js';

// Authored only from the public SDK documentation and discovered tool catalog.
// Three independent Kepler orbits produce one observer's combined transit.
export default function buildOverlapLesson() {
  const world = new World({ title: 'Three planets, one shared shadow' });
  const star = world.star({ id: 'host', name: 'Uniform solar-size host', massSolar: 1, radiusSolar: 1 });
  const aligned = world.observer({ id: 'aligned', name: 'Near the orbital planes', direction: [0, 0, 1] });
  const tilted = world.observer({ id: 'tilted', name: 'Tilted away from the transits', direction: [0, 0.6, 0.8] });

  // Create this relationship before adding its occultors: later bodies belong
  // to this measurement automatically through their connection to the host.
  world.transits(star, aligned, { id: 'combined', name: 'All three: union of shadows' });

  const definitions = [
    { id: 'amber', name: 'Amber: central circular transit', color: '#F2C063', radiusJupiter: 1.2,
      massJupiter: 0.3, semiMajorAxisAU: 0.045, eccentricity: 0, inclinationDeg: 90 },
    { id: 'cyan', name: 'Cyan: partially overlapping transit', color: '#66D9EF', radiusJupiter: 0.75,
      massJupiter: 0.1, semiMajorAxisAU: 0.08, eccentricity: 0.35, inclinationDeg: 89.4 },
    { id: 'violet', name: 'Violet: separate transit chord', color: '#B59CFF', radiusJupiter: 0.55,
      massJupiter: 0.05, semiMajorAxisAU: 0.13, eccentricity: 0.2, inclinationDeg: 88.5 },
  ];

  const planets = definitions.map(({ id, name, color, radiusJupiter, massJupiter, ...elements }) => {
    const planet = world.planet({ id, name, color, radiusJupiter, massJupiter });
    planet.orbit(star, {
      id: `${id}-orbit`, ...elements,
      longitudeAscendingNodeDeg: 0, argumentPeriapsisDeg: 90,
      meanAnomalyDegAtEpoch: 0, epochDays: 0,
    });
    world.transits(star, aligned, { id: `only-${id}`, name: `${id}: if it were alone`, occulters: [planet] });
    return planet;
  });

  world.transits(star, aligned, {
    id: 'overlap-pair', name: 'Amber + cyan: overlap counted once', occulters: planets.slice(0, 2),
  });
  world.transits(star, tilted, { id: 'tilted-combined', name: 'Same system, tilted observer' });

  world.present({
    startDays: -0.18, durationDays: 0.36, playbackSeconds: 65, bodyScale: 5,
    camera: { azimuthDeg: 35, elevationDeg: 24, zoom: 1 },
  });
  world.annotate({
    id: 'setup', timeDays: -0.17, title: 'Three orbits, one beam of starlight',
    text: 'The planets have different periods, eccentricities and inclinations. Each moves independently in the fixed-star approximation.',
  });
  world.annotate({
    id: 'compare', timeDays: -0.04, title: 'An individual curve is a counterfactual',
    text: 'Each single-planet photometer shows the starlight remaining if only that planet blocked it. Their deficits cannot always be added.',
    focusId: planets[1],
  });
  world.annotate({
    id: 'overlap', timeDays: 0, title: 'The shared patch is blocked only once',
    text: 'Amber and cyan partially overlap in the observer’s sky. Adding their separate deficits counts the shared patch twice; violet blocks a separate patch.',
    focusId: planets[1],
  });
  world.annotate({
    id: 'perspective', timeDays: 0.1, title: 'The observer changes the evidence',
    text: 'The tilted observer sees no transit in this time window. The physical planets have not changed; only the viewing direction has.',
  });
  return world;
}

// Reproducible author-side inspection. This uses public results and ordinary
// arithmetic; it neither reads engine internals nor publishes to the local app.
export function auditOverlapLesson() {
  const world = buildOverlapLesson();
  const atZero = world.at(0);
  const flux = Object.fromEntries(atZero.measurements.map(m => [m.id, m.flux]));
  const naiveDeficit = ['only-amber', 'only-cyan', 'only-violet']
    .reduce((sum, id) => sum + 1 - flux[id], 0);
  const combinedDeficit = 1 - flux.combined;

  const tiltedFlux = Array.from({ length: 721 }, (_, index) =>
    world.at(-0.18 + 0.36 * index / 720).measurements
      .find(m => m.id === 'tilted-combined').flux);

  // A structural edit in an independent copy. The original recipe is unchanged.
  const edited = World.from(world.build());
  edited.get('cyan').remove({ cascade: true });
  const afterRemoval = edited.at(0);
  return {
    timeDays: 0,
    periodsDays: Object.fromEntries(atZero.planets.map(p => [p.id, p.periodDays])),
    fluxes: flux,
    naiveDeficit,
    combinedDeficit,
    naiveFlux: 1 - naiveDeficit,
    overcountPpm: 1e6 * (naiveDeficit - combinedDeficit),
    relativeOverestimatePercent: 100 * (naiveDeficit / combinedDeficit - 1),
    sampledTiltedFluxRange: [Math.min(...tiltedFlux), Math.max(...tiltedFlux)],
    afterRemoval: {
      planets: afterRemoval.planets.map(p => p.id),
      measurements: afterRemoval.measurements.map(m => m.id),
      combinedFlux: afterRemoval.measurements.find(m => m.id === 'combined').flux,
      amberPositionUnchanged: JSON.stringify(afterRemoval.planets.find(p => p.id === 'amber').worldMeters)
        === JSON.stringify(atZero.planets.find(p => p.id === 'amber').worldMeters),
    },
  };
}
