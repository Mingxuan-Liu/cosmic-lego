import { validateScene, evaluateScene, sampleScene, capabilities, sceneSchema } from './scene.js';

const $ = (id) => document.getElementById(id);
// Keep control limits synchronized with the machine-readable authoring contract.
const fields = sceneSchema.properties.systems.items.properties;
for (const [id, key] of Object.entries({ 'star-mass': 'starMassSolar', 'star-radius': 'starRadiusSolar', 'planet-mass': 'planetMassJupiter', 'planet-radius': 'planetRadiusJupiter', period: 'periodDays' })) {
  $(id).min = fields[key].minimum; $(id).max = fields[key].maximum;
}
$('inclination').max = sceneSchema.properties.observers.items.properties.inclinationDeg.maximum;
$('display-scale').max = sceneSchema.properties.presentation.properties.planetDisplayScale.maximum;
$('scene-title').maxLength = sceneSchema.properties.title.maxLength;
const TAU = 2 * Math.PI;
const colors = { gold: '#f2c063', pale: '#fff0cc', lavender: '#b4a4eb', grid: '#30283f', muted: '#8f829f', text: '#d8cce6' };
let scene = null;
let revision = null;
let samples = null;
let plotScales = null;
let cards = [];
let running = false;
let timeDays = 0;
let lastFrame = 0;
let selectedSystemId = '';
let selectedObserverId = '';
let jsonDirty = false;
let pending = false;
let pollBusy = false;
let renderFailure = '';

function showNotice(message, kind = 'error') {
  $('notice').textContent = message;
  $('notice').className = kind === 'info' ? 'notice info' : 'notice';
  $('notice').hidden = !message;
}

function connect(ok) {
  $('connection').textContent = ok ? 'Local scene connected' : 'Connection unavailable';
  $('connection').className = ok ? 'connection' : 'connection offline';
}

function errorText(validation) {
  return (validation?.errors || []).map((error) => `${error.path || 'scene'}: ${error.message}`).join('\n') || 'This scene is not valid.';
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.validation ? errorText(data.validation) : data.message || data.error || `Request failed (${response.status})`);
  return data;
}

function choose(select, options, current) {
  select.replaceChildren();
  for (const item of options) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label || item.id;
    select.append(option);
  }
  select.value = options.some((item) => item.id === current) ? current : options[0]?.id || '';
  return select.value;
}

function fillControls() {
  $('scene-title').value = scene.title || '';
  selectedSystemId = choose($('system-select'), scene.systems, selectedSystemId);
  selectedObserverId = choose($('observer-select'), scene.observers, selectedObserverId);
  const system = scene.systems.find((item) => item.id === selectedSystemId);
  if (system) {
    $('system-label').value = system.label || '';
    for (const [id, key] of Object.entries({ 'star-mass': 'starMassSolar', 'star-radius': 'starRadiusSolar', 'planet-mass': 'planetMassJupiter', 'planet-radius': 'planetRadiusJupiter', period: 'periodDays' })) $('' + id).value = system[key];
  }
  const observer = scene.observers.find((item) => item.id === selectedObserverId);
  if (observer) {
    $('observer-label').value = observer.label || '';
    $('inclination').value = observer.inclinationDeg;
    $('inclination-value').value = `${observer.inclinationDeg.toFixed(1)}°`;
  }
  const scale = scene.presentation?.planetDisplayScale ?? 5;
  $('display-scale').value = scale;
  $('display-scale-value').value = `${scale}×`;
}

function restoreJSON() {
  $('scene-json').value = JSON.stringify(scene, null, 2);
  jsonDirty = false;
  $('json-status').textContent = 'This specification matches the current scene.';
}

