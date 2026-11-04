import { createThreeAdapter } from '/src/scene/three-adapter.js';
import { plotRows, seriesPaths, plotFraction } from '/src/workspace/plot-samples.js';

const $ = id => document.getElementById(id);
const studySlug = /^\/studies\/([a-z0-9-]+)\/$/.exec(location.pathname)?.[1];
const timelineApi = studySlug ? './api/timeline' : '/api/timeline';
const returnLink = document.getElementById('roadmap-return');
if (studySlug) {
  returnLink.href = '/?phenomenon=' + encodeURIComponent(studySlug);
  returnLink.hidden = false;
}
const capture = new URLSearchParams(location.search).get('capture') === '1';
document.body.classList.toggle('capture', capture);
const canvas = $('scene'), logo = $('brand'), controls = $('controls');
controls.hidden = capture;
let adapter, graphics, graphicsError, metadata, currentFrame, lastReceipt;
let drawing = 0, sequence = 0, pending, playTimer, scrubTimer, playClock, playing = false, disposed = false;
const previewPeriod = 1000 / 12;
let networkRead = Promise.resolve();
const raf = () => new Promise(resolve => requestAnimationFrame(resolve));
const seconds = number => Number.isFinite(number) ? Number(number.toPrecision(7)).toString() : '—';
const failure = (code, message) => Object.assign(new Error(message), { code });
const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text != null) result.textContent = text;
  if (className) result.className = className;
  return result;
};
function showError(error) {
  const target = $('stage-error'); target.textContent = `${error.code ? error.code + ' · ' : ''}${error.message}`; target.hidden = false;
  $('status').textContent = 'Unable to display frame'; $('reload').hidden = capture;
}
function sizeRenderer() {
  if (!adapter || disposed) return;
  const { width, height } = canvas.getBoundingClientRect();
  if (width && height) adapter.resize(width, height, capture ? 1 : devicePixelRatio);
}
try {
  adapter = createThreeAdapter({ canvas, reducedMotion: true, onDiagnostic(issue) {
    if (issue.code === 'RENDER_CONTEXT_LOST' && !disposed) { graphicsError = failure(issue.code, issue.message); showError(graphicsError); }
  } });
  const gl = canvas.getContext('webgl2'), details = gl.getExtension('WEBGL_debug_renderer_info');
  graphics = { name: adapter.capabilities.renderer, version: adapter.capabilities.version, webgl: 2,
    glVersion: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    vendor: gl.getParameter(details?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), device: gl.getParameter(details?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) };
  sizeRenderer();
} catch (error) { graphicsError = error; showError(error); }
const resize = new ResizeObserver(() => { sizeRenderer(); if (currentFrame && !disposed) adapter?.render(); }); resize.observe(canvas);

