import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexAdapter } from '../src/agent-session/codex.js';
import { CODEX_SAFE_CONFIG } from '../src/agent-session/config.js';
import { createJsonLineRpc } from '../src/agent-session/rpc.js';

const pause = () => new Promise(resolve => setImmediate(resolve));
const tool = { name: 'cosmic_command', description: 'Validated project commands.', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } };
function fixture(t, options = {}) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'cosmic-native-test-'))), processes = [], events = [], requests = [], calls = [];
  let turn = 0;
  const spawnProcess = (executable, args, launchOptions) => {
    const process = new EventEmitter(); Object.assign(process, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, args, messages: [], responses: [] });
    process.send = object => process.stdout.write(Buffer.from(`${JSON.stringify(object)}\n`));
    process.kill = signal => { process.signalCode = signal; process.emit('exit', null, signal); return true; };
    assert.equal(launchOptions.shell, false); assert.equal(launchOptions.cwd, workspace);
    let buffered = '';
    process.stdin.on('data', bytes => {
      buffered += bytes.toString('utf8'); let end;
      while ((end = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, end); buffered = buffered.slice(end + 1); if (!line) continue;
        const message = JSON.parse(line); process.messages.push(message);
        if (!message.method) { process.responses.push(message); continue; }
        if (!Object.hasOwn(message, 'id')) continue;
        queueMicrotask(() => {
          let result;
          if (message.method === 'initialize') result = { userAgent: 'test-native/0.166.0', platformOs: 'test', codexHome: '/private-auth-location' };
          else if (message.method === 'config/read') {
            const features = Object.fromEntries(Object.entries(CODEX_SAFE_CONFIG).filter(([key]) => key.startsWith('features.')).map(([key, value]) => [key.slice(9), value]));
            const inherited = options.inheritedMcp ? { inherited: { enabled: !args.includes('mcp_servers.inherited.enabled=false'), secret: 'do-not-expose' } } : {};
            result = { config: { sandbox_mode: 'read-only', approval_policy: options.permissionPolicy === 'ask' ? 'on-request' : 'never', web_search: 'disabled', features: { ...features, ...(options.unsafeFeature ? { shell_tool: true } : {}) }, mcp_servers: inherited }, layers: null };
          } else if (message.method === 'account/read') result = { requiresOpenaiAuth: true, account: options.authMissing ? null : { type: 'chatgpt', email: 'do-not-expose@example.invalid', token: 'do-not-expose' } };
          else if (message.method === 'thread/start') result = { thread: { id: 'native-thread' }, model: 'configured-model', sandbox: { type: options.unsafeSandbox ? 'dangerFullAccess' : 'readOnly', networkAccess: false }, approvalPolicy: options.permissionPolicy === 'ask' ? 'on-request' : 'never', cwd: workspace, runtimeWorkspaceRoots: [], instructionSources: [] };
          else if (message.method === 'turn/start') {
            const nativeId = `native-turn-${options.reuseNativeTurn ? 1 : ++turn}`;
            if (options.holdStart) {
              process.releaseStart = () => {
                process.send({ method: 'turn/started', params: { threadId: 'native-thread', turn: { id: nativeId, status: 'inProgress' } } });
                process.send({ id: message.id, result: { turn: { id: nativeId, status: 'inProgress', items: [] } } });
              }; return;
            }
            process.send({ method: 'turn/started', params: { threadId: 'native-thread', turn: { id: nativeId, status: 'inProgress' } } });
            result = { turn: { id: nativeId, status: 'inProgress', items: [] } };
          } else if (message.method === 'turn/interrupt') {
            if (options.rejectInterrupt) { process.send({ id: message.id, error: { code: -1, message: 'Could not interrupt.' } }); return; }
            result = {};
          }
          else result = {};
          process.send({ id: message.id, result });
        });
      }
    });
    processes.push(process); return process;
  };
  const adapter = createCodexAdapter({ executable: process.execPath, workspace, dynamicTools: [tool], spawnProcess, permissionPolicy: options.permissionPolicy ?? 'deny', ...(options.limits ? { limits: options.limits } : {}) });
  const handlers = { onEvent: event => { events.push(event); }, onRequest: request => { requests.push(request); }, onTool: async call => { calls.push(call); return options.onTool ? options.onTool(call) : { ok: true, command: call.arguments.command, result: {} }; } };
  t.after(async () => { await adapter.disconnect(); rmSync(workspace, { recursive: true, force: true }); });
  return { adapter, handlers, workspace, processes, events, requests, calls, latest: () => processes.at(-1),
    notify(method, params) { processes.at(-1).send({ method, params }); },
    request(id, method, params) { processes.at(-1).send({ id, method, params }); },
  };
}
async function active(context) {
  await context.adapter.connect(context.handlers);
  const response = await context.adapter.startTurn({ turnId: 'host-turn', text: 'Construct generic objects.', context: { identity: { projectId: 'project', generation: 'load', revision: 0 } } });
  return { threadId: 'native-thread', turnId: response.providerTurnId };
}

