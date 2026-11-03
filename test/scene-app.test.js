import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the actual browser controller with deterministic DOM/network edges.
// WebGL, pointer picking and visual layout remain covered by browser inspection.
const source = (await readFile(new URL('../demo/scene/app.js', import.meta.url), 'utf8'))
  .replace("import { createThreeAdapter } from '/src/scene/three-adapter.js';", 'const createThreeAdapter = globalThis.makeAdapter;');
const pause = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function app({ projection = 'perspective', radius = 0.12, holdFirstEdit = false } = {}) {
  class Element {
    constructor(id) { this.id = id; this.value = id === 'time' ? '0' : ''; this.clientWidth = 800; this.clientHeight = 600; this.children = []; this.events = new Map(); }
    addEventListener(name, callback) { this.events.set(name, callback); }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this[name] = value; }
  }
  const elements = new Map(), windowEvents = new Map(), edits = [], evaluations = [], firstEdit = deferred();
  const element = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  let server = { identity: { projectId: 'test-scene', generation: 'load-1', revision: 1 }, graph: { nodes: [
    { id: 'camera', data: { parameters: { projection } } }, { id: 'shared-sphere', data: { parameters: { radius } } },
  ] } };
  let objectIds = ['source-a', 'source-b'], rendererSelection = null;
  const adapter = { capabilities: [], resize() {}, render() {}, dispose() {}, setCamera() {}, frameAll() {},
    stats: () => ({ objects: 1, geometries: 1, materials: 1, textures: 0 }) };
  const response = (value, ok = true) => ({ ok, json: async () => structuredClone(value) });
  const context = vm.createContext({
    document: { getElementById: element, createElement: name => new Element(name), createTextNode: text => ({ textContent: text }) },
    window: { devicePixelRatio: 1, addEventListener: (name, callback) => windowEvents.set(name, callback) },
    ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {},
    setTimeout, clearTimeout, Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    makeAdapter({ onSelect }) {
      adapter.select = selection => { rendererSelection = selection; onSelect(selection); };
      adapter.apply = snapshot => {
        if (rendererSelection?.objectId && !snapshot.nodes.find(node => node.id === rendererSelection.nodeId)?.objectIds.includes(rendererSelection.objectId)) adapter.select(null);
        return { valid: true };
      };
      return adapter;
    },
    async fetch(path, options = {}) {
      if (path.endsWith('/state')) return response(server);
      const input = JSON.parse(options.body);
      if (path.endsWith('/edit')) {
        edits.push(input);
        if (holdFirstEdit && edits.length === 1) await firstEdit.promise;
        if (input.identity.revision !== server.identity.revision) return response({ code: 'STALE_TOKEN', message: 'Changed by another client.' }, false);
        if (input.action === 'projection') server.graph.nodes[0].data.parameters.projection = input.value;
        else if (input.action === 'marker-scale' && input.value >= 0.03 && input.value <= 0.3) server.graph.nodes[1].data.parameters.radius = input.value;
        else return response({ code: 'EDIT', message: 'Unsupported test edit.' }, false);
        server.identity.revision++;
        return response(server);
      }
      assert.ok(path.endsWith('/evaluate'));
      evaluations.push(input);
      return response({ results: [], snapshot: { valid: true, identity: server.identity, nodes: [{ id: 'points', kind: 'points', objectIds }], bindings: [] } });
    },
  });
  await new vm.Script(`(async () => { ${source}\n })()`, { filename: 'demo/scene/app.js' }).runInContext(context);
  return { scene: context.sceneLab, adapter, element, edits, evaluations, firstEdit,
    replaceObjectIds: ids => { objectIds = ids; },
    externalEdit: () => { server.identity.revision++; server.graph.nodes[0].data.parameters.projection = 'orthographic'; },
    state: () => structuredClone(server), dispose: () => windowEvents.get('pagehide')() };
}

test('demo initializes controls from the accepted graph and reconciles rejected edits', async t => {
  const browser = await app({ projection: 'orthographic', radius: 0.23 }); t.after(browser.dispose);
  assert.equal(browser.element('projection').value, 'orthographic');
  assert.equal(browser.element('marker-size').value, '0.23');
  assert.equal(browser.element('marker-output').textContent, '0.23');
  browser.element('marker-size').value = '999';
  await browser.scene.edit('marker-scale', undefined, 999);
  assert.equal(browser.element('marker-size').value, '0.23');
  assert.equal(browser.state().identity.revision, 1);
  assert.equal(browser.element('diagnostics').hidden, false);
  assert.match(browser.element('diagnostics').textContent, /EDIT/);
});

test('rapid demo edits retain both intents and capture each token only after prior acceptance', async t => {
  const browser = await app({ holdFirstEdit: true }); t.after(browser.dispose);
  const first = browser.scene.edit('projection', undefined, 'orthographic');
  const second = browser.scene.edit('projection', undefined, 'perspective');
  await pause();
  assert.equal(browser.edits.length, 1, 'Only the first edit may be in flight.');
  browser.firstEdit.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(browser.edits.map(input => [input.identity.revision, input.value]), [[1, 'orthographic'], [2, 'perspective']]);
  assert.equal(browser.state().identity.revision, 3);
  assert.equal(browser.element('projection').value, 'perspective');
  assert.equal(browser.scene.identity.revision, 3);
});

test('an explicit stale-token rejection reloads current state and retries the queued user edit once', async t => {
  const browser = await app(); t.after(browser.dispose);
  browser.externalEdit();
  await browser.scene.edit('marker-scale', undefined, 0.2);
  assert.deepEqual(browser.edits.map(input => input.identity.revision), [1, 2]);
  assert.equal(browser.state().identity.revision, 3);
  assert.equal(browser.element('projection').value, 'orthographic');
  assert.equal(browser.element('marker-size').value, '0.2');
  assert.equal(browser.element('diagnostics').hidden, true);
});

test('refresh preserves the renderer clearing a selected source ID that disappeared', async t => {
  const browser = await app(); t.after(browser.dispose);
  browser.adapter.select({ nodeId: 'points', objectId: 'source-a', instanceIndex: 0 });
  assert.match(browser.element('selection-text').textContent, /source-a/);
  browser.replaceObjectIds(['source-b']);
  await browser.scene.refresh();
  assert.equal(browser.element('selection-badge').textContent, 'No selection');
  assert.equal(browser.element('objects').value, '');
  assert.equal(browser.element('remove').disabled, true);
});
