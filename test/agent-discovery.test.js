import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandGateway } from '../src/gateway/index.js';
import { buildExample } from '../examples/workspace.mjs';

test('agent-sized discovery summary and selected details come from the same installed command declarations', async () => {
  const context = buildExample(), gateway = createCommandGateway(context);
  const full = await gateway.dispatch({ command: 'discover' });
  const summary = await gateway.dispatch({ command: 'discover', args: { detail: 'summary' } });
  assert.equal(summary.ok, true);
  assert.deepEqual(summary.result.commands.map(item => item.name), full.result.commands.map(item => item.name));
  assert.ok(JSON.stringify(summary).length < JSON.stringify(full).length / 5);
  assert.equal(summary.result.commands.some(item => item.inputSchema), false);
  const names = ['create:workspace.plot', 'overlay.bind', 'transaction.commit'];
  const selected = await gateway.dispatch({ command: 'discover', args: { names } });
  assert.equal(selected.ok, true);
  for (const command of selected.result.commands) assert.deepEqual(command, full.result.commands.find(item => item.name === command.name));
  assert.deepEqual(selected.result.extensions.map(item => item.manifest.id), ['workspace.plot']);
  assert.deepEqual(context.project.token, full.identity);
  for (const args of [{ names: [] }, { names: ['not-installed'] }, { names: ['inspect', 'inspect'] }, { detail: 'unknown' }]) {
    const rejected = await gateway.dispatch({ command: 'discover', args });
    assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'COMMAND_ARGUMENT');
  }
});
