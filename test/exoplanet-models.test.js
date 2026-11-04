import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { value } from '../src/dataflow/index.js';
import { createRegistry } from '../packages/exoplanet/registry.js';
import { orbitPorts, orbitParameters, eccentricityParameters } from '../packages/exoplanet/models.js';
import { CONSTANTS as C } from '../packages/exoplanet/physics.js';

const ref = (node, port) => ({ node, port });
function fixture() {
  const registry = createRegistry(), binding = registry.bind();
  const project = new Project({ validators: binding.validators }), draft = project.begin(), science = binding.author(draft);
  science.instantiate('exoplanet.primary', { id: 'star' });
  science.instantiate('exoplanet.observer', { id: 'observer' });
  function orbit(id, options = {}) {
    const parameters = orbitParameters({ primaryId: 'star', ...options }), { primaryId } = parameters;
    return science.instantiate('exoplanet.orbit', { id, parameters,
      inputs: { gm: ref(primaryId, 'gm'), primaryRadius: ref(primaryId, 'radius') } });
  }
  function projection(id, body, observerId = 'observer') {
    return science.instantiate('exoplanet.projection', { id, parameters: { primaryId: 'star', observerId }, inputs: {
      primaryRadius: ref('star', 'radius'), direction: ref(observerId, 'direction'), position: ref(body, 'position'), radius: ref(body, 'radius'),
    } });
  }
  function photometry(ids, radiusIds = ids) {
    const descriptions = orbitPorts('star'), inputs = { primaryRadius: ref('star', 'radius'), direction: ref('observer', 'direction') };
    for (const [slot, port, members] of [['positions', 'position', ids], ['radii', 'radius', radiusIds]]) {
      inputs[slot] = science.select({ mode: 'fixed', members: members.map(id => ref(id, port)), element: descriptions[port] }, { id: slot });
    }
    return science.instantiate('exoplanet.photometry', { id: 'meter', parameters: { primaryId: 'star', observerId: 'observer' }, inputs });
  }
  function read(id, port, time = { value: 0, unit: 's' }) {
    const result = binding.evaluate(project, id, { port, time });
    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    return result.value;
  }
  return { registry, binding, project, draft, science, orbit, projection, photometry, read };
}
function near(a, b, tolerance = 1e-13) { assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b} (±${tolerance})`); }
function rejected(draft, code) { assert.throws(() => draft.accept(), error => error.validation?.errors.some(item => item.code === code)); }
function change(draft, id, parameters) {
  const { data } = draft.get(id).value;
  draft.get(id).set({ data: { ...data, parameters: { ...data.parameters, ...parameters } } });
}

test('registered SI orbit ports reproduce the Earth-like period, quarter orbit, signed velocity and common time', () => {
  const f = fixture();
  f.orbit('earth', { semiMajorAxisAU: 1, inclinationDeg: 0, argumentPeriapsisDeg: 0 });
  f.draft.accept();
  const period = f.read('earth', 'period');
  near(period.data / 86400, 365.2569, 0.001);
  const time = { value: period.data / (4 * 3600), unit: 'h' };
  const position = f.read('earth', 'position', time), velocity = f.read('earth', 'velocity', time);
  assert.equal(position.unit.symbol, 'm');
  assert.equal(position.reference, 'star');
  assert.deepEqual(position.frame, { id: 'exoplanet.world', kind: 'position' });
  assert.equal(velocity.frame.kind, 'direction');
  assert.equal(velocity.unit.symbol, 'm/s');
  near(position.data[0] / C.AU_METERS, 0);
  near(position.data[1] / C.AU_METERS, 1);
  near(velocity.data[0], -29784.7, 0.2);
  assert.deepEqual(position.time, velocity.time);
  assert.equal(position.time.unit.symbol, 'h');
  assert.deepEqual(f.read('star', 'position', time).data, [0, 0, 0]);
});

test('eccentricity edits preserve the chosen physical distance and Undo restores the previous period', () => {
  const f = fixture();
  const parameters = orbitParameters({ primaryId: 'star', semiMajorAxisAU: 0.1, eccentricity: 0.1 });
  f.orbit('p', { semiMajorAxisAU: 0.1, eccentricity: 0.1 }); f.draft.accept();
  assert.throws(() => eccentricityParameters(parameters, 0.4), /Choose/);
  const initialPeriod = f.read('p', 'period').data;
  let edit = f.project.begin();
  change(edit, 'p', eccentricityParameters(parameters, 0.4, 'semiMajorAxis')); edit.accept();
  near(f.read('p', 'period').data / initialPeriod, 1);
  const atPeriapsis = Math.hypot(...f.read('p', 'position').data);
  near(atPeriapsis / C.AU_METERS, 0.06);
  edit = f.project.begin();
  const current = edit.get('p').value.data.parameters;
  change(edit, 'p', eccentricityParameters(current, 0.6, 'periapsis')); edit.accept();
  near(Math.hypot(...f.read('p', 'position').data) / atPeriapsis, 1);
  near(f.read('p', 'period').data / initialPeriod, 1.5 ** 1.5);
  f.project.undo(f.project.token);
  assert.equal(f.read('p', 'period').data, initialPeriod);
});

test('coincident foreground silhouettes count once and reversed observer exchanges foreground and background', () => {
  const f = fixture();
  f.orbit('large'); f.orbit('small', { radiusJupiter: 0.5 }); f.orbit('rear', { meanAnomalyDegAtEpoch: 180, radiusJupiter: 2 });
  f.science.instantiate('exoplanet.observer', { id: 'opposite', parameters: { direction: [0, 0, -2] } });
  f.projection('front', 'large'); f.projection('back', 'rear'); f.projection('flipped', 'rear', 'opposite');
  f.photometry(['large', 'small', 'rear'], ['rear', 'large', 'small']);
  f.draft.accept();
  const delta = (C.JUPITER_RADIUS_METERS / C.SOLAR_RADIUS_METERS) ** 2;
  const individual = f.read('meter', 'independentDepths');
  assert.deepEqual(individual.objectIds, ['large', 'small', 'rear']);
  near(individual.data[0], delta); near(individual.data[1], 0.25 * delta); assert.equal(individual.data[2], 0);
  const flux = f.read('meter', 'flux');
  assert.equal(flux.reference, 'observer');
  assert.deepEqual(flux.normalization, { reference: 'star', definition: 'unobscured-uniform-stellar-flux' });
  near(flux.data, 1 - delta);
  assert.ok(flux.data > 1 - individual.data.reduce((a, b) => a + b, 0));
  assert.equal(f.read('back', 'foreground').data, 0); assert.equal(f.read('flipped', 'foreground').data, 1);
  assert.ok(f.read('back', 'lineOfSight').data < 0); assert.ok(f.read('front', 'lineOfSight').data > 0);
  near(f.read('flipped', 'depth').data, 4 * delta);
  const sky = f.read('front', 'skyPosition');
  assert.equal(sky.reference, 'front'); assert.deepEqual(sky.frame, { id: 'observer', kind: 'position' });
  near(sky.data[2] / C.AU_METERS, 0.05);
});

test('partially overlapping equal foreground silhouettes match closed-form inclusion–exclusion', () => {
  const f = fixture(), r = C.JUPITER_RADIUS_METERS, a = 0.05 * C.AU_METERS;
  // At true longitude π/2 the projected y is a cos(i). Centers are one radius apart.
  for (const [id, y] of [['left', -r / 2], ['right', r / 2]]) f.orbit(id, { inclinationDeg: Math.acos(y / a) * 180 / Math.PI });
  f.photometry(['left', 'right']); f.draft.accept();
  const lens = r ** 2 * (2 * Math.PI / 3 - Math.sqrt(3) / 2);
  const union = (2 * Math.PI * r ** 2 - lens) / (Math.PI * C.SOLAR_RADIUS_METERS ** 2);
  near(f.read('meter', 'depth').data, union, 3e-15);
});

test('mass guard aggregates every orbit on its own primary; edits and imports cannot bypass it', () => {
  const f = fixture();
  f.orbit('a', { massJupiter: 6 }); f.orbit('b', { massJupiter: 4 }); f.draft.accept();
  const original = f.project.snapshot(), token = f.project.token, edit = f.project.begin();
  change(edit, 'b', { massJupiter: 5 }); rejected(edit, 'EXOPLANET_MASS_RATIO');
  assert.deepEqual(f.project.token, token); assert.deepEqual(f.project.snapshot(), original);
  const unchecked = structuredClone(original); unchecked.nodes.find(n => n.id === 'a').data.parameters.massJupiter = 10;
  assert.throws(() => Project.from(unchecked, { validators: f.binding.validators }), error =>
    error.validation?.errors.some(item => item.code === 'EXOPLANET_MASS_RATIO'));
  const other = fixture();
  other.science.instantiate('exoplanet.primary', { id: 'second' });
  other.orbit('heavy1', { massJupiter: 10 }); other.orbit('heavy2', { massJupiter: 10, primaryId: 'second' });
  other.draft.accept();
});

test('reject collisions, oversized derived axes, degenerate observer and partial shape specifications', () => {
  for (const [options, code] of [[{ semiMajorAxisAU: 0.005, eccentricity: 0.25 }, 'EXOPLANET_PERIAPSIS'],
    [{}, 'EXOPLANET_AXIS']]) {
    const f = fixture(); f.orbit('grazing', options);
    if (code === 'EXOPLANET_AXIS') change(f.draft, 'grazing', { shape: { hold: 'periapsis', eccentricity: 0.85, distanceAU: 1 } });
    rejected(f.draft, code);
  }
  const f = fixture(); change(f.draft, 'observer', { direction: [0, 0, 0] }); rejected(f.draft, 'EXOPLANET_DIRECTION');
  const g = fixture(); g.orbit('p'); change(g.draft, 'p', { shape: { eccentricity: 0.4 } });
  assert.equal(g.draft.validate().valid, false);
});

test('photometry requires matching actual orbit members, accepts an empty physical sample, and rejects manufactured inputs', () => {
  const f = fixture(); f.orbit('a'); f.orbit('b'); f.photometry(['a'], ['b']); rejected(f.draft, 'EXOPLANET_MEMBERS');
  const empty = fixture(); empty.photometry([]); empty.draft.accept();
  assert.equal(empty.read('meter', 'flux').data, 1); assert.deepEqual(empty.read('meter', 'independentDepths').data, []);
  const fake = fixture();
  const descriptor = orbitPorts('star').radius;
  fake.science.constant(value({ ...descriptor, data: C.JUPITER_RADIUS_METERS }), { id: 'impostor' });
  fake.orbit('a');
  fake.science.instantiate('exoplanet.projection', { id: 'sky', parameters: { primaryId: 'star', observerId: 'observer' }, inputs: {
    primaryRadius: ref('star', 'radius'), direction: ref('observer', 'direction'), position: ref('a', 'position'), radius: ref('impostor', 'value'),
  } });
  rejected(fake.draft, 'EXOPLANET_SOURCE');
});

test('an explicit legacy orbit handle must attach the correct physical orbit to its own primary', () => {
  const f = fixture(); f.orbit('p'); f.science.instantiate('exoplanet.primary', { id: 'different' });
  f.draft.connect('exoplanet.attached-orbit', 'p', 'different', { id: 'wrong' });
  rejected(f.draft, 'EXOPLANET_SOURCE');
});

test('registered nominal conversions and observer direction fixtures are executable and discoverable', () => {
  const registry = createRegistry();
  for (const [id, count] of [['exoplanet.primary', 1], ['exoplanet.observer', 2]]) {
    const report = registry.runContractTests(id);
    assert.equal(report.passed, true, JSON.stringify(report.cases));
    assert.equal(report.total, count);
    assert.equal(report.scientificCertification, false);
  }
});
