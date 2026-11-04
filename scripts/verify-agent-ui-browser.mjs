// F08 deterministic UI acceptance. This host injects a TEST ONLY mock adapter;
// it proves the browser/bridge/gateway contract, not a real provider connection.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startSceneServer } from './scene-server.mjs';
const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
const output = fileURLToPath(new URL('../.local/f08-ui-qa/', import.meta.url)); await mkdir(output, { recursive: true });
const report = { evidence: 'TEST ONLY mock adapter; no provider/account used.', checks: [], errors: [], responses: [] };
const pending = new Set(); let handlers, active, lastContext, lateResult;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const later = (ms, fn) => { const job = delay(ms).then(fn); pending.add(job); job.finally(() => pending.delete(job)); };
const emit = event => handlers.onEvent(event);
const mock = { id: 'test-only', label: 'TEST ONLY mock agent', create: () => ({
  async connect(next) { handlers = next; return { providerSessionId: 'TEST-ONLY-PROVIDER-SESSION', capabilities: { streaming: true, tools: true, cancellation: true, userInput: true, permissionRequests: true, permissionGrants: false, resume: false } }; },
  async startTurn({ turnId, text, context }) {
    active = turnId; lastContext = context;
    if (text === 'stream') {
      later(20, async () => { const event = { type: 'delta', eventId: 'first-fragment', turnId, id: 'answer', text: 'TEST ONLY first' }; await emit(event); await emit(event); });
      later(650, async () => { await emit({ type: 'delta', eventId: 'second-fragment', turnId, id: 'answer', text: ' and second.' }); await emit({ type: 'complete', turnId, reason: 'completed' }); });
    } else if (text === 'permission') {
      await handlers.onRequest({ requestId: 'native-permission', turnId, kind: 'permission', message: 'TEST ONLY native access request; denial only.', options: [{ id: 'deny', label: 'Deny native access' }] });
    } else if (text === 'input') {
      await handlers.onRequest({ requestId: 'which-point', turnId, kind: 'input', message: 'TEST ONLY input question.', questions: [{ id: 'point', header: 'Point choice', question: 'Which point should be inspected?' }] });
    } else if (text === 'build') {
      later(50, async () => {
        const inspected = await handlers.onTool({ turnId, callId: 'inspect', name: 'cosmic_command', arguments: { command: 'inspect' } });
        const changed = await handlers.onTool({ turnId, callId: 'create', name: 'cosmic_command', arguments: { command: 'overlay.create', expected: inspected.identity, idempotencyKey: 'mock-independent-plot', args: { kind: 'plot', options: { id: 'mock-plot', title: 'TEST ONLY independently bound plot' }, source: 'scalar-field', binding: { port: 'value', component: 0 } } } });
        assert.equal(changed.ok, true); await emit({ type: 'message', turnId, id: 'built', text: 'TEST ONLY: created the independently bound plot through the checked gateway.' }); await emit({ type: 'complete', turnId });
      });
    } else if (text === 'observe') {
      await emit({ type: 'progress', turnId, label: 'TEST ONLY shared companion turn' });
    } else if (text === 'stop') {
      await emit({ type: 'delta', turnId, id: 'stopping', text: 'TEST ONLY work in progress.' });
      later(1200, async () => {
        lateResult = await handlers.onTool({ turnId, callId: 'late-write', name: 'cosmic_command', arguments: { command: 'overlay.create', expected: context.identity, idempotencyKey: 'late-mock', args: { kind: 'inspector', options: { id: 'must-not-exist' } } } });
        await emit({ type: 'delta', turnId, id: 'stopping', text: ' LATE TEXT MUST NOT APPEAR' });
      });
    }
  },
  async respond(requestId, answer) { report.responses.push({ requestId, answer }); await emit({ type: 'message', turnId: active, id: `reply-${requestId}`, text: 'TEST ONLY reply received.' }); await emit({ type: 'complete', turnId: active }); },
  async cancel() { await delay(100); }, async disconnect() {},
}) };
const auth = { id: 'test-auth', label: 'TEST ONLY authentication required', create: () => ({
  async connect() { throw Object.assign(new Error('TEST ONLY: run the configured runtime login command.'), { code: 'AUTH_REQUIRED' }); },
  async startTurn() {}, async respond() {}, async cancel() {}, async disconnect() {},
}) };
const app = await startSceneServer({ workspace: true, port: 0, agentAdapters: [mock, auth] });
let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}), args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(app.url); await page.waitForFunction(() => globalThis.cosmicWorkspace?.snapshot?.valid);
  const panel = page.locator('.workspace-panel[data-overlay-id="conversation"]'), draft = panel.getByRole('textbox', { name: 'Message draft for Conversation' });
  await panel.getByLabel('Agent', { exact: true }).selectOption('test-only');
  await panel.getByText('Connection settings', { exact: true }).click(); await panel.getByLabel('Native runtime permissions').selectOption('ask');
  await panel.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'ready');
  assert.match(await panel.locator('.agent-help').textContent(), /cannot grant native access/);
  const panelBox = await panel.boundingBox(), sendBox = await panel.getByRole('button', { name: 'Send', exact: true }).boundingBox();
  assert.ok(sendBox.y + sendBox.height <= panelBox.y + panelBox.height - 4, 'The default connected composer keeps Send inside its view.');
  await page.screenshot({ path: `${output}default-connected.png` });
  await page.evaluate(() => cosmicWorkspace.views.update('conversation', { x: 760, y: 20, width: 500, height: 650 }));
  await page.waitForFunction(() => document.querySelector('#status').textContent.endsWith('ready'));
  await page.evaluate(() => cosmicWorkspace.select({ nodeId: 'point-0', port: 'position' }));
  const send = async (text, keyboard = false) => { await draft.fill(text); if (keyboard) await draft.press('Control+Enter'); else await panel.getByRole('button', { name: 'Send', exact: true }).click(); };
  await send('stream', true); await panel.locator('.transcript').getByText('TEST ONLY first', { exact: false }).waitFor();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'ready' && cosmicWorkspace.conversation.snapshot().messages.some(message => message.text === 'TEST ONLY first and second.'));
  assert.equal((await panel.locator('.transcript').textContent()).match(/TEST ONLY first/g).length, 1);
  assert.equal(lastContext.selection.nodeId, 'point-0'); assert.equal(lastContext.selection.port, 'position'); assert.equal(lastContext.time.value, 0);
  report.checks.push('Host-selected TEST ONLY mock connects; Ctrl+Enter carries accepted selection/time context; duplicate streaming events render once.');
  await send('permission'); await panel.getByRole('button', { name: 'Deny native access' }).waitFor();
  assert.equal(await panel.getByRole('button', { name: /Allow/ }).count(), 0);
  await page.screenshot({ path: `${output}permission-deny-only.png` });
  await panel.getByRole('button', { name: 'Deny native access' }).click(); await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'ready');
  await send('input'); await panel.getByLabel('Point choice').fill('point-2'); await panel.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'ready');
  assert.deepEqual(report.responses, [{ requestId: 'native-permission', answer: { decision: 'deny' } }, { requestId: 'which-point', answer: { answers: { point: ['point-2'] } } }]);
  report.checks.push('Only the offered native denial is shown; structured input replies travel through the host bridge.');
  await send('build'); await page.locator('.workspace-panel[data-overlay-id="mock-plot"]').waitFor();
  await panel.locator('.agent-tools').getByText('overlay.create · complete', { exact: true }).waitFor();
  assert.equal(app.project.snapshot().nodes.some(node => node.id === 'mock-plot'), true);
  await page.screenshot({ path: `${output}mock-gateway-edit.png` });
  await page.locator('#undo').click(); await page.waitForFunction(() => !cosmicWorkspace.snapshot.overlays.some(view => view.id === 'mock-plot') && document.querySelector('#status').textContent.endsWith('ready'));
  report.checks.push('Mock tool uses the real gateway to add a separately bound plot; live scene feedback, tool status and Undo agree.');
  await send('observe'); await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'working');
  const observedTurn = app.agentSession.snapshot().activeTurn.id;
  const observer = await browser.newPage(); await observer.goto(app.url);
  await observer.waitForFunction(() => globalThis.cosmicWorkspace?.agent.snapshot().status === 'working');
  await observer.close(); assert.equal(app.agentSession.snapshot().activeTurn.id, observedTurn);
  await panel.getByRole('button', { name: 'Stop', exact: true }).click(); await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'ready');
  await send('stop'); await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'ready'); await delay(1300);
  assert.equal(lateResult.ok, false); assert.equal(lateResult.error.code, 'TURN_REVOKED');
  assert.equal(app.project.snapshot().nodes.some(node => node.id === 'must-not-exist'), false);
  assert.doesNotMatch(await panel.locator('.transcript').textContent(), /LATE TEXT/);
  await draft.fill('Keep this draft through disconnect.');
  await panel.getByRole('button', { name: 'Disconnect', exact: true }).click(); await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'disconnected');
  assert.equal(await draft.inputValue(), 'Keep this draft through disconnect.');
  await panel.getByLabel('Agent', { exact: true }).selectOption('test-auth'); await panel.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'auth-needed');
  assert.equal(await panel.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
  assert.match(await panel.locator('.agent-notice').textContent(), /runtime login/);
  await page.screenshot({ path: `${output}authentication-needed.png` });
  await panel.getByRole('button', { name: 'Disconnect', exact: true }).click(); await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'disconnected');
  await page.locator('#play').click(); await page.waitForFunction(() => cosmicWorkspace.snapshot.time.value > 0); await page.locator('#play').click();
  await page.reload(); await page.waitForFunction(() => globalThis.cosmicWorkspace?.snapshot?.valid && cosmicWorkspace.conversation.snapshot().messages.some(message => message.text === 'TEST ONLY first and second.'));
  assert.equal(await panel.getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => cosmicWorkspace.agent.snapshot().managed), false);
  report.checks.push('Closing an observing tab keeps the shared turn active. Explicit Stop revokes late text and writes. Drafts, authentication-needed state, disconnected playback and reloaded public history are verified.');
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = { message: error.message, stack: error.stack }; if (page) await page.screenshot({ path: `${output}failure.png` }).catch(() => {}); throw error; }
finally { await writeFile(`${output}report.json`, JSON.stringify(report, null, 2) + '\n'); await Promise.allSettled([...pending]); await browser?.close(); await app.close(); }
console.log(JSON.stringify(report, null, 2));
