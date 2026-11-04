// Optional F06 real-browser acceptance. Uses a fresh loopback fixture project.
// Supply installed Playwright/Chrome via COSMIC_LEGO_PLAYWRIGHT/COSMIC_LEGO_CHROME.
// Conversation events below are explicitly TEST ONLY; no agent is connected.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startSceneServer } from './scene-server.mjs';

const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
const output = fileURLToPath(new URL('../.local/f06-qa/', import.meta.url));
await mkdir(output, { recursive: true });
const app = await startSceneServer({ workspace: true, port: 0 });
const report = { checks: [], errors: [], expectedReadCancellations: [], artifacts: output, conversation: 'Test-only event injection; no provider or account connected.' };
let browser, page;
const consoleErrors = [], responseReads = new Set();
let nextPageId = 0;
const observe = page => {
  const pageId = ++nextPageId;
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ pageId, text: message.text(), url: message.location().url }); });
  page.on('response', response => {
    if (response.status() !== 409 || new URL(response.url()).pathname !== '/api/workspace/evaluate') return;
    const read = (async () => {
      const body = await response.json().catch(() => null);
      if (['STALE_TOKEN', 'SUPERSEDED', 'STALE_RESULT'].includes(body?.code)) report.expectedReadCancellations.push({ pageId, url: response.url(), status: 409, code: body.code });
    })();
    responseReads.add(read); read.finally(() => responseReads.delete(read));
  });
};
async function checkConsoleErrors() {
  while (responseReads.size) await Promise.all([...responseReads]);
  report.rawConsoleErrorCount = consoleErrors.length;
  const remaining = new Map();
  for (const response of report.expectedReadCancellations) {
    const key = JSON.stringify([response.pageId, response.url]); remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  report.expectedReadCancellationConsoleMessages = 0;
  for (const message of consoleErrors) {
    const key = JSON.stringify([message.pageId, message.url]);
    if (message.text === 'Failed to load resource: the server responded with a status of 409 (Conflict)' && remaining.get(key) > 0) {
      remaining.set(key, remaining.get(key) - 1); report.expectedReadCancellationConsoleMessages++;
    } else report.errors.push(message.text);
  }
}
const ready = page => page.waitForFunction(() => globalThis.cosmicWorkspace?.snapshot?.valid && document.querySelector('#status').textContent.endsWith('ready'));
const panel = (page, id) => page.locator(`.workspace-panel[data-overlay-id="${id}"]`);
const header = (page, id) => panel(page, id).locator('.workspace-panel-header');
const revision = page => page.evaluate(() => cosmicWorkspace.state.identity.revision);
const changed = async (page, before) => {
  await page.waitForFunction(before => cosmicWorkspace.state.identity.revision > before && document.querySelector('#status').textContent.endsWith('ready'), before);
};
const science = page => page.evaluate(() => JSON.stringify(cosmicWorkspace.results.map(result => result.value)));
const camera = page => page.evaluate(() => cosmicWorkspace.adapter.getCameraState());
const shot = (page, name) => page.screenshot({ path: `${output}${name}.png` });
const bounds = async page => {
  const data = await page.evaluate(() => {
    const region = document.querySelector('#overlays').getBoundingClientRect();
    return { region: region.toJSON(), viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
      panels: [...document.querySelectorAll('.workspace-panel')].filter(node => !node.hidden).map(node => ({ id: node.dataset.overlayId, rect: node.getBoundingClientRect().toJSON() })) };
  });
  assert.equal(data.scrollWidth, data.viewport.width, 'Workspace must not overflow horizontally.');
  for (const item of data.panels) {
    assert.ok(item.rect.left >= data.region.left - 1 && item.rect.top >= data.region.top - 1, item.id);
    assert.ok(item.rect.right <= data.region.right + 1 && item.rect.bottom <= data.region.bottom + 1, item.id);
  }
  return data;
};
const drag = async (page, locator, dx, dy, corner = false) => {
  const box = await locator.boundingBox(); assert.ok(box);
  const x = box.x + (corner ? box.width / 2 : Math.min(80, box.width / 4)), y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 12 }); await page.mouse.up();
};
const distance = state => Math.hypot(...state.position.map((n, i) => n - state.target[i]));

