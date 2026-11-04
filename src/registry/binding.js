import { Project, validateProject } from '../core/index.js';
import { copyData, isRecord } from '../core/data.js';
import { createDataflow, checkPort, unit, value } from '../dataflow/index.js';
import { applyDefaults, validateData } from './schema.js';
import { resolvePorts } from './manifest.js';
import { inspectRequirements } from './requirements.js';
import { validateSuppliedResult } from './results.js';
import { SCIENTIFIC, artifactSize, diagnostic, diagnostics, identityEqual, invoke, issue, keys, reject, requireThat, tokenEqual } from './contracts.js';

const nodeKind = kind => kind === 'model' ? 'component' : kind === 'operator' ? 'calculation' : 'presentation';

function validateRecord(record, node) {
  const errors = [];
  const { manifest, implementation } = record;
  try {
    keys(node.data, ['parameters', 'inputs', 'extension'], `${node.id}.data`);
    requireThat(node.kind === nodeKind(manifest.kind), 'EXTENSION_KIND', `${manifest.id} must use node kind ${nodeKind(manifest.kind)}.`);
    const pin = node.data.extension;
    requireThat(isRecord(pin) && pin.id === manifest.id && pin.version === manifest.version && identityEqual(pin.implementation, manifest.implementation) && Object.keys(pin).length === 3,
      'EXTENSION_PIN', `${node.id} must pin the installed extension version and implementation/build.`);
    errors.push(...validateData(manifest.parameters, node.data.parameters, `${node.id}.parameters`));
    if (errors.length) return errors;
    resolvePorts(manifest, node);
    if (implementation.validate) errors.push(...diagnostics(invoke(implementation.validate, node)));
    for (const guard of Object.values(implementation.guards)) errors.push(...diagnostics(invoke(guard, node)).map(item => ({ ...item, category: 'applicability' })));
  } catch (error) { errors.push(issue(error, node.id)); }
  return errors;
}

function linksFor(draft, inputs, assets) {
  const references = Object.create(null), declarations = Object.create(null), dependencies = [];
  requireThat(isRecord(inputs) && isRecord(assets), 'INPUT_DECLARATION', 'inputs and assets must be slot maps.');
  for (const [slot, input] of Object.entries(inputs)) {
    const reference = input && typeof input === 'object' && Object.hasOwn(input, 'node') ? input : { node: input, port: 'value' };
    keys(reference, ['node', 'port'], `input ${slot}`);
    requireThat(typeof reference.port === 'string' && !!reference.port, 'INPUT_DECLARATION', `Input ${slot} needs a port.`);
    const id = draft.idOf(reference.node);
    references[`input.${slot}`] = id;
    declarations[slot] = { port: reference.port };
    dependencies.push(id);
  }
  for (const [slot, asset] of Object.entries(assets)) {
    const id = draft.idOf(asset);
    references[`asset.${slot}`] = id;
    dependencies.push(id);
  }
  return { references, inputs: declarations, dependsOn: [...new Set(dependencies)] };
}

function visualErrors(record, node, graph, outputDescriptions, records) {
  const errors = validateRecord(record, node);
  if (errors.length) return errors;
  const ports = resolvePorts(record.manifest, node);
  const inputs = node.data.inputs;
  try {
    requireThat(isRecord(inputs), 'INPUT_DECLARATION', 'Visual inputs must be a slot map.');
    requireThat(Object.keys(inputs).length === Object.keys(ports.inputs).length && Object.keys(inputs).every(slot => Object.hasOwn(ports.inputs, slot)),
      'MISSING_INPUT', `${node.id} inputs must match its declared ports.`);
    const expectedReferences = [...Object.keys(inputs).map(slot => `input.${slot}`), ...Object.keys(record.manifest.assets ?? {}).map(slot => `asset.${slot}`)].sort();
    requireThat(JSON.stringify(Object.keys(node.references).sort()) === JSON.stringify(expectedReferences), 'INPUT_DECLARATION', `${node.id} references must exactly declare its scientific and artifact inputs.`);
    requireThat(JSON.stringify([...node.dependsOn].sort()) === JSON.stringify([...new Set(Object.values(node.references))].sort()),
      'DEPENDENCY_DECLARATION', `${node.id} dependencies must include scientific and artifact inputs.`);
    for (const [slot, input] of Object.entries(inputs)) {
      keys(input, ['port'], `${node.id}.inputs.${slot}`);
      requireThat(typeof input.port === 'string' && input.port, 'INPUT_DECLARATION', 'An input port name must be a nonempty string.');
      const id = node.references[`input.${slot}`];
      const output = outputDescriptions[id];
      requireThat(output && Object.hasOwn(output, input.port), 'OUTPUT_PORT', `No scientific output ${id}.${input.port}.`);
      errors.push(...checkPort(output[input.port], ports.inputs[slot]));
    }
    for (const [slot, requirement] of Object.entries(record.manifest.assets ?? {})) {
      const target = graph.nodes.find(item => item.id === node.references[`asset.${slot}`]);
      const artifact = records.get(target?.type)?.manifest.artifact;
      requireThat(artifact && artifact.kind === requirement.kind && artifact.format === requirement.format,
        'ARTIFACT_MISMATCH', `${node.id}.${slot} requires ${requirement.kind}/${requirement.format}.`);
    }
  } catch (error) { errors.push(issue(error, node.id)); }
  return errors;
}