function acceptScene(data, source = 'local') {
  const validation = validateScene(data.scene);
  if (!validation.valid) throw new Error(errorText(validation));
  // Build samples before replacing the accepted state, so a failed scene keeps the last valid view.
  const nextSamples = sampleScene(data.scene, { samples: 361 });
  const allPoints = nextSamples.views.flatMap((view) => view.points);
  const lowestFlux = Math.min(1, ...allPoints.map((point) => point.flux));
  const fluxSpan = Math.max(1 - lowestFlux, 0.0001);
  const rvSpan = Math.max(1, ...allPoints.map((point) => Math.abs(point.stellarRVMps)));
  const nextScales = { flux: { minimum: lowestFlux - fluxSpan*.12, maximum: 1 + fluxSpan*.12 }, stellarRVMps: { minimum: -rvSpan*1.15, maximum: rvSpan*1.15 } };
  // Center conjunction at phase 0 without changing any physical sample.
  // Copy the half-orbit endpoint to both edges of this periodic display.
  for (const view of nextSamples.views) {
    const halfOrbit = view.points.find((point) => Math.abs(point.phase-.5) < 1e-10);
    view.points = view.points.filter((point) => point.phase < 1-1e-10).map((point) => ({ ...point, phase: point.phase > .5 ? point.phase-1 : point.phase }));
    if (halfOrbit) view.points.push({ ...halfOrbit, phase: -.5 });
    view.points.sort((a,b) => a.phase-b.phase);
  }
  scene = data.scene;
  revision = data.revision;
  samples = nextSamples;
  plotScales = nextScales;
  renderFailure = '';
  $('revision').textContent = `rev ${revision}`;
  $('active-title').textContent = scene.title;
  $('view-count').textContent = `${scene.views.length} linked view${scene.views.length === 1 ? '' : 's'}`;
  $('clock-label').textContent = `${scene.systems[0]?.label || 'First system'} · one orbit`;
  fillControls();
  buildCards();
  if (!jsonDirty) restoreJSON();
  else if (source === 'external') $('json-status').textContent = 'The scene changed externally. Your JSON draft is preserved; applying it will replace the current scene.';
  connect(true);
  const warnings = (validation.warnings || []).map((item) => item.message);
  showNotice(warnings.length ? warnings.join('\n') : '', 'info');
  draw();
}

async function saveScene(proposal, { resetClock = false, fromJSON = false } = {}) {
  if (pending) return;
  let validation;
  try { validation = validateScene(proposal); } catch (error) { showNotice(error.message); return; }
  if (!validation.valid) { showNotice(errorText(validation)); if (fromJSON) $('json-status').textContent = `Not applied. ${errorText(validation)}`; fillControls(); return; }
  pending = true;
  for (const control of document.querySelectorAll('.inspector input, .inspector select, .inspector button, #preset, #apply-json')) control.disabled = true;
  $('connection').textContent = 'Saving scene…';
  try {
    const data = await request('/api/scene', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: proposal, baseRevision: revision }) });
    if (fromJSON) jsonDirty = false;
    if (resetClock) timeDays = 0;
    acceptScene(data);
  } catch (error) { showNotice(error.message); if (fromJSON) $('json-status').textContent = `Not applied. ${error.message}`; if (scene) fillControls(); }
  finally {
    pending = false;
    for (const control of document.querySelectorAll('.inspector input, .inspector select, .inspector button, #preset, #apply-json')) control.disabled = false;
  }
}

function editScene(mutator) {
  if (!scene || pending) return;
  const next = structuredClone(scene);
  mutator(next);
  void saveScene(next);
}

