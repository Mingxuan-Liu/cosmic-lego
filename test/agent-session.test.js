import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { createCommandGateway } from '../src/gateway/index.js';
import { createAgentSession } from '../src/agent-session/index.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const constant = id => ({ command: 'dataflow.constant', args: { id, value: { kind: 'scalar', data: 3, unit: '1', meaning: 'example-number' } } });
function fixture({ hooks = {}, limits, getProjectContext, adapters = true, runtime } = {}) {
  const registry = new ExtensionRegistry(), binding = registry.bind(), project = new Project({ validators: binding.validators });
  const gateway = createCommandGateway({ registry, binding, project, runtime }), instances = [];
  const definitions = adapters ? [{ id: 'test-only', label: 'TEST ONLY deterministic adapter', create(options) {
    const adapter = { options, starts: [], replies: [], cancellations: [], disconnected: 0,
      async connect(callbacks) { this.callbacks = callbacks; if (hooks.connect) return hooks.connect(this); return { providerSessionId: `test-provider-${instances.length}`, capabilities: { streaming: true, tools: true, cancellation: true, resume: false } }; },
      async startTurn(input) { this.starts.push(input); if (hooks.startTurn) return hooks.startTurn(this, input); },
      async cancel(turnId) { this.cancellations.push(turnId); if (hooks.cancel) return hooks.cancel(this, turnId); },
      async respond(requestId, answer) { this.replies.push({ requestId, answer }); if (hooks.respond) return hooks.respond(this, requestId, answer); },
      async disconnect() { this.disconnected++; if (hooks.disconnect) return hooks.disconnect(this); },
    }; instances.push(adapter); return adapter;
  } }] : [];
  const session = createAgentSession({ gateway, adapters: definitions, ...(limits ? { limits } : {}), ...(getProjectContext ? { getProjectContext } : {}) });
  return { project, gateway, registry, binding, session, instances,
    async connect(policy = 'deny') { await session.connect({ agentId: 'test-only', permissionPolicy: policy }); return instances.at(-1); },
    async submit(text = 'Construct a generic point.', clientRequestId = 'client-1') { return session.submit({ text, context: { identity: project.token, time: { value: 2, unit: 's' } }, clientRequestId }); },
  };
}
const call = (adapter, turnId, callId, arguments_) => adapter.callbacks.onTool({ turnId, callId, name: 'cosmic_command', arguments: arguments_ });
const emit = (adapter, turnId, event) => adapter.callbacks.onEvent({ turnId, ...event });

test('no configured adapter stays honestly disconnected and playback authority is independent', async t => {
  const f = fixture({ adapters: false }); t.after(() => f.session.dispose());
  assert.equal(f.session.snapshot().status, 'disconnected'); assert.deepEqual(f.session.snapshot().agents, []);
  await assert.rejects(f.session.connect({ agentId: 'missing' }), { code: 'AGENT_UNAVAILABLE' });
  assert.throws(() => f.session.submit({ text: 'hello' }), { code: 'SESSION_NOT_READY' });
  const outcome = await f.gateway.dispatch({ ...constant('offline'), expected: f.project.token, idempotencyKey: 'local-edit' }, f.gateway.localAuthority);
  assert.equal(outcome.ok, true); assert.equal(f.project.get('offline').value.id, 'offline');
});

test('streaming public text deduplicates events and replaces final message text without replaying deltas', async t => {
  const f = fixture(); t.after(() => f.session.dispose()); const adapter = await f.connect(), { turnId } = await f.submit();
  assert.equal(adapter.options.permissionPolicy, 'deny'); assert.equal(adapter.options.dynamicTools[0].name, 'cosmic_command');
  assert.ok(adapter.options.dynamicTools[0].inputSchema.properties.command);
  const first = { eventId: 'chunk-1', type: 'delta', id: 'assistant-1', text: 'Hello ' };
  assert.equal(await emit(adapter, turnId, first), true); assert.equal(await emit(adapter, turnId, first), false);
  await emit(adapter, turnId, { eventId: 'chunk-2', type: 'delta', id: 'assistant-1', text: 'world' });
  await emit(adapter, turnId, { eventId: 'final-1', type: 'message', id: 'assistant-1', text: 'Hello world.' });
  assert.equal(f.session.snapshot().messages.at(-1).text, 'Hello world.');
  await emit(adapter, turnId, { eventId: 'done-1', type: 'complete', reason: 'completed' });
  assert.equal(f.session.snapshot().status, 'ready'); assert.equal(f.session.snapshot().activeTurn, null);
  assert.equal(await emit(adapter, turnId, { type: 'delta', id: 'assistant-1', text: ' late' }), false);
  const denied = await call(adapter, turnId, 'after-complete', { command: 'inspect' }); assert.equal(denied.error.code, 'TURN_REVOKED');
  const stream = f.session.events(); assert.equal(new Set(stream.events.map(event => event.cursor)).size, stream.events.length);
});

