import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGatewayClient, createHttpGatewayClient } from '../src/gateway/sdk.js';

const identity = { projectId: 'sdk', generation: 'load', revision: 0 };
function clientFor(nodes = []) {
  const calls = [];
  const client = createGatewayClient(async request => {
    calls.push(request);
    return { ok: true, identity, result: { graph: { nodes } } };
  });
  return { client, calls };
}

test('SDK rejects non-JSON data identically before local or HTTP transport can normalize it', () => {
  let localCalls = 0, httpCalls = 0, getterCalls = 0;
  const local = createGatewayClient(() => { localCalls++; });
  const remote = createHttpGatewayClient({ fetch: () => { httpCalls++; } });
  const getter = {}; Object.defineProperty(getter, 'value', { enumerable: true, get() { getterCalls++; return 1; } });
  for (const args of [{ value: undefined }, { value: NaN }, { value: Infinity }, { value: new Date() }, getter]) {
    const request = { command: 'untrusted', args };
    assert.throws(() => local.request(request), { code: 'INVALID_DATA' });
    assert.throws(() => remote.request(request), { code: 'INVALID_DATA' });
  }
  assert.equal(localCalls, 0); assert.equal(httpCalls, 0); assert.equal(getterCalls, 0);
});

test('an HTTP redirect cannot forward project operations beyond the configured endpoint', async t => {
  let forwarded = 0;
  const destination = http.createServer((request, response) => { forwarded++; request.resume(); response.end('{"ok":true}'); });
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve));
  const redirect = http.createServer((request, response) => {
    request.resume(); response.writeHead(307, { Location: `http://127.0.0.1:${destination.address().port}/receive` }); response.end();
  });
  await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const server of [redirect, destination]) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); });
  const client = createHttpGatewayClient({ url: `http://127.0.0.1:${redirect.address().port}` });
  await assert.rejects(client.request({ command: 'transaction.commit', args: { operations: [] }, expected: identity, idempotencyKey: 'private-operation' }));
  assert.equal(forwarded, 0);
});

test('new relationship handles can be reacquired and disconnected without inventing extension update commands', async () => {
  const { client } = clientFor(), draft = await client.begin();
  const a = draft.create('installed.model', { id: 'a' }), b = draft.create('installed.model', { id: 'b' });
  const relationship = draft.connect('annotation.link', a, b, { id: 'link' });
  assert.equal(draft.get(relationship.id).id, 'link');
  assert.throws(() => relationship.set({ note: 'not a registered parameter' }), /installed extension/);
  draft.disconnect(draft.get('link'));
  assert.deepEqual(draft.snapshot().args.operations.at(-1), { command: 'disconnect', args: { id: 'link' } });
  const calculation = draft.constant({ kind: 'scalar', data: 1, unit: '1', meaning: 'test' }, { id: 'constant' });
  assert.throws(() => calculation.set({ value: 2 }), /declared dataflow/);
});

test('a registered handle can rewire inputs without resetting or serializing undefined parameters', async () => {
  const { client, calls } = clientFor([{ id: 'model', type: 'installed.model', data: { extension: { id: 'installed.model' } } }]);
  const author = await client.begin();
  author.get('model').set(undefined, { inputs: { source: { node: 'other', port: 'position' } } });
  await author.commit();
  assert.deepEqual(calls.at(-1).args.operations[0], { command: 'update:installed.model', args: { id: 'model', parameters: {}, inputs: { source: { node: 'other', port: 'position' } } } });
});
