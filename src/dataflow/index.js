import { cacheByRevision } from '../core/project.js';
import { Project, validateProject } from '../core/index.js';
import { copyData, isRecord } from '../core/data.js';
import { DEFAULT_LIMITS, exactKeys, implementation, insist, issue } from './contracts.js';
import { analyze, descriptor } from './graph.js';
import { author } from './author.js';
import { evaluate } from './evaluate.js';

export { value, unit, validateValue, descriptorOf, sameDimensions, checkPort, convertValue, transformValue, binaryValue, mapValue, reduceValue, fieldValue } from './values.js';
export { DEFAULT_LIMITS } from './contracts.js';

// A minimal injection boundary for F02. F03 will add manifests/discovery/version
// negotiation; this function never imports an implementation named by data.
export function createDataflow({ models = {}, adapters = {}, limits = {} } = {}) {
  insist(isRecord(models) && isRecord(adapters), 'IMPLEMENTATIONS', 'Supply trusted local model/adapter maps.');
  const environment = { models: {}, adapters: {}, limits: { ...DEFAULT_LIMITS, ...copyData(limits) } };
  exactKeys(environment.limits, Object.keys(DEFAULT_LIMITS), 'limits');
  insist(Object.values(environment.limits).every(number => Number.isSafeInteger(number) && number > 0), 'LIMITS', 'Limits must be positive safe integers.');
  for (const [type, model] of Object.entries(models)) {
    insist(!type.startsWith('dataflow.'), 'RESERVED_TYPE', 'The dataflow namespace belongs to built-in calculations.');
    insist(isRecord(model) && typeof model.outputs === 'function' && typeof model.evaluate === 'function' &&
      (model.inputs === undefined || typeof model.inputs === 'function') && (model.validate === undefined || typeof model.validate === 'function'),
    'IMPLEMENTATIONS', `${type} needs outputs/evaluate functions and optional inputs/validate functions.`);
    environment.models[type] = Object.freeze({ ...model, implementation: Object.freeze(implementation(model)) });
  }
  for (const [id, adapter] of Object.entries(adapters)) {
    insist(isRecord(adapter) && typeof adapter.apply === 'function', 'IMPLEMENTATIONS', `${id} needs an adapter apply function.`);
    environment.adapters[id] = Object.freeze({ implementation: Object.freeze(implementation(adapter)), input: descriptor(adapter.input), output: descriptor(adapter.output), apply: adapter.apply });
  }
  Object.freeze(environment.models); Object.freeze(environment.adapters); Object.freeze(environment.limits);
  const prepareGraph = graph => {
    const structural = validateProject(graph);
    return structural.valid ? analyze(graph, environment) : structural;
  };
  const prepared = cacheByRevision(project => {
    const graph = project.snapshot();
    return { graph, inspected: prepareGraph(graph) };
  });
  const inspect = input => {
    try {
      const graph = copyData(input);
      const structural = validateProject(graph);
      if (!structural.valid) return structural;
      const { valid, errors } = analyze(graph, environment);
      return { valid, errors };
    } catch (error) { return { valid: false, errors: [issue(error)] }; }
  };
  return Object.freeze({
    validators: Object.freeze({ structure: Object.freeze([graph => analyze(graph, environment).errors]) }),
    limits: Object.freeze({ ...environment.limits }),
    author: draft => author(draft, environment),
    inspect,
    // Expose resolved F02 contracts for composition layers (e.g. visual ports),
    // without letting those layers invent a second scientific descriptor system.
    describe(input, { includeDependencies = false } = {}) {
      try {
        const inspected = input instanceof Project ? prepared(input).inspected : prepareGraph(copyData(input));
        if (!inspected.outputs) return { ...copyData(inspected), outputs: {} };
        const result = { valid: inspected.valid, errors: copyData(inspected.errors), outputs: copyData(Object.fromEntries(inspected.outputs)) };
        if (includeDependencies) result.dependencies = Object.fromEntries(
          [...inspected.dependencies].map(([id, dependencies]) => [id, [...dependencies].sort()]));
        return result;
      } catch (error) { return { valid: false, errors: [issue(error)], outputs: {} }; }
    },
    dependencies(input, id) {
      const graph = copyData(input);
      const structural = validateProject(graph);
      insist(structural.valid, 'INVALID_PROJECT', 'Dependency inspection needs a structurally valid graph.');
      const inspected = analyze(graph, environment);
      insist(inspected.dependencies.has(id), 'UNKNOWN_ID', `Unknown node ${id}.`);
      return [...inspected.dependencies.get(id)].sort();
    },
    evaluate: (project, id, options = {}) => evaluate(project, id, options, environment, prepared),
  });
}