test('event IDs bind content and conflicting repeated events fail the connection', async t => {
  const f = fixture(); t.after(() => f.session.dispose()); const adapter = await f.connect(), { turnId } = await f.submit();
  await emit(adapter, turnId, { eventId: 'same', type: 'delta', id: 'message', text: 'one' });
  await emit(adapter, turnId, { eventId: 'same', type: 'delta', id: 'message', text: 'two' });
  assert.equal(f.session.snapshot().status, 'failed'); assert.equal(f.session.snapshot().error.code, 'EVENT_CONFLICT');
  assert.equal(f.session.snapshot().messages.at(-1).text, 'one'); assert.equal(f.project.token.revision, 0);
});

test('duplicate submits and tool calls retain content bindings without duplicate mutations', async t => {
  const f = fixture(); t.after(() => f.session.dispose()); const adapter = await f.connect();
  const request = { text: 'Create one value.', context: { identity: f.project.token }, clientRequestId: 'dedupe-submit' };
  const [first, second] = await Promise.all([f.session.submit(request), f.session.submit(request)]);
  assert.deepEqual(first, second); assert.equal(adapter.starts.length, 1);
  assert.throws(() => f.session.submit({ ...request, text: 'Different content.' }), { code: 'REQUEST_CONFLICT' });
  const input = { ...constant('a'), expected: f.project.token, idempotencyKey: 'tool-write' };
  const [one, two] = await Promise.all([call(adapter, first.turnId, 'same-tool', input), call(adapter, first.turnId, 'same-tool', input)]);
  assert.equal(one.ok, true); assert.deepEqual(two, one); assert.equal(f.project.token.revision, 1);
  const changed = await call(adapter, first.turnId, 'same-tool', { ...input, args: { ...input.args, id: 'b' } });
  assert.equal(changed.error.code, 'TOOL_ID_CONFLICT'); assert.equal(f.project.snapshot().nodes.length, 1);
  const changes = f.session.events().events.filter(event => event.type === 'change');
  assert.equal(changes.length, 1); assert.deepEqual(changes[0].summary.created, ['a']);
  assert.equal(f.session.snapshot().status, 'working');
  const inspect = await call(adapter, first.turnId, 'inspect-new-revision', { command: 'inspect' });
  assert.equal(inspect.ok, true); assert.equal(inspect.identity.revision, 1);
  assert.equal(f.session.snapshot().activeTurn.context.identity.revision, 0, 'Submission context is immutable, while subsequent tool inspection sees current accepted state.');
});

test('Stop revokes tools immediately before cooperative cancellation settles; accepted changes remain', async t => {
  const cancelling = deferred(), f = fixture({ hooks: { cancel: () => cancelling.promise } }); t.after(() => f.session.dispose());
  const adapter = await f.connect(), { turnId } = await f.submit();
  const request = { ...constant('kept'), expected: f.project.token, idempotencyKey: 'kept' };
  assert.equal((await call(adapter, turnId, 'kept', request)).ok, true);
  const stopping = f.session.stop(); assert.equal(f.session.snapshot().status, 'cancelling'); assert.equal(f.session.snapshot().activeTurn, null);
  assert.equal((await call(adapter, turnId, 'late', { ...constant('late'), expected: f.project.token, idempotencyKey: 'late' })).error.code, 'TURN_REVOKED');
  assert.equal((await call(adapter, turnId, 'kept', request)).error.code, 'TURN_REVOKED');
  assert.equal(await emit(adapter, turnId, { type: 'message', id: 'late-message', text: 'late' }), false);
  cancelling.resolve(); await stopping;
  assert.equal(f.session.snapshot().status, 'ready'); assert.deepEqual(f.project.snapshot().nodes.map(node => node.id), ['kept']);
});

