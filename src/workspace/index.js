import { cacheByRevision } from '../core/project.js';

import { KernelError, Project, validateProject } from '../core/index.js';
import { copyData, freezeData, isRecord, isId } from '../core/data.js';
import { checkPort, unit } from '../dataflow/index.js';
import { validateSuppliedResult } from '../registry/index.js';
import { createSceneLayer } from '../scene/index.js';
import { WORKSPACE_FORMAT, OVERLAY_KINDS, workspaceExtensions } from './definitions.js';

export { WORKSPACE_FORMAT, workspaceExtensions };
export const WORKSPACE_LIMITS = Object.freeze({ maxOverlays: 16, maxPlotValues: 10000 });
export const PLOT_SOURCE_TYPE = 'workspace.plot-source';
const builtinImplementation = { id: 'cosmic-lego.dataflow', version: '1' };
const diagnostic = (code, message, path = '$') => ({ code, message, path, severity: 'error' });
const fail = (code, message, path = '$') => { throw new KernelError(code, message, { path }); };
const insist = (condition, code, message, path) => { if (!condition) fail(code, message, path); };
const issue = error => diagnostic(error?.code ?? 'WORKSPACE_ERROR', error?.message ?? String(error), error?.path ?? '$');
const sameIdentity = (a, b) => a.projectId === b.projectId && a.generation === b.generation && a.revision === b.revision;
const typeOf = kind => `workspace.${kind}`;
const overlayKind = node => OVERLAY_KINDS.find(kind => node?.type === typeOf(kind));
const relation = node => node.type === PLOT_SOURCE_TYPE;
const exactKeys = (input, fields) => isRecord(input) && Object.keys(input).length === fields.length && fields.every(key => Object.hasOwn(input, key));
const keyOf = (nodeId, port) => JSON.stringify([nodeId, port]);

export function registerWorkspaceExtensions(registry) {
  for (const extension of workspaceExtensions) registry.register(extension);
  return registry;
}

function checkComponent(component, contract) {
  const vectors = contract.kind === 'vector' || contract.shape.length === 2;
  insist(Number.isInteger(component) && component >= -1 && component <= (vectors ? 2 : 0), 'PLOT_COMPONENT', 'Select all components (-1), a vector component 0–2, or scalar component 0.');
}
function sourceContract(binding, graph, sourceId, port) {
  const described = binding.flow.describe(graph);
  insist(described.valid, 'INVALID_PROJECT', described.errors[0]?.message ?? 'Cannot infer a source contract from this graph.');
  const contract = described.outputs[sourceId]?.[port];
  insist(contract, 'OUTPUT_PORT', `No scientific output ${sourceId}.${port}.`);
  insist(['scalar', 'vector', 'collection', 'field', 'series'].includes(contract.kind), 'WORKSPACE_SOURCE', 'Plots support scalar, vector, collection, field and sampled series.');
  return copyData(contract);
}

