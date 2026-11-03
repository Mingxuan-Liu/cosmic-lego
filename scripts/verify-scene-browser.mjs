// Optional browser acceptance harness. Supply an installed Playwright module and
// browser through COSMIC_LEGO_PLAYWRIGHT / COSMIC_LEGO_CHROME when not on PATH.
// Artifacts stay in ignored .local/; this never edits a user's saved project.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startSceneServer } from './scene-server.mjs';

const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
const output = fileURLToPath(new URL('../.local/f05-qa/', import.meta.url));
await mkdir(output, { recursive: true });
const app = await startSceneServer({ port: 0 });
let browser;
const report = { checks: [], browser: '', errors: [], artifacts: output };
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}),
    args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = browser.version(); report.graphics = 'WebGL2 / SwiftShader';
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(app.url);
  const ready = () => page.waitForFunction(() => sceneLab.snapshot?.valid && document.querySelector('#status').textContent.endsWith('ready'));
  await ready();
  const science = () => page.evaluate(() => JSON.stringify(sceneLab.results.map(result => result.value)));
  const camera = () => page.evaluate(() => sceneLab.adapter.getCameraState());
  const stats = () => page.evaluate(() => sceneLab.adapter.stats());
  const shot = name => page.screenshot({ path: `${output}${name}.png` });
  report.initial = await stats();
  await shot('initial');
  assert.equal(await page.locator('#diagnostics').isVisible(), false);
  report.checks.push('Generic fixture renders without browser errors');

  const hit = await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.js');
    const state = sceneLab.adapter.getCameraState(), canvas = document.querySelector('#scene');
    const camera = new THREE.PerspectiveCamera(state.fov, canvas.clientWidth / canvas.clientHeight, state.near, state.far);
    camera.position.fromArray(state.position); camera.lookAt(...state.target); camera.updateMatrixWorld();
    const node = sceneLab.snapshot.nodes.find(node => node.id === 'moving-points');
    const point = new THREE.Vector3(...node.positions[0]).project(camera);
    const x = (point.x + 1) / 2 * canvas.clientWidth, y = (1 - point.y) / 2 * canvas.clientHeight;
    return { x, y, pick: sceneLab.adapter.pick(x, y), objectId: node.objectIds[0] };
  });
  assert.equal(hit.pick.nodeId, 'moving-points'); assert.equal(hit.pick.objectId, hit.objectId);
  await page.mouse.click(hit.x, hit.y);
  assert.match(await page.locator('#selection-text').textContent(), new RegExp(hit.objectId));
  await page.locator('#time').fill('2'); await page.locator('#time').dispatchEvent('input');
  await page.waitForFunction(() => sceneLab.snapshot?.time.value === 2 && document.querySelector('#status').textContent.endsWith('ready'));
  assert.match(await page.locator('#selection-text').textContent(), new RegExp(hit.objectId));
  report.checks.push('Pointer picking retains stable source ID as physical time advances');
  const numerical = await science();
  const before = await camera();
  await page.mouse.move(900, 710); await page.mouse.down(); await page.mouse.move(1030, 755, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(500);
  assert.notDeepEqual((await camera()).position, before.position);
  const orbited = await camera();
  await page.mouse.move(900, 710); await page.mouse.down({ button: 'right' }); await page.mouse.move(960, 680, { steps: 12 }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  assert.notDeepEqual((await camera()).target, orbited.target);
  const panned = await camera();
  await page.mouse.wheel(0, -250); await page.waitForTimeout(500);
  assert.notDeepEqual((await camera()).position, panned.position);
  assert.equal(await science(), numerical);
  await shot('navigated');
  await page.locator('#reset-camera').click();
  const reset = await camera();
  assert.ok(Math.abs(reset.position[0] - before.position[0]) < 1e-9);
  report.checks.push('Orbit, pan, zoom and reset preserve numerical snapshots');

  await page.locator('#inspector > summary').click();
  await page.locator('#objects').selectOption('moving-points');
  const original = await stats();
  const initialIds = await page.evaluate(() => sceneLab.snapshot.nodes.map(node => node.id));
  await page.locator('#duplicate').click();
  await page.waitForFunction(count => sceneLab.snapshot.nodes.length === count + 1, initialIds.length);
  await ready();
  const duplicate = await page.evaluate(ids => sceneLab.snapshot.nodes.find(node => !ids.includes(node.id)).id, initialIds);
  assert.equal((await stats()).geometries, original.geometries);
  assert.equal((await stats()).materials, original.materials);
  assert.equal(await science(), numerical);
  await page.locator('#objects').selectOption(duplicate); await page.locator('#remove').click();
  await page.waitForFunction(count => sceneLab.snapshot.nodes.length === count, initialIds.length); await ready();
  assert.equal((await stats()).geometries, original.geometries);
  assert.equal((await stats()).objects, original.objects);
  assert.ok((await stats()).disposedInstances > original.disposedInstances);
  report.checks.push('Duplicate shares resources; removal releases instances while originals survive');
  await page.locator('#marker-size').fill('0.18'); await page.locator('#marker-size').dispatchEvent('change');
  await page.waitForFunction(() => sceneLab.snapshot.assets.some(asset => asset.id === 'shared-sphere' && asset.data.radius === 0.18)); await ready();
  assert.equal(await science(), numerical);
  assert.ok((await stats()).disposedGeometries > original.disposedGeometries);
  report.checks.push('Shared asset replacement disposes old geometry and preserves science');

  await page.locator('#projection').selectOption('orthographic');
  await page.waitForFunction(() => sceneLab.adapter.getCameraState().projection === 'orthographic'); await ready();
  assert.equal(await science(), numerical);
  await page.evaluate(() => Promise.all([
    sceneLab.edit('projection', undefined, 'perspective'),
    sceneLab.edit('marker-scale', undefined, 0.15),
    sceneLab.edit('projection', undefined, 'orthographic'),
  ]));
  assert.equal(await page.locator('#projection').inputValue(), 'orthographic');
  assert.equal(await page.locator('#marker-size').inputValue(), '0.15');
  assert.equal(await science(), numerical);
  await page.reload(); await ready();
  assert.equal(await page.locator('#projection').inputValue(), 'orthographic');
  assert.equal(await page.locator('#marker-size').inputValue(), '0.15');
  assert.equal((await camera()).projection, 'orthographic');
  await page.locator('#time').fill('2'); await page.locator('#time').dispatchEvent('input');
  await page.waitForFunction(() => sceneLab.snapshot.time.value === 2 && document.querySelector('#status').textContent.endsWith('ready'));
  assert.equal(await science(), numerical);
  report.checks.push('Rapid edits serialize successfully and controls restore authoritative values after reload');
  await page.locator('#inspector > summary').click();
  await page.locator('#objects').selectOption('field-points');
  assert.match(await page.locator('#binding-info').textContent(), /temperature.*K/s);
  await shot('orthographic-inspector');
  await page.locator('#inspector > summary').click();
  await page.locator('#frame-all').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('#scene').width === 390);
  await page.locator('#frame-all').click(); await page.waitForTimeout(200);
  const dimensions = await page.evaluate(() => ({ width: scene.width, height: scene.height, scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.equal(dimensions.width, 390); assert.equal(dimensions.height, 844); assert.equal(dimensions.scroll, dimensions.viewport);
  await shot('narrow');
  report.checks.push('Orthographic projection, inspectable mapping, resize and fit at 390px');
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Controlled renderer fixture: two opaque boxes precisely aligned with a
  // camera ray. It exercises GPU depth and picking independently of the demo.
  const depth = await page.evaluate(() => {
    const snapshot = structuredClone(sceneLab.snapshot);
    snapshot.identity.generation += 100;
    snapshot.nodes = snapshot.nodes.filter(node => ['scene-root', 'camera', 'front-block', 'rear-block'].includes(node.id));
    Object.assign(snapshot.nodes.find(node => node.id === 'camera'), { projection: 'orthographic', position: [0, 0, 10], target: [0, 0, 0], span: 4 });
    snapshot.nodes.find(node => node.id === 'front-block').position = [0, 0, 1];
    snapshot.nodes.find(node => node.id === 'rear-block').position = [0, 0, -1];
    const applied = sceneLab.adapter.apply(snapshot); sceneLab.adapter.render();
    const gl = document.querySelector('#scene').getContext('webgl2'), pixel = new Uint8Array(4);
    gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    globalThis.depthFixture = snapshot;
    return { applied, pick: sceneLab.adapter.pick(innerWidth / 2, innerHeight / 2), pixel: [...pixel] };
  });
  assert.equal(depth.applied.valid, true); assert.equal(depth.pick.nodeId, 'front-block'); assert.ok(depth.pixel[0] > depth.pixel[2]);
  await shot('occlusion-front');
  const revealed = await page.evaluate(() => {
    depthFixture.nodes = depthFixture.nodes.filter(node => node.id !== 'front-block');
    const applied = sceneLab.adapter.apply(depthFixture); sceneLab.adapter.render();
    const gl = document.querySelector('#scene').getContext('webgl2'), pixel = new Uint8Array(4);
    gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return { applied, pick: sceneLab.adapter.pick(innerWidth / 2, innerHeight / 2), pixel: [...pixel] };
  });
  assert.equal(revealed.applied.valid, true); assert.equal(revealed.pick.nodeId, 'rear-block'); assert.ok(revealed.pixel[2] > revealed.pixel[0]);
  await shot('occlusion-rear');
  report.depth = { front: depth.pixel, rear: revealed.pixel };
  report.checks.push('GPU depth occludes rear mesh; removing foreground reveals and picks rear mesh');
  const bad = await page.evaluate(() => {
    const snapshot = structuredClone(depthFixture);
    snapshot.nodes.find(node => node.id === 'rear-block').geometry = 'unavailable';
    return sceneLab.adapter.apply(snapshot);
  });
  assert.equal(bad.valid, false); assert.equal(bad.diagnostics[0].code, 'MISSING_ASSET');
  assert.equal(await page.locator('#diagnostics').isVisible(), true);
  await shot('missing-asset');
  await page.evaluate(() => sceneLab.refresh()); await ready();
  assert.equal(await page.locator('#diagnostics').isVisible(), false);
  report.checks.push('Missing asset produces a visible diagnostic and retains the previous valid scene');
  report.final = await stats();
  report.disposed = await page.evaluate(() => { sceneLab.adapter.dispose(); return sceneLab.adapter.stats(); });
  for (const key of ['geometries', 'materials', 'textures', 'objects', 'instances', 'resourceReferences']) assert.equal(report.disposed[key], 0, key);
  report.checks.push('Renderer disposal releases all owned resources');
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile(`${output}report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); await app.close();
}
console.log(JSON.stringify(report, null, 2));
