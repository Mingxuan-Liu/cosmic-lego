import { createThreeAdapter } from '/src/scene/three-adapter.js';

const $ = id => document.getElementById(id), canvas = $('scene');
let state, snapshot, results = [], selected = null, sequence = 0, playing = false, timer, disposed = false;
let editQueue = Promise.resolve(), initialized;
let pendingEdits = 0, polling = false, lastSummary = '', activeRefreshes = 0, refreshNeeded = true;
let retryAt = 0, supersessions = 0;
const sameIdentity = (a, b) => a && b && ['projectId', 'generation', 'revision'].every(key => a[key] === b[key]);
const summaryText = summary => typeof summary === 'string' ? summary : ['created', 'updated', 'removed']
  .filter(key => summary?.[key]?.length).map(key => `${key[0].toUpperCase() + key.slice(1)} ${summary[key].length === 1 ? summary[key][0] : `${summary[key].length} objects`}`).join(' · ');
const undoButton = $('undo');
undoButton.addEventListener('click', () => edit('undo'));
const showError = error => { $('diagnostics').hidden = false; $('diagnostics').textContent = `${error.code ?? 'Scene'}: ${error.message}`; };
let adapter;
try { adapter = createThreeAdapter({ canvas, onSelect: select, onDiagnostic: showError }); }
catch (error) { showError(error); throw error; }
function resize() { adapter.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio); }
const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas); resize();
function draw() { if (disposed) return; adapter.render(); requestAnimationFrame(draw); }
requestAnimationFrame(draw);
async function api(path, input) {
  const response = await fetch(path, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message), result);
  return result;
}
function select(selection) {
  selected = selection;
  $('selection-badge').textContent = selection?.nodeId ?? 'No selection';
  $('objects').value = selection?.nodeId ?? '';
  const object = snapshot?.nodes.find(node => node.id === selection?.nodeId);
  $('selection-text').textContent = selection ? `${selection.nodeId}${selection.objectId ? ` · source ${selection.objectId}` : ''}` : 'Click an object in the scene to inspect its source.';
  const editable = object && ['mesh', 'points', 'polyline', 'vectors', 'label'].includes(object.kind);
  $('duplicate').disabled = !editable; $('remove').disabled = !editable;
  $('binding-info').replaceChildren();
  for (const binding of snapshot?.bindings.filter(binding => binding.target === selection?.nodeId) ?? []) {
    const p = document.createElement('p'), label = document.createElement('strong');
    label.textContent = binding.source.meaning;
    p.append(label, document.createTextNode(` · ${binding.source.unit.symbol}\nSource: ${binding.source.nodeId}.${binding.source.port}\nFrame: ${binding.source.frame?.id ?? binding.source.coordinates?.frame?.id ?? 'scalar'} → ${binding.mapping.displayFrame}\nDisplay scale: ×${binding.mapping.scale}`));
    p.style.whiteSpace = 'pre-line'; $('binding-info').append(p);
  }
}
function inspectStats() {
  const stats = adapter.stats();
  $('resources').textContent = `${stats.objects} objects · ${stats.geometries} shared geometries · ${stats.materials} materials · ${stats.textures} textures`;
}
function syncControls() {
  undoButton.disabled = !state?.history?.canUndo;
  const nodes = state?.graph?.nodes ?? [];
  const camera = nodes.find(node => node.id === 'camera')?.data.parameters;
  const marker = nodes.find(node => node.id === 'shared-sphere')?.data.parameters;
  if (camera) $('projection').value = camera.projection;
  if (marker) {
    $('marker-size').value = String(marker.radius);
    $('marker-output').textContent = Number(marker.radius).toFixed(2);
  }
}
async function refresh({ retry = false } = {}) {
  if (!state || disposed) return;
  if (!retry) { retryAt = 0; supersessions = 0; }
  activeRefreshes++; refreshNeeded = true;
  const mine = ++sequence, time = { value: Number($('time').value), unit: 's' };
  $('time-output').textContent = `${time.value.toFixed(2)} s`;
  $('status').textContent = 'Computing…';
  try {
    const computed = await api('/api/scene/evaluate', { identity: state.identity, time, capabilities: adapter.capabilities });
    if (mine !== sequence || disposed) return;
    if (!computed.snapshot.valid) throw computed.snapshot.diagnostics.find(item => item.severity !== 'warning') ?? computed.snapshot.diagnostics[0];
    const applied = adapter.apply(computed.snapshot);
    if (!applied.valid) throw applied.diagnostics[0];
    snapshot = computed.snapshot; results = computed.results;
    refreshNeeded = false; retryAt = 0; supersessions = 0;
    $('diagnostics').hidden = true;
    $('status').textContent = lastSummary ? `${lastSummary} · ready` : `${snapshot.nodes.length} scene nodes · ready`;
    const current = selected;
    $('objects').replaceChildren(new Option('Choose an object…', ''));
    for (const node of snapshot.nodes.filter(node => ['mesh', 'points', 'polyline', 'vectors', 'label'].includes(node.kind) && !node.id.startsWith('grid-'))) $('objects').append(new Option(node.id, node.id));
    select(current && snapshot.nodes.some(node => node.id === current.nodeId) ? current : null);
    inspectStats();
  } catch (error) {
    if (mine !== sequence || disposed) return;
    if (['STALE_RESULT', 'SUPERSEDED'].includes(error.code)) {
      // Let the competing view finish before retrying this read.
      retryAt = Date.now() + Math.min(16000, 1000 * 2 ** Math.min(supersessions++, 4) + Math.random() * 500);
      $('status').textContent = 'Waiting for current sample…';
      return;
    }
    refreshNeeded = false;
    showError(error); $('status').textContent = 'Needs attention';
  } finally { activeRefreshes--; }
}
function edit(action, id, value) {
  playing = false; clearTimeout(timer); $('play').textContent = '▶';
  $('play').setAttribute('aria-label', 'Play physical time');
  pendingEdits++;
  const operation = async () => {
    await initialized;
    if (disposed) return;
    ++sequence;
    let recovered = false;
    try {
      // Capture the accepted token when this queued edit starts. A prior edit
      // may have advanced the revision since the user chose this action.
      const submit = () => api('/api/scene/edit', { identity: state.identity, action, idempotencyKey: crypto.randomUUID(),
        ...(id === undefined ? {} : { id }), ...(value === undefined ? {} : { value }) });
      try { state = await submit(); }
      catch (error) {
        if (error.code !== 'STALE_TOKEN') throw error;
        // STALE_TOKEN explicitly means no edit was accepted. Reload once and
        // retry that same user action; ambiguous network failures are not retried.
        state = await api('/api/scene/state'); recovered = true;
        if (disposed) return;
        state = await submit();
      }
      if (disposed) return;
      lastSummary = summaryText(state.summary);
      syncControls();
      await refresh();
    } catch (error) {
      if (disposed) return;
      syncControls();
      if (recovered) await refresh();
      showError(error); $('status').textContent = 'Needs attention';
    }
  };
  const queued = editQueue.then(operation, operation).finally(() => { pendingEdits--; });
  editQueue = queued.catch(() => {});
  return queued;
}
async function pollChanges() {
  if (disposed || !state || pendingEdits || activeRefreshes || polling) return;
  polling = true;
  try {
    const observed = await api('/api/gateway/state');
    const current = () => sameIdentity(observed.identity, state.identity) && sameIdentity(snapshot?.identity, state.identity) && !refreshNeeded;
    if (disposed || pendingEdits || activeRefreshes || current()) return;
    if (sameIdentity(observed.identity, state.identity) && Date.now() < retryAt) return;
    const synchronize = async () => {
      if (disposed || pendingEdits || activeRefreshes || current()) return;
      playing = false; clearTimeout(timer); $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play physical time'); ++sequence;
      if (!sameIdentity(observed.identity, state.identity)) {
        state = await api('/api/scene/state'); lastSummary = summaryText(state.lastChange?.summary) || 'Project changed';
      }
      syncControls(); await refresh({ retry: true });
    };
    const synchronized = editQueue.then(synchronize, synchronize); editQueue = synchronized.catch(() => {}); await synchronized;
  } catch (error) { if (!disposed) showError(error); }
  finally { polling = false; }
}
const changeTimer = setInterval(pollChanges, 1000);
$('objects').addEventListener('change', () => adapter.select($('objects').value ? { nodeId: $('objects').value } : null));
$('reset-camera').addEventListener('click', () => adapter.setCamera('camera'));
$('frame-all').addEventListener('click', () => adapter.frameAll());
$('projection').addEventListener('change', () => edit('projection', undefined, $('projection').value));
$('duplicate').addEventListener('click', () => selected && edit('duplicate', selected.nodeId));
$('remove').addEventListener('click', () => selected && edit('remove', selected.nodeId));
$('marker-size').addEventListener('input', () => { $('marker-output').textContent = Number($('marker-size').value).toFixed(2); });
$('marker-size').addEventListener('change', () => edit('marker-scale', undefined, Number($('marker-size').value)));
let scrubTimer;
$('time').addEventListener('input', () => { clearTimeout(scrubTimer); scrubTimer = setTimeout(refresh, 70); });
async function advance() {
  if (!playing) return;
  $('time').value = String((Number($('time').value) + 0.25) % 8.25);
  await refresh();
  if (playing) timer = setTimeout(advance, 100);
}
$('play').addEventListener('click', () => {
  playing = !playing; $('play').textContent = playing ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label', playing ? 'Pause physical time' : 'Play physical time');
  if (playing) advance(); else clearTimeout(timer);
});
window.addEventListener('pagehide', () => { disposed = true; ++sequence; clearTimeout(timer); clearTimeout(scrubTimer); clearInterval(changeTimer); resizeObserver.disconnect(); adapter.dispose(); });
// Public diagnostic surface for local inspection. Authoritative edits stay on
// the checked server route; the renderer never evaluates scientific definitions.
globalThis.sceneLab = Object.freeze({ adapter, refresh, edit,
  get snapshot() { return snapshot; }, get results() { return results; }, get identity() { return state?.identity; } });
initialized = (async () => {
  try { state = await api('/api/scene/state'); if (!disposed) { syncControls(); await refresh(); } }
  catch (error) { if (!disposed) showError(error); }
})();
await initialized;
