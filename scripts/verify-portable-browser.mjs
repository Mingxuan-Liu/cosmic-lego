// Agent-free F09 browser acceptance. The archived conversation is test data.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSceneServer } from './scene-server.mjs';
import { createPortableManifest } from '../src/portable/format.js';

const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
const directory = await mkdtemp(path.join(tmpdir(), 'cosmic-portable-browser-'));
const output = fileURLToPath(new URL('../.local/f09-ui-qa/', import.meta.url));
await mkdir(output, { recursive: true });
const report = { checks: [], rejectedImports: [], staleEdits: [], errors: [] };
const app = await startSceneServer({ workspace: true, port: 0, projectDirectory: directory });
let browser, page;
try {
  const transcript = [{ id: 'archived-1', turnId: 'archived-turn', role: 'user', text: '已保存的公开记录 · browser fixture' }];
  const marker = transcript[0].text;
  await app.agentSession.replaceProjectTranscript(transcript);
  browser = await chromium.launch({ headless: true, ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}), args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(45000);
  const consoleErrors = [];
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url }); });
  page.on('dialog', async dialog => { report.errors.push(dialog.type()); await dialog.dismiss(); });
  page.on('response', async response => {
    if (response.status() < 400) return;
    const envelope = await response.json().catch(() => ({}));
    if (response.url().endsWith('/api/projects/import') && envelope.error?.code === 'PORTABLE_VERSION') report.rejectedImports.push({ url: response.url(), status: response.status(), code: envelope.error.code });
    else if (response.url().endsWith('/api/workspace/edit') && envelope.code === 'STALE_TOKEN') report.staleEdits.push({ url: response.url(), status: response.status(), code: envelope.code });
    else report.errors.push(`${response.status()} ${response.url()} ${envelope.error?.code ?? ''}`);
  });
  const ready = () => page.waitForFunction(() => cosmicWorkspace.snapshot?.valid && document.querySelector('#status').textContent.endsWith('ready'));
  const feedback = text => page.waitForFunction(value => document.querySelector('#project-feedback').textContent.includes(value), text);
  const openMenu = async () => { if (!await page.locator('#project-menu').isVisible()) await page.locator('#project-toggle').click(); };
  const save = async name => { await page.locator('#project-name').fill(name); await page.locator('#project-save').click(); await feedback(`Saved ${name}`); };
  const download = async () => {
    const event = page.waitForEvent('download');
    await page.locator('#project-download').click();
    return JSON.parse(await readFile(await (await event).path(), 'utf8'));
  };
  const importFile = (name, document) => page.locator('#project-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) });
  const evidence = () => page.evaluate(() => ({
    time: cosmicWorkspace.state.time.value,
    positions: cosmicWorkspace.results.find(result => result.producer.nodeId === 'moving-collection').value.data,
    plot: cosmicWorkspace.snapshot.overlays.find(view => view.id === 'positions-plot').data.data,
    field: cosmicWorkspace.results.find(result => result.producer.nodeId === 'scalar-field').value.data,
    overlays: cosmicWorkspace.snapshot.overlays.map(({ id, x, y, width, height, folded, hidden, title }) => ({ id, x, y, width, height, folded, hidden, title })),
    nodes: cosmicWorkspace.snapshot.scene.nodes.map(({ id, position, positions, objectIds }) => ({ id, position, positions, objectIds })),
  }));
  await page.goto(app.url); await ready(); await openMenu();
  assert.equal(await page.locator('#project-save-transcript').isChecked(), false);
  assert.equal(await page.locator('#project-share-transcript').isChecked(), false);
  await save('private-base');
  const excluded = await download();
  assert.equal(excluded.sharing.transcriptIncluded, false); assert.deepEqual(excluded.sharing.transcript, []);
  assert.equal(JSON.stringify(excluded).includes(marker), false);
  assert.ok(excluded.source.original && excluded.source.reconstruction && excluded.assets.length);
  await page.locator('#project-save-transcript').check();
  await save('shared-record');
  const stillExcluded = await download();
  assert.deepEqual(stillExcluded.sharing.transcript, []);
  await page.locator('#project-share-transcript').check();
  const shared = await download(); assert.deepEqual(shared.sharing.transcript, transcript);
  report.checks.push('Named slots, independent private defaults and explicit public-only conversation download preserve source, assets and graph.');

  // A portable producer may save at any finite physical time. Chrome rounds
  // this particular double when serializing a range input, so check the
  // actual worker sample and the next playback step rather than that string.
  const seconds = 12.12345678901234;
  const nativeSource = shared.resources.find(resource => resource.path === shared.source.original.path);
  const imported = createPortableManifest({ ...app.context,
    source: { path: nativeSource.path, language: 'javascript', text: nativeSource.content, producedGraph: app.project.snapshot(),
      files: [{ path: 'recipes/inert-browser-fixture.js', language: 'javascript', text: 'globalThis.__F09_IMPORT_EXECUTED__ = true; throw new Error("archive text executed");' }] },
    playback: { time: { value: seconds, unit: 's' }, mode: 'auto', settings: {}, targets: [] }, includeTranscript: true, transcript });
  const beforeImport = app.project.token;
  await page.evaluate(() => { cosmicWorkspace.select({ nodeId: 'point-0', port: 'position' }); cosmicWorkspace.conversation.draft('conversation', 'Transient text'); });
  await importFile('档案.json', imported); await feedback('Imported 档案.json.'); await ready();
  assert.notEqual(app.project.token.generation, beforeImport.generation);
  assert.deepEqual(app.project.snapshot(), imported.graph);
  assert.equal(await page.locator('#project-save-transcript').isChecked(), false);
  assert.equal(await page.locator('#project-share-transcript').isChecked(), false);
  const importedState = await page.evaluate(() => ({ time: cosmicWorkspace.state.time.value, selection: cosmicWorkspace.state.selection, drafts: cosmicWorkspace.conversation.snapshot().drafts, executed: !!globalThis.__F09_IMPORT_EXECUTED__ }));
  assert.deepEqual(importedState, { time: seconds, selection: null, drafts: {}, executed: false }); assert.equal(globalThis.__F09_IMPORT_EXECUTED__, undefined);
  await page.waitForFunction(text => cosmicWorkspace.conversation.snapshot().messages.some(message => message.text === text), marker);
  assert.equal(await page.locator('.workspace-panel[data-overlay-id="conversation"]').getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
  assert.equal(app.agentSession.snapshot().agents.length, 0);
  await page.locator('#project-close').click();
  await page.locator('#play').click();
  await page.waitForFunction(wanted => cosmicWorkspace.state.time.value === wanted, seconds + 0.25);
  await page.locator('#play').click();
  report.checks.push('Imported graph has a fresh generation, no stale draft/selection, inert source and a disconnected archived conversation. First sample and playback preserve the exact saved double.');

  await page.evaluate(() => cosmicWorkspace.views.update('positions-plot', { title: '保存的点位 · X', x: 74, y: 28 }));
  await ready(); await openMenu();
  await page.waitForFunction(() => document.querySelector('#project-source').textContent.includes('changed since the recipe'));
  await page.locator('#project-save-transcript').check(); await save('edited-replay');
  const baseline = await evidence(), savedToken = app.project.token;
  const savedGraph = app.project.snapshot();
  await page.screenshot({ path: path.join(output, 'project-files.png') });
  await page.locator('#project-close').click();
  await page.evaluate(() => cosmicWorkspace.views.update('positions-plot', { title: 'Unsaved replacement title' }));
  await ready();
  await page.evaluate(() => { cosmicWorkspace.select({ nodeId: 'point-1' }); cosmicWorkspace.conversation.draft('conversation', 'Keep this on failed import'); });
  await openMenu(); assert.match(await page.locator('#project-dirty').textContent(), /Unsaved/);
  const stale = app.project.token, bad = { ...imported, version: imported.version + 10 };
  await importFile('unsupported.json', bad); await feedback('PORTABLE_VERSION');
  assert.deepEqual(app.project.token, stale);
  assert.deepEqual(await page.evaluate(() => [cosmicWorkspace.state.selection.nodeId, cosmicWorkspace.conversation.snapshot().drafts.conversation]), ['point-1', 'Keep this on failed import']);
  await page.locator('#project-list').selectOption('edited-replay'); await page.locator('#project-open').click(); await feedback('Opened edited-replay.'); await ready();
  assert.notEqual(app.project.token.generation, savedToken.generation);
  assert.deepEqual(app.project.snapshot(), savedGraph); assert.deepEqual(await evidence(), baseline);
  assert.match(await page.locator('#project-source').textContent(), /changed since the recipe/);
  assert.match(await page.locator('#project-dirty').textContent(), /saved/);
  assert.equal(await page.locator('#project-share-transcript').isChecked(), false);
  report.checks.push('Rejected future version leaves edits, selection, draft and accepted revision intact; named open reproduces worker values, geometry, saved plot title/layout and source divergence.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  const bounds = await page.locator('#project-menu').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'project-files-narrow.png') });
  await page.reload(); await ready();
  await page.waitForFunction(text => cosmicWorkspace.conversation.snapshot().messages.some(message => message.text === text), marker);
  assert.deepEqual(await evidence(), baseline);
  assert.equal(await page.locator('.workspace-panel[data-overlay-id="conversation"]').getByRole('button', { name: 'Send', exact: true }).isDisabled(), true);
  report.checks.push('A reloaded 390 px workspace replays the same scientific sample and archived public text with no configured agent.');
  // A delayed edit can outlive its source generation even while this browser
  // serializes its own actions. Open another project through a second client.
  const held = Promise.withResolvers(), release = Promise.withResolvers();
  await page.route('**/api/workspace/edit', async route => { held.resolve(); await release.promise; await route.continue(); });
  const staleEdit = page.evaluate(() => cosmicWorkspace.views.update('positions-plot', { title: 'Must not cross loads' })
    .then(() => 'accepted', error => error.message));
  await held.promise;
  const listed = await (await fetch(app.url + '/api/projects/list')).json();
  const slot = listed.result.find(entry => entry.name === 'private-base');
  const switched = await (await fetch(app.url + '/api/projects/open', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expected: app.project.token, name: slot.name, expectedVersion: slot.version }) })).json();
  release.resolve(); assert.equal(switched.ok, true, switched.error?.message);
  assert.match(await staleEdit, /previous edit was not applied/);
  assert.deepEqual(app.project.snapshot(), excluded.graph);
  await page.waitForFunction(generation => cosmicWorkspace.snapshot?.identity.generation === generation && cosmicWorkspace.conversation.snapshot().messages.length === 0, app.project.token.generation);
  assert.equal(await page.locator('#project-save-transcript').isChecked(), false);
  assert.equal(await page.locator('#project-share-transcript').isChecked(), false);
  report.checks.push('A delayed browser edit receives a stale token after a second client opens a file. It cannot rebase across the new generation; the private slot has no transcript.');
  const pending = [...report.rejectedImports, ...report.staleEdits];
  for (const error of consoleErrors) {
    const index = pending.findIndex(item => item.url === error.url && error.text.includes(`status of ${item.status}`));
    if (index >= 0) pending.splice(index, 1); else report.errors.push(error.text);
  }
  assert.equal(report.rejectedImports.length, 1); assert.equal(report.staleEdits.length, 1); assert.deepEqual(report.errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = error.message;
  await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); await browser?.close(); await app.close(); await rm(directory, { recursive: true, force: true });
}
