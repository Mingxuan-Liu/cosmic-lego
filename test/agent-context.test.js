import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildExample } from '../examples/workspace.mjs';
import { createCommandGateway } from '../src/gateway/index.js';
import { buildAgentContext } from '../src/agent-session/context.js';

const run = promisify(execFile);
async function fixture() {
  const setup = buildExample(), gateway = createCommandGateway(setup);
  const [inspection, discovery] = await Promise.all([gateway.dispatch({ command: 'inspect' }), gateway.dispatch({ command: 'discover' })]);
  assert.equal(inspection.ok, true); assert.equal(discovery.ok, true);
  return { ...setup, gateway, inspection, discovery };
}

test('structured context derives graph-wide assumptions and capabilities while exposing only bounded selected/view metadata', async () => {
  const f = await fixture(), source = f.inspection.result.graph.nodes.find(node => node.type === 'fixture.moving-point');
  const view = f.inspection.result.graph.nodes.find(node => node.type === 'workspace.plot');
  const options = { inspection: f.inspection, discovery: f.discovery, input: { identity: f.project.token,
    selection: { nodeId: source.id, port: 'position', objectId: source.id }, time: { value: 3, unit: 's' }, presentationTime: 5, viewIds: [view.id] },
    host: { diagnostics: [{ code: 'EXAMPLE_WARNING', message: 'A public diagnostic.', severity: 'warning' }] } };
  const context = buildAgentContext(options);
  assert.deepEqual(context.selected, [{ id: source.id, type: source.type, kind: source.kind }]);
  assert.equal(context.views[0].id, view.id); assert.equal(context.time.unit.symbol, 's'); assert.equal(context.presentationTime, 5);
  assert.ok(context.assumptions.some(item => item.extension === source.type));
  assert.ok(context.commands.some(item => item.name === `create:${source.type}`));
  assert.ok(context.commands.some(item => item.name === 'evaluate' && item.available === false));
  assert.equal(context.diagnostics[0].code, 'EXAMPLE_WARNING');
  assert.ok(Object.isFrozen(context.selected[0]));
  assert.equal(Object.hasOwn(context, 'graph'), false); assert.equal(Object.hasOwn(context, 'parameters'), false);
  const wholeScene = buildAgentContext({ inspection: f.inspection, discovery: f.discovery });
  assert.ok(wholeScene.assumptions.length > 0, 'Unselected whole-scene turns still receive used model assumptions.');
});

test('context rejects unknown ports, stale identities, secret-bearing extra fields and oversized selections', async () => {
  const f = await fixture(), source = f.inspection.result.graph.nodes.find(node => node.type === 'fixture.moving-point');
  const base = { inspection: f.inspection, discovery: f.discovery };
  assert.throws(() => buildAgentContext({ ...base, input: { identity: f.project.token, selection: { nodeId: source.id, port: 'unknown' } } }), { code: 'CONTEXT_SELECTION' });
  assert.throws(() => buildAgentContext({ ...base, input: { identity: { ...f.project.token, revision: 999 } } }), { code: 'STALE_CONTEXT' });
  assert.throws(() => buildAgentContext({ ...base, input: { time: { value: 2, unit: 's' } } }), { code: 'STALE_CONTEXT' });
  assert.throws(() => buildAgentContext({ ...base, input: { identity: f.project.token, credentials: 'must not be sent' } }), { code: 'CONTEXT_SCHEMA' });
  assert.throws(() => buildAgentContext({ ...base, input: { identity: f.project.token, selectedIds: Array(33).fill(source.id) } }), { code: 'CONTEXT_SELECTION' });
  assert.throws(() => buildAgentContext({ ...base, input: { identity: f.project.token, time: { value: 1, unit: 'm' } } }), { code: 'CONTEXT_TIME' });
  assert.throws(() => buildAgentContext({ ...base, limits: { maxBytes: 100 } }), { code: 'CONTEXT_BUDGET' });
});

test('provider-neutral bridge starts with only copied shared layers, no astronomy or configured provider', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'cosmic-agent-isolation-'));
  try {
    for (const directory of ['core', 'dataflow', 'registry', 'gateway', 'agent-session']) await cp(new URL(`../src/${directory}/`, import.meta.url), path.join(temporary, 'src', directory), { recursive: true });
    await writeFile(path.join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
    const script = `import {Project} from './src/core/index.js';
import {ExtensionRegistry} from './src/registry/index.js';
import {createCommandGateway} from './src/gateway/index.js';
import {createAgentSession} from './src/agent-session/index.js';
const registry=new ExtensionRegistry(),binding=registry.bind(),project=new Project({validators:binding.validators});
const bridge=createAgentSession({gateway:createCommandGateway({registry,binding,project}),adapters:[]});
console.log(JSON.stringify({status:bridge.snapshot().status,agents:bridge.snapshot().agents}));await bridge.dispose();`;
    const result = await run(process.execPath, ['--input-type=module', '-e', script], { cwd: temporary });
    assert.deepEqual(JSON.parse(result.stdout), { status: 'disconnected', agents: [] });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
