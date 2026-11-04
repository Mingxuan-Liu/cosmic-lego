import { createHash } from 'node:crypto';
import { validateTimeline } from '../timeline/definition.js';
import { compileTimelineConfigurations } from '../timeline/configurations.js';
import { Project, validateProject } from '../core/index.js';
import { copyData, fail, freezeData, isId, isRecord } from '../core/data.js';
import { unit } from '../dataflow/index.js';
import { applyDefaults, validateData } from '../registry/index.js';
import { canonical, equal, fingerprint, RUNTIME_LIMITS, seconds } from '../runtime/contracts.js';

export const PORTABLE_FORMAT = 'cosmic-lego.project';
export const PORTABLE_VERSION = 1;
export const PORTABLE_LIMITS = Object.freeze({ maxBytes: 16 * 1024 * 1024, maxEntries: 500000, maxGraphBytes: RUNTIME_LIMITS.maxGraphBytes,
  maxResources: 32, maxSourceFileBytes: 262144, maxSourceBytes: 2097152, maxTimelineBytes: 16384,
  maxDataSources: 256, maxTargets: 256, maxMessages: 200, maxTranscriptBytes: 524288, maxReceipts: 256 });
const originalGraphPath = '_portable/original-construction.json';
const reconstructionPath = '_portable/reconstruction.mjs';
const size = data => Buffer.byteLength(JSON.stringify(data));
const digestText = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const boundedText = (value, maximum) => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const check = (condition, code, message, path = '$') => { if (!condition) fail(code, message, { path }); };
function fields(record, allowed, required = allowed, path = '$') {
  check(isRecord(record), 'PORTABLE_SCHEMA', `${path} must be a data object.`, path);
  for (const key of Object.keys(record)) check(allowed.includes(key), 'PORTABLE_SCHEMA', `Unsupported field ${path}.${key}.`, `${path}.${key}`);
  for (const key of required) check(Object.hasOwn(record, key), 'PORTABLE_SCHEMA', `Missing field ${path}.${key}.`, `${path}.${key}`);
}
function list(value, maximum, path) {
  check(Array.isArray(value) && value.length <= maximum, 'PORTABLE_BUDGET', `${path} must be an array of at most ${maximum} entries.`, path);
}
function token(value, projectId) {
  fields(value, ['projectId', 'generation', 'revision']);
  check(isId(value.projectId) && value.projectId === projectId && isId(value.generation) && Number.isSafeInteger(value.revision) && value.revision >= 0,
    'PORTABLE_IDENTITY', 'A saved identity must name this project and a historical generation/revision.');
}
function requireValid(result) {
  if (!result.valid) {
    const first = result.errors[0];
    fail(first?.code ?? 'INVALID_PROJECT', first?.message ?? 'Invalid project construction.', { path: first?.path ?? '$', validation: result });
  }
}
function logicalPath(path) {
  check(boundedText(path, 256) && path === path.normalize('NFC') && path.split('/').every(segment => /^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*$/u.test(segment) && !segment.endsWith('.')),
    'RESOURCE_PATH', 'Resource names must be safe relative paths inside the inline project.');
  return path;
}
// A compact array of zeros or shared JavaScript subtree can expand to
// millions of copied entries while still fitting the transport byte limit.
function boundedCopy(input) {
  let entries = 0, characters = 0;
  const active = new Set();
  function scan(item, depth) {
    check(++entries <= PORTABLE_LIMITS.maxEntries && depth <= 100, 'PORTABLE_BUDGET', 'Portable data exceeds the depth or entry limit.');
    if (typeof item === 'string') characters += item.length;
    check(characters <= PORTABLE_LIMITS.maxBytes, 'PORTABLE_BUDGET', 'Portable data exceeds the text limit.');
    if (item === null || typeof item !== 'object') return;
    check(!active.has(item), 'INVALID_DATA', 'Portable data cannot contain cycles.');
    if (Array.isArray(item)) check(item.length <= PORTABLE_LIMITS.maxEntries - entries, 'PORTABLE_BUDGET', 'Portable array exceeds the entry limit.');
    active.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      check(typeof key === 'string' && Object.hasOwn(descriptor, 'value'), 'INVALID_DATA', 'Portable records require plain data properties.');
      characters += key.length;
      scan(descriptor.value, depth + 1);
    }
    active.delete(item);
  }
  scan(input, 0);
  return copyData(input);
}
function readInput(input) {
  if (input instanceof Uint8Array) {
    check(input.byteLength <= PORTABLE_LIMITS.maxBytes, 'PORTABLE_BUDGET', 'Portable input exceeds the byte limit.');
    try { input = new TextDecoder('utf-8', { fatal: true }).decode(input); } catch { fail('PORTABLE_ENCODING', 'Portable project files require valid UTF-8.'); }
  }
  if (typeof input === 'string') {
    check(Buffer.byteLength(input) <= PORTABLE_LIMITS.maxBytes, 'PORTABLE_BUDGET', 'Portable input exceeds the byte limit.');
    try { input = JSON.parse(input); } catch { fail('PORTABLE_JSON', 'Portable project JSON is malformed.'); }
  }
  const manifest = boundedCopy(input);
  check(size(manifest) <= PORTABLE_LIMITS.maxBytes, 'PORTABLE_BUDGET', 'Portable manifest exceeds the byte limit.');
  return manifest;
}

