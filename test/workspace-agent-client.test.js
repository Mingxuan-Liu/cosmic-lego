import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation, createAgentClient } from '../src/workspace/session.js';
const clone = value => structuredClone(value);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness({ agents = [{ id: 'mock', label: 'TEST ONLY mock agent' }] } = {}) {
  const calls = []; let client, serial = 0, rejectAuth = false, rejectSubmit = false, heldSubmit, heldDelivery, heldState;
  let state = { status: 'disconnected', label: 'No agent connected', agents, capabilities: {}, permissionPolicy: 'deny', agentId: null,
    sessionId: null, activeTurn: null, messages: [], requests: [], progress: null, error: null, cursor: 0 };
  const response = (result, error) => ({ ok: !error, json: async () => error ? { ok: false, error } : { ok: true, result: clone(result) } });
  const change = patch => { state = { ...state, ...clone(patch), cursor: state.cursor + 1 }; };
  const conversation = createConversation({ onEvent: event => client.handle(event) });
  client = createAgentClient({ conversation, schedule() { return 1; }, unschedule() {}, requestId: () => `request-${++serial}`,
    async fetch(url, options = {}) {
      const input = options.body ? JSON.parse(options.body) : undefined; calls.push({ url, input });
      if (url.endsWith('/state')) {
        const captured = clone(state); if (heldState) { const hold = heldState; heldState = null; await hold.promise; }
        return response(captured);
      }
      if (url.includes('/events?')) return Number(url.split('after=')[1]) > state.cursor
        ? response(null, { code: 'EVENT_CURSOR', message: 'The companion restarted.' })
        : response({ cursor: state.cursor, events: [], resetRequired: false });
      if (url.endsWith('/connect')) {
        if (rejectAuth) { change({ status: 'auth-needed', label: 'Authentication needed', error: { code: 'AUTH', message: 'Run the runtime login command.' } }); return response(null, state.error); }
        change({ status: 'ready', label: 'TEST ONLY ready', agentId: input.agentId, sessionId: `session-${serial}`, permissionPolicy: input.permissionPolicy, error: null }); return response({ connected: true });
      }
      if (url.endsWith('/submit')) {
        if (heldDelivery) {
          await heldDelivery.promise;
          return response(null, { code: 'TURN_REVOKED', message: 'Stopped before delivery.' });
        }
        if (rejectSubmit) return response(null, { code: 'STALE_CONTEXT', message: 'Refresh selected context.' });
        const id = `native-${input.clientRequestId}`;
        change({ status: 'working', label: 'TEST ONLY working', activeTurn: { id, clientRequestId: input.clientRequestId, context: input.context },
          messages: [...state.messages, { id: `${id}:user`, turnId: id, role: 'user', text: input.text }] });
        if (heldSubmit) await heldSubmit.promise;
        return response({ accepted: true, turnId: id, clientRequestId: input.clientRequestId });
      }
      if (url.endsWith('/stop')) { change({ status: 'ready', label: 'TEST ONLY stopped', activeTurn: null, progress: null, requests: [] }); return response({ stopped: true }); }
      if (url.endsWith('/disconnect')) { change({ status: 'disconnected', label: 'No agent connected', activeTurn: null, agentId: null }); return response({ disconnected: true }); }
      if (url.endsWith('/reply')) { change({ requests: [] }); return response({ replied: true }); }
      throw new Error('Unknown mock route.');
    },
  });
  return { client, conversation, calls, change, state: () => clone(state), authFailure: () => { rejectAuth = true; }, staleSubmission: () => { rejectSubmit = true; },
    restart: () => { state = { ...state, status: 'disconnected', label: 'No agent connected', agentId: null, sessionId: null, activeTurn: null, messages: [], requests: [], cursor: 0 }; },
    holdSubmit: () => (heldSubmit = deferred()), holdDelivery: () => (heldDelivery = deferred()), holdState: () => (heldState = deferred()) };
}

test('unconfigured companion preserves disconnected drafts and the explicit F06 test seam without sending requests', async t => {
  const h = harness({ agents: [] }); t.after(h.client.dispose); await h.client.start();
  h.conversation.draft('composer', 'Draft'); assert.equal(h.conversation.submit('composer'), false);
  await assert.rejects(h.client.connect('invented'), /host-configured/);
  h.conversation.receive({ type: 'connection', status: 'connected', label: 'TEST ONLY injection' });
  h.conversation.submit('composer'); await settle(); await h.client.poll();
  assert.equal(h.conversation.snapshot().label, 'TEST ONLY injection');
  assert.equal(h.calls.some(call => call.input), false);
});

