// Real Chromium acceptance of the shared interactive and delivery stage.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildTimelineManifest } from '../examples/authored-timeline.mjs';
import { startTimelineServer } from './timeline-server.mjs';

const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
const output = fileURLToPath(new URL('../.local/f10-ui-qa/', import.meta.url));
await mkdir(output, { recursive: true });
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--project')) throw new Error('Usage: verify-timeline-browser.mjs [--project motion-study.json]');
const manifest = args.length ? JSON.parse(await readFile(args[1], 'utf8')) : await buildTimelineManifest();
const app = await startTimelineServer({ manifest });
const report = { checks: [], errors: [], frames: [], snapshotId: manifest.integrity.sha256 };
let browser, page;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}), args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = browser.version();
  const observe = tab => { tab.on('pageerror', error => report.errors.push(error.message)); tab.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); }); };
  page = await browser.newPage({ viewport: { width: 960, height: 650 }, deviceScaleFactor: 1 }); observe(page);
  await page.goto(app.url + '/timeline/'); await page.waitForFunction(() => globalThis.cosmicTimeline?.receipt?.ready, undefined, { timeout: 45000 });
  const footer = await page.locator('#controls').boundingBox();
  await page.setViewportSize({ width: 960, height: 540 + Math.ceil(footer.height) });
  await page.waitForFunction(() => document.querySelector('#scene').width === 960 && document.querySelector('#scene').height === 540);
  const capture = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 }); observe(capture);
  let captureEvaluations = 0;
  capture.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) captureEvaluations++; });
  await capture.goto(app.url + '/timeline/?capture=1'); await capture.waitForFunction(() => !!globalThis.cosmicTimeline);
  assert.equal(await capture.locator('#controls').isVisible(), false);
  const info = () => page.evaluate(() => {
    const frame = cosmicTimeline.frame;
    return { time: frame.presentationTime, physical: frame.physicalTime.value, graph: frame.configuration.graphHash,
      boundaries: frame.configuration.boundaries.map(boundary => boundary.id), camera: frame.snapshot.scene.nodes.find(item => item.id === frame.cameraId),
      samples: frame.results.map(result => [result.producer.nodeId, result.producer.port, result.value]),
      overlays: frame.snapshot.overlays.map(view => [view.id, view.hidden, view.emphasized]), caption: document.querySelector('#annotations').textContent,
      readout: document.querySelector('.measurement').textContent };
  });
  const sample = async (time, name) => {
    await page.evaluate(t => cosmicTimeline.seek(t), time);
    const frame = await page.evaluate(() => cosmicTimeline.frame);
    const response = await fetch(app.url + '/api/timeline/frame', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time, snapshotId: manifest.integrity.sha256 }) });
    const envelope = await response.json(); assert.equal(envelope.ok, true, envelope.error?.message);
    const deliveryFrame = envelope.result;
    assert.deepEqual(deliveryFrame.configuration, frame.configuration);
    assert.deepEqual(deliveryFrame.snapshot.scene.nodes, frame.snapshot.scene.nodes);
    assert.deepEqual(deliveryFrame.annotations, frame.annotations);
    assert.deepEqual(deliveryFrame.results.map(result => [result.producer, result.value]), frame.results.map(result => [result.producer, result.value]));
    const receipt = await capture.evaluate(value => cosmicTimeline.present(value), deliveryFrame);
    assert.deepEqual(receipt, await page.evaluate(() => cosmicTimeline.receipt));
    assert.equal(receipt.width, 960); assert.equal(receipt.height, 540);
    assert.deepEqual(await capture.locator('#clocks').innerText(), await page.locator('#clocks').innerText());
    assert.deepEqual(await capture.locator('#panels').innerText(), await page.locator('#panels').innerText());
    const screenshot = await capture.screenshot({ path: output + name + '.png' });
    const interactive = await page.locator('#stage').screenshot();
    const raster = await capture.evaluate(async ([left, right]) => {
      async function pixels(encoded) {
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
        context.drawImage(bitmap, 0, 0); bitmap.close(); return context.getImageData(0, 0, context.canvas.width, context.canvas.height);
      }
      const [a, b] = await Promise.all([pixels(left), pixels(right)]);
      if (a.width !== b.width || a.height !== b.height) throw new Error('Screenshot sizes differ.');
      let changed = 0, delta = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        const r = Math.abs(a.data[i] - b.data[i]), g = Math.abs(a.data[i + 1] - b.data[i + 1]), bDelta = Math.abs(a.data[i + 2] - b.data[i + 2]);
        if (Math.max(r, g, bDelta) > 0) changed++;
        delta += r + g + bDelta;
      }
      return { changedPixels: changed, fraction: changed / (a.width * a.height), meanChannelDelta: delta / (a.width * a.height * 3) };
    }, [interactive.toString('base64'), screenshot.toString('base64')]);
    // This is a visual QA threshold for two contexts of this installed browser.
    // Numerical agreement is checked independently above; GPU bytes can vary.
    assert.ok(raster.fraction < 0.01 && raster.meanChannelDelta < 0.5, JSON.stringify(raster));
    report.frames.push({ time, physical: receipt.physicalTime.value, configuration: receipt.configurationHash, image: name + '.png', raster, renderer: receipt.renderer.device });
    return info();
  };
  const start = await sample(0, 'opening');
  const prior = await sample(3.5, 'before-comparison'), after = await sample(4, 'after-comparison');
  assert.equal(prior.physical, 4); assert.equal(after.physical, 4); assert.notEqual(prior.graph, after.graph);
  assert.deepEqual(after.boundaries, ['comparison-b']); assert.notDeepEqual(prior.samples, after.samples);
  assert.equal(await page.locator('#configuration').textContent(), 'B · three faster points');
  assert.equal(await page.locator('[data-id="mean-plot"]').getAttribute('data-emphasized'), 'true');
  report.checks.push('A held physical time shows the authored graph change, new computed measurement, emphasis and named configuration.');
  const cameraA = await sample(4.5, 'camera-during-hold'), cameraB = await sample(5, 'camera-end');
  assert.equal(cameraA.physical, cameraB.physical); assert.equal(cameraA.graph, cameraB.graph);
  assert.notDeepEqual(cameraA.camera.position, cameraB.camera.position); assert.deepEqual(cameraA.samples, cameraB.samples);
  assert.equal(await page.locator('[data-id="mean-plot"]').getAttribute('data-emphasized'), 'false');
  assert.ok(cameraA.samples.some(([id]) => id === 'seeded-walk')); assert.ok(cameraA.samples.some(([id]) => id === 'scalar-field'));
  const finish = await sample(8, 'ending'); assert.equal(finish.physical, 1); assert.equal(finish.graph, after.graph);
  await page.locator('#exact-time').fill('0'); await page.locator('#go').click(); await page.waitForFunction(() => cosmicTimeline.receipt.presentationTime === 0);
  assert.deepEqual(await info(), start);
  await page.locator('#next').click(); await page.waitForFunction(() => cosmicTimeline.receipt.presentationTime === 0.25);
  await page.locator('#previous').click(); await page.waitForFunction(() => cosmicTimeline.receipt.presentationTime === 0);
  // Pause while the first display sample is still scheduled.
  await page.evaluate(() => { document.querySelector('#play').click(); document.querySelector('#play').click(); });
  assert.equal(await page.locator('#play').getAttribute('aria-label'), 'Play timeline');
  const burst = await page.evaluate(() => Promise.allSettled([2.75, 7, 2.25, 1.5, 3.6].map(time => cosmicTimeline.seek(time)))
    .then(outcomes => outcomes.map(result => result.status === 'fulfilled' ? result.value.presentationTime : result.reason.code)));
  assert.deepEqual(burst, ['SUPERSEDED', 'SUPERSEDED', 'SUPERSEDED', 'SUPERSEDED', 3.6]);
  const played = [];
  await page.route('**/api/timeline/frame', async route => {
    played.push(route.request().postDataJSON().time);
    await new Promise(resolve => setTimeout(resolve, 350)); await route.continue().catch(() => {});
  });
  await page.locator('#play').click(); await page.waitForFunction(() => cosmicTimeline.receipt.presentationTime > 4);
  // On a loaded host, the first completed frame after 4 s can be the
  // endpoint. A second unconditional click would start the next playback.
  await page.evaluate(() => { const button = document.querySelector('#play'); if (button.getAttribute('aria-label') === 'Pause timeline') button.click(); });
  assert.ok(played.includes(4), 'Slow preview must present the exact configuration boundary.');
  assert.equal(await page.locator('#play').getAttribute('aria-label'), 'Play timeline');
  await page.unrouteAll({ behavior: 'wait' });
  await page.evaluate(() => cosmicTimeline.seek(7.7));
  await page.locator('#play').click(); await page.waitForFunction(() => document.querySelector('#status').textContent === 'End of timeline');
  assert.equal(await page.evaluate(() => cosmicTimeline.receipt.presentationTime), 8);
  report.checks.push('Monotonic preview coalesces late samples, includes the exact 4-second configuration boundary under a delayed read, and stops on the exact endpoint.');
  assert.equal(captureEvaluations, 0);
  report.checks.push('Camera motion and panel emphasis leave full scientific Values unchanged. Backward seeking restores the initial seeded and field samples; exact seek, step and play/pause work.');
  report.checks.push('Six 960×540 interactive and capture stages share exact numerical receipts and pass the same-device raster comparison. The capture page makes no timeline requests.');
  await page.screenshot({ path: output + 'interactive-controls.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => cosmicTimeline.seek(4));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const portrait = await page.evaluate(() => ({ ...cosmicTimeline.receipt.renderer, stageHeight: cosmicTimeline.receipt.height }));
  assert.ok(portrait.glHeight < portrait.stageHeight && portrait.glWidth / portrait.glHeight > 1.7, 'Tall stages preserve the wide authored view.');
  await page.screenshot({ path: output + 'narrow.png' });
  assert.deepEqual(report.errors, []); console.log(JSON.stringify(report, null, 2));
} catch (error) { report.failure = error.message; await page?.screenshot({ path: output + 'failure.png' }).catch(() => {}); throw error; }
finally { await writeFile(output + 'report.json', JSON.stringify(report, null, 2) + '\n'); await browser?.close(); await app.close(); }
