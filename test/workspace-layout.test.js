import test from 'node:test';
import assert from 'node:assert/strict';
import { clampLayout, createOverlayManager } from '../src/workspace/browser.js';

// A deliberately small DOM harness checks state and event ownership. Real browser
// focus, touch, rendering and accessibility inspection remain a separate gate.
class Element {
  constructor(document, tag) {
    this.ownerDocument = document; this.tagName = tag; this.children = []; this.parentNode = null;
    this.style = {}; this.dataset = {}; this.attributes = new Map(); this.events = new Map(); this.captures = new Set();
    this.hidden = false; this.inert = false; this.clientWidth = 800; this.clientHeight = 600;
  }
  append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; } }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, new Set()); this.events.get(name).add(callback); }
  removeEventListener(name, callback) { this.events.get(name)?.delete(callback); }
  emit(name, options = {}) {
    const event = { target: this, button: 0, pointerId: 1, isPrimary: true, clientX: 0, clientY: 0,
      ...options, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
    let current = this;
    while (current) {
      for (const callback of current.events.get(name) ?? []) callback(event);
      if (event.stopped || options.bubbles === false) break;
      current = current.parentNode;
    }
    return event;
  }
  focus() {
    for (let ancestor = this; ancestor; ancestor = ancestor.parentNode) if (ancestor.hidden || ancestor.inert) return;
    this.ownerDocument.activeElement = this; this.emit('focusin');
  }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); this.emit('lostpointercapture', { pointerId: id }); }
}
function harness(options = {}) {
  const document = { activeElement: null, createElement(tag) { return new Element(this, tag); } };
  const window = new Element(document, 'window'); document.defaultView = window;
  const container = document.createElement('main'), restoreContainer = document.createElement('nav');
  const changes = [], focuses = [], removals = [], errors = [];
  const manager = createOverlayManager({ container, restoreContainer,
    onChange: (id, patch) => { changes.push({ id, patch }); return options.onChange?.(id, patch); },
    onFocus: id => focuses.push(id), onRemove: id => removals.push(id), onError: (error, id) => errors.push({ error, id }),
    renderContent: options.renderContent,
  });
  return { document, window, container, restoreContainer, manager, changes, focuses, removals, errors };
}
const overlay = (id = 'composer', overrides = {}) => ({ id, kind: 'conversation', title: 'Conversation', x: 30, y: 40, width: 320, height: 280, folded: false, hidden: false, ...overrides });
function find(root, className) {
  if (root.className === className) return root;
  for (const child of root.children) { const match = find(child, className); if (match) return match; }
  return null;
}
function parts(context) {
  return Object.fromEntries(['panel', 'header', 'body', 'fold', 'hide', 'remove', 'resize', 'restore'].map(name => [name,
    find(name === 'restore' ? context.restoreContainer : context.container, name === 'restore' ? 'workspace-restore-button' : `workspace-panel${name === 'panel' ? '' : `-${name}`}`)]));
}

test('clamping keeps complete expanded windows inside desktop and tiny viewports without changing inputs', () => {
  for (const viewport of [{ width: 1200, height: 800 }, { width: 320, height: 180 }, { width: 80, height: 40 }, { width: 0, height: 0 }]) {
    for (let i = 0; i < 50; i++) {
      const input = Object.freeze({ x: i * 73 - 900, y: i * 31 - 400, width: i * 71 - 70, height: i * 29 - 50 });
      const result = clampLayout(input, Object.freeze(viewport));
      assert.ok(result.x >= 0 && result.y >= 0);
      assert.ok(result.width > 0 && result.height > 0);
      assert.ok(result.x + result.width <= Math.max(1, viewport.width));
      assert.ok(result.y + result.height <= Math.max(1, viewport.height));
    }
  }
  assert.deepEqual(clampLayout({ x: -10, y: -20, width: 1, height: 1 }, { width: 800, height: 600 }), { x: 0, y: 0, width: 220, height: 140 });
});

test('folded layout keeps its header recoverable while retaining expanded dimensions', () => {
  const folded = clampLayout({ x: 20, y: 590, width: 320, height: 400, folded: true }, { width: 800, height: 600 });
  assert.equal(folded.y, 564);
  assert.equal(folded.height, 400);
  const expanded = clampLayout(folded, { width: 800, height: 600 });
  assert.equal(expanded.y, 200);
  for (const field of ['x', 'y', 'width', 'height']) assert.throws(() => clampLayout({ [field]: NaN }, { width: 800, height: 600 }), TypeError);
});

