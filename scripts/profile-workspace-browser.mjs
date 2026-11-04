// Measure one real workspace Play interval without writing to the project.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [origin = 'http://127.0.0.1:4329', label = 'sample', secondsText = '12'] = process.argv.slice(2);
const url = new URL(origin);
assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
assert.match(label, /^[a-z0-9_-]+$/);
const seconds = Number(secondsText);
assert.ok(seconds >= 3 && seconds <= 60);
const competing = process.argv.includes('--two-tabs');
const directory = path.resolve('.local/perf-hud-qa', label);
await mkdir(directory, { recursive: true });
const { chromium } = await import(process.env.COSMIC_LEGO_PLAYWRIGHT ?? 'playwright');
const browser = await chromium.launch({
  headless: true, executablePath: process.env.COSMIC_LEGO_CHROME,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const quantile = (numbers, fraction) => numbers.length ? [...numbers].sort((a,b) => a-b)[Math.floor((numbers.length-1)*fraction)] : null;
try {
  const instrument = () => {
    performance.setResourceTimingBufferSize(8192);
    const trace = { requests: [], samples: [], frames: [], statuses: [], blocked: [] };
    Object.defineProperty(window, '__profile', { value: trace });
    const beforeFetch = window.fetch;
    window.fetch = async (...args) => {
      const name = new URL(args[0].url ?? args[0], location.href).pathname;
      const request = { name, start: performance.now() };
      trace.requests.push(request);
      let input;
      try { input = JSON.parse(args[1]?.body ?? '{}'); } catch {}
      if (input?.time) request.physicalTime = input.time.value;
      const result = await beforeFetch(...args);
      request.headers = performance.now(); request.code = result.status;
      const parse = result.json.bind(result);
      result.json = async () => {
        const value = await parse();
        request.parsed = performance.now();
        return value;
      };
      return result;
    };
    new PerformanceObserver(batch => {
      for (const task of batch.getEntries()) trace.blocked.push({ at: task.startTime, duration: task.duration });
    }).observe({ type: 'longtask', buffered: true });
    let lastFrame, lastTime, previousStatus;
    function sample(now) {
      if (lastFrame != null) trace.frames.push({ at: now, interval: now-lastFrame });
      lastFrame = now;
      const time = window.cosmicWorkspace?.snapshot?.time?.value;
      if (time !== undefined && time !== lastTime) { trace.samples.push({ at: performance.now(), time }); lastTime = time; }
      const status = document.getElementById('status')?.textContent;
      if (status !== undefined && status !== previousStatus) { trace.statuses.push({ at: performance.now(), status }); previousStatus = status; }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  };
  await page.addInitScript(instrument);
  await page.goto(new URL('/workspace/', url).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.cosmicWorkspace?.snapshot?.valid, null, { timeout: 120000 });
  await page.screenshot({ path: path.join(directory, 'paused.png') });
  const identity = await page.evaluate(() => cosmicWorkspace.state.identity);
  let other;
  if (competing) {
    other = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await other.addInitScript(instrument);
    await other.goto(new URL('/workspace/', url).href);
    await other.waitForFunction(() => !!globalThis.cosmicWorkspace?.snapshot?.valid, null, { timeout: 120000 });
  }
  const toggle = tab => tab.evaluate(() => {
    const now = performance.now(); document.querySelector('#play').click(); return now;
  });
  const [start, otherStart] = await Promise.all(other ? [toggle(page), toggle(other)] : [toggle(page)]);
  await page.waitForTimeout(Math.min(900, seconds*1000/4));
  await page.screenshot({ path: path.join(directory, 'playing.png') });
  await page.waitForFunction(until => performance.now() >= until, start + seconds * 1000);
  const [stop, otherStop] = await Promise.all(other ? [toggle(page), toggle(other)] : [toggle(page)]);
  const side = async (tab, from, until) => tab.evaluate(({from, until}) => {
    const log = window.__profile;
    const during = log.requests.filter(r => r.name.endsWith('/evaluate') && r.start >= from && r.start < until);
    return { visibility: document.visibilityState,
      samples: log.samples.filter(s => s.at > from && s.at < until).map(s => s.time),
      requests: during.map(r => ({ attemptedTime: r.physicalTime, code: r.code ?? null })),
    };
  }, {from, until});
  const concurrent = other ? await Promise.all([side(page,start,stop), side(other,otherStart,otherStop)]) : null;
  await page.waitForTimeout(300);
  const trace = await page.evaluate(() => ({ ...window.__profile,
    resources: performance.getEntriesByType('resource')
      .filter(e => new URL(e.name).pathname.includes('/api/'))
      .map(e => ({ name: new URL(e.name).pathname, start: e.startTime, end: e.responseEnd, bytes: e.encodedBodySize, firstByte: e.responseStart })),
    title: document.title, status: document.querySelector('#status')?.textContent, final: cosmicWorkspace.state.identity,
    physicalStep: document.querySelector('#time').dataset.advance, availableViews: cosmicWorkspace.snapshot.overlays.length,
  }));
  assert.deepEqual(identity, trace.final);
  const requests = trace.requests.filter(r => r.start >= start && r.start <= stop && r.name.endsWith('/evaluate'));
  const resources = trace.resources.filter(r => r.start >= start && r.start <= stop && r.name.endsWith('/evaluate'));
  const views = trace.samples.filter(s => s.at > start && s.at < stop);
  const frameIntervals = trace.frames.filter(f => f.at > start && f.at < stop).map(f => f.interval);
  let waiting = 0;
  for (const [index,item] of trace.statuses.entries()) {
    if (!/Computing/i.test(item.status)) continue;
    const end = trace.statuses[index+1]?.at ?? stop;
    waiting += Math.max(0, Math.min(end,stop) - Math.max(item.at,start));
  }
  const list = numbers => ({ count: numbers.length, median: quantile(numbers,.5), p95: quantile(numbers,.95), maximum: numbers.length ? Math.max(...numbers) : null });
  const report = { label, project: identity.projectId, browser: browser.version(), viewport: [1600,900], intervalMs: stop-start,
    concurrent, scienceSamples: views.length, scienceHz: 1000*views.length/(stop-start), physicalStep: trace.physicalStep,
    firstScientificSampleMs: trace.samples[0]?.at, networkTtfbMs: list(resources.map(r => r.firstByte-r.start)),
    requestTransferMs: list(resources.map(r => r.end-r.firstByte)), bytes: list(resources.map(r => r.bytes)),
    parsedAfterHeadersMs: list(requests.filter(r => r.parsed).map(r => r.parsed-r.headers)), animationFrameIntervalMs: list(frameIntervals),
    computingStatusFraction: waiting/(stop-start), longTasks: list(trace.blocked.filter(b => b.at >= start && b.at < stop).map(b => b.duration)), errors,
    samples: views, requests, pollCounts: Object.fromEntries([...new Set(trace.requests.map(r => r.name))].map(name => [name, trace.requests.filter(r => r.name === name && r.start>=start && r.start<stop).length])),
  };
  await writeFile(path.join(directory,'report.json'), JSON.stringify(report,null,2)+'\n');
  await writeFile(path.join(directory,'trace.json'), JSON.stringify({start,stop,...trace},null,2)+'\n');
  console.log(JSON.stringify({ ...report, samples: undefined, requests: undefined },null,2));
} finally { await browser.close(); }
