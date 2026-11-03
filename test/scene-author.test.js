import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { sceneExtensions, SCENE_FORMAT, GEOMETRY_FORMAT, TEXTURE_FORMAT } from '../src/scene/definitions.js';
import { sceneAuthor } from '../src/scene/author.js';

function setup() {
  const registry = new ExtensionRegistry();
  for (const extension of sceneExtensions) registry.register(extension);
  const binding = registry.bind(), project = new Project({ validators: binding.validators }), draft = project.begin();
  return { registry, binding, project, draft, author: sceneAuthor(draft, binding) };
}
function artifact(binding, project, id) {
  const result = binding.produce(project, id);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  return result.artifact;
}
function invalidDraft(draft, code) {
  const result = draft.validate();
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === code), JSON.stringify(result.errors));
}

test('scene authoring uses one lazy stable root and shared geometry through ordinary F01 handles', () => {
  const { binding, project, draft, author } = setup();
  const geometry = author.geometry({ id: 'shape', primitive: 'box' }), material = author.material({ id: 'paint', color: '#F2C063' });
  const group = author.group({ id: 'group', position: [1, 2, 3] });
  const first = author.mesh({ id: 'first', parent: group, geometry, material });
  const second = author.duplicate(first, { id: 'second' });
  author.update(second, { position: [3, 0, 0], visible: false });
  assert.equal(author.root().id, 'scene-root');
  assert.equal(draft.snapshot().nodes.filter(node => node.type === 'scene.root').length, 1);
  assert.equal(second.value.references['asset.geometry'], geometry.id);
  assert.deepEqual(first.value.data.parameters.position, [0, 0, 0]);
  draft.accept();
  const output = artifact(binding, project, first.id);
  assert.equal(output.format, SCENE_FORMAT);
  assert.deepEqual(output.data, { id: 'first', kind: 'mesh', parent: 'group', position: [0, 0, 0], rotation: [0, 0, 0],
    scale: [1, 1, 1], visible: true, geometry: 'shape', material: 'paint' });
  assert.equal(artifact(binding, project, geometry.id).format, GEOMETRY_FORMAT);
  const reopened = Project.from(JSON.parse(JSON.stringify(project.snapshot())), { validators: binding.validators });
  assert.deepEqual(artifact(binding, reopened, 'first'), output);
});

test('scene helpers preserve handle ownership and parent relationships', () => {
  const local = setup(), foreign = setup();
  const outsider = foreign.author.group({ id: 'foreign' });
  const before = local.draft.snapshot();
  assert.throws(() => local.author.group({ parent: outsider }), { code: 'FOREIGN_HANDLE' });
  assert.deepEqual(local.draft.snapshot(), before, 'A rejected foreign parent must not auto-create a root.');
  const group = local.author.group({ id: 'group' }), child = local.author.group({ id: 'child', parent: group });
  const camera = local.author.camera({ id: 'camera' });
  assert.throws(() => local.author.reparent(child, camera), { code: 'SCENE_PARENT' });
  local.author.reparent(child, local.author.root());
  assert.deepEqual(child.value.dependsOn, ['scene-root']);
  assert.equal(child.value.references['asset.parent'], 'scene-root');
  assert.throws(() => local.author.reparent(local.author.root(), group), { code: 'SCENE_PARENT' });
  local.author.reparent(child, group);
  local.author.reparent(group, child);
  invalidDraft(local.draft, 'DEPENDENCY_CYCLE');
});

test('duplicate groups are shallow and referential-safe removal leaves shared assets alive', () => {
  const { binding, project, draft, author } = setup();
  const geometry = author.geometry({ id: 'geometry' }), material = author.material({ id: 'material' });
  const group = author.group({ id: 'group' });
  author.mesh({ id: 'inside', parent: group, geometry, material });
  author.mesh({ id: 'outside', geometry, material });
  const duplicated = author.duplicate(group, { id: 'group-copy' });
  assert.equal(draft.snapshot().nodes.filter(node => node.references['asset.parent'] === duplicated.id).length, 0);
  assert.throws(() => author.remove(group), { code: 'REFERENCED_REMOVAL' });
  assert.deepEqual(author.remove(group, { cascade: true }), ['group', 'inside']);
  assert.throws(() => author.remove(geometry), { code: 'REFERENCED_REMOVAL' });
  draft.accept();
  assert.equal(artifact(binding, project, 'outside').data.geometry, 'geometry');
  assert.equal(project.snapshot().nodes.filter(node => node.type === 'scene.geometry').length, 1);
});

