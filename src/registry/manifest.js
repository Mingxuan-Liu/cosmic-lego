import { KernelError } from '../core/index.js';
import { copyData, freezeData, isId, isRecord } from '../core/data.js';
import { checkPort, unit, sameDimensions } from '../dataflow/index.js';
import { validateSchema, validateData, applyDefaults } from './schema.js';

export const API_VERSION = 1;
export const MANIFEST_VERSION = 1;
const own = (object, key) => Object.hasOwn(object, key);
const text = v => typeof v === 'string' && !!v.trim();
const version = v => typeof v === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v);
const namespaced = v => isId(v) && /[.:-]/.test(v) && v.split(/[.:-]/).every(part => part.length > 0) && !v.startsWith('dataflow.');
const kinds = ['model', 'operator', 'asset-factory', 'view-adapter'];
const portFields = ['kind', 'shape', 'unit', 'meaning', 'reference', 'frame', 'normalization', 'coordinates', 'time', 'objectIds'];
const requiredPortFields = ['kind', 'shape', 'unit', 'meaning', 'reference', 'frame', 'normalization'];
function reject(code, message, path = '$', errors) {
  throw new KernelError(code, message, { path, validation: { valid: false, errors: errors ?? [{ code, path, message }] } });
}
function insist(condition, message, path = '$', code = 'INVALID_MANIFEST') { if (!condition) reject(code, message, path); }
function fields(object, allowed, required, path) {
  insist(isRecord(object), 'Expected an object.', path);
  for (const key of Object.keys(object)) insist(allowed.includes(key), `Unsupported manifest field ${key}.`, `${path}.${key}`);
  for (const key of required) insist(own(object, key), `Missing required field ${key}.`, `${path}.${key}`);
}
function strings(items, path, { nonempty = false, identifiers = false } = {}) {
  insist(Array.isArray(items) && (!nonempty || items.length > 0), 'Expected an array of strings.', path);
  insist(items.every(item => identifiers ? isId(item) : text(item)), 'Expected nonempty strings or supported identifiers.', path);
  insist(new Set(items).size === items.length, 'Duplicate entries are not allowed.', path);
}
function records(items, path, visit, nonempty = false) {
  insist(Array.isArray(items) && (!nonempty || items.length > 0), 'Expected an array of records.', path);
  items.forEach((item, index) => visit(item, `${path}[${index}]`));
}
function schema(input, path) {
  const validation = validateSchema(input);
  if (!validation.valid) reject('INVALID_SCHEMA', `Invalid schema at ${path}.`, path, validation.errors.map(d => ({ ...d, path: `${path}${d.path.slice(1)}` })));
  insist(input.type === 'object', 'Parameters and artifact roots require object schemas.', path);
}
function reference(item, path, evidence = false) {
  fields(item, ['title', 'locator', ...(evidence ? ['reviewer', 'date'] : [])], ['title', 'locator'], path);
  insist(text(item.title) && text(item.locator), 'Reference title and locator must be nonempty.', path);
  if (own(item, 'reviewer')) insist(text(item.reviewer), 'Reviewer must be nonempty.', `${path}.reviewer`);
  if (own(item, 'date')) {
    insist(typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && !Number.isNaN(Date.parse(`${item.date}T00:00:00Z`)) && new Date(`${item.date}T00:00:00Z`).toISOString().slice(0, 10) === item.date, 'Evidence date must be a valid YYYY-MM-DD date.', `${path}.date`);
  }
}

export function matchesVersion(actual, required) {
  return version(actual) && version(required) && actual === required;
}

function binding(input, parameters, path) {
  if (!isRecord(input) || (!own(input, '$param') && !own(input, '$node'))) return null;
  insist(Object.keys(input).length === 1, 'Bindings must contain exactly one $param or $node key.', path, 'PORT_TEMPLATE');
  if (own(input, '$node')) {
    insist(input.$node === 'id', 'Only the current node ID can be bound.', path, 'PORT_TEMPLATE');
    return { kind: 'node' };
  }
  insist(typeof input.$param === 'string' && own(parameters.properties, input.$param), 'A $param binding must name a declared top-level parameter.', path, 'PORT_TEMPLATE');
  return { kind: 'parameter', name: input.$param };
}

