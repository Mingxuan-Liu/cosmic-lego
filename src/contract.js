// Bounded domain contracts. The authoring surface is semantic operations/handles.
export const orbitDefaults = Object.freeze({ semiMajorAxisAU: 0.05, eccentricity: 0, inclinationDeg: 90, longitudeAscendingNodeDeg: 0, argumentPeriapsisDeg: 90, meanAnomalyDegAtEpoch: 0, epochDays: 0 });
export const presentationDefaults = Object.freeze({ startDays: -0.25, durationDays: 12, playbackSeconds: 45, bodyScale: 8, camera: { azimuthDeg: -30, elevationDeg: 30, zoom: 1 } });
export const tools = [
  { name: 'add_body', description: 'Create a star or planet, returning its stable id. Planets must be attached to an orbit in the same transaction.', arguments: { body: 'star {id,kind:"star",name,massSolar,radiusSolar,color?} OR planet {id,kind:"planet",name,massJupiter?,radiusJupiter,color?}' } },
  { name: 'attach_orbit', description: 'Connect a planet to the host star with its own Keplerian orbit. Period is derived.', arguments: { orbit: '{id,bodyId,hostId,semiMajorAxisAU,eccentricity?,inclinationDeg?,longitudeAscendingNodeDeg?,argumentPeriapsisDeg?,meanAnomalyDegAtEpoch?,epochDays?}' } },
  { name: 'add_observer', description: 'Create a physical sightline, separate from the explanatory camera.', arguments: { observer: '{id,name,direction:[x,y,z]}' } },
  { name: 'observe_transits', description: 'Connect a star and observer to union photometry. "orbiting" includes future planets attached to that star.', arguments: { measurement: '{id,name,starId,observerId,occulters:"orbiting"|[planetIds]}' } },
  { name: 'update_body', description: 'Change an existing body without changing its kind/id.', arguments: { id: 'body id', patch: 'supported physical/name/color fields' } },
  { name: 'update_orbit', description: 'Change orbital elements or attachments. For eccentricity use set_eccentricity with an explicit preserved quantity.', arguments: { id: 'orbit id', patch: 'orbital fields excluding id/eccentricity' } },
  { name: 'set_eccentricity', description: 'Change eccentricity, explicitly preserving a or periapsis q=a(1-e). Fixed a preserves period; fixed q changes a and period.', arguments: { id: 'orbit id', eccentricity: '0 <= e <= 0.85', hold: 'semimajorAxis | periapsis' } },
  { name: 'update_observer', description: 'Change a physical sightline or observer name.', arguments: { id: 'observer id', patch: '{name?,direction?}' } },
  { name: 'update_measurement', description: 'Rewire a measurement to another observer or supported set of planets.', arguments: { id: 'measurement id', patch: '{name?,starId?,observerId?,occulters?}' } },
  { name: 'remove', description: 'Remove a handle. Referenced components require cascade:true; references are then removed explicitly.', arguments: { id: 'handle id', cascade: 'boolean (default false)' } },
  { name: 'set_presentation', description: 'Arrange the visible time window and camera; these never change measured physics.', arguments: { patch: '{startDays?,durationDays?,playbackSeconds?,bodyScale?,camera?}' } },
  { name: 'annotate', description: 'Add an explanation cue at physical time with an optional focused body.', arguments: { annotation: '{id,timeDays,title,text,focusId?}' } },
  { name: 'set_title', description: 'Name the authored world.', arguments: { title: 'string' } }
];

export const capabilities = {
  name: 'AstroCompose', version: '0.2.0', model: 'independent-keplerian-uniform-union',
  authoring: 'Construct and revise a graph of body, orbit, observer, measurement and annotation handles with the public JavaScript World SDK or semantic tool transactions.',
  supported: ['multiple planets around one primary', 'independent orbital eccentricity, inclination, node, periapsis, phase and epoch', 'composite transits including mutual projected overlap', 'multiple physical observers and selective photometers', 'atomic structural edits and removals', 'scripted annotations and camera framing'],
  assumptions: ['Fixed primary; planets follow independent Kepler orbits using host GM only.', 'Planet masses are metadata; total planet/host mass <= 0.01 is required but does not certify stability.', 'No mutual forces, scattering, precession, TTV, stellar reflex RV, limb darkening, planetary light, atmosphere, exposure integration or instrumental noise.', 'Changing parameters constructs a new model, not a conserving in-flight intervention.'],
  invariants: ['An orbit has one planet and one stellar host; every planet has exactly one orbit.', 'Periapsis clears the stellar surface plus planet radius.', 'All measurements share physical time.', 'A composite flux is the union of foreground disks clipped by the star, never the sum of individual deficits.', 'Eccentricity changes period only when another choice such as fixed periapsis changes semimajor axis.', 'Camera and display exaggeration cannot alter physical observer geometry.'],
  limits: { stars: 1, planets: 16, observers: 8, measurements: 8, eccentricityMax: 0.85 },
  transports: ['public Node/browser ES-module SDK', 'local CLI', 'local HTTP semantic tool transactions'],
  llmEmbedded: false, mcpImplemented: false, arbitraryServerCodeExecution: false,
  validationLimits: 'Conditional model checks and tests do not establish long-term orbital stability, stellar structure, arbitrary new couplings, or educational quality.'
};

export function blankScene(title = 'An agent-built world') {
  return { schemaVersion: '0.2', title, bodies: [], orbits: [], observers: [], measurements: [], presentation: structuredClone(presentationDefaults), annotations: [] };
}

