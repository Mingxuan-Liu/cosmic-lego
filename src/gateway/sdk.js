// A data-only authoring client. The host gateway remains the only write authority.
// Recipes execute ordinary JavaScript in their author's process, never the server.
import { copyData as copy } from '../core/data.js';
const identifier = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const handles = new WeakMap();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class GatewayClientError extends Error {
  constructor(outcome) {
    super(outcome?.error?.message ?? 'Gateway request failed.');
    this.name = 'GatewayClientError'; this.code = outcome?.error?.code ?? 'GATEWAY_FAILURE'; this.outcome = outcome;
  }
}
export function requireSuccess(outcome) { if (!outcome?.ok) throw new GatewayClientError(outcome); return outcome; }

/** Transport receives the exact gateway request and returns the exact envelope. */
export function createGatewayClient(transport) {
  if (typeof transport !== 'function') throw new TypeError('Supply a gateway transport function.');
  const request = input => transport(copy(input));
  const client = {
    request,
    discover: () => request({ command: 'discover' }),
    inspect: (id) => request({ command: 'inspect', args: id === undefined ? {} : { id } }),
    async begin({ expected, idempotencyKey = identifier('edit') } = {}) {
      const inspected = requireSuccess(await client.inspect());
      return createAuthor({ request, expected: expected ?? inspected.identity, graph: inspected.result.graph, idempotencyKey });
    },
    async evaluate(args, { expected } = {}) {
      return request({ command: 'evaluate', args, expected: expected ?? requireSuccess(await client.inspect()).identity });
    },
    async render(args = {}, { expected } = {}) {
      return request({ command: 'render', args, expected: expected ?? requireSuccess(await client.inspect()).identity });
    },
    async undo({ expected, idempotencyKey = identifier('undo') } = {}) {
      return request({ command: 'history.undo', expected: expected ?? requireSuccess(await client.inspect()).identity, idempotencyKey });
    },
    async redo({ expected, idempotencyKey = identifier('redo') } = {}) {
      return request({ command: 'history.redo', expected: expected ?? requireSuccess(await client.inspect()).identity, idempotencyKey });
    },
  };
  return Object.freeze(client);
}

function createAuthor({ request, expected, graph, idempotencyKey }) {
  const owner = {}, operations = [], types = new Map(graph.nodes.map(node => [node.id, node.type]));
  const registered = new Set(graph.nodes.filter(node => node.data?.extension).map(node => node.id));
  const token = copy(expected);
  let sent = false, committed;
  const open = () => { if (sent) throw new Error('This transaction was submitted. Retry commit unchanged, or begin another transaction.'); };
  const idOf = input => {
    if (typeof input === 'string') return input;
    const entry = handles.get(input);
    if (!entry || entry.owner !== owner) throw new Error('Use a handle from this transaction or an explicit component ID.');
    return entry.id;
  };
  const source = input => object(input) && Object.hasOwn(input, 'node') ? { node: idOf(input.node), port: input.port ?? 'value' } : { node: idOf(input), port: 'value' };
  const mapInputs = inputs => Object.fromEntries(Object.entries(inputs ?? {}).map(([slot, input]) => [slot, source(input)]));
  const mapAssets = assets => Object.fromEntries(Object.entries(assets ?? {}).map(([slot, input]) => [slot, idOf(input)]));
  const add = (command, args = {}) => { open(); operations.push(copy({ command, args })); return author; };
  const handle = id => {
    const result = Object.freeze({
      id,
      port: port => ({ node: result, port }),
      set(parameters = {}, { inputs, assets } = {}) {
        const type = types.get(id); if (!registered.has(id)) throw new Error('Parameter updates require an installed extension handle; use the declared dataflow or relationship command for this node.');
        add(`update:${type}`, { id, parameters, ...(inputs ? { inputs: mapInputs(inputs) } : {}), ...(assets ? { assets: mapAssets(assets) } : {}) }); return result;
      },
      connect(type, target, options) { return author.connect(type, result, target, options); },
      remove({ cascade = false } = {}) { add('remove', { id, cascade }); return result; },
    });
    handles.set(result, { owner, id }); return result;
  };
  const calculation = (command, args, options = {}) => {
    const id = options.id ?? identifier('calculation'); add(command, { ...args, ...options, id });
    types.set(id, command);
    return handle(id);
  };
  const author = {
    get expected() { return copy(token); },
    get idempotencyKey() { return idempotencyKey; },
    command: add,
    get(id) { open(); if (!types.has(id)) throw new Error(`No known component ${id}; use command() for staged custom declarations.`); return handle(id); },
    create(extension, { id = identifier('component'), parameters = {}, inputs = {}, assets = {} } = {}) {
      add(`create:${extension}`, { id, parameters, inputs: mapInputs(inputs), assets: mapAssets(assets) });
      types.set(id, extension); registered.add(id); return handle(id);
    },
    constant(value, options) { return calculation('dataflow.constant', { value }, options); },
    select(spec, options) {
      const normalized = { ...spec, ...(spec.members ? { members: spec.members.map(source) } : {}) };
      return calculation('dataflow.select', { spec: normalized }, options);
    },
    arithmetic(op, left, right, options) { return calculation('dataflow.arithmetic', { op, left: source(left), right: source(right) }, options); },
    map(op, input, options) { return calculation('dataflow.map', { op, source: source(input) }, options); },
    reduce(op, input, options) { return calculation('dataflow.reduce', { op, source: source(input) }, options); },
    field(input, indices, options) { return calculation('dataflow.field', { source: source(input), indices }, options); },
    adapt(adapter, input, options) { return calculation('dataflow.adapt', { adapter, source: source(input) }, options); },
    connect(type, from, target, { id = identifier('relationship'), data = {} } = {}) {
      add('connect', { id, type, source: idOf(from), target: idOf(target), data }); types.set(id, type); return handle(id);
    },
    disconnect(input) { return add('disconnect', { id: idOf(input) }); },
    remove(input, { cascade = false } = {}) { return add('remove', { id: idOf(input), cascade }); },
    bindScene(target, input, options = {}) {
      const normalized = source(input);
      add('scene.bind', { target: idOf(target), source: normalized.node, options: { ...options, port: options.port ?? normalized.port } }); return handle(idOf(target));
    },
    bindPlot(target, input, options = {}) {
      const normalized = source(input);
      add('overlay.bind', { target: idOf(target), source: normalized.node, options: { ...options, port: options.port ?? normalized.port } }); return handle(idOf(target));
    },
    snapshot() { return copy({ command: 'transaction.commit', expected: token, idempotencyKey, args: { operations } }); },
    preview() { open(); return request({ command: 'transaction.preview', expected: token, args: { operations } }); },
    commit() {
      if (!sent) { committed = author.snapshot(); sent = true; }
      return request(committed); // Retry keeps the exact payload, context and key.
    },
  };
  return Object.freeze(author);
}

/** Local user transport. Agent hosts should pass gateway.forTurn(turn).dispatch. */
export function createLocalGatewayClient(gateway) {
  return createGatewayClient(request => gateway.dispatch(request, gateway.localAuthority));
}

export function createHttpGatewayClient({ url = 'http://127.0.0.1:4326', fetch: fetcher = globalThis.fetch } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Use the explicit loopback HTTP host URL, with no credentials, path, query or fragment.');
  return createGatewayClient(async request => {
    const response = await fetcher(new URL('/api/gateway', parsed), { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    const outcome = await response.json();
    if (typeof outcome?.ok !== 'boolean') throw new Error('The server did not return a gateway envelope.');
    return outcome;
  });
}
