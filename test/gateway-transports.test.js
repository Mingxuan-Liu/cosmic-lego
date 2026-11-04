import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSceneServer } from '../scripts/scene-server.mjs';
import { createHttpGatewayClient, createLocalGatewayClient, requireSuccess } from '../src/gateway/sdk.js';
import { demonstrate } from '../examples/command-gateway.mjs';

const cli = (url, request) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/gateway.mjs', import.meta.url)), 'request', '-', '--url', url], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  child.on('error', reject);
  child.on('close', code => { try { resolve({ code, outcome: JSON.parse(stdout), stderr }); } catch (error) { reject(new Error(`${error.message}: ${stdout} ${stderr}`)); } });
  child.stdin.end(JSON.stringify(request));
});

test('discovery-only public recipe builds generic moving points, calculation, scene and plot with checked retry/Undo', async () => {
  const result = await demonstrate();
  assert.equal(result.points, 3); assert.equal(result.previewNonMutating, true); assert.equal(result.undoRedo, true);
});

test('real SDK, HTTP and child CLI share discovery, atomic validation, mutation identity and evaluated scientific values', async () => {
  const app = await startSceneServer({ workspace: true, port: 0 });
  try {
    const remote = createHttpGatewayClient({ url: app.url }), local = createLocalGatewayClient(app.gateway);
    const discovery = requireSuccess(await remote.discover());
    assert.deepEqual(discovery, await local.discover());
    assert.deepEqual((await cli(app.url, { command: 'discover' })).outcome, discovery);
    const declaration = discovery.result.commands.find(command => command.name.startsWith('create:') &&
      Object.values(command.outputs ?? {}).some(port => port.kind === 'vector' && port.meaning === 'position') && !Object.keys(command.ports.inputs).length);
    assert.ok(declaration);
    const before = app.project.token;
    const author = await remote.begin({ idempotencyKey: 'transport-construction' });
    author.create(declaration.extension.id, { id: 'transport-point', parameters: declaration.examples[0].parameters });
    requireSuccess(await author.preview()); assert.deepEqual(app.project.token, before);
    const accepted = requireSuccess(await author.commit());
    const replay = requireSuccess(await local.request(author.snapshot()));
    const replayCLI = await cli(app.url, author.snapshot());
    assert.equal(replayCLI.code, 0); assert.deepEqual(replayCLI.outcome, replay);
    assert.equal(replay.replayed, true); assert.deepEqual(replay.identity, accepted.identity);
    assert.equal(app.project.snapshot().nodes.filter(node => node.id === 'transport-point').length, 1);

    const evaluate = { command: 'evaluate', expected: app.project.token,
      args: { id: 'transport-point', port: 'position', time: { value: 2, unit: 's' } } };
    const values = [requireSuccess(await local.request(evaluate)), requireSuccess(await remote.request(evaluate)), requireSuccess((await cli(app.url, evaluate)).outcome)];
    for (const result of values.slice(1)) {
      assert.deepEqual(result.result.value, values[0].result.value);
      assert.deepEqual(result.identity, values[0].identity);
    }

    const invalid = { command: 'transaction.commit', expected: app.project.token, idempotencyKey: 'invalid-transport-batch', args: { operations: [
      { command: 'dataflow.constant', args: { id: 'invalid-length', value: { kind: 'scalar', data: 1, unit: 'm', meaning: 'length' } } },
      { command: 'dataflow.constant', args: { id: 'invalid-time', value: { kind: 'scalar', data: 1, unit: 's', meaning: 'time' } } },
      { command: 'dataflow.arithmetic', args: { id: 'invalid-sum', op: 'add', left: 'invalid-length', right: 'invalid-time' } },
    ] } };
    const snapshot = app.project.snapshot();
    const rejected = await local.request(invalid), rejectedHTTP = await remote.request(invalid), rejectedCLI = await cli(app.url, invalid);
    assert.equal(rejected.ok, false); assert.equal(rejectedCLI.code, 1);
    assert.deepEqual(rejectedHTTP, rejected); assert.deepEqual(rejectedCLI.outcome, rejected);
    assert.deepEqual(app.project.snapshot(), snapshot);
    const undone = await cli(app.url, { command: 'history.undo', expected: app.project.token, idempotencyKey: 'transport-undo' });
    assert.equal(undone.code, 0); assert.ok(undone.outcome.identity.revision > accepted.identity.revision);
    assert.equal(app.project.snapshot().nodes.some(node => node.id === 'transport-point'), false);
  } finally { await app.close(); }
});
