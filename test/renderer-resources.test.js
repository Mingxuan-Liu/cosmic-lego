import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createThreeSceneResources, THREE_CAPABILITIES } from '../src/scene/three-adapter.js';
import { Project } from '../src/core/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { createSceneLayer, registerSceneExtensions } from '../src/scene/index.js';

const geometry = { id: 'sphere', kind: 'geometry', contentId: 'sphere-v1', data: { primitive: 'sphere', radius: 0.5 }, dependencies: [] };
const material = { id: 'white', kind: 'material', contentId: 'white-v1', data: { color: '#ffffff', unlit: true }, dependencies: [] };
const mesh = (id, overrides = {}) => ({ id, kind: 'mesh', geometry: 'sphere', material: 'white', ...overrides });
const snapshot = (nodes, assets = [geometry, material], generation = 1, revision = 1) => ({
  identity: { projectId: 'resources', generation, revision }, nodes, assets, bindings: [],
});
const commit = (manager, data) => manager.prepare(data).commit();

test('two objects reuse one geometry and material; removing one retains shared resources', () => {
  const manager = createThreeSceneResources();
  const first = commit(manager, snapshot([mesh('a'), mesh('b', { position: [2, 0, 0] })]));
  assert.equal(first.nodes.get('a').geometry, first.nodes.get('b').geometry);
  const shared = first.nodes.get('a').geometry;
  let disposed = 0; shared.addEventListener('dispose', () => disposed++);
  assert.equal(manager.stats().geometries, 1);
  const second = commit(manager, snapshot([mesh('b')], undefined, 1, 2));
  assert.equal(second.nodes.get('b').geometry, shared);
  assert.equal(disposed, 0);
  assert.equal(manager.stats().resourceReferences, 2);
  commit(manager, snapshot([], [], 1, 3));
  assert.equal(disposed, 1);
  assert.equal(manager.stats().geometries, 0);
  assert.equal(manager.stats().materials, 0);
  manager.dispose(); assert.equal(disposed, 1);
});

test('a content change replaces one geometry without rebuilding its material', () => {
  const manager = createThreeSceneResources();
  const first = commit(manager, snapshot([mesh('a')]));
  const oldGeometry = first.nodes.get('a').geometry, oldMaterial = first.nodes.get('a').material;
  const replacement = { ...geometry, contentId: 'sphere-v2', data: { ...geometry.data, radius: 2 } };
  const next = commit(manager, snapshot([mesh('a')], [replacement, material], 1, 2));
  assert.notEqual(next.nodes.get('a').geometry, oldGeometry);
  assert.equal(next.nodes.get('a').material, oldMaterial);
  assert.equal(manager.stats().disposedGeometries, 1);
  assert.equal(manager.stats().disposedMaterials, 0);
  manager.dispose();
});

test('texture dependency identity invalidates a cached material and releases both old resources', () => {
  const manager = createThreeSceneResources();
  const texture = { id: 'pixels', kind: 'texture', contentId: 'pixels-1', data: { width: 1, height: 1, pixels: [255, 0, 0, 255], colorSpace: 'srgb' }, dependencies: [] };
  const textured = { ...material, contentId: 'textured', data: { ...material.data, texture: 'pixels' }, dependencies: ['pixels'] };
  const first = commit(manager, snapshot([mesh('a')], [geometry, textured, texture]));
  const oldMaterial = first.nodes.get('a').material, oldTexture = oldMaterial.map;
  let textureDisposed = 0; oldTexture.addEventListener('dispose', () => textureDisposed++);
  const next = commit(manager, snapshot([mesh('a')], [geometry, textured, { ...texture, contentId: 'pixels-2', data: { ...texture.data, pixels: [0, 255, 0, 255] } }]));
  assert.notEqual(next.nodes.get('a').material, oldMaterial);
  assert.notEqual(next.nodes.get('a').material.map, oldTexture);
  assert.equal(textureDisposed, 1);
  assert.equal(manager.stats().disposedTextures, 1);
  assert.equal(manager.stats().disposedMaterials, 1);
  assert.equal(manager.stats().geometries, 1);
  manager.dispose();
});

