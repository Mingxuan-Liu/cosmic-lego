// Explicit, data-only translation of a saved v0.2 World SDK construction.
import { readFileSync } from 'node:fs';
import { validateScene, sampleMeasurements } from '../../src/scene.js';
import { createPortableManifest, PORTABLE_LIMITS } from '../../src/portable/format.js';
import { constructStudy, secondsPerDay } from './recipe.mjs';

function reject(code, path, message) {
  const error = new Error(path + ': ' + message);
  error.code = code;
  error.path = path;
  throw error;
}
const notice = (path, message) => ({ path, message });
const recipeFile = (name, url) => ({ path: 'packages/exoplanet/' + name, language: 'javascript', text: readFileSync(url, 'utf8') });

export function importLegacy(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  if (typeof text !== 'string' || Buffer.byteLength(text) > PORTABLE_LIMITS.maxSourceFileBytes)
    reject('LEGACY_BUDGET', '$', 'The original document must fit in one preserved F09 authored resource.');
  let document;
  try { document = JSON.parse(text); } catch { reject('LEGACY_JSON', '$', 'Provide a JSON scene or saved /api/scene response.'); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) reject('LEGACY_SCHEMA', '$', 'Expected a JSON object.');
  const wrapped = Object.hasOwn(document, 'scene');
  if (wrapped) {
    for (const key of Object.keys(document)) if (!['scene', 'source', 'history', 'revision', 'valid'].includes(key))
      reject('LEGACY_UNSUPPORTED', '$.' + key, 'Unknown legacy envelope field.');
    if ('source' in document && typeof document.source !== 'string') reject('LEGACY_SCHEMA', '$.source', 'Expected inert author source text.');
    if ('history' in document && !Array.isArray(document.history)) reject('LEGACY_SCHEMA', '$.history', 'Expected legacy history records.');
    if ('revision' in document && !(Number.isSafeInteger(document.revision) && document.revision >= 0))
      reject('LEGACY_SCHEMA', '$.revision', 'Expected an integer revision.');
    if ('valid' in document && document.valid !== true) reject('LEGACY_SCHEMA', '$.valid', 'This dry run did not accept its construction.');
  }
  const scene = wrapped ? document.scene : document;
  if (scene?.schemaVersion !== '0.2') reject('LEGACY_VERSION', '$.schemaVersion', 'Only an explicit 0.2 independent-Kepler scene is supported.');
  const checked = validateScene(scene);
  if (!checked.valid) {
    const error = new Error(checked.errors.map(item => item.path + ': ' + item.message).join('\n'));
    error.code = 'LEGACY_INVALID';
    error.diagnostics = checked.errors;
    throw error;
  }
  const warnings = [
    notice('$.presentation.camera', 'Archived original camera; the migrated stage uses an orthographic view toward the first measurement’s physical observer.'),
    notice('$.presentation.bodyScale', 'Archived marker exaggeration; the migrated sky uses true radius ratios.'),
  ];
  const p = scene.presentation, start = p.startDays * secondsPerDay, end = (p.startDays + p.durationDays) * secondsPerDay;
  const startDay = p.startDays, endDay = p.startDays + p.durationDays, duration = p.playbackSeconds;
  // The legacy viewer showed the last cue at or before physical time (including ties).
  const cues = new Map([[0, '']]);
  for (const [i, a] of [...scene.annotations.entries()].sort(([, a], [, b]) => a.timeDays - b.timeDays)) {
    if (a.timeDays > endDay) { warnings.push(notice('$.annotations[' + i + ']', 'Cue falls after the saved interval; retained in the original.')); continue; }
    const at = Math.max(0, Math.min(duration, (a.timeDays - startDay) / p.durationDays * duration));
    const caption = a.title + ' — ' + a.text;
    if (caption.length > 500) reject('LEGACY_UNSUPPORTED', '$.annotations[' + i + ']', 'Title and text exceed the 500-character timeline caption limit; shorten them in a copy.');
    if (a.focusId) warnings.push(notice('$.annotations[' + i + '].focusId', 'The focus ID is archived; the timeline shows the caption without a camera move.'));
    cues.set(at, caption);
  }
  const hasRootCollision = ['bodies', 'orbits', 'observers', 'measurements'].some(key => scene[key].some(n => n.id === 'scene-root'));
  if (hasRootCollision) reject('LEGACY_UNSUPPORTED', '$', 'A legacy ID collides with scene-root; rename it and all references in a copy.');
  if (wrapped && ('revision' in document || 'history' in document))
    warnings.push(notice('$.revision / $.history', 'Archived historical receipts; the migrated project starts a fresh edit history.'));
  if (scene.observers.length === 0) warnings.push(notice('$.observers', 'No physical sightline was authored. Planet orbits are preserved; the stage shows only the fixed star.'));
  const star = scene.bodies.find(item => item.kind === 'star');
  const planets = scene.bodies.filter(item => item.kind === 'planet').map(body => {
    const { bodyId, hostId, ...orbit } = scene.orbits.find(o => o.bodyId === body.id);
    return { ...body, orbit };
  });
  // Retain the old contact-focused time choices. The registered photometer
  // recomputes all fluxes from the migrated scientific graph on this schedule.
  const sampled = sampleMeasurements(scene, { samples: 33 });
  const meters = scene.measurements.map((meter, i) => {
    const candidates = [...new Set(sampled.tracks[i].points.map(point => point.timeDays * secondsPerDay))];
    const limit = 256; // Public F02 time-series limit.
    const sampleTimes = candidates.length <= limit ? candidates : Array.from({ length: limit },
      (_, index) => candidates[Math.round(index * (candidates.length - 1) / (limit - 1))]);
    const details = sampled.sampling.tracks[i];
    if (sampleTimes.length !== candidates.length || details.budgetLimited || details.unresolvedGeometry) {
      warnings.push(notice('$.measurements[' + i + ']', 'Kept ' + sampleTimes.length + '/' + candidates.length +
        ' distinct candidate times. Legacy transit windows sampled: ' + details.sampledEvents + '/' + details.eventsInWindow +
        '. Unresolved contact geometry: ' + details.unresolvedGeometry + '. Narrower windows can retain more detail.'));
    }
    return { ...meter, sampleTimes };
  });
  if (meters.length) warnings.push(notice('$.measurements', 'Light curves retain fixed contact-guided schedules from the imported orbital elements. After orbital edits, re-sample a time window around the new transits.'));
  const context = constructStudy({
    id: 'imported-kepler-world', prefix: 'v2:', title: scene.title, star, planets, observers: scene.observers, meters,
    source: 'User-supplied v0.2 scene archived in legacy/input.json', license: 'Unspecified in legacy document',
    start, end, initial: start, duration, comparison: false,
    captions: scene.annotations.length ? [...cues].map(([at, value]) => ({ at, value })) : [],
  });
  const files = [
    recipeFile('recipe.mjs', new URL('./recipe.mjs', import.meta.url)),
    { path: 'legacy/input.json', language: 'json', text },
    { path: 'legacy/migration-notes.json', language: 'json', text: JSON.stringify(warnings, null, 2) },
  ];
  if (wrapped && 'source' in document) files.push({ path: 'legacy/original-source.mjs', language: 'javascript', text: document.source });
  const source = { ...recipeFile('importer.mjs', new URL(import.meta.url)), files, producedGraph: context.project.snapshot() };
  return { manifest: createPortableManifest({ ...context, source }), warnings };
}