function substitute(template, parameters, nodeId, parameterSchema, path, mode = 'resolve', root = template) {
  const token = binding(template, parameterSchema, path);
  if (token) {
    if (token.kind === 'node') return nodeId;
    if (mode === 'resolve') {
      insist(own(parameters, token.name), `Bound parameter ${token.name} is missing.`, path, 'PORT_TEMPLATE');
      return copyData(parameters[token.name]);
    }
    const rule = parameterSchema.properties[token.name];
    if (own(rule, 'default')) return copyData(rule.default);
    if (rule.enum) return copyData(rule.enum[0]);
    // Stand-ins check the surrounding static descriptor only. Real parameter
    // values are checked again against the full F02 contract on instantiation.
    if (path.endsWith('.unit')) return path.includes('.time.') || (path.includes('.coordinates.') && root.kind === 'series') ? 's' : 'm';
    if (path.endsWith('.kind')) return path.includes('.frame.') ? 'direction' : path.includes('.coordinates.') ? (root.kind === 'series' ? 'time' : 'space') : Array.isArray(root.shape) && root.shape.length ? (root.shape.length === 1 && root.shape[0] === 3 ? 'vector' : 'collection') : 'scalar';
    if (path.endsWith('.frame')) return { id: 'bound-frame', kind: 'direction' };
    if (path.endsWith('.normalization') || path.endsWith('.time') || path.endsWith('.coordinates') || path.endsWith('.objectIds')) return null;
    if (path.endsWith('.shape')) return root.kind === 'vector' ? [3] : ['collection', 'field', 'series'].includes(root.kind) ? (root.frame !== null && root.frame !== undefined ? [null, 3] : [null]) : [];
    if (/\.shape\[\d+\]$/.test(path)) return root.kind === 'vector' || path.endsWith('[1]') ? 3 : Array.isArray(root.coordinates?.values) ? root.coordinates.values.length : Array.isArray(root.objectIds) ? root.objectIds.length : 1;
    if (path.endsWith('.coordinates.values')) {
      const length = Array.isArray(root.shape) && Number.isSafeInteger(root.shape[0]) ? root.shape[0] : 0;
      insist(length <= 100000, 'Template coordinate sample exceeds the registration limit.', path, 'PORT_TEMPLATE');
      return Array.from({ length }, (_, index) => root.kind === 'field' ? [index, 0, 0] : index);
    }
    if (/\.coordinates\.values\[\d+\]$/.test(path)) return root.kind === 'field' ? [0, 0, 0] : Number(path.match(/\[(\d+)\]$/)[1]);
    if (/\.coordinates\.values\[\d+\]\[\d+\]$/.test(path) || path.endsWith('.time.value')) return 0;
    if (path.endsWith('.scale')) return 1;
    if (path.includes('.dimensions.')) return 1;
    if (path.endsWith('.dimensions')) return { length: 1 };
    return 'bound-value';
  }
  if (Array.isArray(template)) return template.map((item, index) => substitute(item, parameters, nodeId, parameterSchema, `${path}[${index}]`, mode, root));
  if (isRecord(template)) {
    for (const key of Object.keys(template)) insist(!key.startsWith('$'), 'Unsupported template directive.', `${path}.${key}`, 'PORT_TEMPLATE');
    return Object.fromEntries(Object.entries(template).map(([key, item]) => [key, substitute(item, parameters, nodeId, parameterSchema, `${path}.${key}`, mode, root)]));
  }
  return template;
}

function normalizePort(input, path) {
  fields(input, portFields, requiredPortFields, path);
  const errors = checkPort(input, input);
  if (errors.length) reject(errors[0].code, `Invalid port ${path}: ${errors[0].message}`, path, errors);
  const result = copyData(input);
  result.unit = unit(result.unit);
  if (result.coordinates !== null && result.coordinates !== undefined) result.coordinates.unit = unit(result.coordinates.unit);
  if (result.time !== null && result.time !== undefined) result.time.unit = unit(result.time.unit);
  return result;
}

