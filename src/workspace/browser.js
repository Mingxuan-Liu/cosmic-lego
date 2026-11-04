// Domain-independent floating windows. Project edits remain the host's responsibility.
// BSD-3-Clause: see LICENSE.
const DEFAULTS = Object.freeze({ minWidth: 220, minHeight: 140, headerHeight: 36 });
let managerSerial = 0;
const coordinate = (input, fallback, name) => {
  if (input === undefined) return fallback;
  if (!Number.isFinite(input)) throw new TypeError(`${name} must be finite.`);
  return input;
};
const bounded = (value, low, high) => Math.min(high, Math.max(low, value));

/** Clamp display geometry without mutating the authored layout or viewport. */
export function clampLayout(layout, viewport, options = {}) {
  const limits = { ...DEFAULTS, ...options };
  if (!layout || !viewport || Object.values(limits).some(n => !Number.isFinite(n) || n <= 0)) throw new TypeError('Use a layout, viewport, and positive window limits.');
  const vw = Math.max(1, coordinate(viewport.width, 1, 'viewport.width'));
  const vh = Math.max(1, coordinate(viewport.height, 1, 'viewport.height'));
  const width = bounded(coordinate(layout.width, 320, 'width'), Math.min(limits.minWidth, vw), vw);
  const height = bounded(coordinate(layout.height, 280, 'height'), Math.min(limits.minHeight, vh), vh);
  const visibleHeight = layout.folded ? Math.min(limits.headerHeight, vh) : height;
  return {
    x: bounded(coordinate(layout.x, 16, 'x'), 0, Math.max(0, vw - width)),
    y: bounded(coordinate(layout.y, 16, 'y'), 0, Math.max(0, vh - visibleHeight)),
    width, height,
  };
}