test('keyed rendering preserves composer draft, focus and body identity across source updates', () => {
  let renders = 0;
  const context = harness({ renderContent(id, body) { renders++; body.append(body.ownerDocument.createElement('textarea')); } });
  context.manager.render([overlay()]);
  const body = context.manager.body('composer'), textarea = body.children[0];
  textarea.value = 'An unfinished scientific question'; textarea.selectionStart = 8; textarea.focus();
  context.manager.render([overlay('composer', { title: '<script>Text remains a title</script>', x: 100 })]);
  assert.equal(context.manager.body('composer'), body);
  assert.equal(body.children[0], textarea);
  assert.equal(textarea.value, 'An unfinished scientific question');
  assert.equal(textarea.selectionStart, 8);
  assert.equal(context.document.activeElement, textarea);
  assert.equal(renders, 1);
  assert.equal(find(context.container, 'workspace-panel-title').textContent, '<script>Text remains a title</script>');
  assert.equal(context.changes.length, 0, 'Authoritative rendering never writes back.');
  assert.equal(parts(context).panel.getAttribute('role'), 'region');
  assert.ok(parts(context).panel.getAttribute('aria-labelledby'));
  textarea.emit('keydown', { key: 'Escape', isComposing: true });
  assert.equal(context.document.activeElement, textarea, 'IME composition owns its Escape key.');
  textarea.emit('keydown', { key: 'Escape' });
  assert.equal(context.document.activeElement, context.container);
  assert.equal(textarea.value, 'An unfinished scientific question');
  context.manager.dispose();
});

test('fold, hide and restore preserve body state and remove hidden content from interaction', () => {
  const context = harness(); context.manager.render([overlay()]);
  const p = parts(context), input = context.document.createElement('textarea'); p.body.append(input);
  input.value = 'Keep this draft'; input.focus();
  p.fold.emit('click');
  assert.equal(p.body.hidden, true); assert.equal(p.body.inert, true); assert.equal(p.resize.hidden, true);
  assert.equal(p.panel.style.height, '36px');
  assert.equal(p.fold.getAttribute('aria-expanded'), 'false');
  p.fold.emit('click'); input.focus(); p.hide.focus(); p.hide.emit('click');
  assert.equal(p.panel.hidden, true); assert.equal(p.panel.inert, true); assert.equal(p.panel.style.pointerEvents, 'none');
  assert.equal(p.restore.hidden, false); assert.equal(context.document.activeElement, p.restore);
  p.restore.emit('click');
  assert.equal(p.panel.hidden, false); assert.equal(p.panel.inert, false);
  assert.equal(context.document.activeElement, input);
  assert.equal(input.value, 'Keep this draft');
  assert.deepEqual(context.changes.map(change => change.patch), [{ folded: true }, { folded: false }, { hidden: true }, { hidden: false }]);
  context.manager.dispose();
});

test('pointer dragging previews locally, survives old renders and commits once on release', () => {
  const context = harness(); context.manager.render([overlay()]);
  const p = parts(context);
  p.header.emit('pointerdown', { clientX: 100, clientY: 100, pointerId: 7, pointerType: 'touch' });
  assert.equal(p.header.hasPointerCapture(7), true);
  p.header.emit('pointermove', { clientX: 1000, clientY: 1000, pointerId: 7 });
  assert.equal(p.panel.style.left, '480px'); assert.equal(p.panel.style.top, '320px');
  assert.equal(context.changes.length, 0);
  context.manager.render([overlay()]);
  assert.equal(p.panel.style.left, '480px');
  p.header.emit('pointerup', { pointerId: 7 });
  assert.equal(context.changes.length, 1);
  assert.deepEqual(context.changes[0], { id: 'composer', patch: { x: 480, y: 320, width: 320, height: 280 } });
  assert.equal(p.header.hasPointerCapture(7), false);
  context.manager.render([overlay()]); assert.equal(p.panel.style.left, '480px', 'An older server snapshot must not snap a pending drag back.');
  context.manager.render([overlay('composer', context.changes[0].patch)]);
  context.manager.render([overlay('composer', { x: 25, y: 20 })]); assert.equal(p.panel.style.left, '25px');
  p.fold.emit('pointerdown', { pointerId: 9 });
  p.header.emit('pointermove', { pointerId: 9, clientX: 300 });
  assert.equal(p.header.hasPointerCapture(9), false, 'Action buttons do not begin a drag.');
  context.manager.dispose();
});

test('pointer cancellation restores the previous geometry without persisting a partial gesture', () => {
  const context = harness(); context.manager.render([overlay()]); const p = parts(context);
  p.header.emit('pointerdown'); p.header.emit('pointermove', { clientX: 200, clientY: 100 });
  p.header.emit('pointercancel');
  assert.equal(p.panel.style.left, '30px'); assert.equal(p.panel.style.top, '40px');
  assert.equal(context.changes.length, 0);
  assert.equal(p.header.hasPointerCapture(1), false);
  context.manager.dispose();
});

