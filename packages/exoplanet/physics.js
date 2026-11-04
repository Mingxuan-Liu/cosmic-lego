/** Independent star-dominated Kepler orbits and uniform-disk photometry.
 * The fixed star supplies GM; planets do not perturb it or each other.
 * No rendering or display-scale values enter this module.
 */
const TAU = 2 * Math.PI;
const G = 6.67430e-11;
const SOLAR_GM = 1.3271244e20;
const JUPITER_GM = 1.2668653e17;
const SYSTEM = Symbol('independent-kepler-system');

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
  MAX_PLANET_STAR_MASS_RATIO: 0.01,
});

function finite(value, name, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  if (value < min || value > max) throw new RangeError(`${name} must be between ${min} and ${max}.`);
  return value;
}
function positive(value, name) {
  finite(value, name, 0);
  if (value === 0) throw new RangeError(`${name} must be greater than zero.`);
  return value;
}
function identifier(value, name) {
  if (typeof value !== 'string' || !value.length) throw new TypeError(`${name} must be a nonempty string.`);
  return value;
}
function wrapRadians(angle) {
  const remainder = angle % TAU;
  return remainder < 0 ? remainder + TAU : remainder;
}
function radians(degrees) { return (degrees % 360) * Math.PI / 180; }
function vec(x, y, z) { return { x, y, z }; }
function dot(a, b) { return a[0] * b.x + a[1] * b.y + a[2] * b.z; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalized(v) {
  const length = Math.hypot(...v);
  if (!Number.isFinite(length) || length === 0) throw new RangeError('Observer direction must have a finite, nonzero length.');
  return v.map(component => component / length);
}
function requireSystem(system) {
  if (!system || system[SYSTEM] !== true) throw new TypeError('Use createKeplerSystem() to construct a physical system.');
}

/** Safeguarded Newton/bisection solution of E - e sin(E) = M for 0 <= e < 1.
 * Returns E on [-pi, pi]. The mean anomaly may be any finite angle in radians.
 */
export function solveEccentricAnomaly(meanAnomalyRad, eccentricity) {
  finite(meanAnomalyRad, 'meanAnomalyRad');
  finite(eccentricity, 'eccentricity', 0, 1);
  if (eccentricity === 1) throw new RangeError('Only bound elliptical orbits with eccentricity < 1 are supported.');
  // Preserve the sign of a tiny negative anomaly instead of adding/subtracting 2pi.
  let mean = meanAnomalyRad % TAU;
  if (mean > Math.PI) mean -= TAU;
  if (mean < -Math.PI) mean += TAU;
  if (eccentricity === 0 || mean === 0 || Math.abs(mean) === Math.PI) return mean;
  let low = -Math.PI;
  let high = Math.PI;
  let anomaly = eccentricity < 0.8 ? mean : (mean > 0 ? Math.PI : -Math.PI);
  for (let iteration = 0; iteration < 100; iteration++) {
    const residual = anomaly - eccentricity * Math.sin(anomaly) - mean;
    if (residual === 0) return anomaly;
    if (residual > 0) high = anomaly;
    else low = anomaly;
    const derivative = 1 - eccentricity * Math.cos(anomaly);
    const newton = anomaly - residual / derivative;
    const next = newton > low && newton < high ? newton : (low + high) / 2;
    if (Math.abs(next - anomaly) <= 2e-15 || high - low <= 4e-15) return next;
    anomaly = next;
  }
  throw new Error('Kepler solver did not converge.');
}

/** Build a fixed star plus independently oriented elliptical test-particle orbits.
 * Semi-major axis is independent; period uses GM_star only. Planet masses are
 * metadata plus an approximation guard: their sum may not exceed 1% of the star.
 */
export function createKeplerSystem({ star, planets = [] } = {}) {
  if (!star || typeof star !== 'object') throw new TypeError('A star is required.');
  if (!Array.isArray(planets)) throw new TypeError('planets must be an array.');
  const starId = identifier(star.id, 'star.id');
  positive(star.massSolar, 'star.massSolar');
  positive(star.radiusSolar, 'star.radiusSolar');
  const starModel = Object.freeze({
    id: starId, massSolar: star.massSolar, radiusSolar: star.radiusSolar,
    massKg: star.massSolar * CONSTANTS.SOLAR_MASS_KG,
    radiusMeters: star.radiusSolar * CONSTANTS.SOLAR_RADIUS_METERS,
    gravitationalParameterM3S2: star.massSolar * SOLAR_GM,
  });
  const starArea = Math.PI * starModel.radiusMeters ** 2;
  if (![starModel.massKg, starModel.radiusMeters, starModel.gravitationalParameterM3S2, starArea].every(Number.isFinite) || starArea <= 0 || starModel.gravitationalParameterM3S2 <= 0) throw new RangeError('Stellar parameters exceed the numerical range.');
  const ids = new Set([starId]);
  let planetGM = 0;
  const planetModels = planets.map((planet, index) => {
    const prefix = `planets[${index}]`;
    if (!planet || typeof planet !== 'object') throw new TypeError(`${prefix} must be an object.`);
    identifier(planet.id, `${prefix}.id`);
    if (ids.has(planet.id)) throw new RangeError(`Duplicate body ID: ${planet.id}.`);
    ids.add(planet.id);
    const massJupiter = finite(planet.massJupiter ?? 0, `${prefix}.massJupiter`, 0);
    const radiusJupiter = finite(planet.radiusJupiter, `${prefix}.radiusJupiter`, 0);
    const source = planet.orbit;
    if (!source || typeof source !== 'object') throw new TypeError(`${prefix}.orbit is required.`);
    const elements = {
      semiMajorAxisAU: positive(source.semiMajorAxisAU, `${prefix}.orbit.semiMajorAxisAU`),
      eccentricity: finite(source.eccentricity ?? 0, `${prefix}.orbit.eccentricity`, 0, 1),
      inclinationDeg: finite(source.inclinationDeg ?? 0, `${prefix}.orbit.inclinationDeg`, 0, 180),
      longitudeAscendingNodeDeg: finite(source.longitudeAscendingNodeDeg ?? 0, `${prefix}.orbit.longitudeAscendingNodeDeg`),
      argumentPeriapsisDeg: finite(source.argumentPeriapsisDeg ?? 0, `${prefix}.orbit.argumentPeriapsisDeg`),
      meanAnomalyDegAtEpoch: finite(source.meanAnomalyDegAtEpoch ?? 0, `${prefix}.orbit.meanAnomalyDegAtEpoch`),
      epochDays: finite(source.epochDays ?? 0, `${prefix}.orbit.epochDays`),
    };
    if (elements.eccentricity === 1) throw new RangeError(`${prefix}: eccentricity must be less than 1.`);
    const semiMajorAxisMeters = elements.semiMajorAxisAU * CONSTANTS.AU_METERS;
    const radiusMeters = radiusJupiter * CONSTANTS.JUPITER_RADIUS_METERS;
    const massKg = massJupiter * CONSTANTS.JUPITER_MASS_KG;
    const meanMotionRadPerSecond = Math.sqrt(starModel.gravitationalParameterM3S2 / semiMajorAxisMeters) / semiMajorAxisMeters;
    const periodDays = TAU / meanMotionRadPerSecond / CONSTANTS.DAY_SECONDS;
    const periapsisMeters = semiMajorAxisMeters * (1 - elements.eccentricity);
    if (![semiMajorAxisMeters, radiusMeters, massKg, meanMotionRadPerSecond, periodDays, periapsisMeters].every(Number.isFinite) || meanMotionRadPerSecond <= 0 || periodDays <= 0) throw new RangeError(`${prefix}: orbital parameters exceed the numerical range.`);
    if (periapsisMeters <= starModel.radiusMeters + radiusMeters) throw new RangeError(`${prefix}: periapsis intersects the star; a(1-e) must exceed the sum of physical radii.`);
    planetGM += massJupiter * JUPITER_GM;
    const node = radians(elements.longitudeAscendingNodeDeg);
    const inc = radians(elements.inclinationDeg);
    const arg = radians(elements.argumentPeriapsisDeg);
    const cN = Math.cos(node), sN = Math.sin(node), cI = Math.cos(inc), sI = Math.sin(inc), cA = Math.cos(arg), sA = Math.sin(arg);
    // First two columns of Rz(node) Rx(inclination) Rz(argument of periapsis).
    const basisX = Object.freeze(vec(cN * cA - sN * sA * cI, sN * cA + cN * sA * cI, sA * sI));
    const basisY = Object.freeze(vec(-cN * sA - sN * cA * cI, -sN * sA + cN * cA * cI, cA * sI));
    return Object.freeze({
      id: planet.id, radiusJupiter, massJupiter, radiusMeters, massKg,
      orbit: Object.freeze(elements), semiMajorAxisMeters, periapsisMeters,
      apoapsisMeters: semiMajorAxisMeters * (1 + elements.eccentricity),
      meanMotionRadPerSecond, periodDays, basisX, basisY,
    });
  });
  const planetStarMassRatio = planetGM / starModel.gravitationalParameterM3S2;
  if (!Number.isFinite(planetStarMassRatio) || planetStarMassRatio > CONSTANTS.MAX_PLANET_STAR_MASS_RATIO + 1e-15) throw new RangeError('The sum of planetary masses exceeds 1% of the stellar mass, outside this star-dominated approximation.');
  return Object.freeze({ [SYSTEM]: true, star: starModel, planets: Object.freeze(planetModels), planetStarMassRatio });
}

function rotateInPlane(planet, x, y) {
  return vec(planet.basisX.x * x + planet.basisY.x * y, planet.basisX.y * x + planet.basisY.y * y, planet.basisX.z * x + planet.basisY.z * y);
}
function positionAtEccentricAnomaly(planet, eccentricAnomaly) {
  const e = planet.orbit.eccentricity;
  return rotateInPlane(planet, planet.semiMajorAxisMeters * (Math.cos(eccentricAnomaly) - e), planet.semiMajorAxisMeters * Math.sqrt(1 - e * e) * Math.sin(eccentricAnomaly));
}

/** Evaluate every orbit from one shared physical time, without hidden state. */
export function keplerStateAt(system, timeDays) {
  requireSystem(system);
  finite(timeDays, 'timeDays');
  return {
    timeDays,
    star: { id: system.star.id, worldMeters: vec(0, 0, 0), radiusMeters: system.star.radiusMeters },
    planets: system.planets.map(planet => {
      const elapsedDays = timeDays - planet.orbit.epochDays;
      if (!Number.isFinite(elapsedDays)) throw new RangeError('Elapsed time exceeds the numerical range.');
      const signedMean = TAU * ((elapsedDays % planet.periodDays) / planet.periodDays) + radians(planet.orbit.meanAnomalyDegAtEpoch);
      const meanAnomalyRad = wrapRadians(signedMean);
      const eccentricAnomalyRad = solveEccentricAnomaly(signedMean, planet.orbit.eccentricity);
      const sinE = Math.sin(eccentricAnomalyRad), cosE = Math.cos(eccentricAnomalyRad);
      const e = planet.orbit.eccentricity;
      const axisFactor = Math.sqrt(1 - e * e);
      const eccentricRate = planet.meanMotionRadPerSecond / (1 - e * cosE);
      return {
        id: planet.id, worldMeters: positionAtEccentricAnomaly(planet, eccentricAnomalyRad),
        velocityWorldMps: rotateInPlane(planet, -planet.semiMajorAxisMeters * sinE * eccentricRate, planet.semiMajorAxisMeters * axisFactor * cosE * eccentricRate),
        radiusMeters: planet.radiusMeters, periodDays: planet.periodDays,
        meanAnomalyRad, eccentricAnomalyRad,
        trueAnomalyRad: wrapRadians(Math.atan2(axisFactor * sinE, cosE - e)),
        orbitalDistanceMeters: planet.semiMajorAxisMeters * (1 - e * cosE),
      };
    }),
  };
}

/** Geometric ellipse polyline, uniformly sampled in eccentric anomaly, closed.
 * Points are world-meter {x,y,z} objects, not equally spaced physical times.
 */
export function sampleOrbitPath(system, planetId, samples = 160) {
  requireSystem(system);
  if (!Number.isInteger(samples) || samples < 4 || samples > 100000) throw new RangeError('Path samples must be an integer from 4 to 100000.');
  const planet = system.planets.find(candidate => candidate.id === planetId);
  if (!planet) throw new RangeError(`Unknown planet: ${planetId}.`);
  const points = Array.from({ length: samples - 1 }, (_, index) => positionAtEccentricAnomaly(planet, TAU * index / (samples - 1)));
  points.push({ ...points[0] });
  return points;
}

/** Planar intersection area of two circles; lengths share a unit. */
export function circleOverlapArea(radius1, radius2, separation) {
  finite(radius1, 'radius1', 0); finite(radius2, 'radius2', 0); finite(separation, 'separation', 0);
  if (radius1 === 0 || radius2 === 0 || separation >= radius1 + radius2) return 0;
  const smallerRadius = Math.min(radius1, radius2);
  const smallerArea = Math.PI * smallerRadius ** 2;
  if (!Number.isFinite(smallerArea)) throw new RangeError('Circle area exceeds the numerical range.');
  if (separation <= Math.abs(radius1 - radius2)) return smallerArea;
  const scale = Math.max(radius1, radius2);
  if (separation <= 4 * Number.EPSILON * scale) return smallerArea;
  const r = smallerRadius / scale, R = 1, d = separation / scale;
  const radicand = Math.max(0, (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
  const halfChord = Math.sqrt(radicand) / (2 * d);
  const chordOffset = (d * d + r * r - R * R) / (2 * d);
  const angle1 = Math.atan2(halfChord, chordOffset), angle2 = Math.atan2(halfChord, d - chordOffset);
  function segmentFactor(angle) {
    if (angle < 0.01) {
      const square = angle * angle;
      return angle * square * (2 / 3 + square * (-2 / 15 + square * (4 / 315 - square * 2 / 2835)));
    }
    return angle - Math.sin(angle) * Math.cos(angle);
  }
  return Math.max(0, Math.min(smallerArea, (r * r * segmentFactor(angle1) + segmentFactor(angle2)) * scale ** 2));
}

/** Area of stellar disk intersected with the UNION of opaque foreground disks.
 * Each disk is {x,y,radius} in the same length units as starRadius.
 * Split exposed circle arcs are integrated with Green's theorem (Pal 2012).
 * Individual transit deficits are never added, so overlaps are counted once.
 */
export function occultedArea(starRadius, foregroundDisks) {
  positive(starRadius, 'starRadius');
  if (!Array.isArray(foregroundDisks)) throw new TypeError('foregroundDisks must be an array.');
  const scaleSquared = starRadius ** 2;
  if (!Number.isFinite(Math.PI * scaleSquared)) throw new RangeError('Stellar area exceeds the numerical range.');
  const disks = foregroundDisks.map((disk, index) => {
    if (!disk || typeof disk !== 'object') throw new TypeError(`foregroundDisks[${index}] must be a disk.`);
    finite(disk.x, `foregroundDisks[${index}].x`); finite(disk.y, `foregroundDisks[${index}].y`); finite(disk.radius, `foregroundDisks[${index}].radius`, 0);
    const normalizedDisk = { x: disk.x / starRadius, y: disk.y / starRadius, radius: disk.radius / starRadius };
    if (!Object.values(normalizedDisk).every(Number.isFinite)) throw new RangeError('Disk coordinates exceed the numerical range.');
    return normalizedDisk;
  }).filter(disk => disk.radius > 0 && Math.hypot(disk.x, disk.y) < 1 + disk.radius);
  if (!disks.length) return 0;
  if (disks.some(disk => Math.hypot(disk.x, disk.y) + 1 <= disk.radius)) return Math.PI * scaleSquared;
  const epsilon = 32 * Number.EPSILON;
  const exposed = disks.filter((disk, index) => !disks.some((other, otherIndex) => {
    if (index === otherIndex) return false;
    const separation = Math.hypot(disk.x - other.x, disk.y - other.y);
    const coincident = separation <= epsilon && Math.abs(disk.radius - other.radius) <= epsilon;
    if (coincident) return otherIndex < index;
    return separation + disk.radius <= other.radius;
  }));
  if (exposed.length === 1) return circleOverlapArea(1, exposed[0].radius, Math.hypot(exposed[0].x, exposed[0].y)) * scaleSquared;
  const starDisk = { x: 0, y: 0, radius: 1 };
  const circles = [starDisk, ...exposed];
  function interior(point, disk) {
    return Math.hypot(point.x - disk.x, point.y - disk.y) < disk.radius - epsilon * Math.max(disk.radius, 1e-12);
  }
  let total = 0;
  for (let circleIndex = 0; circleIndex < circles.length; circleIndex++) {
    const circle = circles[circleIndex];
    const angles = [0, TAU];
    for (let otherIndex = 0; otherIndex < circles.length; otherIndex++) {
      if (otherIndex === circleIndex) continue;
      const other = circles[otherIndex];
      const dx = other.x - circle.x, dy = other.y - circle.y;
      const d = Math.hypot(dx, dy);
      if (d <= Math.abs(circle.radius - other.radius) || d >= circle.radius + other.radius || d === 0) continue;
      const cosine = (d * d + circle.radius ** 2 - other.radius ** 2) / (2 * d * circle.radius);
      const halfAngle = Math.acos(Math.max(-1, Math.min(1, cosine)));
      const centerAngle = Math.atan2(dy, dx);
      angles.push(wrapRadians(centerAngle - halfAngle), wrapRadians(centerAngle + halfAngle));
    }
    angles.sort((a, b) => a - b);
    for (let index = 1; index < angles.length; index++) {
      const begin = angles[index - 1], end = angles[index];
      if (end - begin <= epsilon) continue;
      const midpoint = (begin + end) / 2;
      const point = { x: circle.x + circle.radius * Math.cos(midpoint), y: circle.y + circle.radius * Math.sin(midpoint) };
      const keep = circleIndex === 0
        ? exposed.some(disk => interior(point, disk))
        : Math.hypot(point.x, point.y) <= 1 + epsilon && !exposed.some((disk, diskIndex) => diskIndex + 1 !== circleIndex && interior(point, disk));
      if (!keep) continue;
      total += 0.5 * (circle.radius ** 2 * (end - begin)
        + circle.radius * circle.x * (Math.sin(end) - Math.sin(begin))
        + circle.radius * circle.y * (Math.cos(begin) - Math.cos(end)));
    }
  }
  return Math.max(0, Math.min(Math.PI, total)) * scaleSquared;
}

/** Direction points from the star toward the observer. +z gives sky +x,+y. */
export function observerBasis(direction) {
  if (!Array.isArray(direction) || direction.length !== 3) throw new TypeError('Observer direction must be a three-number array.');
  direction.forEach((component, index) => finite(component, `direction[${index}]`));
  const lineOfSight = normalized(direction);
  const up = Math.abs(lineOfSight[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
  const skyX = normalized(cross(up, lineOfSight));
  return { direction: lineOfSight, skyX, skyY: cross(lineOfSight, skyX) };
}

export function projectPosition(worldMeters, observer) {
  const skyMeters = { x: dot(observer.skyX, worldMeters), y: dot(observer.skyY, worldMeters) };
  const lineOfSightMeters = dot(observer.direction, worldMeters);
  return { skyMeters, lineOfSightMeters, foreground: lineOfSightMeters > 0,
    projectedSeparationMeters: Math.hypot(skyMeters.x, skyMeters.y) };
}

export function measureDisks(starRadiusMeters, projected) {
  const occultors = projected.filter(planet => planet.foreground && planet.radiusMeters > 0 &&
    planet.projectedSeparationMeters < starRadiusMeters + planet.radiusMeters);
  const blockedAreaMeters2 = occultedArea(starRadiusMeters, occultors.map(planet => ({ ...planet.skyMeters, radius: planet.radiusMeters })));
  const depth = Math.max(0, Math.min(1, blockedAreaMeters2 / (Math.PI * starRadiusMeters ** 2)));
  return { flux: 1 - depth, depth, blockedAreaMeters2, occultingPlanetIds: occultors.map(planet => planet.id) };
}

export function observeSystem(system, timeDays, { direction = [0, 0, 1] } = {}) {
  requireSystem(system);
  const observer = observerBasis(direction);
  const world = keplerStateAt(system, timeDays);
  const planets = world.planets.map(planet => ({ ...planet, ...projectPosition(planet.worldMeters, observer) }));
  const { flux, blockedAreaMeters2, occultingPlanetIds } = measureDisks(system.star.radiusMeters, planets);
  return { timeDays, flux, blockedAreaMeters2, starRadiusMeters: system.star.radiusMeters,
    observer, star: world.star, planets, occultingPlanetIds };
}