// Host-installed, synchronous migrations run before the current format reader.
// A document cannot supply executable migration code or choose its module.
export function createMigrationRegistry() {
  const steps = new Map();
  return Object.freeze({
    register(fromVersion, toVersion, migrate) {
      check(Number.isSafeInteger(fromVersion) && fromVersion >= 0 && toVersion === fromVersion + 1 && toVersion <= PORTABLE_VERSION && typeof migrate === 'function' && !steps.has(fromVersion),
        'PORTABLE_MIGRATION', 'Register one trusted migration per supported consecutive version.');
      steps.set(fromVersion, migrate);
      return this;
    },
    migrate(input) {
      let document = readInput(input);
      while (document.version !== PORTABLE_VERSION) {
        const previous = document.version, step = steps.get(previous);
        check(document.format === PORTABLE_FORMAT && step, 'PORTABLE_VERSION', 'No installed migration supports this format version.');
        const next = step(freezeData(document));
        if (next instanceof Promise) { next.catch(() => {}); fail('PORTABLE_MIGRATION', 'Portable migrations must finish synchronously.'); }
        document = readInput(next);
        check(document.format === PORTABLE_FORMAT && document.version === previous + 1, 'PORTABLE_MIGRATION', 'Migration must produce the next version of the same format.');
      }
      return document;
    },
  });
}

export function portableGraphHash(graph) { return fingerprint(copyData(graph)); }
export function portableSourceStatus(graph, manifest) {
  if (manifest.source.original === null) return 'unavailable';
  return portableGraphHash(graph) === manifest.source.original.producedGraphHash ? 'matches' : 'diverged';
}

function sourceBundle(graph, input) {
  const resources = [], names = new Set();
  let authoredBytes = 0;
  function add(path, content, mediaType) {
    logicalPath(path);
    check(!names.has(path.toLowerCase()), 'RESOURCE_DUPLICATE', 'Every inline resource needs a unique logical path.');
    names.add(path.toLowerCase());
    const sha256 = digestText(content);
    resources.push({ path, mediaType, content, sha256 });
    return sha256;
  }
  function authored(file) {
    fields(file, ['path', 'language', 'text']);
    logicalPath(file.path);
    check(!file.path.toLowerCase().startsWith('_portable/'), 'RESOURCE_PATH', 'The _portable resource directory is reserved.');
    check(boundedText(file.language, 80) && typeof file.text === 'string', 'PORTABLE_SOURCE', 'Recipe files need a language label and inert source text.');
    const byteLength = Buffer.byteLength(file.text);
    authoredBytes += byteLength;
    check(byteLength <= PORTABLE_LIMITS.maxSourceFileBytes && authoredBytes <= PORTABLE_LIMITS.maxSourceBytes, 'PORTABLE_BUDGET', 'Authored source exceeds its byte limit.');
    return { path: file.path, language: file.language, sha256: add(file.path, file.text, 'text/plain') };
  }
  let original = null;
  if (input !== null) {
    fields(input, ['path', 'language', 'text', 'producedGraph', 'files'], ['path', 'language', 'text', 'producedGraph']);
    const files = input.files ?? [];
    list(files, PORTABLE_LIMITS.maxResources - 3, 'source.files');
    check(size(input.producedGraph) <= PORTABLE_LIMITS.maxGraphBytes && input.producedGraph?.id === graph.id, 'PORTABLE_SOURCE', 'The original recipe must identify the construction it produced for this project.');
    // Historical source may have used an extension absent from the current
    // graph. Keep its F01 graph as inert history, outside playback requirements.
    requireValid(validateProject(input.producedGraph));
    const entry = authored({ path: input.path, language: input.language, text: input.text });
    const dependencies = files.map(authored);
    const producedGraphHash = add(originalGraphPath, canonical(input.producedGraph), 'application/json');
    original = { ...entry, files: dependencies, producedGraphPath: originalGraphPath, producedGraphHash };
  }
  const reconstructionText = `// Generated reconstruction of the accepted graph. Supply the installed validators.\nexport function reconstruct(Project, validators) {\n  const graph = JSON.parse(${JSON.stringify(canonical(graph))});\n  return Project.from(graph, { validators });\n}\n`;
  const reconstruction = { path: reconstructionPath, language: 'javascript', sha256: add(reconstructionPath, reconstructionText, 'text/plain'), producedGraphHash: fingerprint(graph) };
  return { source: { original, reconstruction }, resources };
}

