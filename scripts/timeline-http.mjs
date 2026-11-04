// Trusted hosts supply the registry and a snapshot provider. HTTP accepts only
// presentation seconds and an optional previously observed snapshot identity.
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTimelineEvaluator } from '../src/timeline/evaluator.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = new Map(Object.entries({
  '/timeline/': 'demo/timeline/index.html',
  '/timeline/app.js': 'demo/timeline/app.js',
  '/timeline/style.css': 'demo/timeline/style.css',
  '/src/scene/three-adapter.js': 'src/scene/three-adapter.js',
  '/src/workspace/plot-samples.js': 'src/workspace/plot-samples.js',
  '/vendor/three/three.module.js': 'node_modules/three/build/three.module.js',
  '/vendor/three/three.core.js': 'node_modules/three/build/three.core.js',
  '/vendor/three/OrbitControls.js': 'node_modules/three/examples/jsm/controls/OrbitControls.js',
  '/assets/branding/cosmic-lego-galaxy.png': 'assets/branding/cosmic-lego-galaxy.png',
}));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export function createTimelineService({ registry, binding, layer, registryModule, getSource }) {
  let current, closed = false, pendingFrames = 0, previousFrame = Promise.resolve();
  const dispose = async entry => {
    if (entry) await entry.ready.then(player => player.evaluator.dispose(), () => {});
  };
  async function acquire() {
    if (closed) fail('TIMELINE_CLOSED', 'The player has closed.');
    const source = getSource();
    if (current?.key !== source?.key) {
      const previous = current;
      current = undefined;
      void dispose(previous).catch(() => {});
    }
    if (!source) fail('TIMELINE_MISSING', 'Open a project with an authored timeline to play it here.');
    if (!current) {
      const manifest = source.manifest();
      const ready = createTimelineEvaluator({ manifest, registry, binding, layer, registryModule }).then(evaluator => ({
        evaluator, metadata: { title: evaluator.definition.data.title, duration: evaluator.definition.data.duration, snapshotId: manifest.integrity.sha256,
          boundaryTimes: [...new Set(evaluator.definition.data.boundaries.map(event => event.at))].sort((a, b) => a - b) },
      }));
      current = { key: source.key, ready };
    }
    const key = current.key, player = await current.ready;
    function check() {
      if (closed || getSource()?.key !== key) fail('STALE_TIMELINE', 'The authored project changed. Reload the player to use the current snapshot.');
    }
    check();
    return { ...player, check };
  }
  return Object.freeze({
    async details() { return (await acquire()).metadata; },
    async frame(time, snapshotId) {
      if (!Number.isFinite(time)) fail('TIMELINE_TIME', 'Supply finite presentation seconds.');
      if (pendingFrames >= 4) fail('TIMELINE_BUSY', 'The player has four pending frame requests. Try the seek again.');
      pendingFrames++;
      try {
        const { evaluator, metadata, check } = await acquire();
        if (snapshotId !== undefined && metadata.snapshotId !== snapshotId) fail('STALE_TIMELINE', 'The player snapshot changed. Reload before seeking.');
        // A host can serve several tabs. Each completed seek gets its own
        // sample even if another viewer requests a different time.
        const frame = previousFrame.then(async () => {
          check();
          try { return await evaluator.evaluate(time); } finally { check(); }
        });
        previousFrame = frame.then(() => {}, () => {});
        return await frame;
      } finally { pendingFrames--; }
    },
    async close() { closed = true; const previous = current; current = undefined; await dispose(previous); },
  });
}

async function readFrameRequest(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') fail('CONTENT_TYPE', 'Use application/json for a frame request.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) fail('REQUEST_BUDGET', 'A frame request is limited to 4 KiB.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail('TIMELINE_REQUEST', 'Expected a UTF-8 JSON object.'); }
  if (!body || typeof body !== 'object' || !Object.hasOwn(body, 'time') || Object.keys(body).some(key => !['time', 'snapshotId'].includes(key)) ||
    (Object.hasOwn(body, 'snapshotId') && typeof body.snapshotId !== 'string')) fail('TIMELINE_REQUEST', 'Supply time and optionally the observed snapshotId.');
  return body;
}

export async function handleTimelineRequest(request, response, url, service) {
  const route = url.pathname;
  if (route !== '/api/timeline' && !route.startsWith('/api/timeline/') && !files.has(route)) return false;
  const json = (status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(value));
  };
  try {
    if (files.has(route)) {
      if (request.method !== 'GET') fail('METHOD', 'Use GET to open the player.');
      const file = await realpath(path.join(root, files.get(route)));
      if (!file.startsWith(root)) fail('PATH', 'Player resources must stay inside the installation.');
      const content = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
      response.end(content);
    } else {
      if (url.search) fail('TIMELINE_REQUEST', 'Timeline API routes do not accept query parameters.');
      if (route === '/api/timeline' && request.method === 'GET') json(200, { ok: true, result: await service.details() });
      else if (route === '/api/timeline/frame' && request.method === 'POST') {
        const body = await readFrameRequest(request);
        json(200, { ok: true, result: await service.frame(body.time, body.snapshotId) });
      } else fail('METHOD', 'Use GET /api/timeline or POST /api/timeline/frame.');
    }
  } catch (error) {
    const code = error.code ?? 'TIMELINE_ERROR';
    const status = code === 'METHOD' ? 405 : code === 'CONTENT_TYPE' ? 415 : code === 'TIMELINE_MISSING' || code === 'ENOENT' ? 404
      : code.includes('STALE') || code.includes('BUSY') ? 409 : /BUDGET|LIMIT/.test(code) ? 429 : 400;
    json(status, { ok: false, error: { code, message: error.message } });
  }
  return true;
}
