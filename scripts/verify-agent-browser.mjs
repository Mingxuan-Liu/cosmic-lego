// Opt-in F08 real-runtime acceptance. Uses the user's already authenticated
// runtime only when explicitly configured; never reads or writes credentials.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startSceneServer } from './scene-server.mjs';

if (!process.env.COSMIC_LEGO_CODEX) throw new Error('Set COSMIC_LEGO_CODEX to an explicitly trusted absolute executable. This test uses an authenticated agent.');
const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
const output = fileURLToPath(new URL('../.local/f08-qa/', import.meta.url));
await mkdir(output, { recursive: true });
const app = await startSceneServer({ workspace: true, port: 0, codexExecutable: process.env.COSMIC_LEGO_CODEX });
const report = { checks: [], errors: [], dialogs: [], tools: [], artifacts: output, evidence: 'Real native Codex app-server; browser-submitted prompts; no mock adapter.' };
const unsubscribe = app.agentSession.subscribe((state, event) => {
  if (event?.type === 'connection') console.log(`Agent: ${state.status}`);
  if (event?.type === 'tool' && event.phase === 'finished') {
    report.tools.push({ command: event.command, ok: event.ok, ...(event.error ? { code: event.error.code } : {}) });
    console.log(`Tool: ${event.command} ${event.ok ? 'accepted' : event.error?.code}`);
  }
});
let browser;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}),
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = browser.version(); report.graphics = 'WebGL2 / SwiftShader';
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('409 (Conflict)')) report.errors.push(message.text()); });
  page.on('dialog', async dialog => { report.dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto(app.url);
  const ready = () => page.waitForFunction(() => cosmicWorkspace?.snapshot?.valid && document.querySelector('#status').textContent.endsWith('ready'));
  await ready();
  // UI geometry remains a normal project edit. It precedes agent acceptance.
  await page.evaluate(() => cosmicWorkspace.views.update('conversation', { x: 1090, y: 240, width: 460, height: 750 }));
  await ready();
  const panel = page.locator('.workspace-panel[data-overlay-id="conversation"]');
  await panel.getByLabel('Agent', { exact: true }).selectOption('codex');
  await panel.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForFunction(() => ['ready', 'failed', 'auth-needed'].includes(cosmicWorkspace.agent.snapshot().status), null, { timeout: 90000 });
  assert.equal(app.agentSession.snapshot().status, 'ready', JSON.stringify(app.agentSession.snapshot().error));
  report.capabilities = app.agentSession.snapshot().capabilities;
  await page.screenshot({ path: `${output}connected.png` });
  report.checks.push('Explicit browser selection and Connect negotiate an authenticated native session with verified read-only controls');

  const prompt = async (text, keyboard = false) => {
    const priorTurns = app.agentSession.snapshot().messages.filter(item => item.role === 'user').length;
    await panel.getByRole('textbox').fill(text);
    if (keyboard) await panel.getByRole('textbox').press('Control+Enter');
    else await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForFunction(count => cosmicWorkspace.agent.snapshot().messages.filter(item => item.role === 'user').length > count,
      priorTurns, { timeout: 60000 });
    await page.waitForFunction(() => ['ready', 'failed', 'auth-needed', 'disconnected'].includes(cosmicWorkspace.agent.snapshot().status), null, { timeout: 600000 });
    assert.equal(app.agentSession.snapshot().status, 'ready', JSON.stringify(app.agentSession.snapshot().error));
    await ready();
  };
  await prompt('Discover the installed construction capabilities and inspect this project. Add three generic moving points, IDs agent-point-0, agent-point-1, agent-point-2, with initial positions [2,0,0], [0,2,0], [0,0,2] metres and velocities [0,0.1,0], [-0.1,0,0], [0.1,0,0] metres per second. Collect their positions into agent-positions, map position magnitude into agent-magnitudes, and calculate their mean as agent-mean. Make the points visibly rendered as agent-points, using compatible existing visual resources if helpful. Add a visible independent plot agent-derived-plot bound to agent-mean, title "Agent · mean distance", at x=460, y=30, width=380, height=250. Use installed models and public operations, preserve existing content, and complete the construction now. Explain the model assumptions briefly.', true);
  const built = app.project.snapshot();
  for (const id of ['agent-point-0', 'agent-point-1', 'agent-point-2', 'agent-positions', 'agent-magnitudes', 'agent-mean', 'agent-points', 'agent-derived-plot']) assert.ok(built.nodes.some(node => node.id === id), `Agent must create ${id}`);
  await page.waitForFunction(() => cosmicWorkspace.snapshot.scene.nodes.some(node => node.id === 'agent-points') && cosmicWorkspace.snapshot.overlays.some(view => view.id === 'agent-derived-plot'));
  const rendered = await page.evaluate(() => ({ points: cosmicWorkspace.snapshot.scene.nodes.find(node => node.id === 'agent-points'),
    plot: cosmicWorkspace.snapshot.overlays.find(view => view.id === 'agent-derived-plot'), mean: cosmicWorkspace.results.find(result => result.producer.nodeId === 'agent-mean') }));
  assert.equal(rendered.points.positions.length, 3); assert.equal(rendered.plot.source.nodeId, 'agent-mean');
  assert.deepEqual(rendered.plot.data, rendered.mean.value); assert.equal(rendered.mean.value.data, 2);
  assert.equal(await page.locator('.workspace-panel[data-overlay-id="agent-derived-plot"]').isVisible(), true);
  await page.screenshot({ path: `${output}constructed.png` });
  report.checks.push('Ctrl+Enter sends real context; agent discovers, inspects and creates points, collection, magnitude map, mean reduction, visible scene and bound plot through F07');

  await prompt('Using discovered operations, create a second independent visible plot with ID agent-second-plot and title "Agent · individual distances", bound to agent-magnitudes, at x=460, y=330, width=380, height=250. Leave the mean plot and science definitions unchanged.');
  await page.waitForFunction(() => cosmicWorkspace.snapshot.overlays.some(view => view.id === 'agent-second-plot'));
  const plots = await page.evaluate(() => cosmicWorkspace.snapshot.overlays.filter(view => ['agent-second-plot', 'agent-derived-plot'].includes(view.id)));
  assert.equal(plots.find(view => view.id === 'agent-second-plot').source.nodeId, 'agent-magnitudes');
  assert.equal(plots.find(view => view.id === 'agent-derived-plot').source.nodeId, 'agent-mean');
  await page.screenshot({ path: `${output}independent-plots.png` });
  report.checks.push('A second real agent turn creates an independently bound plot without shell code changes');

  await prompt('Remove only agent-second-plot using the discovered public removal operation. Preserve its scientific source, agent-derived-plot, and the scene.');
  assert.equal(app.project.snapshot().nodes.some(node => node.id === 'agent-second-plot'), false);
  for (const id of ['agent-magnitudes', 'agent-derived-plot', 'agent-points']) assert.ok(app.project.snapshot().nodes.some(node => node.id === id));
  const removedRevision = app.project.token.revision;
  await page.locator('#undo').click();
  await page.waitForFunction(revision => cosmicWorkspace.state.identity.revision > revision && cosmicWorkspace.snapshot.overlays.some(view => view.id === 'agent-second-plot'), removedRevision);
  await ready(); await page.screenshot({ path: `${output}undo.png` });
  report.checks.push('Agent removes only the requested plot; browser Undo restores it at a fresh revision');

  const stopRevision = app.project.token.revision;
  await panel.getByRole('textbox').fill('Inspect the current project and give a detailed explanation of the available construction operations. Make no changes.');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'working');
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'ready');
  assert.equal(app.agentSession.snapshot().activeTurn, null); assert.equal(app.project.token.revision, stopRevision);
  await page.screenshot({ path: `${output}stopped.png` });
  report.checks.push('Browser Stop cancels a real native turn and preserves committed scene content');

  await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.waitForFunction(() => cosmicWorkspace.agent.snapshot().status === 'disconnected');
  const beforeTime = await page.evaluate(() => cosmicWorkspace.snapshot.time.value);
  await page.locator('#play').click();
  await page.waitForFunction(time => cosmicWorkspace.snapshot.time.value > time + 0.1, beforeTime);
  await page.locator('#play').click(); await ready();
  assert.equal(app.agentSession.snapshot().status, 'disconnected');
  await page.screenshot({ path: `${output}disconnected-playback.png` });
  report.checks.push('Playback and public transcript remain usable with the provider disconnected');
  assert.deepEqual(report.dialogs, []); assert.deepEqual(report.errors, []);
  report.finalIdentity = app.project.token;
  report.transcript = app.agentSession.snapshot().messages;
  report.completed = true;
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }; report.state = app.agentSession.snapshot();
  throw error;
} finally {
  await writeFile(`${output}report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ completed: report.completed ?? false, checks: report.checks, failure: report.failure?.message, artifacts: output }, null, 2));
  unsubscribe(); await browser?.close(); await app.close();
}
