// Provider-independent conversation UI state. This does not connect a provider
// or grant write authority; a trusted F08 host consumes events and supplies data.
const clone = value => structuredClone(value);
const validText = (value, maximum = 12000) => typeof value === 'string' && value.length <= maximum;
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const connectionStates = ['disconnected', 'connecting', 'connected', 'error'];

export function createConversation({ onEvent = () => {} } = {}) {
  insist(typeof onEvent === 'function', 'Conversation event delivery must be a function.');
  let state = { connection: 'disconnected', label: 'No agent connected', messages: [], progress: null,
    error: null, activeTurn: null, context: null, drafts: {} };
  let serial = 0;
  const listeners = new Set(), turns = new Set();
  const notify = () => { for (const listener of listeners) listener(clone(state)); };
  const emit = event => {
    try { onEvent(clone(event)); return true; }
    catch (error) {
      // Revoke local acceptance even if an injected transport throws. The UI
      // must not remain stuck waiting for a turn it could not hand off.
      state.connection = 'error'; state.label = 'Agent connection error';
      state.error = `Event delivery failed: ${String(error?.message ?? error).slice(0, 1900)}`;
      state.activeTurn = null; state.progress = null;
      return false;
    }
  };
  const cancel = () => {
    if (!state.activeTurn) return false;
    const turnId = state.activeTurn; state.activeTurn = null; state.progress = null;
    emit({ type: 'cancel', turnId, context: state.context }); notify(); return true;
  };
  const current = event => state.connection === 'connected' && event.turnId === state.activeTurn && turns.has(event.turnId);
  return Object.freeze({
    snapshot: () => clone(state),
    subscribe(listener) {
      insist(typeof listener === 'function', 'Conversation subscriptions need a listener function.');
      listener(clone(state)); listeners.add(listener); return () => listeners.delete(listener);
    },
    context(context) {
      const next = clone(context), old = state.context?.identity, token = next?.identity;
      if (old && (!token || old.projectId !== token.projectId || old.generation !== token.generation)) {
        cancel(); state.messages = []; state.drafts = {}; state.error = null; turns.clear();
      }
      state.context = next; notify();
    },
    draft(id, text) {
      insist(validText(id, 160) && id && validText(text), 'Composer ID or draft exceeds the conversation limit.');
      insist(Object.hasOwn(state.drafts, id) || Object.keys(state.drafts).length < 24, 'Too many composer drafts.');
      state.drafts = { ...state.drafts, [id]: text }; notify();
    },
    forgetDraft(id) {
      insist(validText(id, 160) && id, 'A composer ID is required.');
      if (!Object.hasOwn(state.drafts, id)) return false;
      const drafts = { ...state.drafts }; delete drafts[id]; state.drafts = drafts;
      // Removing a view releases its local draft, not the shared conversation
      // or an active transport turn. Hiding a view must not call this method.
      notify(); return true;
    },
    synchronize(remote) {
      insist(remote && Array.isArray(remote.messages) && remote.messages.length <= 200, 'A bounded agent transcript is required.');
      const messages = remote.messages.map(message => {
        insist(validText(message.id, 240) && validText(message.text) && ['user', 'assistant', 'system', 'tool'].includes(message.role), 'Invalid agent transcript message.');
        return { id: message.id, turnId: message.turnId ?? null, role: message.role, text: message.text,
          ...(message.sessionId ? { sessionId: message.sessionId } : {}) };
      });
      const activeTurn = remote.activeTurn?.id ?? null;
      if (activeTurn) turns.add(activeTurn);
      while (turns.size > 200) turns.delete(turns.values().next().value);
      state = { ...state, connection: ['ready', 'working'].includes(remote.status) ? 'connected' : remote.status === 'connecting' || remote.status === 'cancelling' ? 'connecting' : remote.status === 'failed' || remote.status === 'offline' ? 'error' : 'disconnected',
        label: remote.label || 'No agent connected', messages, activeTurn,
        progress: clone(remote.progress ?? null), error: remote.error?.message ?? null };
      notify();
    },
    rejectSubmission(turnId, composerId, text, message) {
      if (state.activeTurn && state.activeTurn !== turnId) return false;
      state.activeTurn = null; state.progress = null; state.error = message;
      state.messages = state.messages.filter(item => item.id !== `${turnId}:user`);
      if (!state.drafts[composerId]) state.drafts = { ...state.drafts, [composerId]: text };
      notify(); return true;
    },
    submit(id) {
      const original = Object.hasOwn(state.drafts, id) ? state.drafts[id] : '', text = original.trim();
      if (!text || state.connection !== 'connected' || state.activeTurn) return false;
      const turnId = `turn-${++serial}`; turns.add(turnId);
      if (turns.size > 200) turns.delete(turns.values().next().value);
      state.activeTurn = turnId; state.error = null; state.progress = { label: 'Waiting for agent', fraction: null };
      state.messages = [...state.messages.slice(-199), { id: `${turnId}:user`, turnId, role: 'user', text }];
      state.drafts = { ...state.drafts, [id]: '' };
      const delivered = emit({ type: 'submit', turnId, composerId: id, text, context: state.context });
      if (!delivered) {
        state.drafts = { ...state.drafts, [id]: original };
        state.messages = state.messages.filter(message => message.id !== `${turnId}:user`);
      }
      notify(); return delivered ? turnId : false;
    },
    cancel,
    receive(event) {
      insist(event && typeof event === 'object' && typeof event.type === 'string', 'A conversation event is required.');
      if (event.type === 'connection') {
        insist(connectionStates.includes(event.status) && validText(event.label ?? '', 240), 'Invalid connection status.');
        if (event.status !== 'connected') cancel();
        state.connection = event.status; state.label = event.label || (event.status === 'disconnected' ? 'No agent connected' : event.status);
        state.error = event.status === 'error' ? state.label : null; notify(); return true;
      }
      if (!current(event)) return false; // Late chunks after Stop or load stay revoked.
      if (event.type === 'message' || event.type === 'delta') {
        insist(validText(event.id, 160) && event.id && validText(event.text), 'Invalid message ID or text.');
        const old = state.messages.find(message => message.id === event.id);
        insist(!old || old.turnId === event.turnId && old.role !== 'user', 'Message IDs cannot overwrite another turn or a user message.');
        const role = event.role ?? old?.role ?? 'assistant';
        insist(['assistant', 'system', 'tool'].includes(role), 'Unsupported incoming message role.');
        const text = event.type === 'delta' ? (old?.text ?? '') + event.text : event.text;
        insist(validText(text), 'Message exceeds the conversation text limit.');
        const message = { id: event.id, turnId: event.turnId, role, text };
        state.messages = old ? state.messages.map(item => item.id === event.id ? message : item) : [...state.messages.slice(-199), message];
      } else if (event.type === 'progress') {
        insist(validText(event.label, 240) && (event.fraction == null || Number.isFinite(event.fraction) && event.fraction >= 0 && event.fraction <= 1), 'Invalid progress.');
        state.progress = { label: event.label, fraction: event.fraction ?? null };
      } else if (event.type === 'error') {
        insist(validText(event.message, 2000), 'Invalid error message.');
        state.error = event.message; state.activeTurn = null; state.progress = null;
      } else if (event.type === 'complete') { state.activeTurn = null; state.progress = null; }
      else throw new Error(`Unsupported conversation event ${event.type}.`);
      notify(); return true;
    },
  });
}