function sourceInput(manifest) {
  fields(manifest.source, ['original', 'reconstruction']);
  list(manifest.resources, PORTABLE_LIMITS.maxResources, 'resources');
  const resources = new Map(), folded = new Set();
  for (const resource of manifest.resources) {
    fields(resource, ['path', 'mediaType', 'content', 'sha256']);
    logicalPath(resource.path);
    check(!folded.has(resource.path.toLowerCase()), 'RESOURCE_DUPLICATE', 'Inline resource paths must be unique.');
    folded.add(resource.path.toLowerCase());
    check(['text/plain', 'application/json'].includes(resource.mediaType) && typeof resource.content === 'string' && resource.sha256 === digestText(resource.content),
      'RESOURCE_INTEGRITY', 'An inline resource is missing or its content hash differs.', resource.path);
    resources.set(resource.path, resource);
  }
  const get = (path, hash, mediaType) => {
    logicalPath(path);
    const resource = resources.get(path);
    check(resource && resource.sha256 === hash && resource.mediaType === mediaType, 'RESOURCE_MISSING', 'Required inline content, format or identity is unavailable.', path);
    return resource.content;
  };
  const original = manifest.source.original;
  const decode = entry => ({ path: entry.path, language: entry.language, text: get(entry.path, entry.sha256, 'text/plain') });
  if (original === null) return null;
  fields(original, ['path', 'language', 'sha256', 'files', 'producedGraphPath', 'producedGraphHash']);
  list(original.files, PORTABLE_LIMITS.maxResources - 3, 'source.original.files');
  const graphText = get(original.producedGraphPath, original.producedGraphHash, 'application/json');
  check(Buffer.byteLength(graphText) <= PORTABLE_LIMITS.maxGraphBytes, 'PORTABLE_BUDGET', 'Historical graph exceeds the graph byte limit.');
  let producedGraph;
  try { producedGraph = JSON.parse(graphText); } catch { fail('PORTABLE_SOURCE', 'Historical source graph is malformed.'); }
  return { ...decode(original), files: original.files.map(entry => { fields(entry, ['path', 'language', 'sha256']); return decode(entry); }), producedGraph: boundedCopy(producedGraph) };
}