function samples(view, card, physicalSeconds) {
  const value = view.data, unit = value.unit.symbol;
  if (value.kind === 'scalar') {
    const amount = node('div', value.data == null ? 'Missing' : seconds(value.data), 'measurement');
    if (value.data != null && unit !== '1') amount.append(node('small', ` ${unit}`));
    if (unit === '1') amount.title = 'Dimensionless';
    card.append(amount);
  } else {
    const rows = plotRows(view), valid = rows.filter(row => Number.isFinite(row.y));
    if (!valid.length) card.append(node('p', 'No finite samples', 'source'));
    else {
      const low = Math.min(...valid.map(row => row.y)), high = Math.max(...valid.map(row => row.y));
      const xs = rows.map(row => row.x), minX = Math.min(...xs), maxX = Math.max(...xs);
      const px = x => 5 + 190 * plotFraction(x, minX, maxX), py = y => 54 - 50 * plotFraction(y, low, high);
      const ns = 'http://www.w3.org/2000/svg';
      const chart = document.createElementNS(ns, 'svg'); chart.setAttribute('viewBox', '0 0 200 58'); chart.setAttribute('role', 'img');
      chart.setAttribute('aria-label', `${valid.length} current samples in ${unit}, from ${seconds(low)} to ${seconds(high)}`);
      if (value.kind === 'series') {
        const at = physicalSeconds / value.coordinates.unit.scale;
        if (at >= minX && at <= maxX) {
          const cursor = document.createElementNS(ns, 'line');
          cursor.setAttribute('x1', px(at)); cursor.setAttribute('x2', px(at));
          cursor.setAttribute('y1', 3); cursor.setAttribute('y2', 55);
          cursor.setAttribute('stroke', '#f2c063'); cursor.setAttribute('stroke-dasharray', '2 2'); chart.append(cursor);
        }
      }
      if (value.kind === 'series') for (const [channel, d] of seriesPaths(rows, px, py)) {
        const stroke = document.createElementNS(ns, 'path');
        stroke.setAttribute('d', d); stroke.setAttribute('fill', 'none');
        stroke.setAttribute('stroke', ['#77d1c5', '#f2c063', '#aba2e8'][channel]); chart.append(stroke);
      }
      for (const row of valid) {
        const dot = document.createElementNS(ns, 'circle'); dot.setAttribute('r', value.kind === 'series' ? 1.3 : 2.2);
        dot.setAttribute('cx', px(row.x)); dot.setAttribute('cy', py(row.y));
        dot.setAttribute('fill', ['#77d1c5', '#f2c063', '#aba2e8'][(row.series ?? 0) % 3]);
        chart.append(dot);
      }
      const axis = value.kind === 'series' ? `time ${seconds(minX)} … ${seconds(maxX)} ${value.coordinates.unit.symbol}` : 'sample index';
      card.append(chart, node('span', `${seconds(low)} – ${seconds(high)}${unit === '1' ? '' : ' ' + unit} · ${axis}`, 'source'));
    }
  }
  card.append(node('p', `${view.source.nodeId}.${view.source.port}`, 'source'));
}
function renderReadouts(frame) {
  const cards = [];
  for (const view of frame.snapshot.overlays) {
    // Workspace conversation and inspector controls belong to authoring. An
    // explicit emphasis on another panel still carries its authored title.
    if (view.hidden || view.kind !== 'plot' && !view.emphasized) continue;
    const card = node('article', null, 'readout'); card.dataset.id = view.id; card.dataset.emphasized = String(view.emphasized === true);
    card.append(node('div', view.emphasized ? 'In focus' : view.kind === 'plot' ? 'Measurement' : view.kind, 'readout-key'), node('h2', view.title));
    if (!view.folded && view.kind === 'plot') samples(view, card, frame.physicalTime.value);
    cards.push(card);
  }
  $('panels').replaceChildren(...cards);
}
function renderLabels(frame) {
  $('title').textContent = frame.timeline.title; document.title = `${frame.timeline.title} · Cosmic Lego`;
  $('presentation-time').textContent = `${seconds(frame.presentationTime)} s`;
  $('physical-time').textContent = `${seconds(frame.physicalTime.value)} s`;
  const boundaries = frame.configuration.boundaries;
  $('configuration').textContent = boundaries.at(-1)?.label ?? 'Original configuration';
  $('annotations').replaceChildren(...frame.annotations.map(annotation => node('p', annotation.text)));
  $('caption').hidden = !boundaries.length && !frame.annotations.length;
  const notes = $('notes'); notes.hidden = !frame.warnings.length;
  notes.querySelector('ul').replaceChildren(...frame.warnings.map(warning => node('li', warning.message ?? warning.code ?? warning)));
  renderReadouts(frame);
}
async function present(input) {
  if (disposed) throw failure('PLAYER_CLOSED', 'The player is closed.');
  if (graphicsError) throw graphicsError;
  const frame = structuredClone(input), ticket = ++drawing;
  $('stage').dataset.ready = 'false';
  if (!frame?.snapshot?.valid || !frame.snapshot.scene?.valid || !Number.isFinite(frame.presentationTime) || !Number.isFinite(frame.physicalTime?.value)) {
    throw failure('INVALID_FRAME', 'A complete evaluated workspace frame is required.');
  }
  await Promise.all([logo.decode(), document.fonts.ready]);
  if (disposed || ticket !== drawing) throw failure('SUPERSEDED', 'A newer presentation replaced this frame.');
  sizeRenderer();
  const applied = adapter.apply(frame.snapshot.scene);
  if (!applied.valid) throw Object.assign(new Error(applied.diagnostics[0].message), applied.diagnostics[0]);
  // A timeline always uses an authored camera, including when an earlier seek
  // happened to leave the same Three camera active. Never inherit orbit input.
  const camera = frame.cameraId ?? frame.snapshot.scene.nodes.find(item => item.kind === 'camera')?.id;
  if (!camera || !adapter.setCamera(camera)) throw failure('MISSING_CAMERA', 'The timeline camera is unavailable.');
  renderLabels(frame); $('stage-error').hidden = true;
  adapter.render();
  if (capture) canvas.getContext('webgl2').finish();
  await raf(); await raf();
  if (disposed || ticket !== drawing) throw failure('SUPERSEDED', 'A newer presentation replaced this frame.');
  if (graphicsError) throw graphicsError;
  currentFrame = frame;
  const pixelRatio = canvas.width / canvas.clientWidth, stage = $('stage').getBoundingClientRect();
  lastReceipt = { ready: true, presentationTime: frame.presentationTime, physicalTime: frame.physicalTime, identity: frame.identity,
    configurationHash: frame.configuration.graphHash, renderer: { ...graphics, pixelRatio, glWidth: canvas.width, glHeight: canvas.height },
    width: Math.round(stage.width * pixelRatio), height: Math.round(stage.height * pixelRatio) };
  $('stage').dataset.ready = 'true'; $('scrub').value = String(frame.presentationTime); $('exact-time').value = String(frame.presentationTime);
  $('status').textContent = playing ? 'Playing samples' : 'Frame ready'; $('reload').hidden = true;
  return structuredClone(lastReceipt);
}
async function request(path, options) {
  const response = await fetch(path, options), data = await response.json();
  if (!response.ok || !data.ok) throw Object.assign(new Error(data.error?.message ?? 'Timeline request failed.'), data.error);
  return data.result;
}
function pause() {
  playing = false; playClock = null; clearTimeout(playTimer); $('play').textContent = 'Play'; $('play').setAttribute('aria-label', 'Play timeline');
}
function invalidate() { ++sequence; ++drawing; clearTimeout(scrubTimer); }
async function seek(time, fromPlayback = false) {
  if (capture || !metadata || !Number.isFinite(time) || time < 0 || time > metadata.duration) throw failure('SEEK_TIME', 'Choose a presentation time inside this timeline.');
  if (!fromPlayback) pause();
  invalidate(); const ticket = sequence, snapshotId = metadata.snapshotId;
  $('status').textContent = `Preparing ${seconds(time)} s…`; $('stage').dataset.ready = 'false';
  // An aborted browser fetch cannot recall a host worker already evaluating
  // it. Keep one read in flight and skip old seeks before sending the next.
  const read = networkRead.then(async () => {
    if (ticket !== sequence || disposed) throw failure('SUPERSEDED', 'A newer seek is current.');
    pending = new AbortController();
    try {
      return await request(timelineApi + '/frame', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time, snapshotId }), signal: pending.signal });
    } finally { pending = null; }
  });
  networkRead = read.catch(() => {});
  try {
    const frame = await read;
    if (ticket !== sequence || disposed) throw failure('SUPERSEDED', 'A newer seek is current.');
    if (frame.presentationTime !== time) throw failure('STALE_FRAME', 'The companion returned a different presentation time.');
    return await present(frame);
  } catch (error) {
    if (ticket === sequence && !disposed && error.name !== 'AbortError') { pause(); showError(error); }
    throw error;
  }
}
function seekFromControls(time) { void seek(time).catch(() => {}); }
async function load() {
  pause(); invalidate(); const ticket = sequence;
  for (const id of ['play', 'previous', 'next', 'scrub', 'exact-time', 'go']) $(id).disabled = true;
  try {
    const result = await request(timelineApi);
    if (disposed || ticket !== sequence) return;
    metadata = result;
    $('scrub').max = String(result.duration); $('exact-time').max = String(result.duration); $('duration').textContent = `${seconds(result.duration)} s`;
    await seek(0);
    for (const id of ['play', 'previous', 'next', 'scrub', 'exact-time', 'go']) $(id).disabled = false;
  } catch (error) { if (!disposed && error.code !== 'SUPERSEDED' && error.name !== 'AbortError') showError(error); }
}
async function advance(clock) {
  if (clock !== playClock || disposed) return;
  const started = performance.now(), current = currentFrame.presentationTime;
  const intended = Math.min(metadata.duration, clock.from + (started - clock.started) / 1000);
  // Slow frames can skip display samples. Never skip the first showing of
  // an authored configuration boundary, even if several boundaries are due.
  const boundary = metadata.boundaryTimes?.find(at => at > current && at <= intended);
  const next = boundary ?? intended;
  if (next > current) {
    try { await seek(next, true); } catch { return; }
  }
  if (clock !== playClock) return;
  if (next === metadata.duration) { pause(); $('status').textContent = 'End of timeline'; }
  else playTimer = setTimeout(() => advance(clock), Math.max(0, previewPeriod - (performance.now() - started)));
}
async function startPlayback() {
  invalidate();
  playing = true; $('play').textContent = 'Pause'; $('play').setAttribute('aria-label', 'Pause timeline');
  const clock = {}; playClock = clock;
  if (currentFrame.presentationTime >= metadata.duration) {
    try { await seek(0, true); } catch { return; }
  }
  if (playClock !== clock) return;
  clock.from = currentFrame.presentationTime; clock.started = performance.now();
  playTimer = setTimeout(() => advance(clock), previewPeriod);
}
$('play').addEventListener('click', () => {
  if (playing) { pause(); invalidate(); $('status').textContent = 'Paused'; }
  else void startPlayback();
});
$('previous').addEventListener('click', () => seekFromControls(Math.max(0, currentFrame.presentationTime - 0.25)));
$('next').addEventListener('click', () => seekFromControls(Math.min(metadata.duration, currentFrame.presentationTime + 0.25)));
$('scrub').addEventListener('input', event => {
  pause(); invalidate(); const time = Number(event.target.value); $('exact-time').value = String(time);
  $('status').textContent = `Seeking ${seconds(time)} s…`; scrubTimer = setTimeout(() => seekFromControls(time), 80);
});
$('seek-form').addEventListener('submit', event => { event.preventDefault(); seekFromControls($('exact-time').valueAsNumber); });
$('reload').addEventListener('click', load);
window.addEventListener('pagehide', () => { disposed = true; pause(); invalidate(); pending?.abort(); resize.disconnect(); adapter?.dispose(); });
globalThis.cosmicTimeline = Object.freeze({ present, seek: time => seek(time), get frame() { return structuredClone(currentFrame); },
  get receipt() { return structuredClone(lastReceipt); }, get capture() { return capture; } });
if (!capture && !graphicsError) void load();
