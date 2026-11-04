import { copyData } from '../core/data.js';
import { value } from './values.js';
import { TYPES, exactKeys, insist, reject } from './contracts.js';
import { analyze, descriptor } from './graph.js';

// This facade returns actual F01 handles and never owns a second graph/history.
export function author(draft, environment) {
  insist(typeof draft.idOf === 'function', 'DRAFT_REQUIRED', 'Use an F01 Project draft.');
  const ref = input => {
    const entry = input && typeof input === 'object' && Object.hasOwn(input, 'node') ? input : { node: input, port: 'value' };
    if (entry !== input) return { id: draft.idOf(input), port: 'value' };
    exactKeys(entry, ['node', 'port'], 'input reference');
    insist(typeof entry.port === 'string' && entry.port.length > 0, 'INPUT_PORT', 'Specify a nonempty output port.');
    return { id: draft.idOf(entry.node), port: entry.port };
  };
  const wire = inputs => {
    const references = {}, ports = {}, ids = [];
    for (const [slot, input] of Object.entries(inputs)) {
      const target = ref(input);
      references[`input.${slot}`] = target.id;
      ports[slot] = { port: target.port };
      ids.push(target.id);
    }
    return { references, dependsOn: [...new Set(ids)], ports };
  };
  const create = (type, data, inputs, options = {}) => {
    exactKeys(options, ['id'], 'creation options');
    const links = wire(inputs);
    return draft.calculation(type, { ...copyData(options), data: { ...data, inputs: links.ports }, references: links.references, dependsOn: links.dependsOn });
  };
  return Object.freeze({
    constant(input, options = {}) {
      exactKeys(options, ['id'], 'constant options');
      return draft.calculation(TYPES.constant, { ...copyData(options), data: { value: value(input) } });
    },
    component(type, options = {}) {
      exactKeys(options, ['id', 'parameters', 'inputs'], 'component options');
      const { id, parameters = {}, inputs = {} } = options;
      insist(Object.hasOwn(environment.models, type), 'IMPLEMENTATION_MISSING', `Register ${type} at the composition root.`);
      const links = wire(inputs);
      return draft.component(type, { ...(id === undefined ? {} : { id }), data: { parameters: copyData(parameters), inputs: links.ports }, references: links.references, dependsOn: links.dependsOn });
    },
    select(spec, options = {}) {
      exactKeys(spec, ['mode', 'members', 'type', 'port', 'element'], 'selection');
      insist(['fixed', 'live'].includes(spec.mode), 'SELECTION_MODE', 'Choose fixed or live selection.');
      let inputs = {}, query;
      if (spec.mode === 'fixed') {
        insist(Array.isArray(spec.members) && spec.type === undefined && spec.port === undefined, 'SELECTION_MODE', 'Fixed selections need members, not a live type/port query.');
        inputs = Object.fromEntries(spec.members.map((member, i) => [`member${i}`, member]));
      } else {
        insist(spec.members === undefined && typeof spec.type === 'string' && typeof spec.port === 'string', 'SELECTION_QUERY', 'Live selections need a type/port query, not fixed members.');
        query = { type: spec.type, port: spec.port };
      }
      let element = spec.element;
      if (element === undefined) {
        const graph = draft.snapshot();
        const first = spec.mode === 'fixed' ? spec.members[0] : graph.nodes.find(node => node.type === spec.type)?.id;
        if (first === undefined) reject('SELECTION_ELEMENT', 'An initially empty selection needs an explicit element descriptor.');
        const source = spec.mode === 'fixed' ? ref(first) : { id: first, port: spec.port };
        const inspected = analyze(graph, environment);
        element = inspected.outputs.get(source.id)?.[source.port];
        if (!element) reject('SELECTION_ELEMENT', `Cannot infer ${source.id}.${source.port}; supply element explicitly while staging incomplete inputs.`);
        element = { ...element, reference: null };
        delete element.coordinates; delete element.objectIds; delete element.time;
      }
      return create(TYPES.selection, { mode: spec.mode, element: descriptor(element), ...(query ? { query } : {}) }, inputs, options);
    },
    sample(source, schedule, options = {}) {
      exactKeys(schedule, ['times', 'unit'], 'sample schedule');
      return create(TYPES.sample, copyData(schedule), { source }, options);
    },
    field(source, indices, options = {}) { return create(TYPES.field, { indices: copyData(indices) }, { source }, options); },
    arithmetic(op, left, right, options = {}) {
      exactKeys(options, ['id', 'comparison', 'alignment'], 'arithmetic options');
      const { id, ...configuration } = options;
      return create(TYPES.arithmetic, { op, ...copyData(configuration) }, { left, right }, id === undefined ? {} : { id });
    },
    map(op, source, options = {}) { return create(TYPES.map, { op }, { source }, options); },
    reduce(op, source, options = {}) { return create(TYPES.reduce, { op }, { source }, options); },
    adapt(adapter, source, options = {}) { return create(TYPES.adapt, { adapter }, { source }, options); },
    update(target, patch) { draft.update(target, patch); return draft.get(draft.idOf(target)); },
    remove(target, options) { return draft.remove(target, options); },
  });
}