test('managed mock snapshots stream once under native IDs and preserve immutable context and local drafts', async t => {
  const h = harness(); t.after(h.client.dispose); await h.client.start(); await h.client.connect('mock');
  const context = { identity: { projectId: 'p', generation: 'g', revision: 1 }, time: { value: 2, unit: 's' }, selection: { nodeId: 'point' } };
  h.conversation.context(context); h.conversation.draft('composer', 'Inspect this'); h.conversation.draft('other', 'Keep draft');
  h.conversation.submit('composer'); context.selection.nodeId = 'changed'; await settle();
  const sent = h.calls.find(call => call.url.endsWith('/submit')).input;
  assert.equal(sent.clientRequestId, 'request-1'); assert.equal(sent.context.selection.nodeId, 'point'); assert.equal(sent.sessionId, 'session-0');
  assert.equal(h.conversation.snapshot().messages.filter(message => message.role === 'user').length, 1);
  const turnId = h.state().activeTurn.id;
  h.change({ messages: [...h.state().messages, { id: 'answer', turnId, role: 'assistant', text: 'First' }] }); await h.client.poll();
  h.change({ messages: [h.state().messages[0], { id: 'answer', turnId, role: 'assistant', text: 'First and second' }] });
  await h.client.poll(); await h.client.poll();
  assert.equal(h.conversation.snapshot().messages.length, 2); assert.equal(h.conversation.snapshot().messages[1].text, 'First and second');
  assert.equal(h.conversation.snapshot().drafts.other, 'Keep draft');
});

test('failed authentication stays auth-needed and retains runtime login directions without a connected claim', async t => {
  const h = harness(); t.after(h.client.dispose); await h.client.start(); h.authFailure(); h.conversation.draft('composer', 'Keep');
  await assert.rejects(h.client.connect('mock'), { code: 'AUTH' });
  assert.equal(h.client.snapshot().status, 'auth-needed'); assert.notEqual(h.conversation.snapshot().connection, 'connected');
  assert.match(h.conversation.snapshot().error, /runtime login/); assert.equal(h.conversation.snapshot().drafts.composer, 'Keep');
});

test('Stop interrupts a pending submit and a late response cannot restore its active turn', async t => {
  const h = harness(); t.after(h.client.dispose); await h.client.start(); await h.client.connect('mock');
  const held = h.holdSubmit(); h.conversation.draft('composer', 'Start'); h.conversation.submit('composer'); await settle();
  assert.equal(h.client.snapshot().busy, true); assert.equal(h.conversation.cancel(), true); await settle();
  assert.equal(h.calls.filter(call => call.url.endsWith('/stop')).length, 1); assert.equal(h.conversation.snapshot().activeTurn, null);
  assert.deepEqual(h.calls.find(call => call.url.endsWith('/stop')).input, { sessionId: 'session-0', clientRequestId: 'request-1' });
  held.resolve(); await settle(); assert.equal(h.conversation.snapshot().activeTurn, null); assert.equal(h.client.snapshot().status, 'ready');
});

test('a stale in-flight state read cannot replace the state accepted after Stop', async t => {
  const h = harness(); t.after(h.client.dispose); await h.client.start(); await h.client.connect('mock');
  h.conversation.draft('composer', 'Start'); h.conversation.submit('composer'); await settle();
  h.change({ progress: { label: 'Old progress', fraction: 0.2 } }); const held = h.holdState(), polling = h.client.poll(); await settle();
  h.conversation.cancel(); await settle(); held.resolve(); await polling;
  assert.deepEqual(h.calls.find(call => call.url.endsWith('/stop')).input, { sessionId: 'session-0', turnId: 'native-request-1' });
  assert.equal(h.conversation.snapshot().activeTurn, null); assert.equal(h.conversation.snapshot().progress, null);
});

test('Stop before submit delivery carries its captured session and request, and the late rejection stays retired', async t => {
  const h = harness(); t.after(h.client.dispose); await h.client.start(); await h.client.connect('mock');
  const held = h.holdDelivery(); h.conversation.draft('composer', 'Start'); h.conversation.submit('composer');
  h.conversation.cancel(); await settle();
  const submit = h.calls.find(call => call.url.endsWith('/submit')).input;
  assert.deepEqual(h.calls.find(call => call.url.endsWith('/stop')).input, { sessionId: submit.sessionId, clientRequestId: submit.clientRequestId });
  held.resolve(); await settle();
  assert.equal(h.conversation.snapshot().activeTurn, null); assert.equal(h.conversation.snapshot().error, null);
  assert.equal(h.conversation.snapshot().drafts.composer, '');
});