test('native handshake negotiates dynamic tools and verifies process-local confinement without exposing account data', async t => {
  const f = fixture(t, { inheritedMcp: true }), result = await f.adapter.connect(f.handlers);
  assert.equal(f.processes.length, 2); assert.ok(f.processes[1].args.includes('mcp_servers.inherited.enabled=false'));
  assert.equal(f.processes[0].messages.some(message => message.method === 'thread/start'), false);
  assert.equal(result.providerSessionId, 'native-thread'); assert.equal(result.capabilities.authentication, 'chatgpt'); assert.equal(result.capabilities.resume, false);
  const initialize = f.latest().messages.find(message => message.method === 'initialize'); assert.equal(initialize.params.capabilities.experimentalApi, true);
  const start = f.latest().messages.find(message => message.method === 'thread/start');
  assert.equal(start.params.ephemeral, true); assert.equal(start.params.dynamicTools[0].type, 'function'); assert.equal(start.params.sandbox, 'read-only');
  assert.deepEqual(start.params.environments, []); assert.equal(start.params.model, undefined);
  assert.equal(JSON.stringify({ result, events: f.events }).includes('do-not-expose'), false);
  assert.equal(JSON.stringify({ result, events: f.events }).includes('private-auth-location'), false);
});

test('missing authentication reports auth-needed and does not start a native thread or collect credentials', async t => {
  const f = fixture(t, { authMissing: true });
  await assert.rejects(f.adapter.connect(f.handlers), { code: 'AUTH_REQUIRED' });
  assert.equal(f.events.at(-1).type, 'auth-needed'); assert.equal(f.latest().messages.some(message => message.method === 'thread/start'), false);
  assert.equal(f.latest().messages.some(message => /login\/start|authTokens|logout/.test(message.method ?? '')), false);
});

test('unsupported native confinement fails closed before or immediately after thread initialization', async t => {
  const feature = fixture(t, { unsafeFeature: true }); await assert.rejects(feature.adapter.connect(feature.handlers), { code: 'AGENT_CONFINEMENT' });
  assert.equal(feature.latest().messages.some(message => message.method === 'thread/start'), false);
  const sandbox = fixture(t, { unsafeSandbox: true }); await assert.rejects(sandbox.adapter.connect(sandbox.handlers), { code: 'AGENT_CONFINEMENT' });
  assert.equal(sandbox.events.some(event => event.type === 'ready'), false);
});

test('only public message text is streamed and native completion events are deduplicated', async t => {
  const f = fixture(t), ids = await active(f);
  f.notify('item/reasoning/textDelta', { ...ids, itemId: 'reason', delta: 'private reasoning' });
  f.notify('item/agentMessage/delta', { ...ids, itemId: 'message', delta: '你好' });
  const final = { ...ids, item: { type: 'agentMessage', id: 'message', text: '你好，已完成。' } };
  f.notify('item/completed', final); f.notify('item/completed', final);
  f.notify('turn/completed', { threadId: ids.threadId, turn: { id: ids.turnId, status: 'completed' } });
  f.notify('turn/completed', { threadId: ids.threadId, turn: { id: ids.turnId, status: 'completed' } });
  await pause();
  assert.deepEqual(f.events.filter(event => event.type === 'delta').map(event => event.text), ['你好']);
  assert.equal(f.events.filter(event => event.type === 'message').length, 1); assert.equal(f.events.filter(event => event.type === 'complete').length, 1);
  assert.equal(JSON.stringify(f.events).includes('private reasoning'), false);
  assert.ok(f.events.every(event => event.eventId));
});

