// One data-only boundary for local clients and host-scoped agent tools.
import { KernelError, Project, validateProject } from '../core/index.js';
import { copyData, freezeData, isRecord, isId } from '../core/data.js';
import { unit } from '../dataflow/index.js';
import { createCommandCatalog } from './commands.js';

export { createCommandCatalog, COMMAND_LIMITS } from './commands.js';
export const GATEWAY_LIMITS = Object.freeze({
  maxRequestBytes: 65536, maxOperations: 64, maxResponseBytes: 8388608,
  maxCacheEntries: 256, maxCacheBytes: 8388608, cacheTtlMs: 600000,
  maxSessions: 32, maxTurns: 128, maxSources: 128,
});
const permissions = ['read', 'write', 'evaluate', 'render'];
const reads = new Set(['discover', 'inspect']);
const builtins = new Set([...reads, 'evaluate', 'render', 'transaction.preview', 'transaction.commit', 'history.undo', 'history.redo']);
const bytes = data => new TextEncoder().encode(JSON.stringify(data)).length;
const sameIdentity = (a, b) => !!a && !!b && a.projectId === b.projectId && a.generation === b.generation && a.revision === b.revision;
const fail = (code, message, details = {}) => { throw new KernelError(code, message, details); };
const insist = (condition, code, message, details) => { if (!condition) fail(code, message, details); };
function fields(value, allowed, path = '$') {
  insist(isRecord(value), 'COMMAND_ARGUMENT', `${path} must be a data object.`, { path });
  for (const key of Object.keys(value)) insist(allowed.includes(key), 'COMMAND_ARGUMENT', `${path}.${key} is unsupported.`, { path: `${path}.${key}` });
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
// Bound traversal before cloning and never execute an accessor/toJSON method.
function requestData(input, limit) {
  const active = new Set(); let work = 0, characters = 0;
  function visit(item, depth) {
    insist(++work <= limit && depth <= 64, 'REQUEST_BUDGET', 'Request nesting or entry count exceeds the gateway limit.');
    if (typeof item === 'string') characters += item.length;
    insist(characters <= limit, 'REQUEST_BUDGET', 'Request exceeds the gateway byte limit.');
    if (!item || typeof item !== 'object') return;
    insist(!active.has(item), 'INVALID_DATA', 'Request data cannot contain JavaScript cycles.');
    active.add(item);
    if (Array.isArray(item)) insist(item.length <= limit, 'REQUEST_BUDGET', 'Request array exceeds the entry limit.');
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const property = Object.getOwnPropertyDescriptor(item, key);
      insist(typeof key === 'string' && property.enumerable && Object.hasOwn(property, 'value'), 'INVALID_DATA', 'Requests require enumerable data properties without accessors.');
      characters += key.length; visit(property.value, depth + 1);
    }
    active.delete(item);
  }
  visit(input, 0);
  const result = copyData(input);
  insist(bytes(result) <= limit, 'REQUEST_BUDGET', `Request exceeds ${limit} bytes.`);
  return freezeData(result);
}
function category(code) {
  if (['AUTHORITY_REQUIRED', 'INVALID_AUTHORITY', 'PERMISSION_DENIED', 'SESSION_CLOSED'].includes(code)) return 'unauthorized';
  if (['CANCELLED', 'TURN_REVOKED', 'SUPERSEDED'].includes(code)) return 'cancelled';
  if (/STALE|TOKEN|IDEMPOTENCY|EMPTY_HISTORY/.test(code)) return 'stale-state';
  if (/BUDGET|LIMIT|EXHAUSTED/.test(code)) return 'resource-exhausted';
  if (/CAPABILITY|UNAVAILABLE|EXTENSION_MISSING|COMMAND_UNKNOWN|RUNTIME_REQUIRED/.test(code)) return 'unavailable-capability';
  if (/APPLICABILITY|OUTSIDE_DOMAIN/.test(code)) return 'applicability';
  if (/MISMATCH|ALIGNMENT|MISSING_INPUT|INPUT_DECLARATION|PORT|CONVERSION_REQUIRED|MISSING_CONTEXT/.test(code)) return 'incompatible-connection';
  if (/ARGUMENT|INVALID_DATA|REQUEST|UNSUPPORTED_FIELD|SCHEMA|INVALID_OPERATION/.test(code)) return 'malformed-input';
  return code === 'INTERNAL_ERROR' ? 'internal' : 'validation';
}
function diagnosticsOf(error) {
  const list = error?.diagnostics ?? error?.validation?.errors;
  if (Array.isArray(list) && list.length) return copyData(list);
  return [{ code: error?.code ?? 'INTERNAL_ERROR', path: error?.path ?? '$', message: error?.message ?? 'Gateway operation failed.' }];
}
const jsonObject = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const tokenSchema = jsonObject({ projectId: { type: 'string' }, generation: { type: 'string' }, revision: { type: 'integer', minimum: 0 } }, ['projectId', 'generation', 'revision']);
const arbitraryObject = { type: 'object', additionalProperties: true };
const timeSchema = jsonObject({ value: { type: 'number' }, unit: { anyOf: [{ type: 'string' }, arbitraryObject] } }, ['value', 'unit']);
const stringsSchema = { type: 'array', items: { type: 'string' } };
const capabilitiesSchema = { anyOf: [stringsSchema, { type: 'object', properties: {
  nodes: stringsSchema, projections: stringsSchema, geometry: stringsSchema, textures: { anyOf: [{ type: 'boolean' }, { type: 'string' }] },
}, additionalProperties: true }] };
const graphSchema = { type: 'object', properties: { schemaVersion: { const: 1 }, id: { type: 'string' }, title: { type: 'string' }, nodes: { type: 'array', items: arbitraryObject } }, required: ['schemaVersion', 'id', 'title', 'nodes'], additionalProperties: false, 'x-semanticValidator': 'F01.Project' };
const historySchema = jsonObject({ canUndo: { type: 'boolean' }, canRedo: { type: 'boolean' } }, ['canUndo', 'canRedo']);
const diagnosticsSchema = { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, path: { type: 'string' }, message: { type: 'string' } }, required: ['code', 'message'], additionalProperties: true } };
const runtimeResultSchema = { type: 'object', properties: { valid: { const: true }, identity: tokenSchema, value: { ...arbitraryObject, 'x-semanticValidator': 'F02.value' }, producer: arbitraryObject, request: arbitraryObject, diagnostics: diagnosticsSchema, metadata: arbitraryObject, checkpoints: { type: 'array', items: arbitraryObject } }, required: ['valid', 'identity', 'value', 'producer', 'request', 'diagnostics', 'metadata', 'checkpoints'], additionalProperties: false, 'x-semanticValidator': 'F04.result' };
const operationsSchema = { type: 'array', items: jsonObject({ command: { type: 'string' }, result: arbitraryObject }, ['command', 'result']) };
const mutationResultSchema = jsonObject({ operations: operationsSchema, history: historySchema }, ['operations', 'history']);
const responseSchema = { anyOf: [
  jsonObject({ ok: { const: true }, command: { type: 'string' }, identity: tokenSchema, result: arbitraryObject, summary: arbitraryObject, replayed: { type: 'boolean' } }, ['ok', 'command', 'identity', 'result']),
  jsonObject({ ok: { const: false }, command: { anyOf: [{ type: 'string' }, { type: 'null' }] }, error: jsonObject({
    code: { type: 'string' }, category: { type: 'string' }, message: { type: 'string' }, diagnostics: diagnosticsSchema, affectedIds: stringsSchema,
    paths: stringsSchema, repairs: { type: 'array', items: arbitraryObject }, operationIndex: { type: 'integer', minimum: 0 },
  }, ['code', 'category', 'message', 'diagnostics', 'affectedIds', 'paths', 'repairs']), context: jsonObject({ identity: tokenSchema }, ['identity']) }, ['ok', 'command', 'error', 'context']),
] };
function builtinDeclarations(limits, host) {
  const operation = jsonObject({ command: { type: 'string' }, args: arbitraryObject }, ['command']);
  const schemas = {
    discover: jsonObject({ detail: { type: 'string', enum: ['summary', 'full'], default: 'full' }, names: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string' }, uniqueItems: true } }), inspect: jsonObject({ id: { type: 'string' } }),
    evaluate: jsonObject({ id: { type: 'string' }, port: { type: 'string', default: 'value' }, time: timeSchema,
      mode: { enum: ['auto', 'analytic', 'stateful'], default: 'auto' }, settings: arbitraryObject, checkpoints: { type: 'array', items: arbitraryObject } }, ['id']),
    render: jsonObject({ time: timeSchema, mode: { enum: ['auto', 'analytic', 'stateful'], default: 'auto' }, settings: arbitraryObject, capabilities: capabilitiesSchema }),
    'transaction.preview': jsonObject({ operations: { type: 'array', minItems: 1, maxItems: limits.maxOperations, items: operation } }, ['operations']),
    'transaction.commit': jsonObject({ operations: { type: 'array', minItems: 1, maxItems: limits.maxOperations, items: operation } }, ['operations']),
    'history.undo': jsonObject(), 'history.redo': jsonObject(),
  };
  const outputs = {
    discover: { type: 'object', properties: { apiVersion: { const: 1 }, commands: { type: 'array', items: arbitraryObject }, extensions: { type: 'array', items: arbitraryObject }, gateway: arbitraryObject }, required: ['apiVersion', 'commands', 'extensions', 'gateway'], additionalProperties: true },
    inspect: { anyOf: [jsonObject({ graph: graphSchema, history: historySchema, outputs: arbitraryObject, requirements: arbitraryObject, sources: { type: 'array', items: jsonObject({ nodeId: { type: 'string' }, port: { type: 'string' } }, ['nodeId', 'port']) } }, ['graph', 'history', 'outputs', 'requirements', 'sources']), jsonObject({ node: arbitraryObject, dependencies: stringsSchema }, ['node', 'dependencies'])] },
    evaluate: runtimeResultSchema,
    render: jsonObject({ time: timeSchema, results: { type: 'array', items: runtimeResultSchema }, snapshot: { ...arbitraryObject, 'x-semanticValidator': 'F05/F06.snapshot' } }, ['time', 'results', 'snapshot']),
    'transaction.preview': jsonObject({ graph: graphSchema, validation: jsonObject({ valid: { const: true }, errors: diagnosticsSchema }, ['valid', 'errors']), baseToken: tokenSchema, operations: operationsSchema }, ['graph', 'validation', 'baseToken', 'operations']),
    'transaction.commit': mutationResultSchema, 'history.undo': mutationResultSchema, 'history.redo': mutationResultSchema,
  };
  return Object.entries(schemas).map(([name, inputSchema]) => {
    const hostRequirements = name === 'evaluate' ? ['runtime'] : name === 'render' ? ['runtime', 'layer'] : [];
    const missingHostRequirements = hostRequirements.filter(requirement => !host[requirement]);
    return { name, inputSchema, outputSchema: outputs[name], hostRequirements, missingHostRequirements, available: missingHostRequirements.length === 0,
    defaults: ['evaluate', 'render'].includes(name) ? { time: { value: 0, unit: 's' }, mode: 'auto', settings: {} } : {}, examples: [],
    capabilities: [], authority: reads.has(name) ? 'read' : name === 'evaluate' || name === 'render' ? name : 'write',
    expectedRequired: !reads.has(name), idempotencyRequired: name === 'transaction.commit' || name.startsWith('history.'),
    diagnostics: ['COMMAND_ARGUMENT', 'STALE_TOKEN', 'PERMISSION_DENIED', 'REQUEST_BUDGET'], limits,
  }; });
}

export function createCommandGateway({ project: initialProject, registry, binding, layer, runtime, commands, limits: inputLimits = {}, now = Date.now, getPlaybackDefaults = () => ({}) } = {}) {
  insist(initialProject instanceof Project && registry && binding, 'GATEWAY_HOST', 'Supply an accepted Project, installed registry and its binding.');
  insist(typeof now === 'function', 'GATEWAY_HOST', 'The host clock must be a function.');
  insist(typeof getPlaybackDefaults === 'function', 'GATEWAY_HOST', 'Playback defaults must come from the trusted host.');
  const limits = { ...GATEWAY_LIMITS, ...copyData(inputLimits) };
  fields(limits, Object.keys(GATEWAY_LIMITS), 'limits');
  insist(Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0), 'GATEWAY_LIMITS', 'Gateway limits must be positive safe integers.');
  const catalog = commands ?? createCommandCatalog({ registry, binding, layer });
  insist(['discover', 'has', 'apply'].every(method => typeof catalog?.[method] === 'function'), 'GATEWAY_HOST', 'Supply a trusted command catalogue.');
  let project = initialProject, observed = project.token, local, contextSequence = 0, computationSequence = 0, cacheBytes = 0;
  const authorities = new WeakMap(), sessions = new WeakMap(), activeSessions = new Set(), activeTurns = new Set(), jobs = new Set(), cache = new Map();
  function cancelJobs(predicate = () => true) {
    for (const entry of jobs) if (predicate(entry)) { try { entry.job.cancel(); } catch { /* revocation remains authoritative */ } jobs.delete(entry); }
  }
  function supersede() { computationSequence++; cancelJobs(); }
  function authority(allowed, session = null) {
    const handle = Object.freeze({});
    authorities.set(handle, { id: ++contextSequence, allowed: new Set(allowed), session, active: true, project, generation: observed.generation, reason: null });
    return handle;
  }
  function revoke(handle, reason = 'TURN_REVOKED') {
    const record = authorities.get(handle);
    if (!record) return false;
    record.active = false; record.reason = reason; activeTurns.delete(handle); record.session?.turns.delete(handle);
    cancelJobs(entry => entry.authority === record);
    return true;
  }
  function rotate() {
    supersede();
    if (local) revoke(local, 'STALE_AUTHORITY');
    for (const session of activeSessions) { const record = sessions.get(session); record.active = false; for (const turn of [...record.turns]) revoke(turn, 'STALE_AUTHORITY'); }
    activeSessions.clear(); activeTurns.clear(); cache.clear(); cacheBytes = 0;
    observed = project.token; local = authority(permissions);
    runtime?.setProject(project);
  }
  function synchronize() {
    const identity = project.token;
    if (observed.projectId !== identity.projectId || observed.generation !== identity.generation) rotate();
    else if (observed.revision !== identity.revision) { supersede(); observed = identity; runtime?.setProject(project); }
  }
  function authorize(handle, permission, optional = false) {
    synchronize();
    if (handle === undefined && optional) return null;
    insist(handle !== undefined, 'AUTHORITY_REQUIRED', 'The host must supply an issued authority for this operation.');
    const record = (typeof handle === 'object' && handle !== null) ? authorities.get(handle) : null;
    insist(record, 'INVALID_AUTHORITY', 'Caller labels or copied authority objects do not grant permission.');
    insist(record.active, record.reason ?? 'TURN_REVOKED', 'This host authority was revoked; its late work cannot continue.');
    insist(record.project === project && record.generation === project.token.generation, 'STALE_AUTHORITY', 'This authority belongs to another project load.');
    insist(record.allowed.has(permission), 'PERMISSION_DENIED', `This authority does not permit ${permission}.`);
    return record;
  }
  function expected(input) {
    insist(isRecord(input) && Object.keys(input).length === 3 && sameIdentity(input, project.token) && Number.isSafeInteger(input.revision),
      'STALE_TOKEN', 'Supply the complete current project identity, generation and revision.', { path: '$.expected' });
  }
  function purge() {
    const time = now();
    for (const [key, entry] of cache) if (time - entry.at >= limits.cacheTtlMs) { cache.delete(key); cacheBytes -= entry.bytes; }
  }
  function cacheReservation(size) {
    insist(size <= limits.maxCacheBytes && size <= limits.maxResponseBytes, 'RESULT_BUDGET', 'The mutation outcome exceeds the bounded retry cache; reduce the batch size.');
    purge();
    while (cache.size >= limits.maxCacheEntries || cacheBytes + size > limits.maxCacheBytes) {
      const oldest = cache.keys().next().value, previous = cache.get(oldest);
      cache.delete(oldest); cacheBytes -= previous.bytes;
    }
  }
  function summary(before, after, previous, identity, action) {
    const left = new Map(before.nodes.map(node => [node.id, canonical(node)])), right = new Map(after.nodes.map(node => [node.id, canonical(node)]));
    const changed = { created: [], updated: [], removed: [] }, counts = { created: 0, updated: 0, removed: 0 };
    function add(kind, id) { counts[kind]++; if (changed[kind].length < 64) changed[kind].push(id); }
    for (const [id, content] of right) { if (!left.has(id)) add('created', id); else if (content !== left.get(id)) add('updated', id); }
    for (const id of left.keys()) if (!right.has(id)) add('removed', id);
    return { action, ...changed, counts, truncated: Object.values(counts).some(count => count > 64), before: previous, after: identity };
  }
  function accepted() {
    observed = project.token; supersede();
    // Runtime notification cannot turn an accepted edit into a reported failure.
    // Future computations still validate their identity and runtime contract.
    try { runtime?.setProject(project); } catch { /* trusted host may recreate a failed runtime */ }
  }
  function checkedCandidate(graph) {
    const validation = validateProject(graph, layer?.validators ?? binding.validators);
    if (!validation.valid) {
      const affectedIds = graph.nodes.filter((node, index) => validation.errors.some(item => item.nodeId === node.id || item.path === node.id || item.path?.startsWith(`${node.id}.`) || item.path?.startsWith(`$.nodes[${index}]`))).map(node => node.id);
      fail('VALIDATION_FAILED', 'Project acceptance failed.', { validation, affectedIds });
    }
  }
  function stage(operations) {
    insist(Array.isArray(operations) && operations.length > 0 && operations.length <= limits.maxOperations, 'COMMAND_ARGUMENT', `Supply 1–${limits.maxOperations} operations.`, { path: '$.args.operations' });
    const draft = project.begin(), outcomes = [];
    for (const [index, operation] of operations.entries()) {
      try {
        fields(operation, ['command', 'args'], `$.args.operations[${index}]`);
        insist(typeof operation.command === 'string' && catalog.has(operation.command), 'COMMAND_UNKNOWN', 'Only catalogued mutations may appear inside a transaction.', { path: `$.args.operations[${index}].command` });
        const result = catalog.apply(draft, { command: operation.command, args: operation.args ?? {} });
        insist(!result?.then, 'ASYNC_COMMAND', 'Mutation authoring must be synchronous.');
        outcomes.push({ command: operation.command, result: copyData(result) });
      } catch (error) {
        error.operationIndex = index;
        const args = operation?.args;
        error.affectedIds = [args?.id, args?.options?.id, ...['source', 'target', 'left', 'right'].map(key => typeof args?.[key] === 'string' ? args[key] : args?.[key]?.node)].filter(isId);
        throw error;
      }
    }
    const preview = draft.preview();
    try {
      if (!preview.validation.valid) fail('VALIDATION_FAILED', 'Project acceptance failed.', { validation: preview.validation });
      checkedCandidate(preview.project);
    } catch (error) {
      error.affectedIds = preview.project.nodes.filter((node, index) => (error.validation?.errors ?? []).some(item => item.nodeId === node.id || item.path === node.id || item.path?.startsWith(`${node.id}.`) || item.path?.startsWith(`$.nodes[${index}]`))).map(node => node.id);
      error.affectedIds.push(...operations.map(operation => operation.args?.id).filter(isId));
      throw error;
    }
    return { draft, preview, outcomes };
  }
  function good(command, result, extra = {}) { return { ok: true, command, identity: project.token, result, ...extra }; }
  function checkResult(result) {
    insist(result?.valid, result?.diagnostics?.find(item => item.severity !== 'warning')?.code ?? 'EVALUATION_FAILED', 'Evaluation or compilation failed.', { diagnostics: result?.diagnostics });
    insist(sameIdentity(result.identity, project.token), 'STALE_RESULT', 'Computation returned another project identity.');
  }
  function timeOf(input = { value: 0, unit: 's' }) {
    fields(input, ['value', 'unit'], '$.args.time');
    const normalized = unit(input.unit);
    insist(Number.isFinite(input.value) && Number.isFinite(input.value * normalized.scale) && canonical(normalized.dimensions) === canonical(unit('s').dimensions), 'INVALID_TIME', 'Supply finite physical time.');
    return { value: input.value, unit: normalized };
  }
  function repairActions(code, kind) {
    if (kind === 'stale-state') return [{ command: 'inspect', description: 'Read the current identity and revise the request; use a new key for changed content.' }];
    if (kind === 'unavailable-capability') return [{ command: 'discover', description: 'Inspect installed commands and required host capabilities.' }];
    if (kind === 'cancelled' || kind === 'unauthorized') return [{ action: 'request-host-authority', description: 'Only the host can issue a new permitted session/turn authority.' }];
    if (code === 'KIND_MISMATCH' || code === 'UNIT_MISMATCH') {
      const options = [{ command: 'inspect', description: 'Read result.outputs and connect a node and port with the required quantity, units, kind and context. Preview the revised connection.' }];
      if (catalog.has('dataflow.constant')) options.push({
        command: 'discover', args: { names: ['dataflow.constant'] },
        description: 'For an independently known input, declare a typed constant with its physical value and unit descriptor, then connect its value port in the same preview.',
      });
      return options;
    }
    if (code === 'UNIT_CONVERSION_REQUIRED') return [{ command: 'discover', description: 'Look for an installed adapter from the source unit to the target unit. Preview it between the ports, or connect an output already in the required units.' }];
    return [{ command: 'discover', description: 'Inspect the declared arguments and limits.' }, { command: 'transaction.preview', description: 'Repair the reported arguments or connections and preview the revised batch.' }];
  }
  function failure(command, error) {
    const diagnostics = diagnosticsOf(error), first = diagnostics.find(item => item.severity !== 'warning') ?? diagnostics[0];
    const code = error?.code === 'VALIDATION_FAILED' ? first.code : error?.code ?? first.code;
    const kind = first.category ?? category(code), graph = project.snapshot(), graphIds = new Set(graph.nodes.map(node => node.id));
    const paths = [...new Set(diagnostics.map(item => item.path ?? '$'))];
    const affectedIds = [...new Set([...(error.affectedIds ?? []), ...diagnostics.flatMap(item => {
      const index = /^\$\.nodes\[(\d+)\]/.exec(item.path ?? '');
      return [item.nodeId, item.id, index ? graph.nodes[Number(index[1])]?.id : null,
        ...[...graphIds].filter(id => item.path === id || item.path?.startsWith(`${id}.`))].filter(isId);
    })])];
    const repairs = repairActions(code, kind);
    return { ok: false, command, error: { code, category: kind, message: first.message ?? error.message, diagnostics, affectedIds, paths, repairs,
      ...(error.operationIndex === undefined ? {} : { operationIndex: error.operationIndex }) }, context: { identity: project.token } };
  }
  rotate();
  const gateway = {
    limits: freezeData(limits),
    get localAuthority() { synchronize(); return local; },
    createSession(input = {}) {
      synchronize(); const options = copyData(input); fields(options, ['permissions'], 'session');
      const allowed = options.permissions ?? permissions;
      insist(Array.isArray(allowed) && new Set(allowed).size === allowed.length && allowed.every(item => permissions.includes(item)), 'PERMISSION_DENIED', 'Choose supported host permissions.');
      insist(activeSessions.size < limits.maxSessions, 'SESSION_BUDGET', 'Close unused sessions before opening another.');
      const session = Object.freeze({}); sessions.set(session, { active: true, allowed, turns: new Set(), project, generation: observed.generation }); activeSessions.add(session); return session;
    },
    issueTurn(session, input = {}) {
      synchronize(); const record = sessions.get(session);
      insist(record?.active && record.project === project && record.generation === observed.generation, 'SESSION_CLOSED', 'Use a current host-issued session.');
      const options = copyData(input); fields(options, ['permissions'], 'turn'); const allowed = options.permissions ?? record.allowed;
      insist(Array.isArray(allowed) && new Set(allowed).size === allowed.length && allowed.every(item => record.allowed.includes(item)), 'PERMISSION_DENIED', 'Turn permissions must be a subset of session permissions.');
      insist(activeTurns.size < limits.maxTurns, 'TURN_BUDGET', 'Revoke unused turns before issuing another.');
      const turn = authority(allowed, record); record.turns.add(turn); activeTurns.add(turn); return turn;
    },
    revokeTurn(turn) { insist(activeTurns.has(turn) || authorities.get(turn)?.session, 'INVALID_AUTHORITY', 'Use a host-issued turn.'); return revoke(turn); },
    closeSession(session) {
      const record = sessions.get(session); insist(record, 'INVALID_AUTHORITY', 'Use a host-issued session.');
      record.active = false; for (const turn of [...record.turns]) revoke(turn); activeSessions.delete(session);
    },
    forTurn(turn) { insist(authorities.get(turn)?.session, 'INVALID_AUTHORITY', 'Use a host-issued turn.'); return Object.freeze({ dispatch: request => gateway.dispatch(request, turn) }); },
    setProject(next) {
      insist(next instanceof Project, 'PROJECT_REQUIRED', 'Use an accepted F01 Project.');
      if (next !== project) { project = next; rotate(); } else synchronize();
      return project.token;
    },
    async dispatch(input, handle) {
      let command = null;
      try {
        synchronize();
        const request = requestData(input, limits.maxRequestBytes);
        fields(request, ['command', 'args', 'expected', 'idempotencyKey']);
        insist(typeof request.command === 'string' && request.command.length > 0 && request.command.length <= 160, 'COMMAND_ARGUMENT', 'Supply a command name of 1–160 characters.', { path: '$.command' });
        command = request.command;
        insist(builtins.has(command) || catalog.has(command), 'COMMAND_UNKNOWN', `Unknown command ${command}.`);
        const args = request.args ?? {}; insist(isRecord(args), 'COMMAND_ARGUMENT', 'Command args must be an object.', { path: '$.args' });
        const permission = reads.has(command) ? 'read' : command === 'evaluate' || command === 'render' ? command : 'write';
        const record = authorize(handle, permission, reads.has(command));
        const mutation = permission === 'write' && command !== 'transaction.preview';
        let signature;
        if (mutation) {
          insist(typeof request.idempotencyKey === 'string' && request.idempotencyKey.length >= 1 && request.idempotencyKey.length <= 128, 'COMMAND_ARGUMENT', 'Writes require an idempotency key of 1–128 characters.', { path: '$.idempotencyKey' });
          signature = canonical({ command, args, expected: request.expected ?? null, context: record.id });
          purge(); const previous = cache.get(request.idempotencyKey);
          if (previous) {
            insist(signature === previous.signature, 'IDEMPOTENCY_CONFLICT', 'This key already belongs to different content or authority context.');
            return freezeData(copyData({ ...previous.outcome, replayed: true }));
          }
        }
        if (!reads.has(command) || request.expected !== undefined) expected(request.expected);
        let outcome;
        if (command === 'discover') {
          fields(args, ['detail', 'names'], '$.args'); const discovered = catalog.discover();
          insist(args.detail === undefined || ['summary', 'full'].includes(args.detail), 'COMMAND_ARGUMENT', 'Discovery detail must be summary or full.', { path: '$.args.detail' });
          if (args.names !== undefined) insist(Array.isArray(args.names) && args.names.length > 0 && args.names.length <= 64 &&
            new Set(args.names).size === args.names.length && args.names.every(name => typeof name === 'string' && (builtins.has(name) || catalog.has(name))),
          'COMMAND_ARGUMENT', 'Select 1–64 distinct installed command names.', { path: '$.args.names' });
          const host = { runtime: typeof runtime?.submit === 'function', layer: typeof layer?.compile === 'function' && typeof layer?.sources === 'function' };
          outcome = good(command, { ...discovered, limits: { ...discovered.limits, gateway: limits }, commands: [...builtinDeclarations(limits, host), ...discovered.commands.map(declaration => ({ ...declaration, operationOutputSchema: declaration.outputSchema, outputSchema: mutationResultSchema, authority: 'write', expectedRequired: true, idempotencyRequired: true, limits: { ...declaration.limits, maxRequestBytes: limits.maxRequestBytes, byteBudgetScope: 'complete gateway request including envelope and every operation' } }))], gateway: { limits, responseSchema, outputSchemaScope: 'command outputSchema describes envelope.result; operationOutputSchema describes a staged catalog operation result', requestSchema: jsonObject({ command: { type: 'string', minLength: 1, maxLength: 160 }, args: arbitraryObject, expected: tokenSchema, idempotencyKey: { type: 'string', minLength: 1, maxLength: 128 } }, ['command']),
            idempotency: { scope: 'project load generation and issued authority context', retentionMs: limits.cacheTtlMs, maxEntries: limits.maxCacheEntries, maxBytes: limits.maxCacheBytes, durable: false, eviction: 'oldest successful mutation first' } } });
          if (args.names) {
            outcome.result.commands = outcome.result.commands.filter(item => args.names.includes(item.name));
            const extensions = new Set(outcome.result.commands.flatMap(item => item.extension ? [item.extension.id] : []));
            outcome.result.extensions = outcome.result.extensions.filter(item => extensions.has(item.manifest.id));
          }
          if (args.detail === 'summary') {
            const keys = ['name', 'description', 'extension', 'capabilities', 'authority', 'expectedRequired', 'idempotencyRequired', 'available', 'hostRequirements', 'missingHostRequirements'];
            outcome.result.commands = outcome.result.commands.map(item => Object.fromEntries(keys.filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]])));
            outcome.result.extensions = outcome.result.extensions.map(({ manifest }) => ({ id: manifest.id, version: manifest.version, kind: manifest.kind }));
            outcome.result.detail = 'summary';
          }
        } else if (command === 'inspect') {
          fields(args, ['id'], '$.args'); const graph = project.snapshot();
          if (args.id !== undefined) { insist(isId(args.id), 'COMMAND_ARGUMENT', 'Inspect a stable component ID.'); outcome = good(command, { node: project.get(args.id).value, dependencies: project.dependencies(args.id) }); }
          else outcome = good(command, { graph, history: project.history, outputs: binding.flow.describe(graph).outputs, requirements: registry.inspectRequirements(graph), sources: layer ? layer.sources(project) : [] });
        } else if (permission === 'write') {
          const before = project.snapshot(), previous = project.token;
          let staged, results = [];
          if (command.startsWith('history.')) fields(args, [], '$.args');
          else {
            if (command.startsWith('transaction.')) fields(args, ['operations'], '$.args');
            staged = stage(command.startsWith('transaction.') ? args.operations : [{ command, args }]); results = staged.outcomes;
          }
          authorize(handle, 'write'); expected(request.expected);
          if (command === 'transaction.preview') {
            outcome = good(command, { graph: staged.preview.project, validation: staged.preview.validation, baseToken: previous, operations: results },
              { summary: summary(before, staged.preview.project, previous, previous, 'preview') });
          } else {
            // A bounded summary holds at most 192 IDs, each <=128 characters.
            // Reserve before accepting, including history whose target is private.
            const retainedAt = now();
            insist(Number.isFinite(retainedAt), 'GATEWAY_HOST', 'Host clock must return a finite timestamp.');
            cacheReservation(bytes({ signature, results }) + 32768);
            authorize(handle, 'write'); expected(request.expected);
            const guard = { beforeCommit(candidate) {
              checkedCandidate(candidate);
              // This is deliberately last: ordinary and layer validators can
              // revoke host authority, even during the final kernel acceptance.
              authorize(handle, 'write'); expected(request.expected);
            } };
            const after = command === 'history.undo' ? project.undo(previous, guard) : command === 'history.redo' ? project.redo(previous, guard) : project.accept(staged.draft, guard);
            accepted();
            outcome = good(command, { operations: results, history: project.history }, { summary: summary(before, after, previous, project.token, command) });
            const retained = freezeData(copyData(outcome)), size = bytes({ signature, outcome: retained });
            cache.set(request.idempotencyKey, { signature, outcome: retained, at: retainedAt, bytes: size }); cacheBytes += size;
          }
        } else {
          const isRender = command === 'render';
          fields(args, isRender ? ['time', 'mode', 'settings', 'capabilities'] : ['id', 'port', 'time', 'mode', 'settings', 'checkpoints'], '$.args');
          insist(runtime && typeof runtime.submit === 'function', 'RUNTIME_REQUIRED', 'The host must install the bounded scientific runtime.');
          if (isRender) insist(layer, 'CAPABILITY_MISSING', 'No scene/workspace compiler is installed.');
          else insist(isId(args.id), 'COMMAND_ARGUMENT', 'Evaluate a stable scientific component ID.', { path: '$.args.id' });
          const identity = project.token, owner = project, defaults = getPlaybackDefaults();
          const time = timeOf(args.time ?? defaults.time), mode = args.mode ?? defaults.mode ?? 'auto', settings = args.settings ?? defaults.settings ?? {};
          insist(['auto', 'analytic', 'stateful'].includes(mode) && isRecord(settings), 'COMMAND_ARGUMENT', 'Use a supported evaluation mode and settings map.');
          if (args.port !== undefined) insist(isId(args.port), 'COMMAND_ARGUMENT', 'Use a stable output port.');
          if (args.capabilities !== undefined) {
            const advertised = args.capabilities;
            insist(Array.isArray(advertised) ? advertised.every(item => typeof item === 'string') : isRecord(advertised) &&
              ['nodes', 'projections', 'geometry'].every(key => advertised[key] === undefined || Array.isArray(advertised[key]) && advertised[key].every(item => typeof item === 'string')) &&
              (advertised.textures === undefined || typeof advertised.textures === 'string' || typeof advertised.textures === 'boolean'), 'COMMAND_ARGUMENT', 'Render capabilities must be a string array or an adapter capability declaration.');
          }
          supersede(); const sequence = computationSequence;
          const current = () => { authorize(handle, permission); insist(owner === project && sameIdentity(identity, project.token), 'STALE_RESULT', 'Project changed before computation could publish.'); insist(sequence === computationSequence, 'SUPERSEDED', 'A newer request superseded this computation.'); };
          async function evaluate(source) {
            current(); const job = runtime.submit(project, source.nodeId, { port: source.port, time, mode, settings, ...(args.checkpoints === undefined ? {} : { checkpoints: args.checkpoints }) });
            const entry = { job, authority: record }; jobs.add(entry);
            let result; try { result = await job.promise; } finally { jobs.delete(entry); }
            current(); checkResult(result); return result;
          }
          if (isRender) {
            const sources = layer.sources(project); insist(sources.length <= limits.maxSources, 'SOURCE_BUDGET', 'Too many scientific sources for one render.');
            const results = []; let retainedBytes = 0;
            for (const source of sources) {
              const result = await evaluate(source); retainedBytes += bytes(result);
              insist(retainedBytes <= limits.maxResponseBytes, 'RESULT_BUDGET', 'Scientific render snapshots exceed the gateway response limit.');
              results.push(result);
            }
            current(); const snapshot = await layer.compile(project, { time, results, ...(args.capabilities === undefined ? {} : { capabilities: args.capabilities }) });
            current(); checkResult(snapshot); outcome = good(command, { time, results, snapshot });
          } else outcome = good(command, await evaluate({ nodeId: args.id, port: args.port ?? 'value' }));
        }
        if (!mutation) insist(bytes(outcome) <= limits.maxResponseBytes, 'RESULT_BUDGET', 'Gateway response exceeds its byte limit.');
        return freezeData(copyData(outcome));
      } catch (error) { synchronize(); return freezeData(copyData(failure(command, error))); }
    },
  };
  return Object.freeze(gateway);
}
