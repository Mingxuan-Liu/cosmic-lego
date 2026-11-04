import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { createWorkspaceLayer, registerWorkspaceExtensions } from '../src/workspace/index.js';
import { registerSceneExtensions } from '../src/scene/index.js';
import { createRuntime } from '../src/runtime/index.js';
import { createCommandGateway } from '../src/gateway/index.js';
import { registryExtensions } from '../examples/fixtures/registry-extensions.js';

const scalar = data => ({ kind: 'scalar', data, unit: '1', meaning: 'generic-number' });
const constant = (id, data = 3) => ({ command: 'dataflow.constant', args: { id, value: scalar(data) } });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result; };
function bad(result, code, category) {
  assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code, JSON.stringify(result));
  if (category) assert.equal(result.error.category, category);
  assert.ok(result.error.paths.length); assert.ok(result.error.repairs.length); assert.ok(result.context.identity); return result;
}
function setup(options = {}) {
  const registry = registerWorkspaceExtensions(registerSceneExtensions(new ExtensionRegistry({ capabilities: ['scene.data'] })));
  const binding = registry.bind(), layer = createWorkspaceLayer(binding), project = new Project({ validators: layer.validators });
  const gateway = createCommandGateway({ project, registry, binding, layer, ...options });
  return { registry, binding, layer, project, gateway };
}
function write(context, operation, key = 'write', authority = context.gateway.localAuthority) {
  return context.gateway.dispatch({ ...operation, expected: context.project.token, idempotencyKey: key }, authority);
}
function controlledRuntime(binding) {
  const calls = [];
  return { calls, setProject() {}, submit(project, id, args) {
    const result = binding.evaluate(project, id, { port: args.port, time: args.time }); let resolve;
    const promise = new Promise(done => { resolve = done; });
    const call = { id, args, finish: () => resolve(result), cancelled: false };
    calls.push(call);
    return { promise, cancel() { call.cancelled = true; resolve({ valid: false, diagnostics: [{ code: 'CANCELLED', message: 'Test job cancelled.' }] }); } };
  } };
}
function deferredSetup() {
  const context = setup(); const runtime = controlledRuntime(context.binding);
  context.gateway = createCommandGateway({ ...context, runtime }); return { ...context, runtime };
}

test('discovery advertises shared declarations, authority requirements, effective limits and result schemas', async () => {
  const { gateway } = setup(), output = ok(await gateway.dispatch({ command: 'discover' }));
  assert.equal(output.result.gateway.limits.maxRequestBytes, 65536);
  assert.equal(output.result.gateway.idempotency.durable, false);
  const commands = new Map(output.result.commands.map(item => [item.name, item]));
  assert.equal(commands.get('create:workspace.plot').authority, 'write');
  assert.equal(commands.get('create:workspace.plot').expectedRequired, true);
  assert.equal(commands.get('create:workspace.plot').limits.maxRequestBytes, 65536);
  assert.ok(commands.get('create:workspace.plot').outputSchema.properties.operations);
  assert.ok(commands.get('create:workspace.plot').operationOutputSchema.properties.id);
  assert.equal(commands.get('evaluate').outputSchema['x-semanticValidator'], 'F04.result');
  assert.ok(commands.get('transaction.preview').outputSchema.properties.graph);
  assert.ok(commands.get('render').inputSchema.properties.capabilities.anyOf);
  assert.equal(commands.get('evaluate').available, false);
  assert.deepEqual(commands.get('evaluate').missingHostRequirements, ['runtime']);
  assert.deepEqual(commands.get('render').hostRequirements, ['runtime', 'layer']);
  assert.ok(Object.isFrozen(output.result));
});

test('preview is non-mutating, competing commits are stale, and Undo restores with a fresh revision', async () => {
  const context = setup(), { gateway, project } = context, before = project.snapshot(), expected = project.token;
  const batch = { args: { operations: [constant('a'), constant('b', 4)] }, expected };
  const preview = ok(await gateway.dispatch({ ...batch, command: 'transaction.preview' }, gateway.localAuthority));
  assert.equal(preview.result.graph.nodes.length, 2); assert.deepEqual(project.snapshot(), before); assert.deepEqual(project.token, expected);
  const committed = ok(await gateway.dispatch({ ...batch, command: 'transaction.commit', idempotencyKey: 'batch' }, gateway.localAuthority));
  assert.deepEqual(committed.summary.created, ['a', 'b']); assert.equal(committed.result.operations[1].result.id, 'b');
  bad(await gateway.dispatch({ ...batch, command: 'transaction.commit', idempotencyKey: 'competitor' }, gateway.localAuthority), 'STALE_TOKEN', 'stale-state');
  const undone = ok(await write(context, { command: 'history.undo' }, 'undo'));
  assert.deepEqual(project.snapshot(), before); assert.equal(undone.identity.revision, committed.identity.revision + 1); assert.deepEqual(undone.summary.removed, ['a', 'b']);
  const redone = ok(await write(context, { command: 'history.redo' }, 'redo')); assert.equal(project.snapshot().nodes.length, 2); assert.equal(redone.identity.revision, undone.identity.revision + 1);
});