test('native dynamic tool calls carry the mapped host turn and exact gateway envelope', async t => {
  const f = fixture(t), ids = await active(f), request = { command: 'inspect', args: {} };
  f.request(900, 'item/tool/call', { ...ids, callId: 'call', namespace: null, tool: 'cosmic_command', arguments: request }); await pause();
  assert.deepEqual(f.calls, [{ turnId: 'host-turn', callId: 'call', name: 'cosmic_command', arguments: request }]);
  const response = f.latest().responses.find(item => item.id === 900);
  assert.equal(response.result.success, true); assert.equal(response.result.contentItems[0].type, 'inputText');
  assert.equal(JSON.parse(response.result.contentItems[0].text).command, 'inspect');
  f.request(901, 'item/tool/call', { ...ids, callId: 'unsafe', namespace: null, tool: 'shell', arguments: { command: 'no' } }); await pause();
  assert.equal(f.calls.length, 1); assert.equal(f.latest().responses.find(item => item.id === 901).result.success, false);
});

test('default permission policy declines native access and never forwards arbitrary native requests as tools', async t => {
  const f = fixture(t), ids = await active(f);
  f.request(900, 'item/commandExecution/requestApproval', { ...ids, command: 'unsafe source' });
  f.request(901, 'item/permissions/requestApproval', { ...ids, permissions: { network: { enabled: true } } });
  f.request(902, 'process/spawn', { command: ['unsafe'] }); await pause();
  assert.deepEqual(f.latest().responses.find(item => item.id === 900).result, { decision: 'decline' });
  assert.deepEqual(f.latest().responses.find(item => item.id === 901).result, { permissions: {}, scope: 'turn' });
  assert.ok(f.latest().responses.find(item => item.id === 902).error); assert.equal(f.calls.length, 0); assert.equal(f.requests.length, 0);
});

test('ask policy supports correlated input answers and deny-only native permission requests', async t => {
  const f = fixture(t, { permissionPolicy: 'ask' }), ids = await active(f);
  f.request(900, 'item/tool/requestUserInput', { ...ids, questions: [{ id: 'label', header: 'Label', question: 'Which label?', isOther: true, isSecret: false, options: [{ label: '中文', description: 'A label.' }] }] }); await pause();
  assert.equal(f.requests[0].kind, 'input'); await f.adapter.respond(f.requests[0].requestId, { answers: { label: ['中文'] } });
  assert.deepEqual(f.latest().responses.find(item => item.id === 900).result, { answers: { label: { answers: ['中文'] } } });
  await assert.rejects(f.adapter.respond(f.requests[0].requestId, { answers: {} }), { code: 'AGENT_REQUEST_STALE' });
  f.request(901, 'item/fileChange/requestApproval', { ...ids }); await pause();
  assert.deepEqual(f.requests[1].options.map(option => option.id), ['deny']);
  await assert.rejects(f.adapter.respond(f.requests[1].requestId, { decision: 'allow' }), { code: 'PERMISSION_BLOCKED' });
  await f.adapter.respond(f.requests[1].requestId, { decision: 'deny' });
  assert.deepEqual(f.latest().responses.find(item => item.id === 901).result, { decision: 'decline' });
  f.request(902, 'item/tool/requestUserInput', { ...ids, questions: [{ id: 'credential', isSecret: true }] }); await pause();
  assert.equal(f.requests.length, 2); assert.deepEqual(f.latest().responses.find(item => item.id === 902).result, { answers: {} });
});

test('Stop interrupts native work, drops late public text and refuses late scoped tool calls', async t => {
  const f = fixture(t), ids = await active(f); await f.adapter.cancel('host-turn');
  assert.ok(f.latest().messages.some(message => message.method === 'turn/interrupt' && message.params.turnId === ids.turnId));
  f.notify('item/agentMessage/delta', { ...ids, itemId: 'late', delta: 'late text' });
  f.request(900, 'item/tool/call', { ...ids, callId: 'late', namespace: null, tool: 'cosmic_command', arguments: { command: 'inspect' } }); await pause();
  assert.equal(f.calls.length, 0); assert.equal(f.events.some(event => event.text === 'late text'), false);
  assert.equal(f.latest().responses.find(item => item.id === 900).result.success, false);
});