test('failed authentication stays auth-needed and reconnect creates a new native session without transcript import', async t => {
  let authenticate = false;
  const f = fixture({ hooks: { connect: async adapter => {
    if (!authenticate) { await adapter.callbacks.onEvent({ type: 'auth-needed', eventId: 'auth', message: 'Sign in in the runtime.' }); throw Object.assign(new Error('Not authenticated'), { code: 'AUTH_REQUIRED' }); }
    return { providerSessionId: 'authenticated-provider', capabilities: { resume: false } };
  } } }); t.after(() => f.session.dispose());
  await f.connect(); assert.equal(f.session.snapshot().status, 'auth-needed'); assert.equal(f.session.snapshot().providerSessionId, null);
  assert.throws(() => f.session.submit({ text: 'Not yet' }), { code: 'SESSION_NOT_READY' });
  authenticate = true; const adapter = await f.connect(); assert.equal(f.session.snapshot().status, 'ready');
  const { turnId } = await f.submit(); await emit(adapter, turnId, { type: 'message', id: 'reply', text: 'Visible public transcript.' });
  await f.session.disconnect(); const previousTranscript = f.session.snapshot().messages;
  await f.connect(); assert.deepEqual(f.session.snapshot().messages, previousTranscript);
  await f.submit('New independent turn.', 'client-2');
  assert.equal(Object.hasOwn(f.instances.at(-1).starts[0].context, 'messages'), false);
  assert.equal(await emit(adapter, turnId, { type: 'message', id: 'old-connection', text: 'late' }), false);
});

test('default deny and explicit ask translate genuine requests without per-edit approvals or secret answers', async t => {
  const f = fixture(); t.after(() => f.session.dispose()); let adapter = await f.connect(), submitted = await f.submit();
  const permission = (turnId, requestId) => ({ turnId, requestId, kind: 'permission', message: 'Native capability request', options: [{ id: 'deny', label: 'Deny' }] });
  await adapter.callbacks.onRequest(permission(submitted.turnId, 'denied'));
  assert.deepEqual(adapter.replies, [{ requestId: 'denied', answer: { decision: 'deny' } }]); assert.deepEqual(f.session.snapshot().requests, []);
  await f.session.disconnect(); adapter = await f.connect('ask'); submitted = await f.submit('Ask test.', 'client-2');
  await adapter.callbacks.onRequest(permission(submitted.turnId, 'ask'));
  const requestId = f.session.snapshot().requests[0].requestId;
  await assert.rejects(f.session.reply({ requestId, answer: { decision: 'allow' } }), { code: 'PERMISSION_POLICY' });
  await f.session.reply({ requestId, answer: { decision: 'deny' } });
  await assert.rejects(f.session.reply({ requestId, answer: { decision: 'deny' } }), { code: 'REQUEST_EXPIRED' });
  await adapter.callbacks.onRequest({ turnId: submitted.turnId, requestId: 'input', kind: 'input', message: 'Select a title', questions: [{ id: 'title', header: 'Title', question: 'Which title?', options: [{ label: 'Example', description: 'Use an example.' }] }] });
  await f.session.reply({ requestId: f.session.snapshot().requests[0].requestId, answer: { answers: { title: ['Private user answer, not transcript'] } } });
  assert.equal(JSON.stringify(f.session.snapshot()).includes('Private user answer'), false);
  assert.equal(JSON.stringify(f.session.events()).includes('Private user answer'), false);
  assert.deepEqual(adapter.replies.at(-1).answer, { answers: { title: ['Private user answer, not transcript'] } });
  await adapter.callbacks.onRequest({ turnId: submitted.turnId, requestId: 'secret', kind: 'input', message: 'Password', questions: [{ id: 'password', question: 'Enter password', isSecret: true }] });
  assert.equal(f.session.snapshot().status, 'failed'); assert.equal(f.session.snapshot().error.code, 'SECRET_INPUT_UNSUPPORTED');
});