function authorities(graph, registry, binding) {
  const report = registry.inspectRequirements(graph);
  requireValid(report);
  const installed = new Map([...binding.computations, ...binding.visuals].map(record => [record.manifest.id, record.manifest]));
  const requirements = report.requirements.map(requirement => {
    const manifest = installed.get(requirement.id);
    check(manifest && manifest.version === requirement.version, 'EXTENSION_MISSING', 'Bind all required installed extensions before opening this project.');
    return { id: manifest.id, version: manifest.version, implementation: manifest.implementation, kind: manifest.kind,
      capabilities: [...manifest.capabilities].sort(), nodeIds: [...requirement.nodeIds].sort(), dependencyOf: [...requirement.dependencyOf].sort() };
  });
  const assets = [];
  for (const node of graph.nodes) {
    const manifest = installed.get(node.type);
    if (manifest?.kind !== 'asset-factory') continue;
    const declared = manifest.artifact.provenance, parameters = node.data.parameters;
    const source = parameters.source ?? declared.source, license = parameters.license ?? declared.license;
    check(boundedText(source, 4096) && boundedText(license, 4096), 'ASSET_PROVENANCE', 'Portable asset definitions need source and license metadata.', node.id);
    assets.push({ nodeId: node.id, extension: manifest.id, kind: manifest.artifact.kind, format: manifest.artifact.format,
      definitionHash: fingerprint(node), source, license, declaredProvenance: declared });
  }
  return { requirements, assets };
}

function playbackData(project, binding, layer, input) {
  fields(input, ['policy', 'time', 'mode', 'settings', 'targets'], [], 'playback');
  const time = Object.hasOwn(input, 'time') ? input.time : { value: 0, unit: 's' };
  seconds(time);
  const mode = Object.hasOwn(input, 'mode') ? input.mode : 'auto';
  check((!Object.hasOwn(input, 'policy') || input.policy === 'replay-from-initial') && ['auto', 'analytic', 'stateful'].includes(mode), 'PLAYBACK_POLICY', 'Version 1 replays initial conditions through an installed F04 evaluation path.');
  const graph = project.snapshot(), records = new Map(binding.computations.map(record => [record.manifest.id, record.manifest]));
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const overrides = Object.hasOwn(input, 'settings') ? input.settings : {};
  check(isRecord(overrides), 'RUNTIME_SETTINGS', 'Playback settings must name installed scientific nodes.');
  for (const id of Object.keys(overrides)) check(records.has(nodes.get(id)?.type) && isRecord(overrides[id]), 'RUNTIME_SETTINGS', 'Settings must name an installed scientific node.', id);
  const sceneSources = layer?.sources(project) ?? [];
  const targets = Object.hasOwn(input, 'targets') ? input.targets : sceneSources;
  list(targets, PORTABLE_LIMITS.maxTargets, 'playback.targets');
  const described = binding.flow.describe(graph, { includeDependencies: true });
  requireValid(described);
  const seen = new Set(), needed = new Set();
  function requireTarget(target) {
    fields(target, ['nodeId', 'port']);
    check(isId(target.nodeId) && isId(target.port) && nodes.has(target.nodeId) && Object.hasOwn(described.outputs, target.nodeId)
      && Object.hasOwn(described.outputs[target.nodeId], target.port), 'OUTPUT_PORT', 'Playback target must name an existing scientific output.');
    const paths = records.get(nodes.get(target.nodeId).type)?.runtime.paths ?? ['analytic'];
    check(mode === 'auto' || paths.includes(mode), 'CAPABILITY_UNSUPPORTED', 'The saved evaluation mode is unavailable for this target.', target.nodeId);
    const pending = [target.nodeId];
    while (pending.length) {
      const id = pending.pop();
      if (needed.has(id)) continue;
      needed.add(id);
      for (const dependency of described.dependencies[id]) pending.push(dependency);
    }
  }
  for (const target of targets) {
    requireTarget(target);
    const key = JSON.stringify([target.nodeId, target.port]);
    check(!seen.has(key), 'PLAYBACK_TARGET', 'Duplicate playback target.'); seen.add(key);
  }
  // Rendering also evaluates bound scene/plot outputs. Include their settings
  // even when the author chooses additional numeric inspection targets.
  for (const target of sceneSources) requireTarget(target);
  const settings = Object.create(null);
  for (const node of graph.nodes) {
    const manifest = records.get(node.type);
    if (!manifest) continue;
    const schema = manifest.runtime.settings, given = Object.hasOwn(overrides, node.id);
    const normalized = applyDefaults(schema, given ? overrides[node.id] : {});
    const errors = validateData(schema, normalized);
    if (errors.length && !needed.has(node.id) && !given) continue;
    check(!errors.length, 'RUNTIME_SETTINGS', errors[0]?.message ?? 'Invalid runtime settings.', node.id);
    if (given || Object.keys(normalized).length) settings[node.id] = normalized;
  }
  return { policy: 'replay-from-initial', time: { value: time.value, unit: unit(time.unit) }, mode, settings: copyData(settings), targets: copyData(targets) };
}

