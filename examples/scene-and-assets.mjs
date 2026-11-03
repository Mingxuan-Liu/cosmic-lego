import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Project } from '../src/core/index.js';
import { createSceneLayer } from '../src/scene/index.js';
import { createRuntime } from '../src/runtime/index.js';
import { value } from '../src/dataflow/index.js';
import { createRegistry } from './fixtures/scene-registry.js';

export const registryModule = new URL('./fixtures/scene-registry.js', import.meta.url);
export function buildExample() {
  const registry = createRegistry(), binding = registry.bind(), layer = createSceneLayer(binding);
  const project = new Project({ id: 'scene-fixtures', title: 'Motion, fields, and reusable scene pieces', validators: layer.validators });
  const draft = project.begin(), a = binding.author(draft), s = layer.author(draft);
  const root = s.root();
  const geometry = s.geometry({ id: 'shared-sphere', radius: 0.12, segments: 20 });
  const gold = s.material({ id: 'gold', color: '#f2c063', unlit: false });
  const fieldMaterial = s.material({ id: 'field-material', color: '#ffffff', unlit: true });
  const teal = s.material({ id: 'teal', color: '#67d8d2', unlit: false });
  const grey = s.material({ id: 'grid-material', color: '#42536e', unlit: true });
  s.camera({ id: 'camera', parent: root, position: [9, 7, 12], target: [0, 0, 0], near: 0.05, far: 200, fov: 43, span: 11 });
  const movers = s.group({ id: 'motion-group', parent: root });
  const points = [];
  for (let i = 0; i < 9; i++) points.push(a.instantiate('fixture.moving-point', {
    id: `point-${i}`, parameters: { r0: [-3.5 + (i % 3) * 0.8, 0.7 + Math.floor(i / 3) * 0.65, -0.8], v: [0.14 + (i % 3) * 0.04, 0.03, 0.06] },
  }));
  const collection = a.select({ mode: 'fixed', members: points.map(point => ({ node: point, port: 'position' })) }, { id: 'moving-collection' });
  const moving = s.points({ id: 'moving-points', parent: movers, geometry, material: gold });
  s.bind(moving, collection, { id: 'motion-binding', property: 'positions', unit: 'm', frame: 'lab' });
  s.label({ id: 'moving-label', parent: root, text: '01  •  ANALYTIC MOTION', position: [-3.6, 3.0, -0.8], color: '#f2c063', size: 0.22 });

  const coords = [], temperatures = [], vectors = [];
  for (let z = 0; z < 5; z++) for (let x = 0; x < 6; x++) {
    coords.push([0.5 + x * 0.52, 0, -1.8 + z * 0.52]);
    temperatures.push(270 + x * 12 + z * 3);
    vectors.push([0.18 + z * 0.025, 0.25 + x * 0.04, 0.12]);
  }
  const coordinates = { kind: 'space', unit: 'm', frame: { id: 'lab', kind: 'position' }, values: coords };
  const scalar = a.constant(value({ kind: 'field', data: temperatures, unit: 'K', meaning: 'temperature', coordinates }), { id: 'scalar-field' });
  const vector = a.constant(value({ kind: 'field', data: vectors, unit: 'm/s', meaning: 'velocity', frame: { id: 'lab', kind: 'direction' }, coordinates }), { id: 'vector-field' });
  const field = s.points({ id: 'field-points', parent: root, geometry, material: fieldMaterial });
  s.bind(field, scalar, { id: 'scalar-binding', property: 'scalar-field', unit: 'K', frame: 'lab', colorRange: [270, 342], palette: 'blue-gold' });
  const arrows = s.vectors({ id: 'field-vectors', parent: root, material: teal });
  s.bind(arrows, vector, { id: 'vector-binding', property: 'vectors', unit: 'm/s', frame: 'lab', scale: 1 });
  s.label({ id: 'field-label', text: '02  •  SCALAR + VECTOR FIELD', position: [0.3, 1.6, -2.0], color: '#67d8d2', size: 0.22 });
  for (let i = -5; i <= 5; i++) {
    s.polyline({ id: `grid-x-${i + 5}`, material: grey, positions: [[i, -0.25, -4], [i, -0.25, 4]] });
    s.polyline({ id: `grid-z-${i + 5}`, material: grey, positions: [[-5, -0.25, i * 0.8], [5, -0.25, i * 0.8]] });
  }
  // Two depth-separated opaque meshes share their geometry. The front face
  // occludes the rear one from the reset camera; raycasting uses the same depth.
  const block = s.geometry({ id: 'shared-box', primitive: 'box', width: 0.65, height: 0.65, depth: 0.65 });
  s.mesh({ id: 'front-block', geometry: block, material: gold, position: [0, 0.65, 2.8] });
  s.mesh({ id: 'rear-block', geometry: block, material: teal, position: [-0.6, 0.15, 1.9] });
  const texture = s.texture({ id: 'local-checker', width: 2, height: 2,
    pixels: [242, 192, 99, 255, 30, 38, 56, 255, 30, 38, 56, 255, 242, 192, 99, 255], source: 'Original 2×2 checker RGBA data', license: 'BSD-3-Clause' });
  const textured = s.material({ id: 'checker-material', texture, color: '#ffffff', unlit: true });
  s.mesh({ id: 'textured-block', geometry: block, material: textured, position: [2.6, 0.2, 2.4] });
  s.label({ id: 'assets-label', text: '03  •  SHARED ASSETS', position: [-0.3, 1.6, 2.8], color: '#d9dfef', size: 0.2 });
  draft.accept();
  return { registry, binding, layer, project };
}

