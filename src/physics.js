/**
 * Circular, Newtonian star–planet model with a uniform, spherical stellar disk.
 * No drawing scale, camera setting, or animation frame rate enters this module.
 * See docs/physics.md for conventions, assumptions, and the public API.
 */

const TAU = 2 * Math.PI;
const G = 6.67430e-11;
const SOLAR_GM = 1.3271244e20;
const JUPITER_GM = 1.2668653e17;

export const CONSTANTS = Object.freeze({
  G,
  SOLAR_GM_M3_S2: SOLAR_GM,
  JUPITER_GM_M3_S2: JUPITER_GM,
  SOLAR_MASS_KG: SOLAR_GM / G,
  JUPITER_MASS_KG: JUPITER_GM / G,
  SOLAR_RADIUS_METERS: 6.957e8,
  JUPITER_RADIUS_METERS: 7.1492e7,
  AU_METERS: 149597870700,
  DAY_SECONDS: 86400,
});

const SYSTEM = Symbol('circular-star-planet-system');

function numberInRange(value, name, minimum, maximum = Infinity, inclusive = true) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  if ((inclusive ? value < minimum : value <= minimum) || value > maximum) {
    const lower = inclusive ? 'at least' : 'greater than';
    throw new RangeError(`${name} must be ${lower} ${minimum}${Number.isFinite(maximum) ? ` and at most ${maximum}` : ''}.`);
  }
  return value;
}

/**
 * Construct an immutable system. Masses and radii are in solar/Jupiter units;
 * period is in days. The separation is derived, never an independent input.
 * Zero planet mass/radius are supported as explicit limiting cases.
 */
export function createSystem({
  starMassSolar = 1,
  starRadiusSolar = 1,
  planetMassJupiter = 1,
  planetRadiusJupiter = 1,
  periodDays = 4,
} = {}) {
  numberInRange(starMassSolar, 'starMassSolar', 0, Infinity, false);
  numberInRange(starRadiusSolar, 'starRadiusSolar', 0, Infinity, false);
  numberInRange(planetMassJupiter, 'planetMassJupiter', 0);
  numberInRange(planetRadiusJupiter, 'planetRadiusJupiter', 0);
  numberInRange(periodDays, 'periodDays', 0, Infinity, false);

  const starMassKg = starMassSolar * CONSTANTS.SOLAR_MASS_KG;
  const planetMassKg = planetMassJupiter * CONSTANTS.JUPITER_MASS_KG;
  const totalMassKg = starMassKg + planetMassKg;
  const starRadiusMeters = starRadiusSolar * CONSTANTS.SOLAR_RADIUS_METERS;
  const planetRadiusMeters = planetRadiusJupiter * CONSTANTS.JUPITER_RADIUS_METERS;
  const periodSeconds = periodDays * CONSTANTS.DAY_SECONDS;
  const gravitationalParameterM3S2 = starMassSolar * SOLAR_GM + planetMassJupiter * JUPITER_GM;
  const omega = TAU / periodSeconds;
  const semiMajorAxisMeters = Math.cbrt(gravitationalParameterM3S2 / omega ** 2);
  const planetMassFraction = planetMassKg / totalMassKg;
  const starOrbitRadiusMeters = semiMajorAxisMeters * planetMassFraction;
  const planetOrbitRadiusMeters = semiMajorAxisMeters * (1 - planetMassFraction);
  const relativeOrbitalSpeedMps = omega * semiMajorAxisMeters;

  const derived = {
    starMassKg, planetMassKg, totalMassKg, starRadiusMeters, planetRadiusMeters,
    periodSeconds, gravitationalParameterM3S2, omega, semiMajorAxisMeters,
    starOrbitRadiusMeters, planetOrbitRadiusMeters, relativeOrbitalSpeedMps,
  };
  if (Object.values(derived).some(value => !Number.isFinite(value)) || omega <= 0 || semiMajorAxisMeters <= 0 || starRadiusMeters <= 0) {
    throw new RangeError('These parameters exceed the numerical range of the model.');
  }
  if (semiMajorAxisMeters <= starRadiusMeters + planetRadiusMeters) {
    throw new RangeError('The orbit intersects the star: separation must exceed the sum of the physical radii.');
  }

  return Object.freeze({
    [SYSTEM]: true,
    starMassSolar, starRadiusSolar, planetMassJupiter, planetRadiusJupiter, periodDays,
    ...derived,
    semiMajorAxisAU: semiMajorAxisMeters / CONSTANTS.AU_METERS,
  });
}

function requireSystem(system) {
  if (!system || system[SYSTEM] !== true) {
    throw new TypeError('Use createSystem() to construct a physical system.');
  }
}