// An authored boundary can introduce a model that is absent from the base
// construction. Bind the graph and the exact transitive builds for each boundary.
function timelineData(timeline, host) {
  if (timeline === null) return null;
  if (timeline.version === 0) {
    fields(timeline, ['version', 'data']);
    check(isRecord(timeline.data) && size(timeline) <= PORTABLE_LIMITS.maxTimelineBytes, 'TIMELINE_EXTENSION', 'Version-0 timeline metadata must be bounded inert data.');
    return copyData(timeline);
  }
  check(timeline.version === 1, 'TIMELINE_EXTENSION', 'Unsupported timeline extension version.');
  fields(timeline, ['version', 'data', 'configurations'], ['version', 'data']);
  const definition = { version: timeline.version, data: timeline.data };
  requireValid(validateTimeline(definition));
  const configurations = compileTimelineConfigurations({ ...host, definition }).map(({ id, graph }) => {
    const { requirements } = authorities(graph, host.registry, host.binding);
    return { id, graphHash: fingerprint(graph), requirements: requirements.map(({ id, version, implementation }) => ({ id, version, implementation })) };
  });
  return { ...definition, configurations };
}

function provenance(graph, dataSources) {
  list(dataSources, PORTABLE_LIMITS.maxDataSources, 'dataSources');
  const ids = new Set(graph.nodes.map(node => node.id));
  for (const data of dataSources) {
    fields(data, ['nodeId', 'source', 'license', 'description'], ['nodeId', 'source', 'license']);
    check(ids.has(data.nodeId) && boundedText(data.source, 4096) && boundedText(data.license, 4096) && (!Object.hasOwn(data, 'description') || boundedText(data.description, 4096)),
      'DATA_PROVENANCE', 'Source records must name a graph node, source and license.');
  }
  return copyData(dataSources);
}

