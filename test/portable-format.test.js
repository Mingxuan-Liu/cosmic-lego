import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { createCommandGateway } from '../src/gateway/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { fingerprint } from '../src/runtime/contracts.js';
import {
  createMigrationRegistry, createPortableManifest, openPortableManifest, portableGraphHash,
  portableOptions, portableSourceStatus, PORTABLE_LIMITS, serializePortableManifest,
} from '../src/portable/format.js';
import { buildExample as motionAndFields } from '../examples/workspace.mjs';
import { buildExample as accumulators } from '../examples/computation-runtime.mjs';

function empty() {
  const registry = new ExtensionRegistry(), binding = registry.bind();
  return { registry, binding, project: new Project({ id: 'untitled', validators: binding.validators }) };
}
const recipe = project => ({ path: 'examples/工作区.mjs', language: 'javascript',
  text: 'globalThis.__portableRecipeRan = true; throw new Error("Executed source");',
  files: [{ path: 'examples/scene.mjs', language: 'javascript', text: 'throw new Error("Executed helper");' }],
  producedGraph: project.snapshot() });
function altered(manifest, edit) {
  const copy = structuredClone(manifest);
  edit(copy);
  const { integrity, ...body } = copy;
  integrity.graphHash = fingerprint(body.graph);
  integrity.sha256 = fingerprint(body);
  return copy;
}
const fails = (fn, code) => assert.throws(fn, error => error.code === code, code);

test('original recipe and historical graph survive divergence, Undo and repeated opens without executing source', () => {
  const host = accumulators(), source = recipe(host.project);
  const first = createPortableManifest({ ...host, source });
  assert.equal(portableSourceStatus(host.project.snapshot(), first), 'matches');
  assert.ok(Object.isFrozen(first.source.original.files[0]));
  const draft = host.project.begin();
  host.binding.author(draft).instantiate('fixture.moving-point', { id: 'later' });
  draft.accept();
  const edited = createPortableManifest({ ...host, source });
  assert.equal(edited.source.original.producedGraphHash, first.source.original.producedGraphHash);
  assert.notEqual(edited.source.original.producedGraphHash, edited.source.reconstruction.producedGraphHash);
  const reopened = openPortableManifest(Buffer.from(serializePortableManifest(edited)), host);
  assert.equal(reopened.sourceStatus, 'diverged');
  assert.notEqual(reopened.project.token.generation, host.project.token.generation);
  assert.equal(reopened.project.token.revision, 0);
  assert.deepEqual(reopened.project.snapshot(), host.project.snapshot());
  const options = portableOptions(reopened.manifest);
  assert.deepEqual(options.source, source);
  const savedAgain = createPortableManifest({ ...host, project: reopened.project, ...options });
  assert.deepEqual(savedAgain.source, edited.source);
  assert.equal(portableGraphHash(reopened.project.snapshot()), edited.integrity.graphHash);
  assert.equal(globalThis.__portableRecipeRan, undefined);
  host.project.undo(host.project.token);
  assert.equal(portableSourceStatus(host.project.snapshot(), edited), 'matches');
  const reconstructedOnly = createPortableManifest(host);
  assert.equal(openPortableManifest(reconstructedOnly, host).sourceStatus, 'unavailable');
  assert.equal(reconstructedOnly.resources.length, 1);
  assert.match(reconstructedOnly.resources[0].content, /Project\.from/);
});

