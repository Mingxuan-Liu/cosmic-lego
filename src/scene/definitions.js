// Generic presentation records, registered by the trusted composition root.
// BSD-3-Clause: see the repository LICENSE. No scientific laws live here.
import { KernelError } from '../core/index.js';
import { freezeData, isId } from '../core/data.js';

export const SCENE_FORMAT = 'cosmic.scene.node.v1';
export const GEOMETRY_FORMAT = 'cosmic.geometry.v1';
export const MATERIAL_FORMAT = 'cosmic.material.v1';
export const TEXTURE_FORMAT = 'cosmic.texture.v1';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const number = (defaultValue, minimum = -1e9, maximum = 1e9) => ({ type: 'number', minimum, maximum, ...(defaultValue === undefined ? {} : { default: defaultValue }) });
const text = defaultValue => ({ type: 'string', ...(defaultValue === undefined ? {} : { default: defaultValue }) });
const choice = (values, defaultValue) => ({ type: 'string', enum: values, ...(defaultValue === undefined ? {} : { default: defaultValue }) });
const vector = (defaultValue, minimum = -1e9, maximum = 1e9) => ({ type: 'array', items: number(undefined, minimum, maximum), minItems: 3, maxItems: 3,
  ...(defaultValue === undefined ? {} : { default: defaultValue }) });
const rows = (maxItems = 4096, minimum = -1e9, maximum = 1e9) => ({ type: 'array', items: vector(undefined, minimum, maximum), maxItems, default: [] });
const ids = { type: 'array', items: text(), maxItems: 4096, default: [] };
const common = { position: vector([0, 0, 0]), rotation: vector([0, 0, 0]), scale: vector([1, 1, 1], 1e-9, 1e9), visible: { type: 'boolean', default: true } };
const provenance = { source: 'Cosmic Lego original local presentation asset', license: 'BSD-3-Clause' };
const sourceParameters = { source: text(provenance.source), license: text(provenance.license) };
const provenanceSchema = object({ source: text(), license: text() });
const asset = (kind, format) => ({ kind, format });
const parentAsset = asset('view', SCENE_FORMAT);
const materialAsset = asset('material', MATERIAL_FORMAT);
const geometryAsset = asset('geometry', GEOMETRY_FORMAT);
const issue = (code, path, message) => ({ code, path, message });
const requireThat = (condition, code, message) => { if (!condition) throw new KernelError(code, message); };
const nonempty = input => typeof input === 'string' && !!input.trim();
const color = input => /^#[0-9a-fA-F]{6}$/.test(input);

function extension(id, artifactKind, format, parameters, schema, assets, create, validate = () => []) {
  return {
    manifest: {
      schemaVersion: 1, apiVersion: 1, id, version: '1.0.0',
      implementation: { id: `${id}.implementation`, version: '1.0.0', build: 'scene-1' },
      kind: artifactKind === 'view' ? 'view-adapter' : 'asset-factory',
      parameters: object(parameters), ports: { inputs: {}, outputs: {} }, assets,
      dependencies: [], capabilities: [],
      documentation: { summary: `Declarative ${id} presentation data; no scientific observable is calculated.`, links: [], examples: [{ parameters: {} }] },
      diagnostics: [{ code: 'SCENE_PARAMETER', description: 'Invalid scene parameter or row relationship.' },
        { code: 'SCENE_PARENT', description: 'A scene parent must be a group.' }],
      artifact: { kind: artifactKind, format, schema: object(schema), provenance },
    },
    implementation: { validate, create },
  };
}

function parameterChecks(node) {
  const p = node.data.parameters, errors = [];
  for (const key of ['source', 'license']) if (Object.hasOwn(p, key) && !nonempty(p[key])) errors.push(issue('SCENE_PARAMETER', `${node.id}.${key}`, `${key} must be nonempty.`));
  if (Object.hasOwn(p, 'color') && !color(p.color)) errors.push(issue('SCENE_PARAMETER', `${node.id}.color`, 'Use a six-digit #rrggbb color.'));
  return errors;
}
function view(id, kind, specific = {}, assetSlots = {}, extraChecks = () => []) {
  const root = id === 'scene.root';
  return extension(id, 'view', SCENE_FORMAT, { ...common, ...specific },
    { id: text(), kind: choice([kind]), parent: text(), ...common, ...specific,
      ...Object.fromEntries(Object.keys(assetSlots).map(slot => [slot, text()])) },
    { ...(root ? {} : { parent: parentAsset }), ...assetSlots },
    ({ node, assets }) => {
      if (!root) requireThat(assets.parent.data.kind === 'group', 'SCENE_PARENT', 'Scene nodes can only be parented to a group.');
      const output = { id: node.id, kind, parent: root ? '' : assets.parent.data.id, ...node.data.parameters,
        ...Object.fromEntries(Object.keys(assetSlots).map(slot => [slot, node.references[`asset.${slot}`]])) };
      if (kind === 'points' || kind === 'vectors') {
        const count = kind === 'points' ? output.positions.length : output.origins.length;
        if (!output.objectIds.length) output.objectIds = Array.from({ length: count }, (_, index) => `${node.id}:${index}`);
      }
      return output;
    }, node => [...parameterChecks(node), ...extraChecks(node)]);
}