export async function evaluateScene(context, runtime, time = { value: 0, unit: 's' }, capabilities) {
  const results = [];
  for (const source of context.layer.sources(context.project)) {
    const result = await runtime.submit(context.project, source.nodeId, { port: source.port, time }).promise;
    if (!result.valid) return { identity: context.project.token, time, results: [...results, result], snapshot: { valid: false, identity: context.project.token, time, nodes: [], assets: [], bindings: [], diagnostics: result.diagnostics } };
    results.push(result);
  }
  const snapshot = await context.layer.compile(context.project, { results, time, capabilities });
  return { identity: context.project.token, time, results, snapshot };
}

export async function demonstrate() {
  const context = buildExample(), runtime = createRuntime({ registryModule });
  try {
    const first = await evaluateScene(context, runtime, { value: 2, unit: 's' });
    assert.equal(first.snapshot.valid, true, JSON.stringify(first.snapshot.diagnostics));
    const draft = context.project.begin(), s = context.layer.author(draft);
    const copy = s.duplicate('moving-points', { id: 'moving-copy' });
    s.update(copy, { position: [0, 0, 1.5] }); draft.accept();
    const second = await evaluateScene(context, runtime, { value: 2, unit: 's' });
    assert.equal(second.snapshot.valid, true, JSON.stringify(second.snapshot.diagnostics));
    assert.deepEqual(first.results.map(result => result.value), second.results.map(result => result.value));
    assert.equal(second.snapshot.assets.length, first.snapshot.assets.length);
    assert.deepEqual(second.snapshot.nodes.find(node => node.id === copy.id).positions, second.snapshot.nodes.find(node => node.id === 'moving-points').positions);
    const roundtrip = Project.from(JSON.parse(JSON.stringify(context.project.snapshot())), { validators: context.layer.validators });
    const restored = await evaluateScene({ ...context, project: roundtrip }, runtime, { value: 2, unit: 's' });
    assert.equal(restored.snapshot.valid, true);
    return { nodes: first.snapshot.nodes.length, assets: first.snapshot.assets.length, bindings: first.snapshot.bindings.length,
      duplicatedWithoutNewAssets: true, identicalScientificValues: true, restored: restored.snapshot.valid };
  } finally { await runtime.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await demonstrate(), null, 2));
