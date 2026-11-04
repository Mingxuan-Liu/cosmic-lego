// Registered physical models. Only SI scientific ports connect them to the host.
import { value } from '../../src/dataflow/values.js';
import { membersOf } from '../../src/dataflow/graph.js';
import { CONSTANTS as C, createKeplerSystem, keplerStateAt, observerBasis, projectPosition,
  measureDisks, circleOverlapArea } from './physics.js';

const own = { $node: 'id' }, primaryRef = { $param: 'primaryId' }, observerRef = { $param: 'observerId' };
const world = 'exoplanet.world';
const gmUnit = { symbol: 'm^3/s^2', dimensions: { length: 3, time: -2 }, scale: 1 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const number = (minimum, maximum, defaultValue) => ({ type: 'number', minimum, maximum,
  ...(defaultValue === undefined ? {} : { default: defaultValue }) });
const scalar = (unit, meaning, reference, normalization = null) =>
  ({ kind: 'scalar', shape: [], unit, meaning, reference, normalization, frame: null });
const vector = (unit, meaning, reference, frameId, kind) =>
  ({ kind: 'vector', shape: [3], unit, meaning, reference, normalization: null, frame: { id: frameId, kind } });
const collected = descriptor => ({ ...descriptor, kind: 'collection', shape: [null, ...descriptor.shape] });
const string = { type: 'string' };
const paramsContext = object({ primaryId: string, observerId: string });
const version = '1.0.0', build = 'f12-1';
const approximation = 'Fixed primary and independent Kepler orbits. Planet masses do not enter the equations of motion.';
const diskAssumption = 'A distant observer measures opaque foreground silhouettes against a spherical uniformly bright primary.';
const orbitReference = { title: 'JPL Solar System Dynamics, Keplerian elements and rotations', locator: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html' };
const diskReference = { title: 'Pál (2012), multiple transiting objects, sections 2.1–2.4.1', locator: 'https://arxiv.org/abs/1111.1741' };
const nominalReference = { title: 'IAU 2015 Resolution B3, nominal conversion constants', locator: 'https://arxiv.org/abs/1510.07674' };

function primaryPorts(id) {
  return { gm: scalar(gmUnit, 'gravitational-parameter', id), radius: scalar('m', 'primary-radius', id),
    mass: scalar('kg', 'primary-mass', id), position: vector('m', 'position', id, world, 'position') };
}
export function orbitPorts(primaryId) {
  return { position: vector('m', 'position', primaryId, world, 'position'),
    velocity: vector('m/s', 'velocity', primaryId, world, 'direction'),
    radius: scalar('m', 'planet-radius', primaryId), mass: scalar('kg', 'planet-mass', primaryId),
    period: scalar('s', 'orbital-period', primaryId) };
}
const directionPort = id => vector('1', 'observer-direction', id, world, 'direction');
function lightPort(meaning, primaryId, observerId) {
  return scalar('1', meaning, observerId, { reference: primaryId, definition: 'unobscured-uniform-stellar-flux' });
}
function projectionPorts(id, p, o) {
  return { skyPosition: vector('m', 'position', id, o, 'position'),
    lineOfSight: scalar('m', 'signed-line-of-sight', o), foreground: scalar('1', 'foreground-indicator', o),
    depth: lightPort('transit-depth', p, o) };
}
function photometryPorts(p, o) {
  const depth = lightPort('transit-depth', p, o);
  return { flux: lightPort('relative-flux', p, o), depth, independentDepths: collected(depth) };
}
const orbitSchema = object({
  primaryId: string, massJupiter: number(0, 10, 0), radiusJupiter: number(0, 2.5, 1),
  shape: { ...object({ eccentricity: number(0, 0.85), hold: { type: 'string', enum: ['semiMajorAxis', 'periapsis'] },
    distanceAU: number(0.0003, 5) }), default: { eccentricity: 0, hold: 'semiMajorAxis', distanceAU: 0.05 } },
  inclinationDeg: number(0, 180, 90), longitudeAscendingNodeDeg: number(-360, 360, 0),
  argumentPeriapsisDeg: number(-360, 360, 90), meanAnomalyDegAtEpoch: number(-360, 360, 0), epochDays: number(-1e5, 1e5, 0),
});
export function orbitParameters({ primaryId, massJupiter = 0, radiusJupiter = 1, semiMajorAxisAU = 0.05, eccentricity = 0,
  inclinationDeg = 90, longitudeAscendingNodeDeg = 0, argumentPeriapsisDeg = 90, meanAnomalyDegAtEpoch = 0, epochDays = 0 }) {
  return { primaryId, massJupiter, radiusJupiter, shape: { eccentricity, hold: 'semiMajorAxis', distanceAU: semiMajorAxisAU },
    inclinationDeg, longitudeAscendingNodeDeg, argumentPeriapsisDeg, meanAnomalyDegAtEpoch, epochDays };
}
function axis({ eccentricity, hold, distanceAU }) { return hold === 'periapsis' ? distanceAU / (1 - eccentricity) : distanceAU; }
export function eccentricityParameters(parameters, eccentricity, hold) {
  if (!Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity > 0.85) throw new RangeError('Eccentricity must be in [0, 0.85].');
  if (!['semiMajorAxis', 'periapsis'].includes(hold)) throw new RangeError('Choose semiMajorAxis or periapsis for this eccentricity edit.');
  const previous = parameters.shape;
  const distanceAU = hold === previous.hold ? previous.distanceAU : axis(previous) * (hold === 'periapsis' ? 1 - previous.eccentricity : 1);
  return { shape: { eccentricity, hold, distanceAU } };
}
function planet(id, p) {
  const { primaryId, massJupiter, radiusJupiter, shape, ...angles } = p;
  return { id, massJupiter, radiusJupiter, orbit: { semiMajorAxisAU: axis(shape), eccentricity: shape.eccentricity, ...angles } };
}
function measured(descriptor, data, time, assumption, extra) {
  const shape = descriptor.kind === 'collection' ? [data.length, ...descriptor.shape.slice(1)] : descriptor.shape;
  return value({ ...descriptor, shape, data, time, metadata: { warnings: [], approximation: [assumption] }, ...extra });
}
function outputs(ports, data, request, assumption) {
  return Object.fromEntries(Object.entries(data).map(([key, val]) => [key, measured(ports[key], val, request.time, assumption)]));
}
const xyz = ({ x, y, z }) => [x, y, z];
function project(coordinates, observer, radiusMeters, id) {
  const [x, y, z] = coordinates;
  return { ...projectPosition({ x, y, z }, observer), radiusMeters, id };
}
function independentDepth(radius, body) {
  return body.foreground ? Math.min(1, circleOverlapArea(radius, body.radiusMeters,
    body.projectedSeparationMeters) / (Math.PI * radius ** 2)) : 0;
}
function issue(code, path, message) { return { code, path, message, category: 'applicability', severity: 'error' }; }
const labels = {
  EXOPLANET_MASS_RATIO: 'The sum of the orbiting masses may not exceed 1% of the primary mass.',
  EXOPLANET_PERIAPSIS: 'Periapsis must exceed the sum of the physical primary and planet radii.',
  EXOPLANET_AXIS: 'Derived semimajor axis must remain between 0.002 and 5 AU.',
  EXOPLANET_MEMBERS: 'Use the same set of up to 16 distinct orbit models for positions and radii.',
  EXOPLANET_SOURCE: 'Connect the declared physical body or observer and its specified port.',
  EXOPLANET_DIRECTION: 'Supply a nonzero observer direction of length at least 1e-12.',
};
// The registry harness supplies individual scalar/vector fixtures. The coupled
// orbit and transit reference cases build actual typed producer graphs in tests.
const epoch = { value: 0, unit: 's' };
const tolerance = { absolute: 1e-12, relative: 1e-13 };
const referenceCases = {
  primary: [{ id: 'nominal-sun', description: 'Nominal IAU solar GM and radius at the fixed origin.', parameters: {},
    expected: { outputs: outputs(primaryPorts('subject'), { gm: 1.3271244e20, radius: 6.957e8, position: [0, 0, 0] }, { time: epoch }, approximation) }, tolerance }],
  observer: [{ id: 'unit-direction', description: 'A signed direction is normalized in the physical world frame.',
    parameters: { direction: [0, -3, 4] }, expected: { outputs: { direction: measured(directionPort('subject'),
      [0, -0.6, 0.8], epoch, diskAssumption) } }, tolerance },
  { id: 'no-zero-observer', description: 'A zero direction cannot define a line of sight.', parameters: { direction: [0, 0, 0] },
    expectedError: 'EXOPLANET_DIRECTION', tolerance }],
};
function definition(name, summary, parameters, ports, example, equations, assumptions, references, dependencies, codes, evaluate, guards = {}) {
  const id = 'exoplanet.' + name;
  return { manifest: { schemaVersion: 1, apiVersion: 1, id, version, kind: 'model', implementation: { id: id + '.analytic', version, build },
    parameters, ports, dependencies: dependencies.map(name => ({ id: 'exoplanet.' + name, version, build })), capabilities: ['dataflow.sync'],
    documentation: { summary, links: [], examples: [{ parameters: example }] },
    diagnostics: codes.map(code => ({ code, description: labels[code] })),
    science: { equations, references, assumptions, applicability: Object.keys(guards).map(code => ({ id: code, description: labels[code] })),
      evaluation: { mode: 'analytic', sampling: ['instant'] },
      review: { status: 'experimental', notes: 'Regression-tested idealization. Independent physical review has not been performed.', evidence: [] } },
  }, implementation: { evaluate, guards }, referenceCases: referenceCases[name] ?? [] };
}
const primaryInputs = { primaryRadius: primaryPorts(primaryRef).radius, direction: directionPort(observerRef) };
const orbitOut = orbitPorts(primaryRef);
const sampleIds = { primaryId: 'primary', observerId: 'observer' };
const definitions = [
  definition('primary', 'Fixed primary at the origin. Mass and radius parameters use solar nominal units.', object({
    massSolar: number(0.1, 3, 1), radiusSolar: number(0.1, 5, 1) }), { inputs: {}, outputs: primaryPorts(own) }, {},
  ['GM = massSolar × nominal solar GM', 'R = radiusSolar × nominal solar radius', 'M = GM/G'], [approximation], [nominalReference],
  [], [], ({ node, request }) => {
    const star = createKeplerSystem({ star: { id: node.id, ...node.data.parameters } }).star;
    return outputs(primaryPorts(node.id), { gm: star.gravitationalParameterM3S2, radius: star.radiusMeters, mass: star.massKg, position: [0, 0, 0] }, request, approximation);
  }),
  definition('orbit', 'Bound ellipse around its named primary. Shape holds semimajor axis or periapsis in AU, angles use degrees, epoch uses days.',
    orbitSchema, { inputs: { gm: primaryPorts(primaryRef).gm, primaryRadius: primaryPorts(primaryRef).radius }, outputs: orbitOut },
    { primaryId: 'primary' }, ['E - e sin E = M', 'P = 2π sqrt(a³/GM)', 'q = a(1-e)'], [approximation,
      'Planet mass is metadata. A total planet-to-primary mass ratio of at most 0.01 is an interface guard, not a stability or accuracy estimate.'],
    [orbitReference, nominalReference], ['primary'], ['EXOPLANET_MASS_RATIO', 'EXOPLANET_PERIAPSIS', 'EXOPLANET_AXIS', 'EXOPLANET_SOURCE', 'EXOPLANET_MEMBERS'],
    ({ node, inputs, request }) => {
      const p = node.data.parameters;
      const system = createKeplerSystem({ star: { id: p.primaryId, massSolar: inputs.gm.data / C.SOLAR_GM_M3_S2,
        radiusSolar: inputs.primaryRadius.data / C.SOLAR_RADIUS_METERS }, planets: [planet(node.id, p)] });
      const days = request.time.value * request.time.unit.scale / C.DAY_SECONDS;
      const state = keplerStateAt(system, days).planets[0];
      return outputs(orbitPorts(p.primaryId), { position: xyz(state.worldMeters), velocity: xyz(state.velocityWorldMps),
        period: state.periodDays * C.DAY_SECONDS, radius: state.radiusMeters, mass: system.planets[0].massKg }, request, approximation);
    }, { EXOPLANET_AXIS: node => {
      const a = axis(node.data.parameters.shape);
      return a >= 0.002 && a <= 5 ? [] : [issue('EXOPLANET_AXIS', node.id + '.data.parameters.shape', labels.EXOPLANET_AXIS)];
    } }),
  definition('observer', 'Fixed direction from the primary toward a distant physical observer, in world axes.',
    object({ direction: { type: 'array', minItems: 3, maxItems: 3, items: number(-1e6, 1e6), default: [0, 0, 1] } }),
    { inputs: {}, outputs: { direction: directionPort(own) } }, {}, ['n = direction / |direction|'], [diskAssumption], [diskReference], [], ['EXOPLANET_DIRECTION'],
    ({ node, request }) => outputs({ direction: directionPort(node.id) }, { direction: observerBasis(node.data.parameters.direction).direction }, request, diskAssumption),
    { EXOPLANET_DIRECTION: node => Math.hypot(...node.data.parameters.direction) >= 1e-12 ? [] : [issue('EXOPLANET_DIRECTION', node.id, labels.EXOPLANET_DIRECTION)] }),
  definition('projection', 'Project the position and radius of one orbit into its physical observer sky. Positive line of sight is foreground.',
    paramsContext, { inputs: { ...primaryInputs, position: orbitOut.position, radius: orbitOut.radius }, outputs: projectionPorts(own, primaryRef, observerRef) },
    sampleIds, ['z = r · n', 'individual depth = foreground disk intersection area / (π R²)'], [diskAssumption], [diskReference],
    ['primary', 'orbit', 'observer'], ['EXOPLANET_SOURCE'], ({ node, inputs, request }) => {
      const p = node.data.parameters, b = project(inputs.position.data, observerBasis(inputs.direction.data), inputs.radius.data, node.id);
      return outputs(projectionPorts(node.id, p.primaryId, p.observerId), { skyPosition: [b.skyMeters.x, b.skyMeters.y, b.lineOfSightMeters],
        lineOfSight: b.lineOfSightMeters, foreground: Number(b.foreground), depth: independentDepth(inputs.primaryRadius.data, b) }, request, diskAssumption);
    }),
  definition('photometry', 'True union of foreground silhouettes clipped to the star. independentDepths is an explicitly separate per-orbit quantity.',
    paramsContext, { inputs: { ...primaryInputs, positions: collected(orbitOut.position), radii: collected(orbitOut.radius) }, outputs: photometryPorts(primaryRef, observerRef) },
    sampleIds, ['depth = area(star ∩ union of foreground disks) / (π R²)', 'flux = 1 - depth'], [diskAssumption], [diskReference],
    ['primary', 'orbit', 'observer'], ['EXOPLANET_SOURCE', 'EXOPLANET_MEMBERS'], ({ node, inputs, request }) => {
      const p = node.data.parameters, observer = observerBasis(inputs.direction.data);
      const radii = new Map(inputs.radii.objectIds.map((id, i) => [id, inputs.radii.data[i]]));
      const bodies = inputs.positions.objectIds.map((id, i) => project(inputs.positions.data[i], observer, radii.get(id), id));
      const radius = inputs.primaryRadius.data, { depth, flux } = measureDisks(radius, bodies);
      const ports = photometryPorts(p.primaryId, p.observerId);
      return { ...outputs(ports, { depth, flux }, request, diskAssumption), independentDepths: measured(ports.independentDepths,
        bodies.map(body => independentDepth(radius, body)), request.time, diskAssumption, { objectIds: inputs.positions.objectIds }) };
    }),
];

// Validate source identity in addition to the F02 descriptors. A physical model cannot
// borrow an unrelated source's label or pair different bodies' positions and radii.
function validateSystems(graph) {
  const nodes = new Map(graph.nodes.map(n => [n.id, n])), systems = new Map(), attached = new Set(), errors = [];
  const source = (node, slot) => nodes.get(node.references['input.' + slot]);
  function check(node, slot, expected, type, port) {
    const actual = source(node, slot);
    if (!actual || actual.id !== expected || actual.type !== 'exoplanet.' + type || node.data.inputs[slot]?.port !== port) {
      errors.push(issue('EXOPLANET_SOURCE', node.id + '.inputs.' + slot, 'Connect ' + slot + ' to ' + expected + '.' + port + ' on an exoplanet.' + type + '.'));
      return false;
    }
    return true;
  }
  for (const node of graph.nodes) {
    if (node.type === 'exoplanet.attached-orbit') {
      const orbit = nodes.get(node.references.source);
      if (node.kind !== 'relationship' || orbit?.type !== 'exoplanet.orbit' ||
          orbit.data.parameters.primaryId !== node.references.target || attached.has(orbit.id))
        errors.push(issue('EXOPLANET_SOURCE', node.id, 'An attached-orbit relationship must identify one orbit and its own primary, once.'));
      else attached.add(orbit.id);
      continue;
    }
    if (!['exoplanet.orbit', 'exoplanet.projection', 'exoplanet.photometry'].includes(node.type)) continue;
    const p = node.data.parameters, primary = source(node, 'primaryRadius');
    if (!check(node, 'primaryRadius', p.primaryId, 'primary', 'radius')) continue;
    if (node.type === 'exoplanet.orbit') {
      if (!check(node, 'gm', p.primaryId, 'primary', 'gm')) continue;
      if (!systems.has(primary)) systems.set(primary, []);
      systems.get(primary).push(planet(node.id, p));
      continue;
    }
    check(node, 'direction', p.observerId, 'observer', 'direction');
    if (node.type === 'exoplanet.projection') {
      const orbit = source(node, 'position');
      if (check(node, 'position', orbit?.id, 'orbit', 'position')) {
        check(node, 'radius', orbit.id, 'orbit', 'radius');
        if (orbit.data.parameters.primaryId !== p.primaryId) errors.push(issue('EXOPLANET_SOURCE', node.id, 'The projected orbit must belong to ' + p.primaryId + '.'));
      }
      continue;
    }
    function selected(slot, port) {
      const selection = source(node, slot);
      if (selection?.type !== 'dataflow.selection' || node.data.inputs[slot]?.port !== 'value') return null;
      if (selection.data.mode === 'live' && (selection.data.query.type !== 'exoplanet.orbit' || selection.data.query.port !== port)) return null;
      const members = membersOf(selection, graph);
      if (members.some(member => member.port !== port || nodes.get(member.id)?.type !== 'exoplanet.orbit' ||
          nodes.get(member.id).data.parameters.primaryId !== p.primaryId)) return null;
      return new Set(members.map(member => member.id));
    }
    const positions = selected('positions', 'position'), radii = selected('radii', 'radius');
    if (!positions || !radii || positions.size > 16 || positions.size !== radii.size || [...positions].some(id => !radii.has(id)))
      errors.push(issue('EXOPLANET_MEMBERS', node.id, labels.EXOPLANET_MEMBERS));
  }
  for (const [primary, planets] of systems) {
    if (planets.length > 16) errors.push(issue('EXOPLANET_MEMBERS', primary.id, 'At most 16 independent orbits may share one primary.'));
    try { createKeplerSystem({ star: { id: primary.id, ...primary.data.parameters }, planets }); }
    catch (error) {
      const index = /planets\[(\d+)\]/.exec(error.message)?.[1];
      const code = index === undefined ? 'EXOPLANET_MASS_RATIO' : 'EXOPLANET_PERIAPSIS';
      errors.push(issue(code, planets[index]?.id ?? primary.id, error.message));
    }
  }
  return errors;
}
export function registerExoplanetExtensions(registry) {
  for (const definition of definitions) registry.register(definition);
  return registry.registerValidator('exoplanet.system-couplings', validateSystems);
}