test('stale submitted contexts reject and project load revokes active turns while ordinary revisions do not', async t => {
  const f = fixture(); t.after(() => f.session.dispose()); const adapter = await f.connect(), old = f.project.token;
  await f.gateway.dispatch({ ...constant('local'), expected: old, idempotencyKey: 'local' }, f.gateway.localAuthority);
  await assert.rejects(f.session.submit({ text: 'Stale selection', context: { identity: old }, clientRequestId: 'stale' }), { code: 'STALE_CONTEXT' });
  assert.equal(adapter.starts.length, 0); assert.equal(f.session.snapshot().status, 'ready');
  const { turnId } = await f.submit('Current turn.', 'current');
  const initial = f.project.snapshot(); f.project.load(initial, f.project.token);
  await f.session.synchronize();
  assert.equal(f.session.snapshot().status, 'disconnected'); assert.equal(f.session.snapshot().activeTurn, null);
  assert.equal((await call(adapter, turnId, 'after-load', { command: 'inspect' })).error.code, 'TURN_REVOKED');
});

test('event ring, transcript and tool output budgets remain bounded without truncating JSON', async t => {
  const f = fixture({ limits: { maxEvents: 4, maxMessages: 3, maxTranscriptBytes: 512, maxToolResultBytes: 200 } });
  t.after(() => f.session.dispose()); const adapter = await f.connect(), { turnId } = await f.submit();
  for (let i = 0; i < 10; i++) await emit(adapter, turnId, { type: 'message', eventId: `event-${i}`, id: `message-${i}`, text: 'x'.repeat(60) });
  const snapshot = f.session.snapshot(), events = f.session.events(0);
  assert.ok(snapshot.messages.length <= 3); assert.ok(Buffer.byteLength(JSON.stringify(snapshot.messages)) <= 512);
  assert.equal(events.events.length, 4); assert.equal(events.resetRequired, true);
  assert.deepEqual(f.session.events(events.cursor).events, []);
  const result = await call(adapter, turnId, 'large-discovery', { command: 'discover' });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'TOOL_RESULT_BUDGET');
  assert.deepEqual(result.error.repairs[0].args, { detail: 'summary' }); assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal(JSON.stringify(f.session.events()).includes('inputSchema'), false);
});

test('request/context admission rejects getters, repository text and malformed selections before adapter submission', async t => {
  const f = fixture(); t.after(() => f.session.dispose()); const adapter = await f.connect(); let reads = 0;
  assert.throws(() => f.session.submit({ get text() { reads++; return 'unsafe'; } }), { code: 'INVALID_DATA' }); assert.equal(reads, 0);
  await assert.rejects(f.session.submit({ text: 'Do not send files', context: { identity: f.project.token, repository: 'secret file content' } }), { code: 'CONTEXT_SCHEMA' });
  await assert.rejects(f.session.submit({ text: 'Unknown ID', context: { identity: f.project.token, selection: { nodeId: 'missing' } } }), { code: 'CONTEXT_SELECTION' });
  assert.equal(adapter.starts.length, 0); assert.equal(f.project.token.revision, 0);
});

test('Stop cancels a gateway runtime job and suppresses its late result', async t => {
  const started = deferred(), result = deferred(); let cancellations = 0;
  const runtime = { setProject() {}, submit() { started.resolve(); return { promise: result.promise, cancel() { cancellations++; result.resolve({ valid: false, diagnostics: [{ code: 'CANCELLED', message: 'Cancelled test job.' }] }); } }; } };
  const f = fixture({ runtime }); t.after(() => f.session.dispose());
  await f.gateway.dispatch({ ...constant('source'), expected: f.project.token, idempotencyKey: 'source' }, f.gateway.localAuthority);
  const adapter = await f.connect(), { turnId } = await f.submit();
  const pending = call(adapter, turnId, 'evaluation', { command: 'evaluate', args: { id: 'source' }, expected: f.project.token });
  await started.promise; await f.session.stop();
  assert.equal(cancellations, 1); assert.equal((await pending).error.code, 'TURN_REVOKED');
  assert.equal(f.project.get('source').value.data.value.data, 3);
});