test('pointer resizing and accessible keyboard operations share viewport constraints', () => {
  const context = harness(); context.manager.render([overlay()]); const p = parts(context);
  p.resize.emit('pointerdown', { clientX: 350, clientY: 320 });
  p.resize.emit('pointermove', { clientX: 440, clientY: 380 }); p.resize.emit('pointerup');
  assert.equal(p.panel.style.width, '410px'); assert.equal(p.panel.style.height, '340px');
  p.resize.emit('keydown', { key: 'ArrowRight' }); assert.equal(p.panel.style.width, '420px');
  p.header.emit('keydown', { key: 'ArrowDown' }); assert.equal(p.panel.style.top, '50px');
  p.header.emit('keydown', { key: 'ArrowUp', shiftKey: true }); assert.equal(p.panel.style.height, '330px');
  p.header.emit('keydown', { key: 'ArrowLeft', altKey: true }); assert.equal(p.panel.style.left, '29px');
  p.header.focus(); p.header.emit('keydown', { key: 'Escape' }); assert.equal(context.document.activeElement, context.container);
  assert.match(p.resize.getAttribute('aria-label'), /Resize Conversation/);
  context.manager.dispose();
});

test('scene-only mode hides all panel interactions and restore list while retaining draft and focus target', () => {
  const context = harness(); context.manager.render([overlay()]); const p = parts(context);
  const input = context.document.createElement('textarea'); p.body.append(input); input.focus(); input.value = 'Still here';
  context.manager.setSceneOnly(true);
  assert.equal(p.panel.hidden, true); assert.equal(p.panel.inert, true);
  assert.equal(find(context.restoreContainer, 'workspace-restore-list').hidden, true);
  assert.equal(context.document.activeElement, context.container);
  assert.equal(context.manager.focus('composer'), false);
  context.manager.setSceneOnly(false); assert.equal(context.manager.focus('composer'), true);
  assert.equal(context.document.activeElement, input); assert.equal(input.value, 'Still here');
  assert.equal(context.changes.length, 0);
  context.manager.dispose();
});

test('viewport resizing clamps the display without writing or losing the authored layout', () => {
  const context = harness(); context.manager.render([overlay('composer', { x: 450, y: 300 })]); const p = parts(context);
  context.container.clientWidth = 180; context.container.clientHeight = 90; context.window.emit('resize');
  assert.equal(p.panel.style.left, '0px'); assert.equal(p.panel.style.top, '0px');
  assert.equal(p.panel.style.width, '180px'); assert.equal(p.panel.style.height, '90px');
  assert.equal(context.changes.length, 0);
  context.container.clientWidth = 800; context.container.clientHeight = 600; context.manager.resize();
  assert.equal(p.panel.style.left, '450px'); assert.equal(p.panel.style.top, '300px');
  context.manager.dispose();
});

test('rejected persistence rolls back only its pending fields and preserves newer edits', async () => {
  const pending = [];
  const context = harness({ onChange: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  context.manager.render([overlay()]); const p = parts(context);
  p.header.emit('keydown', { key: 'ArrowRight' }); p.fold.emit('click');
  assert.equal(p.panel.style.left, '40px'); assert.equal(p.body.hidden, true);
  pending[0].reject(new Error('Stale graph revision')); await Promise.resolve(); await Promise.resolve();
  assert.equal(p.panel.style.left, '30px'); assert.equal(p.body.hidden, true);
  assert.equal(context.errors[0].error.message, 'Stale graph revision');
  pending[1].resolve();
  context.manager.render([overlay('composer', { folded: true })]);
  context.manager.render([overlay('composer', { folded: false })]); assert.equal(p.body.hidden, false);
  context.manager.dispose();
});

test('removal is a host operation, invalid renders are atomic, and disposal releases event ownership', () => {
  const context = harness(); context.manager.render([overlay()]); const p = parts(context);
  p.remove.emit('click'); assert.deepEqual(context.removals, ['composer']); assert.equal(context.manager.body('composer'), p.body);
  assert.throws(() => context.manager.render([overlay(), overlay()]), TypeError);
  assert.equal(context.manager.body('composer'), p.body);
  p.header.focus(); context.manager.render([]); assert.equal(context.manager.body('composer'), null);
  assert.equal(context.document.activeElement, context.container);
  assert.equal(p.panel.parentNode, null);
  p.header.emit('keydown', { key: 'ArrowRight' }); assert.equal(context.changes.length, 0);
  context.manager.dispose(); context.manager.dispose();
  assert.equal(context.restoreContainer.children.length, 0);
  assert.throws(() => context.manager.render([]), /disposed/);
});

test('multiple manager instances use unique accessible labels in one document', () => {
  const context = harness(); context.manager.render([overlay()]);
  const container = context.document.createElement('main');
  const other = createOverlayManager({ container, onChange() {} }); other.render([overlay()]);
  assert.notEqual(find(container, 'workspace-panel').getAttribute('aria-labelledby'), parts(context).panel.getAttribute('aria-labelledby'));
  other.dispose(); context.manager.dispose();
});
