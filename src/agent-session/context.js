import { copyData, freezeData, isId, isRecord, fail } from '../core/data.js';
import { unit } from '../dataflow/index.js';

export const CONTEXT_LIMITS = Object.freeze({ maxBytes: 65536, maxSelected: 32, maxViews: 32, maxLabels: 64, maxLabelChars: 1000 });
export const sameIdentity = (a, b) => Boolean(a && b && ['projectId', 'generation', 'revision'].every(key => a[key] === b[key]));
export const sameLoad = (a, b) => Boolean(a && b && ['projectId', 'generation'].every(key => a[key] === b[key]));
const insist = (condition, code, message) => { if (!condition) fail(code, message); };
const keys = (value, allowed) => insist(isRecord(value) && Object.keys(value).every(key => allowed.includes(key)), 'CONTEXT_SCHEMA', 'Use only declared structured context fields.');
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

// Bound data before copying it. Accessors, code, cycles and prototype instances
// are rejected by the shared copier; this admission scan never invokes getters.
export function boundedData(input, maximum, code = 'SESSION_BUDGET') {
  let entries = 0, characters = 0;
  const active = new Set();
  function visit(item, depth) {
    insist(++entries <= maximum && depth <= 64, code, 'Session data exceeds its depth/work budget.');
    if (typeof item === 'string') characters += item.length;
    insist(characters <= maximum, code, 'Session data exceeds its byte budget.');
    if (item === null || typeof item !== 'object') return;
    if (Array.isArray(item)) insist(item.length <= maximum, code, 'Session array exceeds its work budget.');
    insist(!active.has(item), 'INVALID_DATA', 'Session data cannot contain cycles.'); active.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const property = Object.getOwnPropertyDescriptor(item, key);
      insist(typeof key === 'string' && property.enumerable && Object.hasOwn(property, 'value'), 'INVALID_DATA', 'Session data must not contain accessors.');
      characters += key.length; visit(property.value, depth + 1);
    }
    active.delete(item);
  }
  visit(input, 0);
  const data = copyData(input);
  insist(bytes(data) <= maximum, code, 'Session data exceeds its byte budget.');
  return data;
}

