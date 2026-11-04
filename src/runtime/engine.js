import { Project } from '../core/index.js';
import { copyData, isRecord } from '../core/data.js';
import { value } from '../dataflow/index.js';
import { applyDefaults, validateData } from '../registry/index.js';
import { bytes, closeTime, equal, failed, fields, fingerprint, insist, invoke, issue, seconds, timeOf } from './contracts.js';

const emptyMetadata = () => ({ warnings: [], approximation: [] });
function mergeMetadata(...items) {
  const warnings = new Map(), approximation = new Set();
  for (const item of items) {
    for (const warning of item?.warnings ?? []) warnings.set(JSON.stringify(warning), warning);
    for (const assumption of item?.approximation ?? []) approximation.add(assumption);
  }
  return { warnings: [...warnings.values()], approximation: [...approximation] };
}

// One worker owns one immutable project revision and a bounded analytic cache.
// Stateful checkpoints and per-job counters remain separate from this plan.
export function prepareComputation(registry, graph, limits) {
  const base = registry.bind(), project = Project.from(graph, { validators: base.validators });
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const records = new Map(base.computations.map(record => [record.manifest.id, record]));
  const analysis = base.flow.describe(project, { includeDependencies: true });
  insist(analysis.valid, 'INVALID_PROJECT', analysis.errors[0]?.message ?? 'Cannot resolve scientific dependencies.');
  const dependencies = new Map(Object.entries(analysis.dependencies));
  const samples = new Map(), models = new Map();
  let size = 0;
  const plan = {
    project, nodes, records, dependencies, execute: null,
    binding: registry.bind({ execute: args => plan.execute(args) }),
    get(key) { return (samples.get(key) ?? models.get(key))?.data; },
    put(key, data, dataBytes, series = false) {
      const entryBytes = dataBytes + Buffer.byteLength(key, 'utf8');
      const target = series ? samples : models;
      if (entryBytes > limits.maxResultBytes || target.has(key)) return;
      // A fixed grid remains useful across display instants. Do not let the
      // many short-lived model snapshots from a second grid flush the first.
      while (models.size + samples.size >= limits.maxSnapshots || size + entryBytes > limits.maxResultBytes) {
        const evict = models.size ? models : samples;
        if (!series && !models.size) return;
        const oldest = evict.keys().next().value;
        size -= evict.get(oldest).size; evict.delete(oldest);
      }
      target.set(key, { data, size: entryBytes }); size += entryBytes;
    },
  };
  return plan;
}

