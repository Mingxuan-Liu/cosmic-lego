import { Project, validateProject } from '../core/index.js';
import { copyData } from '../core/data.js';
import { value, instant, timeEqual, checkPort, convertValue, binaryValue, mapValue, reduceValue, fieldValue } from './values.js';
import { TYPES, builtinImplementation, countValues, diagnostic, exactKeys, insist, invoke, issue, reject } from './contracts.js';
import { analyze, descriptor, inputId, membersOf } from './graph.js';

const identical = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function producerOf(node, environment) {
  return node?.type === TYPES.adapt ? environment.adapters[node.data.adapter]?.implementation ?? null
    : environment.models[node?.type]?.implementation ?? (node?.type.startsWith('dataflow.') ? builtinImplementation : null);
}

function collect(node, graph, get, charge) {
  const members = membersOf(node, graph);
  const element = descriptor(node.data.element);
  const values = members.map(member => {
    const source = get(member.id, member.port);
    charge(countValues(source.data) + countValues(source.coordinates?.values));
    const converted = convertValue(source, element.unit);
    const errors = checkPort(element.reference === null ? { ...converted, reference: null } : converted, element);
    if (errors.length) reject(errors[0].code, `${member.id}: ${errors[0].message}`);
    return converted;
  });
  const time = values.length ? values[0].time : null;
  for (const current of values) insist(timeEqual(current.time, time), 'TIME_MISMATCH', 'Collection members must describe the same physical time.');
  const warnings = values.flatMap(v => v.metadata.warnings);
  if (element.reference === null && values.some(v => v.reference !== null)) warnings.push(diagnostic('COLLECTION_REFERENCES', 'Collection members retain their source node identities in objectIds; grouping does not establish a common physical reference.', node.id, 'warning'));
  const base = { kind: 'collection', shape: [values.length, ...element.shape], data: values.map(v => v.data),
    unit: element.unit, meaning: element.meaning, reference: element.reference, frame: element.frame, normalization: element.normalization,
    objectIds: members.map(member => member.id), time,
    metadata: { warnings, approximation: [...new Set(values.flatMap(v => v.metadata.approximation))] },
  };
  return value(base);
}

