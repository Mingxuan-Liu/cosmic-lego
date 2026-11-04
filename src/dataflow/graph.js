import { validateProject } from '../core/index.js';
import { copyData, isRecord } from '../core/data.js';
import { value, unit, descriptorOf, checkPort, binaryValue, mapValue, reduceValue } from './values.js';
import { TYPES, countValues, diagnostic, exactKeys, insist, invoke, issue, reject } from './contracts.js';

const builtinTypes = new Set(Object.values(TYPES));
export const isBuiltin = node => builtinTypes.has(node.type);
export const isManaged = (node, environment) => isBuiltin(node) || Object.hasOwn(environment.models, node.type);
export const inputId = (node, slot) => node.references[`input.${slot}`];
export const membersOf = (node, graph) => node.data.mode === 'live'
  ? graph.nodes.filter(candidate => candidate.type === node.data.query.type).map(candidate => ({ id: candidate.id, port: node.data.query.port }))
  : Object.keys(node.data.inputs).map(slot => ({ id: inputId(node, slot), port: node.data.inputs[slot].port }));

export function descriptor(input) {
  const result = copyData(input);
  insist(isRecord(result), 'MISSING_CONTEXT', 'A port descriptor must be an object.');
  for (const key of ['kind', 'shape', 'unit', 'meaning', 'reference', 'frame', 'normalization']) {
    insist(Object.hasOwn(result, key), 'MISSING_CONTEXT', `A port must explicitly declare ${key}.`);
  }
  result.unit = unit(result.unit);
  const errors = checkPort(result, result);
  if (errors.length) reject(errors[0].code, errors[0].message, errors[0].path);
  return result;
}

function checkSize(v, environment) {
  insist(countValues(v.data) + countValues(v.coordinates?.values) <= environment.limits.maxValues,
    'VALUE_BUDGET', `A value exceeds ${environment.limits.maxValues} numeric/missing entries (including coordinates).`);
}

// Synthetic nonzero values infer the supported operator's descriptor, using the
// same arithmetic contracts as evaluation. They are never exposed as results.
function probe(description, declaredTimeGrid) {
  const d = copyData(description);
  const shape = d.shape.map(length => length === null ? 1 : length);
  if (declaredTimeGrid) shape[0] = declaredTimeGrid.values.length;
  const make = dimensions => dimensions.length ? Array.from({ length: dimensions[0] }, () => make(dimensions.slice(1))) : 1;
  const spec = { ...d, data: make(shape), shape, coordinates: null, objectIds: null, time: null };
  if (d.kind === 'collection') spec.objectIds = Array.from({ length: shape[0] }, (_, i) => `probe-${i}`);
  if (d.kind === 'series') spec.coordinates = declaredTimeGrid ?? { kind: 'time', unit: 's', values: Array.from({ length: shape[0] }, (_, i) => i) };
  if (d.kind === 'field') spec.coordinates = { kind: 'space', unit: 'm', frame: { id: 'probe', kind: 'position' }, values: Array.from({ length: shape[0] }, (_, i) => [i, 0, 0]) };
  return value(spec);
}

function inferred(result, original) {
  const d = descriptorOf(result);
  // Sample coordinates/time belong to evaluated values, not invented probes.
  delete d.coordinates; delete d.objectIds; delete d.time;
  if (d.kind === 'series' && original?.coordinates) d.coordinates = copyData(original.coordinates);
  if (original && ['collection', 'field', 'series'].includes(d.kind) && original.shape[0] === null) d.shape[0] = null;
  return d;
}