test('a failed multi-operation batch preserves accepted content and identifies its repair location', async () => {
  const context = setup(), before = context.project.snapshot(), identity = context.project.token;
  const result = bad(await write(context, { command: 'transaction.commit', args: { operations: [constant('fresh'), constant('fresh')] } }), 'DUPLICATE_ID');
  assert.equal(result.error.operationIndex, 1); assert.ok(result.error.affectedIds.includes('fresh')); assert.deepEqual(context.project.snapshot(), before); assert.deepEqual(context.project.token, identity);
  const invalid = bad(await write(context, { command: 'transaction.commit', args: { operations: [{ command: 'create:scene.camera', args: { id: 'bad-camera', assets: { parent: 'missing-parent' } } }] } }), 'BROKEN_REFERENCE');
  assert.ok(invalid.error.affectedIds.includes('bad-camera'));
});

test('idempotent retries return original outcomes after later edits and reject payload or authority changes', async () => {
  const context = setup(), { gateway, project } = context;
  const request = { ...constant('first'), expected: project.token, idempotencyKey: 'same-key' };
  const first = ok(await gateway.dispatch(request, gateway.localAuthority));
  ok(await write(context, constant('second'), 'second-key'));
  const replay = ok(await gateway.dispatch({ idempotencyKey: 'same-key', expected: request.expected, args: request.args, command: request.command }, gateway.localAuthority));
  assert.equal(replay.replayed, true); assert.deepEqual(replay.identity, first.identity); assert.deepEqual(replay.result, first.result); assert.equal(project.token.revision, 2);
  bad(await gateway.dispatch({ ...request, args: { ...request.args, id: 'other' } }, gateway.localAuthority), 'IDEMPOTENCY_CONFLICT');
  const turn = gateway.issueTurn(gateway.createSession());
  bad(await gateway.dispatch(request, turn), 'IDEMPOTENCY_CONFLICT'); assert.equal(project.snapshot().nodes.length, 2);
});

test('writes require opaque host authority and never trust caller-supplied actor/session/turn fields', async () => {
  const context = setup(), { gateway, project } = context;
  const request = { ...constant('n'), expected: project.token, idempotencyKey: 'key' };
  bad(await gateway.dispatch(request), 'AUTHORITY_REQUIRED', 'unauthorized');
  bad(await gateway.dispatch(request, {}), 'INVALID_AUTHORITY', 'unauthorized');
  bad(await gateway.dispatch({ ...request, turnId: 'authorized' }, gateway.localAuthority), 'COMMAND_ARGUMENT', 'malformed-input');
  const session = gateway.createSession({ permissions: ['read'] }), turn = gateway.issueTurn(session);
  ok(await gateway.forTurn(turn).dispatch({ command: 'inspect' }));
  bad(await gateway.dispatch(request, turn), 'PERMISSION_DENIED', 'unauthorized');
  assert.throws(() => gateway.issueTurn(session, { permissions: ['write'] }), { code: 'PERMISSION_DENIED' });
  assert.equal(project.snapshot().nodes.length, 0);
});

test('revocation prevents new writes and cached replay while preserving already committed content', async () => {
  const context = setup(), { gateway, project } = context, session = gateway.createSession(), turn = gateway.issueTurn(session);
  const request = { ...constant('n'), expected: project.token, idempotencyKey: 'key' };
  const committed = ok(await gateway.dispatch(request, turn)); gateway.revokeTurn(turn);
  bad(await gateway.dispatch(request, turn), 'TURN_REVOKED', 'cancelled');
  bad(await write(context, constant('late'), 'late', turn), 'TURN_REVOKED');
  assert.deepEqual(project.token, committed.identity); assert.equal(project.get('n').value.id, 'n');
  const second = gateway.issueTurn(session); gateway.closeSession(session);
  bad(await write(context, constant('closed'), 'closed', second), 'TURN_REVOKED');
  assert.throws(() => gateway.issueTurn(session), { code: 'SESSION_CLOSED' });
});