test('missing resources and conflicting content identities fail without changing accepted objects', () => {
  const manager = createThreeSceneResources();
  const initial = commit(manager, snapshot([mesh('a')]));
  const oldGeometry = initial.nodes.get('a').geometry;
  assert.throws(() => manager.prepare(snapshot([mesh('bad', { geometry: 'missing' })])), { code: 'MISSING_ASSET' });
  assert.equal(manager.current, initial);
  assert.throws(() => manager.prepare(snapshot([mesh('a')], [{ ...geometry, data: { primitive: 'box' } }, material])), { code: 'CONTENT_ID_CONFLICT' });
  assert.equal(manager.current.nodes.get('a').geometry, oldGeometry);
  assert.equal(manager.stats().disposedGeometries, 0);
  manager.dispose();
});

test('discard releases newly prepared resources but leaves the accepted scene intact', () => {
  const manager = createThreeSceneResources();
  const initial = commit(manager, snapshot([mesh('a')]));
  const staged = manager.prepare(snapshot([mesh('b')], [{ ...geometry, contentId: 'sphere-other' }, material]));
  assert.equal(manager.current, initial);
  staged.discard(); staged.discard();
  assert.equal(manager.current, initial);
  assert.equal(manager.stats().disposedGeometries, 1);
  assert.equal(manager.stats().disposedMaterials, 0);
  manager.dispose();
});

test('a project generation switch releases old resources even when content is identical', () => {
  const manager = createThreeSceneResources();
  const first = commit(manager, snapshot([mesh('a')]));
  const next = commit(manager, snapshot([mesh('a')], undefined, 2));
  assert.notEqual(next.nodes.get('a').geometry, first.nodes.get('a').geometry);
  assert.equal(manager.stats().disposedGeometries, 1);
  assert.equal(manager.stats().disposedMaterials, 1);
  manager.dispose();
});

test('instancing keeps stable source IDs and parent transforms while actual raycasting resolves depth', () => {
  const manager = createThreeSceneResources();
  const authored = snapshot([
    { id: 'group', kind: 'group', position: [2, 0, 0] },
    { id: 'points', kind: 'points', parent: 'group', geometry: 'sphere', material: 'white', positions: [[0, 0, 0], [0, 0, -2]], objectIds: ['front-source', 'back-source'], colors: [[1, 0, 0], [0, 1, 0]] },
  ]);
  const before = structuredClone(authored);
  const prepared = commit(manager, authored);
  const object = prepared.nodes.get('points');
  assert.equal(object.isInstancedMesh, true);
  assert.equal(manager.stats().geometries, 1);
  assert.equal(manager.stats().instances, 2);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(2, 0, 5), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(prepared.root, true);
  assert.equal(hits[0].instanceId, 0);
  assert.equal(hits[0].object.userData.objectIds[hits[0].instanceId], 'front-source');
  assert.equal(hits[0].object.userData.selectionNode, 'points');
  assert.deepEqual(authored, before);
  commit(manager, snapshot([]));
  assert.equal(manager.stats().disposedInstances, 2);
  manager.dispose();
});

test('arrows batch shafts and tips; bounded failures release partially allocated instances', () => {
  const node = { id: 'vectors', kind: 'vectors', material: 'white', origins: [[0, 0, 0], [1, 0, 0]], directions: [[0, 2, 0], [0, 0, 0]], objectIds: ['a', 'b'], vectorScale: 2 };
  const manager = createThreeSceneResources();
  const result = commit(manager, snapshot([node], [material]));
  assert.equal(result.nodes.get('vectors').children.length, 2);
  assert.equal(manager.stats().instances, 4);
  assert.equal(manager.stats().geometries, 2);
  assert.equal(manager.stats().materials, 1);
  manager.dispose();
  const bounded = createThreeSceneResources({ limits: { maxInstances: 3 } });
  assert.throws(() => bounded.prepare(snapshot([node], [material])), /instance limit/);
  assert.equal(bounded.current, null);
  assert.equal(bounded.stats().disposedInstances, 2);
  assert.equal(bounded.stats().disposedGeometries, 2);
  assert.equal(bounded.stats().disposedMaterials, 1);
  bounded.dispose();
});