// Browser transport for the host-owned F08 bridge. Canonical snapshots keep
// provider IDs and streamed text deduplicated; local composer drafts stay here.
// Connecting never supplies an executable path or authentication material.
export function createAgentClient({ conversation, fetch: fetcher = globalThis.fetch, interval = 250,
  schedule = setTimeout, unschedule = clearTimeout, requestId = () => globalThis.crypto.randomUUID() } = {}) {
  insist(conversation?.synchronize && typeof fetcher === 'function', 'Conversation and fetch transport are required.');
  let view = { status: 'disconnected', label: 'No agent connected', agents: [], capabilities: {}, permissionPolicy: 'deny',
    agentId: null, activeTurn: null, messages: [], progress: null, requests: [], error: null, cursor: 0 };
  let managed = false, disposed = false, started = false, busy = false, polling = false, timer, epoch = 0, cursor = 0;
  let pendingSubmission = null;
  const tools = new Map();
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(clone({ ...view, managed, busy })); };
  async function request(route, input) {
    const response = await fetcher(`/api/agent/${route}`, input === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    const envelope = await response.json();
    if (!response.ok || !envelope.ok) throw Object.assign(new Error(envelope.error?.message ?? 'Agent connection unavailable.'), envelope.error, { rejected: true });
    return envelope.result;
  }
  function accept(snapshot) {
    insist(snapshot && typeof snapshot.status === 'string' && Array.isArray(snapshot.agents) && Array.isArray(snapshot.messages), 'Invalid agent session snapshot.');
    if (snapshot.sessionId !== view.sessionId) tools.clear();
    view = { ...clone(snapshot), tools: [...tools.values()] };
    if (snapshot.agentId && snapshot.status !== 'disconnected') managed = true;
    const savedTranscript = snapshot.status === 'disconnected' && snapshot.messages.length > 0 && conversation.snapshot().connection === 'disconnected';
    if (managed || savedTranscript) conversation.synchronize(view);
    notify();
  }
  async function readState(ticket = epoch) {
    const snapshot = await request('state');
    if (!disposed && ticket === epoch) accept(snapshot);
    return snapshot;
  }
  function failed(error) {
    if (disposed) return;
    view = { ...view, status: 'offline', label: 'Agent companion unavailable', error: { code: error.code ?? 'CONNECTION', message: error.message } };
    if (managed) conversation.synchronize(view);
    notify();
  }
  async function poll() {
    if (disposed || busy || polling) return;
    polling = true; const ticket = epoch;
    try {
      const update = await request(`events?after=${cursor}`);
      if (disposed || ticket !== epoch) return;
      if (update.resetRequired) tools.clear();
      for (const event of update.events ?? []) {
        if (event.sessionId !== view.sessionId || !['tool', 'change'].includes(event.type)) continue;
        const key = `${event.turnId}:${event.callId}`, old = tools.get(key) ?? {};
        tools.set(key, { ...old, id: key, command: event.command, ...(event.type === 'tool' ? { phase: event.phase, ok: event.ok,
          error: event.error ? { code: event.error.code, message: event.error.message?.slice(0, 1000) } : null } : { summary: clone(event.summary) }) });
        while (tools.size > 50) tools.delete(tools.keys().next().value);
      }
      const changed = update.resetRequired || update.cursor !== cursor || view.status === 'offline'; cursor = update.cursor;
      if (changed) await readState(ticket);
    } catch (error) {
      if (ticket === epoch && error.code === 'EVENT_CURSOR') {
        // A restarted companion has a new bounded event log. Reload its actual
        // state; this does not reconnect or resume a provider session.
        cursor = 0; tools.clear();
        try { await readState(ticket); } catch (failure) { failed(failure); }
      } else if (ticket === epoch) failed(error);
    }
    finally { polling = false; }
  }
  function next() {
    if (!disposed && started) timer = schedule(async () => { await poll(); next(); }, interval);
  }
  async function action(route, input, status) {
    if (disposed || busy && !['stop', 'disconnect'].includes(route)) throw new Error('Agent connection is busy.');
    const ticket = ++epoch; busy = true;
    if (status) view = { ...view, status, label: status === 'connecting' ? 'Connecting…' : 'Cancelling…', error: null };
    notify();
    try {
      const result = await request(route, input);
      try { await readState(ticket); } catch (error) { if (ticket === epoch) failed(error); }
      return result;
    } catch (error) {
      // Authentication failures have a useful runtime-owned state and login
      // instructions. Prefer that state over inventing a connected session.
      if (disposed || ticket !== epoch) throw error;
      try { await readState(ticket); } catch { if (ticket === epoch) failed(error); }
      if (!disposed && ticket === epoch && !view.error) { view = { ...view, error: { code: error.code ?? 'AGENT', message: error.message } }; notify(); }
      throw error;
    } finally { if (ticket === epoch) busy = false; if (!disposed) notify(); }
  }
  return Object.freeze({
    snapshot: () => clone({ ...view, managed, busy }),
    subscribe(listener) { insist(typeof listener === 'function', 'An agent listener is required.'); listener(clone({ ...view, managed, busy })); listeners.add(listener); return () => listeners.delete(listener); },
    async start() { if (started || disposed) return; started = true; try { await readState(); } catch (error) { failed(error); } next(); },
    poll,
    async connect(agentId, permissionPolicy = 'deny') {
      insist(view.agents.some(agent => agent.id === agentId), 'Choose a host-configured agent.');
      insist(['deny', 'ask'].includes(permissionPolicy), 'Choose a supported native permission policy.');
      managed = true; return action('connect', { agentId, permissionPolicy }, 'connecting');
    },
    async disconnect() { pendingSubmission = null; const result = await action('disconnect', {}, 'cancelling'); managed = false; notify(); return result; },
    reply(requestId, answer) { return action('reply', { requestId, answer }); },
    handle(event) {
      // The F06 public event injection remains a test seam. It cannot silently
      // launch a configured runtime or mint gateway authority.
      if (!managed || disposed) return;
      if (event.type === 'submit') {
        insist(view.sessionId && view.status === 'ready' && !busy, 'A ready agent session is required.');
        const submission = { sessionId: view.sessionId, clientRequestId: requestId(), localTurnId: event.turnId };
        pendingSubmission = submission;
        action('submit', { sessionId: submission.sessionId, clientRequestId: submission.clientRequestId, text: event.text, context: event.context }).catch(error => {
          if (pendingSubmission !== submission || disposed || view.sessionId !== submission.sessionId) return;
          if (error.rejected) conversation.rejectSubmission(event.turnId, event.composerId, event.text, error.message);
          else failed(error);
        }).finally(() => { if (pendingSubmission === submission) pendingSubmission = null; });
      } else if (event.type === 'cancel') {
        let target;
        if (pendingSubmission?.localTurnId === event.turnId) {
          target = { sessionId: pendingSubmission.sessionId, clientRequestId: pendingSubmission.clientRequestId };
          pendingSubmission = null;
        } else if (view.sessionId && view.activeTurn?.id === event.turnId) {
          target = { sessionId: view.sessionId, turnId: event.turnId };
        }
        if (target) action('stop', target, 'cancelling').catch(error => { if (!view.error && view.sessionId === target.sessionId) failed(error); });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; started = false; ++epoch; pendingSubmission = null;
      unschedule(timer); listeners.clear();
      // A managed turn belongs to the companion and may be open in other tabs.
      if (!managed) conversation.cancel();
    },
  });
}
