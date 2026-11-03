import { convertValue, transformValue, unit, sameDimensions, value } from '../dataflow/index.js';
import { copyData } from '../core/data.js';
import { insist } from './contracts.js';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const number = { type: 'number' }, text = { type: 'string' };
const vector = { type: 'array', items: number, minItems: 3, maxItems: 3 };
const rows = { type: 'array', items: vector, maxItems: 10000 };
const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const properties = ['position', 'positions', 'scalar-field', 'vectors'];
const typeFor = property => `scene.bind-${property}`;
const mappingSchema = {
  sourceId: text, port: { ...text, default: 'value' }, unit: text, frame: { ...text, default: 'lab' }, quantity: text,
  displayUnit: text, positionUnit: { ...text, default: 'm' }, displayFrame: { ...text, default: 'lab' },
  rotation: { type: 'array', items: vector, minItems: 3, maxItems: 3, default: identity },
  translation: { ...vector, default: [0, 0, 0] }, translationUnit: { ...text, default: 'm' },
  scale: { type: 'number', minimum: 1e-12, maximum: 1e12, default: 1 },
  colorRange: { type: 'array', items: number, minItems: 2, maxItems: 2, default: [0, 1] },
  palette: { type: 'string', enum: ['blue-gold', 'grayscale'], default: 'blue-gold' },
};

function mapped(input, parameters, property) {
  const p = parameters;
  const v = transformValue(input, { from: p.frame, to: p.displayFrame, rotation: p.rotation,
    translation: p.translation, unit: p.translationUnit });
  const converted = convertValue(v, p.displayUnit);
  const hasMissing = data => Array.isArray(data) ? data.some(hasMissing) : data === null;
  insist(!hasMissing(converted.data), 'MISSING_DATA', 'A scene binding cannot silently replace missing scientific values.');
  const scaled = row => row.map(component => component * p.scale);
  let positions = [], vectors = [], colors = [], objectIds = [], clipped = 0;
  if (property === 'position') { positions = [scaled(converted.data)]; objectIds = [p.sourceId]; }
  else if (property === 'positions') { positions = converted.data.map(scaled); objectIds = converted.objectIds; }
  else {
    insist(v.coordinates.frame.id === p.displayFrame, 'FRAME_MISMATCH', 'Field coordinates require the declared display transform.');
    const factor = v.coordinates.unit.scale / unit(p.positionUnit).scale;
    positions = v.coordinates.values.map(row => row.map(component => component * factor * p.scale));
    objectIds = positions.map((_, index) => `${p.sourceId}:sample:${index}`);
    if (property === 'vectors') vectors = converted.data.map(scaled);
    else {
      const [low, high] = p.colorRange;
      colors = converted.data.map(sample => {
        if (sample < low || sample > high) clipped++;
        const t = Math.max(0, Math.min(1, (sample - low) / (high - low)));
        if (p.palette === 'grayscale') return [t, t, t];
        const stops = [[0.208, 0.345, 0.659], [0.431, 0.773, 0.729], [0.949, 0.753, 0.388]];
        const segment = Math.min(1, Math.floor(t * 2)), f = t * 2 - segment;
        return stops[segment].map((channel, i) => channel * (1 - f) + stops[segment + 1][i] * f);
      });
    }
  }
  return { positions, vectors, colors, objectIds, clipped };
}