function receipt(record, projectId) {
  check(isRecord(record) && (record.type === undefined || record.type === 'change') && (record.ok === undefined || record.ok === true) && boundedText(record.command, 160), 'PORTABLE_RECEIPT', 'Only accepted mutation summaries may be included.');
  token(record.identity, projectId);
  const summary = record.summary;
  fields(summary, ['action', 'created', 'updated', 'removed', 'counts', 'truncated', 'before', 'after']);
  fields(summary.counts, ['created', 'updated', 'removed']);
  token(summary.before, projectId); token(summary.after, projectId);
  check(summary.action === record.command && equal(record.identity, summary.after) && summary.before.generation === summary.after.generation && summary.after.revision === summary.before.revision + 1,
    'PORTABLE_RECEIPT', 'An accepted mutation must relate consecutive revisions within one historical generation.');
  for (const key of ['created', 'updated', 'removed']) {
    list(summary[key], 64, `summary.${key}`);
    check(summary[key].every(isId) && Number.isSafeInteger(summary.counts[key]) && summary.counts[key] >= 0 && summary[key].length === Math.min(summary.counts[key], 64), 'PORTABLE_RECEIPT', 'Invalid affected IDs or counts in accepted mutation summary.');
  }
  check(summary.truncated === Object.values(summary.counts).some(count => count > 64), 'PORTABLE_RECEIPT', 'Truncated summary counts are inconsistent.');
  const out = { command: record.command, identity: record.identity, summary };
  for (const key of ['turnId', 'callId']) if (Object.hasOwn(record, key)) { check(isId(record[key]), 'PORTABLE_RECEIPT', 'Receipt associations require bounded public IDs.'); out[key] = record[key]; }
  return copyData(out);
}
function publicRecords(projectId, options) {
  const transcriptIncluded = options.includeTranscript, receiptsIncluded = options.includeReceipts;
  check(typeof transcriptIncluded === 'boolean' && typeof receiptsIncluded === 'boolean', 'PORTABLE_PRIVACY', 'Sharing requires explicit boolean choices.');
  const transcript = [], receipts = [];
  if (transcriptIncluded) {
    list(options.transcript, PORTABLE_LIMITS.maxMessages, 'transcript');
    const ids = new Set();
    for (const record of options.transcript) {
      fields(record, ['id', 'turnId', 'role', 'text']);
      check(isId(record.id) && !ids.has(record.id) && isId(record.turnId) && ['user', 'assistant', 'system', 'tool'].includes(record.role)
        && typeof record.text === 'string' && record.text.length <= 12000,
        'PORTABLE_TRANSCRIPT', 'Share only bounded public message fields, with one unique ID per message.');
      ids.add(record.id);
      check(!/(?:\bsk-[\w-]{12,}|\bgh[pousr]_[\w-]{16,}|\bBearer\s+[\w.\-/+=]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(record.text),
        'PORTABLE_PRIVACY', 'A public message resembles a credential. Remove it before sharing the transcript.');
      transcript.push(copyData(record));
    }
    check(size(transcript) <= PORTABLE_LIMITS.maxTranscriptBytes, 'PORTABLE_BUDGET', 'Public transcript exceeds the byte limit.');
  }
  if (receiptsIncluded) {
    list(options.receipts, PORTABLE_LIMITS.maxReceipts, 'receipts');
    for (const record of options.receipts) receipts.push(receipt(record, projectId));
  }
  return { transcriptIncluded, receiptsIncluded, transcript, receipts };
}

function hostContext(registry, binding, layer) {
  check(typeof registry?.inspectRequirements === 'function' && binding?.flow?.describe && binding?.validators && (!layer || layer.validators && typeof layer.sources === 'function'), 'PORTABLE_HOST', 'Supply the installed registry, its binding and optional presentation layer.');
}

export function createPortableManifest({ project, registry, binding, layer, source = null, playback = {}, dataSources = [], timeline = null,
  includeTranscript = false, transcript = [], includeReceipts = false, receipts = [] } = {}) {
  hostContext(registry, binding, layer);
  check(project instanceof Project, 'PORTABLE_PROJECT', 'Save an accepted F01 Project.');
  const savedFrom = project.token, graph = project.snapshot();
  check(size(graph) <= PORTABLE_LIMITS.maxGraphBytes, 'PORTABLE_BUDGET', 'Accepted graph exceeds the portable replay graph limit.');
  const required = authorities(graph, registry, binding);
  // Validate the detached captured graph even when the host Project was built
  // with weaker validators. Validator callbacks cannot swap the saved snapshot.
  const validated = Project.from(graph, { validators: layer?.validators ?? binding.validators });
  const run = playbackData(validated, binding, layer, boundedCopy(playback));
  const body = { format: PORTABLE_FORMAT, version: PORTABLE_VERSION, savedFrom, graph, ...required, ...sourceBundle(graph, boundedCopy(source)),
    playback: run, dataSources: provenance(graph, boundedCopy(dataSources)),
    timeline: timelineData(boundedCopy(timeline), { project: validated, registry, binding, layer, playback: run }),
    sharing: publicRecords(graph.id, { includeTranscript, transcript: includeTranscript ? boundedCopy(transcript) : [], includeReceipts, receipts: includeReceipts ? boundedCopy(receipts) : [] }) };
  const manifest = { ...body, integrity: { graphHash: fingerprint(graph), sha256: fingerprint(body) } };
  check(equal(savedFrom, project.token), 'STALE_TOKEN', 'The accepted project changed while its portable snapshot was captured.');
  check(Buffer.byteLength(JSON.stringify(manifest, null, 2)) + 1 <= PORTABLE_LIMITS.maxBytes, 'PORTABLE_BUDGET', 'Portable manifest exceeds the formatted document byte limit.');
  return freezeData(boundedCopy(manifest));
}

export function serializePortableManifest(manifest) {
  const text = `${JSON.stringify(readInput(manifest), null, 2)}\n`;
  check(Buffer.byteLength(text) <= PORTABLE_LIMITS.maxBytes, 'PORTABLE_BUDGET', 'Portable output exceeds its byte limit.');
  return text;
}

export function openPortableManifest(input, { registry, binding, layer, migrations } = {}) {
  hostContext(registry, binding, layer);
  let manifest = readInput(input);
  check(isRecord(manifest) && manifest.format === PORTABLE_FORMAT, 'PORTABLE_FORMAT', 'Unrecognized portable project format.');
  if (manifest.version !== PORTABLE_VERSION && migrations) manifest = readInput(migrations.migrate(manifest));
  check(manifest.format === PORTABLE_FORMAT && manifest.version === PORTABLE_VERSION, 'PORTABLE_VERSION', 'Unsupported portable project version.');
  fields(manifest, ['format', 'version', 'savedFrom', 'graph', 'requirements', 'assets', 'source', 'resources', 'playback', 'dataSources', 'timeline', 'sharing', 'integrity']);
  const { integrity, ...body } = manifest;
  fields(integrity, ['graphHash', 'sha256']);
  check(integrity.sha256 === fingerprint(body) && integrity.graphHash === fingerprint(manifest.graph), 'PORTABLE_INTEGRITY', 'Portable graph or manifest content differs from its saved hash.');
  check(size(manifest.graph) <= PORTABLE_LIMITS.maxGraphBytes, 'PORTABLE_BUDGET', 'Saved graph exceeds the replay graph limit.');
  requireValid(validateProject(manifest.graph));
  token(manifest.savedFrom, manifest.graph.id);
  const expected = authorities(manifest.graph, registry, binding);
  check(equal(expected.requirements, manifest.requirements), 'PORTABLE_REQUIREMENTS', 'Saved requirements do not exactly match installed construction dependencies and builds.');
  check(equal(expected.assets, manifest.assets), 'PORTABLE_ASSETS', 'Required local asset definitions, source, license or identities differ.');
  const project = Project.from(manifest.graph, { validators: layer?.validators ?? binding.validators });
  const decoded = sourceInput(manifest), generated = sourceBundle(manifest.graph, decoded);
  check(equal(generated.source, manifest.source) && equal(generated.resources, manifest.resources), 'PORTABLE_SOURCE', 'Recipe associations, generated reconstruction or resource inventory differ.');
  const replay = playbackData(project, binding, layer, manifest.playback);
  check(equal(replay, manifest.playback), 'PLAYBACK_POLICY', 'Saved playback must declare canonical time, path, settings, targets and replay policy.');
  provenance(manifest.graph, manifest.dataSources);
  const timeline = timelineData(manifest.timeline, { project, registry, binding, layer, playback: replay });
  check(equal(timeline, manifest.timeline), 'TIMELINE_REQUIREMENTS', 'Timeline boundary constructions or their installed implementations differ from the saved configurations.');
  const sharing = manifest.sharing;
  fields(sharing, ['transcriptIncluded', 'receiptsIncluded', 'transcript', 'receipts']);
  const allowed = publicRecords(manifest.graph.id, { includeTranscript: sharing.transcriptIncluded, transcript: sharing.transcript, includeReceipts: sharing.receiptsIncluded, receipts: sharing.receipts });
  check(equal(allowed, sharing), 'PORTABLE_PRIVACY', 'Portable sharing records contain undeclared or private fields.');
  return { project, manifest: freezeData(manifest), sourceStatus: portableSourceStatus(manifest.graph, manifest) };
}

// A local archive may include a conversation without consenting to its
// distribution. Verify the complete archive before deriving a public digest.
export function createVisualizationManifest(input, context) {
  const { manifest } = openPortableManifest(input, context);
  const { integrity, ...body } = manifest;
  const { sharing } = body;
  const receipts = sharing.receipts.map(({ command, identity, summary }) => ({ command, identity, summary }));
  body.sharing = { ...sharing, transcriptIncluded: false, transcript: [], receipts };
  if (equal(body.sharing, sharing)) return manifest;
  return freezeData({ ...body, integrity: { graphHash: integrity.graphHash, sha256: fingerprint(body) } });
}

// Rehydrate author-facing metadata from an already validated portable manifest.
// Sharing choices remain explicit on every save/export invocation.
export function portableOptions(input) {
  const manifest = readInput(input);
  return { source: sourceInput(manifest), playback: manifest.playback, dataSources: manifest.dataSources, timeline: manifest.timeline,
    includeTranscript: manifest.sharing.transcriptIncluded, transcript: manifest.sharing.transcript, includeReceipts: manifest.sharing.receiptsIncluded, receipts: manifest.sharing.receipts };
}