/** Exact planar overlap area of two circles; lengths must share one unit. */
export function circleOverlapArea(radius1, radius2, separation) {
  numberInRange(radius1, 'radius1', 0);
  numberInRange(radius2, 'radius2', 0);
  numberInRange(separation, 'separation', 0);
  if (radius1 === 0 || radius2 === 0 || separation >= radius1 + radius2) return 0;

  const smallerRadius = Math.min(radius1, radius2);
  const smallerArea = Math.PI * smallerRadius ** 2;
  if (!Number.isFinite(smallerArea)) {
    throw new RangeError('Circle area exceeds the numerical range.');
  }
  if (separation <= Math.abs(radius1 - radius2)) return smallerArea;

  // Normalize before squaring to avoid loss of range for astronomical lengths.
  const scale = Math.max(radius1, radius2);
  // Indistinguishable centers: the difference from containment is below roundoff.
  if (separation <= 4 * Number.EPSILON * scale) return smallerArea;
  // Canonical ordering also makes swapping the circle arguments bit-identical.
  const r = smallerRadius / scale;
  const R = 1;
  const d = separation / scale;
  const radicand = Math.max(0, (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
  const halfChord = Math.sqrt(radicand) / (2 * d);
  const chordOffset = (d * d + r * r - R * R) / (2 * d);
  const angle1 = Math.atan2(halfChord, chordOffset);
  const angle2 = Math.atan2(halfChord, d - chordOffset);
  function segmentFactor(angle) {
    // theta - sin(theta)cos(theta); series avoids cancellation near tangency.
    if (angle < 0.01) {
      const square = angle * angle;
      return angle * square * (2 / 3 + square * (-2 / 15 + square * (4 / 315 - square * 2 / 2835)));
    }
    return angle - Math.sin(angle) * Math.cos(angle);
  }
  const area = (r * r * segmentFactor(angle1) + R * R * segmentFactor(angle2)) * scale ** 2;
  return Math.max(0, Math.min(smallerArea, area));
}

/**
 * Evaluate one physical time. Inclination: 0° face-on, 90° edge-on.
 * t=0 is inferior conjunction (mid-transit when geometrically possible).
 * Sky positions are meters; positive line-of-sight distance points TO observer.
 * Stellar RV is m/s, positive AWAY from observer (the spectroscopic convention).
 */
export function stateAt(system, timeDays, { inclinationDeg = 90 } = {}) {
  requireSystem(system);
  numberInRange(timeDays, 'timeDays', -Infinity);
  numberInRange(inclinationDeg, 'inclinationDeg', 0, 180);
  const inclination = inclinationDeg * Math.PI / 180;
  // Reduce phase before trigonometric evaluation, including negative times.
  const fraction = ((timeDays % system.periodDays) / system.periodDays + 1) % 1;
  const phaseRad = fraction * TAU;
  const sinPhase = Math.sin(phaseRad);
  const cosPhase = Math.cos(phaseRad);
  const sinInclination = inclinationDeg === 0 || inclinationDeg === 180 ? 0 : Math.sin(inclination);
  const cosInclination = inclinationDeg === 90 ? 0 : Math.cos(inclination);

  function bodyAt(signedOrbitalRadius) {
    const x = signedOrbitalRadius * sinPhase;
    const y = signedOrbitalRadius * cosPhase;
    return {
      worldMeters: { x, y, z: 0 },
      skyMeters: { x, y: y * cosInclination },
      lineOfSightMeters: y * sinInclination,
      velocityWorldMps: {
        x: signedOrbitalRadius * system.omega * cosPhase,
        y: -signedOrbitalRadius * system.omega * sinPhase,
        z: 0,
      },
    };
  }

  const star = bodyAt(-system.starOrbitRadiusMeters);
  const planet = bodyAt(system.planetOrbitRadiusMeters);
  const relativeBody = bodyAt(system.semiMajorAxisMeters);
  const relative = {
    worldMeters: relativeBody.worldMeters,
    skyMeters: relativeBody.skyMeters,
    lineOfSightMeters: relativeBody.lineOfSightMeters,
  };
  const projectedSeparationMeters = Math.hypot(relative.skyMeters.x, relative.skyMeters.y);
  const planetInFront = relative.lineOfSightMeters > 0;
  // Calculate in stellar-radius units: normalized overlap / pi is blocked flux.
  const blockedFraction = planetInFront
    ? circleOverlapArea(1, system.planetRadiusMeters / system.starRadiusMeters, projectedSeparationMeters / system.starRadiusMeters) / Math.PI
    : 0;
  const flux = Math.max(0, Math.min(1, 1 - blockedFraction));
  const stellarRVMps = -star.velocityWorldMps.y * sinInclination;

  return {
    timeDays, phaseRad, inclinationDeg, star, planet, relative,
    projectedSeparationMeters, planetInFront, flux, stellarRVMps,
  };
}

/** Sample a time interval including both endpoints. Returns stateAt() objects. */
export function sampleOrbit(system, {
  inclinationDeg = 90,
  samples = 361,
  startDays = 0,
  durationDays = system?.periodDays,
} = {}) {
  requireSystem(system);
  numberInRange(inclinationDeg, 'inclinationDeg', 0, 180);
  numberInRange(samples, 'samples', 2, 100000);
  if (!Number.isInteger(samples)) throw new TypeError('samples must be an integer.');
  numberInRange(startDays, 'startDays', -Infinity);
  numberInRange(durationDays, 'durationDays', 0, Infinity, false);
  if (!Number.isFinite(startDays + durationDays)) throw new RangeError('Sample interval exceeds the numerical range.');
  return Array.from({ length: samples }, (_, index) =>
    stateAt(system, startDays + durationDays * (index / (samples - 1)), { inclinationDeg }));
}