test('local texture bytes, material links and authored provenance round-trip as data', () => {
  const { binding, project, draft, author } = setup();
  const pixels = [255, 0, 0, 255, 0, 0, 255, 255];
  const texture = author.texture({ id: 'texture', width: 2, height: 1, pixels, source: 'Original checker pixels', license: 'CC0-1.0' });
  const material = author.material({ id: 'material', texture, color: '#ffffff' });
  pixels[0] = 0;
  draft.accept();
  const output = artifact(binding, project, texture.id);
  assert.equal(output.format, TEXTURE_FORMAT);
  assert.equal(output.data.pixels[0], 255);
  assert.deepEqual(output.data.provenance, { source: 'Original checker pixels', license: 'CC0-1.0' });
  assert.equal(artifact(binding, project, material.id).data.texture, texture.id);
  assert.equal(project.get(material.id).value.type, 'scene.textured-material');
});

test('points and vectors retain stable instance identity and enforce row relationships', () => {
  const { binding, project, draft, author } = setup();
  const geometry = author.geometry(), material = author.material();
  author.points({ id: 'points', geometry, material, positions: [[0, 0, 0], [1, -2, 3]], colors: [[1, 0, 0], [0, 1, 0]] });
  author.vectors({ id: 'vectors', material, origins: [[0, 0, 0]], directions: [[-1, 2, 0]], objectIds: ['sample-1'], vectorScale: 2 });
  draft.accept();
  assert.deepEqual(artifact(binding, project, 'points').data.objectIds, ['points:0', 'points:1']);
  assert.deepEqual(artifact(binding, project, 'vectors').data.directions, [[-1, 2, 0]]);
  const edit = project.begin(), scene = sceneAuthor(edit, binding);
  scene.update('vectors', { directions: [] });
  invalidDraft(edit, 'SCENE_PARAMETER');
  assert.deepEqual(project.get('vectors').value.data.parameters.directions, [[-1, 2, 0]]);
});

test('scene definitions reject invalid geometry, texture, camera, labels and source metadata', () => {
  const cases = [
    author => author.geometry({ primitive: 'triangles', positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], indices: [0, 1, 3] }),
    author => author.geometry({ primitive: 'box', positions: [[0, 0, 0]] }),
    author => author.texture({ width: 2, pixels: [255, 0, 0, 255] }),
    author => author.material({ color: 'javascript:source' }),
    author => author.material({ source: '' }),
    author => author.camera({ near: 2, far: 1 }),
    author => author.label({ text: ' ' }),
  ];
  for (const create of cases) {
    const { author, draft } = setup();
    create(author);
    invalidDraft(draft, 'SCENE_PARAMETER');
  }
  const { author, draft } = setup();
  author.texture({ width: 33 });
  invalidDraft(draft, 'SCHEMA_BOUND');
});

test('unsupported asset links and shader/source properties fail through registry validation', () => {
  const { author, binding, draft } = setup();
  const material = author.material(), geometry = author.geometry();
  author.mesh({ geometry: material, material: geometry });
  invalidDraft(draft, 'ARTIFACT_MISMATCH');
  const another = setup();
  another.author.material({ shader: 'execute this' });
  invalidDraft(another.draft, 'SCHEMA_EXTRA');
  const direct = setup(), ordinary = direct.binding.author(direct.draft);
  const camera = direct.author.camera({ id: 'camera' });
  ordinary.instantiate('scene.group', { id: 'bad-child', assets: { parent: camera } });
  direct.draft.accept();
  const result = direct.binding.produce(direct.project, 'bad-child');
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(error => error.code === 'SCENE_PARENT'));
});

test('author options reject accessor execution without changing the draft', () => {
  const { author, draft } = setup(), before = draft.snapshot();
  let accessed = false;
  assert.throws(() => author.group({ get parent() { accessed = true; return 'scene-root'; } }), { code: 'SCENE_OPTIONS' });
  assert.throws(() => author.material(null), { code: 'SCENE_OPTIONS' });
  assert.equal(accessed, false);
  assert.deepEqual(draft.snapshot(), before);
});