test('project load or switching revokes every old authority and rotates local authority', async () => {
  const context = setup(), { gateway, project } = context, local = gateway.localAuthority;
  const turn = gateway.issueTurn(gateway.createSession()); ok(await write(context, constant('n')));
  project.load(project.snapshot(), project.token);
  bad(await write(context, constant('old'), 'old', local), 'STALE_AUTHORITY', 'stale-state');
  bad(await write(context, constant('old-turn'), 'old-turn', turn), 'STALE_AUTHORITY');
  assert.notEqual(gateway.localAuthority, local);
  ok(await write(context, constant('fresh'), 'fresh'));
  const beforeSwitch = gateway.localAuthority, other = new Project({ validators: context.layer.validators }); gateway.setProject(other);
  bad(await gateway.dispatch({ ...constant('wrong-project'), expected: other.token, idempotencyKey: 'switch' }, beforeSwitch), 'STALE_AUTHORITY');
  ok(await gateway.dispatch({ ...constant('other'), expected: other.token, idempotencyKey: 'switch' }, gateway.localAuthority));
  assert.equal(other.snapshot().nodes.length, 1); assert.equal(project.snapshot().nodes.length, 2);
});

test('retention expiration and bounded eviction require a fresh token rather than duplicating old writes', async () => {
  let clock = 0; const context = setup({ now: () => clock, limits: { maxCacheEntries: 1, cacheTtlMs: 10 } });
  const { gateway, project } = context, first = { ...constant('a'), expected: project.token, idempotencyKey: 'one' };
  ok(await gateway.dispatch(first, gateway.localAuthority)); ok(await write(context, constant('b'), 'two'));
  bad(await gateway.dispatch(first, gateway.localAuthority), 'STALE_TOKEN');
  const third = { ...constant('c'), expected: project.token, idempotencyKey: 'three' }; ok(await gateway.dispatch(third, gateway.localAuthority)); clock = 10;
  bad(await gateway.dispatch(third, gateway.localAuthority), 'STALE_TOKEN'); assert.equal(project.snapshot().nodes.length, 3);
});

test('byte and operation admission limits reject before cloning unsafe data or accepting mutations', async () => {
  const context = setup({ limits: { maxCacheBytes: 1000, maxOperations: 1 } }), { gateway, project } = context;
  bad(await write(context, constant('small')), 'RESULT_BUDGET', 'resource-exhausted'); assert.equal(project.token.revision, 0);
  bad(await write(context, { command: 'transaction.commit', args: { operations: [constant('a'), constant('b')] } }), 'COMMAND_ARGUMENT');
  bad(await gateway.dispatch({ command: 'inspect', args: { id: 'x'.repeat(65536) } }), 'REQUEST_BUDGET');
  let reads = 0; const payload = { command: 'inspect', get args() { reads++; return {}; } };
  bad(await gateway.dispatch(payload), 'INVALID_DATA', 'malformed-input'); assert.equal(reads, 0);
  bad(await gateway.dispatch({ command: 'inspect', args: { code: () => {} } }), 'INVALID_DATA');
});

test('session and turn limits are reclaimed on close/revoke', () => {
  const { gateway } = setup({ limits: { maxSessions: 1, maxTurns: 1 } });
  const session = gateway.createSession(), first = gateway.issueTurn(session);
  assert.throws(() => gateway.createSession(), { code: 'SESSION_BUDGET' }); assert.throws(() => gateway.issueTurn(session), { code: 'TURN_BUDGET' });
  gateway.revokeTurn(first); gateway.issueTurn(session); gateway.closeSession(session);
  gateway.issueTurn(gateway.createSession());
});

test('host revocation during validation is checked again before committing', async () => {
  const registry = new ExtensionRegistry(), binding = registry.bind(); let gateway, turn, revoke = false;
  const project = new Project({ validators: { structure: [...binding.validators.structure, () => {
    if (revoke) gateway.revokeTurn(turn); return [];
  }] } });
  gateway = createCommandGateway({ registry, binding, project }); turn = gateway.issueTurn(gateway.createSession()); revoke = true;
  bad(await gateway.dispatch({ ...constant('late'), expected: project.token, idempotencyKey: 'during-validation' }, turn), 'TURN_REVOKED');
  assert.equal(project.token.revision, 0); assert.deepEqual(project.snapshot().nodes, []);
});

