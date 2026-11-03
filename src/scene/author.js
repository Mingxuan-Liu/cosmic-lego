import { KernelError } from '../core/index.js';
import { copyData, isRecord } from '../core/data.js';

const visible = new Set(['scene.root', 'scene.group', 'scene.camera', 'scene.mesh', 'scene.points', 'scene.polyline', 'scene.vectors', 'scene.label']);
const assets = {
  'scene.root': [], 'scene.group': ['parent'], 'scene.camera': ['parent'], 'scene.label': ['parent'],
  'scene.geometry': [], 'scene.texture': [], 'scene.material': [], 'scene.textured-material': ['texture'],
  'scene.mesh': ['parent', 'geometry', 'material'], 'scene.points': ['parent', 'geometry', 'material'],
  'scene.polyline': ['parent', 'material'], 'scene.vectors': ['parent', 'material'],
};
const fail = (code, message) => { throw new KernelError(code, message); };
function optionsOf(input) {
  if (!isRecord(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('SCENE_OPTIONS', 'Scene options must be a plain object.');
  for (const key of Reflect.ownKeys(input)) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value')) fail('SCENE_OPTIONS', 'Scene options need enumerable data properties without accessors.');
  }
  return input;
}

// A thin convenience layer: every node, edit, relationship and deletion remains
// an F01 draft operation validated by the existing F03 registry binding.
export function sceneAuthor(draft, binding) {
  const author = binding.author(draft);
  const owned = input => draft.get(draft.idOf(input));
  const scene = input => {
    const handle = owned(input);
    if (!Object.hasOwn(assets, handle.value.type)) fail('SCENE_NODE', 'Use a registered generic scene node or asset.');
    return handle;
  };
  const parent = input => {
    const handle = owned(input);
    if (!['scene.root', 'scene.group'].includes(handle.value.type)) fail('SCENE_PARENT', 'A scene parent must be a root or group.');
    return handle;
  };
  function root(options = {}) {
    optionsOf(options);
    const id = options.id ?? 'scene-root';
    const existing = draft.snapshot().nodes.find(node => node.id === id);
    if (existing) {
      if (existing.type !== 'scene.root') fail('SCENE_ROOT', `The root ID ${id} is occupied by another node type.`);
      if (Object.keys(options).some(key => key !== 'id')) fail('SCENE_ROOT', 'Use update to change an existing root.');
      return draft.get(id);
    }
    return create('scene.root', { ...options, id });
  }
  function create(type, options = {}) {
    optionsOf(options);
    const slots = assets[type], parameters = {}, links = {};
    // Validate every supplied handle before root creation can mutate the draft.
    for (const slot of slots) if (Object.hasOwn(options, slot)) links[slot] = slot === 'parent' ? parent(options[slot]) : owned(options[slot]);
    for (const [key, input] of Object.entries(options)) if (key !== 'id' && !slots.includes(key)) parameters[key] = input;
    const detached = copyData(parameters);
    if (slots.includes('parent') && !Object.hasOwn(links, 'parent')) links.parent = root();
    return author.instantiate(type, { ...(options.id === undefined ? {} : { id: options.id }), parameters: detached, assets: links });
  }
  const api = {
    root,
    group: options => create('scene.group', options), camera: options => create('scene.camera', options),
    geometry: options => create('scene.geometry', options), texture: options => create('scene.texture', options),
    material: (options = {}) => create(Object.hasOwn(optionsOf(options), 'texture') ? 'scene.textured-material' : 'scene.material', options),
    mesh: options => create('scene.mesh', options), points: options => create('scene.points', options),
    polyline: options => create('scene.polyline', options), vectors: options => create('scene.vectors', options), label: options => create('scene.label', options),
    duplicate(input, options = {}) {
      if (Object.keys(optionsOf(options)).some(key => !['id', 'parent'].includes(key))) fail('SCENE_OPTIONS', 'Duplicate supports id and parent.');
      const node = scene(input).value;
      if (node.type === 'scene.root') fail('SCENE_ROOT', 'Create a separate root explicitly; root duplication is not supported.');
      const supplied = { ...copyData(node.data.parameters), ...(options.id === undefined ? {} : { id: options.id }) };
      for (const slot of assets[node.type]) supplied[slot] = slot === 'parent' && Object.hasOwn(options, 'parent') ? options.parent : node.references[`asset.${slot}`];
      if (Object.hasOwn(options, 'parent') && !visible.has(node.type)) fail('SCENE_PARENT', 'Reusable assets have no scene parent.');
      return create(node.type, supplied);
    },
    update(input, patch) {
      const handle = scene(input), node = handle.value;
      if (!isRecord(patch)) fail('SCENE_OPTIONS', 'Parameter updates must be a data object.');
      handle.set({ data: { ...node.data, parameters: { ...node.data.parameters, ...copyData(patch) } } });
      return handle;
    },
    reparent(input, destination) {
      const handle = scene(input), node = handle.value, target = parent(destination);
      if (!visible.has(node.type) || node.type === 'scene.root') fail('SCENE_PARENT', 'Only nonroot scene instances can be reparented.');
      const references = { ...node.references, 'asset.parent': target.id };
      handle.set({ references, dependsOn: [...new Set(Object.values(references))] });
      return handle;
    },
    remove(input, options = {}) { return draft.remove(scene(input), options); },
  };
  return Object.freeze(api);
}
