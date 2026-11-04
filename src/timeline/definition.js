// Author-time data. A key "at" is always seconds on the presentation clock.
import { copyData, fail, freezeData, isId, isRecord } from '../core/data.js';

export const TIMELINE_LIMITS = Object.freeze({ maxBytes: 65536, maxDuration: 86400,
  maxTracks: 64, maxKeysPerTrack: 64, maxKeys: 512, maxBoundaries: 16, maxOperations: 32 });
const kinds = ['physical-time', 'camera', 'visibility', 'annotation', 'emphasis'];
const boundedText = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const insist = (ok, message, path = '$', code = 'TIMELINE_SCHEMA') => { if (!ok) fail(code, message, { path }); };
function fields(input, names, path) {
  insist(isRecord(input) && Object.keys(input).every(key => names.includes(key)) && names.every(key => Object.hasOwn(input, key)),
    'Use exactly the declared timeline fields.', path);
}
function toData(input) {
  let entries = 0, characters = 0;
  function scan(item, depth) {
    insist(++entries <= 16000 && depth <= 40, 'Timeline data exceeds the nesting or entry limit.', '$', 'TIMELINE_BUDGET');
    if (typeof item === 'string') characters += item.length;
    insist(characters <= TIMELINE_LIMITS.maxBytes, 'Timeline text exceeds the byte limit.', '$', 'TIMELINE_BUDGET');
    if (item === null || typeof item !== 'object') return;
    if (Array.isArray(item)) insist(item.length <= 16000 - entries, 'Timeline array exceeds the entry limit.', '$', 'TIMELINE_BUDGET');
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(item, key);
      insist(typeof key === 'string' && Object.hasOwn(d, 'value'), 'Timeline records accept data properties only.');
      characters += key.length;
      scan(d.value, depth + 1);
    }
  }
  scan(input, 0);
  const data = copyData(input);
  insist(new TextEncoder().encode(JSON.stringify(data)).length <= TIMELINE_LIMITS.maxBytes, 'Timeline exceeds 64 KiB.', '$', 'TIMELINE_BUDGET');
  return data;
}
function checked(input) {
  const definition = toData(input);
  fields(definition, ['version', 'data'], '$');
  insist(definition.version === 1, 'Unsupported authored timeline version.', '$.version');
  const d = definition.data;
  fields(d, ['id', 'title', 'duration', 'tracks', 'boundaries'], '$.data');
  insist(isId(d.id) && boundedText(d.title, 200), 'Timeline needs a stable ID and a title.');
  insist(Number.isFinite(d.duration) && d.duration > 0 && d.duration <= TIMELINE_LIMITS.maxDuration, 'Duration must be positive and at most 86400 seconds.', '$.data.duration');
  insist(Array.isArray(d.tracks) && d.tracks.length <= TIMELINE_LIMITS.maxTracks && Array.isArray(d.boundaries) && d.boundaries.length <= TIMELINE_LIMITS.maxBoundaries,
    'Use at most 64 tracks and 16 boundaries.', '$.data', 'TIMELINE_BUDGET');
  const ids = new Set(), destinations = new Set();
  const time = at => Number.isFinite(at) && at >= 0 && at <= d.duration;
  const vector = x => Array.isArray(x) && x.length === 3 && x.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9);
  function identity(record, path) {
    insist(isId(record.id) && !ids.has(record.id), 'Track and boundary IDs must be unique.', path + '.id');
    ids.add(record.id);
  }
  let total = 0;
  for (const [i, track] of d.tracks.entries()) {
    const path = '$.data.tracks[' + i + ']';
    insist(isRecord(track) && kinds.includes(track.kind), 'Unknown timeline track kind.', path);
    const targeted = ['visibility', 'camera', 'emphasis'].includes(track.kind);
    fields(track, targeted ? ['id', 'kind', 'target', 'keys'] : ['id', 'kind', 'keys'], path);
    identity(track, path);
    if (targeted) insist(isId(track.target), 'A track target must be a stable project node ID.', path);
    // Only one camera is active. Separate visibility/emphasis tracks may refer to distinct nodes.
    const destination = JSON.stringify([track.kind, track.kind === 'annotation' ? track.id : track.kind === 'camera' ? null : track.target ?? null]);
    insist(!destinations.has(destination), 'Two tracks control the same presentation property.', path);
    destinations.add(destination);
    insist(Array.isArray(track.keys) && track.keys.length > 0 && track.keys.length <= TIMELINE_LIMITS.maxKeysPerTrack, 'Use 1–64 keys per track.', path);
    total += track.keys.length;
    insist(total <= TIMELINE_LIMITS.maxKeys, 'Timeline exceeds 512 keys.', path, 'TIMELINE_BUDGET');
    for (const [j, key] of track.keys.entries()) {
      const keyPath = path + '.keys[' + j + ']';
      fields(key, ['at', 'value'], keyPath);
      insist(time(key.at) && (j ? key.at > track.keys[j - 1].at : key.at === 0), 'Keys start at zero and increase strictly within the duration.', keyPath);
      if (track.kind === 'physical-time') insist(Number.isFinite(key.value) && Math.abs(key.value) <= 1e12, 'Physical seconds exceed the finite timeline range.', keyPath);
      else if (track.kind === 'camera') {
        fields(key.value, ['position', 'target'], keyPath);
        insist(vector(key.value.position) && vector(key.value.target), 'Camera position and look target each require three finite coordinates.', keyPath);
        // Eye and look target both travel on linear world-space segments. The
        // closest point in their relative segment detects a crossing even if
        // no scheduled export frame happens to land exactly on it.
        const previous = track.keys[Math.max(0, j - 1)].value;
        const start = previous.position.map((x, i) => x - previous.target[i]);
        const delta = key.value.position.map((x, i) => x - key.value.target[i] - start[i]);
        const length2 = delta.reduce((sum, x) => sum + x * x, 0);
        const fraction = length2 ? Math.max(0, Math.min(1, -start.reduce((sum, x, i) => sum + x * delta[i], 0) / length2)) : 0;
        const closest = Math.hypot(...start.map((x, i) => x + fraction * delta[i]));
        const scale = Math.max(1, ...[...previous.position, ...previous.target, ...key.value.position, ...key.value.target].map(Math.abs));
        insist(closest > 16 * Number.EPSILON * scale, 'Camera eye and look target must remain distinct throughout interpolation.', keyPath, 'TIMELINE_CAMERA');
      } else if (track.kind === 'annotation') insist(typeof key.value === 'string' && key.value.length <= 500, 'Annotation text exceeds 500 characters.', keyPath);
      else insist(typeof key.value === 'boolean', 'Visibility and emphasis keys require a boolean.', keyPath);
    }
  }
  for (const [i, event] of d.boundaries.entries()) {
    const path = '$.data.boundaries[' + i + ']';
    fields(event, ['id', 'at', 'label', 'operations'], path); identity(event, path);
    insist(time(event.at) && boundedText(event.label, 200), 'A configuration boundary needs an in-range time and a comparison label.', path);
    insist(Array.isArray(event.operations) && event.operations.length > 0 && event.operations.length <= TIMELINE_LIMITS.maxOperations, 'Use 1–32 gateway mutations per boundary.', path);
    for (const op of event.operations) {
      fields(op, ['command', 'args'], path);
      insist(boundedText(op.command, 160) && isRecord(op.args), 'Boundary operations require a command name and data arguments.', path);
    }
  }
  return freezeData(definition);
}