function validateDefinition(node, environment) {
  const data = node.data;
  if (isBuiltin(node)) insist(node.kind === 'calculation', 'NODE_KIND', `${node.type} must be a calculation.`);
  else insist(node.kind === 'component' || node.kind === 'calculation', 'NODE_KIND', 'A scientific implementation must be a component or calculation.');
  const keys = {
    [TYPES.constant]: ['value'],
    [TYPES.selection]: ['mode', 'query', 'element', 'inputs'],
    [TYPES.field]: ['indices', 'inputs'], [TYPES.sample]: ['times', 'unit', 'inputs'],
    [TYPES.arithmetic]: ['op', 'comparison', 'alignment', 'inputs'],
    [TYPES.map]: ['op', 'inputs'], [TYPES.reduce]: ['op', 'inputs'],
    [TYPES.adapt]: ['adapter', 'inputs'],
  }[node.type] ?? ['parameters', 'inputs', 'extension'];
  exactKeys(data, keys, `${node.id}.data`);
  if (node.type === TYPES.constant) checkSize(value(data.value), environment);
  const inputs = data.inputs ?? {};
  exactKeys(inputs, Object.keys(inputs), 'inputs');
  for (const [slot, input] of Object.entries(inputs)) {
    exactKeys(input, ['port'], `input ${slot}`);
    insist(typeof input.port === 'string' && input.port.length > 0, 'INPUT_PORT', `Input ${slot} needs a port name.`);
    insist(typeof inputId(node, slot) === 'string', 'MISSING_INPUT', `Input ${slot} needs references.input.${slot}.`);
  }
  const inputReferences = Object.keys(node.references).filter(key => key.startsWith('input.'));
  insist(inputReferences.length === Object.keys(inputs).length && inputReferences.every(key => Object.hasOwn(inputs, key.slice(6))),
    'INPUT_REFERENCES', 'Every input reference must have a corresponding input port declaration.');
  const expectedDependencies = [...new Set(Object.keys(inputs).map(slot => inputId(node, slot)))].sort();
  insist(JSON.stringify([...node.dependsOn].sort()) === JSON.stringify(expectedDependencies),
    'DEPENDENCY_DECLARATION', `${node.id}.dependsOn must match its explicit input references.`);
  const slots = Object.keys(inputs).sort();
  const expectedSlots = {
    [TYPES.constant]: [], [TYPES.field]: ['source'], [TYPES.sample]: ['source'], [TYPES.arithmetic]: ['left', 'right'],
    [TYPES.map]: ['source'], [TYPES.reduce]: ['source'], [TYPES.adapt]: ['source'],
  }[node.type];
  if (expectedSlots) insist(JSON.stringify(slots) === JSON.stringify(expectedSlots), 'MISSING_INPUT', `${node.id} requires input slots ${expectedSlots.join(', ')}.`);
  if (node.type === TYPES.selection) {
    insist(['fixed', 'live'].includes(data.mode), 'SELECTION_MODE', 'Selection mode must be fixed or live.');
    const element = descriptor(data.element);
    insist(['scalar', 'vector'].includes(element.kind), 'SELECTION_ELEMENT', 'A collection selects scalar or vector outputs.');
    if (data.mode === 'live') {
      exactKeys(data.query, ['type', 'port'], 'query');
      insist(typeof data.query.type === 'string' && typeof data.query.port === 'string' && data.query.type && data.query.port,
        'SELECTION_QUERY', 'A live query needs an exact type and port.');
      insist(!slots.length, 'SELECTION_MODE', 'A live selection uses its query, not fixed inputs.');
    } else insist(data.query === undefined, 'SELECTION_MODE', 'A fixed selection cannot also have a live query.');
  }
  if (node.type === TYPES.field) insist(Array.isArray(data.indices) && data.indices.every(i => Number.isSafeInteger(i) && i >= 0) && new Set(data.indices).size === data.indices.length,
    'FIELD_SELECTION', 'Field indices must be distinct nonnegative integers.');
  if (node.type === TYPES.arithmetic) {
    insist(['add', 'subtract', 'multiply', 'divide'].includes(data.op), 'UNKNOWN_OPERATOR', `Unknown arithmetic operator ${data.op}.`);
    if (data.comparison !== undefined) {
      exactKeys(data.comparison, ['meaning', 'reference'], 'comparison');
      insist(typeof data.comparison.meaning === 'string' && data.comparison.meaning.length > 0 &&
        (data.comparison.reference === null || typeof data.comparison.reference === 'string'),
      'COMPARISON_CONTEXT', 'An explicit comparison needs a meaning and reference (or declared null).');
    }
    if (data.alignment !== undefined) {
      exactKeys(data.alignment, ['policy', 'target'], 'alignment');
      insist(data.alignment.policy === 'linear' && data.alignment.target === 'left', 'ALIGNMENT_POLICY', 'Supported resampling policy: linear, target:left. Omit for exact alignment.');
    }
  }
  if (node.type === TYPES.map) insist(['magnitude', 'abs'].includes(data.op), 'UNKNOWN_OPERATOR', `Unknown map operator ${data.op}.`);
  if (node.type === TYPES.reduce) insist(['sum', 'mean'].includes(data.op), 'UNKNOWN_OPERATOR', `Unknown reduction ${data.op}.`);
  if (node.type === TYPES.adapt) insist(Object.hasOwn(environment.adapters, data.adapter), 'ADAPTER_MISSING', `Register the required adapter ${data.adapter} at the composition root.`);
  const model = environment.models[node.type];
  if (model) {
    insist(isRecord(data.parameters), 'PARAMETERS', `${node.id} needs a parameters object.`);
    if (model.validate) {
      const errors = invoke(model.validate, node);
      insist(Array.isArray(errors), 'IMPLEMENTATION_CONTRACT', 'Model validate must return diagnostics.');
      if (errors.length) reject(errors[0].code ?? 'MODEL_PARAMETERS', errors[0].message ?? 'Model validation failed.', errors[0].path,
        typeof errors[0].category === 'string' ? { category: errors[0].category } : {});
    }
  }
}

