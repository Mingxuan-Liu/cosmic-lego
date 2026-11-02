import { createSystem, stateAt, sampleOrbit } from './physics.js';
import { capabilities, sceneSchema, validateShape } from './contract.js';
export { capabilities, sceneSchema };

export function validateScene(scene) {
  const errors = validateShape(scene);
  const warnings = [];
  if (errors.length) return { valid: false, errors, warnings };
  for (const collection of ['systems', 'observers', 'views']) {
    const ids = new Set();
    scene[collection].forEach((entry, i) => {
      if (ids.has(entry.id)) errors.push({ path: `$.${collection}[${i}].id`, code: 'DUPLICATE_ID', message: `Duplicate ${collection} ID: ${entry.id}.` });
      ids.add(entry.id);
    });
  }
  scene.systems.forEach((system, i) => {
    try { createSystem(system); }
    catch (error) { errors.push({ path: `$.systems[${i}]`, code: 'PHYSICAL_CONSTRAINT', message: error.message }); }
  });
  scene.views.forEach((view, i) => {
    if (!scene.systems.some(s => s.id === view.systemId)) errors.push({ path: `$.views[${i}].systemId`, code: 'UNKNOWN_SYSTEM', message: `No system named ${view.systemId}.` });
    if (!scene.observers.some(o => o.id === view.observerId)) errors.push({ path: `$.views[${i}].observerId`, code: 'UNKNOWN_OBSERVER', message: `No observer named ${view.observerId}.` });
  });
  if (scene.systems.length > 1) warnings.push({ path: '$.systems', code: 'INDEPENDENT_SYSTEMS', message: 'These systems are independent comparison experiments; they do not gravitationally interact.' });
  if (scene.presentation.planetDisplayScale !== 1) warnings.push({ path: '$.presentation.planetDisplayScale', code: 'SCHEMATIC_SCALE', message: 'Planet size is exaggerated only in the orbit overview. Transit geometry and signals use physical radii.' });
  return { valid: errors.length === 0, errors, warnings };
}

function checked(scene) {
  const validation = validateScene(scene);
  if (!validation.valid) {
    const error = new Error(validation.errors.map(e => `${e.path}: ${e.message}`).join('\n'));
    error.code = 'INVALID_SCENE'; error.validation = validation;
    throw error;
  }
  const systems = new Map(scene.systems.map(s => [s.id, createSystem(s)]));
  const observers = new Map(scene.observers.map(o => [o.id, o]));
  return scene.views.map(view => ({ ...view, label: `${scene.systems.find(s => s.id === view.systemId).label} · ${observers.get(view.observerId).label}`, system: systems.get(view.systemId), observer: observers.get(view.observerId) }));
}

export function evaluateScene(scene, timeDays = 0) {
  if (!Number.isFinite(timeDays) || Math.abs(timeDays) > 1e7) throw new RangeError('timeDays must be finite and within ±10,000,000 days.');
  return { timeDays, views: checked(scene).map(view => {
    const state = stateAt(view.system, timeDays, view.observer);
    return { ...view, state: { ...state, phase: state.phaseRad / (2 * Math.PI) } };
  }) };
}

export function sampleScene(scene, { samples = 721 } = {}) {
  if (!Number.isInteger(samples) || samples < 3 || samples > 4097) throw new RangeError('samples must be an integer from 3 to 4097.');
  return { views: checked(scene).map(view => ({
    id: view.id, systemId: view.systemId, observerId: view.observerId, label: view.label,
    points: sampleOrbit(view.system, { inclinationDeg: view.observer.inclinationDeg, samples }).map((s, i) => ({
      timeDays: s.timeDays, phase: i / (samples - 1), flux: s.flux, stellarRVMps: s.stellarRVMps
    }))
  })) };
}