/** Derive context from accepted graph/discovery, never a transcript or repository. */
export function buildAgentContext({ inspection, discovery, input = {}, host = {}, limits: overrides = {} }) {
  const limits = { ...CONTEXT_LIMITS, ...copyData(overrides) };
  keys(limits, Object.keys(CONTEXT_LIMITS));
  insist(Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0), 'CONTEXT_LIMITS', 'Context limits must be positive safe integers.');
  const supplied = boundedData(input, limits.maxBytes, 'CONTEXT_BUDGET'), trusted = boundedData(host, limits.maxBytes, 'CONTEXT_BUDGET');
  keys(supplied, ['identity', 'selection', 'selectedIds', 'time', 'presentationTime', 'viewIds']);
  keys(trusted, ['identity', 'selection', 'selectedIds', 'time', 'presentationTime', 'viewIds', 'diagnostics']);
  const identity = inspection.identity, graph = inspection.result.graph;
  insist(Object.keys(supplied).length === 0 || supplied.identity !== undefined, 'STALE_CONTEXT', 'Attach the accepted project identity to supplied selection/time context.');
  if (supplied.identity !== undefined) insist(sameIdentity(supplied.identity, identity), 'STALE_CONTEXT', 'Selection context belongs to another accepted project revision. Refresh context before submitting.');
  if (trusted.identity !== undefined) insist(sameIdentity(trusted.identity, identity), 'STALE_CONTEXT', 'Host context belongs to another accepted project revision.');
  const source = { ...trusted, ...supplied }, nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const selection = source.selection ?? null;
  if (selection !== null) {
    keys(selection, ['nodeId', 'port', 'objectId', 'instanceIndex']);
    insist(isId(selection.nodeId) && nodes.has(selection.nodeId), 'CONTEXT_SELECTION', 'Select an existing stable component ID.');
    insist(selection.port === undefined || isId(selection.port), 'CONTEXT_SELECTION', 'Use a stable scientific port.');
    if (selection.port !== undefined) insist(Object.hasOwn(inspection.result.outputs[selection.nodeId] ?? {}, selection.port), 'CONTEXT_SELECTION', 'The selected component does not expose that scientific port.');
    insist(selection.objectId === undefined || typeof selection.objectId === 'string' && selection.objectId.length <= 128, 'CONTEXT_SELECTION', 'Object selection ID is too long.');
    insist(selection.instanceIndex === undefined || Number.isSafeInteger(selection.instanceIndex) && selection.instanceIndex >= 0, 'CONTEXT_SELECTION', 'Sample index must be a nonnegative integer.');
  }
  const ids = source.selectedIds ?? (selection ? [selection.nodeId] : []);
  insist(Array.isArray(ids) && ids.length <= limits.maxSelected && ids.every(id => isId(id) && nodes.has(id)), 'CONTEXT_SELECTION', 'Selected IDs must identify bounded existing components.');
  const selectedIds = [...new Set(ids)], selected = selectedIds.map(id => ({ id, type: nodes.get(id).type, kind: nodes.get(id).kind }));
  const physicalTime = source.time ?? { value: 0, unit: 's' };
  keys(physicalTime, ['value', 'unit']);
  const physicalUnit = unit(physicalTime.unit);
  insist(Number.isFinite(physicalTime.value) && Number.isFinite(physicalTime.value * physicalUnit.scale) && JSON.stringify(physicalUnit.dimensions) === JSON.stringify(unit('s').dimensions), 'CONTEXT_TIME', 'Physical time must have finite time units.');
  const presentationTime = source.presentationTime ?? null;
  insist(presentationTime === null || Number.isFinite(presentationTime) && presentationTime >= 0, 'CONTEXT_TIME', 'Presentation time must be nonnegative seconds.');
  const viewIds = source.viewIds ?? [];
  insist(Array.isArray(viewIds) && viewIds.length <= limits.maxViews && viewIds.every(id => isId(id) && nodes.get(id)?.kind === 'presentation'), 'CONTEXT_VIEW', 'Relevant views must identify existing presentation nodes.');
  const views = [...new Set(viewIds)].map(id => {
    const node = nodes.get(id), title = node.data?.parameters?.title;
    return { id, type: node.type, ...(typeof title === 'string' ? { title: title.slice(0, limits.maxLabelChars) } : {}) };
  });
  // Scene instances can reference science indirectly through bindings. Including
  // the bounded set of used model types avoids concealing whole-scene assumptions.
  const relevantTypes = new Set(graph.nodes.map(item => item.type));
  const assumptions = discovery.result.extensions.filter(entry => relevantTypes.has(entry.manifest.id)).flatMap(entry =>
    (entry.manifest.science?.assumptions ?? []).map(text => ({ extension: entry.manifest.id, text })));
  const diagnostics = trusted.diagnostics ?? [];
  insist(Array.isArray(diagnostics) && diagnostics.length <= limits.maxLabels, 'CONTEXT_BUDGET', 'Too many context diagnostics.');
  const safeDiagnostics = diagnostics.map(item => {
    keys(item, ['code', 'message', 'severity', 'path']);
    insist(typeof item.code === 'string' && typeof item.message === 'string' && item.message.length <= limits.maxLabelChars, 'CONTEXT_SCHEMA', 'Diagnostics require bounded public code/message data.');
    return item;
  });
  const context = { identity, selection, selected, time: { value: physicalTime.value, unit: physicalUnit }, presentationTime, views,
    capabilities: discovery.result.capabilities,
    commands: discovery.result.commands.map(command => ({ name: command.name, available: command.available ?? true })),
    assumptions: assumptions.slice(0, limits.maxLabels).map(item => ({ ...item, text: item.text.slice(0, limits.maxLabelChars) })),
    diagnostics: safeDiagnostics,
    scope: 'Bounded accepted project context. Through cosmic_command first discover with args {detail:"summary"}, then discover with names:[...] for exact schemas. Inspect additional component data as needed. Object/sample selection is UI metadata. No repository, credentials or transcript is attached.',
    truncated: { assumptions: Math.max(0, assumptions.length - limits.maxLabels) },
  };
  insist(bytes(context) <= limits.maxBytes, 'CONTEXT_BUDGET', 'Structured context exceeds its byte budget; select fewer objects/views.');
  return freezeData(copyData(context));
}
