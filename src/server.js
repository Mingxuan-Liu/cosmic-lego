import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { capabilities, sceneSchema, validateScene, evaluateScene, sampleScene } from './scene.js';

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };

async function body(req) {
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 128 * 1024) { const error = new Error('Request exceeds 128 KiB.'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('Expected a JSON request body.'); error.status = 400; throw error; }
}

export function createApp({ initialScene, root, onScene = () => {} }) {
  if (!validateScene(initialScene).valid) throw new Error('Invalid initial scene.');
  let scene = structuredClone(initialScene), revision = 1;
  return http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return json(res, 403, { error: 'LOCAL_ONLY', message: 'Use the loopback address printed by the local server.' });
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return json(res, 403, { error: 'CROSS_ORIGIN', message: 'This local prototype only accepts same-origin browser requests.' });
      const url = new URL(req.url, `http://${host}`);
      const route = url.pathname;
      if (req.method === 'GET' && route === '/api/capabilities') return json(res, 200, capabilities);
      if (req.method === 'GET' && route === '/api/schema') return json(res, 200, sceneSchema);
      if (req.method === 'GET' && route === '/api/scene') return json(res, 200, { revision, scene });
      if (req.method === 'POST' && ['/api/validate', '/api/evaluate', '/api/sample', '/api/scene'].includes(route)) {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'CONTENT_TYPE', message: 'Use application/json.' });
        const input = await body(req);
        if (!input || typeof input !== 'object' || Array.isArray(input)) return json(res, 400, { error: 'INVALID_REQUEST', message: 'Expected an object containing scene.' });
        const validation = validateScene(input.scene);
        if (route === '/api/validate') return json(res, 200, validation);
        if (!validation.valid) return json(res, 422, { error: 'INVALID_SCENE', validation });
        if (route === '/api/evaluate') return json(res, 200, evaluateScene(input.scene, input.timeDays ?? 0));
        if (route === '/api/sample') return json(res, 200, sampleScene(input.scene, { samples: input.samples ?? 721 }));
        if (input.baseRevision !== undefined && input.baseRevision !== revision) return json(res, 409, { error: 'REVISION_CONFLICT', revision, message: 'Read the current scene before applying your edit.' });
        // Persist before publishing a new in-memory revision. The callback is small
        // and synchronous in the local launcher, avoiding interleaved commits.
        const replacement = structuredClone(input.scene);
        onScene(replacement);
        scene = replacement; revision += 1;
        return json(res, 200, { revision, scene });
      }
      if (route.startsWith('/api/')) return json(res, 404, { error: 'NOT_FOUND' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      const relative = decodeURIComponent(route === '/' ? '/index.html' : route).slice(1);
      if (!/^(index\.html|styles\.css|scene\.schema\.json|src\/[A-Za-z0-9_-]+\.js|examples\/[A-Za-z0-9_-]+\.json)$/.test(relative)) return json(res, 404, { error: 'NOT_FOUND' });
      const data = await readFile(path.join(root, relative));
      res.writeHead(200, { 'Content-Type': mime[path.extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (error.code === 'ENOENT') return json(res, 404, { error: 'NOT_FOUND' });
      json(res, error.status ?? (error instanceof RangeError ? 400 : 500), { error: error.code ?? 'REQUEST_ERROR', message: error.message });
    }
  });
}