export function evaluate(project, nodeId, options, environment) {
  insist(project instanceof Project, 'PROJECT_REQUIRED', 'Evaluate an accepted F01 Project instance.');
  const identity = project.token;
  const graph = project.snapshot();
  const node = graph.nodes.find(item => item.id === nodeId);
  const port = options.port ?? 'value';
  const envelope = {
    identity: copyData(identity), producer: { nodeId, port, implementation: copyData(producerOf(node, environment)) },
    request: null, value: null, valid: false, diagnostics: [],
    metadata: { approximation: [], sampling: { policy: 'declared-coordinates' }, implementations: [], work: 0 },
  };
  try {
    insist(Object.keys(options).every(key => ['port', 'time'].includes(key)), 'REQUEST', 'Supported request fields are port and time.');
    insist(typeof port === 'string' && port.trim().length > 0, 'REQUEST', 'An output port must be a nonempty string.');
    const timeInput = copyData(options.time ?? { value: 0, unit: 's' });
    exactKeys(timeInput, ['value', 'unit'], 'request.time');
    const request = { time: instant(timeInput) };
    envelope.request = request;
    const structural = validateProject(graph);
    if (!structural.valid) { envelope.diagnostics = structural.errors; return envelope; }
    const inspected = analyze(graph, environment);
    if (!inspected.valid) { envelope.diagnostics = inspected.errors; return envelope; }
    insist(node, 'UNKNOWN_ID', `Unknown producing node ${nodeId}.`);
    const used = new Map();
    let work = 0;
    const charge = count => {
      work += count;
      envelope.metadata.work = work;
      insist(work <= environment.limits.maxWork, 'WORK_BUDGET', `Evaluation exceeds ${environment.limits.maxWork} work units.`);
    };
    // Each physical instant has a fresh memo. All instants share one work budget.
    const evaluateAt = (request, target, selectedPort) => {
      const memo = new Map();
      const get = (id, outputPort) => {
        if (!memo.has(id)) visit(id);
        const output = memo.get(id)?.[outputPort];
        insist(output, 'OUTPUT_PORT', `No evaluated output ${id}.${outputPort}.`);
        return output;
      };
      const visit = id => {
        const current = inspected.nodes.get(id);
        insist(current, 'UNKNOWN_ID', `Unknown input ${id}.`);
        charge(1);
        // Effective dependencies already passed F01 cycle and F02 depth checks.
        if (current.type !== TYPES.sample) for (const dependency of inspected.dependencies.get(id)) if (!memo.has(dependency)) visit(dependency);
        const inputs = current.type === TYPES.sample ? {} : Object.fromEntries(Object.entries(current.data.inputs ?? {}).map(([slot, binding]) => [slot, get(inputId(current, slot), binding.port)]));
        // Cached inputs still cost work when each consumer reads/processes them.
        // Count numeric/missing entries on consumption as well as production.
        if (current.type !== TYPES.selection) {
          charge(Object.values(inputs).reduce((sum, input) => sum + countValues(input.data) + countValues(input.coordinates?.values), 0));
        }
        let output;
        switch (current.type) {
          case TYPES.sample: {
            const schedule = inspected.outputs.get(id).value.coordinates;
            const samples = schedule.values.map(t => evaluateAt({ time: { value: t, unit: schedule.unit } },
              inputId(current, 'source'), current.data.inputs.source.port));
            const warnings = new Map(samples.flatMap(v => v.metadata.warnings).map(w => [JSON.stringify(w), w]));
            output = { value: value({ ...inspected.outputs.get(id).value, data: samples.map(v => v.data),
              metadata: { warnings: [...warnings.values()], approximation: [...new Set(samples.flatMap(v => v.metadata.approximation))] } }) };
            break;
          }
          case TYPES.constant: output = { value: value(current.data.value) }; break;
          case TYPES.selection: output = { value: collect(current, graph, get, charge) }; break;
          case TYPES.field: output = { value: fieldValue(inputs.source, current.data.indices) }; break;
          case TYPES.arithmetic:
            output = { value: binaryValue(current.data.op, inputs.left, inputs.right, {
              ...(current.data.comparison ? { comparison: current.data.comparison } : {}),
              ...(current.data.alignment ? { alignment: current.data.alignment } : {}),
            }) }; break;
          case TYPES.map: output = { value: mapValue(current.data.op, inputs.source) }; break;
          case TYPES.reduce: output = { value: reduceValue(current.data.op, inputs.source) }; break;
          case TYPES.adapt: {
            const adapter = environment.adapters[current.data.adapter];
            const errors = checkPort(inputs.source, adapter.input);
            if (errors.length) reject(errors[0].code, errors[0].message);
            output = { value: value(invoke(adapter.apply, inputs.source)) };
            break;
          }
          default: {
            const model = environment.models[current.type];
            insist(model, 'IMPLEMENTATION_MISSING', `No evaluator is installed for ${current.type}.`);
            const requirements = model.inputs ? invoke(model.inputs, current) : {};
            for (const [slot, requirement] of Object.entries(requirements)) {
              const errors = checkPort(inputs[slot], requirement);
              if (errors.length) reject(errors[0].code, errors[0].message);
            }
            output = invoke(model.evaluate, { node: current, inputs, request });
          }
        }
        const declared = inspected.outputs.get(id) ?? {};
        insist(output && typeof output === 'object' && !Array.isArray(output) && Object.keys(output).length === Object.keys(declared).length &&
          Object.keys(output).every(name => Object.hasOwn(declared, name)), 'OUTPUT_PORT', `Implementation ${current.type} did not return its declared output ports.`);
        const normalized = {};
        for (const [name, input] of Object.entries(output)) {
          const size = countValues(input.data) + countValues(input.coordinates?.values);
          insist(size <= environment.limits.maxValues, 'VALUE_BUDGET', `Output ${id}.${name} exceeds ${environment.limits.maxValues} entries.`);
          charge(size);
          const v = value(input);
          if (v.time !== null && v.kind !== 'series') {
            insist(timeEqual(v.time, request.time),
              'TIME_MISMATCH', `${id}.${name} describes a different physical time from the request; reevaluate or explicitly align the input.`);
          }
          const errors = checkPort(v, declared[name]);
          if (errors.length) reject(errors[0].code, `${id}.${name}: ${errors[0].message}`);
          normalized[name] = v;
        }
        const implementation = producerOf(current, environment);
        used.set(identical(implementation, null) ? id : JSON.stringify(implementation), implementation);
        memo.set(id, normalized);
      };
      return get(target, selectedPort);
    };
    const computed = evaluateAt(request, nodeId, port);
    insist(identical(identity, project.token), 'STALE_RESULT', 'Project changed during evaluation; discard this result.');
    envelope.value = copyData(computed);
    envelope.valid = true;
    envelope.diagnostics = computed.metadata.warnings.map(warning => ({ ...warning, severity: 'warning' }));
    envelope.metadata.approximation = [...computed.metadata.approximation];
    envelope.metadata.implementations = [...used.values()].map(copyData);
    envelope.metadata.sampling = {
      policy: computed.metadata.warnings.some(warning => warning.code === 'INTERPOLATED') ? 'linear-right-to-left' : 'declared-coordinates',
      coordinates: copyData(computed.coordinates), time: copyData(computed.time),
    };
  } catch (error) {
    envelope.diagnostics.push(issue(error, nodeId));
  }
  if (!identical(identity, project.token)) {
    envelope.valid = false; envelope.value = null;
    if (!envelope.diagnostics.some(d => d.code === 'STALE_RESULT')) envelope.diagnostics.push(diagnostic('STALE_RESULT', 'Project changed during evaluation; discard this result.', nodeId));
  }
  return envelope;
}
