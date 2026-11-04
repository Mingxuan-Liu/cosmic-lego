import { plotRows, seriesPaths, plotFraction } from '/src/workspace/plot-samples.js';
import { createThreeAdapter } from '/src/scene/three-adapter.js';
import { createOverlayManager } from '/src/workspace/browser.js';
import { createConversation, createAgentClient } from '/src/workspace/session.js';
import { createProjectFiles, setProjectTime } from '/src/workspace/project-files.js';

const $ = id => document.getElementById(id), canvas = $('scene');
const element = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const button = (text, action) => { const node = element('button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
const number = value => value == null ? 'Missing' : Number(value).toLocaleString('en-US', { maximumSignificantDigits: 5 });
let state, snapshot, results = [], selection = null, queued = Promise.resolve(), sequence = 0, sceneOnly = false, disposed = false;
let playing = false, playSession = 0, timer, scrubTimer, drawRequest, syncingSelection = false, initial;
let pendingEdits = 0, polling = false, lastSummary = '', activeRefreshes = 0, refreshNeeded = true;
let retryAt = 0, supersessions = 0;
const sameIdentity = (a, b) => a && b && ['projectId', 'generation', 'revision'].every(key => a[key] === b[key]);
const sameLoad = (a, b) => a && b && a.projectId === b.projectId && a.generation === b.generation;
const summaryText = summary => typeof summary === 'string' ? summary : ['created', 'updated', 'removed']
  .filter(key => summary?.[key]?.length).map(key => `${key[0].toUpperCase() + key.slice(1)} ${summary[key].length === 1 ? summary[key][0] : `${summary[key].length} objects`}`).join(' · ');
const composers = new Map();
const viewId = crypto.randomUUID();
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const showError = error => { $('diagnostics').hidden = false; $('diagnostics').textContent = `${error.code ?? 'Workspace'}: ${error.message}`; $('status').textContent = 'Needs attention'; };
function requestDraw() {
  if (disposed || drawRequest) return;
  drawRequest = requestAnimationFrame(() => { drawRequest = null; if (!disposed) adapter.render(); });
}
let adapter;
try { adapter = createThreeAdapter({ canvas, onSelect: picked => { if (!syncingSelection) select(picked, false); }, onDiagnostic: showError, onCameraChange: requestDraw, fitShortAxis: true, reducedMotion: motion.matches }); }
catch (error) { showError(error); throw error; }
let agentClient;
const conversation = createConversation({ onEvent: event => {
  window.dispatchEvent(new CustomEvent('cosmic:conversation', { detail: event })); agentClient?.handle(event);
} });
agentClient = createAgentClient({ conversation });
let agentState = agentClient.snapshot();
// A native range control can round a saved double when it serializes its value.
let physicalTime = 0;
const getTime = () => ({ value: physicalTime, unit: 's' });
const projectFiles = createProjectFiles({ getIdentity: () => state?.identity, getTime: () => snapshot?.time ?? getTime(), enqueue: enqueueProject,
  onLoad: async opened => {
    adoptState(await api('state')); await refresh();
    if (!sameLoad(opened.identity, state.identity)) throw new Error('Another project opened before the workspace refreshed.');
  } });
const narrow = matchMedia('(max-width: 760px)');
const wideRails = { left: true, right: true }, narrowRails = { left: false, right: false };
const sideFor = kind => kind === 'plot' ? 'left' : 'right';
function railState() { return narrow.matches ? narrowRails : wideRails; }
function syncRails() {
  for (const side of ['left', 'right']) {
    const open = railState()[side];
    $('stage').dataset[side + 'Open'] = String(open);
    $(side + '-rail').hidden = !open || sceneOnly;
    const toggle = $(side + '-rail-toggle');
    toggle.setAttribute('aria-expanded', String(open && !sceneOnly));
  }
}
function setRail(side, open) {
  railState()[side] = open;
  if (open && narrow.matches) railState()[side === 'left' ? 'right' : 'left'] = false;
  syncRails(); updateContent();
}
narrow.addEventListener('change', () => { syncRails(); updateContent(); });
for (const side of ['left', 'right']) $(side + '-rail-toggle').addEventListener('click', () => setRail(side, !railState()[side]));
syncRails();
const manager = createOverlayManager({ container: $('overlays'), rails: { left: $('left-panels'), right: $('right-panels') },
  revealRail: kind => { const side = sideFor(kind); if (!railState()[side]) setRail(side, true); },
  onChange: (id, parameters) => edit({ action: 'overlay.update', id, parameters }),
  onRemove: id => edit({ action: 'overlay.remove', id }).catch(showError), onError: showError,
});
const resize = () => {
  if (disposed || !canvas.clientWidth || !canvas.clientHeight) return;
  adapter.resize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio); requestDraw();
};
const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
motion.addEventListener('change', event => adapter.setReducedMotion(event.matches));
async function api(path, input) {
  const response = await fetch(`/api/workspace/${path}`, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', ...(path === 'evaluate' ? { 'X-Workspace-View': viewId } : {}) }, body: JSON.stringify(input) });
  const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.message), result); return result;
}
function context() {
  conversation.context({ identity: state?.identity ?? snapshot?.identity, time: snapshot?.time ?? null, selection: structuredClone(selection),
    viewIds: (snapshot?.overlays ?? []).filter(view => !view.hidden).slice(0, 16).map(view => view.id),
  });
}
function select(next, updateRenderer = true) {
  const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_SELECTION' }); };
  if (next && !state?.graph.nodes.some(node => node.id === next.nodeId)) invalid('Select an existing component ID.');
  if (next?.objectId && !snapshot?.scene.nodes.some(node => node.id === next.nodeId)) {
    const value = results.find(result => result.producer.nodeId === next.nodeId && (!next.port || result.producer.port === next.port))?.value;
    const sample = typeof next.objectId === 'string' && next.objectId.startsWith(`${next.nodeId}:sample:`) ? Number(next.objectId.slice(`${next.nodeId}:sample:`.length)) : -1;
    if (!value?.objectIds?.includes(next.objectId) && !(['field', 'series'].includes(value?.kind) && Number.isInteger(sample) && sample >= 0 && sample < value.data.length)) invalid('Select an existing source sample ID.');
  }
  if (updateRenderer) {
    syncingSelection = true;
    const renderable = next && snapshot?.scene.nodes.some(node => node.id === next.nodeId);
    const accepted = adapter.select(renderable ? next : null);
    syncingSelection = false;
    if (renderable && !accepted) next = null; else if (accepted) next = accepted;
  }
  selection = next ? structuredClone(next) : null;
  context(); updateContent(); requestDraw();
  window.dispatchEvent(new CustomEvent('cosmic:selection', { detail: { selection: structuredClone(selection), identity: snapshot?.identity, time: snapshot?.time } }));
  return structuredClone(selection);
}
function stopPlayback() { ++playSession; playing = false; clearTimeout(timer); $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play physical time'); if (snapshot?.valid && !refreshNeeded) readyStatus(); }
function listenToAgent() {
  agentClient.subscribe(next => { agentState = next; const session = conversation.snapshot(); for (const id of composers.keys()) updateComposer(id, session); });
  agentClient.start();
}
function adoptState(next) {
  const previous = state?.identity;
  state = next;
  const switched = previous && !sameLoad(previous, next.identity);
  if (!previous || switched) {
    physicalTime = next.portable?.playback?.time?.value ?? 0;
    setProjectTime($('time'), physicalTime, next.portable?.timeRange);
    $('workspace-title').textContent = next.graph.title;
    projectFiles.observe(next.portable, { reset: true });
  } else projectFiles.observe(next.portable);
  if (!switched) return;
  stopPlayback(); clearTimeout(scrubTimer); ++sequence;
  selection = null; snapshot = null; results = []; lastSummary = '';
  canvas.style.visibility = 'hidden'; manager.render([]); composers.clear();
  $('view-list').replaceChildren(); $('plot-source').replaceChildren();
  syncingSelection = true;
  try { adapter.select(null); } finally { syncingSelection = false; }
  agentClient.dispose();
  for (const id of Object.keys(conversation.snapshot().drafts)) conversation.forgetDraft(id);
  conversation.context({ identity: next.identity, time: getTime(), selection: null, viewIds: [] });
  conversation.synchronize({ status: 'disconnected', label: 'No agent connected', messages: [] });
  agentClient = createAgentClient({ conversation }); listenToAgent();
  if (sceneOnly) setSceneOnly(false); else if ($('project-menu').hidden) closeMenus();
  syncControls();
}
function enqueueProject(work) {
  const origin = state?.identity;
  pendingEdits++;
  const run = async () => {
    await initial;
    if (disposed || origin && !sameLoad(origin, state.identity)) throw new Error('The workspace changed before this project action started.');
    return work();
  };
  const result = queued.then(run, run).finally(() => { pendingEdits--; }); queued = result.catch(() => {}); return result;
}
function syncControls() {
  const camera = state?.graph.nodes.find(node => node.type === 'scene.camera');
  if (camera) $('projection').value = camera.data.parameters.projection;
  $('undo').disabled = !state?.history?.canUndo; $('redo').disabled = !state?.history?.canRedo;
}
function readyStatus() {
  $('status').textContent = playing ? 'Playing' : lastSummary ? `${lastSummary} · ready` : `${snapshot.overlays.length} views · ready`;
}
async function refresh({ retry = false } = {}) {
  if (!state || disposed) return;
  if (!retry) { retryAt = 0; supersessions = 0; }
  activeRefreshes++; refreshNeeded = true;
  const mine = ++sequence, time = getTime();
  if (snapshot && !sameIdentity(snapshot.identity, state.identity)) $('status').textContent = 'Applying edit…';
  const slow = setTimeout(() => {
    if (mine === sequence && !disposed) $('status').textContent = snapshot ? 'Updating sample…' : 'Loading scene…';
  }, 450);
  try {
    const computed = await api('evaluate', { identity: state.identity, time, capabilities: adapter.capabilities });
    if (disposed || mine !== sequence) return;
    if (!computed.snapshot.valid) throw computed.snapshot.diagnostics.find(issue => issue.severity !== 'warning') ?? new Error('Workspace evaluation failed.');
    const priorSelection = selection;
    syncingSelection = true;
    const applied = adapter.apply(computed.snapshot.scene);
    syncingSelection = false;
    if (!applied.valid) throw applied.diagnostics[0];
    const changed = !sameIdentity(snapshot?.identity, computed.snapshot.identity);
    snapshot = computed.snapshot; results = computed.results;
    const exact = snapshot.time.value;
    $('time-output').textContent = Math.abs(exact) >= 1e9 ? exact.toExponential(3) + ' s' : exact.toFixed(2) + ' s';
    $('time-output').title = `${exact} s`; projectFiles.render();
    canvas.style.visibility = '';
    refreshNeeded = false; retryAt = 0; supersessions = 0;
    if (changed) {
      manager.render(snapshot.overlays);
      for (const id of composers.keys()) if (!snapshot.overlays.some(view => view.id === id)) { composers.delete(id); conversation.forgetDraft(id); }
      syncControls(); renderMenu();
    }
    try { select(priorSelection && state.graph.nodes.some(node => node.id === priorSelection.nodeId) ? priorSelection : null); }
    catch (error) { if (error.code === 'INVALID_SELECTION') select(null); else throw error; }
    $('diagnostics').hidden = true; readyStatus();
  } catch (error) {
    syncingSelection = false;
    if (!disposed && mine === sequence) {
      if (['STALE_TOKEN', 'STALE_RESULT', 'SUPERSEDED', 'VIEW_BUSY'].includes(error.code)) {
        stopPlayback();
        // Let the competing view finish before retrying this read.
        retryAt = Date.now() + Math.min(16000, 1000 * 2 ** Math.min(supersessions++, 4) + Math.random() * 500);
        $('status').textContent = 'Waiting for current sample…';
      }
      else { stopPlayback(); refreshNeeded = false; showError(error); }
    }
  } finally { clearTimeout(slow); activeRefreshes--; }
}
function edit(operation) {
  stopPlayback();
  const origin = state?.identity;
  pendingEdits++;
  const run = async () => {
    await initial; if (disposed) return;
    ++sequence;
    try {
      if (origin && !sameLoad(origin, state.identity)) throw new Error('This edit belongs to the previously open project.');
      let result;
      try { result = await api('edit', { ...operation, identity: state.identity, idempotencyKey: crypto.randomUUID() }); }
      catch (error) {
        if (error.code !== 'STALE_TOKEN') throw error;
        // A stale rejection had no accepted effect. Rebasing is a new request
        // with a new key; ambiguous network failures are not retried here.
        const before = state.identity;
        adoptState(await api('state'));
        if (!sameLoad(before, state.identity)) { await refresh(); throw new Error('The project changed. The previous edit was not applied.'); }
        result = await api('edit', { ...operation, identity: state.identity, idempotencyKey: crypto.randomUUID() });
      }
      if (disposed) return;
      state = { ...state, ...result }; lastSummary = summaryText(result.summary);
      await Promise.all([refresh(), projectFiles.refreshStatus()]); return result;
    } catch (error) { syncControls(); showError(error); throw error; }
  };
  const result = queued.then(run, run).finally(() => { pendingEdits--; }); queued = result.catch(() => {}); return result;
}

async function pollChanges() {
  if (disposed || !state || pendingEdits || activeRefreshes || polling) return;
  polling = true;
  try {
    const observed = await projectFiles.refreshStatus();
    const current = () => sameIdentity(observed.identity, state.identity) && sameIdentity(snapshot?.identity, state.identity) && !refreshNeeded;
    if (disposed || pendingEdits || activeRefreshes || current()) return;
    if (sameIdentity(observed.identity, state.identity) && Date.now() < retryAt) return;
    const synchronize = async () => {
      if (disposed || pendingEdits || activeRefreshes || current()) return;
      stopPlayback(); ++sequence;
      if (!sameIdentity(observed.identity, state.identity)) {
        adoptState(await api('state'));
        lastSummary = summaryText(state.lastChange?.summary) || 'Project changed';
      }
      await refresh({ retry: true });
    };
    const synchronized = queued.then(synchronize, synchronize); queued = synchronized.catch(() => {}); await synchronized;
  } catch (error) { if (!disposed) showError(error); }
  finally { polling = false; }
}
const changeTimer = setInterval(pollChanges, 1000);
function preserveFocus(body, render) {
  const active = body.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
  const scroll = body.scrollTop, expanded = new Set([...body.querySelectorAll('details[open][data-detail]')].map(node => node.dataset.detail));
  render();
  for (const node of body.querySelectorAll('details[data-detail]')) node.open = expanded.has(node.dataset.detail);
  body.scrollTop = scroll;
  if (active) [...body.querySelectorAll('[data-focus]')].find(node => node.dataset.focus === active)?.focus({ preventScroll: true });
}
function updateContent() {
  if (sceneOnly) return;
  for (const view of snapshot?.overlays ?? []) {
    if (view.hidden || view.folded || !railState()[sideFor(view.kind)]) continue;
    const body = manager.body(view.id); if (!body) continue;
    if (view.kind === 'conversation') { if (!composers.has(view.id)) buildComposer(view, body); updateComposer(view.id, conversation.snapshot()); }
    else preserveFocus(body, () => {
      if (view.kind === 'plot') renderPlot(view, body);
      else if (view.kind === 'inspector') renderInspector(body);
      else if (view.kind === 'provenance') renderProvenance(body);
      else body.replaceChildren(element('p', `Unsupported view capability: ${view.kind}`, 'muted'));
    });
  }
}
function detail(list, name, value) { list.append(element('dt', name), element('dd', value)); }
function renderInspector(body) {
  const choice = element('select', null, 'inspect-select'); choice.setAttribute('aria-label', 'Selected component'); choice.dataset.focus = 'component';
  choice.append(new Option('Select a component…', ''));
  for (const node of snapshot.scene.nodes.filter(node => !['camera', 'group'].includes(node.kind) && !node.id.startsWith('grid-'))) choice.append(new Option(node.id, node.id));
  for (const output of Object.keys(state.outputs ?? {})) if (!snapshot.scene.nodes.some(node => node.id === output)) choice.append(new Option(output, output));
  choice.value = selection?.nodeId ?? '';
  choice.addEventListener('change', () => select(choice.value ? { nodeId: choice.value } : null));
  const selected = state.graph.nodes.find(node => node.id === selection?.nodeId);
  body.replaceChildren(element('p', 'Linked selection', 'eyebrow'), choice);
  if (!selected) { body.append(element('p', 'Choose a point in the scene or a sample in a linked plot. Its identity, quantity and current values appear here.', 'muted')); return; }
  const list = element('dl', null, 'detail-list');
  detail(list, 'Component', selected.id); detail(list, 'Source ID', selection.objectId ?? 'Whole component');
  detail(list, 'Time', `${number(snapshot.time.value)} ${snapshot.time.unit.symbol}`);
  body.append(list);
  const bindings = snapshot.scene.bindings.filter(binding => binding.target === selected.id);
  const sources = bindings.map(binding => ({ id: binding.source.nodeId, port: binding.source.port, binding }));
  for (const result of results.filter(result => result.producer.nodeId === selected.id && (!selection.port || selection.port === result.producer.port))) sources.push({ id: selected.id, port: result.producer.port });
  for (const source of sources) {
    const result = results.find(result => result.producer.nodeId === source.id && result.producer.port === source.port);
    if (!result) continue;
    const value = result.value, section = element('section', null, 'binding-detail');
    section.append(element('strong', `${value.meaning} · ${value.unit.symbol}`));
    const meta = element('dl', null, 'detail-list'); detail(meta, 'Produced by', `${source.id}.${source.port}`);
    detail(meta, 'Frame', value.frame?.id ?? value.coordinates?.frame?.id ?? 'Scalar');
    if (source.binding) detail(meta, 'Display', `×${source.binding.mapping.scale}; ${source.binding.mapping.displayFrame}`);
    section.append(meta);
    let data = value.data;
    if (selection.objectId && Array.isArray(data)) {
      const index = value.objectIds?.indexOf(selection.objectId) ?? (selection.objectId.startsWith(`${source.id}:sample:`) ? Number(selection.objectId.split(':').at(-1)) : -1);
      if (index >= 0 && index < data.length) data = data[index];
    }
    if (Array.isArray(data) && Array.isArray(data[0])) section.append(element('p', `${data.length} samples. Select an individual point to inspect its values.`, 'muted'));
    else for (const item of (Array.isArray(data) ? data.slice(0, 6) : [data])) section.append(element('span', `${number(item)} ${value.unit.symbol}`, 'value-chip'));
    if (value.metadata?.warnings?.length) section.append(element('p', JSON.stringify(value.metadata.warnings), 'muted'));
    body.append(section);
  }
}
function renderPlot(view, body) {
  const rows = plotRows(view), value = view.data, source = view.source;
  const container = element('div', null, 'plot-container');
  if (!value) { body.replaceChildren(element('p', 'No current scientific result.', 'muted')); return; }
  const values = rows.map(row => row.y).filter(item => item !== null && Number.isFinite(item));
  const meta = element('div', null, 'plot-meta'); meta.append(element('strong', `${value.meaning} / ${value.unit.symbol}`), element('span', `t = ${number(snapshot.time.value)} ${snapshot.time.unit.symbol}`)); container.append(meta);
  if (value.kind === 'scalar') {
    const amount = value.data == null ? 'Missing' : String(Number(value.data.toPrecision(8)));
    const readout = element('button', value.unit.symbol === '1' ? amount : amount + ' ' + value.unit.symbol, 'scalar-readout');
    readout.title = 'Inspect ' + source.nodeId + '.' + source.port;
    readout.addEventListener('click', () => select({ nodeId: source.nodeId, port: source.port }));
    container.append(readout, element('p', source.nodeId + '.' + source.port, 'plot-source'));
    body.replaceChildren(container); return;
  }
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 350 155'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `${view.title}: ${rows.length} current samples in ${value.unit.symbol}`);
  const shape = (tag, attributes, text) => { const node = document.createElementNS(ns, tag); for (const [key, val] of Object.entries(attributes)) node.setAttribute(key, val); if (text != null) node.textContent = text; svg.append(node); return node; };
  let low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1;
  if (low === high) { low -= Math.max(Math.abs(low) * 0.1, 0.5); high += Math.max(Math.abs(high) * 0.1, 0.5); }
  const pad = (high - low) * 0.12; low -= pad; high += pad;
  if (![low, high, high - low].every(Number.isFinite)) {
    container.append(element('p', 'PLOT_RANGE: these values exceed the finite display range. Choose an explicit scientific unit conversion before plotting.', 'conversation-error'), element('p', `${source.nodeId}.${source.port}`, 'plot-source'));
    body.replaceChildren(container); return;
  }
  const coordinates = rows.map(row => row.x);
  const xmax = coordinates.length ? Math.max(...coordinates) : 0, xmin = coordinates.length ? Math.min(...coordinates) : 0;
  const px = x => 64 + plotFraction(x, xmin, xmax) * 267, py = y => 120 - (y - low) / (high - low) * 102;
  for (let i = 0; i <= 3; i++) {
    const y = 18 + i * 34;
    shape('line', { x1: 61, x2: 334, y1: y, y2: y, stroke: '#464642', 'stroke-width': 0.7 });
    shape('text', { x: 55, y: y + 3, fill: '#b5b5af', 'font-size': 10, 'text-anchor': 'end' }, number(high - i / 3 * (high - low)));
  }
  const bound = snapshot.scene.bindings.find(binding => binding.source.nodeId === source.nodeId && binding.source.port === source.port);
  if (value.kind === 'series') {
    const at = snapshot.time.value * (snapshot.time.unit.scale ?? 1) / value.coordinates.unit.scale;
    if (at >= xmin && at <= xmax) shape('line', { x1: px(at), x2: px(at), y1: 18, y2: 120, stroke: '#f2c063', 'stroke-dasharray': '3 3' });
  }
  if (value.kind === 'series') for (const [channel, d] of seriesPaths(rows, px, py)) {
    shape('path', { d, fill: 'none', stroke: ['#7dd1c2', '#f2c063', '#b7a2ed'][channel], 'stroke-width': 1.5 });
  }
  rows.forEach((row, index) => {
    if (row.y === null || !Number.isFinite(row.y)) return;
    const selected = row.objectId && selection?.objectId === row.objectId && (!bound || selection.nodeId === bound.target);
    const dot = shape('circle', { cx: px(row.x), cy: py(row.y), r: selected ? 5 : value.kind === 'series' ? 2 : 3.5, fill: selected ? '#f2c063' : ['#7dd1c2', '#f2c063', '#b7a2ed'][row.series ?? 0], stroke: selected ? '#fff0cb' : '#a7ddd4', 'stroke-width': selected ? 1.5 : 0.5,
      tabindex: 0, role: 'button', 'aria-label': `${row.objectId ?? row.label}: ${number(row.y)} ${value.unit.symbol}`, 'data-focus': `sample-${index}`, 'data-object-id': row.objectId ?? '' });
    const choose = () => select(bound && row.objectId ? { nodeId: bound.target, objectId: row.objectId } : { nodeId: source.nodeId, port: source.port, ...(row.objectId ? { objectId: row.objectId } : {}) });
    dot.addEventListener('click', choose); dot.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); choose(); } });
    if (value.kind !== 'series' && (view.component !== -1 || row.series == null || row.series === 0) && (rows.length <= 8 || index % Math.ceil(rows.length / 4) === 0)) shape('text', { x: px(row.x), y: 137, fill: '#b5b5af', 'font-size': 10, 'text-anchor': 'middle' }, row.label);
  });
  if (value.kind === 'series' && coordinates.length) {
    const ticks = xmin === xmax ? [xmin] : [xmin, xmin / 2 + xmax / 2, xmax];
    for (const x of ticks) shape('text', { x: px(x), y: 137, fill: '#b5b5af', 'text-anchor': x === xmax ? 'end' : x === xmin ? 'start' : 'middle' }, number(x));
  }
  shape('text', { x: 190, y: 153, fill: '#b5b5af', 'font-size': 10, 'text-anchor': 'middle' }, value.kind === 'series' ? 'Physical time / ' + value.coordinates.unit.symbol : value.kind === 'vector' ? 'Vector component' : value.kind === 'scalar' ? 'Derived value' : 'Sample index (source IDs retained)');
  container.append(svg, element('p', `${source.nodeId}.${source.port}${view.component >= 0 && value.shape.at(-1) === 3 ? ` · component ${['X', 'Y', 'Z'][view.component]}` : ''}`, 'plot-source'));
  if (view.component === -1 && value.shape.length === 2) container.append(element('p', 'X: teal · Y: gold · Z: violet', 'plot-source'));
  const missing = rows.filter(row => row.y === null).length;
  if (missing) container.append(element('p', `${missing} missing sample components are not drawn.`, 'plot-source'));
  container.append(element('p', selection ? `Selected: ${selection.objectId ?? selection.nodeId}` : 'Select a sample to inspect its component.', 'plot-selection'));
  body.replaceChildren(container);
}
function renderProvenance(body) {
  body.replaceChildren(element('p', 'Sources & assumptions', 'eyebrow'), element('p', 'Installed model assumptions and scientific bindings appear below. The presentation camera is independent of the physical coordinates.', 'muted'));
  const list = element('dl', null, 'detail-list'); detail(list, 'Physical time', `${number(snapshot.time.value)} ${snapshot.time.unit.symbol}`); detail(list, 'Scene', `${snapshot.scene.nodes.length} nodes · ${snapshot.scene.assets.length} assets`); body.append(list);
  const usedTypes = new Set(state.graph.nodes.map(node => node.type));
  for (const { manifest } of state.discovery?.extensions ?? []) {
    if (!usedTypes.has(manifest.id) || !manifest.science) continue;
    const section = element('details', null, 'asset-row'); section.dataset.detail = manifest.id;
    section.append(element('summary', `${manifest.id} · ${manifest.science.review.status}`));
    section.append(element('p', manifest.documentation.summary), element('p', manifest.science.assumptions.join(' ')), element('p', `${manifest.science.review.notes}\nImplementation ${manifest.implementation.id} ${manifest.implementation.version}`)); body.append(section);
  }
  for (const item of snapshot.scene.bindings) {
    const section = element('details', null, 'asset-row'); section.dataset.detail = item.id; section.append(element('summary', `${item.source.meaning} · ${item.source.unit.symbol}`));
    section.append(element('p', `Source: ${item.source.nodeId}.${item.source.port}\nFrame: ${item.source.frame?.id ?? item.source.coordinates?.frame?.id ?? 'scalar'} → ${item.mapping.displayFrame}\nDisplay scale: ×${item.mapping.scale}${item.colorMeaning ? `\nColor: ${item.colorMeaning.range.join(' – ')} ${item.colorMeaning.unit.symbol}; ${item.colorMeaning.palette}` : ''}`)); body.append(section);
  }
  for (const asset of snapshot.scene.assets) {
    const section = element('details', null, 'asset-row'); section.dataset.detail = asset.id; section.append(element('summary', asset.id)); section.append(element('p', `${asset.provenance.source}\nLicense: ${asset.provenance.license}\n${asset.contentId}`)); body.append(section);
  }
}
function buildComposer(view, body) {
  const root = element('div', null, 'conversation'), connection = element('div', null, 'connection');
  const controls = element('div', null, 'agent-controls'), agentSelect = element('select'); agentSelect.setAttribute('aria-label', 'Agent');
  const connect = button('Connect', () => agentClient.connect(agentSelect.value, policy.value).catch(() => {}));
  const disconnect = button('Disconnect', () => agentClient.disconnect().catch(() => {}));
  const chooser = element('div', null, 'agent-chooser'); chooser.append(agentSelect, connect, disconnect);
  const settings = element('details', null, 'agent-settings'), policy = element('select'); policy.setAttribute('aria-label', 'Native runtime permissions');
  policy.append(new Option('Deny native permissions', 'deny'), new Option('Ask for native permissions', 'ask'));
  const permissionHelp = element('p', 'Checked scene edits apply with Undo. Native requests follow this policy; only choices supported by the adapter are offered.', 'agent-help');
  settings.append(element('summary', 'Connection settings'), policy, permissionHelp);
  const notice = element('p', null, 'agent-notice'); controls.append(chooser, settings, notice);
  const transcript = element('div', null, 'transcript'); transcript.setAttribute('role', 'log'); transcript.setAttribute('aria-live', 'polite');
  const progress = element('div', null, 'conversation-progress'), error = element('div', null, 'conversation-error'); error.setAttribute('role', 'alert');
  const requests = element('div', null, 'agent-requests');
  const tools = element('div', null, 'agent-tools');
  const context = element('div', null, 'composer-context'), textarea = element('textarea'); textarea.rows = 3; textarea.maxLength = 12000; textarea.setAttribute('aria-label', `Message draft for ${view.title}`); textarea.placeholder = 'Ask about this selection…';
  textarea.addEventListener('input', () => conversation.draft(view.id, textarea.value));
  textarea.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); conversation.submit(view.id); } });
  const actions = element('div', null, 'composer-actions'), hint = element('small', 'Draft stays with this view');
  const send = button('Send', () => conversation.submit(view.id)), stop = button('Stop', () => conversation.cancel());
  actions.append(hint, stop, send); root.append(connection, controls, transcript, progress, tools, requests, error, context, textarea, actions); body.replaceChildren(root);
  composers.set(view.id, { connection, controls, settings, agentSelect, connect, disconnect, policy, permissionHelp, notice, requests, tools, transcript, progress, error, context, textarea, send, stop, messageKey: '', agentKey: '', requestKey: '', toolKey: '', attached: false });
}
function renderAgentRequests(ui, requests) {
  const key = JSON.stringify(requests); if (key === ui.requestKey) return;
  ui.requestKey = key; ui.requests.replaceChildren();
  for (const request of requests.slice(0, 16)) {
    const card = element('section', null, 'agent-request'); card.setAttribute('aria-label', request.kind === 'permission' ? 'Runtime permission request' : 'Agent input request');
    card.append(element('strong', request.kind === 'permission' ? 'Runtime permission' : 'Agent question'), element('p', request.message ?? 'The agent needs your input.'));
    const actions = element('div', null, 'request-actions');
    const reply = async answer => {
      for (const control of card.querySelectorAll('button,input,select,textarea')) control.disabled = true;
      try { await agentClient.reply(request.requestId, answer); }
      catch { for (const control of card.querySelectorAll('button,input,select,textarea')) control.disabled = false; }
    };
    if (request.kind === 'permission') {
      for (const option of request.options ?? [{ id: 'deny', label: 'Deny' }]) {
        if (['deny', 'allow'].includes(option.id)) actions.append(button(option.label, () => reply({ decision: option.id })));
      }
    } else if (request.kind === 'input') {
      const fields = [];
      for (const question of (request.questions ?? []).slice(0, 8)) {
        const label = element('label', question.question ?? question.message ?? question.header ?? question.id);
        if (question.isSecret) { card.append(label, element('p', 'Complete authentication in the runtime’s supported login flow. Credentials are not collected here.', 'agent-help')); continue; }
        let input;
        if (question.options?.length) {
          input = element('select'); input.append(new Option('Choose an answer…', ''));
          for (const option of question.options) input.append(new Option(option.label, option.label));
          if (question.isOther) input.append(new Option('Other…', '__other'));
        } else { input = element('input'); input.type = 'text'; input.maxLength = 2000; }
        input.setAttribute('aria-label', question.header ?? question.question ?? question.id); label.append(input); card.append(label);
        if (question.options?.length && question.isOther) {
          const other = element('input'); other.type = 'text'; other.maxLength = 2000; other.hidden = true; other.setAttribute('aria-label', `Other answer for ${question.header ?? question.id}`);
          input.addEventListener('change', () => { other.hidden = input.value !== '__other'; }); label.append(other);
          fields.push({ id: question.id, read: () => input.value === '__other' ? other.value : input.value });
        } else fields.push({ id: question.id, read: () => input.value });
      }
      const answer = button('Reply', () => reply({ answers: Object.fromEntries(fields.map(field => [field.id, [field.read()]])) }));
      answer.disabled = fields.length === 0; actions.append(answer);
    }
    card.append(actions); ui.requests.append(card);
  }
}
function updateComposer(id, session) {
  const ui = composers.get(id); if (!ui) return;
  ui.connection.textContent = agentState.managed ? agentState.label : session.label;
  ui.connection.dataset.connected = String(session.connection === 'connected');
  const agentsKey = JSON.stringify(agentState.agents);
  if (agentsKey !== ui.agentKey) {
    const selected = ui.agentSelect.value; ui.agentKey = agentsKey; ui.agentSelect.replaceChildren();
    for (const agent of agentState.agents) ui.agentSelect.append(new Option(agent.label, agent.id));
    if (agentState.agents.some(agent => agent.id === selected)) ui.agentSelect.value = selected;
  }
  const attached = agentState.managed && !['disconnected', 'failed', 'auth-needed', 'offline'].includes(agentState.status);
  if (attached && !ui.attached) ui.settings.open = false;
  ui.attached = attached;
  ui.controls.hidden = agentState.agents.length === 0 && !agentState.managed;
  ui.agentSelect.disabled = attached || agentState.busy; ui.policy.disabled = attached || agentState.busy;
  if (agentState.agentId && attached) { ui.agentSelect.value = agentState.agentId; ui.policy.value = agentState.permissionPolicy; }
  ui.connect.disabled = !ui.agentSelect.value || attached || agentState.busy;
  ui.disconnect.hidden = !agentState.managed; ui.disconnect.disabled = agentState.status === 'cancelling';
  ui.notice.textContent = agentState.status === 'auth-needed' ? (agentState.error?.message ?? 'Sign in using the configured runtime’s login command, then connect again.')
    : agentState.status === 'offline' ? 'The local agent companion is unavailable. Scene playback remains available.' : '';
  ui.notice.hidden = !ui.notice.textContent;
  ui.permissionHelp.textContent = agentState.capabilities?.permissionGrants === false
    ? 'This adapter cannot grant native access. Ask displays the runtime request with denial only. Checked scene edits still apply with Undo.'
    : 'Checked scene edits apply with Undo. Native requests follow this policy; only choices supported by the adapter are offered.';
  const key = JSON.stringify(session.messages);
  if (key !== ui.messageKey || !ui.transcript.childNodes.length) {
    const follow = ui.transcript.scrollHeight - ui.transcript.clientHeight - ui.transcript.scrollTop < 32;
    ui.messageKey = key; ui.transcript.replaceChildren();
    if (!session.messages.length) ui.transcript.append(element('p', 'Explore the scene or prepare a question below. Your draft stays here when this window is hidden.', 'conversation-empty'));
    for (const message of session.messages) { const box = element('div', null, 'message'); box.append(element('strong', message.role), document.createTextNode(message.text)); ui.transcript.append(box); }
    if (follow) ui.transcript.scrollTop = ui.transcript.scrollHeight;
  }
  ui.context.textContent = `Context: ${selection?.objectId ?? selection?.nodeId ?? 'whole scene'} · t = ${number(snapshot?.time.value ?? 0)} s`;
  if (ui.textarea.value !== (session.drafts[id] ?? '')) ui.textarea.value = session.drafts[id] ?? '';
  ui.progress.textContent = session.progress ? `${session.progress.label}${session.progress.fraction == null ? '' : ` · ${Math.round(session.progress.fraction * 100)}%`}` : '';
  ui.error.textContent = session.error ?? (agentState.managed ? agentState.error?.message : '') ?? '';
  renderAgentRequests(ui, agentState.managed ? agentState.requests ?? [] : []);
  const toolKey = JSON.stringify(agentState.tools ?? []);
  if (toolKey !== ui.toolKey) {
    ui.toolKey = toolKey; ui.tools.replaceChildren();
    for (const tool of (agentState.tools ?? []).slice(-6)) {
      const row = element('details', null, 'agent-tool');
      row.append(element('summary', `${tool.command ?? 'Gateway tool'} · ${tool.phase === 'started' ? 'running' : tool.ok === false ? 'failed' : 'complete'}`));
      if (tool.error) row.append(element('p', `${tool.error.code}: ${tool.error.message}`));
      if (tool.summary) row.append(element('p', summaryText(tool.summary)));
      ui.tools.append(row);
    }
  }
  ui.send.disabled = session.connection !== 'connected' || !!session.activeTurn || !ui.textarea.value.trim() || agentState.managed && (agentState.status !== 'ready' || agentState.busy);
  ui.stop.hidden = !session.activeTurn;
}
conversation.subscribe(session => { for (const id of composers.keys()) updateComposer(id, session); });
function renderMenu() {
  $('view-count').textContent = snapshot.overlays.length;
  $('view-list').replaceChildren();
  for (const view of snapshot.overlays) {
    const row = element('div', null, 'view-row');
    row.append(button(view.title, async () => { setSceneOnly(false); await edit({ action: 'overlay.update', id: view.id, parameters: { hidden: false, folded: false } }).catch(showError); closeMenus(); manager.focus(view.id); }), element('small', view.hidden ? 'hidden' : view.folded ? 'folded' : 'open'));
    const copy = button('Copy', () => edit({ action: 'overlay.duplicate', id: view.id }).catch(showError)); copy.className = 'view-hide'; copy.setAttribute('aria-label', `Duplicate ${view.title}`);
    const hide = button(view.hidden ? 'Show' : 'Hide', () => edit({ action: 'overlay.update', id: view.id, parameters: { hidden: !view.hidden } }).catch(showError)); hide.className = 'view-hide'; row.append(copy, hide); $('view-list').append(row);
  }
  const selected = $('plot-source').value; $('plot-source').replaceChildren();
  for (const [nodeId, ports] of Object.entries(state.outputs ?? {})) for (const [port, descriptor] of Object.entries(ports)) {
    if (['scalar', 'vector', 'collection', 'field', 'series'].includes(descriptor.kind)) $('plot-source').append(new Option(`${nodeId}.${port} · ${descriptor.unit.symbol}`, JSON.stringify({ nodeId, port })));
  }
  if ([...$('plot-source').options].some(option => option.value === selected)) $('plot-source').value = selected;
}
function closeMenus() { for (const id of ['project-menu', 'view-menu', 'help']) $(id).hidden = true; for (const id of ['project-toggle', 'views-toggle', 'help-toggle']) $(id).setAttribute('aria-expanded', 'false'); }
function setSceneOnly(next) { sceneOnly = !!next; closeMenus(); manager.setSceneOnly(sceneOnly); syncRails(); if (!sceneOnly) updateContent(); $('stage').classList.toggle('scene-only', sceneOnly); $('scene-only').setAttribute('aria-pressed', String(sceneOnly)); $('scene-only').textContent = sceneOnly ? 'Restore workspace · V' : 'Scene only · V'; $('scene-only').focus({ preventScroll: true }); }
$('views-toggle').addEventListener('click', () => { const open = $('view-menu').hidden; closeMenus(); $('view-menu').hidden = !open; $('views-toggle').setAttribute('aria-expanded', String(open)); });
$('project-toggle').addEventListener('click', () => {
  const open = $('project-menu').hidden; closeMenus(); $('project-menu').hidden = !open;
  $('project-toggle').setAttribute('aria-expanded', String(open)); if (open) projectFiles.openMenu();
});
$('project-close').addEventListener('click', () => { closeMenus(); $('project-toggle').focus(); });
$('help-toggle').addEventListener('click', () => { const open = $('help').hidden; closeMenus(); $('help').hidden = !open; $('help-toggle').setAttribute('aria-expanded', String(open)); });
$('scene-only').addEventListener('click', () => setSceneOnly(!sceneOnly));
$('fold-all').addEventListener('click', async () => { for (const view of snapshot.overlays) await edit({ action: 'overlay.update', id: view.id, parameters: { folded: true } }).catch(showError); closeMenus(); });
$('new-plot').addEventListener('submit', async event => {
  event.preventDefault(); if (!$('plot-source').value) return;
  const source = JSON.parse($('plot-source').value);
  const result = await edit({ action: 'overlay.create', kind: 'plot', options: { title: $('plot-title').value.trim() || `${source.nodeId} plot`, x: 40, y: 40, width: 390, height: 280 }, source: source.nodeId, binding: { port: source.port, component: 0 } }).catch(showError);
  if (result) { closeMenus(); manager.focus(result.createdId); }
});
$('projection').addEventListener('change', () => {
  const camera = snapshot?.scene.nodes.find(node => node.kind === 'camera');
  if (camera) edit({ action: 'projection', id: camera.id, value: $('projection').value }).catch(showError);
});
$('fit').addEventListener('click', () => adapter.frameAll());
$('reset').addEventListener('click', () => { const camera = snapshot?.scene.nodes.find(node => node.kind === 'camera'); if (camera) adapter.setCamera(camera.id); });
$('undo').addEventListener('click', () => edit({ action: 'undo' }).catch(showError)); $('redo').addEventListener('click', () => edit({ action: 'redo' }).catch(showError));
$('time').addEventListener('input', event => { stopPlayback(); ++sequence; physicalTime = Number(event.target.value); clearTimeout(scrubTimer); scrubTimer = setTimeout(refresh, 70); });
function play() {
  if (playing) { stopPlayback(); return; }
  if (!snapshot || refreshNeeded) return;
  const session = ++playSession, input = $('time');
  const step = Number(input.dataset.advance ?? 0.25);
  const analytic = state.portable?.playback?.mode === 'analytic';
  const period = analytic ? 1000 / 30 : 120;
  const from = physicalTime, start = performance.now();
  playing = true; readyStatus(); $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Pause physical time');
  async function advance() {
    if (session !== playSession || disposed) return;
    const began = performance.now(), min = Number(input.min), max = Number(input.max);
    const next = analytic ? from + (began - start) * step / 120 : physicalTime + step;
    physicalTime = next <= max ? next : analytic ? min + (next - min) % (max - min) : min;
    input.value = String(physicalTime);
    await refresh();
    if (session === playSession && !disposed) timer = setTimeout(advance, Math.max(0, period - (performance.now() - began)));
  }
  timer = setTimeout(advance, period);
}
$('play').addEventListener('click', play);
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) stopPlayback(); });
window.addEventListener('keydown', event => {
  if (event.isComposing) return;
  const editing = event.target.matches('input,textarea,select,[contenteditable=true]');
  if (event.key === 'Escape') { if (sceneOnly) setSceneOnly(false); else { closeMenus(); canvas.focus(); } }
  if (editing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.toLowerCase() === 'v') { event.preventDefault(); setSceneOnly(!sceneOnly); }
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); adapter.frameAll(); }
});
window.addEventListener('pagehide', () => { disposed = true; ++sequence; cancelAnimationFrame(drawRequest); stopPlayback(); clearTimeout(scrubTimer); clearInterval(changeTimer); observer.disconnect(); manager.dispose(); adapter.dispose(); agentClient.dispose(); });
globalThis.cosmicWorkspace = Object.freeze({ adapter, conversation, get agent() { return agentClient; }, refresh, edit, select, setSceneOnly,
  get snapshot() { return snapshot; }, get results() { return results; },
  get state() { return { selection: structuredClone(selection), identity: state?.identity, time: snapshot?.time, sceneOnly }; },
  views: Object.freeze({ create: (kind, options, source, binding) => edit({ action: 'overlay.create', kind, options, ...(source ? { source, binding } : {}) }),
    bind: (id, source, options) => edit({ action: 'overlay.bind', id, source, options }), duplicate: id => edit({ action: 'overlay.duplicate', id }),
    update: (id, parameters) => edit({ action: 'overlay.update', id, parameters }), remove: id => edit({ action: 'overlay.remove', id }) }),
});
listenToAgent();
initial = (async () => { try { adoptState(await api('state')); await refresh(); } catch (error) { showError(error); } })();
await initial;