test('Stop before native turn acknowledgement waits for the correct native ID before interrupting', async t => {
  const f = fixture(t, { holdStart: true }); await f.adapter.connect(f.handlers);
  const started = f.adapter.startTurn({ turnId: 'host-turn', text: 'Start.', context: {} }); await pause();
  const stopped = f.adapter.cancel('host-turn');
  await assert.rejects(f.adapter.startTurn({ turnId: 'next', text: 'Next.', context: {} }), { code: 'AGENT_BUSY' });
  f.latest().releaseStart(); await started; await stopped;
  assert.ok(f.latest().messages.some(message => message.method === 'turn/interrupt' && message.params.turnId === 'native-turn-1'));
});

test('failed native interruption closes the connection, and native turn IDs cannot acquire another host grant', async t => {
  const failure = fixture(t, { rejectInterrupt: true }); await active(failure);
  await assert.rejects(failure.adapter.cancel('host-turn'), { code: 'AGENT_CANCEL_FAILED' });
  await assert.rejects(failure.adapter.startTurn({ turnId: 'next', text: 'Next.', context: {} }), { code: 'AGENT_DISCONNECTED' });
  const reuse = fixture(t, { reuseNativeTurn: true }); await active(reuse); await reuse.adapter.cancel('host-turn');
  await assert.rejects(reuse.adapter.startTurn({ turnId: 'next', text: 'Next.', context: {} }), { code: 'AGENT_PROTOCOL' });
  assert.equal(reuse.calls.length, 0);
});

test('native authentication expiry is surfaced without copying upstream credentials or private details', async t => {
  const f = fixture(t), ids = await active(f);
  f.notify('error', { ...ids, willRetry: false, error: { codexErrorInfo: 'unauthorized', message: 'do-not-expose upstream detail' } }); await pause();
  assert.equal(f.events.at(-1).type, 'auth-needed'); assert.equal(JSON.stringify(f.events).includes('do-not-expose'), false);
});

test('disconnect and reconnect reset native mapping; old callbacks cannot route into the new session', async t => {
  const f = fixture(t), ids = await active(f), old = f.latest(); await f.adapter.disconnect(); await f.adapter.connect(f.handlers);
  old.send({ method: 'item/agentMessage/delta', params: { ...ids, itemId: 'late', delta: 'stale connection' } }); await pause();
  assert.equal(f.events.some(event => event.text === 'stale connection'), false);
  await f.adapter.startTurn({ turnId: 'host-turn', text: 'New connection.', context: {} }); assert.equal(f.processes.length, 2);
});

test('adapter rejects live-repository workspaces, arbitrary tools and unbounded input before native launch', async t => {
  assert.throws(() => createCodexAdapter({ executable: process.execPath, workspace: new URL('..', import.meta.url).pathname, dynamicTools: [tool] }), { code: 'AGENT_CONFIG' });
  const f = fixture(t, { limits: { maxTextChars: 5 } }); await f.adapter.connect(f.handlers);
  assert.throws(() => createCodexAdapter({ executable: process.execPath, workspace: f.workspace, dynamicTools: [tool], args: ['--dangerously-bypass-approvals-and-sandbox'] }), { code: 'AGENT_CONFIG' });
  await assert.rejects(f.adapter.startTurn({ turnId: 'large', text: 'too long', context: {} }), { code: 'AGENT_INPUT' });
  assert.equal(f.latest().messages.some(message => message.method === 'turn/start'), false);
});

test('JSONL transport preserves split UTF-8 and rejects invalid or oversized frames', async () => {
  const child = new EventEmitter(); Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
  const notifications = [], closed = []; const rpc = createJsonLineRpc(child, { onNotification: message => notifications.push(message), onClose: error => closed.push(error), maxFrameBytes: 100 });
  const frame = Buffer.from(JSON.stringify({ method: 'public', params: { text: '中文' } }) + '\n'); const split = frame.indexOf(Buffer.from('中文')) + 1;
  child.stdout.write(frame.subarray(0, split)); child.stdout.write(frame.subarray(split)); assert.equal(notifications[0].params.text, '中文');
  child.stdout.write(Buffer.alloc(101, 120)); assert.equal(closed[0].code, 'AGENT_PROTOCOL_BUDGET'); rpc.close();
  const invalid = new EventEmitter(); Object.assign(invalid, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
  let error; createJsonLineRpc(invalid, { onClose: failure => { error = failure; } }); invalid.stdout.write(Buffer.from([0xff, 10])); assert.equal(error.code, 'AGENT_PROTOCOL');
});