function instanceChecks(node, vectors = false) {
  const p = node.data.parameters, count = vectors ? p.origins.length : p.positions.length, errors = [];
  if (vectors && p.directions.length !== count) errors.push(issue('SCENE_PARAMETER', `${node.id}.directions`, 'Vector origins and directions must have equal lengths.'));
  if (p.objectIds.length && (p.objectIds.length !== count || p.objectIds.some(id => !isId(id)) || new Set(p.objectIds).size !== p.objectIds.length)) errors.push(issue('SCENE_PARAMETER', `${node.id}.objectIds`, 'Source IDs must be distinct stable IDs, one per instance, or empty for generated instance IDs.'));
  if (p.colors.length && p.colors.length !== count) errors.push(issue('SCENE_PARAMETER', `${node.id}.colors`, 'Colors must be empty or have one RGB row per instance.'));
  return errors;
}

const geometryParameters = {
  primitive: choice(['sphere', 'box', 'plane', 'triangles'], 'sphere'),
  radius: number(0.1, 1e-9), width: number(1, 1e-9), height: number(1, 1e-9), depth: number(1, 1e-9),
  segments: { type: 'integer', minimum: 3, maximum: 64, default: 16 }, positions: rows(),
  indices: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 4095 }, maxItems: 24576, default: [] },
};
const geometry = extension('scene.geometry', 'geometry', GEOMETRY_FORMAT,
  { ...geometryParameters, ...sourceParameters }, { ...geometryParameters, provenance: provenanceSchema }, {},
  ({ node }) => {
    const { source, license, ...data } = node.data.parameters;
    return { ...data, provenance: { source, license } };
  }, node => {
    const p = node.data.parameters, errors = parameterChecks(node);
    if (p.primitive === 'triangles') {
      if (p.positions.length < 3 || (p.indices.length ? p.indices.length % 3 !== 0 : p.positions.length % 3 !== 0) || p.indices.some(index => index >= p.positions.length)) {
        errors.push(issue('SCENE_PARAMETER', `${node.id}.positions`, 'Triangles need at least three positions and complete valid index or nonindexed triples.'));
      }
    } else if (p.positions.length || p.indices.length) errors.push(issue('SCENE_PARAMETER', `${node.id}.positions`, 'Explicit positions/indices are only supported by triangle geometry.'));
    return errors;
  });
const textureParameters = { width: { type: 'integer', minimum: 1, maximum: 32, default: 1 }, height: { type: 'integer', minimum: 1, maximum: 32, default: 1 },
  pixels: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 255 }, maxItems: 4096, default: [255, 255, 255, 255] }, colorSpace: choice(['srgb'], 'srgb') };
const texture = extension('scene.texture', 'data', TEXTURE_FORMAT,
  { ...textureParameters, ...sourceParameters }, { ...textureParameters, provenance: provenanceSchema }, {},
  ({ node }) => { const { source, license, ...data } = node.data.parameters; return { ...data, provenance: { source, license } }; },
  node => [...parameterChecks(node), ...(node.data.parameters.pixels.length === 4 * node.data.parameters.width * node.data.parameters.height ? [] :
    [issue('SCENE_PARAMETER', `${node.id}.pixels`, 'RGBA pixels must contain exactly width × height × 4 bytes.')])]);
const materialParameters = { color: text('#e9e5f5'), opacity: number(1, 0, 1), unlit: { type: 'boolean', default: true } };
function material(textured) {
  return extension(textured ? 'scene.textured-material' : 'scene.material', 'material', MATERIAL_FORMAT,
    { ...materialParameters, ...sourceParameters }, { ...materialParameters, texture: text(), provenance: provenanceSchema },
    textured ? { texture: asset('data', TEXTURE_FORMAT) } : {},
    ({ node }) => { const { source, license, ...data } = node.data.parameters;
      return { ...data, texture: textured ? node.references['asset.texture'] : '', provenance: { source, license } }; }, parameterChecks);
}

export const sceneExtensions = Object.freeze([
  geometry, texture, material(false), material(true),
  view('scene.root', 'group'), view('scene.group', 'group'),
  view('scene.camera', 'camera', {
    position: vector([6, 4, 8]),
    projection: choice(['perspective', 'orthographic'], 'perspective'), target: vector([0, 0, 0]),
    fov: number(45, 1, 179), near: number(0.01, 1e-9, 1e12), far: number(1000, 1e-9, 1e12), span: number(10, 1e-9, 1e12),
  }, {}, node => node.data.parameters.far > node.data.parameters.near ? [] : [issue('SCENE_PARAMETER', `${node.id}.far`, 'Camera far must exceed near.')]),
  view('scene.mesh', 'mesh', {}, { geometry: geometryAsset, material: materialAsset }),
  view('scene.points', 'points', { positions: rows(), objectIds: ids, colors: rows(4096, 0, 1) },
    { geometry: geometryAsset, material: materialAsset }, node => instanceChecks(node)),
  view('scene.polyline', 'polyline', { positions: rows() }, { material: materialAsset }),
  view('scene.vectors', 'vectors', { origins: rows(), directions: rows(), objectIds: ids, vectorScale: number(1, 1e-9), colors: rows(4096, 0, 1) },
    { material: materialAsset }, node => instanceChecks(node, true)),
  view('scene.label', 'label', { text: text('Label'), color: text('#e9e5f5'), size: number(0.3, 1e-9) }, {},
    node => nonempty(node.data.parameters.text) && node.data.parameters.text.length <= 256 ? [] : [issue('SCENE_PARAMETER', `${node.id}.text`, 'Labels need 1–256 characters including nonwhitespace text.')]),
]);

// Freeze manifests without freezing function objects; the registry captures its
// own executable records and detached data contracts during registration.
for (const entry of sceneExtensions) { freezeData(entry.manifest); Object.freeze(entry.implementation); Object.freeze(entry); }