export function createWorkspaceLayer(binding, { limits: inputLimits = {}, scene: sceneOptions = {} } = {}) {
  const limits = { ...WORKSPACE_LIMITS, ...copyData(inputLimits) };
  insist(Object.keys(limits).every(key => Object.hasOwn(WORKSPACE_LIMITS, key)) && Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0),
    'WORKSPACE_LIMITS', 'Workspace limits must be supported positive safe integers.');
  const scene = createSceneLayer(binding, { ...copyData(sceneOptions), additionalViewFormats: [WORKSPACE_FORMAT] });
  const manifests = new Map(binding.visuals.map(record => [record.manifest.id, record.manifest]));
  const computations = new Map(binding.computations.map(record => [record.manifest.id, record.manifest.implementation]));
  function workspaceErrors(graph) {
    const errors = [], nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const overlays = graph.nodes.filter(node => overlayKind(node));
    if (overlays.length > limits.maxOverlays) errors.push(diagnostic('OVERLAY_BUDGET', `Workspace exceeds ${limits.maxOverlays} overlays.`));
    for (const node of graph.nodes) if (manifests.get(node.type)?.artifact.format === WORKSPACE_FORMAT && !overlayKind(node)) errors.push(diagnostic('WORKSPACE_KIND', 'No workspace consumer supports this overlay type.', node.id));
    const bindings = new Map();
    const described = binding.flow.describe(graph);
    if (!described.valid) return errors;
    for (const edge of graph.nodes.filter(relation)) {
      try {
        insist(edge.kind === 'relationship' && exactKeys(edge.references, ['source', 'target']) && exactKeys(edge.data, ['port', 'contract']) && isId(edge.data.port),
          'PLOT_BINDING', 'A plot-source relationship needs source/target references, port and the inferred F02 contract.', edge.id);
        insist(edge.dependsOn.length === 2 && new Set(edge.dependsOn).size === 2 && edge.dependsOn.includes(edge.references.source) && edge.dependsOn.includes(edge.references.target),
          'PLOT_BINDING', 'Plot-source dependencies must exactly name its source and target.', edge.id);
        const target = nodes.get(edge.references.target), contract = described.outputs[edge.references.source]?.[edge.data.port];
        insist(target?.type === 'workspace.plot' && contract, 'PLOT_BINDING', 'Bind one installed scientific output to a plot overlay.', edge.id);
        insist(['scalar', 'vector', 'collection', 'field', 'series'].includes(contract.kind), 'WORKSPACE_SOURCE', 'Plots support scalar, vector, collection, field and sampled series.', edge.id);
        const mismatches = [...checkPort(contract, edge.data.contract), ...checkPort(edge.data.contract, contract)];
        if (mismatches.length) fail(mismatches[0].code, `Plot contract changed; explicitly rebind its source: ${mismatches[0].message}`, edge.id);
        checkComponent(target.data.parameters.component, contract);
        insist(!bindings.has(target.id), 'PLOT_BINDING', 'A plot must have exactly one scientific source.', target.id);
        bindings.set(target.id, edge);
      } catch (error) { errors.push(issue(error)); }
    }
    for (const overlay of overlays) if (overlay.type === 'workspace.plot' && !bindings.has(overlay.id)) errors.push(diagnostic('PLOT_SOURCE_REQUIRED', 'Bind a scientific output before accepting a plot.', overlay.id));
    return errors;
  }
  const validators = Object.freeze({ structure: Object.freeze([...scene.validators.structure, workspaceErrors]) });
  const accepted = cacheByRevision(project => {
    const graph = project.snapshot();
    return { graph, validation: validateProject(graph, validators) };
  });
  const layer = {
    limits: Object.freeze(limits), validators, scene,
    author(draft) {
      const base = binding.author(draft);
      const owned = input => draft.get(draft.idOf(input));
      const overlay = input => {
        const handle = owned(input);
        insist(overlayKind(handle.value), 'WORKSPACE_KIND', 'Use a workspace overlay handle.');
        return handle;
      };
      const edgesFor = id => draft.snapshot().nodes.filter(node => relation(node) && node.references.target === id);
      function create(kind, input = {}) {
        insist(OVERLAY_KINDS.includes(kind), 'WORKSPACE_KIND', 'Use inspector, plot, provenance or conversation.');
        const options = copyData(input);
        insist(isRecord(options), 'WORKSPACE_PARAMETER', 'Overlay options must be a data object.');
        const { id, ...parameters } = options;
        return base.instantiate(typeOf(kind), { ...(id === undefined ? {} : { id }), parameters });
      }
      function bind(target, source, input = {}) {
        const options = copyData(input);
        insist(isRecord(options) && Object.keys(options).every(key => ['id', 'port', 'component'].includes(key)), 'PLOT_BINDING', 'Plot binding options are id, port and component.');
        const { id } = options;
        insist(id === undefined || isId(id), 'PLOT_BINDING', 'A plot-source relationship ID must be a stable name.');
        const handle = overlay(target), node = handle.value, sourceId = draft.idOf(source), port = options.port ?? 'value';
        insist(node.type === 'workspace.plot', 'PLOT_BINDING', 'Only plots own scientific source relationships.');
        insist(isId(port), 'OUTPUT_PORT', 'A scientific port needs a stable name.');
        owned(source);
        const contract = sourceContract(binding, draft.snapshot(), sourceId, port), component = options.component ?? node.data.parameters.component;
        checkComponent(component, contract);
        const existing = edgesFor(node.id);
        insist(existing.length <= 1, 'PLOT_BINDING', 'Resolve duplicate plot-source relationships before rebinding.');
        insist(!existing.length || id === undefined || existing[0].id === id, 'PLOT_BINDING', 'Rebinding preserves the plot-source relationship ID. Omit id or use its existing ID.');
        const data = { port, contract }, dependsOn = [sourceId, node.id];
        if (existing.length) draft.update(existing[0].id, { data, references: { source: sourceId, target: node.id }, dependsOn });
        else draft.create({ ...(id === undefined ? {} : { id }), kind: 'relationship', type: PLOT_SOURCE_TYPE, data, references: { source: sourceId, target: node.id }, dependsOn });
        if (component !== node.data.parameters.component) handle.set({ data: { ...node.data, parameters: { ...node.data.parameters, component } } });
        return handle;
      }
      const author = {
        create, bind,
        ...Object.fromEntries(OVERLAY_KINDS.map(kind => [kind, options => create(kind, options)])),
        update(input, patch) {
          const handle = overlay(input), node = handle.value, parameters = copyData(patch);
          insist(isRecord(parameters), 'WORKSPACE_PARAMETER', 'Overlay updates must be parameter objects.');
          handle.set({ data: { ...node.data, parameters: { ...node.data.parameters, ...parameters } } });
          return handle;
        },
        duplicate(input, options = {}) {
          const node = overlay(input).value, overrides = copyData(options);
          insist(isRecord(overrides), 'WORKSPACE_PARAMETER', 'Duplicate options must be parameter objects with an optional id.');
          const edges = edgesFor(node.id);
          if (node.type === 'workspace.plot') {
            insist(edges.length === 1, 'PLOT_SOURCE_REQUIRED', 'Only a bound plot can be duplicated.');
            const contract = sourceContract(binding, draft.snapshot(), edges[0].references.source, edges[0].data.port);
            checkComponent(overrides.component ?? node.data.parameters.component, contract);
          }
          const copy = create(overlayKind(node), { ...node.data.parameters, ...overrides });
          if (node.type === 'workspace.plot') {
            bind(copy, edges[0].references.source, { port: edges[0].data.port });
          }
          return copy;
        },
        remove(input, options = {}) {
          const handle = overlay(input), settings = copyData(options);
          insist(isRecord(settings) && Object.keys(settings).every(key => key === 'cascade') && (settings.cascade === undefined || typeof settings.cascade === 'boolean'), 'WORKSPACE_PARAMETER', 'Removal supports only a boolean cascade option.');
          const removed = [];
          for (const edge of edgesFor(handle.id)) removed.push(...draft.remove(edge.id, settings));
          removed.push(...draft.remove(handle, settings));
          return [...new Set(removed)].sort();
        },
      };
      return Object.freeze(author);
    },
    sources(project) {
      insist(project instanceof Project, 'PROJECT_REQUIRED', 'Use an accepted F01 Project.');
      const sources = new Map(scene.sources(project).map(source => [keyOf(source.nodeId, source.port), source]));
      for (const edge of project.snapshot().nodes.filter(relation)) {
        const source = { nodeId: edge.references.source, port: edge.data.port };
        sources.set(keyOf(source.nodeId, source.port), source);
      }
      return [...sources.values()];
    },
    async compile(project, { results = [], time = { value: 0, unit: 's' }, capabilities } = {}) {
      insist(project instanceof Project, 'PROJECT_REQUIRED', 'Use an accepted F01 Project.');
      const identity = project.token, { graph, validation } = accepted(project);
      const output = { valid: false, identity, time: null, scene: { valid: false, identity, time: null, nodes: [], assets: [], bindings: [], diagnostics: [] }, overlays: [], diagnostics: [] };
      try {
        results = copyData(results); time = copyData(time);
        if (capabilities !== undefined) capabilities = copyData(capabilities);
        insist(Array.isArray(results) && results.length <= scene.limits.maxNodes, 'RESULT_BUDGET', 'Supply a bounded array of scientific snapshots.');
        const normalized = unit(time.unit);
        insist(Number.isFinite(time.value) && Number.isFinite(time.value * normalized.scale) && JSON.stringify(normalized.dimensions) === JSON.stringify(unit('s').dimensions), 'INVALID_TIME', 'Workspace samples need finite physical time.');
        output.time = { value: time.value, unit: normalized };
        if (!validation.valid) { output.diagnostics.push(...validation.errors); return freezeData(copyData(output)); }
        const supplied = new Map();
        for (const result of results) {
          insist(isRecord(result) && isRecord(result.producer) && isId(result.producer.nodeId) && isId(result.producer.port), 'RESULT_REQUIRED', 'Snapshots must identify producing nodes and ports.');
          const key = keyOf(result.producer.nodeId, result.producer.port);
          insist(!supplied.has(key), 'RESULT_REQUIRED', 'Duplicate scientific snapshot for one node and port.');
          supplied.set(key, result);
        }
        output.scene = await scene.compile(project, { results, time: output.time, ...(capabilities === undefined ? {} : { capabilities }) });
        output.diagnostics.push(...output.scene.diagnostics);
        insist(output.scene.valid && sameIdentity(identity, project.token), output.scene.valid ? 'STALE_RESULT' : 'SCENE_FAILED', 'Scene compilation failed or the project changed.');
        const produce = binding.prepareProduction(project, { results, time: output.time });
        for (const node of graph.nodes.filter(overlayKind)) {
          const produced = produce(node.id);
          if (!produced.valid) {
            const error = produced.diagnostics.find(item => item.severity !== 'warning') ?? produced.diagnostics[0];
            fail(error.code, error.message, error.path);
          }
          const overlay = produced.artifact.data;
          if (overlay.kind === 'plot') {
            const edge = graph.nodes.find(item => relation(item) && item.references.target === node.id);
            const source = graph.nodes.find(item => item.id === edge.references.source), result = supplied.get(keyOf(source.id, edge.data.port));
            insist(result, 'RESULT_REQUIRED', `Provide a checked snapshot for ${source.id}.${edge.data.port}; workspace compilation never evaluates missing samples.`);
            const checked = validateSuppliedResult(result, { identity, nodeId: source.id, port: edge.data.port,
              implementation: computations.get(source.type) ?? builtinImplementation, descriptor: edge.data.contract, time: output.time });
            const count = data => Array.isArray(data) ? data.reduce((sum, item) => sum + count(item), 0) : 1;
            insist(count(checked.value.data) <= limits.maxPlotValues, 'PLOT_BUDGET', `Plot exceeds ${limits.maxPlotValues} numeric/missing entries.`);
            overlay.data = checked.value;
            overlay.source = { nodeId: source.id, port: edge.data.port, implementation: checked.producer.implementation, identity: checked.identity };
            overlay.sampling = copyData(checked.metadata.sampling ?? {});
            overlay.sampleMode = 'current-physical-time';
            output.diagnostics.push(...checked.diagnostics);
          }
          output.overlays.push(overlay);
        }
        insist(sameIdentity(identity, project.token), 'STALE_RESULT', 'Project changed during workspace compilation.');
        output.valid = true;
      } catch (error) {
        output.overlays = []; output.diagnostics.push(issue(error));
        output.scene = { valid: false, identity, time: output.time, nodes: [], assets: [], bindings: [], diagnostics: [...output.diagnostics] };
      }
      return freezeData(copyData(output));
    },
  };
  return Object.freeze(layer);
}