test('regenerated F05 texture and material content IDs, references, licenses, fields and layout survive reopen', async () => {
  const host = motionAndFields(), source = recipe(host.project);
  const dataSources = [{ nodeId: 'scalar-field', source: 'Original finite synthetic grid', license: 'BSD-3-Clause' }];
  const timeline = { version: 0, data: { note: 'Future authored annotation' } };
  const manifest = createPortableManifest({ ...host, source, dataSources, timeline, playback: { time: { value: 2, unit: 's' } } });
  const { project } = openPortableManifest(serializePortableManifest(manifest), host);
  assert.deepEqual(manifest.dataSources, dataSources);
  assert.deepEqual(manifest.timeline, timeline);
  assert.equal(manifest.assets.find(a => a.nodeId === 'local-checker').license, 'BSD-3-Clause');
  assert.ok(manifest.requirements.some(r => r.id === 'fixture.moving-point' && r.implementation.build && r.nodeIds.includes('point-0')));
  async function compiled(project) {
    const time = { value: 2, unit: 's' };
    const results = host.layer.sources(project).map(({ nodeId, port }) => host.binding.evaluate(project, nodeId, { port, time }));
    const snapshot = await host.layer.compile(project, { results, time });
    assert.equal(snapshot.valid, true, JSON.stringify(snapshot.diagnostics));
    return snapshot;
  }
  const before = await compiled(host.project), after = await compiled(project);
  assert.deepEqual(after.scene.assets, before.scene.assets);
  assert.deepEqual(after.scene.assets.find(a => a.id === 'checker-material').dependencies, ['local-checker']);
  assert.match(after.scene.assets.find(a => a.id === 'local-checker').contentId, /^sha256:/);
  const plots = s => s.overlays.filter(o => o.kind === 'plot').map(({ id, x, y, width, height, hidden, data }) => ({ id, x, y, width, height, hidden, data }));
  assert.deepEqual(plots(after), plots(before));
});

test('replay preserves canonical settings and seed, validates target, units and explicit path and rejects continuation state', () => {
  const host = accumulators();
  const target = { nodeId: 'noise', port: 'value' };
  const manifest = createPortableManifest({ ...host, playback: {
    mode: 'auto', time: { value: 0.5, unit: 'min' }, targets: [target], settings: { noise: { seed: 1847 } },
  } });
  assert.deepEqual(openPortableManifest(manifest, host).manifest.playback, manifest.playback);
  assert.deepEqual(manifest.playback.settings.noise, { step: 0.25, tolerance: 1e-12, seed: 1847 });
  assert.equal(manifest.playback.time.unit.scale, 60);
  assert.equal(manifest.playback.policy, 'replay-from-initial');
  const save = playback => createPortableManifest({ ...host, playback });
  fails(() => save({ mode: 'analytic', targets: [target] }), 'CAPABILITY_UNSUPPORTED');
  fails(() => save({ targets: [target, target] }), 'PLAYBACK_TARGET');
  fails(() => save({ targets: [{ nodeId: 'constructor', port: 'name' }] }), 'OUTPUT_PORT');
  fails(() => save({ targets: [target], settings: { noise: { seed: -1 } } }), 'RUNTIME_SETTINGS');
  fails(() => save({ time: { value: 1, unit: 'm' } }), 'INVALID_TIME');
  fails(() => save({ policy: 'checkpoint' }), 'PLAYBACK_POLICY');
  fails(() => save({ checkpoint: { seed: 1847 } }), 'PORTABLE_SCHEMA');
});

test('F02 opt-in dependency map includes exact scientific selector and arithmetic edges and detaches results', () => {
  const { project, binding } = motionAndFields(), graph = project.snapshot();
  assert.equal(Object.hasOwn(binding.flow.describe(graph), 'dependencies'), false);
  const described = binding.flow.describe(graph, { includeDependencies: true });
  assert.equal(described.valid, true);
  for (const id of ['moving-collection', 'mean-position-magnitude', 'position-magnitudes', 'scalar-field']) {
    assert.deepEqual(described.dependencies[id], binding.flow.dependencies(graph, id));
  }
  described.dependencies['moving-collection'].length = 0;
  assert.equal(binding.flow.dependencies(graph, 'moving-collection').length, 9);
});

