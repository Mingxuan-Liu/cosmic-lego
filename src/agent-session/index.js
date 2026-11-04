import { copyData, freezeData, isRecord, fail } from '../core/data.js';
import { createHash } from 'node:crypto';
import { boundedData, buildAgentContext, sameLoad } from './context.js';
export { buildAgentContext, CONTEXT_LIMITS } from './context.js';

export const SESSION_LIMITS = Object.freeze({ maxTextChars: 12000, maxMessages: 200, maxTranscriptBytes: 524288,
  maxEvents: 256, maxEventBytes: 65536, maxEventLogBytes: 524288, maxToolCalls: 128, maxToolBytes: 65536,
  maxToolResultBytes: 262144, maxRequests: 8, maxClientRequests: 128, maxSeenEvents: 4096 });
const insist = (condition, code, message) => { if (!condition) fail(code, message); };
const bytes = data => new TextEncoder().encode(JSON.stringify(data)).length;
const canonical = data => JSON.stringify(data, (_, item) => isRecord(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fingerprint = data => createHash('sha256').update(canonical(data)).digest('hex');
const id = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const text = (value, max = 160) => typeof value === 'string' && value.length > 0 && value.length <= max;
const fields = (value, allowed) => insist(isRecord(value) && Object.keys(value).every(key => allowed.includes(key)), 'SESSION_ARGUMENT', 'Unsupported session arguments.');
const publicError = error => ({ code: typeof error?.code === 'string' ? error.code : 'AGENT_FAILURE', message: String(error?.message ?? 'Agent operation failed.').slice(0, 2000) });
const toolFailure = (code, message, identity = null) => ({ ok: false, command: null, error: { code, category: code.includes('BUDGET') ? 'resource-exhausted' : 'cancelled', message,
  diagnostics: [{ code, path: '$', message }], affectedIds: [], paths: ['$'], repairs: [{ command: 'discover', args: { detail: 'summary' }, description: 'Use summary discovery, then request full schemas with names. Inspect current state before revising a request.' }] }, context: { identity } });

/** Trusted host lifecycle. Only adapter callbacks receive the scoped tool route. */
export function createAgentSession({ gateway, getProjectContext = () => ({}), adapters = [], limits: overrides = {} } = {}) {
  insist(gateway && ['dispatch', 'createSession', 'issueTurn', 'revokeTurn', 'closeSession', 'forTurn'].every(key => typeof gateway[key] === 'function'), 'SESSION_HOST', 'Supply the validated command gateway.');
  insist(typeof getProjectContext === 'function' && Array.isArray(adapters), 'SESSION_HOST', 'Supply trusted adapters and a context callback.');
  const limits = { ...SESSION_LIMITS, ...copyData(overrides) }; fields(limits, Object.keys(SESSION_LIMITS));
  insist(Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0), 'SESSION_LIMITS', 'Session limits must be positive safe integers.');
  const installed = new Map();
  for (const adapter of adapters) {
    insist(text(adapter?.id) && text(adapter.label, 240) && typeof adapter.create === 'function' && !installed.has(adapter.id), 'SESSION_HOST', 'Adapters require distinct IDs, labels and trusted factories.');
    installed.set(adapter.id, adapter);
  }
  let epoch = 0, cursor = 0, eventBytes = 0, connection = null, active = null, disposed = false, pendingSubmit = null;
  const listeners = new Set(), log = [], clients = new Map(), seenEvents = new Map();
  const state = { status: 'disconnected', label: 'No agent connected', agentId: null, sessionId: null, providerSessionId: null,
    capabilities: {}, agents: [...installed.values()].map(({ id, label }) => ({ id, label })), permissionPolicy: 'deny', activeTurn: null,
    messages: [], progress: null, requests: [], error: null, cursor: 0 };
  const snapshot = () => freezeData(copyData({ ...state, cursor }));
  function publish(event) {
    const record = boundedData({ ...event, eventId: event.eventId ?? id('event'), sessionId: state.sessionId, cursor: ++cursor }, limits.maxEventBytes);
    const size = bytes(record); log.push({ data: freezeData(record), bytes: size }); eventBytes += size;
    while (log.length > limits.maxEvents || eventBytes > limits.maxEventLogBytes) eventBytes -= log.shift().bytes;
    for (const listener of listeners) { try { listener(snapshot(), copyData(record)); } catch { /* a UI listener cannot change authority */ } }
    return record;
  }
  function status(value, label, error = null) { state.status = value; state.label = label; state.error = error; publish({ type: 'connection', status: value, label, ...(error ? { error } : {}) }); }
  const live = (record, turn = null) => !disposed && connection === record && record.epoch === epoch && record.active && (!turn || active === turn && turn.active);
  function checkSession(sessionId) {
    insist(text(sessionId, 240), 'SESSION_ARGUMENT', 'Use a bounded session ID.');
    insist(sessionId === state.sessionId && connection && live(connection), 'STALE_SESSION', 'The originating agent session has ended or changed.');
  }
  function revokeTurn(reason = 'cancelled') {
    const turn = active;
    if (!turn) return null;
    turn.active = false; active = null;
    // Revoke before adapter cancellation, callbacks, events, or asynchronous work.
    gateway.revokeTurn(turn.grant);
    state.activeTurn = null; state.progress = null; state.requests = [];
    publish({ type: 'complete', turnId: turn.id, reason });
    return turn;
  }
  function retire(record, reason = 'disconnected') {
    if (!record) return;
    if (connection === record) revokeTurn(reason);
    record.active = false;
    try { gateway.closeSession(record.grant); } catch { /* already rotated on a project load */ }
  }
  function trimMessages() {
    while (state.messages.length > limits.maxMessages || bytes(state.messages) > limits.maxTranscriptBytes) state.messages.shift();
  }
  function appendMessage(message, delta = false) {
    const existing = state.messages.find(item => item.id === message.id);
    insist(!existing || existing.turnId === message.turnId && existing.role !== 'user', 'EVENT_CONFLICT', 'A provider message ID cannot overwrite another turn or a user message.');
    const combined = delta ? (existing?.text ?? '') + message.text : message.text;
    insist(typeof combined === 'string' && combined.length <= limits.maxTextChars, 'SESSION_BUDGET', 'A public message exceeds the text limit.');
    const item = { sessionId: state.sessionId, ...message, text: combined };
    state.messages = existing ? state.messages.map(old => old.id === item.id ? item : old) : [...state.messages, item]; trimMessages();
  }
  async function inspectCurrent() {
    const inspected = await gateway.dispatch({ command: 'inspect' });
    insist(inspected.ok, inspected.error?.code ?? 'PROJECT_CONTEXT', inspected.error?.message ?? 'Cannot inspect the accepted project.');
    return inspected;
  }
  async function synchronize() {
    if (!connection) return snapshot();
    const record = connection, inspected = await inspectCurrent();
    if (live(record) && !sameLoad(record.identity, inspected.identity)) {
      ++epoch; pendingSubmit = null;
      retire(record, 'project-changed'); connection = null;
      state.providerSessionId = null;
      status('disconnected', 'Project changed; reconnect the agent.');
      try { await record.adapter.disconnect(); } catch { /* grant already revoked */ }
    }
    return snapshot();
  }
  async function failConnection(record, error, auth = false) {
    if (!live(record)) return;
    retire(record, auth ? 'authentication-needed' : 'failed');
    state.progress = null;
    status(auth ? 'auth-needed' : 'failed', auth ? 'Authentication required in the local agent runtime' : 'Agent connection failed', publicError(error));
    try { await record.adapter.disconnect(); } catch { /* no remaining grant */ }
  }
  async function receive(record, input) {
    if (!live(record)) return false;
    try {
      await synchronize(); if (!live(record)) return false;
      const event = boundedData(input, limits.maxEventBytes);
      insist(text(event.type, 80), 'AGENT_EVENT', 'Provider events require a type.');
      if (event.turnId !== undefined && event.turnId !== active?.id) return false;
      if (event.eventId !== undefined) {
        insist(text(event.eventId, 240), 'AGENT_EVENT', 'Provider event ID is invalid.');
        const signature = fingerprint(event), old = seenEvents.get(event.eventId);
        if (old !== undefined) { insist(old === signature, 'EVENT_CONFLICT', 'A provider event ID changed content.'); return false; }
        insist(seenEvents.size < limits.maxSeenEvents, 'SESSION_BUDGET', 'Provider event deduplication budget reached; reconnect.'); seenEvents.set(event.eventId, signature);
      }
      if (event.type === 'auth-needed') { await failConnection(record, { code: 'AUTH_REQUIRED', message: event.message ?? 'Authenticate through the configured runtime.' }, true); return true; }
      if (event.type === 'disconnected') { retire(record); status('disconnected', 'Agent disconnected'); return true; }
      if (event.type === 'ready') { if (!active && state.status !== 'connecting') status('ready', 'Agent ready'); return true; }
      if (event.type === 'error' && event.turnId === undefined) { await failConnection(record, { code: event.code ?? 'AGENT_FAILURE', message: event.message ?? 'The agent connection reported an error.' }); return true; }
      const turn = active;
      if (!turn || event.turnId !== turn.id || !live(record, turn)) return false;
      if (['message', 'delta'].includes(event.type)) {
        insist(text(event.id) && typeof event.text === 'string' && ['assistant', 'system', 'tool'].includes(event.role ?? 'assistant'), 'AGENT_EVENT', 'Use a stable public message ID, role and text.');
        appendMessage({ id: event.id, turnId: turn.id, role: event.role ?? 'assistant', text: event.text }, event.type === 'delta');
        publish({ type: event.type, turnId: turn.id, id: event.id, text: event.text, role: event.role ?? 'assistant' });
      } else if (event.type === 'progress') {
        insist(text(event.label, 240) && (event.fraction == null || Number.isFinite(event.fraction) && event.fraction >= 0 && event.fraction <= 1), 'AGENT_EVENT', 'Progress must be bounded public data.');
        state.progress = { label: event.label, fraction: event.fraction ?? null }; publish({ type: 'progress', turnId: turn.id, ...state.progress });
      } else if (event.type === 'complete') {
        revokeTurn(text(event.reason, 120) ? event.reason : 'completed'); status('ready', 'Agent ready');
      } else if (event.type === 'error') await failConnection(record, { code: event.code ?? 'AGENT_FAILURE', message: event.message ?? 'The agent reported an error.' });
      else fail('AGENT_EVENT', 'Unsupported provider event.');
      return true;
    } catch (error) { await failConnection(record, error); return false; }
  }
  async function tool(record, input) {
    let turn = active;
    try {
      if (!live(record, turn) || !turn) return toolFailure('TURN_REVOKED', 'This agent turn cannot invoke tools.', record.identity);
      const call = boundedData(input, limits.maxToolBytes); fields(call, ['turnId', 'callId', 'name', 'arguments']);
      insist(call.turnId === turn.id && text(call.callId, 240) && call.name === 'cosmic_command', 'TURN_REVOKED', 'Only the current scoped cosmic_command tool is available.');
      const signature = fingerprint({ name: call.name, arguments: call.arguments }), previous = turn.tools.get(call.callId);
      if (previous) { insist(previous.signature === signature, 'TOOL_ID_CONFLICT', 'A tool call ID cannot be reused with different arguments.'); return await previous.promise; }
      insist(turn.tools.size < limits.maxToolCalls, 'SESSION_BUDGET', 'This turn reached its tool-call budget.');
      const promise = (async () => {
        await synchronize();
        if (!live(record, turn)) return toolFailure('TURN_REVOKED', 'The project or agent turn changed.', record.identity);
        publish({ type: 'tool', turnId: turn.id, callId: call.callId, phase: 'started', command: call.arguments?.command ?? null });
        const outcome = await gateway.forTurn(turn.grant).dispatch(call.arguments);
        if (!live(record, turn)) return toolFailure('TURN_REVOKED', 'Late tool results are discarded after Stop or disconnect.', record.identity);
        if (outcome.ok && outcome.summary && !outcome.replayed) publish({ type: 'change', turnId: turn.id, callId: call.callId, command: outcome.command, identity: outcome.identity, summary: outcome.summary });
        publish({ type: 'tool', turnId: turn.id, callId: call.callId, phase: 'finished', command: outcome.command, ok: outcome.ok, ...(outcome.ok ? {} : { error: outcome.error }) });
        if (bytes(outcome) > limits.maxToolResultBytes) return toolFailure('TOOL_RESULT_BUDGET', 'Result exceeds the agent tool budget. Use discover detail:summary, then names:[...] for selected full schemas; inspect one component at a time.', outcome.identity ?? record.identity);
        return outcome;
      })();
      turn.tools.set(call.callId, { signature, promise }); return await promise;
    } catch (error) { return toolFailure(error?.code ?? 'AGENT_TOOL', String(error?.message ?? 'Agent tool failed.'), turn?.context.identity ?? record.identity); }
  }
  async function request(record, input) {
    if (!live(record, active) || !active) return false;
    try {
      await synchronize(); const turn = active; if (!turn || !live(record, turn)) return false;
      const item = boundedData(input, limits.maxEventBytes); fields(item, ['requestId', 'turnId', 'kind', 'message', 'options', 'questions']);
      if (item.turnId !== turn.id) return false;
      insist(item.turnId === turn.id && text(item.requestId, 240) && ['permission', 'input'].includes(item.kind) && text(item.message, 2000), 'AGENT_REQUEST', 'Use a current correlated permission/input request.');
      if (item.kind === 'permission') {
        insist(Array.isArray(item.options) && item.options.length > 0 && item.options.length <= 2 && new Set(item.options.map(option => option.id)).size === item.options.length && item.options.every(option => isRecord(option) && ['allow', 'deny'].includes(option.id) && text(option.label, 240)), 'AGENT_REQUEST', 'Permissions require explicit offered allow/deny choices.');
      } else {
        insist(Array.isArray(item.questions) && item.questions.length > 0 && item.questions.length <= 8 && new Set(item.questions.map(question => question.id)).size === item.questions.length, 'AGENT_REQUEST', 'Input requests require distinct bounded questions.');
        for (const question of item.questions) {
          insist(isRecord(question) && text(question.id) && text(question.question, 2000) && question.isSecret !== true, 'SECRET_INPUT_UNSUPPORTED', 'Credentials must remain in the agent runtime authentication mechanism.');
        }
      }
      const signature = fingerprint(item), previous = turn.requests.get(item.requestId);
      if (previous) { insist(previous.signature === signature, 'REQUEST_CONFLICT', 'A request ID changed its content.'); return false; }
      insist(turn.requests.size < limits.maxRequests, 'SESSION_BUDGET', 'Too many provider requests in one turn.');
      const publicItem = { ...item, requestId: `${turn.id}:${item.requestId}` };
      turn.requests.set(item.requestId, { signature, item: publicItem, providerRequestId: item.requestId, answered: false });
      if (item.kind === 'permission' && state.permissionPolicy === 'deny') {
        turn.requests.get(item.requestId).answered = true;
        await record.adapter.respond(item.requestId, { decision: 'deny' });
        if (live(record, turn)) publish({ type: 'permission', turnId: turn.id, requestId: publicItem.requestId, decision: 'deny', policy: 'deny' });
      } else { state.requests.push(publicItem); publish({ type: 'request', ...publicItem }); }
      return true;
    } catch (error) { await failConnection(record, error); return false; }
  }
  const api = {
    limits: freezeData(limits), snapshot, synchronize,
    events(afterCursor = 0) {
      insist(Number.isSafeInteger(afterCursor) && afterCursor >= 0 && afterCursor <= cursor, 'EVENT_CURSOR', 'Use a valid event cursor.');
      const first = log[0]?.data.cursor ?? cursor + 1;
      return freezeData(copyData({ events: log.filter(item => item.data.cursor > afterCursor).map(item => item.data), cursor, resetRequired: afterCursor < first - 1 }));
    },
    subscribe(listener) { insist(typeof listener === 'function', 'SESSION_ARGUMENT', 'Supply a listener.'); listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    async connect(input) {
      insist(!disposed, 'SESSION_DISPOSED', 'This session bridge is disposed.');
      const options = boundedData(input, 4096); fields(options, ['agentId', 'permissionPolicy']);
      const definition = installed.get(options.agentId), policy = options.permissionPolicy ?? 'deny';
      insist(definition && ['deny', 'ask'].includes(policy), 'AGENT_UNAVAILABLE', 'Select a configured agent and explicit deny/ask permission policy.');
      const mine = ++epoch, old = connection; pendingSubmit = null;
      retire(old, 'reconnected'); connection = null;
      clients.clear(); seenEvents.clear(); state.requests = []; state.progress = null;
      state.agentId = definition.id; state.sessionId = id('session'); state.providerSessionId = null; state.permissionPolicy = policy; state.capabilities = {};
      status('connecting', `Connecting ${definition.label}`);
      try {
        if (old) { try { await old.adapter.disconnect(); } catch { /* old grants already revoked */ } }
        const [inspection, discovery] = await Promise.all([inspectCurrent(), gateway.dispatch({ command: 'discover' })]);
        if (mine !== epoch || disposed) return snapshot();
        insist(discovery.ok, 'AGENT_DISCOVERY', 'Cannot discover the installed gateway.');
        const adapter = definition.create({ permissionPolicy: policy, dynamicTools: [{ name: 'cosmic_command',
          description: 'Inspect and author Cosmic Lego only through this validated gateway. First discover with args {detail:"summary"}, then discover names:[...] for exact schemas. Use complete current identity and a unique idempotency key for writes. Source code is never a gateway operation.',
          inputSchema: discovery.result.gateway.requestSchema }] });
        insist(adapter && ['connect', 'startTurn', 'cancel', 'respond', 'disconnect'].every(method => typeof adapter[method] === 'function'), 'AGENT_ADAPTER', 'Adapter lacks the session contract.');
        const record = { epoch: mine, adapter, grant: gateway.createSession(), identity: inspection.identity, discovery, active: true };
        connection = record;
        const connected = boundedData(await adapter.connect({ onEvent: event => receive(record, event), onTool: call => tool(record, call), onRequest: item => request(record, item) }), limits.maxEventBytes);
        if (!live(record)) return snapshot();
        insist(text(connected.providerSessionId, 240) && isRecord(connected.capabilities), 'AGENT_ADAPTER', 'Adapter must return its real provider session ID and capabilities.');
        state.providerSessionId = connected.providerSessionId; state.capabilities = connected.capabilities;
        await synchronize(); if (live(record)) status('ready', `${definition.label} ready`);
      } catch (error) {
        if (mine === epoch && !disposed) {
          if (connection && live(connection)) await failConnection(connection, error, error?.code === 'AUTH_REQUIRED');
          else if (!['auth-needed', 'failed'].includes(state.status)) status(error?.code === 'AUTH_REQUIRED' ? 'auth-needed' : 'failed', 'Agent connection failed', publicError(error));
        }
      }
      return snapshot();
    },
    submit(input) {
      const supplied = boundedData(input, limits.maxTextChars * 4 + 65536); fields(supplied, ['text', 'context', 'clientRequestId', 'sessionId']);
      if (supplied.sessionId !== undefined) checkSession(supplied.sessionId);
      insist(typeof supplied.text === 'string' && supplied.text.trim().length > 0 && supplied.text.length <= limits.maxTextChars, 'SESSION_ARGUMENT', 'Submit bounded nonempty text.');
      const clientRequestId = supplied.clientRequestId ?? id('request'); insist(text(clientRequestId, 240), 'SESSION_ARGUMENT', 'Use a bounded client request ID.');
      insist(bytes({ text: supplied.text }) + 1024 <= limits.maxEventBytes, 'SESSION_BUDGET', 'Submitted text exceeds the public-event byte limit.');
      const signature = fingerprint({ text: supplied.text, context: supplied.context ?? {} }), previous = clients.get(clientRequestId);
      if (previous) {
        insist(!previous.stopped, 'TURN_REVOKED', 'This client request was stopped in its originating session.');
        insist(previous.signature === signature, 'REQUEST_CONFLICT', 'A client request ID cannot change text or context.');
        return previous.promise;
      }
      insist(clients.size < limits.maxClientRequests, 'SESSION_BUDGET', 'Reconnect after the bounded submit-deduplication budget is reached.');
      insist(!disposed && state.status === 'ready' && connection?.active && !active && !pendingSubmit, 'SESSION_NOT_READY', 'Connect an authenticated ready agent before sending.');
      const record = connection, entry = { clientRequestId, signature, stopped: false };
      pendingSubmit = entry;
      entry.promise = Promise.resolve().then(async () => {
        try {
          insist(pendingSubmit === entry && live(record), 'TURN_REVOKED', 'The request was stopped or its session changed before submission.');
          await synchronize(); const host = await getProjectContext();
          const inspection = await inspectCurrent();
          insist(live(record) && pendingSubmit === entry && state.status === 'ready', 'TURN_REVOKED', 'The request was stopped or its session changed before submission.');
          const context = buildAgentContext({ inspection, discovery: record.discovery, input: supplied.context ?? {}, host });
          const turn = { id: id('turn'), grant: gateway.issueTurn(record.grant), context, clientRequestId, active: true, tools: new Map(), requests: new Map() };
          active = turn; state.activeTurn = { id: turn.id, clientRequestId, context }; state.error = null;
          state.progress = { label: 'Waiting for agent', fraction: null };
          appendMessage({ id: `${turn.id}:user`, turnId: turn.id, role: 'user', text: supplied.text });
          status('working', 'Agent working'); publish({ type: 'message', id: `${turn.id}:user`, turnId: turn.id, role: 'user', text: supplied.text, clientRequestId });
          insist(live(record, turn), 'TURN_REVOKED', 'The turn ended before the adapter started.');
          try { await record.adapter.startTurn({ turnId: turn.id, text: supplied.text, context }); }
          catch (error) {
            insist(!entry.stopped, 'TURN_REVOKED', 'The turn was stopped while the adapter was starting.');
            if (live(record, turn)) await failConnection(record, error);
            throw error;
          }
          insist(live(record) && !entry.stopped, 'TURN_REVOKED', 'The turn was stopped before the adapter acknowledged it.');
          return freezeData({ accepted: true, turnId: turn.id, clientRequestId });
        } finally { if (pendingSubmit === entry) pendingSubmit = null; }
      });
      clients.set(clientRequestId, entry); return entry.promise;
    },
    async stop(input) {
      if (input !== undefined) {
        const scope = boundedData(input, 4096); fields(scope, ['sessionId', 'clientRequestId', 'turnId']);
        checkSession(scope.sessionId);
        const { clientRequestId, turnId } = scope;
        insist(clientRequestId !== undefined || turnId !== undefined, 'SESSION_ARGUMENT', 'Identify the originating client request or turn.');
        if (clientRequestId !== undefined) insist(text(clientRequestId, 240), 'SESSION_ARGUMENT', 'Use a bounded client request ID.');
        if (turnId !== undefined) {
          insist(text(turnId, 240), 'SESSION_ARGUMENT', 'Use a bounded turn ID.');
          if (active?.id !== turnId) return snapshot();
        }
        if (clientRequestId !== undefined) {
          if (turnId !== undefined && active.clientRequestId !== clientRequestId) return snapshot();
          if (!clients.has(clientRequestId)) {
            // Stop may reach the host before its Submit. Keep this cancellation
            // beside the deduplication entries, subject to their shared budget.
            insist(clients.size < limits.maxClientRequests, 'SESSION_BUDGET', 'Reconnect after the bounded submit-deduplication budget is reached.');
            clients.set(clientRequestId, { stopped: true });
            return snapshot();
          }
          if (active?.clientRequestId !== clientRequestId && pendingSubmit?.clientRequestId !== clientRequestId) return snapshot();
        }
      }
      if (pendingSubmit) pendingSubmit.stopped = true;
      pendingSubmit = null;
      if (active) clients.get(active.clientRequestId).stopped = true;
      const record = connection, turn = revokeTurn('cancelled');
      if (!turn || !record) return snapshot();
      status('cancelling', 'Cancelling agent turn');
      try { await record.adapter.cancel(turn.id); if (live(record) && !active) status('ready', 'Agent ready'); }
      catch (error) { await failConnection(record, error); }
      return snapshot();
    },
    async reply(input) {
      const supplied = boundedData(input, limits.maxEventBytes); fields(supplied, ['requestId', 'answer']);
      await synchronize(); const record = connection, turn = active;
      insist(turn && live(record, turn), 'TURN_REVOKED', 'This request no longer has an active agent turn.');
      const pending = [...turn.requests.values()].find(item => item.item.requestId === supplied.requestId);
      insist(pending && !pending.answered, 'REQUEST_EXPIRED', 'Reply to a current unanswered request.');
      const answer = supplied.answer;
      if (pending.item.kind === 'permission') { fields(answer, ['decision']); insist(state.permissionPolicy === 'ask' && pending.item.options.some(option => option.id === answer.decision), 'PERMISSION_POLICY', 'Choose an explicitly offered permission decision.'); }
      else {
        fields(answer, ['answers']); insist(isRecord(answer.answers), 'AGENT_REQUEST', 'Input replies require a question/answers map.');
        const questions = pending.item.questions ?? [];
        for (const [key, values] of Object.entries(answer.answers)) insist(questions.some(item => item.id === key) && Array.isArray(values) && values.length <= 16 && values.every(value => typeof value === 'string' && value.length <= 2000), 'AGENT_REQUEST', 'Reply only to declared questions with bounded text answers.');
      }
      pending.answered = true; state.requests = state.requests.filter(item => item.requestId !== supplied.requestId);
      try { await record.adapter.respond(pending.providerRequestId, answer); }
      catch (error) { await failConnection(record, error); throw error; }
      if (live(record, turn)) publish({ type: 'reply', turnId: turn.id, requestId: supplied.requestId });
      return snapshot();
    },
    async disconnect() {
      ++epoch; pendingSubmit = null;
      const record = connection; retire(record); connection = null;
      state.providerSessionId = null; state.capabilities = {};
      status('disconnected', 'No agent connected');
      if (record) { try { await record.adapter.disconnect(); } catch { /* disconnected authority is final */ } }
      return snapshot();
    },
    // Only the trusted project host can load historical public messages. Retire
    // native authority synchronously, even when native disconnection takes time.
    replaceProjectTranscript(input) {
      const messages = boundedData(input, limits.maxTranscriptBytes);
      insist(Array.isArray(messages) && messages.length <= limits.maxMessages, 'SESSION_BUDGET', 'Archived conversation exceeds the transcript limits.');
      for (const message of messages) {
        fields(message, ['id', 'turnId', 'role', 'text']);
        insist(text(message.id, 240) && text(message.turnId, 240) && ['user', 'assistant', 'system', 'tool'].includes(message.role) &&
          typeof message.text === 'string' && message.text.length <= limits.maxTextChars, 'SESSION_ARGUMENT', 'Invalid public transcript record.');
      }
      const record = connection;
      ++epoch; pendingSubmit = null; retire(record, 'project-changed'); connection = null;
      clients.clear(); seenEvents.clear(); log.length = 0; eventBytes = 0;
      Object.assign(state, { agentId: null, sessionId: null, providerSessionId: null, activeTurn: null, capabilities: {},
        messages, progress: null, requests: [], permissionPolicy: 'deny' });
      status('disconnected', 'No agent connected');
      return record ? Promise.resolve().then(() => record.adapter.disconnect()).catch(() => {}) : Promise.resolve();
    },
    async dispose() { if (!disposed) { disposed = true; await api.disconnect(); listeners.clear(); } },
  };
  return Object.freeze(api);
}
