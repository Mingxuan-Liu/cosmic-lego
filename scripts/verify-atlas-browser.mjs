// Optional acceptance check with a fresh product host, project store and browser profile.
// COSMIC_LEGO_PLAYWRIGHT and COSMIC_LEGO_CHROME may point to an existing local install.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startExoplanetServer } from '../apps/exoplanet.mjs';
import { roadmap } from '../packages/atlas/roadmap.mjs';
import { diagramFor, roadmapGraph } from '../packages/atlas/roadmap-assets.mjs';
import { foundationFor } from '../packages/atlas/foundations.mjs';
import { locateStars } from '../demo/atlas/layout.js';
import { createFlatCamera, createOrbitCamera } from '../demo/atlas/orbit.js';

const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
const output = fileURLToPath(new URL('../.local/atlas-qa/', import.meta.url));
await mkdir(output, { recursive: true });
const projectDirectory = await mkdtemp(join(tmpdir(), 'cosmic-atlas-check-'));
const report = { checks: [], errors: [], screenshots: [], openingViews: [] };
let app, browser;
async function check(label, run) {
  await run();
  report.checks.push(label);
}
const ready = page => page.waitForFunction(() => /\d+ of \d+ domains/i.test(document.querySelector('#result-count')?.textContent));
async function shot(page, file, fullPage = false) {
  await page.screenshot({ path: join(output, file), fullPage });
  report.screenshots.push(file);
}
async function observe(page) {
  // Inspect the painted frame after labels have been decluttered. Canvas text
  // bounds and strokes are unavailable in the DOM accessibility tree.
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    for (const method of ['setTransform','arc','fillText','stroke']) {
      const original = proto[method];
      proto[method] = function (...args) {
        if (this.canvas.id === 'atlas-canvas') {
          if (method === 'setTransform') this.canvas.mapFrame = { stars: [], labels: [], dashed: 0 };
          const frame = this.canvas.mapFrame;
          if (frame && method === 'arc') frame.stars.push({ x: args[0], y: args[1] });
          if (frame && method === 'fillText') {
            const [name,x,y] = args, bounds = this.measureText(name);
            frame.labels.push({ name, left: x-bounds.actualBoundingBoxLeft, top: y-bounds.actualBoundingBoxAscent,
              right: x+bounds.actualBoundingBoxRight, bottom: y+bounds.actualBoundingBoxDescent });
          }
          if (frame && method === 'stroke' && this.getLineDash().length) frame.dashed++;
        }
        return original.apply(this,args);
      };
    }
  });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text() + ' ' + message.location().url);
  });
}
async function checkOpeningCluster(page, minLabels) {
  const canvas = page.locator('#atlas-canvas');
  await page.waitForFunction(() => document.querySelector('#atlas-canvas')?.mapFrame?.stars.length);
  const { width,height,stars,labels,dashed } = await canvas.evaluate(el =>
    ({ width: el.clientWidth, height: el.clientHeight, ...el.mapFrame }));
  assert.equal(stars.length,roadmap.domains.length,'Every domain should have a visible star at fit.');
  for (const {x,y} of stars) assert.ok(x >= 0 && x <= width && y >= 0 && y <= height,'Star outside the canvas.');
  const span = axis => Math.max(...stars.map(p=>p[axis])) - Math.min(...stars.map(p=>p[axis]));
  assert.ok(span('x') > 0.65*width && span('y') > 0.65*height,
    'Star centers should span at least 65% of each canvas dimension.');
  const names = new Set(roadmap.domains.map(n=>n.label));
  const shown = labels.filter(r=>names.has(r.name));
  report.openingViews.push({ viewport: page.viewportSize(), stars: stars.length, labeled: shown.length,
    widthShare: span('x')/width, heightShare: span('y')/height });
  assert.ok(shown.length >= minLabels,'Only '+shown.length+' topic names were drawn.');
  for (const [i,r] of shown.entries()) {
    assert.ok(r.left >= 0 && r.top >= 0 && r.right <= width && r.bottom <= height,r.name+' was clipped.');
    for (const s of shown.slice(i+1)) {
      assert.ok(r.right <= s.left || s.right <= r.left || r.bottom <= s.top || s.bottom <= r.top,
        r.name+' overlaps '+s.name);
    }
  }
  assert.equal(dashed,roadmapGraph(roadmap.domains).edges.length,'Each opening connection should be dashed.');
  assert.equal(await page.locator('.diagram-key').evaluate(el=>getComputedStyle(el,'::before').borderTopStyle),'dashed');
}
const activeId = page => page.evaluate(() => document.activeElement.id);
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
// Compare only the scene pixels. Focus outlines and pointers live outside the bitmap.
const frameImage = canvas => canvas.evaluate(async el => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return el.toDataURL();
});
const corePositions = (canvas, count) => canvas.evaluate(async (el, count) => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const { width, height } = el;
  const pixels = el.getContext('2d').getImageData(0, 0, width, height).data;
  const centers = [];
  for (let i = 0; i < count; i++) {
    let peak = 0, point;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const off = 4 * (y * width + x);
      const brightness = pixels[off] + pixels[off + 1] + pixels[off + 2];
      if (brightness <= peak || centers.some(c => Math.hypot(c.x - x, c.y - y) < 18)) continue;
      peak = brightness; point = { x, y };
    }
    centers.push(point);
  }
  return centers.map(p => ({ x: p.x * el.clientWidth / width, y: p.y * el.clientHeight / height }));
}, count);
// Sample the same small patches throughout a camera pose. Comparing to an empty
// field at those coordinates distinguishes a translucent star from a dark sky.
const coreLight = (canvas, points) => canvas.evaluate(async (el, points) => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const ctx = el.getContext('2d');
  return points.map(point => {
    const x = Math.round(point.x * el.width / el.clientWidth), y = Math.round(point.y * el.height / el.clientHeight);
    const rgba = ctx.getImageData(x-2, y-2, 5, 5).data;
    let brightest = 0;
    for (let i=0; i<rgba.length; i+=4) brightest = Math.max(brightest, rgba[i]+rgba[i+1]+rgba[i+2]);
    return brightest;
  });
}, points);
const resetSearch = async page => {
  await page.locator('#query').fill('');
  await page.locator('#category').selectOption('');
  await page.locator('#availability').selectOption('');
};
try {
  app = await startExoplanetServer({ port: 0, projectDirectory });
  browser = await chromium.launch({ headless: true,
    ...(process.env.COSMIC_LEGO_CHROME ? { executablePath: process.env.COSMIC_LEGO_CHROME } : {}),
    args: ['--disable-gpu', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  report.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  await observe(page);
  await page.goto(app.url + '/');
  await ready(page);
  const canvas = page.locator('#atlas-canvas');
  const rows = page.locator('#table-body tr');
  const count = () => page.locator('#result-count').textContent();

  await check('The roadmap opens in 3D with a spread-out, labeled cluster and dashed shared-diagram connections.', async () => {
    assert.equal(await page.title(), 'Astronomy roadmap · Cosmic Lego');
    assert.equal(await page.locator('#plan-mode').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#graph-mode').getAttribute('aria-pressed'), 'true');
    assert.ok(await page.locator('.orbit-controls').isVisible());
    await checkOpeningCluster(page,27);
    assert.ok(await canvas.isVisible());
    assert.equal(await page.locator('#level').inputValue(), 'domain');
    assert.ok(await page.locator('#category option').count() > 2);
    assert.ok(await page.locator('#availability option[value="available"]').count());
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.skip').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Enter');
    assert.equal(await activeId(page), 'query');
    await page.locator('#method summary').click();
    assert.match(await page.locator('#method-source').getAttribute('href'), /^https:\/\/assets\.cambridge\.org\/.*\.pdf$/);
    assert.match(await page.locator('#method-rank').textContent(), /explain|build|support|lead/i);
    assert.match(await page.locator('.rank-key').innerText(), /explain more topics/i);
    assert.equal(await page.locator('.diagram-key').innerText(), 'Shared diagram');
    assert.doesNotMatch(await page.locator('.chart-key').innerText(), /demonstrated|proposed|reference coverage|reuse/i);
    await page.locator('#method summary').click();
    await shot(page, 'acceptance-desktop.png');
  });
  await check('Flat and orbital cameras pan, zoom and switch independently, and Table preserves the active projection.', async () => {
    const box = await canvas.boundingBox();
    const x = box.x + 30, y = box.y + 45;
    await page.locator('#plan-mode').click();
    const flatHome = await frameImage(canvas);
    assert.ok(await canvas.evaluate(el=>el.mapFrame.dashed) >= roadmapGraph(roadmap.domains).edges.length,
      'Shared diagrams should use dashes in the flat view too.');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y + 45, {steps: 6}); await page.mouse.up();
    await page.mouse.move(3,3);
    const panned = await frameImage(canvas);
    assert.ok(panned !== flatHome,'A drag should pan the flat map.');
    assert.ok(await page.locator('#detail').isHidden());
    await page.locator('#zoom-in').click();
    const flatZoom = await frameImage(canvas);
    assert.equal(await page.locator('#zoom-level').textContent(),'125%');
    await page.locator('#graph-mode').click();
    assert.ok(await page.locator('.orbit-controls').isVisible());
    assert.equal(await page.locator('#zoom-level').textContent(),'100%');
    const clusterHome = await frameImage(canvas);
    assert.ok(clusterHome !== flatHome,'The 3D view should differ from the flat overview.');
    await page.locator('#orbit-left').click();
    const rotated = await frameImage(canvas);
    await page.locator('#table-mode').click();
    assert.ok(await page.locator('#atlas-table').isVisible());
    await page.locator('#graph-mode').click();
    assert.ok(await frameImage(canvas) === rotated,'Opening the table should preserve the orbit.');
    await page.locator('#plan-mode').click();
    assert.equal(await page.locator('#zoom-level').textContent(),'125%');
    assert.ok(await frameImage(canvas) === flatZoom,'Switching projections should preserve the flat camera.');
    await page.locator('#fit').click();
    assert.ok(await frameImage(canvas) === flatHome,'Fit should restore the original flat view.');
    await page.locator('#graph-mode').click();
    await page.locator('#fit').click();
    assert.ok(await frameImage(canvas) === clusterHome,'Fit should restore the original 3D view.');
  });
  await check('Wheel, keyboard and camera controls zoom and reset the 3D view.', async () => {
    await canvas.hover();
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(() => parseInt(document.querySelector('#zoom-level').textContent) > 100);
    await canvas.focus();
    await page.keyboard.press('Home');
    assert.equal(await page.locator('#zoom-level').textContent(), '100%');
    await page.keyboard.press('=');
    assert.equal(await page.locator('#zoom-level').textContent(), '125%');
    await page.locator('#zoom-out').click();
    assert.equal(await page.locator('#zoom-level').textContent(), '100%');
  });
  await check('Dragging orbits, modified drags pan, and the controls and keyboard navigate the camera.', async () => {
    const box = await canvas.boundingBox();
    const x = box.x + box.width / 3, y = box.y + box.height / 3;
    await page.locator('#fit').click();
    const home = await frameImage(canvas);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 150, y + 40, { steps: 6 });
    await page.mouse.up();
    await page.mouse.move(3, 3);
    const orbited = await frameImage(canvas);
    assert.ok(orbited !== home, 'Orbit drag changes the cluster view.');
    assert.ok(await page.locator('#detail').isHidden(), 'Orbiting must not select a star.');
    await shot(page, 'acceptance-orbited.png');
    await page.locator('#fit').click();
    assert.ok(await frameImage(canvas) === home, 'Fit restores the opening orientation and projection.');
    await page.mouse.move(x, y);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(x + 150, y + 40, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.mouse.move(3, 3);
    const panned = await frameImage(canvas);
    assert.ok(panned !== home, 'Modified drag shifts the camera.');
    assert.ok(panned !== orbited, 'Pan and orbit produce different perspectives on the same drag.');
    await page.locator('#fit').click();
    for (const direction of ['right','left','up','down']) {
      await page.getByRole('button', { name: 'Orbit '+direction, exact: true }).click();
      assert.ok(await frameImage(canvas) !== home, 'Visible orbit control changes the view.');
      await page.locator('#fit').click();
    }
    await canvas.focus();
    for (const key of ['w','Shift+d']) {
      await page.keyboard.press(key);
      assert.ok(await frameImage(canvas) !== home, 'Keyboard navigation changes the camera.');
      await page.keyboard.press('Home');
      assert.ok(await frameImage(canvas) === home);
    }
  });
  await check('Higher-ranked domains stay closer to the 3D center while peripheral topics move during orbit.', async () => {
    const byRank = [...roadmap.domains].sort((a,b) => foundationFor(a.id).rank - foundationFor(b.id).rank);
    for (const topic of [byRank[0],byRank.at(-1)]) {
      await page.locator('#query').fill(topic.label);
      await page.locator('#fit').click();
      assert.match(await count(),/^1 of /,'The probe needs a single highlighted star for '+topic.label);
      const [before] = await corePositions(canvas,1);
      for (let i=0;i<6;i++) await page.locator('#orbit-left').click();
      const [after] = await corePositions(canvas,1);
      const motion = Math.hypot(after.x-before.x,after.y-before.y);
      if (foundationFor(topic.id).rank === 1) assert.ok(motion < 3,'Mass center moved '+motion+' px');
      else assert.ok(motion > 10,'Peripheral star moved only '+motion+' px');
    }
    await page.locator('#fit').click(); await page.locator('#query').fill('');
  });
  await check('Keyboard star selection, accessible field notes, and return focus.', async () => {
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    const announcement = await page.locator('#graph-panel [aria-live]').textContent();
    await page.keyboard.press('Enter');
    const name = await page.locator('#detail-title').textContent();
    assert.ok(name && announcement.includes(name));
    assert.equal(await activeId(page), 'detail-title');
    assert.match(await page.locator('#detail-summary').textContent(), /\?/);
    const foundation = foundationFor(roadmap.domains.find(n=>n.label===name).id);
    await page.locator('.score-note summary').click();
    const explanation = await page.locator('.score-note').innerText();
    assert.ok(explanation.includes(String(foundation.directIds.length)));
    assert.match(explanation,/direct|explain|build/i);
    if (foundation.examples.length) {
      const exampleLabel = roadmap.phenomena.find(n=>n.id===foundation.examples[0].to).label;
      assert.ok(explanation.includes(exampleLabel));
    }
    await page.keyboard.press('Escape');
    assert.equal(await activeId(page), 'atlas-canvas');
  });
  await check('A domain opens its phenomena, preserves selection across all views, and distinguishes questions and study status.', async () => {
    await page.locator('#table-mode').click();
    assert.ok(await rows.count() >= 15);
    await page.locator('[data-topic-id="exoplanets"]').click();
    assert.match(await page.locator('#detail-summary').textContent(), /\?/);
    await page.locator('#explore-domain').click();
    assert.equal(await page.locator('#level').inputValue(), 'phenomenon');
    assert.ok(await page.locator('#scope-chip').isVisible());
    await page.locator('[data-topic-id="planetary-transits"]').click();
    assert.ok(await page.locator('.status-badge', {hasText: /available|open study/i}).count());
    assert.ok(await page.locator('.study-launch').isVisible());
    assert.match(await page.locator('#detail-summary').textContent(), /\?/);
    assert.ok((await page.locator('.phenomenon-insight').innerText()).length > 30);
    const heading = await page.locator('#detail-title').textContent();
    for (const id of ['plan-mode','graph-mode','table-mode']) {
      await page.locator('#'+id).click();
      assert.equal(await page.locator('#detail-title').textContent(),heading);
    }
    await page.locator('#detail-close').click(); await page.locator('#scope-clear').click();
    await page.locator('#query').fill('not-a-real-astronomy-topic-abcdef');
    assert.ok(await page.locator('#table-empty').isVisible());
    await page.locator('#table-empty button').click();
    assert.ok(await rows.count() > 50);
  });
  await check('The study filter separates implemented experiences from planned phenomena, and the directory sorts.', async () => {
    await page.locator('#availability').selectOption('planned');
    assert.equal(await page.locator('[data-topic-id="planetary-transits"]').count(),0);
    assert.ok(await rows.count()>10);
    await rows.first().locator('button').click();
    assert.ok(await page.locator('#detail .status-badge', {hasText: /planned/i}).isVisible());
    assert.equal(await page.locator('.study-launch').count(),0);
    await page.keyboard.press('Escape');
    const sort = page.locator('#table-head th').filter({hasText:'Foundation rank'});
    await sort.getByRole('button').click();
    const first = await rows.first().locator('button').innerText();
    await sort.getByRole('button').click();
    assert.notEqual(await rows.first().locator('button').innerText(),first);
    await page.locator('#availability').selectOption('available');
    assert.ok(await page.locator('[data-topic-id="planetary-transits"]').isVisible());
    await resetSearch(page);
  });
  await check('Students can find observing and simulation techniques by name and abbreviation in the directory.', async () => {
    await page.locator('#level').selectOption('phenomenon');
    for (const [field,query,id] of [
      ['observation','interferometry','interferometry'],
      ['observation','gravitational waves','gravitational-wave-detection'],
      ['observation','neutrino','neutrino-detection'],
      ['simulation','MHD','mhd-simulations'],
      ['simulation','N-body','n-body-simulations']
    ]) {
      await page.locator('#category').selectOption(field);
      await page.locator('#query').fill(query);
      assert.ok(await page.locator('[data-topic-id="'+id+'"]').isVisible(),query+' should find '+id);
    }
    await resetSearch(page);
  });
  await check('A student can move from each method family to a phenomenon it studies and back to the technique.', async () => {
    for (const [view,techniqueId,phenomenonId] of [
      ['graph-mode','neutrino-detection','solar-neutrinos'],
      ['plan-mode','mhd-simulations','accretion-disks']
    ]) {
      const technique = roadmap.phenomena.find(n=>n.id===techniqueId);
      const domain = roadmap.domains.find(n=>n.id===technique.parentId);
      const phenomenon = roadmap.phenomena.find(n=>n.id===phenomenonId);
      await page.locator('#level').selectOption('domain');
      await page.locator('#category').selectOption(technique.partId);
      await page.locator('#query').fill(technique.label);
      assert.match(await count(),/^1 of /);
      await page.locator('#'+view).click();
      await canvas.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#detail-title').innerText(),domain.label);
      await page.locator('[data-phenomenon-id="'+techniqueId+'"]').click();
      assert.equal(await page.locator('#detail-title').innerText(),technique.label);
      assert.match(await page.locator('#detail-type').innerText(),/technique/i);
      assert.ok(await page.locator('#detail .status-badge',{hasText:/planned/i}).isVisible());
      assert.equal(await page.locator('.study-launch').count(),0);
      assert.equal(await page.locator('[data-technique-source]').getAttribute('href'),technique.source.url);
      const reason = technique.applications.find(link=>link.id===phenomenonId).reason;
      assert.ok((await page.locator('#detail-links').innerText()).includes(reason));
      await page.locator('[data-application-id="'+phenomenonId+'"]').click();
      assert.equal(await page.locator('#detail-title').innerText(),phenomenon.label);
      assert.ok((await page.locator('#detail-links').innerText()).includes(reason));
      await page.locator('[data-technique-id="'+techniqueId+'"]').click();
      assert.equal(await page.locator('#detail-title').innerText(),technique.label);
      await page.locator('#table-mode').click();
      assert.ok(await page.locator('[data-topic-id="'+techniqueId+'"]').isVisible());
      await page.locator('#detail-close').click();
    }
    await resetSearch(page);
  });
  await check('Search spotlights matching stars while keeping the surrounding stars visible at their original positions in 2D and 3D.', async () => {
    await resetSearch(page);
    await page.locator('#level').selectOption('phenomenon');
    for (const projection of ['plan-mode','graph-mode']) {
      await page.locator('#'+projection).click();
      await page.locator('#fit').click();
      await page.locator('#query').fill('Star trails');
      assert.match(await count(),/^1 of /);
      const [match] = await corePositions(canvas,1);
      await page.locator('#query').fill('');
      const peers = (await corePositions(canvas,14)).filter(p=>Math.hypot(p.x-match.x,p.y-match.y)>18);
      const points = [match,...peers];
      const normal = await coreLight(canvas,points);
      await page.locator('#query').fill('Star trails');
      const search = await coreLight(canvas,points);
      assert.ok(search[0] >= 0.90*normal[0], 'Matching core should stay bright in its original position.');
      await canvas.click({position:match});
      assert.equal(await page.locator('#detail-title').textContent(),'Star trails');
      await page.locator('#detail-close').click();

      await page.locator('#query').fill('qzv-no-such-phenomenon');
      assert.match(await count(),/^0 of /);
      assert.ok(await page.locator('#graph-empty').isVisible());
      const dimmed = await coreLight(canvas,points);
      await canvas.focus();
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
      assert.ok(await page.locator('#detail').isHidden(),'Keyboard browsing should skip nonmatches.');
      await page.locator('#category').selectOption('part-1');
      await page.locator('#graph-empty button').click();
      assert.equal(await page.locator('#query').inputValue(),'');
      assert.equal(await page.locator('#category').inputValue(),'part-1','Clearing a query should preserve the chosen field.');
      await page.locator('#query').fill('qzv-no-such-phenomenon');
      await page.locator('#availability').selectOption('available');
      const sky = await coreLight(canvas,points);
      const retained = peers.filter((_,i) => {
        const k = i+1;
        return search[k] < 0.6*normal[k] && search[k] > sky[k]+18 &&
          dimmed[k] < 0.6*normal[k] && dimmed[k] > sky[k]+18;
      });
      assert.ok(retained.length >= peers.length*0.7,
        'Most sampled nonmatches should be fainter than the original core, yet brighter than empty sky: '+retained.length+'/'+peers.length);
      await page.locator('#table-mode').click();
      await page.locator('#category').selectOption('');
      await page.locator('#availability').selectOption('');
      assert.equal(await rows.count(),0,'A zero-match search should have no table rows.');
      await page.locator('#query').fill('Star trails');
      assert.equal(await rows.count(),1);
      await page.locator('#query').fill('');
    }
  });
  await check('A star and its shared diagram can be selected in the flat overview and after rotating the cluster.', async () => {
    await page.locator('#level').selectOption('phenomenon');
    // The moving lines of a spectroscopic binary use the same line-profile
    // diagram as an absorption spectrum. Select both via the diagram name.
    const stars = locateStars(roadmap.phenomena.map(n=>({...n,...foundationFor(n.id)})));
    const pair = stars.filter(n=>['doppler-pairs','absorption-lines'].includes(n.id));
    await page.locator('#category').selectOption(pair[0].partId);
    await page.locator('#query').fill(diagramFor('spectral-line-profile').label);
    assert.match(await count(),/^2 of /);
    for (const id of ['plan-mode','graph-mode']) {
      await page.locator('#'+id).click();
      await page.locator('#fit').click();
      if (id==='graph-mode') {
        await page.locator('#orbit-right').click(); await page.locator('#orbit-up').click();
      }
      const camera = id === 'plan-mode' ? createFlatCamera() : createOrbitCamera();
      const box = await canvas.boundingBox();
      camera.resize(box.width,box.height);
      if (id === 'graph-mode') camera.orbit(Math.PI/12,Math.PI/12);
      const [a,b] = pair.map(n=>camera.project(n));
      await frameImage(canvas);
      await canvas.click({position:{x:(a.px+b.px)/2,y:(a.py+b.py)/2}});
      assert.match(await page.locator('#detail-type').textContent(),/connection/i);
      await page.locator('#detail-close').click();
      await canvas.click({position:{x:a.px,y:a.py}});
      assert.equal(await page.locator('#detail-title').textContent(),pair[0].label);
      await page.locator('#detail-close').click();
    }
    await page.locator('#table-mode').click(); await resetSearch(page);
  });
  await check('Following a connection shows the shared diagram and lets a student explore either idea.', async () => {
    await page.locator('[data-topic-id="planetary-transits"]').click();
    const adjacent = page.locator('#detail-links [data-peer-id]');
    assert.ok(await adjacent.count() > 0);
    const peer = await adjacent.first().getAttribute('data-peer-id');
    await adjacent.first().click();
    assert.match(await page.locator('#detail-type').textContent(), /connection/i);
    const details = page.locator('#detail-links');
    const [edge] = roadmapGraph(roadmap.phenomena.filter(n=>n.id==='planetary-transits' || n.id===peer)).allEdges;
    const headings = await details.locator('h3').allTextContents();
    for (const id of edge.assetIds) assert.ok(headings.includes(diagramFor(id).label));
    assert.ok(await details.locator('[data-related-id="planetary-transits"]').isVisible());
    await shot(page,'acceptance-connection.png');
    await details.locator('[data-related-id="'+peer+'"]').click();
    assert.equal(await page.locator('#detail-title').textContent(),roadmap.phenomena.find(n=>n.id===peer).label);
    await page.keyboard.press('Escape');
  });
  await check('Planetary transits opens its implemented study and the return link restores the phenomenon.', async () => {
    await page.locator('[data-topic-id="planetary-transits"]').click();
    await page.locator('.study-launch').click();
    await page.waitForURL('**/studies/planetary-transits/');
    await page.locator('#roadmap-return').click();
    assert.equal(new URL(page.url()).searchParams.get('phenomenon'),'planetary-transits');
    await page.locator('.study-launch').waitFor();
    assert.match(await page.locator('#detail-title').innerText(),/transit/i);
    await page.keyboard.press('Escape');
  });
  await check('Workspace opens the real project and its brand link returns to the atlas.', async () => {
    await page.locator('#workspace-link').click();
    await page.waitForFunction(() => window.cosmicWorkspace?.snapshot?.valid && document.querySelector('#status')?.textContent.endsWith('ready'), null, { timeout: 30000 });
    assert.equal(new URL(page.url()).pathname, '/workspace/');
    await page.getByRole('link', { name: 'Cosmic Lego home' }).click();
    await ready(page);
    assert.equal(await page.locator('#graph-mode').getAttribute('aria-pressed'),'true');
  });
  await check('Phone gestures orbit, pan and pinch, and table, filters and notes fit the viewport.', async () => {
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await observe(phone);
    await phone.goto(app.url + '/atlas/'); await ready(phone);
    assert.ok(await fits(phone));
    await phone.locator('.for-cluster .touch-hint').waitFor({ state: 'visible' });
    await checkOpeningCluster(phone,15);
    await shot(phone, 'acceptance-phone.png');
    const phoneCanvas = phone.locator('#atlas-canvas');
    const box = await phoneCanvas.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const client = await phone.context().newCDPSession(phone);
    const gesture = async (from, to) => {
      const touchPoints = points => points.map(([x,y], id) => ({ x, y, id: id + 1 }));
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoints(from) });
      for (let step = 1; step <= 4; step++) {
        const intermediate = from.map(([x,y], i) => [x+(to[i][0]-x)*step/4, y+(to[i][1]-y)*step/4]);
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoints(intermediate) });
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await phone.locator('#plan-mode').tap();
    await phone.locator('.for-flat .touch-hint').waitFor({state:'visible'});
    const flat = await frameImage(phoneCanvas);
    await gesture([[cx,cy]],[[cx+42,cy+28]]);
    assert.ok(await frameImage(phoneCanvas) !== flat,'One finger pans the flat view.');
    await phone.locator('#fit').tap();
    assert.ok(await frameImage(phoneCanvas) === flat,'Fit restores the opening flat view.');
    await phone.locator('#graph-mode').tap();
    await phone.locator('.for-cluster .touch-hint').waitFor({state:'visible'});
    const home = await frameImage(phoneCanvas);
    await gesture([[cx,cy]], [[cx+58,cy-40]]);
    assert.ok(await frameImage(phoneCanvas) !== home, 'A one-finger drag orbits the cluster.');
    assert.ok(await phone.locator('#detail').isHidden());
    await phone.locator('#fit').tap();
    await gesture([[cx-30,cy],[cx+30,cy]], [[cx-10,cy+25],[cx+50,cy+25]]);
    assert.ok(await frameImage(phoneCanvas) !== home, 'A two-finger drag pans.');
    assert.equal(await phone.locator('#zoom-level').textContent(), '100%');
    await gesture([[cx-30,cy],[cx+30,cy]], [[cx-58,cy],[cx+58,cy]]);
    assert.ok(parseInt(await phone.locator('#zoom-level').textContent()) > 140, 'A pinch changes the camera distance.');
    assert.ok(await phone.locator('#detail').isHidden());
    await client.detach();
    await phone.locator('#fit').tap();
    await phone.locator('#zoom-in').tap();
    assert.equal(await phone.locator('#zoom-level').textContent(), '125%');
    await phone.locator('#table-mode').tap();
    await phone.locator('#level').selectOption('phenomenon');
    await phone.locator('#availability').selectOption('available');
    await phone.locator('[data-topic-id="planetary-transits"]').tap();
    assert.ok(await fits(phone));
    const title = await phone.locator('#detail-title').boundingBox();
    assert.ok(title && title.y >= 0 && title.y < 844, 'Selected phenomenon scrolls into view.');
    assert.ok(await phone.locator('.study-launch').isVisible());
    await shot(phone,'acceptance-phone-detail.png');
    await phone.close();
  });
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.errors.push(error.message);
  throw error;
} finally {
  await writeFile(join(output, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await app?.close();
  await rm(projectDirectory, { recursive: true, force: true });
}
console.log(report.checks.length + ' atlas browser checks passed. Report: ' + join(output, 'acceptance.json'));