test('late events and requests cannot disrupt a new turn or reuse an old reply correlation', async t => {
  const f = fixture(); t.after(() => f.session.dispose()); const adapter = await f.connect('ask'), first = await f.submit();
  const permission = turnId => ({ turnId, requestId: 'provider-reused-id', kind: 'permission', message: 'Permission', options: [{ id: 'deny', label: 'Deny' }] });
  await adapter.callbacks.onRequest(permission(first.turnId));
  const oldReply = f.session.snapshot().requests[0].requestId;
  await emit(adapter, first.turnId, { type: 'delta', eventId: 'shared-id', id: 'old', text: 'Old' });
  await f.session.stop(); const next = await f.submit('Next turn.', 'client-2');
  await emit(adapter, first.turnId, { type: 'delta', eventId: 'shared-id', id: 'old', text: 'Changed late content' });
  assert.equal(await adapter.callbacks.onRequest(permission(first.turnId)), false);
  await adapter.callbacks.onRequest(permission(next.turnId));
  assert.notEqual(f.session.snapshot().requests[0].requestId, oldReply);
  await assert.rejects(f.session.reply({ requestId: oldReply, answer: { decision: 'deny' } }), { code: 'REQUEST_EXPIRED' });
  assert.equal(f.session.snapshot().status, 'working'); assert.equal(f.session.snapshot().activeTurn.id, next.turnId);
});

test('connection-level failures revoke an active turn and disposal prevents reconnect races', async () => {
  const shuttingDown = deferred(); let block = false;
  const f = fixture({ hooks: { disconnect: () => block ? shuttingDown.promise : undefined } });
  const adapter = await f.connect(); await f.submit();
  await adapter.callbacks.onEvent({ type: 'error', eventId: 'transport-error', code: 'AGENT_DISCONNECTED', message: 'Connection lost.' });
  assert.equal(f.session.snapshot().status, 'failed'); assert.equal(f.session.snapshot().activeTurn, null);
  await f.connect(); block = true; const disposing = f.session.dispose();
  await assert.rejects(f.session.connect({ agentId: 'test-only' }), { code: 'SESSION_DISPOSED' });
  shuttingDown.resolve(); await disposing; assert.equal(f.session.snapshot().status, 'disconnected');
});

test('Stop arriving before its Submit reserves a bounded cancellation in that session', async t => {
  const f = fixture({ limits: { maxClientRequests: 2 } }); t.after(() => f.session.dispose());
  const adapter = await f.connect(), sessionId = f.session.snapshot().sessionId;
  const stopped = { sessionId, clientRequestId: 'arrives-later' };
  await f.session.stop(stopped); await f.session.stop(stopped);
  assert.throws(() => f.session.submit({ ...stopped, text: 'Late delivery' }), { code: 'TURN_REVOKED' });
  assert.throws(() => f.session.submit({ ...stopped, text: 'Late retry' }), { code: 'TURN_REVOKED' });
  assert.equal(adapter.starts.length, 0);
  const current = await f.session.submit({ sessionId, clientRequestId: 'current', text: 'Current work' });
  await assert.rejects(f.session.stop({ sessionId, clientRequestId: 'another-absent' }), { code: 'SESSION_BUDGET' });
  assert.equal(f.session.snapshot().activeTurn.id, current.turnId);
  await f.session.stop({ sessionId, turnId: current.turnId });
  assert.deepEqual(adapter.cancellations, [current.turnId]);
  await f.connect();
  const accepted = await f.session.submit({ sessionId: f.session.snapshot().sessionId, clientRequestId: stopped.clientRequestId, text: 'Explicit new-session request' });
  assert.equal(accepted.accepted, true);
});

