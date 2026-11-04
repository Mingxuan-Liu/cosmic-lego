// Public authoring recipe. Scientific models own the orbit and occultation calculations.
import { readFileSync } from 'node:fs';
import { Project } from '../../src/core/index.js';
import { createPortableManifest } from '../../src/portable/format.js';
import { createTimeline } from '../../src/timeline/definition.js';
import { createWorkspaceLayer } from '../../src/workspace/index.js';
import { createRegistry } from './registry.js';
import { orbitParameters, orbitPorts } from './models.js';
import { skyDisplayMetres } from './visuals.js';

export const registryModule = new URL('./registry.js', import.meta.url);
const port = (node, port) => ({ node, port });
const secondsPerDay = 86400;
const original = 'Original Cosmic Lego synthetic double-transit study, packages/exoplanet/recipe.mjs';
const defaultBodies = [
  { id: 'ember', name: 'Ember', massJupiter: 0.9, radiusJupiter: 1.4, color: '#272238',
    orbit: { id: 'ember-orbit', semiMajorAxisAU: 0.047, eccentricity: 0.075, longitudeAscendingNodeDeg: 0 } },
  { id: 'cinder', name: 'Cinder', massJupiter: 0.35, radiusJupiter: 0.8, color: '#484052',
    orbit: { id: 'cinder-orbit', semiMajorAxisAU: 0.079, eccentricity: 0.18, longitudeAscendingNodeDeg: 38 } },
  { id: 'ash', name: 'Ash', massJupiter: 0.1, radiusJupiter: 0.5, color: '#50495D',
    orbit: { id: 'ash-orbit', semiMajorAxisAU: 0.10, eccentricity: 0.11, longitudeAscendingNodeDeg: -21,
      argumentPeriapsisDeg: -90 } },
];
const baseline = {
  id: 'shared-shadow', title: 'When shadows overlap',
  star: { id: 'primary', name: 'Primary', massSolar: 1, radiusSolar: 1, color: '#F2BE71' },
  planets: defaultBodies, observers: [{ id: 'earthward', name: 'Earthward detector', direction: [0, 0, 1] }],
  meters: [{ id: 'transit', name: 'Combined flux', observerId: 'earthward', occulters: 'orbiting' }],
  start: -7200, end: 7200, initial: 0, duration: 8, comparison: true,
};

function drawing(science, scene, body, primaryId, observerId, name) {
  const star = body.id === primaryId;
  const shape = science.instantiate('exoplanet.silhouette', {
    id: name('shape-' + body.id), parameters: { primaryId, quantity: star ? 'primary-radius' : 'planet-radius' },
    inputs: { radius: port(body.id, 'radius') },
  });
  const material = scene.material({ id: name('paint-' + body.id), color: body.color, unlit: true });
  const mesh = scene.mesh({ id: name('disk-' + body.id), geometry: shape, material });
  if (!star) {
    const projected = science.instantiate('exoplanet.projection', {
      id: name('sky-' + body.id), parameters: { primaryId, observerId },
      inputs: { position: port(body.id, 'position'), radius: port(body.id, 'radius'),
        primaryRadius: port(primaryId, 'radius'), direction: port(observerId, 'direction') },
    });
    scene.bind(mesh, projected, { id: name('place-' + body.id), property: 'position', port: 'skyPosition',
      quantity: 'position', unit: 'm', displayUnit: 'm', frame: observerId, displayFrame: observerId,
      scale: 1 / skyDisplayMetres });
  }
}

