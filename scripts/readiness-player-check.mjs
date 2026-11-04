// F11 delivery verifier. Only the extracted player's shipped server runs in
// the child process; browser automation and reference checks stay in this host.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const originalFixtureGraph = 'sha256:5c70f450612c5c68fab757c10c66013ce956cf4ac88da1a6725e152e025d15d4';
const recordedAgentGraph = 'sha256:c5c3014c496f643b72280511d26d635674da5f984d8f65a1dbbe0d60a2720584';
const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
async function inventory(directory) {
  const entries = [];
  async function walk(relative = '') {
    for (const item of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? relative + '/' + item.name : item.name;
      if (item.isDirectory()) await walk(name);
      else { assert.ok(item.isFile(), 'Player files must be ordinary files: ' + name); entries.push(name); }
    }
  }
  await walk();
  const delivery = JSON.parse(await readFile(path.join(directory, 'delivery.json'), 'utf8'));
  assert.equal(delivery.format, 'cosmic-lego.local-player'); assert.equal(delivery.status, 'complete');
  const expected = delivery.files.map(item => item.file);
  assert.deepEqual(entries.sort(), [...expected, 'delivery.json'].sort(), 'Every shipped file must be inventoried exactly once.');
  for (const { file, sha256: want } of delivery.files) {
    assert.equal(sha256(await readFile(path.join(directory, file))), want, 'Invalid packaged digest: ' + file);
  }
  return delivery;
}

function listen(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Extracted player failed to announce its loopback URL.')), 30000);
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer = (buffer + chunk.toString()).slice(-4096);
      const url = buffer.match(/Cosmic Lego player: (http:\/\/127\.0\.0\.1:\d+\/timeline\/)\s/);
      if (url) { clearTimeout(timer); resolve(url[1]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Extracted player exited with code ' + code)); });
  });
}