test('missing or altered requirements, asset metadata and byte-level integrity fail without replacing current project', () => {
  const host = motionAndFields(), identity = host.project.token;
  const manifest = createPortableManifest(host);
  const corrupted = structuredClone(manifest); corrupted.savedFrom.revision++;
  fails(() => openPortableManifest(corrupted, host), 'PORTABLE_INTEGRITY');
  for (const change of [m => m.requirements.pop(), m => m.requirements[0].implementation.build += '-different']) {
    fails(() => openPortableManifest(altered(manifest, change), host), 'PORTABLE_REQUIREMENTS');
  }
  for (const change of [m => m.assets.pop(), m => m.assets[0].license = '', m => m.assets[0].definitionHash = 'other']) {
    fails(() => openPortableManifest(altered(manifest, change), host), 'PORTABLE_ASSETS');
  }
  const noModels = empty();
  assert.throws(() => openPortableManifest(manifest, noModels), error => /EXTENSION|REQUIREMENT/.test(error.code));
  assert.deepEqual(host.project.token, identity);
});

test('inline resource inventory rejects escapes, duplicates, missing dependencies, malformed reconstruction and undeclared content', () => {
  const host = empty(), source = recipe(host.project);
  for (const path of ['/tmp/e.mjs', '../e.mjs', 'a/../../e.mjs', 'https://outside/e.mjs', 'C:/e.mjs', 'a\\e.mjs', '%2e%2e/e', '_portable/e']) {
    fails(() => createPortableManifest({ ...host, source: { ...source, path } }), 'RESOURCE_PATH');
  }
  fails(() => createPortableManifest({ ...host, source: { ...source, files: [{ ...source.files[0], path: source.path.toUpperCase() }] } }), 'RESOURCE_DUPLICATE');
  const manifest = createPortableManifest({ ...host, source });
  fails(() => openPortableManifest(altered(manifest, m => m.resources.splice(1, 1)), host), 'RESOURCE_MISSING');
  fails(() => openPortableManifest(altered(manifest, m => m.resources[0].content += '?'), host), 'RESOURCE_INTEGRITY');
  fails(() => openPortableManifest(altered(manifest, m => m.resources.push({ ...m.resources[0], path: 'undeclared.js' })), host), 'PORTABLE_SOURCE');
  fails(() => openPortableManifest(altered(manifest, m => m.source.reconstruction.path = 'elsewhere.js'), host), 'PORTABLE_SOURCE');
});

test('transcript and accepted-command sharing are explicit, projected, bounded and detached', async () => {
  const host = empty(), gateway = createCommandGateway(host);
  const accepted = await gateway.dispatch({ command: 'transaction.commit', args: { operations: [
    { command: 'dataflow.constant', args: { id: 'quantity', value: { kind: 'scalar', data: 2, unit: 'm', meaning: 'length' } } },
  ] }, expected: host.project.token, idempotencyKey: 'save:test' }, gateway.localAuthority);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.error));
  const messages = ['system', 'user', 'assistant', 'tool'].map((role, i) => ({ id: 'message-' + i, turnId: 'turn-1', role, text: '可分享 ' + i }));
  const receipts = [{ ...accepted, callId: 'call-1', turnId: 'turn-1', privateProviderState: 'must not persist' }];
  const defaulted = createPortableManifest({ ...host, transcript: messages, receipts });
  assert.deepEqual(defaulted.sharing, { transcriptIncluded: false, receiptsIncluded: false, transcript: [], receipts: [] });
  const shared = createPortableManifest({ ...host, includeTranscript: true, transcript: messages, includeReceipts: true, receipts });
  assert.deepEqual(shared.sharing.transcript, messages);
  assert.deepEqual(Object.keys(shared.sharing.receipts[0]).sort(), ['command', 'identity', 'summary', 'callId', 'turnId'].sort());
  assert.equal(shared.sharing.receipts[0].summary.after.revision, 1);
  assert.ok(!serializePortableManifest(shared).includes('must not persist'));
  assert.deepEqual(openPortableManifest(shared, host).manifest.sharing, shared.sharing);
  const withTranscript = transcript => createPortableManifest({ ...host, includeTranscript: true, transcript });
  fails(() => withTranscript([messages[0], messages[0]]), 'PORTABLE_TRANSCRIPT');
  fails(() => withTranscript([{ ...messages[0], providerSessionId: 'private' }]), 'PORTABLE_SCHEMA');
  fails(() => withTranscript([{ ...messages[0], text: 'Bearer AAAAAAAAAAAAAAAAAAAAA' }]), 'PORTABLE_PRIVACY');
  fails(() => withTranscript([{ ...messages[0], text: '-----BEGIN PRIVATE KEY-----' }]), 'PORTABLE_PRIVACY');
  fails(() => openPortableManifest(altered(shared, m => m.sharing.receipts[0].args = { data: 'private' }), host), 'PORTABLE_PRIVACY');
  fails(() => openPortableManifest(altered(shared, m => m.sharing.transcriptIncluded = false), host), 'PORTABLE_PRIVACY');
});