const collections = ['bodies', 'orbits', 'observers', 'measurements', 'annotations'];
export function validateStructure(scene) {
  const errors = [];
  const fail = (path, message, code = 'CONTRACT') => errors.push({ path, code, message });
  const obj = (value, keys, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { fail(path, 'Expected an object.'); return false; }
    for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${path}.${key}`, 'Unsupported field for this model.', 'UNSUPPORTED_FIELD');
    return true;
  };
  const text = (value, path, max = 160) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(path, `Expected nonempty text up to ${max} characters.`); };
  const numeric = (value, path, min, max) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `Expected a finite number in [${min}, ${max}].`); };
  const id = (value, path) => { if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail(path, 'Expected a stable identifier: letter followed by letters, digits, _ or -.'); };
  const color = (value, path) => { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(path, 'Expected #RRGGBB.'); };
  if (!obj(scene, ['schemaVersion','title',...collections,'presentation'], '$')) return errors;
  if (scene.schemaVersion !== '0.2') fail('$.schemaVersion', 'Expected scene version 0.2. v0.1 pair-based scenes are intentionally not accepted.');
  text(scene.title, '$.title');
  const limits = { bodies: 17, orbits: 16, observers: 8, measurements: 8, annotations: 32 };
  for (const collection of collections) {
    if (!Array.isArray(scene[collection]) || scene[collection].length > limits[collection]) fail(`$.${collection}`, `Expected an array with at most ${limits[collection]} entries.`);
  }
  if (errors.length) return errors;
  const ids = new Set();
  for (const collection of collections) for (const [i, entry] of scene[collection].entries()) {
    const path = `$.${collection}[${i}]`;
    if (!entry || typeof entry !== 'object') { fail(path, 'Expected an object.'); continue; }
    id(entry.id, `${path}.id`);
    if (ids.has(entry.id)) fail(`${path}.id`, 'Handle identifiers must be unique across the world.', 'DUPLICATE_ID');
    ids.add(entry.id);
    if (collection === 'bodies') {
      const star = entry.kind === 'star';
      obj(entry, ['id','kind','name','color', ...(star ? ['massSolar','radiusSolar'] : ['massJupiter','radiusJupiter'])], path);
      if (!['star','planet'].includes(entry.kind)) fail(`${path}.kind`, 'Supported body kinds: star, planet.');
      text(entry.name, `${path}.name`); color(entry.color, `${path}.color`);
      if (star) { numeric(entry.massSolar,`${path}.massSolar`,0.1,3); numeric(entry.radiusSolar,`${path}.radiusSolar`,0.1,5); }
      else { numeric(entry.massJupiter,`${path}.massJupiter`,0,10); numeric(entry.radiusJupiter,`${path}.radiusJupiter`,0,2.5); }
    } else if (collection === 'orbits') {
      obj(entry, ['id','bodyId','hostId',...Object.keys(orbitDefaults)], path);
      id(entry.bodyId,`${path}.bodyId`); id(entry.hostId,`${path}.hostId`);
      for (const [key, lo, hi] of [['semiMajorAxisAU',0.002,5],['eccentricity',0,0.85],['inclinationDeg',0,180],['longitudeAscendingNodeDeg',-360,360],['argumentPeriapsisDeg',-360,360],['meanAnomalyDegAtEpoch',-360,360],['epochDays',-1e5,1e5]]) numeric(entry[key],`${path}.${key}`,lo,hi);
    } else if (collection === 'observers') {
      obj(entry,['id','name','direction'],path); text(entry.name,`${path}.name`);
      if (!Array.isArray(entry.direction) || entry.direction.length !== 3 || entry.direction.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v)>1e6) || Math.hypot(...entry.direction)<1e-12) fail(`${path}.direction`,'Expected a nonzero finite 3-vector.');
    } else if (collection === 'measurements') {
      obj(entry,['id','kind','name','starId','observerId','occulters'],path); text(entry.name,`${path}.name`);
      if (entry.kind !== 'transit') fail(`${path}.kind`,'Only uniform-star transit photometry is supported by this model.');
      id(entry.starId,`${path}.starId`); id(entry.observerId,`${path}.observerId`);
      if (entry.occulters !== 'orbiting' && (!Array.isArray(entry.occulters) || entry.occulters.length>16 || new Set(entry.occulters).size!==entry.occulters.length || entry.occulters.some(v=>typeof v!=='string'))) fail(`${path}.occulters`,'Expected "orbiting" or an array of distinct planet ids.');
    } else {
      obj(entry,['id','timeDays','title','text','focusId'],path); numeric(entry.timeDays,`${path}.timeDays`,-1e5,1e5); text(entry.title,`${path}.title`); text(entry.text,`${path}.text`,1000);
      if (entry.focusId !== null) id(entry.focusId,`${path}.focusId`);
    }
  }
  const p = scene.presentation;
  if (obj(p,['startDays','durationDays','playbackSeconds','bodyScale','camera'],'$.presentation')) {
    for (const [key,lo,hi] of [['startDays',-1e5,1e5],['durationDays',0.02,1000],['playbackSeconds',5,600],['bodyScale',1,30]]) numeric(p[key],`$.presentation.${key}`,lo,hi);
    if (obj(p.camera,['azimuthDeg','elevationDeg','zoom'],'$.presentation.camera')) for (const [key,lo,hi] of [['azimuthDeg',-360,360],['elevationDeg',-89,89],['zoom',0.1,10]]) numeric(p.camera[key],`$.presentation.camera.${key}`,lo,hi);
  }
  return errors;
}