export function validateTimeline(input) {
  try { checked(input); return { valid: true, errors: [] }; }
  catch (error) { return { valid: false, errors: [{ code: error.code ?? 'TIMELINE_SCHEMA', path: error.path ?? '$', message: error.message, severity: 'error' }] }; }
}

export function editTimeline(definition) {
  let state = checked(definition);
  const tokens = new Map([...state.data.tracks, ...state.data.boundaries].map(r => [r.id, {}]));
  function set(group, record, createOnly = false) {
    const data = toData(record);
    const index = state.data[group].findIndex(r => r.id === data.id);
    insist(!createOnly || index < 0, 'Timeline ID already exists.');
    const draft = copyData(state);
    if (index < 0) draft.data[group].push(data);
    else draft.data[group][index] = data;
    state = checked(draft);
    if (index < 0) tokens.set(data.id, {});
    return handle(group, data.id);
  }
  function remove(id) {
    insist(isId(id) && tokens.has(id), 'Unknown timeline record.');
    const draft = copyData(state);
    for (const group of ['tracks', 'boundaries']) draft.data[group] = draft.data[group].filter(r => r.id !== id);
    state = checked(draft); tokens.delete(id);
  }
  function handle(group, id) {
    const token = tokens.get(id);
    function current() {
      insist(tokens.get(id) === token, 'This timeline handle is stale.', id, 'STALE_HANDLE');
      return state.data[group].find(r => r.id === id);
    }
    return Object.freeze({ id, get value() { return current(); },
      set(patch) {
        const original = current(), data = toData(patch);
        insist(isRecord(data) && !Object.hasOwn(data, 'id'), 'A handle patch must preserve its ID.');
        return set(group, { ...original, ...data });
      },
      remove() { current(); remove(id); },
    });
  }
  return Object.freeze({ snapshot: () => state, track: data => set('tracks', data, true), boundary: data => set('boundaries', data, true),
    apply(input) {
      const op = toData(input); fields(op, ['command', 'args'], '$');
      if (op.command === 'timeline.track.set') return set('tracks', op.args);
      if (op.command === 'timeline.boundary.set') return set('boundaries', op.args);
      if (op.command === 'timeline.remove') { fields(op.args, ['id'], '$.args'); return remove(op.args.id); }
      fail('TIMELINE_COMMAND', 'Unknown timeline authoring command.');
    },
  });
}
export function createTimeline(options) {
  const data = toData(options);
  insist(isRecord(data) && Object.keys(data).every(key => ['id', 'title', 'duration'].includes(key)), 'Supply timeline duration and optional title and ID.');
  return editTimeline({ version: 1, data: { id: 'timeline', title: 'Untitled timeline', ...data, tracks: [], boundaries: [] } });
}

// After the last key every track holds its final authored value.
export function sampleTracks(definition, seconds) {
  const { duration, tracks } = definition.data;
  insist(Number.isFinite(seconds) && seconds >= 0 && seconds <= duration, 'Seek within the authored presentation duration.', '$.presentationTime', 'TIMELINE_TIME');
  return tracks.map(track => {
    const right = track.keys.findIndex(key => key.at > seconds);
    const a = track.keys[right < 0 ? track.keys.length - 1 : right - 1], b = track.keys[right];
    let value = a.value;
    if (b && seconds !== a.at && (track.kind === 'physical-time' || track.kind === 'camera')) {
      const f = (seconds - a.at) / (b.at - a.at);
      const mix = (x, y) => x + f * (y - x);
      if (track.kind === 'physical-time') value = mix(a.value, b.value);
      else value = Object.fromEntries(['position', 'target'].map(k => [k, a.value[k].map((v, i) => mix(v, b.value[k][i]))]));
    }
    return { id: track.id, kind: track.kind, target: track.target ?? null, value };
  });
}