test('a stale session cannot submit, deduplicate against, or stop a reconnected session', async t => {
  const f = fixture(); t.after(() => f.session.dispose());
  await f.connect(); const oldSession = f.session.snapshot().sessionId;
  const adapter = await f.connect(), newSession = f.session.snapshot().sessionId;
  const request = { sessionId: newSession, clientRequestId: 'same-client-id', text: 'Current request' };
  const current = await f.session.submit(request);
  assert.throws(() => f.session.submit({ ...request, sessionId: oldSession }), { code: 'STALE_SESSION' });
  await assert.rejects(f.session.stop({ sessionId: oldSession, clientRequestId: request.clientRequestId, turnId: current.turnId }), { code: 'STALE_SESSION' });
  assert.equal(f.session.snapshot().activeTurn.id, current.turnId);
  assert.deepEqual(adapter.cancellations, []);
});

test('matching Stop cancels pending context collection without invalidating the next submit', async t => {
  const gathering = deferred(), gate = deferred(); let first = true;
  const f = fixture({ async getProjectContext() { if (first) { first = false; gathering.resolve(); await gate.promise; } return {}; } });
  t.after(() => f.session.dispose()); const adapter = await f.connect(), sessionId = f.session.snapshot().sessionId;
  const old = { sessionId, clientRequestId: 'old', text: 'Collecting context' };
  const pending = f.session.submit(old); await gathering.promise;
  await f.session.stop({ sessionId, clientRequestId: 'old' });
  assert.throws(() => f.session.submit(old), { code: 'TURN_REVOKED' });
  const current = await f.session.submit({ sessionId, clientRequestId: 'next', text: 'Next request' });
  gate.resolve(); await assert.rejects(pending, { code: 'TURN_REVOKED' });
  assert.deepEqual(adapter.starts.map(turn => turn.turnId), [current.turnId]); assert.deepEqual(adapter.cancellations, []);
  assert.equal(f.session.snapshot().activeTurn.id, current.turnId);
});

test('delayed Stop for an earlier turn leaves a later pending or active submission intact', async t => {
  const gathering = deferred(), gate = deferred(); let calls = 0;
  const f = fixture({ async getProjectContext() { if (++calls === 2) { gathering.resolve(); await gate.promise; } return {}; } });
  t.after(() => f.session.dispose()); const adapter = await f.connect(), sessionId = f.session.snapshot().sessionId;
  const old = await f.session.submit({ sessionId, clientRequestId: 'old', text: 'First request' });
  await emit(adapter, old.turnId, { type: 'complete' });
  const pending = f.session.submit({ sessionId, clientRequestId: 'next', text: 'Second request' }); await gathering.promise;
  await f.session.stop({ sessionId, clientRequestId: 'old' });
  await f.session.stop({ sessionId, turnId: old.turnId });
  gate.resolve(); const current = await pending;
  await f.session.stop({ sessionId, turnId: current.turnId, clientRequestId: 'old' });
  await f.session.stop({ sessionId, turnId: old.turnId, clientRequestId: 'next' });
  assert.equal(f.session.snapshot().activeTurn.id, current.turnId); assert.deepEqual(adapter.cancellations, []);
  await f.session.stop({ sessionId, turnId: current.turnId, clientRequestId: current.clientRequestId });
  assert.deepEqual(adapter.cancellations, [current.turnId]);
});

test('a late adapter start rejection after scoped Stop cannot fail a newer turn', async t => {
  const started = deferred(), gate = deferred(); let calls = 0;
  const f = fixture({ hooks: { async startTurn() { if (++calls === 1) { started.resolve(); await gate.promise; } } } });
  t.after(() => f.session.dispose()); const adapter = await f.connect(), sessionId = f.session.snapshot().sessionId;
  const pending = f.session.submit({ sessionId, clientRequestId: 'starting', text: 'Waiting for adapter' }); await started.promise;
  const oldId = f.session.snapshot().activeTurn.id;
  const stopping = f.session.stop({ sessionId, clientRequestId: 'starting' });
  assert.equal(f.session.snapshot().activeTurn, null);
  assert.equal((await call(adapter, oldId, 'late-tool', { command: 'inspect' })).error.code, 'TURN_REVOKED');
  await stopping;
  const next = await f.session.submit({ sessionId, clientRequestId: 'new', text: 'Current request' });
  gate.reject(new Error('Old adapter request closed')); await assert.rejects(pending, { code: 'TURN_REVOKED' });
  assert.equal(f.session.snapshot().status, 'working'); assert.equal(f.session.snapshot().activeTurn.id, next.turnId);
});