test('unsupported capabilities, asset cycles, invalid transforms and texture bounds reject explicitly', () => {
  const manager = createThreeSceneResources({ limits: { maxTexturePixels: 1 } });
  assert.throws(() => manager.prepare(snapshot([{ id: 'shader', kind: 'custom-shader' }])), { code: 'UNSUPPORTED_CAPABILITY' });
  assert.throws(() => manager.prepare(snapshot([mesh('a', { scale: [-1, 1, 1] })])), /positive scale/);
  assert.throws(() => manager.prepare(snapshot([], [{ ...geometry, dependencies: ['sphere'] } ])), { code: 'ASSET_CYCLE' });
  const texture = { id: 'pixels', kind: 'texture', contentId: 'too-large', data: { width: 2, height: 1, pixels: [], colorSpace: 'srgb' } };
  assert.throws(() => manager.prepare(snapshot([mesh('a')], [geometry, { ...material, data: { texture: 'pixels' } }, texture])), /pixel bound/);
  assert.deepEqual(THREE_CAPABILITIES.projections, ['perspective', 'orthographic']);
  manager.dispose();
});

test('compiler defaults render unindexed triangles and uncolored points without special handling by the author', async () => {
  const registry = registerSceneExtensions(new ExtensionRegistry({ capabilities: ['scene.data'] }));
  const binding = registry.bind(), layer = createSceneLayer(binding), project = new Project({ validators: layer.validators });
  const draft = project.begin(), author = layer.author(draft);
  const geometry = author.geometry({ id: 'triangles', primitive: 'triangles', positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] });
  const material = author.material({ id: 'paint' });
  author.points({ id: 'samples', geometry, material, positions: [[0, 0, 0]] });
  author.camera({ id: 'camera' });
  draft.accept();
  const compiled = await layer.compile(project, { capabilities: THREE_CAPABILITIES });
  assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics));
  const manager = createThreeSceneResources(), result = commit(manager, compiled);
  assert.equal(result.nodes.get('samples').geometry.index, null);
  assert.equal(result.nodes.get('samples').instanceColor, null);
  assert.equal(result.nodes.get('samples').geometry.attributes.position.count, 3);
  assert.deepEqual(result.nodes.get('samples').userData.objectIds, ['samples:0']);
  assert.equal(result.cameras.size, 1);
  assert.equal(result.nodes.get('scene-root').parent, result.root);
  manager.dispose();
});

test('resource sharing respects content identity rather than asset aliases or provenance labels', () => {
  const manager = createThreeSceneResources();
  const aliases = [
    { ...geometry, data: { ...geometry.data, provenance: { source: 'first author', license: 'BSD-3-Clause' } } },
    { ...geometry, id: 'other-shape', data: { ...geometry.data, provenance: { source: 'second author', license: 'MIT' } } }, material,
  ];
  const result = commit(manager, snapshot([mesh('a'), mesh('b', { geometry: 'other-shape' })], aliases));
  assert.equal(result.nodes.get('a').geometry, result.nodes.get('b').geometry);
  assert.equal(manager.stats().geometries, 1);
  manager.dispose();
});

test('a label has distinct cached texture and SpriteMaterial resources, shared by matching captions', () => {
  const context = { measureText: text => ({ width: text.length * 24 }), fillText() {} };
  const manager = createThreeSceneResources({ createCanvas: () => ({ width: 0, height: 0, getContext: () => context }) });
  const label = { id: 'first', kind: 'label', text: 'Plain <text>', color: '#ffffff', size: 0.3 };
  const result = commit(manager, snapshot([label, { ...label, id: 'second', position: [1, 0, 0] }], []));
  const first = result.nodes.get('first').children[0], second = result.nodes.get('second').children[0];
  assert.equal(first.material.isSpriteMaterial, true);
  assert.equal(first.material.map.isCanvasTexture, true);
  assert.equal(first.material.visible, true);
  assert.equal(first.material, second.material);
  assert.equal(first.material.map, second.material.map);
  assert.equal(manager.stats().materials, 1);
  assert.equal(manager.stats().textures, 1);
  commit(manager, snapshot([], []));
  assert.equal(manager.stats().disposedMaterials, 1);
  assert.equal(manager.stats().disposedTextures, 1);
  manager.dispose();
});
