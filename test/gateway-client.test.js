import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createGatewayClient, createLocalGatewayClient, createHttpGatewayClient, requireSuccess } from '../src/gateway/sdk.js';
import { runCLI } from '../scripts/gateway.mjs';

const token = { projectId: 'generic', generation: 'load-a', revision: 3 };
function recordingClient() {
  const calls = [];
  const client = createGatewayClient(async request => {
    calls.push(request);
    return { ok: true, command: request.command, identity: token,
      result: request.command === 'inspect' ? { graph: { nodes: [] }, history: { canUndo: false, canRedo: false } } : {} };
  });
  return { client, calls };
}

test('author SDK preserves ordinary handle recipes and explicit source ports as data operations', async () => {
  const { client, calls } = recordingClient(), draft = await client.begin({ idempotencyKey: 'recipe-1' });
  const points = [];
  for (let i = 0; i < 2; i++) points.push(draft.create('installed.moving', { id: `point-${i}`, parameters: { offset: i } }));
  const collection = draft.select({ mode: 'fixed', members: points.map(point => point.port('position')) }, { id: 'points' });
  const distances = draft.map('magnitude', collection, { id: 'distances' });
  const mean = draft.reduce('mean', distances, { id: 'mean' });
  const plot = draft.create('workspace.plot', { id: 'plot', parameters: { title: 'Mean distance' } });
  draft.bindPlot(plot, mean); points[0].set({ offset: 3 });
  await draft.commit();
  const request = calls.at(-1);
  assert.equal(request.command, 'transaction.commit'); assert.deepEqual(request.expected, token);
  assert.equal(request.idempotencyKey, 'recipe-1');
  assert.deepEqual(request.args.operations[2].args.spec.members, [{ node: 'point-0', port: 'position' }, { node: 'point-1', port: 'position' }]);
  assert.deepEqual(request.args.operations.at(-2), { command: 'overlay.bind', args: { target: 'plot', source: 'mean', options: { port: 'value' } } });
  assert.equal(request.args.operations.at(-1).command, 'update:installed.moving');
});

test('SDK previews preserve creation IDs; commit retries preserve exact content and mutation context', async () => {
  const { client, calls } = recordingClient(), draft = await client.begin();
  draft.create('installed.model'); const initial = draft.snapshot();
  await draft.preview(); await draft.commit(); await draft.commit();
  assert.deepEqual(calls.at(-1), calls.at(-2)); assert.deepEqual(calls.at(-1), initial);
  assert.deepEqual(calls.at(-3).args.operations, initial.args.operations);
  assert.throws(() => draft.create('another.model'), /submitted/);
  const mutatedCopy = draft.snapshot(); mutatedCopy.args.operations.length = 0;
  await draft.commit(); assert.equal(calls.at(-1).args.operations.length, 1);
});

test('foreign transaction handles cannot silently refer to matching node IDs', async () => {
  const { client } = recordingClient(); const first = await client.begin(), second = await client.begin();
  const a = first.create('model', { id: 'same' }), b = second.create('model', { id: 'same' });
  assert.throws(() => second.bindPlot(b, a), /this transaction/);
  assert.throws(() => second.create('operator', { inputs: { source: a } }), /this transaction/);
  assert.equal(second.snapshot().args.operations.length, 1);
});

test('HTTP client preserves structured gateway failure and rejects nonloopback endpoints', async () => {
  const failure = { ok: false, error: { code: 'STALE_TOKEN', message: 'Read current identity.', repairs: ['inspect'] }, identity: token };
  let received;
  const client = createHttpGatewayClient({ url: 'http://127.0.0.1:1234', fetch: async (url, input) => {
    received = { url: String(url), request: JSON.parse(input.body) }; return { json: async () => failure };
  } });
  const request = { command: 'transaction.commit', expected: token, idempotencyKey: 'retry', args: { operations: [] } };
  assert.deepEqual(await client.request(request), failure); assert.deepEqual(received.request, request);
  assert.equal(received.url, 'http://127.0.0.1:1234/api/gateway');
  assert.throws(() => requireSuccess(failure), { code: 'STALE_TOKEN' });
  for (const url of ['https://example.org', 'http://127.0.0.1/extra', 'http://user:pass@127.0.0.1', 'http://127.0.0.1/?token=x']) assert.throws(() => createHttpGatewayClient({ url }));
});

test('local client reads the host authority anew rather than retaining a revoked project grant', async () => {
  const first = {}, second = {}; let active = first;
  const seen = [], gateway = { get localAuthority() { return active; }, dispatch: async (request, authority) => { seen.push(authority); return { ok: true }; } };
  const client = createLocalGatewayClient(gateway); await client.discover(); active = second; await client.inspect();
  assert.equal(seen[0], first); assert.equal(seen[1], second);
});

test('CLI forwards exact JSON envelopes and returns the same failure with a nonzero exit code', async () => {
  const output = [], errors = [], envelope = { command: 'history.undo', expected: token, idempotencyKey: 'one' };
  const failure = { ok: false, error: { code: 'EMPTY_HISTORY', message: 'Nothing to undo.' } };
  const status = await runCLI(['request', '-'], { input: Readable.from([JSON.stringify(envelope)]), output: { write: text => output.push(text) }, errors: { write: text => errors.push(text) },
    client: { request: async input => { assert.deepEqual(input, envelope); return failure; } } });
  assert.equal(status, 1); assert.deepEqual(JSON.parse(output.join('')), failure); assert.deepEqual(errors, []);
});

test('CLI validates arguments and bounded JSON before calling any gateway', async () => {
  let calls = 0;
  for (const [argv, input] of [[['request', '-'], 'console.log("not JSON")'], [['request', '-'], ' '.repeat(65537)], [['discover', '--unexpected'], ''], [['request'], '']]) {
    const errors = [];
    const status = await runCLI(argv, { input: Readable.from([input]), output: { write() {} }, errors: { write: text => errors.push(text) }, client: { request: async () => { calls++; }, discover: async () => { calls++; } } });
    assert.equal(status, 2); assert.equal(JSON.parse(errors.join('')).error.code, 'CLI_ARGUMENT');
  }
  assert.equal(calls, 0);
});

test('CLI preserves Chinese labels across arbitrary UTF-8 chunk boundaries and rejects invalid byte sequences', async () => {
  const request = { command: 'overlay.update', args: { id: 'plot', parameters: { title: '中文标题 · 寰宇一瞬' } } };
  const bytes = Buffer.from(JSON.stringify(request));
  const chunks = Array.from(bytes, byte => Buffer.from([byte]));
  let received;
  const status = await runCLI(['request', '-'], { input: Readable.from(chunks), output: { write() {} }, errors: { write() {} },
    client: { request: async input => { received = input; return { ok: true }; } } });
  assert.equal(status, 0); assert.deepEqual(received, request);
  const errors = []; let called = false;
  const invalid = await runCLI(['request', '-'], { input: Readable.from([Buffer.from([0x22, 0xc3, 0x28, 0x22])]), output: { write() {} }, errors: { write: text => errors.push(text) },
    client: { request: async () => { called = true; } } });
  assert.equal(invalid, 2); assert.equal(called, false); assert.equal(JSON.parse(errors.join('')).error.code, 'CLI_ARGUMENT');
});