test('a second browser stops only its displayed host turn and ignores an unmatched cancellation', async t => {
  const h = harness(); t.after(h.client.dispose);
  h.change({ status: 'working', agentId: 'mock', sessionId: 'peer-session', activeTurn: { id: 'peer-turn', clientRequestId: 'peer-request' } });
  await h.client.start(); h.client.handle({ type: 'cancel', turnId: 'stale-turn' });
  assert.equal(h.calls.some(call => call.url.endsWith('/stop')), false);
  h.conversation.cancel(); await settle();
  assert.deepEqual(h.calls.find(call => call.url.endsWith('/stop')).input, { sessionId: 'peer-session', turnId: 'peer-turn' });
});

test('a fresh disconnected page displays saved public messages without connecting or enabling Send', async t => {
  const h = harness(); t.after(h.client.dispose);
  const saved = { id: 'answer', turnId: 'old-turn', sessionId: 'old-session', role: 'assistant', text: 'Previously accepted public text.' };
  h.change({ messages: [saved] }); await h.client.start();
  assert.deepEqual(h.conversation.snapshot().messages, [saved]); assert.equal(h.client.snapshot().managed, false);
  h.conversation.draft('composer', 'New draft'); assert.equal(h.conversation.submit('composer'), false);
  assert.equal(h.calls.some(call => call.input), false);
});

test('closing a managed observer detaches while closing an unmanaged test composer cancels its local turn', async () => {
  const managed = harness();
  managed.change({ status: 'working', agentId: 'mock', sessionId: 'peer-session', activeTurn: { id: 'peer-turn' } });
  await managed.client.start(); managed.client.dispose(); await settle();
  assert.equal(managed.calls.some(call => call.url.endsWith('/stop')), false); assert.equal(managed.state().activeTurn.id, 'peer-turn');
  const local = harness({ agents: [] }); await local.client.start();
  local.conversation.receive({ type: 'connection', status: 'connected', label: 'TEST ONLY' });
  local.conversation.draft('c', 'Local event'); local.conversation.submit('c'); local.client.dispose();
  assert.equal(local.conversation.snapshot().activeTurn, null); assert.equal(local.calls.some(call => call.input), false);
});

test('genuine request replies use explicit policy and structured answers, and reconnect keeps drafts', async t => {
  const h = harness(); t.after(h.client.dispose); await h.client.start(); await h.client.connect('mock', 'ask');
  assert.equal(h.calls.find(call => call.url.endsWith('/connect')).input.permissionPolicy, 'ask');
  h.conversation.draft('composer', 'Keep through reconnect');
  h.change({ requests: [{ requestId: 'permission-1', kind: 'permission', message: 'Runtime asks' }] }); await h.client.poll();
  await h.client.reply('permission-1', { decision: 'deny' });
  await h.client.reply('input-1', { answers: { choice: ['One'] } });
  assert.deepEqual(h.calls.filter(call => call.url.endsWith('/reply')).map(call => call.input.answer), [{ decision: 'deny' }, { answers: { choice: ['One'] } }]);
  await h.client.disconnect(); assert.equal(h.client.snapshot().managed, false);
  await h.client.connect('mock'); assert.equal(h.conversation.snapshot().drafts.composer, 'Keep through reconnect');
});

test('explicit stale-context rejection restores the unsent draft without duplicating a user message', async t => {
  const h = harness(); t.after(h.client.dispose); await h.client.start(); await h.client.connect('mock'); h.staleSubmission();
  h.conversation.draft('composer', 'Retry after context refresh'); h.conversation.submit('composer'); await settle();
  assert.equal(h.conversation.snapshot().drafts.composer, 'Retry after context refresh');
  assert.equal(h.conversation.snapshot().messages.length, 0); assert.equal(h.conversation.snapshot().activeTurn, null);
  assert.match(h.conversation.snapshot().error, /Refresh selected context/);
});

test('a restarted companion resets the event cursor without claiming provider resumption', async t => {
  const h = harness(); t.after(h.client.dispose); await h.client.start(); await h.client.connect('mock'); await h.client.poll();
  h.conversation.draft('composer', 'Local draft survives the companion restart'); h.restart(); await h.client.poll();
  assert.equal(h.client.snapshot().status, 'disconnected'); assert.equal(h.conversation.snapshot().connection, 'disconnected');
  assert.equal(h.conversation.snapshot().drafts.composer, 'Local draft survives the companion restart');
  assert.equal(h.calls.filter(call => call.url.endsWith('/connect')).length, 1);
});
