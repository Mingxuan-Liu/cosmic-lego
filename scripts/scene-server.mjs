import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRuntime } from '../src/runtime/index.js';
import { buildExample, registryModule, evaluateScene } from '../examples/scene-and-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const same = (a, b) => a && b && ['projectId', 'generation', 'revision'].every(key => a[key] === b[key]);
const error = (code, message) => Object.assign(new Error(message), { code });
function keys(data, fields) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !fields.includes(key))) throw error('REQUEST', 'Unsupported request fields.');
}
async function body(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > 65536) throw error('REQUEST_BUDGET', 'Request exceeds 64 KiB.');
  }
  try { return JSON.parse(text); } catch { throw error('REQUEST', 'Expected a JSON request.'); }
}

// A small F05 demonstration host, not the F07 command gateway. Trusted setup
// owns the fixture module; requests only choose checked demo edits and time.
export async function startSceneServer({ port = 4325, host = '127.0.0.1' } = {}) {
  if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 0 || port > 65535) throw error('SERVER_CONFIG', 'Use a loopback host and valid port.');
  const context = buildExample(), runtime = createRuntime({ registryModule });
  let evaluation = 0;
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); };
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== expectedHost) return send(403, { code: 'HOST', message: 'Use this server’s loopback address.' });
      if (request.headers.origin && request.headers.origin !== `http://${expectedHost}`) return send(403, { code: 'ORIGIN', message: 'Cross-origin requests are not supported.' });
      const url = new URL(request.url, `http://${expectedHost}`);
      if (request.method === 'GET' && url.pathname === '/api/scene/state') return send(200, { graph: context.project.snapshot(), identity: context.project.token, discovery: context.registry.discover(), sources: context.layer.sources(context.project) });
      if (request.method === 'POST' && ['/api/scene/evaluate', '/api/scene/edit'].includes(url.pathname)) {
        if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { code: 'CONTENT_TYPE', message: 'Use application/json.' });
        const input = await body(request);
        if (!same(input.identity, context.project.token)) return send(409, { code: 'STALE_TOKEN', message: 'The accepted project changed.', identity: context.project.token });
        if (url.pathname.endsWith('/evaluate')) {
          keys(input, ['identity', 'time', 'capabilities']);
          const sequence = ++evaluation;
          const result = await evaluateScene(context, runtime, input.time, input.capabilities);
          if (sequence !== evaluation || !same(input.identity, context.project.token)) return send(409, { code: 'STALE_RESULT', message: 'A newer request or edit superseded this snapshot.' });
          return send(200, result);
        }
        keys(input, ['identity', 'action', 'id', 'value']);
        const draft = context.project.begin(input.identity), s = context.layer.author(draft);
        if (input.action === 'duplicate') {
          const source = draft.get(input.id), copy = s.duplicate(source);
          const position = copy.value.data.parameters.position;
          s.update(copy, { position: [position[0], position[1], position[2] + 1.1] });
        } else if (input.action === 'remove') {
          const node = draft.get(input.id).value;
          if (!['scene.mesh', 'scene.points', 'scene.polyline', 'scene.vectors', 'scene.label'].includes(node.type)) throw error('EDIT', 'Choose a drawable instance to remove.');
          s.remove(input.id, { cascade: true });
        } else if (input.action === 'marker-scale') {
          if (!Number.isFinite(input.value) || input.value < 0.03 || input.value > 0.3) throw error('EDIT', 'Marker radius must be between 0.03 and 0.3 display units.');
          s.update('shared-sphere', { radius: input.value });
        } else if (input.action === 'projection') {
          if (!['perspective', 'orthographic'].includes(input.value)) throw error('EDIT', 'Choose a supported projection.');
          s.update('camera', { projection: input.value });
        } else throw error('EDIT', 'Unsupported scene edit.');
        draft.accept(); ++evaluation;
        runtime.setProject(context.project);
        return send(200, { graph: context.project.snapshot(), identity: context.project.token });
      }
      if (request.method !== 'GET') return send(405, { code: 'METHOD', message: 'Method not supported.' });
      const aliases = {
        '/': 'demo/scene/index.html', '/scene/': 'demo/scene/index.html',
        '/scene/app.js': 'demo/scene/app.js', '/scene/style.css': 'demo/scene/style.css',
        '/vendor/three/three.module.js': 'node_modules/three/build/three.module.js',
        '/vendor/three/three.core.js': 'node_modules/three/build/three.core.js',
        '/vendor/three/OrbitControls.js': 'node_modules/three/examples/jsm/controls/OrbitControls.js',
        '/assets/branding/cosmic-lego-galaxy.png': 'assets/branding/cosmic-lego-galaxy.png',
        '/src/scene/three-adapter.js': 'src/scene/three-adapter.js',
      };
      if (!Object.hasOwn(aliases, url.pathname)) return send(404, { code: 'NOT_FOUND', message: 'Unknown local resource.' });
      const file = await realpath(path.join(root, aliases[url.pathname]));
      if (!file.startsWith(root + path.sep)) throw error('PATH', 'Resource is outside the application directory.');
      const content = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
      response.end(content);
    } catch (failure) { send(failure.code === 'ENOENT' ? 404 : 400, { code: failure.code ?? 'SCENE_SERVER', message: failure.message, diagnostics: failure.validation?.errors ?? [] }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, url: `http://${host}:${server.address().port}`, project: context.project, context,
    async close() { ++evaluation; await runtime.dispose(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--port')) throw error('CLI', 'Usage: scene-server.mjs [--port number]');
  const app = await startSceneServer({ port: args.length ? Number(args[1]) : 4325 });
  console.log(`Cosmic Lego scene laboratory: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
