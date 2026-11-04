// Real-browser F07 acceptance with an isolated project and no agent provider.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startSceneServer } from './scene-server.mjs';
import { createHttpGatewayClient, requireSuccess } from '../src/gateway/sdk.js';

const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
const output = fileURLToPath(new URL('../.local/f07-qa/', import.meta.url));
await mkdir(output, { recursive: true });
const app = await startSceneServer({ workspace: true, port: 0 });
const client = createHttpGatewayClient({ url: app.url });
const report = { checks: [], errors: [], dialogs: [], artifacts: output, agent: 'Disconnected; no provider used.' };
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}),
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = browser.version(); report.graphics = 'WebGL2 / SwiftShader';
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('dialog', async dialog => { report.dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto(app.url);
  const ready = () => page.waitForFunction(() => cosmicWorkspace?.snapshot?.valid && document.querySelector('#status').textContent.endsWith('ready'));
  await ready();
  const before = app.project.token;
  const discovery = requireSuccess(await client.discover()).result;
  const plot = discovery.commands.find(command => command.name.startsWith('create:') &&
    command.artifact?.format === 'cosmic.workspace.overlay.v1' && command.artifact.schema.properties.kind.enum?.includes('plot'));
  const author = await client.begin({ idempotencyKey: 'browser-external-construction' });
  author.command('scene.duplicate', { id: 'moving-points', options: { id: 'gateway-copy' } });
  author.command('scene.update', { id: 'gateway-copy', parameters: { position: [0, 0, 2.8] } });
  const view = author.create(plot.extension.id, { id: 'gateway-mean', parameters: {
    title: 'Gateway · mean position magnitude', x: 440, y: 20, width: 390, height: 270,
  } });
  author.bindPlot(view, 'mean-position-magnitude');
  const accepted = requireSuccess(await author.commit());
  assert.equal(accepted.identity.revision, before.revision + 1);
  await page.waitForFunction(revision => cosmicWorkspace.state.identity.revision === revision &&
    cosmicWorkspace.snapshot.scene.nodes.some(node => node.id === 'gateway-copy') &&
    cosmicWorkspace.snapshot.overlays.some(view => view.id === 'gateway-mean'), accepted.identity.revision);
  await ready();
  const visible = await page.evaluate(() => ({ status: document.querySelector('#status').textContent,
    copy: cosmicWorkspace.snapshot.scene.nodes.find(node => node.id === 'gateway-copy'),
    original: cosmicWorkspace.snapshot.scene.nodes.find(node => node.id === 'moving-points'),
    plot: cosmicWorkspace.snapshot.overlays.find(view => view.id === 'gateway-mean'),
    mean: cosmicWorkspace.results.find(result => result.producer.nodeId === 'mean-position-magnitude').value }));
  assert.deepEqual(visible.copy.positions, visible.original.positions);
  assert.deepEqual(visible.plot.data, visible.mean);
  assert.match(visible.status, /Created/);
  assert.equal(await page.locator('.workspace-panel[data-overlay-id="gateway-mean"]').isVisible(), true);
  assert.equal(await page.locator('#undo').isEnabled(), true);
  await page.screenshot({ path: `${output}external-edit.png` });
  report.checks.push('External SDK transaction appears automatically as a second scene instance and bound plot, with summary and Undo');

  requireSuccess(await author.commit());
  assert.deepEqual(app.project.token, accepted.identity);
  const changed = author.snapshot(); changed.args.operations[0].args.options.id = 'changed-key-payload';
  assert.equal((await client.request(changed)).error.code, 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(app.project.token, accepted.identity);
  report.checks.push('Exact retry has no extra effects; changed content with the same key is rejected');

  await page.locator('#undo').click();
  await page.waitForFunction(revision => cosmicWorkspace.state.identity.revision > revision &&
    !cosmicWorkspace.snapshot.scene.nodes.some(node => node.id === 'gateway-copy') &&
    !cosmicWorkspace.snapshot.overlays.some(view => view.id === 'gateway-mean'), accepted.identity.revision);
  await ready(); await page.screenshot({ path: `${output}undo-restored.png` });
  assert.equal(app.project.snapshot().nodes.some(node => node.id === 'gateway-copy'), false);
  report.checks.push('One browser Undo restores pre-edit content with a fresh revision');

  const revision = app.project.token.revision;
  await page.evaluate(() => cosmicWorkspace.views.update('positions-plot', { title: 'Edited through the common gateway' }));
  await ready(); assert.equal(app.project.token.revision, revision + 1);
  assert.match(await page.locator('.workspace-panel[data-overlay-id="positions-plot"] .workspace-panel-header').textContent(), /^Edited through the common gateway/);
  const state = requireSuccess(await client.inspect());
  assert.equal(state.result.graph.nodes.find(node => node.id === 'positions-plot').data.parameters.title, 'Edited through the common gateway');
  assert.deepEqual(report.dialogs, []); assert.deepEqual(report.errors, []);
  report.checks.push('Browser edits use the same accepted graph without confirmation dialogs or browser errors');
  report.finalIdentity = state.identity;
  await writeFile(`${output}report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); await app.close(); }