function getOutputs(node, graph, environment, outputs) {
  const source = slot => {
    const id = inputId(node, slot), port = node.data.inputs[slot].port;
    const found = outputs.get(id)?.[port];
    insist(found, 'OUTPUT_PORT', `No declared output ${id}.${port}; supply its implementation and port contract.`);
    return found;
  };
  if (node.type === TYPES.constant) return { value: descriptorOf(value(node.data.value)) };
  if (node.type === TYPES.selection) {
    const element = descriptor(node.data.element);
    const members = membersOf(node, graph);
    insist(new Set(members.map(member => member.id)).size === members.length, 'DUPLICATE_MEMBER', 'Select each object at most once.');
    for (const member of members) {
      const actual = outputs.get(member.id)?.[member.port];
      insist(actual, 'OUTPUT_PORT', `Selection cannot find ${member.id}.${member.port}.`);
      // A collection deliberately groups distinct objects. Other context stays
      // strict; unit conversion to the declared collection unit is bounded.
      const normalized = element.reference === null ? { ...actual, reference: null } : actual;
      const errors = checkPort(normalized, element).filter(error => error.code !== 'UNIT_CONVERSION_REQUIRED');
      if (errors.length) reject(errors[0].code, errors[0].message);
    }
    const result = { ...element, kind: 'collection', shape: [node.data.mode === 'live' ? null : members.length, ...element.shape] };
    delete result.coordinates; delete result.objectIds; delete result.time;
    return { value: result };
  }
  if (node.type === TYPES.sample) {
    const d = source('source'), { times, unit: timeUnit } = node.data;
    insist(d.kind === 'scalar', 'SAMPLE_SOURCE', 'Time sampling requires a scalar output.');
    insist(Array.isArray(times) && times.length > 0 && times.length <= Math.min(256, environment.limits.maxValues / 2),
      'SAMPLE_BUDGET', 'Supply 1–256 physical times within the per-value budget.');
    const coordinates = { kind: 'time', unit: unit(timeUnit), values: times };
    return { value: descriptor({ ...d, kind: 'series', shape: [times.length], time: null, coordinates }) };
  }
  if (node.type === TYPES.field) {
    const d = source('source');
    insist(d.kind === 'field', 'FIELD_SELECTION', 'Field selection requires a field value.');
    if (d.shape[0] !== null) insist(node.data.indices.every(i => i < d.shape[0]), 'FIELD_SELECTION', 'A field index is out of range.');
    const result = { ...d, shape: [node.data.indices.length, ...d.shape.slice(1)] };
    if (result.coordinates) result.coordinates = { ...result.coordinates, values: node.data.indices.map(i => result.coordinates.values[i]) };
    return { value: result };
  }
  if (node.type === TYPES.arithmetic) {
    const left = source('left'), right = source('right');
    // Evaluate alignment only on a pair of declared grids. Otherwise use
    // matching placeholders and defer the coordinate check until evaluation.
    const knownGrids = left.kind === 'series' && right.kind === 'series' && left.coordinates && right.coordinates;
    const rightProbe = !knownGrids && ['series', 'collection'].includes(left.kind) && left.kind === right.kind
      ? { ...right, shape: [left.shape[0], ...right.shape.slice(1)] } : right;
    const d = inferred(binaryValue(node.data.op, probe(left, knownGrids && left.coordinates),
      probe(rightProbe, knownGrids && right.coordinates), {
      ...(node.data.comparison ? { comparison: node.data.comparison } : {}),
      ...(node.data.alignment ? { alignment: node.data.alignment } : {}),
    }), left.kind === 'scalar' ? right : left);
    return { value: d };
  }
  if (node.type === TYPES.map) return { value: inferred(mapValue(node.data.op, probe(source('source'))), source('source')) };
  if (node.type === TYPES.reduce) {
    const d = source('source');
    insist(d.kind === 'collection', 'REDUCTION_KIND', 'F02 reductions consume scalar per-object collections.');
    // Empty collections are valid definitions; evaluating a reduction diagnoses
    // EMPTY_COLLECTION instead of inventing zero or rejecting future live data.
    return { value: inferred(reduceValue(node.data.op, probe({ ...d, shape: [1, ...d.shape.slice(1)] }))) };
  }
  if (node.type === TYPES.adapt) {
    const adapter = environment.adapters[node.data.adapter];
    const errors = checkPort(source('source'), descriptor(adapter.input));
    if (errors.length) reject(errors[0].code, errors[0].message);
    return { value: descriptor(adapter.output) };
  }
  const model = environment.models[node.type];
  if (!model) return {};
  const required = model.inputs ? invoke(model.inputs, node) : {};
  insist(isRecord(required), 'INPUT_PORT', 'Model inputs must return a port map.');
  const provided = Object.keys(node.data.inputs);
  insist(provided.length === Object.keys(required).length && provided.every(slot => Object.hasOwn(required, slot)), 'MISSING_INPUT', `Inputs for ${node.id} must match declared ports ${Object.keys(required).join(', ')}.`);
  for (const [slot, requirement] of Object.entries(required)) {
    const errors = checkPort(source(slot), descriptor(requirement));
    if (errors.length) {
      const origin = `${inputId(node, slot)}.${node.data.inputs[slot].port}`;
      reject(errors[0].code, `${origin} → ${node.id}.${slot}. ${errors[0].message}`, `${node.id}.${slot}`);
    }
  }
  const declared = invoke(model.outputs, node);
  insist(isRecord(declared) && Object.keys(declared).length > 0, 'OUTPUT_PORT', 'Model outputs must declare a nonempty port map.');
  return Object.fromEntries(Object.entries(declared).map(([name, d]) => [name, descriptor(d)]));
}