try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}),
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = browser.version(); report.graphics = 'WebGL2 / SwiftShader';
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page = await desktop.newPage(); observe(page); await page.goto(app.url); await ready(page);
  report.initial = await bounds(page); await shot(page, 'desktop-initial');
  assert.equal(await page.locator('#diagnostics').isVisible(), false);
  assert.equal(await panel(page, 'conversation').locator('.connection').textContent(), 'No agent connected');
  assert.equal(await panel(page, 'conversation').getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
  const draft = 'Retain this unfinished question about the selected point.';
  await panel(page, 'conversation').getByRole('textbox').fill(draft);
  const initialValues = await science(page);
  report.checks.push('Real generic workspace opens with disconnected conversation and checked scientific snapshots');

  let before = await revision(page);
  await drag(page, header(page, 'positions-plot'), -600, -600); await changed(page, before);
  const dragged = await page.evaluate(() => cosmicWorkspace.snapshot.overlays.find(view => view.id === 'positions-plot'));
  assert.equal(dragged.x, 0); assert.equal(dragged.y, 0); await bounds(page);
  before = await revision(page);
  await drag(page, panel(page, 'positions-plot').locator('.workspace-panel-resize'), 1800, 1600, true); await changed(page, before);
  await bounds(page); await shot(page, 'desktop-resize-bounds');
  await page.evaluate(() => cosmicWorkspace.views.update('positions-plot', { x: 30, y: 20, width: 390, height: 270 })); await ready(page);
  before = await revision(page); await header(page, 'positions-plot').focus(); await page.keyboard.press('ArrowRight'); await changed(page, before);
  assert.equal(await page.evaluate(() => cosmicWorkspace.snapshot.overlays.find(view => view.id === 'positions-plot').x), 40);
  before = await revision(page); await page.keyboard.press('Shift+ArrowDown'); await changed(page, before);
  assert.equal(await page.evaluate(() => cosmicWorkspace.snapshot.overlays.find(view => view.id === 'positions-plot').height), 280);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('workspace-panel-header')), true);
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.id), 'overlays');
  assert.equal(await science(page), initialValues);
  report.checks.push('Desktop pointer drag/resize clamp offscreen coordinates; keyboard move/resize and focus work without changing science');

  before = await revision(page); await panel(page, 'conversation').getByRole('button', { name: 'Fold Conversation', exact: true }).click(); await changed(page, before);
  assert.equal(await panel(page, 'conversation').getByRole('textbox').isVisible(), false);
  assert.equal(await panel(page, 'conversation').locator('.workspace-panel-body').evaluate(node => node.inert), true);
  before = await revision(page); await panel(page, 'conversation').getByRole('button', { name: 'Expand Conversation', exact: true }).click(); await changed(page, before);
  assert.equal(await panel(page, 'conversation').getByRole('textbox').inputValue(), draft);
  await panel(page, 'conversation').getByRole('textbox').focus();
  before = await revision(page); await panel(page, 'conversation').getByRole('button', { name: 'Hide Conversation', exact: true }).click(); await changed(page, before);
  assert.equal(await panel(page, 'conversation').isVisible(), false);
  await page.locator('#views-toggle').click(); before = await revision(page);
  await page.locator('#view-menu').getByRole('button', { name: 'Conversation', exact: true }).click(); await changed(page, before);
  assert.equal(await panel(page, 'conversation').getByRole('textbox').inputValue(), draft);
  assert.equal(await panel(page, 'conversation').getByRole('textbox').evaluate(node => node === document.activeElement), true);
  await page.locator('#scene').focus(); await page.keyboard.press('v');
  assert.equal(await page.evaluate(() => cosmicWorkspace.state.sceneOnly), true);
  assert.equal(await page.locator('#scene-only').isVisible(), true);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].every(node => node.hidden && node.inert && getComputedStyle(node).pointerEvents === 'none')), true);
  assert.equal(await page.evaluate(() => document.elementFromPoint(300, 300).id), 'scene');
  await shot(page, 'desktop-scene-only');
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => cosmicWorkspace.state.sceneOnly), false);
  assert.equal(await panel(page, 'conversation').getByRole('textbox').inputValue(), draft);
  report.checks.push('Fold/hide/restore retain composer draft and focus; V/Escape recover scene-only mode with no overlay interception');

  await page.locator('#time').fill('2'); await page.locator('#time').dispatchEvent('input');
  await page.waitForFunction(() => cosmicWorkspace.snapshot.time.value === 2 && document.querySelector('#status').textContent.endsWith('ready'));
  await panel(page, 'positions-plot').locator('circle[data-object-id="point-0"]').click();
  const selected = await page.evaluate(() => {
    const source = cosmicWorkspace.results.find(result => result.producer.nodeId === 'moving-collection');
    const mean = cosmicWorkspace.results.find(result => result.producer.nodeId === 'mean-position-magnitude');
    return { state: cosmicWorkspace.state, plot: cosmicWorkspace.snapshot.overlays.find(view => view.id === 'positions-plot').data,
      source: source.value, mean: mean.value.data, scene: cosmicWorkspace.snapshot.scene.nodes.find(node => node.id === 'moving-points').positions };
  });
  assert.equal(selected.state.selection.nodeId, 'moving-points'); assert.equal(selected.state.selection.objectId, 'point-0');
  assert.equal(selected.state.time.value, 2); assert.deepEqual(selected.plot, selected.source); assert.deepEqual(selected.scene, selected.source.data);
  assert.ok(Math.abs(selected.mean - selected.source.data.reduce((sum, point) => sum + Math.hypot(...point), 0) / selected.source.data.length) < 1e-12);
  const inspector = await panel(page, 'inspector').textContent(); assert.match(inspector, /point-0/); assert.match(inspector, /moving-collection\.value/); assert.match(inspector, /2 s/);
  await page.evaluate(() => cosmicWorkspace.views.update('mean-plot', { hidden: false })); await ready(page);
  await shot(page, 'desktop-linked-selection');
  report.checks.push('Plot selection, scene instance, inspector, derived mean and physical time agree on source IDs and evaluated data');

  const numerical = await science(page);
  const created = await page.evaluate(() => cosmicWorkspace.views.create('plot', {
    id: 'qa-temperature-plot', title: 'Independent temperature samples', x: 440, y: 340, width: 390, height: 280,
  }, 'scalar-field', { port: 'value', component: 0 }));
  assert.equal(created.createdId, 'qa-temperature-plot'); await ready(page);
  const field = await page.evaluate(() => cosmicWorkspace.snapshot.overlays.find(view => view.id === 'qa-temperature-plot'));
  assert.equal(field.source.nodeId, 'scalar-field'); assert.equal(field.data.meaning, 'temperature'); assert.equal(field.data.unit.symbol, 'K');
  assert.equal(await panel(page, field.id).locator('circle').count(), field.data.data.length);
  assert.equal(await science(page), numerical); await shot(page, 'desktop-independent-plot');
  await page.evaluate(() => cosmicWorkspace.views.remove('qa-temperature-plot')); await ready(page);
  assert.equal(await panel(page, 'qa-temperature-plot').count(), 0);
  before = await revision(page); await page.locator('#undo').click(); await changed(page, before);
  assert.equal(await panel(page, 'qa-temperature-plot').count(), 1);
  before = await revision(page); await page.locator('#redo').click(); await changed(page, before);
  assert.equal(await panel(page, 'qa-temperature-plot').count(), 0); assert.equal(await science(page), numerical);
  report.checks.push('Public API constructs an independently bound field plot; removal, Undo and Redo preserve other views and scientific values');

  await page.evaluate(() => cosmicWorkspace.views.create('plot', {
    id: 'qa-direct-position', title: 'Direct point position', x: 440, y: 340, width: 390, height: 280,
  }, 'point-0', { port: 'position', component: -1 })); await ready(page);
  assert.equal(await panel(page, 'qa-direct-position').locator('circle').count(), 3);
  await panel(page, 'qa-direct-position').locator('circle').first().click();
  assert.equal(await page.evaluate(() => cosmicWorkspace.state.selection.nodeId), 'point-0');
  assert.match(await panel(page, 'inspector').textContent(), /point-0\.position/);
  assert.equal(await panel(page, 'inspector').locator('.value-chip').count(), 3);
  await shot(page, 'desktop-direct-port-inspector');
  await page.evaluate(() => cosmicWorkspace.views.remove('qa-direct-position')); await ready(page);
  await panel(page, 'positions-plot').locator('circle[data-object-id="point-0"]').click();
  report.checks.push('A direct nondefault position port renders XYZ and resolves the selected source in the inspector');

  // This only verifies the F08 event boundary. It is deliberately labelled and
  // receives no provider credentials, real response, or network connection.
  await page.evaluate(() => {
    globalThis.qaConversationEvents = [];
    window.addEventListener('cosmic:conversation', event => qaConversationEvents.push(event.detail));
    cosmicWorkspace.conversation.receive({ type: 'connection', status: 'connected', label: 'TEST ONLY — injected event boundary, no provider' });
  });
  await panel(page, 'conversation').getByRole('textbox').fill('TEST ONLY: inspect the selected sample.');
  await panel(page, 'conversation').getByRole('button', { name: 'Send', exact: true }).click();
  const submitted = await page.evaluate(() => qaConversationEvents.find(event => event.type === 'submit'));
  assert.equal(submitted.context.selection.objectId, 'point-0'); assert.equal(submitted.context.time.value, 2);
  await page.evaluate(turnId => {
    cosmicWorkspace.conversation.receive({ type: 'progress', turnId, label: 'TEST ONLY progress', fraction: 0.5 });
    cosmicWorkspace.conversation.receive({ type: 'delta', turnId, id: 'test-message', text: 'TEST ONLY ' });
    cosmicWorkspace.conversation.receive({ type: 'delta', turnId, id: 'test-message', text: 'streamed message.' });
  }, submitted.turnId);
  assert.match(await panel(page, 'conversation').locator('.transcript').textContent(), /TEST ONLY streamed message/);
  assert.match(await panel(page, 'conversation').locator('.conversation-progress').textContent(), /50%/);
  await shot(page, 'test-only-conversation-events');
  await page.evaluate(turnId => cosmicWorkspace.conversation.receive({ type: 'error', turnId, message: 'TEST ONLY injected error' }), submitted.turnId);
  assert.match(await panel(page, 'conversation').getByRole('alert').textContent(), /TEST ONLY injected error/);
  await panel(page, 'conversation').getByRole('textbox').fill('TEST ONLY cancellation.');
  await panel(page, 'conversation').getByRole('button', { name: 'Send', exact: true }).click();
  const cancelled = await page.evaluate(() => cosmicWorkspace.conversation.snapshot().activeTurn);
  await panel(page, 'conversation').getByRole('button', { name: 'Stop', exact: true }).click();
  assert.equal(await page.evaluate(turnId => cosmicWorkspace.conversation.receive({ type: 'delta', turnId, id: 'too-late', text: 'This must be ignored.' }), cancelled), false);
  assert.equal(await page.evaluate(turnId => qaConversationEvents.some(event => event.type === 'cancel' && event.turnId === turnId), cancelled), true);
  await page.evaluate(() => cosmicWorkspace.conversation.receive({ type: 'connection', status: 'disconnected' }));
  assert.equal(await panel(page, 'conversation').getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
  report.checks.push('TEST ONLY conversation submit/context/progress/delta/error/Stop events render and reject late chunks; default remains disconnected');

  const narrow = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  page = await narrow.newPage(); observe(page); await page.goto(app.url); await ready(page);
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  report.narrow = await bounds(page); await shot(page, 'narrow-initial');
  await page.locator('#views-toggle').tap(); await page.locator('#fold-all').tap();
  await page.waitForFunction(() => cosmicWorkspace.snapshot.overlays.every(view => view.folded) && document.querySelector('#view-menu').hidden);
  await shot(page, 'narrow-folded-all');
  await page.locator('#views-toggle').tap(); before = await revision(page);
  await page.locator('#view-menu').getByRole('button', { name: 'Conversation', exact: true }).tap(); await changed(page, before);
  await panel(page, 'conversation').getByRole('textbox').fill('A narrow-screen draft stays with this view.');
  await shot(page, 'narrow-restored-conversation');
  before = await revision(page); await panel(page, 'conversation').getByRole('button', { name: 'Fold Conversation', exact: true }).tap(); await changed(page, before);
  await page.locator('#views-toggle').tap(); before = await revision(page);
  await page.locator('#view-menu').getByRole('button', { name: 'Point positions · X', exact: true }).tap(); await changed(page, before);
  await shot(page, 'narrow-restored-plot');
  await page.evaluate(() => cosmicWorkspace.views.update('positions-plot', { x: 0, y: 0, width: 280, height: 250 })); await ready(page);
  await header(page, 'positions-plot').focus();
  const cdp = await narrow.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 2, radiusY: 2, force: 1 })) });
  let box = await header(page, 'positions-plot').boundingBox();
  const startX = box.x + 55, startY = box.y + box.height / 2;
  before = await revision(page); const narrowScience = await science(page);
  await touch('touchStart', [[1, startX, startY]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[1, startX + i * 5, startY + i * 15]]);
  await touch('touchEnd', []); await changed(page, before); await bounds(page);
  const moved = await page.evaluate(() => cosmicWorkspace.snapshot.overlays.find(view => view.id === 'positions-plot'));
  assert.ok(moved.x >= 45 && moved.y >= 145); assert.equal(await science(page), narrowScience);
  await shot(page, 'narrow-touch-drag');
  await page.locator('#scene-only').tap();
  const orbitBefore = await camera(page);
  await touch('touchStart', [[2, 145, 400]]);
  for (let i = 1; i <= 12; i++) await touch('touchMove', [[2, 145 + i * 5, 400 + i * 3]]);
  await touch('touchEnd', []); await page.waitForTimeout(150);
  assert.notDeepEqual((await camera(page)).position, orbitBefore.position);
  const pinchBefore = await camera(page);
  await touch('touchStart', [[3, 145, 400], [4, 235, 400]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[3, 145 - i * 4, 400], [4, 235 + i * 4, 400]]);
  await touch('touchEnd', []); await page.waitForTimeout(150);
  assert.ok(Math.abs(distance(await camera(page)) - distance(pinchBefore)) > 0.01);
  assert.equal(await science(page), narrowScience);
  assert.equal(await page.evaluate(() => document.elementFromPoint(195, 400).id), 'scene');
  await shot(page, 'narrow-touch-scene');
  await page.locator('#scene-only').tap(); await bounds(page);
  await page.locator('#views-toggle').tap(); await shot(page, 'narrow-restore-menu');
  report.checks.push('390×844 reduced-motion context: real CDP touch drags overlay, orbits and pinches scene; bounds and numerical values remain intact');
  await checkConsoleErrors(); assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  try { if (page) await shot(page, 'failure'); } catch { /* The browser may have exited. */ }
  throw error;
} finally {
  await writeFile(`${output}report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); await app.close();
}
console.log(JSON.stringify(report, null, 2));