export const bindingExtensions = properties.map(property => {
  const isField = ['scalar-field', 'vectors'].includes(property), isScalar = property === 'scalar-field';
  const descriptor = {
    kind: property === 'position' ? 'vector' : property === 'positions' ? 'collection' : 'field',
    shape: property === 'position' ? [3] : isScalar ? [null] : [null, 3],
    unit: { $param: 'unit' }, meaning: { $param: 'quantity' },
    reference: property === 'position' ? { $param: 'sourceId' } : null,
    frame: isScalar ? null : { id: { $param: 'frame' }, kind: property === 'vectors' ? 'direction' : 'position' }, normalization: null,
  };
  return {
    manifest: {
      schemaVersion: 1, apiVersion: 1, id: typeFor(property), version: '1.0.0',
      implementation: { id: 'cosmic-lego.scene.bindings', version: '1.0.0', build: 'f05-1' }, kind: 'view-adapter',
      parameters: object(mappingSchema), ports: { inputs: { source: descriptor }, outputs: {} }, dependencies: [], capabilities: ['scene.data'],
      documentation: { summary: `Map a checked scientific ${property} result into presentation data.`, links: [], examples: [{ parameters: {
        sourceId: 'source', unit: isScalar ? 'K' : property === 'vectors' ? 'm/s' : 'm',
        quantity: isScalar ? 'temperature' : property === 'vectors' ? 'velocity' : 'position',
        displayUnit: isScalar ? 'K' : property === 'vectors' ? 'm/s' : 'm',
      } }] },
      diagnostics: [{ code: 'MISSING_DATA', description: 'Missing values cannot be drawn as invented zeros.' }, { code: 'COLOR_CLIPPED', description: 'Scalar colors are clamped to the explicit display range.' }],
      assets: { target: { kind: 'view', format: 'cosmic.scene.node.v1' } },
      artifact: { kind: 'view', format: 'cosmic.scene.binding.v1', provenance: { source: 'Original Cosmic Lego view mapping', license: 'BSD-3-Clause' },
        schema: object({ id: text, kind: text, target: text, property: text, positions: rows, vectors: rows, colors: rows,
          objectIds: { type: 'array', items: text, maxItems: 10000 }, clipped: { type: 'integer', minimum: 0 } }) },
    },
    implementation: {
      validate(node) {
        try {
          const p = node.data.parameters;
          insist(sameDimensions(p.unit, p.displayUnit), 'UNIT_MISMATCH', 'Display conversion must preserve scientific dimensions.');
          insist(sameDimensions(p.positionUnit, 'm'), 'UNIT_MISMATCH', 'Field display positions require length units.');
          insist(p.colorRange[1] > p.colorRange[0] && Number.isFinite(p.colorRange[1] - p.colorRange[0]), 'COLOR_RANGE', 'Color limits must have a finite positive interval.');
          const probe = value({ kind: 'vector', data: [0, 0, 0], unit: 'm', meaning: 'position', frame: { id: p.frame, kind: 'position' } });
          transformValue(probe, { from: p.frame, to: p.displayFrame, rotation: p.rotation, translation: p.translation, unit: p.translationUnit });
          return [];
        } catch (error) { return [{ code: error.code ?? 'BINDING', path: node.id, message: error.message }]; }
      },
      create({ node, inputs, assets }) {
        const target = assets.target.data;
        const allowed = property === 'position' ? ['mesh', 'points', 'polyline', 'vectors', 'label', 'group']
          : property === 'vectors' ? ['vectors'] : ['points'];
        insist(allowed.includes(target.kind), 'BINDING_TARGET', `${property} cannot bind to ${target.kind}.`);
        if (isField) insist(inputs.source.coordinates?.frame.id === node.data.parameters.frame, 'FRAME_MISMATCH', 'Field locations must identify the declared source frame.');
        return { id: node.id, kind: 'binding', target: target.id, property, ...mapped(inputs.source, node.data.parameters, property) };
      },
    },
  };
});

export function bindAuthor(draft, binding, target, source, options = {}) {
  const { id, property, port = 'value', ...mapping } = options;
  insist(properties.includes(property), 'BINDING_PROPERTY', 'Use position, positions, scalar-field, or vectors.');
  const sourceId = draft.idOf(source), sourceUnit = mapping.unit ?? (property === 'scalar-field' ? 'K' : property === 'vectors' ? 'm/s' : 'm');
  const parameters = { sourceId, port, unit: sourceUnit, quantity: property === 'scalar-field' ? 'temperature' : property === 'vectors' ? 'velocity' : 'position',
    displayUnit: mapping.displayUnit ?? sourceUnit, displayFrame: mapping.displayFrame ?? mapping.frame ?? 'lab', ...copyData(mapping) };
  return binding.author(draft).instantiate(typeFor(property), { ...(id === undefined ? {} : { id }), parameters,
    inputs: { source: { node: source, port } }, assets: { target } });
}
