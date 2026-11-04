// Read-only offline player composition root. Project data cannot select modules.
import http from 'node:http';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRegistry } from '../examples/fixtures/workspace-registry.js';
import { createWorkspaceLayer } from '../src/workspace/index.js';
import { createVisualizationManifest, openPortableManifest, PORTABLE_LIMITS } from '../src/portable/format.js';
import { createTimelineService, handleTimelineRequest } from './timeline-http.mjs';

const defaultRegistry = { createRegistry, registryModule: new URL('../examples/fixtures/workspace-registry.js', import.meta.url) };

export async function startTimelineServer({ manifest, host = '127.0.0.1', port = 0, visualizationDelivery = false, composition = defaultRegistry } = {}) {
  if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Use a loopback host and a valid local port.');
  const registry = composition.createRegistry(), binding = registry.bind(), layer = createWorkspaceLayer(binding);
  const context = { registry, binding, layer };
  const validated = visualizationDelivery ? createVisualizationManifest(manifest, context) : openPortableManifest(manifest, context).manifest;
  const source = validated.timeline?.version === 1 ? { key: validated.integrity.sha256, manifest: () => validated } : null;
  const player = createTimelineService({ registry, binding, layer, registryModule: composition.registryModule, getSource: () => source });
  try { await player.details(); } catch (error) { await player.close(); throw error; }
  const server = http.createServer(async (req, res) => {
    try {
      const authority = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== authority || (req.headers.origin && req.headers.origin !== 'http://' + authority)) {
        res.writeHead(403); res.end('Use this loopback origin.'); return;
      }
      const url = new URL(req.url, 'http://' + authority);
      if (url.pathname === '/' && req.method === 'GET') { res.writeHead(302, { Location: '/timeline/' }); res.end(); return; }
      if (!await handleTimelineRequest(req, res, url, player)) { res.writeHead(404); res.end('Unknown player resource.'); }
    } catch { if (!res.headersSent) res.writeHead(400); res.end(); }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { await player.close(); throw error; }
  return { manifest: validated, url: `http://${host}:${server.address().port}`, async close() {
    await player.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  } };
}

export async function runPlayer(args, composition) {
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--project', '--port'].includes(args[i]) || flags.has(args[i]) || !args[i + 1]) throw new Error('Usage: timeline-server.mjs --project file.json [--port 4327]');
    flags.set(args[i], args[i + 1]);
  }
  if (!flags.has('--project')) throw new Error('Choose a local file with --project.');
  const handle = await open(flags.get('--project'), 'r');
  let manifest;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > PORTABLE_LIMITS.maxBytes) throw new Error('Choose a portable project file within the format size limit.');
    manifest = await handle.readFile();
  } finally { await handle.close(); }
  const app = await startTimelineServer({ manifest, composition, port: Number(flags.get('--port') ?? 4327) });
  console.log(`Cosmic Lego player: ${app.url}/timeline/`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runPlayer(process.argv.slice(2));