function uid(prefix, existing) {
  let index = 1;
  while (existing.some((item) => item.id === `${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function makeCanvas(label, className) {
  const canvas = node('canvas', className);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  return canvas;
}

function buildCards() {
  const host = $('views');
  host.replaceChildren();
  host.classList.toggle('single', scene.views.length === 1);
  cards = scene.views.map((view) => {
    const system = scene.systems.find((item) => item.id === view.systemId);
    const observer = scene.observers.find((item) => item.id === view.observerId);
    const card = node('article', 'view-card');
    const header = node('div', 'view-header');
    const heading = node('div');
    heading.append(node('h4', '', system?.label || system?.id));
    heading.append(node('p', '', `${observer?.label || observer?.id} · i = ${observer?.inclinationDeg}°`));
    header.append(heading);
    if (scene.views.length > 1) {
      const remove = node('button', 'remove-view', '×');
      remove.setAttribute('aria-label', `Remove view of ${system?.label || view.systemId} for ${observer?.label || view.observerId}`);
      remove.addEventListener('click', () => editScene((next) => { next.views = next.views.filter((item) => item.id !== view.id); }));
      header.append(remove);
    }
    card.append(header);
    const geometry = node('div', 'geometry-row');
    const overviewCell = node('div', 'geometry-cell');
    const overview = makeCanvas('Orbit overview, schematic object sizes', 'geometry-canvas');
    overviewCell.append(node('p', 'canvas-label', 'Orbit overview'), overview, node('p', 'geometry-caption', `Schematic sizes · planet enlarged ${scene.presentation?.planetDisplayScale ?? 5}×`));
    const skyCell = node('div', 'geometry-cell');
    const sky = makeCanvas('Sky-plane transit geometry at physical radius ratio', 'geometry-canvas');
    const skyCaption = node('p', 'geometry-caption', 'Physical radius ratio · centered on star');
    skyCell.append(node('p', 'canvas-label', 'Observer’s sky'), sky, skyCaption);
    geometry.append(overviewCell, skyCell);
    card.append(geometry);
    const outputs = {};
    const plots = {};
    for (const [key, title, description] of [['flux', 'Normalized flux', 'Normalized stellar flux versus orbital phase'], ['rv', 'Stellar radial velocity', 'Stellar radial velocity versus orbital phase']]) {
      const block = node('div', 'plot-block');
      const plotHeading = node('div', 'plot-heading');
      outputs[key] = node('output', '', '—');
      plotHeading.append(node('span', '', title), outputs[key]);
      plots[key] = makeCanvas(description, 'plot-canvas');
      block.append(plotHeading, plots[key]);
      card.append(block);
    }
    const metrics = node('div', 'metrics');
    for (const [label, value] of [['Period', `${system?.periodDays} d`], ['Radius', `${system?.planetRadiusJupiter} R♃`], ['Mass', `${system?.planetMassJupiter} M♃`]]) {
      const item = node('span', '', `${label} `);
      item.append(node('strong', '', value));
      metrics.append(item);
    }
    card.append(metrics);
    host.append(card);
    return { id: view.id, overview, sky, skyCaption, outputs, plots, config: system, observer };
  });
  if (!cards.length) host.append(node('div', 'empty-state', 'Connect a system and an observer to create a view.'));
}

function context(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const nextWidth = Math.max(1, Math.round(width * ratio));
  const nextHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) { canvas.width = nextWidth; canvas.height = nextHeight; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function circle(ctx, x, y, radius, fill, stroke) {
  ctx.beginPath(); ctx.arc(x, y, Math.max(radius, 0), 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawOverview(card, view) {
  const { ctx, width, height } = context(card.overview);
  const system = view.system;
  const state = view.state;
  const a = system.semiMajorAxisMeters;
  const scale = Math.min(width, height) * 0.37 / a;
  const cx = width / 2;
  const cy = height / 2;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  circle(ctx, cx, cy, system.planetOrbitRadiusMeters * scale, null, '#50425f');
  if (system.starOrbitRadiusMeters * scale > 2) circle(ctx, cx, cy, system.starOrbitRadiusMeters * scale, null, '#655335');
  ctx.setLineDash([]);
  ctx.strokeStyle = '#5d506a';
  ctx.beginPath();ctx.moveTo(cx-3,cy);ctx.lineTo(cx+3,cy);ctx.moveTo(cx,cy-3);ctx.lineTo(cx,cy+3);ctx.stroke();
  const star = state.star.worldMeters;
  const planet = state.planet.worldMeters;
  const starRadius = Math.max(7, Math.min(16, (system.starRadiusMeters || card.config.starRadiusSolar * 6.957e8) * scale));
  const planetRadius = Math.max(2, Math.min(15, (system.planetRadiusMeters || card.config.planetRadiusJupiter * 7.1492e7) * scale * (scene.presentation?.planetDisplayScale ?? 5)));
  circle(ctx, cx + star.x * scale, cy - star.y * scale, starRadius + 5, '#f2c0630d');
  circle(ctx, cx + star.x * scale, cy - star.y * scale, starRadius, colors.gold);
  circle(ctx, cx + planet.x * scale, cy - planet.y * scale, planetRadius, colors.lavender);
  ctx.font = '9px system-ui';ctx.fillStyle = colors.muted;ctx.textAlign = 'center';
  ctx.fillText('orbital plane · barycentric view', cx, height - 5);
}

function drawSky(card, view) {
  const { ctx, width, height } = context(card.sky);
  const state = view.state;
  const starRadiusMeters = view.system.starRadiusMeters || card.config.starRadiusSolar * 6.957e8;
  const planetRadiusMeters = view.system.planetRadiusMeters || card.config.planetRadiusJupiter * 7.1492e7;
  const radius = Math.min(width, height) * 0.29;
  const scale = radius / starRadiusMeters;
  const cx = width / 2;
  const cy = height / 2;
  const x = cx + state.relative.skyMeters.x * scale;
  const y = cy - state.relative.skyMeters.y * scale;
  ctx.strokeStyle = '#2a2336';ctx.setLineDash([2, 5]);
  ctx.beginPath();ctx.moveTo(12,cy);ctx.lineTo(width-12,cy);ctx.moveTo(cx,12);ctx.lineTo(cx,height-15);ctx.stroke();ctx.setLineDash([]);
  const drawPlanet = () => { if (planetRadiusMeters > 0) circle(ctx, x, y, planetRadiusMeters * scale, '#161222', colors.lavender); };
  if (!state.planetInFront) drawPlanet();
  circle(ctx, cx, cy, radius, colors.gold);
  if (state.planetInFront) drawPlanet();
  const inFrame = x >= -planetRadiusMeters*scale && x <= width+planetRadiusMeters*scale && y >= -planetRadiusMeters*scale && y <= height+planetRadiusMeters*scale;
  ctx.font = '9px system-ui';ctx.fillStyle=colors.muted;ctx.textAlign='center';
  ctx.fillText(inFrame ? (state.planetInFront ? 'planet nearer than star' : 'planet behind star') : 'planet outside this close-up', cx, height-5);
  card.skyCaption.textContent = `Physical radius ratio · separation ${(state.projectedSeparationMeters / starRadiusMeters).toFixed(2)} R★`;
}

function drawPlot(canvas, points, key, currentPhase, currentValue) {
  const { ctx, width, height } = context(canvas);
  const margins = { left: 46, right: 10, top: 13, bottom: 36 };
  const pw = width - margins.left - margins.right;
  const ph = height - margins.top - margins.bottom;
  if (pw <= 0) return;
  const { minimum, maximum } = plotScales[key];
  const px = (phase) => margins.left + (phase+.5) * pw;
  const py = (value) => margins.top + (maximum - value) / (maximum - minimum) * ph;
  const format = (value) => key === 'flux' ? value.toFixed(maximum - minimum < 0.001 ? 5 : 3) : Math.abs(value) >= 1000 ? `${(value/1000).toFixed(1)}k` : value.toFixed(Math.abs(value) < 10 ? 1 : 0);
  ctx.font = '9px system-ui';ctx.lineWidth = 1;ctx.strokeStyle = colors.grid;ctx.fillStyle = colors.muted;
  for (let index=0;index<3;index++) {
    const value = minimum + (maximum-minimum)*index/2;
    const y = py(value);
    ctx.beginPath();ctx.moveTo(margins.left,y);ctx.lineTo(width-margins.right,y);ctx.stroke();ctx.textAlign='right';ctx.fillText(format(value),margins.left-7,y+3);
  }
  for (const phase of [-.5,-.25,0,.25,.5]) {
    const x = px(phase);ctx.beginPath();ctx.moveTo(x,margins.top);ctx.lineTo(x,height-margins.bottom);ctx.stroke();ctx.textAlign='center';ctx.fillText(phase.toString(),x,height-20);
  }
  ctx.textAlign='center';ctx.fillText('orbital phase · 0 = conjunction',margins.left+pw/2,height-5);
  ctx.save();ctx.beginPath();ctx.rect(margins.left,margins.top,pw,ph);ctx.clip();
  ctx.strokeStyle = colors.lavender;ctx.lineWidth=1.7;ctx.beginPath();
  points.forEach((point,index)=>{const x=px(point.phase ?? index/(points.length-1));const y=py(point[key]);if(index===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
  const x=px(currentPhase>.5?currentPhase-1:currentPhase);ctx.strokeStyle='#f2c06370';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,margins.top);ctx.lineTo(x,height-margins.bottom);ctx.stroke();circle(ctx,x,py(currentValue),3,colors.gold);
  ctx.restore();
}

function draw() {
  if (!scene || !samples) return;
  try {
    const evaluation = evaluateScene(scene, timeDays);
    const referencePeriod = scene.systems[0]?.periodDays || 1;
    const referencePhase = ((timeDays/referencePeriod)%1+1)%1;
    if (document.activeElement !== $('phase')) $('phase').value = referencePhase;
    $('time-value').value = `${timeDays.toFixed(3)} days`;
    for (const card of cards) {
      const view = evaluation.views.find((item) => item.id === card.id);
      const sampled = samples.views.find((item) => item.id === card.id);
      if (!view || !sampled) continue;
      const phase = view.state.phase ?? ((view.state.phaseRad / TAU)%1+1)%1;
      drawOverview(card, view);
      drawSky(card, view);
      drawPlot(card.plots.flux, sampled.points, 'flux', phase, view.state.flux);
      drawPlot(card.plots.rv, sampled.points, 'stellarRVMps', phase, view.state.stellarRVMps);
      card.outputs.flux.value = view.state.flux.toFixed(6);
      card.outputs.rv.value = `${view.state.stellarRVMps.toFixed(2)} m/s`;
    }
  } catch(error) {
    if (error.message !== renderFailure) { showNotice(`The current scene could not be drawn: ${error.message}`); renderFailure = error.message; }
    running = false; updatePlay();
  }
}

function updatePlay() { $('play').textContent = running ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label', running ? 'Pause animation' : 'Play animation'); }
function animate(now) {
  const elapsed = lastFrame ? Math.min((now-lastFrame)/1000, .1) : 0;
  lastFrame = now;
  if (scene && running && !document.hidden) timeDays += elapsed * scene.systems[0].periodDays / (scene.presentation?.orbitSeconds || 12);
  if (running) draw();
  requestAnimationFrame(animate);
}

$('system-select').addEventListener('change', () => { selectedSystemId = $('system-select').value; fillControls(); });
$('observer-select').addEventListener('change', () => { selectedObserverId = $('observer-select').value; fillControls(); });
$('scene-title').addEventListener('change', () => editScene((next) => { next.title = $('scene-title').value.trim(); }));
$('system-label').addEventListener('change', () => editScene((next) => { next.systems.find((item) => item.id === selectedSystemId).label = $('system-label').value.trim(); }));
$('observer-label').addEventListener('change', () => editScene((next) => { next.observers.find((item) => item.id === selectedObserverId).label = $('observer-label').value.trim(); }));
for (const [id, key] of Object.entries({ 'star-mass': 'starMassSolar', 'star-radius': 'starRadiusSolar', 'planet-mass': 'planetMassJupiter', 'planet-radius': 'planetRadiusJupiter', period: 'periodDays' })) $(id).addEventListener('change', () => editScene((next) => { next.systems.find((item) => item.id === selectedSystemId)[key] = Number($(id).value); }));
$('inclination').addEventListener('input', () => { $('inclination-value').value = `${Number($('inclination').value).toFixed(1)}°`; });
$('inclination').addEventListener('change', () => editScene((next) => { next.observers.find((item) => item.id === selectedObserverId).inclinationDeg = Number($('inclination').value); }));
$('display-scale').addEventListener('input', () => { $('display-scale-value').value = `${$('display-scale').value}×`; });
$('display-scale').addEventListener('change', () => editScene((next) => { next.presentation = { ...next.presentation, planetDisplayScale: Number($('display-scale').value) }; }));
$('duplicate-system').addEventListener('click', () => editScene((next) => {
  const original = next.systems.find((item) => item.id === selectedSystemId);
  const copy = { ...original, id: uid('system', next.systems), label: `${original.label || original.id} · copy` };
  next.systems.push(copy);
  next.views.push({ id: uid('view', next.views), systemId: copy.id, observerId: selectedObserverId });
  selectedSystemId = copy.id;
}));
$('add-observer').addEventListener('click', () => editScene((next) => {
  const observer = { id: uid('observer', next.observers), label: `Observer ${next.observers.length+1}`, inclinationDeg: 60 };
  next.observers.push(observer);
  next.views.push({ id: uid('view', next.views), systemId: selectedSystemId, observerId: observer.id });
  selectedObserverId = observer.id;
}));
$('add-view').addEventListener('click', () => {
  if (scene?.views.some((item) => item.systemId === selectedSystemId && item.observerId === selectedObserverId)) { showNotice('This system and observer already have a view. Choose a different pairing.'); return; }
  editScene((next) => next.views.push({ id: uid('view', next.views), systemId: selectedSystemId, observerId: selectedObserverId }));
});
$('play').addEventListener('click', () => { running = !running; updatePlay(); });
$('reset').addEventListener('click', () => { timeDays = 0; $('phase').value = 0; draw(); });
$('phase').addEventListener('input', () => { if (!scene) return; running=false;updatePlay();timeDays=Number($('phase').value)*scene.systems[0].periodDays;draw(); });
$('preset').addEventListener('change', async () => {
  const file = $('preset').value;
  if (!file) return;
  try { const next = await request(`/examples/${file}`); await saveScene(next, { resetClock: true }); }
  catch(error) { showNotice(error.message); }
  $('preset').value = '';
});
$('scene-json').addEventListener('input', () => { jsonDirty = true; $('json-status').textContent = 'Unapplied JSON draft. The visualizations still show the accepted scene.'; });
$('restore-json').addEventListener('click', restoreJSON);
$('apply-json').addEventListener('click', async () => {
  try { await saveScene(JSON.parse($('scene-json').value), { fromJSON: true }); }
  catch(error) { showNotice(`Cannot read JSON: ${error.message}`); }
});
$('copy-json').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('scene-json').value); $('json-status').textContent = 'JSON copied to clipboard.'; }
  catch { $('scene-json').select(); $('json-status').textContent = 'Select and copy the JSON using your keyboard.'; }
});
$('download-json').addEventListener('click', () => {
  const blob = new Blob([$('scene-json').value + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');link.href=url;link.download='astrocompose-scene.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('import-json').addEventListener('change', async () => {
  const file = $('import-json').files[0];
  if (!file) return;
  try { const next = JSON.parse(await file.text()); $('scene-json').value=JSON.stringify(next,null,2);jsonDirty=true;document.querySelector('.json-panel').open=true;$('json-status').textContent='File loaded into the draft. Apply JSON to update the scene.'; }
  catch(error) { showNotice(`Cannot read this file: ${error.message}`); }
  $('import-json').value='';
});

async function poll() {
  if (pending || pollBusy || document.hidden) return;
  pollBusy=true;
  const revisionAtStart = revision;
  try { const data=await request('/api/scene');if(pending || revision!==revisionAtStart)return;if(data.revision!==revision)acceptScene(data,'external');else connect(true); }
  catch(error) { connect(false);if(!scene)showNotice(`Could not load the local scene: ${error.message}`); }
  finally { pollBusy=false; }
}

// Keep supported capabilities available for inspection without making the model depend on the UI.
window.astroComposeCapabilities = capabilities;
window.addEventListener('resize', draw);
document.addEventListener('visibilitychange', () => { lastFrame=0;if(!document.hidden)void poll(); });
void poll();
updatePlay();
setInterval(poll,1000);
requestAnimationFrame(animate);