function hasBinding(template) {
  if (Array.isArray(template)) return template.some(hasBinding);
  if (isRecord(template)) return own(template, '$param') || own(template, '$node') || Object.values(template).some(hasBinding);
  return false;
}

function prepareRuntime(manifest) {
  const mode = manifest.science.evaluation.mode;
  if (!own(manifest, 'runtime')) {
    insist(['analytic', 'stateless'].includes(mode), 'Stateful and hybrid definitions require explicit runtime lifecycle metadata.', '$.runtime', 'RUNTIME_CONTRACT');
    manifest.runtime = { paths: ['analytic'], settings: { type: 'object', properties: {}, required: [], additionalProperties: false } };
  }
  const runtime = manifest.runtime;
  fields(runtime, ['paths', 'settings', 'stateful'], ['paths', 'settings'], '$.runtime');
  strings(runtime.paths, '$.runtime.paths', { nonempty: true });
  insist(runtime.paths.every(path => ['analytic', 'stateful'].includes(path)), 'Runtime paths must be analytic and/or stateful.', '$.runtime.paths', 'RUNTIME_CONTRACT');
  const expected = mode === 'hybrid' ? ['analytic', 'stateful'] : mode === 'stateful' ? ['stateful'] : ['analytic'];
  insist(runtime.paths.length === expected.length && expected.every(path => runtime.paths.includes(path)), 'Runtime paths must match the declared scientific evaluation mode.', '$.runtime.paths', 'RUNTIME_CONTRACT');
  runtime.paths = expected;
  schema(runtime.settings, '$.runtime.settings');
  const stateful = runtime.paths.includes('stateful');
  insist(own(runtime, 'stateful') === stateful, 'Stateful lifecycle metadata is required exactly when the stateful path is declared.', '$.runtime.stateful', 'RUNTIME_CONTRACT');
  if (stateful) {
    fields(runtime.stateful, ['initialTime', 'sampling', 'random'], ['initialTime', 'sampling', 'random'], '$.runtime.stateful');
    fields(runtime.stateful.initialTime, ['value', 'unit'], ['value', 'unit'], '$.runtime.stateful.initialTime');
    const normalized = unit(runtime.stateful.initialTime.unit);
    insist(Number.isFinite(runtime.stateful.initialTime.value) && sameDimensions(normalized, 's') &&
      Number.isFinite(runtime.stateful.initialTime.value * normalized.scale), 'Stateful initialTime needs a finite value in physical seconds and a time unit.', '$.runtime.stateful.initialTime', 'RUNTIME_CONTRACT');
    runtime.stateful.initialTime.unit = normalized;
    insist(['exact', 'at-or-before'].includes(runtime.stateful.sampling), 'Stateful sampling must declare exact or at-or-before.', '$.runtime.stateful.sampling', 'RUNTIME_CONTRACT');
    fields(runtime.stateful.random, ['algorithm'], ['algorithm'], '$.runtime.stateful.random');
    insist(runtime.stateful.random.algorithm === null || text(runtime.stateful.random.algorithm), 'Random-state metadata must declare an algorithm identity or explicit null.', '$.runtime.stateful.random.algorithm', 'RUNTIME_CONTRACT');
  }
}

