// True relative radii in the observer sky. The physical models never consume these assets.
import { CONSTANTS } from './physics.js';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const triplet = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
const provenance = { source: 'Cosmic Lego geometric silhouette from a modeled physical radius', license: 'BSD-3-Clause' };
export const skyDisplayMetres = CONSTANTS.SOLAR_RADIUS_METERS;

export function registerExoplanetVisuals(registry) {
  const id = 'exoplanet.silhouette';
  return registry.register({
    manifest: {
      schemaVersion: 1, apiVersion: 1, id, version: '1.0.0', kind: 'asset-factory',
      implementation: { id: 'exoplanet.silhouette.geometry', version: '1.0.0', build: 'f12-1' },
      parameters: object({
        primaryId: { type: 'string' },
        quantity: { type: 'string', enum: ['primary-radius', 'planet-radius'] },
      }),
      ports: { inputs: { radius: { kind: 'scalar', shape: [], unit: 'm', meaning: { $param: 'quantity' },
        reference: { $param: 'primaryId' }, frame: null, normalization: null } }, outputs: {} },
      capabilities: ['scene.data'], dependencies: [], diagnostics: [],
      documentation: { summary: 'Physical sphere at the same metre-to-display scale as the projected coordinates. Zero radius produces no silhouette.',
        links: [], examples: [{ parameters: { primaryId: 'primary', quantity: 'planet-radius' } }] },
      artifact: { kind: 'geometry', format: 'cosmic.geometry.v1', provenance, schema: object({
        primitive: { type: 'string', enum: ['sphere', 'triangles'] }, radius: { type: 'number', minimum: 0 },
        segments: { type: 'integer', minimum: 3, maximum: 64 }, positions: { type: 'array', items: triplet, maxItems: 3 },
      }) },
    },
    implementation: {
      validate: () => [],
      create({ inputs }) {
        if (!Number.isFinite(inputs.radius.data) || inputs.radius.data < 0) throw new RangeError('Drawing a silhouette requires a finite nonnegative radius.');
        const radius = inputs.radius.data * inputs.radius.unit.scale / skyDisplayMetres;
        return { primitive: radius === 0 ? 'triangles' : 'sphere', radius, segments: 64,
          positions: radius === 0 ? [[0, 0, 0], [0, 0, 0], [0, 0, 0]] : [] };
      },
    },
  });
}