/** Flat overlay records: {id,kind,title,x,y,width,height,folded,hidden}. */
export function createOverlayManager({ container, rails, revealRail, restoreContainer, onChange, onFocus, onRemove, renderContent, onError } = {}) {
  if (!container?.ownerDocument || typeof onChange !== 'function') throw new TypeError('An overlay container and onChange callback are required.');
  const document = container.ownerDocument, window = document.defaultView;
  const prefix = `workspace-${++managerSerial}`;
  const records = new Map(), listeners = [];
  let sceneOnly = false, disposed = false, serial = 0, stacking = 1, activeId = null;
  const listen = (target, name, handler, bucket = listeners) => {
    target.addEventListener(name, handler); bucket.push(() => target.removeEventListener(name, handler));
  };
  const create = (tag, className) => { const element = document.createElement(tag); element.className = className; return element; };
  const visibility = (element, hidden) => { element.hidden = hidden; element.style.display = hidden ? 'none' : ''; };
  const restoreList = restoreContainer ? create('div', 'workspace-restore-list') : null;
  if (restoreList) restoreContainer.append(restoreList);
  if (!container.hasAttribute('tabindex')) container.tabIndex = -1;
  const viewport = () => ({ width: container.clientWidth, height: container.clientHeight });
  const current = record => ({ ...record.accepted, ...record.pending, ...record.preview });
  const fallback = () => container.focus({ preventScroll: true });
  function raise(record) {
    if (!rails) record.panel.style.zIndex = String(++stacking);
    if (activeId !== record.id) { activeId = record.id; onFocus?.(record.id); }
  }
  function remember(record) {
    if (record.body.contains(document.activeElement)) record.lastFocused = document.activeElement;
  }
  function focusRecord(record) {
    if (!record || sceneOnly || current(record).hidden) return false;
    if (rails) revealRail?.(record.accepted.kind);
    raise(record);
    const target = !current(record).folded && record.lastFocused && !record.lastFocused.disabled && record.panel.contains(record.lastFocused)
      ? record.lastFocused : record.header;
    target.focus({ preventScroll: true });
    return true;
  }
  function paint(record) {
    const model = current(record);
    if (rails) {
      const parent = model.kind === 'plot' ? rails.left : rails.right;
      if (record.panel.parentNode !== parent) parent.append(record.panel);
    } else {
      const layout = clampLayout(model, viewport());
      record.layout = layout;
      record.panel.style.left = `${layout.x}px`; record.panel.style.top = `${layout.y}px`;
      record.panel.style.width = `${layout.width}px`;
      record.panel.style.height = `${model.folded ? Math.min(DEFAULTS.headerHeight, Math.max(1, container.clientHeight)) : layout.height}px`;
    }
    visibility(record.panel, sceneOnly || !!model.hidden);
    record.panel.inert = record.panel.hidden;
    record.panel.style.pointerEvents = record.panel.hidden ? 'none' : 'auto';
    record.panel.dataset.folded = String(!!model.folded);
    visibility(record.body, !!model.folded); record.body.inert = !!model.folded;
    if (record.resize) visibility(record.resize, !!model.folded);
    record.title.textContent = model.title;
    record.panel.dataset.kind = model.kind;
    record.header.setAttribute('aria-label', rails ? model.title : `${model.title}. Arrow keys move; Shift and arrow keys resize.`);
    record.fold.setAttribute('aria-label', `${model.folded ? 'Expand' : 'Fold'} ${model.title}`);
    record.fold.setAttribute('aria-expanded', String(!model.folded));
    record.fold.textContent = model.folded ? '+' : '−';
    record.hide.setAttribute('aria-label', `Hide ${model.title}`);
    record.remove.setAttribute('aria-label', `Remove ${model.title}`);
    for (const action of [record.fold, record.hide, record.remove]) action.title = action.getAttribute('aria-label');
    if (record.resize) record.resize.setAttribute('aria-label', `Resize ${model.title}. Use arrow keys.`);
    record.restore.textContent = `Restore ${model.title}`;
    visibility(record.restore, !model.hidden);
  }
  function commit(record, patch) {
    const version = ++record.version;
    Object.assign(record.pending, patch);
    for (const key of Object.keys(patch)) record.pendingVersions[key] = version;
    record.preview = null;
    paint(record);
    const reject = error => {
      if (disposed || !records.has(record.id)) return;
      for (const key of Object.keys(patch)) if (record.pendingVersions[key] === version) {
        delete record.pending[key]; delete record.pendingVersions[key];
      }
      paint(record);
      onError?.(error, record.id);
    };
    try {
      const outcome = onChange(record.id, { ...patch });
      if (outcome && typeof outcome.then === 'function') Promise.resolve(outcome).catch(reject);
    } catch (error) { reject(error); }
  }
  function cancelGesture(record) {
    const gesture = record.gesture;
    record.gesture = null; record.preview = null;
    if (gesture) {
      try { if (gesture.target.hasPointerCapture?.(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId); } catch { /* Pointer may already be gone. */ }
    }
    paint(record);
  }
  function gesture(record, target, mode) {
    listen(target, 'pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false || sceneOnly || current(record).hidden) return;
      if (mode === 'move' && record.actions.contains(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      target.focus({ preventScroll: true }); raise(record);
      record.gesture = { target, mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, layout: { ...record.layout } };
      target.setPointerCapture?.(event.pointerId);
    }, record.listeners);
    listen(target, 'pointermove', event => {
      const state = record.gesture;
      if (!state || state.target !== target || state.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      const dx = event.clientX - state.startX, dy = event.clientY - state.startY;
      record.preview = clampLayout({ ...current(record), ...state.layout,
        ...(mode === 'move' ? { x: state.layout.x + dx, y: state.layout.y + dy }
          : { width: state.layout.width + dx, height: state.layout.height + dy }) }, viewport());
      paint(record);
    }, record.listeners);
    listen(target, 'pointerup', event => {
      const state = record.gesture;
      if (!state || state.target !== target || state.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      const final = { ...record.layout };
      cancelGesture(record);
      if (Object.keys(final).some(key => final[key] !== state.layout[key])) commit(record, final);
    }, record.listeners);
    for (const name of ['pointercancel', 'lostpointercapture']) listen(target, name, event => {
      if (record.gesture?.pointerId === event.pointerId) cancelGesture(record);
    }, record.listeners);
  }
  function keyboard(record, target, mode) {
    listen(target, 'keydown', event => {
      if (event.target !== target) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (record.gesture) cancelGesture(record);
        fallback(); return;
      }
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.altKey ? 1 : 10, resize = mode === 'resize' || event.shiftKey;
      const previous = record.layout;
      const next = clampLayout({ ...current(record), ...previous, ...(resize
        ? { width: previous.width + delta[0] * step, height: previous.height + delta[1] * step }
        : { x: previous.x + delta[0] * step, y: previous.y + delta[1] * step }) }, viewport());
      if (Object.keys(next).some(key => next[key] !== previous[key])) commit(record, next);
    }, record.listeners);
  }
  function build(model) {
    const record = { id: model.id, accepted: model, pending: {}, pendingVersions: {}, preview: null, version: 0, listeners: [], lastFocused: null, gesture: null };
    record.panel = create('section', 'workspace-panel'); record.panel.dataset.overlayId = model.id;
    record.panel.setAttribute('role', 'region'); if (!rails) record.panel.style.position = 'absolute';
    record.header = create('header', 'workspace-panel-header'); record.header.tabIndex = 0; if (!rails) record.header.style.touchAction = 'none';
    record.title = create('span', 'workspace-panel-title'); record.title.id = `${prefix}-title-${++serial}`;
    record.panel.setAttribute('aria-labelledby', record.title.id);
    record.actions = create('div', 'workspace-panel-actions');
    const button = className => { const element = create('button', className); element.type = 'button'; return element; };
    record.fold = button('workspace-panel-fold'); record.hide = button('workspace-panel-hide'); record.hide.textContent = 'Hide';
    record.remove = button('workspace-panel-remove'); record.remove.textContent = 'Remove'; record.remove.hidden = !onRemove;
    record.actions.append(record.fold, record.hide, record.remove); record.header.append(record.title, record.actions);
    record.body = create('div', 'workspace-panel-body'); record.body.id = `${prefix}-body-${serial}`;
    record.fold.setAttribute('aria-controls', record.body.id);

    record.restore = button('workspace-restore-button'); record.restore.dataset.overlayId = model.id;
    record.panel.append(record.header, record.body); if (!rails) container.append(record.panel); restoreList?.append(record.restore);
    listen(record.panel, 'focusin', () => { remember(record); raise(record); }, record.listeners);
    listen(record.panel, 'pointerdown', () => raise(record), record.listeners);
    listen(record.panel, 'keydown', event => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopPropagation();
      if (record.gesture) cancelGesture(record);
      fallback();
    }, record.listeners);
    listen(record.fold, 'click', () => {
      const folded = !current(record).folded; remember(record);
      if (folded && record.body.contains(document.activeElement)) record.fold.focus({ preventScroll: true });
      commit(record, { folded });
    }, record.listeners);
    listen(record.hide, 'click', () => {
      remember(record); commit(record, { hidden: true });
      if (restoreList && !sceneOnly) record.restore.focus({ preventScroll: true }); else fallback();
    }, record.listeners);
    listen(record.restore, 'click', () => { commit(record, { hidden: false }); focusRecord(record); }, record.listeners);
    listen(record.remove, 'click', () => {
      try {
        const outcome = onRemove?.(record.id);
        if (outcome && typeof outcome.then === 'function') Promise.resolve(outcome).catch(error => onError?.(error, record.id));
      } catch (error) { onError?.(error, record.id); }
    }, record.listeners);
    if (!rails) {
      record.resize = button('workspace-panel-resize'); record.resize.textContent = '↘'; record.resize.style.touchAction = 'none';
      record.panel.append(record.resize);
      gesture(record, record.header, 'move'); gesture(record, record.resize, 'resize');
      keyboard(record, record.header, 'move'); keyboard(record, record.resize, 'resize');
    }
    paint(record);
    renderContent?.(model.id, record.body);
    return record;
  }
  function destroy(record) {
    const focused = record.panel.contains(document.activeElement);
    if (record.gesture) cancelGesture(record);
    record.listeners.forEach(remove => remove()); record.panel.remove(); record.restore.remove();
    if (focused) fallback();
  }
  function resize() { if (!disposed) for (const record of records.values()) paint(record); }
  const observer = !rails && window?.ResizeObserver ? new window.ResizeObserver(resize) : null;
  observer?.observe(container);
  if (!rails && window) listen(window, 'resize', resize);
  return Object.freeze({
    render(overlays) {
      if (disposed) throw new Error('Overlay manager is disposed.');
      if (!Array.isArray(overlays)) throw new TypeError('Overlays must be an array.');
      const incoming = new Map();
      for (const source of overlays) {
        if (!source || !['id', 'kind', 'title'].every(key => typeof source[key] === 'string' && source[key].trim()) || incoming.has(source.id)
          || ['folded', 'hidden'].some(key => source[key] !== undefined && typeof source[key] !== 'boolean')) throw new TypeError('Each overlay needs a unique ID, kind, title and boolean visibility flags.');
        const model = { id: source.id, kind: source.kind, title: source.title, x: source.x, y: source.y,
          width: source.width, height: source.height, folded: source.folded ?? false, hidden: source.hidden ?? false };
        clampLayout(model, viewport()); incoming.set(source.id, model);
      }
      for (const [id, record] of records) if (!incoming.has(id)) { destroy(record); records.delete(id); }
      for (const [id, model] of incoming) {
        const record = records.get(id);
        if (!record) { records.set(id, build(model)); continue; }
        remember(record);
        for (const key of Object.keys(record.pending)) if (model[key] === record.pending[key]) {
          delete record.pending[key]; delete record.pendingVersions[key];
        }
        record.accepted = model; paint(record);
        if ((record.panel.hidden || record.body.hidden && record.body.contains(document.activeElement)) && record.panel.contains(document.activeElement)) fallback();
      }
    },
    setSceneOnly(hidden) {
      sceneOnly = !!hidden;
      for (const record of records.values()) { remember(record); paint(record); }
      if (restoreList) { visibility(restoreList, sceneOnly); restoreList.inert = sceneOnly; }
      if (sceneOnly && [...records.values()].some(record => record.panel.contains(document.activeElement))) fallback();
    },
    focus(id) { return focusRecord(records.get(id)); },
    body(id) { return records.get(id)?.body ?? null; },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true; observer?.disconnect(); listeners.forEach(remove => remove());
      for (const record of records.values()) destroy(record);
      records.clear(); restoreList?.remove();
    },
  });
}