test('gateway applies scientific validators even when a host Project has only core validators', async () => {
  const context = setup(), project = new Project();
  const gateway = createCommandGateway({ ...context, project });
  const request = { command: 'transaction.commit', expected: project.token, idempotencyKey: 'invalid', args: { operations: [
    { command: 'overlay.create', args: { kind: 'plot', options: { id: 'unbound' } } },
  ] } };
  const result = await gateway.dispatch(request, gateway.localAuthority);
  bad(result, 'PLOT_SOURCE_REQUIRED'); assert.equal(project.snapshot().nodes.length, 0);
});

test('declared scientific applicability diagnostics retain category despite LIMIT in their code', async () => {
  const registry = new ExtensionRegistry({ capabilities: ['dataflow.sync'] });
  registry.register(registryExtensions.find(extension => extension.manifest.id === 'fixture.scale-length'));
  const binding = registry.bind(), project = new Project({ validators: binding.validators }), gateway = createCommandGateway({ registry, binding, project });
  const result = bad(await gateway.dispatch({ command: 'transaction.commit', expected: project.token, idempotencyKey: 'guard', args: { operations: [
    { command: 'dataflow.constant', args: { id: 'length', value: { kind: 'scalar', data: 2, unit: 'm', meaning: 'length' } } },
    { command: 'create:fixture.scale-length', args: { id: 'scale', parameters: { factor: 101 }, inputs: { source: 'length' } } },
  ] } }, gateway.localAuthority), 'FIXTURE_SCALE_LIMIT', 'applicability');
  assert.ok(result.error.affectedIds.includes('scale')); assert.equal(project.token.revision, 0);
});

test('runtime results are copied before await, and a revoked turn cannot publish a pending result', async () => {
  const context = deferredSetup(), { gateway, project, runtime } = context; ok(await write(context, constant('n')));
  const turn = gateway.issueTurn(gateway.createSession()), args = { id: 'n', time: { value: 2, unit: 's' } };
  const pending = gateway.dispatch({ command: 'evaluate', args, expected: project.token }, turn); args.time.value = 99;
  assert.equal(runtime.calls[0].args.time.value, 2); gateway.revokeTurn(turn);
  bad(await pending, 'TURN_REVOKED', 'cancelled'); assert.equal(runtime.calls[0].cancelled, true);
  assert.equal(project.snapshot().nodes.length, 1);
});

test('newer render supersedes old source loops before they can submit and cancel the new request', async () => {
  const context = deferredSetup(), { gateway, project, layer, binding, runtime } = context;
  const draft = project.begin(), author = layer.author(draft), science = binding.author(draft); layer.scene.author(draft).root();
  author.bind(author.plot({ id: 'first' }), science.constant(scalar(1), { id: 'a' }));
  author.bind(author.plot({ id: 'second' }), science.constant(scalar(2), { id: 'b' })); draft.accept();
  const old = gateway.dispatch({ command: 'render', expected: project.token, args: { time: { value: 1, unit: 's' } } }, gateway.localAuthority);
  assert.equal(runtime.calls.length, 1);
  const newer = gateway.dispatch({ command: 'render', expected: project.token, args: { time: { value: 2, unit: 's' }, capabilities: { nodes: ['group'], textures: false } } }, gateway.localAuthority);
  assert.equal(runtime.calls.length, 2); bad(await old, 'SUPERSEDED', 'cancelled');
  runtime.calls[1].finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.calls.length, 3); assert.equal(runtime.calls[2].id, 'b'); assert.equal(runtime.calls[2].args.time.value, 2);
  runtime.calls[2].finish(); const result = ok(await newer);
  assert.equal(result.result.snapshot.overlays.length, 2); assert.equal(result.result.time.value, 2);
});

test('accepted edits and direct loads invalidate pending computations without publishing stale values', async () => {
  const context = deferredSetup(), { gateway, project, runtime } = context; ok(await write(context, constant('n')));
  const pending = gateway.dispatch({ command: 'evaluate', args: { id: 'n' }, expected: project.token }, gateway.localAuthority);
  ok(await write(context, constant('new'), 'new')); bad(await pending, 'STALE_RESULT', 'stale-state'); assert.equal(runtime.calls[0].cancelled, true);
  const loaded = gateway.dispatch({ command: 'evaluate', args: { id: 'n' }, expected: project.token }, gateway.localAuthority);
  project.load(project.snapshot(), project.token); runtime.calls[1].finish(); bad(await loaded, 'STALE_AUTHORITY');
});