// Runs entirely in a bounded worker. It schedules registered model steps;
// equations, random generators and integration algorithms stay in extensions.
export function runComputation({ registry, graph, plan, identity, nodeId, request, cached, limits, progress }) {
  const requested = seconds(request.time), targetPort = request.port;
  const runtime = { requestedTime: timeOf(requested), achievedTime: null, path: request.mode,
    steps: 0, work: 0, inputIdentity: null, settings: {}, components: [] };
  let lastProgress = -Infinity;
  const report = (phase, node, time) => {
    if (phase === 'complete' || performance.now() - lastProgress >= limits.progressIntervalMs) {
      lastProgress = performance.now();
      progress({ phase, nodeId: node ?? nodeId, time: time === undefined ? null : timeOf(time),
        requestedTime: timeOf(requested), steps: runtime.steps, work: runtime.work });
    }
  };
  const charge = amount => {
    runtime.work += amount;
    insist(runtime.work <= limits.maxWork, 'WORK_BUDGET', `Runtime work exceeds ${limits.maxWork}.`);
  };
  const call = (fn, argument) => { charge(1); return invoke(fn, argument); };
  try {
    report('validating');
    plan ??= prepareComputation(registry, graph, limits);
    const { project, nodes, records, dependencies, binding } = plan;
    insist(nodes.has(nodeId), 'UNKNOWN_ID', `Unknown producing node ${nodeId}.`);
    const pathFor = node => {
      const record = records.get(node.type);
      const preferred = node.id === nodeId ? request.mode : 'auto';
      if (!record) {
        insist(preferred !== 'stateful', 'CAPABILITY_UNSUPPORTED', 'Built-in calculations have no stateful lifecycle.');
        return 'analytic';
      }
      const paths = record.manifest.runtime.paths;
      const path = preferred === 'auto' ? (paths.includes('analytic') ? 'analytic' : 'stateful') : preferred;
      insist(paths.includes(path), 'CAPABILITY_UNSUPPORTED', `${node.id} does not advertise ${path} evaluation.`, node.id);
      return path;
    };
    const closure = [], visited = new Set();
    function visit(id) {
      if (visited.has(id)) return;
      visited.add(id);
      for (const dependency of dependencies.get(id)) visit(dependency);
      closure.push(id);
    }
    visit(nodeId);
    const stateful = closure.filter(id => pathFor(nodes.get(id)) === 'stateful');
    const settings = new Map();
    for (const [id, input] of Object.entries(request.settings)) {
      insist(nodes.has(id) && records.has(nodes.get(id).type) && isRecord(input), 'RUNTIME_SETTINGS', `Settings must name an installed scientific component: ${id}.`);
    }
    for (const id of closure) if (records.has(nodes.get(id).type)) {
      const node = nodes.get(id);
      const schema = records.get(node.type).manifest.runtime.settings;
      const data = applyDefaults(schema, request.settings[node.id] ?? {});
      const errors = validateData(schema, data);
      insist(!errors.length, 'RUNTIME_SETTINGS', `Invalid settings for ${node.id}: ${errors[0]?.message ?? ''}`, node.id);
      settings.set(node.id, data);
    }
    const identities = new Map();
    function inputIdentity(id) {
      if (identities.has(id)) return identities.get(id);
      const node = nodes.get(id), record = records.get(node.type);
      const hash = fingerprint({ node, settings: settings.get(id) ?? {}, path: pathFor(node),
        implementation: record?.manifest.implementation ?? null,
        inputs: dependencies.get(id).map(dependency => [dependency, inputIdentity(dependency)]) });
      identities.set(id, hash); return hash;
    }
    runtime.path = stateful.length ? 'stateful' : 'analytic';
    runtime.inputIdentity = inputIdentity(nodeId);
    runtime.settings = Object.fromEntries(closure.filter(id => settings.has(id)).map(id => [id, settings.get(id)]));
    const imported = new Map();
    function validateCheckpoint(input) {
      const checkpoint = copyData(input);
      fields(checkpoint, ['schemaVersion', 'identity', 'nodeId', 'implementation', 'inputIdentity', 'settings', 'time', 'random', 'metadata', 'payload'], 'checkpoint');
      insist(checkpoint.schemaVersion === 1 && isRecord(checkpoint.identity) && typeof checkpoint.nodeId === 'string' && Object.hasOwn(checkpoint, 'payload'), 'CHECKPOINT_SCHEMA', 'Malformed or unsupported checkpoint.');
      const node = nodes.get(checkpoint.nodeId), record = records.get(node?.type);
      insist(record && stateful.includes(node.id), 'CHECKPOINT_INCOMPATIBLE', 'Checkpoint requires a stateful component in this job dependency closure.');
      insist(checkpoint.identity.projectId === identity.projectId && typeof checkpoint.identity.generation === 'string' &&
        Number.isSafeInteger(checkpoint.identity.revision) && checkpoint.identity.revision >= 0 &&
        equal(checkpoint.implementation, record.manifest.implementation) && checkpoint.inputIdentity === inputIdentity(node.id) &&
        equal(checkpoint.settings, settings.get(node.id)), 'CHECKPOINT_INCOMPATIBLE', 'Checkpoint project, implementation, inputs or numerical settings differ.', node.id);
      seconds(checkpoint.time);
      checkpoint.metadata = value({ kind: 'scalar', data: 0, unit: '1', meaning: 'checkpoint-metadata', metadata: checkpoint.metadata ?? emptyMetadata() }).metadata;
      return checkpoint;
    }
    const supplied = request.checkpoints ?? [];
    insist(supplied.length <= limits.maxSnapshots && bytes(supplied) <= limits.maxCheckpointBytes, 'CHECKPOINT_BUDGET', 'Imported checkpoints exceed the runtime limit.');
    for (const checkpoint of cached) {
      try { const checked = validateCheckpoint(checkpoint); imported.set(checked.nodeId, checked); }
      catch { /* Automatic cache misses restart from initial conditions. */ }
    }
    const explicit = new Set();
    for (const checkpoint of supplied) {
      const checked = validateCheckpoint(checkpoint);
      insist(!explicit.has(checked.nodeId), 'CHECKPOINT_SCHEMA', 'Explicit checkpoints must have distinct node IDs.');
      explicit.add(checked.nodeId); imported.set(checked.nodeId, checked);
    }
    const memo = new Map(), strategies = new Map();
    let memoBytes = 0;
    function stateRecord(record, output) {
      fields(output, ['state', 'random', 'time', 'done'], 'lifecycle state');
      insist(Object.hasOwn(output, 'state') && Object.hasOwn(output, 'random'), 'STATE_SCHEMA', 'A lifecycle snapshot needs state and explicit random state.');
      const time = seconds(output.time), algorithm = record.manifest.runtime.stateful.random.algorithm;
      insist(algorithm === null ? output.random === null : isRecord(output.random) && output.random.algorithm === algorithm && Object.hasOwn(output.random, 'state'),
        'RANDOM_STATE', 'Retain the declared generator algorithm and its full state, or explicit null for deterministic models.');
      const result = { state: output.state, random: output.random, time: timeOf(time), metadata: emptyMetadata() };
      insist(bytes(result) <= limits.maxStateBytes, 'STATE_BUDGET', 'Lifecycle state exceeds its byte limit.');
      return result;
    }
    const key = (id, time) => JSON.stringify([id, time]);
    function remember(id, target, snapshot) {
      const idKey = key(id, target), old = memo.get(idKey);
      memoBytes += bytes(snapshot) - (old ? bytes(old.snapshot) : 0);
      insist(memoBytes <= limits.maxStateBytes, 'STATE_BUDGET', 'Memoized lifecycle states exceed the aggregate byte limit.');
      insist(old || memo.size < limits.maxSnapshots, 'SNAPSHOT_BUDGET', 'Runtime snapshot count exceeded.');
      memo.set(idKey, { nodeId: id, snapshot });
      return snapshot;
    }
    const evaluated = new Map();
    const read = (id, port, time) => {
      const cacheKey = JSON.stringify([id, port, time]);
      if (evaluated.has(cacheKey)) return evaluated.get(cacheKey);
      const result = binding.evaluate(project, id, { port, time: timeOf(time) });
      charge(result.metadata.work);
      if (!result.valid) {
        const error = result.diagnostics.find(item => item.severity !== 'warning') ?? result.diagnostics[0];
        insist(false, error.code, error.message, error.path);
      }
      // Old scientific reads are disposable; retain a bounded cache instead of
      // limiting the length of a model's evolution to the cache size.
      insist(bytes(result.value) <= limits.maxResultBytes, 'RESULT_BUDGET', 'Scientific snapshot exceeds the byte limit.');
      if (evaluated.size >= limits.maxSnapshots) evaluated.delete(evaluated.keys().next().value);
      evaluated.set(cacheKey, result.value);
      while ([...evaluated.values()].reduce((sum, item) => sum + bytes(item), 0) > limits.maxResultBytes) evaluated.delete(evaluated.keys().next().value);
      return result.value;
    };
    const inputsAt = (node, time) => Object.fromEntries(Object.entries(node.data.inputs).map(([slot, declaration]) =>
      [slot, read(node.references[`input.${slot}`], declaration.port, time)]));
    function ensure(node, target) {
      if (memo.has(key(node.id, target))) return memo.get(key(node.id, target)).snapshot;
      const record = records.get(node.type), lifecycle = record.implementation.stateful;
      const config = record.manifest.runtime.stateful, initial = seconds(config.initialTime);
      insist(target >= initial || closeTime(target, initial), 'TIME_RANGE', `${node.id} cannot evolve before its declared initial time.`, node.id);
      let snapshot = null;
      for (const entry of memo.values()) if (entry.nodeId === node.id && seconds(entry.snapshot.time) <= target &&
        (!snapshot || seconds(entry.snapshot.time) > seconds(snapshot.time))) snapshot = entry.snapshot;
      if (snapshot) strategies.set(node.id, strategies.get(node.id) ?? 'memo');
      const checkpoint = imported.get(node.id);
      if (!snapshot && checkpoint && seconds(checkpoint.time) <= target) {
        const restored = call(lifecycle.restore, { node, settings: settings.get(node.id), checkpoint: checkpoint.payload });
        snapshot = stateRecord(record, restored);
        insist(equal(snapshot.time, timeOf(seconds(checkpoint.time))) && equal(snapshot.random, checkpoint.random), 'CHECKPOINT_INCOMPATIBLE', 'Restored time/random state differs from checkpoint metadata.');
        snapshot.metadata = checkpoint.metadata;
        strategies.set(node.id, 'checkpoint');
      }
      if (!snapshot) {
        const inputs = inputsAt(node, initial);
        snapshot = stateRecord(record, call(lifecycle.initialize, { node, inputs, settings: settings.get(node.id), request: { time: timeOf(initial) } }));
        insist(closeTime(seconds(snapshot.time), initial), 'STATE_TIME', 'Initialization must return the declared initial time.');
        snapshot.metadata = mergeMetadata(...Object.values(inputs).map(input => input.metadata));
        strategies.set(node.id, checkpoint || [...memo.values()].some(item => item.nodeId === node.id) ? 'reset-replay' : 'initialize');
      }
      insist(seconds(snapshot.time) >= initial || closeTime(seconds(snapshot.time), initial), 'STATE_TIME', 'State precedes the declared initial time.');
      while (!closeTime(seconds(snapshot.time), target)) {
        insist(runtime.steps < limits.maxSteps, 'STEP_BUDGET', `Job exceeded ${limits.maxSteps} advancement calls.`, node.id);
        const before = seconds(snapshot.time), inputs = inputsAt(node, before);
        report('advancing', node.id, before);
        const next = call(lifecycle.advance, { node, inputs, settings: settings.get(node.id), state: snapshot.state,
          random: snapshot.random, time: snapshot.time, targetTime: timeOf(target) });
        runtime.steps++;
        insist(typeof next.done === 'boolean', 'STATE_SCHEMA', 'advance must report done explicitly.');
        const updated = stateRecord(record, next), after = seconds(updated.time);
        insist(after >= before && (after <= target || closeTime(after, target)), 'STATE_TIME', 'Advancement must move forward without overshooting the target.');
        insist(after > before || next.done, 'STATE_PROGRESS', 'An unfinished advancement step must make physical-time progress.');
        updated.metadata = mergeMetadata(snapshot.metadata, ...Object.values(inputs).map(input => input.metadata));
        snapshot = updated;
        if (next.done) break;
      }
      const actual = seconds(snapshot.time);
      insist(config.sampling === 'at-or-before' || closeTime(actual, target), 'STATE_TIME', 'An exact-sampling component stopped before its target.');
      const component = { nodeId: node.id, implementation: record.manifest.implementation,
        inputIdentity: inputIdentity(node.id), settings: settings.get(node.id),
        requestedTime: timeOf(target), time: snapshot.time, random: snapshot.random,
        sampling: config.sampling, strategy: strategies.get(node.id) };
      const previous = runtime.components.findIndex(item => item.nodeId === node.id);
      if (previous < 0) runtime.components.push(component); else runtime.components[previous] = component;
      return remember(node.id, target, snapshot);
    }
    const modelOutputs = new Map();
    let modelBytes = 0;
    plan.execute = ({ manifest, implementation, node, inputs, request: evaluationRequest }) => {
      // F02 memoizes a graph evaluation; this cache shares whole model output
      // maps across the scheduler's separate port/dependency reads at one time.
      const outputKey = key(node.id, seconds(evaluationRequest.time));
      const persistentKey = stateful.length ? null : JSON.stringify(['model', inputIdentity(node.id), evaluationRequest.time]);
      if (persistentKey) {
        const previous = plan.get(persistentKey);
        if (previous) return previous;
      } else if (modelOutputs.has(outputKey)) return modelOutputs.get(outputKey).outputs;
      let outputs;
      if (pathFor(node) === 'stateful') {
        const snapshot = ensure(node, seconds(evaluationRequest.time));
        insist(closeTime(seconds(snapshot.time), seconds(evaluationRequest.time)), 'SNAPSHOT_TIME_MISMATCH', `${node.id} reached ${seconds(snapshot.time)} s for a dependency request at ${seconds(evaluationRequest.time)} s; explicit alignment is required.`, node.id);
        outputs = call(implementation.stateful.extract, { node, inputs, settings: settings.get(node.id),
          state: snapshot.state, random: snapshot.random, time: snapshot.time, request: evaluationRequest });
        insist(isRecord(outputs), 'OUTPUT_PORT', 'extract must return a scientific output map.');
        for (const output of Object.values(outputs)) insist(output.time && closeTime(seconds(output.time), seconds(snapshot.time)), 'STATE_TIME', 'Extracted stateful outputs must identify the achieved physical time.');
        outputs = Object.fromEntries(Object.entries(outputs).map(([port, output]) => [port, value({ ...output, metadata: mergeMetadata(output.metadata, snapshot.metadata) })]));
      } else outputs = call(implementation.evaluate, { node, inputs, request: evaluationRequest, settings: settings.get(node.id) });
      insist(isRecord(outputs), 'OUTPUT_PORT', `${manifest.id} must return its output map.`);
      const normalized = Object.fromEntries(Object.entries(outputs).map(([port, output]) => [port, value({ ...output,
        metadata: mergeMetadata(output.metadata, ...Object.values(inputs).map(input => input.metadata)) })]));
      const size = bytes(normalized);
      insist(size <= limits.maxResultBytes, 'RESULT_BUDGET', 'Model output snapshot exceeds the byte limit.');
      if (persistentKey) { plan.put(persistentKey, normalized, size); return normalized; }
      while (modelOutputs.size >= limits.maxSnapshots || modelBytes + size > limits.maxResultBytes) {
        const oldest = modelOutputs.keys().next().value;
        modelBytes -= modelOutputs.get(oldest).size;
        modelOutputs.delete(oldest);
      }
      modelOutputs.set(outputKey, { outputs: normalized, size }); modelBytes += size;
      return normalized;
    };
    // First find actual stateful coordinates, then evaluate the complete result
    // at one coherent scientific time. Incompatible grids require an adapter;
    // the scheduler never relabels a sample or invents interpolation.
    const snapshots = stateful.map(id => [id, ensure(nodes.get(id), requested)]);
    const achieved = snapshots.length ? seconds(snapshots[0][1].time) : requested;
    runtime.components = snapshots.map(([id, snapshot]) => ({ nodeId: id, implementation: records.get(nodes.get(id).type).manifest.implementation,
      inputIdentity: inputIdentity(id), settings: settings.get(id), requestedTime: timeOf(requested), time: snapshot.time, random: snapshot.random,
      sampling: records.get(nodes.get(id).type).manifest.runtime.stateful.sampling, strategy: strategies.get(id) }));
    insist(snapshots.every(([, snapshot]) => closeTime(seconds(snapshot.time), achieved)), 'SNAPSHOT_TIME_MISMATCH', 'Stateful dependencies reached different times; supply an explicit alignment model.');
    runtime.achievedTime = timeOf(achieved);
    report('extracting', nodeId, achieved);
    // A sampler owns an explicit grid. Its value and sampling metadata are
    // independent of the surrounding display clock, including on backwards seeks.
    const seriesKey = !stateful.length && nodes.get(nodeId).type === 'dataflow.sample'
      ? JSON.stringify(['series', runtime.inputIdentity, targetPort]) : null;
    const previous = seriesKey && plan.get(seriesKey);
    const result = previous ? copyData(previous) : binding.evaluate(project, nodeId, { port: targetPort, time: timeOf(achieved) });
    if (previous) result.metadata.work = 0;
    else if (seriesKey && result.valid) plan.put(seriesKey, copyData(result), bytes(result), true);
    charge(result.metadata.work);
    result.identity = copyData(identity);
    result.request = { time: copyData(request.time) };
    result.metadata.runtime = runtime;
    result.checkpoints = [];
    if (result.valid) {
      for (const [id, snapshot] of snapshots) {
        const node = nodes.get(id), record = records.get(node.type);
        const payload = call(record.implementation.stateful.checkpoint, { node, inputs: inputsAt(node, achieved),
          settings: settings.get(id), state: snapshot.state, random: snapshot.random, time: snapshot.time, request: { time: snapshot.time } });
        result.checkpoints.push({ schemaVersion: 1, identity: copyData(identity), nodeId: id,
          implementation: record.manifest.implementation, inputIdentity: inputIdentity(id), settings: settings.get(id),
          time: snapshot.time, random: snapshot.random, metadata: snapshot.metadata, payload });
      }
      insist(bytes(result.checkpoints) <= limits.maxCheckpointBytes, 'CHECKPOINT_BUDGET', 'Produced checkpoints exceed the aggregate byte limit.');
      if (!closeTime(achieved, requested)) {
        const warning = { code: 'TIME_APPROXIMATION', path: nodeId, message: 'Returned the declared sample at or before the requested time; no interpolation was applied.' };
        result.value = value({ ...result.value, metadata: mergeMetadata(result.value.metadata, { warnings: [warning], approximation: ['Stateful result uses the reported achieved time.'] }) });
        result.diagnostics.push({ ...warning, severity: 'warning' });
        result.metadata.approximation = result.value.metadata.approximation;
        result.metadata.sampling.policy = 'at-or-before';
      }
    }
    report('complete', nodeId, achieved);
    return result;
  } catch (error) {
    const result = failed(identity, nodeId, request, error);
    result.metadata.runtime = runtime;
    return result;
  } finally { if (plan) plan.execute = null; }
}