export function prepareManifest(input) {
  let manifest;
  try { manifest = copyData(input); }
  catch (error) { reject('INVALID_MANIFEST', error.message); }
  const required = ['schemaVersion', 'apiVersion', 'id', 'version', 'implementation', 'kind', 'parameters', 'ports', 'dependencies', 'capabilities', 'documentation', 'diagnostics'];
  fields(manifest, [...required, 'science', 'artifact', 'assets', 'runtime'], required, '$');
  insist(manifest.schemaVersion === MANIFEST_VERSION && manifest.apiVersion === API_VERSION, 'Unsupported manifest/API version.', '$', 'UNSUPPORTED_VERSION');
  insist(namespaced(manifest.id), 'Use a namespaced extension ID outside dataflow.*.', '$.id');
  insist(version(manifest.version), 'Extension versions use exact N.N.N; ranges and prereleases are unsupported.', '$.version', 'INVALID_VERSION');
  fields(manifest.implementation, ['id', 'version', 'build'], ['id', 'version', 'build'], '$.implementation');
  insist(text(manifest.implementation.id) && text(manifest.implementation.build), 'Implementation ID and build must be nonempty.', '$.implementation');
  insist(version(manifest.implementation.version), 'Implementation versions use exact N.N.N.', '$.implementation.version', 'INVALID_VERSION');
  insist(kinds.includes(manifest.kind), 'Unsupported extension kind.', '$.kind');
  schema(manifest.parameters, '$.parameters');
  fields(manifest.ports, ['inputs', 'outputs'], ['inputs', 'outputs'], '$.ports');
  for (const direction of ['inputs', 'outputs']) {
    insist(isRecord(manifest.ports[direction]), 'Ports must be a named map.', `$.ports.${direction}`);
    for (const [slot, template] of Object.entries(manifest.ports[direction])) {
      const path = `$.ports.${direction}.${slot}`;
      insist(isId(slot), 'Port slots need supported stable identifiers.', path);
      fields(template, portFields, requiredPortFields, path);
      normalizePort(substitute(template, {}, 'bound-node', manifest.parameters, path, 'sample'), path);
      if (!hasBinding(template)) manifest.ports[direction][slot] = normalizePort(template, path);
    }
  }
  const dependencyIds = new Set();
  records(manifest.dependencies, '$.dependencies', (dependency, path) => {
    fields(dependency, ['id', 'version', 'build'], ['id', 'version'], path);
    insist(namespaced(dependency.id) && !dependencyIds.has(dependency.id), 'Dependencies require distinct namespaced IDs.', path);
    insist(dependency.id !== manifest.id, 'An extension cannot depend on itself.', path);
    insist(version(dependency.version), 'Dependency requirements use exact N.N.N versions.', `${path}.version`, 'INVALID_VERSION');
    if (own(dependency, 'build')) insist(text(dependency.build), 'Dependency build must be nonempty.', `${path}.build`);
    dependencyIds.add(dependency.id);
  });
  strings(manifest.capabilities, '$.capabilities', { identifiers: true });
  fields(manifest.documentation, ['summary', 'links', 'examples'], ['summary', 'links', 'examples'], '$.documentation');
  insist(text(manifest.documentation.summary), 'Documentation summary must be nonempty.', '$.documentation.summary');
  records(manifest.documentation.links, '$.documentation.links', (link, path) => {
    fields(link, ['title', 'url'], ['title', 'url'], path);
    let parsed; try { parsed = new URL(link.url); } catch { reject('INVALID_MANIFEST', 'Documentation links need absolute HTTP(S) URLs.', path); }
    insist(text(link.title) && typeof link.url === 'string' && ['https:', 'http:'].includes(parsed.protocol), 'Documentation links need a title and absolute HTTP(S) URL.', path);
  });
  records(manifest.documentation.examples, '$.documentation.examples', (example, path) => {
    fields(example, ['parameters'], ['parameters'], path);
    const errors = validateData(manifest.parameters, applyDefaults(manifest.parameters, example.parameters), `${path}.parameters`);
    if (errors.length) reject('INVALID_MANIFEST', 'Documented example parameters violate the schema.', path, errors);
  });
  const codes = new Set();
  records(manifest.diagnostics, '$.diagnostics', (item, path) => {
    fields(item, ['code', 'description'], ['code', 'description'], path);
    insist(text(item.code) && text(item.description) && !codes.has(item.code), 'Diagnostics need distinct codes and nonempty descriptions.', path);
    codes.add(item.code);
  });
  const scientific = ['model', 'operator'].includes(manifest.kind);
  if (scientific) {
    insist(own(manifest, 'science') && !own(manifest, 'artifact') && !own(manifest, 'assets'), 'Scientific extensions require science and cannot declare visual artifacts/assets.');
    insist(Object.keys(manifest.ports.outputs).length > 0, 'Scientific extensions need output ports.', '$.ports.outputs');
    const science = manifest.science;
    fields(science, ['equations', 'references', 'assumptions', 'applicability', 'evaluation', 'review'], ['equations', 'references', 'assumptions', 'applicability', 'evaluation', 'review'], '$.science');
    strings(science.equations, '$.science.equations', { nonempty: true });
    records(science.references, '$.science.references', reference, true);
    strings(science.assumptions, '$.science.assumptions', { nonempty: true });
    const guardIds = new Set();
    records(science.applicability, '$.science.applicability', (guard, path) => {
      fields(guard, ['id', 'description'], ['id', 'description'], path);
      insist(isId(guard.id) && text(guard.description) && !guardIds.has(guard.id), 'Applicability guards require distinct IDs and descriptions.', path);
      guardIds.add(guard.id);
    });
    fields(science.evaluation, ['mode', 'sampling'], ['mode', 'sampling'], '$.science.evaluation');
    insist(['analytic', 'stateless', 'stateful', 'hybrid'].includes(science.evaluation.mode), 'Unsupported scientific evaluation mode.', '$.science.evaluation.mode');
    strings(science.evaluation.sampling, '$.science.evaluation.sampling', { nonempty: true });
    insist(science.evaluation.sampling.every(mode => ['instant', 'stored-series'].includes(mode)), 'Unsupported sampling behavior.', '$.science.evaluation.sampling');
    fields(science.review, ['status', 'notes', 'evidence'], ['status', 'notes', 'evidence'], '$.science.review');
    insist(['experimental', 'reviewed'].includes(science.review.status) && text(science.review.notes), 'Review needs status and explicit notes.', '$.science.review');
    records(science.review.evidence, '$.science.review.evidence', (item, path) => reference(item, path, true), science.review.status === 'reviewed');
    prepareRuntime(manifest);
  } else {
    insist(own(manifest, 'artifact') && !own(manifest, 'science') && !own(manifest, 'runtime'), 'Visual extensions require artifact metadata and cannot declare scientific lifecycle metadata.');
    insist(Object.keys(manifest.ports.outputs).length === 0, 'Visual artifacts are separate from scientific output ports.', '$.ports.outputs');
    const artifact = manifest.artifact;
    fields(artifact, ['kind', 'format', 'schema', 'provenance'], ['kind', 'format', 'schema', 'provenance'], '$.artifact');
    const allowed = manifest.kind === 'view-adapter' ? ['view'] : ['geometry', 'material', 'data'];
    insist(allowed.includes(artifact.kind) && text(artifact.format), 'Artifact kind/format does not match its extension.', '$.artifact');
    schema(artifact.schema, '$.artifact.schema');
    fields(artifact.provenance, ['source', 'license'], ['source', 'license'], '$.artifact.provenance');
    insist(text(artifact.provenance.source) && text(artifact.provenance.license), 'Artifact provenance requires source and license.', '$.artifact.provenance');
    manifest.assets ??= {};
    insist(isRecord(manifest.assets), 'Assets must be a named map.', '$.assets');
    for (const [slot, requirement] of Object.entries(manifest.assets)) {
      fields(requirement, ['kind', 'format'], ['kind', 'format'], `$.assets.${slot}`);
      insist(isId(slot) && ['geometry', 'material', 'data', 'view'].includes(requirement.kind) && text(requirement.format), 'Asset slots need supported kind/format.', `$.assets.${slot}`);
    }
  }
  return freezeData(manifest);
}

export function resolvePorts(manifest, input) {
  const node = copyData(input);
  insist(isRecord(node) && isId(node.id) && isRecord(node.data) && isRecord(node.data.parameters), 'Port resolution requires node ID and data.parameters.', '$', 'PORT_TEMPLATE');
  const errors = validateData(manifest.parameters, node.data.parameters, '$.data.parameters');
  if (errors.length) reject('PARAMETERS', 'Node parameters violate the manifest schema.', '$.data.parameters', errors);
  const resolved = {};
  for (const direction of ['inputs', 'outputs']) resolved[direction] = Object.fromEntries(Object.entries(manifest.ports[direction]).map(([slot, template]) => {
    const path = `$.ports.${direction}.${slot}`;
    const descriptor = substitute(template, node.data.parameters, node.id, manifest.parameters, path);
    return [slot, normalizePort(descriptor, path)];
  }));
  return freezeData(resolved);
}