test('revocation during asynchronous compilation cannot publish a late snapshot', async () => {
  const context = setup(); let resolve;
  const layer = { ...context.layer, compile: () => new Promise(done => { resolve = done; }) };
  const gateway = createCommandGateway({ ...context, layer, runtime: controlledRuntime(context.binding) });
  const turn = gateway.issueTurn(gateway.createSession()), identity = context.project.token;
  const pending = gateway.dispatch({ command: 'render', expected: identity }, turn);
  assert.equal(typeof resolve, 'function'); gateway.revokeTurn(turn); resolve({ valid: true, identity, diagnostics: [] });
  bad(await pending, 'TURN_REVOKED'); assert.deepEqual(context.project.token, identity);
});

test('actual bounded worker evaluation returns the same numerical value and full identity contract', async () => {
  const runtime = createRuntime({ registryModule: new URL('../examples/fixtures/workspace-registry.js', import.meta.url) });
  const context = setup({ runtime });
  try {
    ok(await write(context, constant('n', -7)));
    const output = ok(await context.gateway.dispatch({ command: 'evaluate', args: { id: 'n', time: { value: 3, unit: 's' } }, expected: context.project.token }, context.gateway.localAuthority));
    assert.equal(output.result.value.data, -7); assert.deepEqual(output.result.identity, context.project.token); assert.equal(output.result.request.time.value, 3);
    assert.ok(output.result.metadata.runtime.jobId);
  } finally { await runtime.dispose(); }
});

test('a failed accumulator preview identifies the connected quantities and a checked rate producer repairs it without committing', async () => {
  const { createRegistry } = await import('../examples/fixtures/workspace-registry.js');
  const registry = createRegistry(), binding = registry.bind(), project = new Project({ validators: binding.validators });
  const draft = project.begin(); binding.author(draft).instantiate('fixture.moving-point', { id: 'puck-mid' }); draft.accept();
  const gateway = createCommandGateway({ project, registry, binding });
  const expected = project.token, graph = project.snapshot(), history = project.history;
  const preview = operations => gateway.dispatch({ command: 'transaction.preview', expected, args: { operations } }, gateway.localAuthority);
  const connect = source => ({ command: 'create:fixture.accumulator', args: { id: 'bad-rate-integrator', inputs: { source } } });
  const failure = bad(await preview([connect({ node: 'puck-mid', port: 'position' })]), 'KIND_MISMATCH', 'incompatible-connection');
  assert.match(failure.error.message, /puck-mid\.position → bad-rate-integrator\.source/);
  assert.match(failure.error.message, /vector "position" in m\./);
  assert.match(failure.error.message, /timeless scalar "accumulation-rate" in 1\/s/);
  assert.deepEqual(failure.error.paths, ['bad-rate-integrator.source']);
  assert.deepEqual(failure.context.identity, expected); assert.deepEqual(project.snapshot(), graph); assert.deepEqual(project.history, history);
  const inspect = failure.error.repairs.find(repair => repair.command === 'inspect');
  assert.match(inspect.description, /result\.outputs/);
  const inspected = ok(await gateway.dispatch({ command: inspect.command }, gateway.localAuthority));
  assert.equal(inspected.result.outputs['puck-mid'].position.kind, 'vector');
  const repair = failure.error.repairs.find(item => item.command === 'discover');
  const discovered = ok(await gateway.dispatch({ command: repair.command, args: repair.args }, gateway.localAuthority));
  assert.ok(discovered.result.commands.some(declaration => declaration.name === 'dataflow.constant'));

  const rate = { kind: 'scalar', unit: { symbol: '1/s', dimensions: { time: -1 }, scale: 1 }, meaning: 'accumulation-rate', time: null, data: 2 };
  const corrected = ok(await preview([{ command: 'dataflow.constant', args: { id: 'known-rate', value: rate } }, connect({ node: 'known-rate', port: 'value' })]));
  assert.equal(corrected.result.validation.valid, true); assert.equal(corrected.result.graph.nodes.length, graph.nodes.length + 2);
  assert.deepEqual(project.token, expected); assert.deepEqual(project.snapshot(), graph); assert.deepEqual(project.history, history);
});