export function analyze(graph, environment) {
  const errors = [];
  const outputs = new Map();
  const dependencies = new Map(graph.nodes.map(node => [node.id, [...node.dependsOn]]));
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const result = () => ({ valid: errors.length === 0, errors, outputs, dependencies, nodes });
  if (graph.nodes.length > environment.limits.maxNodes) {
    errors.push(diagnostic('GRAPH_BUDGET', `Project exceeds ${environment.limits.maxNodes} nodes.`));
    return result();
  }
  for (const node of graph.nodes) {
    try {
      if (isManaged(node, environment)) validateDefinition(node, environment);
      else if (node.kind === 'calculation') reject('IMPLEMENTATION_MISSING', `No implementation for calculation ${node.type}.`);
      if (node.type === TYPES.selection && node.data.mode === 'live') dependencies.set(node.id, membersOf(node, graph).map(member => member.id));
    } catch (error) { errors.push(issue(error, node.id)); }
  }
  if (errors.length) return result();
  // Reuse F01 cycle/reference validation on the effective graph. Live queries
  // contribute snapshot-specific edges without rewriting authored definitions.
  const expanded = { ...graph, nodes: graph.nodes.map(node => ({ ...node, dependsOn: dependencies.get(node.id) })) };
  const structural = validateProject(expanded);
  if (!structural.valid) { errors.push(...structural.errors); return result(); }
  const remaining = new Map(graph.nodes.map(node => [node.id, dependencies.get(node.id).length]));
  const consumers = new Map(graph.nodes.map(node => [node.id, []]));
  const depth = new Map(graph.nodes.map(node => [node.id, 1]));
  for (const node of graph.nodes) for (const id of dependencies.get(node.id)) consumers.get(id).push(node.id);
  const queue = graph.nodes.filter(node => !remaining.get(node.id)).map(node => node.id);
  const unsampleable = new Set();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], node = nodes.get(id);
    try {
      insist(depth.get(id) <= environment.limits.maxDepth, 'DEPTH_BUDGET', `Calculation path exceeds ${environment.limits.maxDepth} nodes.`);
      if (environment.models[node.type]?.analytic === false || dependencies.get(id).some(key => unsampleable.has(key))) unsampleable.add(id);
      if (node.type === TYPES.sample) {
        insist(!unsampleable.has(id), 'SAMPLE_SOURCE', 'Time sampling requires an analytic upstream graph without nested samplers.');
        unsampleable.add(id);
      }
      if (isManaged(node, environment)) {
        const declared = getOutputs(node, graph, environment, outputs);
        for (const d of Object.values(declared)) {
          const count = d.kind === 'series' && d.coordinates
            ? d.coordinates.values.length * (1 + (d.shape[1] ?? 1))
            : d.shape.reduce((size, length) => size * (length ?? 1), 1);
          insist(count <= environment.limits.maxValues, 'VALUE_BUDGET', `Output ${id} exceeds ${environment.limits.maxValues} values.`);
        }
        outputs.set(id, declared);
      }
    } catch (error) { errors.push(issue(error, id)); }
    for (const consumer of consumers.get(id)) {
      depth.set(consumer, Math.max(depth.get(consumer), depth.get(id) + 1));
      remaining.set(consumer, remaining.get(consumer) - 1);
      if (!remaining.get(consumer)) queue.push(consumer);
    }
  }
  return result();
}