// Shared constructor for a new author study and an explicitly translated legacy document.
export function constructStudy(study) {
  const registry = createRegistry(), binding = registry.bind(), layer = createWorkspaceLayer(binding);
  const project = new Project({ id: study.id, title: study.title, validators: layer.validators });
  const draft = project.begin(), science = binding.author(draft), scene = layer.scene.author(draft), views = layer.author(draft);
  const { star, planets, observers, meters } = study, primaryId = star.id;
  const name = id => (study.prefix ?? '') + id;
  science.instantiate('exoplanet.primary', { id: primaryId,
    parameters: { massSolar: star.massSolar, radiusSolar: star.radiusSolar } });
  for (const planet of planets) {
    const { id: orbitId, ...elements } = planet.orbit;
    const parameters = orbitParameters({ primaryId, massJupiter: planet.massJupiter, radiusJupiter: planet.radiusJupiter,
      inclinationDeg: 90, longitudeAscendingNodeDeg: 0, argumentPeriapsisDeg: 90,
      meanAnomalyDegAtEpoch: 0, epochDays: 0, ...elements });
    science.instantiate('exoplanet.orbit', { id: planet.id, parameters,
      inputs: { gm: port(primaryId, 'gm'), primaryRadius: port(primaryId, 'radius') } });
    draft.connect('exoplanet.attached-orbit', planet.id, primaryId, { id: orbitId, data: { name: planet.name } });
  }
  for (const observer of observers) science.instantiate('exoplanet.observer', {
    id: observer.id, parameters: { direction: observer.direction },
  });
  const displayObserver = meters[0]?.observerId ?? observers[0]?.id;
  drawing(science, scene, star, primaryId, displayObserver, name);
  if (displayObserver) for (const body of planets) drawing(science, scene, body, primaryId, displayObserver, name);

  // Orthographic viewing from the declared observer keeps the projected radii at one common scale.
  const zLimit = 2300; // Encloses 5 AU * (1 + 0.85) in nominal solar radii.
  scene.camera({ id: name('sky-camera'), position: [0, 0, zLimit], target: [0, 0, 0],
    projection: 'orthographic', span: 3.9 * star.radiusSolar, near: 0.1, far: zLimit * 2 + 2 });
  scene.label({ id: name('sky-key'), text: displayObserver ? 'OBSERVER SKY  /  ' + displayObserver : 'FIXED PRIMARY',
    position: [0, 1.27 * star.radiusSolar, 0], size: 0.12 * star.radiusSolar, color: '#C8D3E6' });

  const selections = new Map(), outputs = [];
  const times = Array.from({ length: 33 }, (_, i) => study.start + i * (study.end - study.start) / 32);
  function members(which, index) {
    const key = JSON.stringify(which);
    if (!selections.has(key)) {
      const result = {}, descriptions = orbitPorts(primaryId);
      for (const [slot, output] of [['positions', 'position'], ['radii', 'radius']]) {
        const spec = which === 'orbiting' ? { mode: 'live', type: 'exoplanet.orbit', port: output }
          : { mode: 'fixed', members: which.map(id => port(id, output)) };
        result[slot] = science.select({ ...spec, element: descriptions[output] },
          { id: name((which === 'orbiting' ? 'all' : 'set-' + index) + '-' + slot) });
      }
      selections.set(key, result);
    }
    return selections.get(key);
  }
  const addPlot = (id, title, source, options = {}) => {
    const plot = views.plot({ id: name(id), title, x: 16, y: 80, width: 292, height: 175, ...options });
    views.bind(plot, source.node ?? source, { port: source.port ?? 'value', id: name('bind-' + id) });
    return plot;
  };
  for (const [i, meter] of meters.entries()) {
    const observed = science.instantiate('exoplanet.photometry', { id: meter.id,
      parameters: { primaryId, observerId: meter.observerId },
      inputs: { ...members(meter.occulters, i), primaryRadius: port(primaryId, 'radius'),
        direction: port(meter.observerId, 'direction') } });
    const curve = science.sample(port(observed, 'flux'), { times: meter.sampleTimes ?? times, unit: 's' }, { id: name('curve-' + meter.id) });
    addPlot('plot-' + meter.id, meter.name + ' · stellar flux', port(observed, 'flux'), { hidden: i > 0 });
    addPlot('plot-curve-' + meter.id, meter.name + ' · time (s)', curve,
      { y: 266, height: 182, hidden: i > 0 });
    outputs.push({ nodeId: meter.id, port: 'flux' });
    if (i === 0 && study.comparison) {
      const sum = science.reduce('sum', port(observed, 'independentDepths'), { id: name('independent-depth-sum') });
      const unity = science.arithmetic('add', port(observed, 'flux'), port(observed, 'depth'), {
        id: name('unobscured'), comparison: { meaning: 'unobscured-reference-flux', reference: meter.observerId },
      });
      const naive = science.arithmetic('subtract', unity, sum, {
        id: name('naive-flux'), comparison: { meaning: 'naive-independent-depth-flux', reference: meter.observerId },
      });
      const naiveCurve = science.sample(naive, { times, unit: 's' }, { id: name('curve-naive') });
      addPlot('plot-naive', 'Naive flux · summed depths', naive, { y: 458, height: 145 });
      addPlot('plot-curve-naive', 'Naive curve · ignores overlap', naiveCurve, { x: 325, y: 266, hidden: true });
      outputs.push({ nodeId: naive.id, port: 'value' });
    }
  }
  views.conversation({ id: name('conversation'), title: 'Study conversation', x: 1030, y: 80, width: 330, height: 315 });
  views.inspector({ id: name('inspector'), title: 'Selected component', x: 1030, y: 407, width: 330, height: 210, folded: true });
  views.provenance({ id: name('provenance'), title: 'Model and assumptions', x: 312, y: 82, width: 320, height: 235, hidden: true });
  draft.accept();

  const sequence = createTimeline({ id: name('passage'), title: study.title, duration: study.duration });
  sequence.track({ id: 'clock', kind: 'physical-time', keys: study.clock ?? [
    { at: 0, value: study.start }, { at: study.duration, value: study.end },
  ] });
  if (study.captions?.length) sequence.track({ id: 'guide', kind: 'annotation', keys: study.captions });
  if (study.comparison) sequence.track({ id: 'read-naive', kind: 'emphasis', target: name('plot-naive'), keys: [
    { at: 0, value: false }, { at: 3, value: true }, { at: 5, value: false },
  ] });
  const sourceRecords = [star, ...planets, ...observers, ...meters].map(item => ({
    nodeId: item.id, source: study.source ?? original, license: study.license ?? 'BSD-3-Clause',
    description: 'Model inputs or derived measurement: ' + item.name,
  }));
  return { project, registry, binding, layer, dataSources: sourceRecords, timeline: sequence.snapshot(),
    playback: { time: { value: study.initial, unit: 's' }, mode: 'analytic', targets: outputs },
    presentation: { title: study.title, caption: study.caption ?? 'Synthetic observing geometry · true relative radii',
      timeRange: { min: study.start, max: study.end, step: (study.end - study.start) / 480 } } };
}

export const dataSources = [baseline.star, ...baseline.planets, ...baseline.observers, ...baseline.meters].map(item => ({
  nodeId: item.id, source: original, license: 'BSD-3-Clause', description: 'Model inputs or derived measurement: ' + item.name,
}));

export function buildExample() {
  const context = constructStudy({ ...baseline,
    clock: [{ at: 0, value: -7200 }, { at: 3, value: 0 }, { at: 5, value: 0 }, { at: 8, value: 7200 }],
    captions: [
      { at: 0, value: 'Watch the foreground planets cross the uniformly bright star from different directions.' },
      { at: 3, value: 'At conjunction their disks overlap. The overlap blocks the same light once.' },
      { at: 5, value: 'As the shadows separate, compare the union with the sum of the individual deficits.' },
    ],
  });
  return { ...context, source: { path: 'packages/exoplanet/recipe.mjs', language: 'javascript',
    text: readFileSync(new URL(import.meta.url), 'utf8'), producedGraph: context.project.snapshot() } };
}

export function buildExoplanetManifest() { return createPortableManifest(buildExample()); }
export { secondsPerDay };