test('only installed synchronous consecutive migrations run, with a frozen input and complete validation afterwards', () => {
  const host = empty(), current = createPortableManifest(host);
  const old = { format: current.format, version: 0, construction: current.graph };
  fails(() => openPortableManifest(old, host), 'PORTABLE_VERSION');
  const registry = createMigrationRegistry().register(0, 1, previous => {
    assert.ok(Object.isFrozen(previous.construction)); return current;
  });
  assert.deepEqual(openPortableManifest(old, { ...host, migrations: registry }).project.snapshot(), current.graph);
  fails(() => registry.register(0, 1, () => current), 'PORTABLE_MIGRATION');
  fails(() => openPortableManifest({ ...old, version: 5 }, { ...host, migrations: registry }), 'PORTABLE_VERSION');
  const corrupt = createMigrationRegistry().register(0, 1, () => ({ ...current, version: 3 }));
  fails(() => openPortableManifest(old, { ...host, migrations: corrupt }), 'PORTABLE_MIGRATION');
  const asyncMigration = createMigrationRegistry().register(0, 1, () => Promise.resolve(current));
  fails(() => openPortableManifest(old, { ...host, migrations: asyncMigration }), 'PORTABLE_MIGRATION');
});

test('reader rejects malformed UTF-8, lossy/nondata objects, unknown manifest fields and byte/count overruns', () => {
  const host = empty(), current = createPortableManifest(host);
  fails(() => openPortableManifest(Buffer.from([255, 254]), host), 'PORTABLE_ENCODING');
  fails(() => openPortableManifest('{"truncated":', host), 'PORTABLE_JSON');
  let getterCalls = 0;
  fails(() => openPortableManifest({ get format() { getterCalls++; } }, host), 'INVALID_DATA');
  assert.equal(getterCalls, 0);
  fails(() => openPortableManifest(Buffer.alloc(PORTABLE_LIMITS.maxBytes + 1), host), 'PORTABLE_BUDGET');
  fails(() => openPortableManifest({ entries: new Array(PORTABLE_LIMITS.maxEntries + 1) }, host), 'PORTABLE_BUDGET');
  fails(() => openPortableManifest({ ...current, checkpoint: {} }, host), 'PORTABLE_SCHEMA');
  fails(() => createPortableManifest({ ...host, source: { ...recipe(host.project), text: 'x'.repeat(PORTABLE_LIMITS.maxSourceFileBytes + 1) } }), 'PORTABLE_BUDGET');
  fails(() => createPortableManifest({ ...host, timeline: { version: 0, data: { note: 'x'.repeat(PORTABLE_LIMITS.maxTimelineBytes) } } }), 'TIMELINE_EXTENSION');
  fails(() => createPortableManifest({ ...host, dataSources: [{ nodeId: 'missing', source: 'local input', license: 'BSD-3-Clause' }] }), 'DATA_PROVENANCE');
});