export function bindRegistry(records, capabilities, registryLimits, limits = {}, execute, graphValidators = []) {
  const models = Object.create(null);
  for (const [id, record] of records) if (SCIENTIFIC.has(record.manifest.kind)) {
    models[id] = {
      implementation: record.manifest.implementation,
      analytic: record.manifest.runtime.paths.includes('analytic'),
      inputs: node => resolvePorts(record.manifest, node).inputs,
      outputs: node => resolvePorts(record.manifest, node).outputs,
      validate: node => validateRecord(record, node),
      evaluate: argument => {
        if (execute) return invoke(data => execute(Object.freeze({ ...data, manifest: record.manifest, implementation: record.implementation })), argument);
        requireThat(record.manifest.runtime.paths.includes('analytic'), 'RUNTIME_REQUIRED', `${record.manifest.id} needs a stateful runtime; synchronous registry evaluation does not advance state.`);
        return invoke(record.implementation.evaluate, argument);
      },
    };
  }
  const flow = createDataflow({ models, limits });
  const requirements = graph => inspectRequirements(graph, records, capabilities);
  const inspect = input => {
    try {
      const graph = copyData(input);
      const core = validateProject(graph);
      if (!core.valid) return core;
      const required = requirements(graph);
      if (!required.valid) return { valid: false, errors: required.errors };
      const described = flow.describe(graph);
      if (!described.valid) return { valid: false, errors: described.errors };
      const errors = [];
      for (const node of graph.nodes) {
        const record = records.get(node.type);
        if (record && !SCIENTIFIC.has(record.manifest.kind)) errors.push(...visualErrors(record, node, graph, described.outputs, records));
      }
      if (!errors.length) for (const validate of graphValidators) errors.push(...diagnostics(invoke(validate, graph)));
      return { valid: !errors.length, errors };
    } catch (error) { return { valid: false, errors: [issue(error)] }; }
  };
  const binding = {
    flow,
    // Executable handles are available only to the trusted composition root and
    // scheduler. Serializable discovery continues to expose manifests, not code.
    computations: Object.freeze([...records.values()].filter(record => SCIENTIFIC.has(record.manifest.kind))
      .map(record => Object.freeze({ manifest: record.manifest, implementation: record.implementation }))),
    visuals: Object.freeze([...records.values()].filter(record => !SCIENTIFIC.has(record.manifest.kind))
      .map(record => Object.freeze({ manifest: record.manifest, implementation: record.implementation }))),
    validators: Object.freeze({ structure: Object.freeze([graph => inspect(graph).errors]) }),
    requirements,
    inspect,
    author(draft) {
      return Object.freeze({ ...flow.author(draft), instantiate(id, options = {}) {
        keys(options, ['id', 'parameters', 'inputs', 'assets'], 'instance options');
        const record = records.get(id);
        requireThat(record, 'EXTENSION_MISSING', `Register ${id} before instantiating it.`);
        const manifest = record.manifest;
        const links = linksFor(draft, options.inputs ?? {}, options.assets ?? {});
        return draft.create({ ...(options.id === undefined ? {} : { id: options.id }), kind: nodeKind(manifest.kind), type: id,
          data: { parameters: applyDefaults(manifest.parameters, options.parameters ?? {}), inputs: links.inputs,
            extension: { id, version: manifest.version, implementation: copyData(manifest.implementation) } },
          references: links.references, dependsOn: links.dependsOn });
      } });
    },
    evaluate(project, id, request = {}) {
      requireThat(project instanceof Project, 'PROJECT_REQUIRED', 'Use an accepted F01 Project.');
      const identity = project.token;
      const checked = inspect(project.snapshot());
      if (!checked.valid || !tokenEqual(identity, project.token)) return {
        identity, producer: { nodeId: id, port: request.port ?? 'value', implementation: null }, request: copyData(request),
        value: null, valid: false, diagnostics: checked.valid ? [diagnostic('STALE_RESULT', 'Project changed during validation.')] : checked.errors,
        metadata: { approximation: [], sampling: {}, implementations: [], work: 0 },
      };
      return flow.evaluate(project, id, request);
    },
    produce(project, id, options = {}) {
      requireThat(project instanceof Project, 'PROJECT_REQUIRED', 'Use an accepted F01 Project.');
      const identity = project.token, graph = project.snapshot();
      const node = graph.nodes.find(item => item.id === id);
      const result = { identity, producer: { nodeId: id, implementation: copyData(records.get(node?.type)?.manifest.implementation ?? null) }, valid: false, artifact: null, diagnostics: [] };
      try {
        keys(options, ['time', 'results'], 'artifact request');
        const requestedTime = copyData(options.time ?? { value: 0, unit: 's' });
        keys(requestedTime, ['value', 'unit'], 'request.time');
        const timeUnit = unit(requestedTime.unit);
        requireThat(Number.isFinite(requestedTime.value) && Number.isFinite(requestedTime.value * timeUnit.scale) && JSON.stringify(timeUnit.dimensions) === JSON.stringify(unit('s').dimensions), 'INVALID_TIME', 'Artifact inputs need a finite physical time.');
        const request = { time: { value: requestedTime.value, unit: timeUnit } };
        const checked = inspect(graph);
        if (!checked.valid) { result.diagnostics = checked.errors; return result; }
        requireThat(tokenEqual(identity, project.token), 'STALE_RESULT', 'Project changed during artifact validation.');
        requireThat(node, 'UNKNOWN_ID', `Unknown artifact node ${id}.`);
        const supplied = new Map();
        if (options.results !== undefined) {
          requireThat(Array.isArray(options.results), 'RESULT_REQUIRED', 'Supplied scientific results must be an array.');
          for (const entry of copyData(options.results)) {
            requireThat(isRecord(entry.producer) && typeof entry.producer.nodeId === 'string' && typeof entry.producer.port === 'string', 'RESULT_REQUIRED', 'Each result needs its producing node and port.');
            const key = JSON.stringify([entry.producer.nodeId, entry.producer.port]);
            requireThat(!supplied.has(key), 'RESULT_REQUIRED', 'Duplicate scientific result for one node/port.');
            supplied.set(key, entry);
          }
        }
        const memo = new Map();
        let totalEntries = 0;
        const create = current => {
          if (memo.has(current.id)) return memo.get(current.id);
          const record = records.get(current.type);
          requireThat(record?.manifest.artifact, 'ARTIFACT_REQUIRED', `${current.id} is not an artifact/view extension.`);
          const inputs = Object.create(null), assets = Object.create(null);
          const expected = resolvePorts(record.manifest, current).inputs;
          for (const [slot, declaration] of Object.entries(current.data.inputs)) {
            const sourceId = current.references[`input.${slot}`];
            let evaluated = options.results === undefined
              ? flow.evaluate(project, sourceId, { ...request, port: declaration.port })
              : supplied.get(JSON.stringify([sourceId, declaration.port]));
            requireThat(evaluated, 'RESULT_REQUIRED', `A checked snapshot for ${sourceId}.${declaration.port} is required; visual production does not recompute missing snapshots.`);
            if (options.results === undefined && evaluated.valid !== true) {
              const error = evaluated.diagnostics.find(item => item.severity !== 'warning') ?? evaluated.diagnostics[0];
              reject(error.code, error.message, error.path);
            }
            requireThat(tokenEqual(identity, project.token) && (options.results !== undefined || tokenEqual(identity, evaluated.identity)), 'STALE_RESULT', 'Artifact input belongs to a different project snapshot.');
            if (options.results !== undefined) {
              const source = graph.nodes.find(item => item.id === sourceId);
              const installed = records.get(source.type)?.manifest.implementation ?? { id: 'cosmic-lego.dataflow', version: '1' };
              const sourceDescription = flow.describe(graph).outputs[sourceId]?.[declaration.port];
              requireThat(sourceDescription, 'OUTPUT_PORT', 'A supplied result must name an installed scientific output.');
              evaluated = validateSuppliedResult(evaluated, { identity, nodeId: sourceId, port: declaration.port,
                implementation: installed, descriptor: sourceDescription, time: request.time });
            }
            const normalizedValue = value(evaluated.value);
            const errors = checkPort(normalizedValue, expected[slot]);
            if (errors.length) reject(errors[0].code, errors[0].message, errors[0].path);
            result.diagnostics.push(...evaluated.diagnostics);
            inputs[slot] = normalizedValue;
          }
          for (const slot of Object.keys(record.manifest.assets ?? {})) {
            assets[slot] = create(graph.nodes.find(item => item.id === current.references[`asset.${slot}`]));
          }
          const data = invoke(record.implementation.create, { node: current, inputs, assets, request });
          const size = artifactSize(data);
          totalEntries += size;
          requireThat(totalEntries <= registryLimits.maxArtifactEntries, 'ARTIFACT_BUDGET', `Artifacts exceed ${registryLimits.maxArtifactEntries} entries/string characters.`);
          const errors = validateData(record.manifest.artifact.schema, data, `${current.id}.artifact`);
          if (errors.length) reject('ARTIFACT_SCHEMA', errors[0].message, errors[0].path);
          const artifact = { kind: record.manifest.artifact.kind, format: record.manifest.artifact.format, data, provenance: copyData(record.manifest.artifact.provenance) };
          memo.set(current.id, artifact);
          return artifact;
        };
        result.artifact = create(node);
        requireThat(tokenEqual(identity, project.token), 'STALE_RESULT', 'Project changed during artifact production.');
        result.valid = true;
      } catch (error) { result.artifact = null; result.diagnostics.push(issue(error, id)); }
      return result;
    },
  };
  return Object.freeze(binding);
}