export async function verifyReadinessPlayer({ directory, browser, env = process.env, baseline = false, expectedGraphHash = baseline ? originalFixtureGraph : recordedAgentGraph, screenshotPath, archivePath } = {}) {
  const original = await inventory(directory);
  assert.equal(original.projectIntegrity.graphHash, expectedGraphHash, 'Expected saved construction');
  const scratch = await mkdtemp(path.join(tmpdir(), 'cosmic-readiness-player-')), archive = path.join(scratch, 'player.zip');
  const clean = path.join(scratch, 'extracted');
  let child, exited, context;
  try {
    await mkdir(clean);
    await run('zip', ['-q', '-X', '-r', archive, '.'], { cwd: directory });
    await run('unzip', ['-q', archive, '-d', clean]);
    const extracted = await inventory(clean); assert.deepEqual(extracted, original);
    const project = JSON.parse(await readFile(path.join(clean, 'project.json'), 'utf8'));
    assert.deepEqual(project.integrity, extracted.projectIntegrity); assert.deepEqual(project.savedFrom, extracted.identity);
    assert.equal(project.integrity.sha256, extracted.snapshotId); assert.equal(project.graph.id, 'gate-bench');
    assert.equal(project.sharing.transcriptIncluded, false); assert.deepEqual(project.sharing.transcript, []);
    const args = ['scripts/timeline-server.mjs', '--project', 'project.json', '--port', '0'];
    child = spawn(process.execPath, args, { cwd: clean, env: { PATH: env.PATH ?? '/usr/bin:/bin', LANG: 'C', TZ: 'UTC', TMPDIR: scratch }, stdio: ['ignore', 'pipe', 'ignore'] });
    exited = once(child, 'exit');
    const url = await listen(child), origin = new URL(url).origin;
    context = await browser.newContext({ viewport: { width: 960, height: 620 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const external = [], requests = new Set(), errors = [];
    await context.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) { external.push(target.origin); await route.abort('blockedbyclient'); return; }
      requests.add(target.pathname); await route.continue();
    });
    await context.routeWebSocket('**/*', route => {
      const target = new URL(route.url());
      if (target.host !== new URL(origin).host) { external.push(target.origin); route.close(); }
      else route.connectToServer();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.waitForFunction(() => globalThis.cosmicTimeline?.receipt?.ready, undefined, { timeout: 60000 });
    await page.locator('#exact-time').fill('2'); await page.locator('#go').click();
    await page.waitForFunction(() => cosmicTimeline.receipt?.presentationTime === 2, undefined, { timeout: 60000 });
    const held = await page.evaluate(() => {
      const { frame, receipt } = cosmicTimeline;
      const scene = frame.snapshot.scene.nodes.find(node => node.id === 'pucks-stage');
      const view = frame.snapshot.overlays.find(node => node.id === 'gate-radius-report');
      const mean = frame.results.find(result => result.producer.nodeId === 'mean-gate-radius');
      const mark = document.querySelector('[data-id="gate-radius-report"]');
      return { presentationTime: frame.presentationTime, physicalTime: frame.physicalTime.value, resultTime: mean.request.time.value,
        source: view.source.nodeId, mean: mean.value.data, unit: mean.value.unit.symbol, plotted: view.data.data, emphasized: view.emphasized,
        configurationGraph: frame.configuration.graphHash, savedRevision: frame.identity.revision,
        ids: scene.objectIds, positions: scene.positions, caption: document.querySelector('#annotations').textContent,
        visibleReadout: mark.querySelector('.measurement').textContent.trim(), visibleEmphasis: mark.dataset.emphasized, renderer: receipt.renderer };
    });
    assert.equal(held.presentationTime, 2); assert.equal(held.physicalTime, 2); assert.equal(held.resultTime, 2);
    assert.equal(held.configurationGraph, expectedGraphHash);
    assert.equal(held.source, 'mean-gate-radius'); assert.equal(held.unit, 'm');
    const expected = baseline ? 2 / 3 : 1;
    assert.deepEqual(new Set(held.ids), new Set(['puck-low', 'puck-mid', 'puck-high', ...(baseline ? [] : ['late-puck'])]));
    if (!baseline) assert.deepEqual(held.positions[held.ids.indexOf('late-puck')], [-2, 0, 0]);
    assert.ok(Math.abs(held.mean - expected) <= 1e-10); assert.equal(held.plotted, held.mean);
    assert.equal(held.visibleReadout, Number(expected.toPrecision(7)) + ' m');
    assert.equal(held.emphasized, true); assert.equal(held.visibleEmphasis, 'true'); assert.match(held.caption, /held at 2 s/i);
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    assert.ok([...requests].every(route => !route.startsWith('/api/') || ['/api/timeline', '/api/timeline/frame'].includes(route)));
    if (screenshotPath) await page.screenshot({ path: screenshotPath });
    if (archivePath) await copyFile(archive, archivePath, constants.COPYFILE_EXCL);
    return { status: 'passed', archivedFiles: original.files.length + 1, hashedFiles: original.files.length,
      audits: ['delivery directory', 'new ZIP extraction'], archiveBytes: (await stat(archive)).size, snapshotId: extracted.snapshotId,
      childNode: process.version, launch: 'node ' + args.join(' '), browser: browser.version(), agentConfigured: false,
      offOriginRequests: external, browserErrors: errors, requestedPaths: [...requests].sort(), held };
  } finally {
    await context?.close();
    if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; }
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, reportPath] = process.argv.slice(2);
  if (!directory || !reportPath) throw new Error('Usage: readiness-player-check.mjs <player-directory> <report.json>');
  const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}),
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const report = await verifyReadinessPlayer({ directory: path.resolve(directory), browser,
      screenshotPath: path.join(path.dirname(reportPath), 'clean-player.png') });
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, hashedFiles: report.hashedFiles, meanMetres: report.held.mean, external: report.offOriginRequests }));
  } finally { await browser.close(); }
}
