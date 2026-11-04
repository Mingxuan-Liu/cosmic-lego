// Generic overlay factories. Layout is presentation data, never scientific state.
// BSD-3-Clause: see the repository LICENSE.
import { freezeData } from '../core/data.js';

export const WORKSPACE_FORMAT = 'cosmic.workspace.overlay.v1';
export const OVERLAY_KINDS = Object.freeze(['inspector', 'plot', 'provenance', 'conversation']);
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const number = (minimum, maximum, defaultValue) => ({ type: 'number', minimum, maximum, default: defaultValue });
const string = defaultValue => ({ type: 'string', ...(defaultValue === undefined ? {} : { default: defaultValue }) });
const layout = {
  x: number(0, 100000, 24), y: number(0, 100000, 24),
  // A tiny viewport can clamp a dragged/resized window below desktop minima.
  // The browser manager chooses usable defaults; persisted geometry stays valid.
  width: number(1, 2000, 360), height: number(1, 2000, 260),
  folded: { type: 'boolean', default: false }, hidden: { type: 'boolean', default: false },
};

export const workspaceExtensions = Object.freeze(OVERLAY_KINDS.map(kind => {
  const parameters = { title: string(({ inspector: 'Inspector', plot: 'Scientific sample', provenance: 'Model and provenance', conversation: 'Conversation' })[kind]),
    ...layout, ...(kind === 'plot' ? { component: { type: 'integer', minimum: -1, maximum: 2, default: -1 } } : {}) };
  const extension = {
    manifest: {
      schemaVersion: 1, apiVersion: 1, id: `workspace.${kind}`, version: '1.0.0', kind: 'view-adapter',
      implementation: { id: `workspace.${kind}.implementation`, version: '1.0.0', build: 'workspace-1' },
      parameters: object(parameters), ports: { inputs: {}, outputs: {} }, assets: {}, dependencies: [], capabilities: [],
      documentation: { summary: `A movable ${kind} overlay; content consumes checked shared scientific snapshots and application selection.`, links: [], examples: [{ parameters: {} }] },
      diagnostics: [{ code: 'WORKSPACE_PARAMETER', description: 'Overlay titles and layout must follow their data contracts.' }],
      artifact: { kind: 'view', format: WORKSPACE_FORMAT,
        schema: object({ id: string(), kind: { type: 'string', enum: [kind] }, ...parameters }),
        provenance: { source: 'Original Cosmic Lego workspace presentation', license: 'BSD-3-Clause' } },
    },
    implementation: {
      validate: node => node.data.parameters.title.trim() && node.data.parameters.title.length <= 160 ? [] :
        [{ code: 'WORKSPACE_PARAMETER', path: node.id, message: 'Overlay titles must contain 1–160 characters including nonwhitespace text.' }],
      create: ({ node }) => ({ id: node.id, kind, ...node.data.parameters }),
    },
  };
  freezeData(extension.manifest); Object.freeze(extension.implementation);
  return Object.freeze(extension);
}));
