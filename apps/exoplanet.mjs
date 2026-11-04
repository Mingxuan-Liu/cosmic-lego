// Astronomy is installed only at this trusted application entry point.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSceneFlags, startSceneServer } from '../scripts/scene-server.mjs';
import { runDelivery } from '../scripts/timeline-delivery.mjs';
import { runPlayer } from '../scripts/timeline-server.mjs';
import { playerComposition } from '../packages/exoplanet/player.mjs';
import * as composition from '../packages/exoplanet/recipe.mjs';

// Only this product includes the astronomy roadmap. Each browser module is explicitly served.
const staticAliases = {
  '/': 'demo/atlas/index.html', '/atlas/': 'demo/atlas/index.html',
  '/atlas/app.js': 'demo/atlas/app.js', '/atlas/cluster.js': 'demo/atlas/cluster.js',
  '/atlas/layout.js': 'demo/atlas/layout.js', '/atlas/orbit.js': 'demo/atlas/orbit.js',
  '/atlas/style.css': 'demo/atlas/style.css', '/atlas/coverage.mjs': 'packages/atlas/coverage.mjs',
  '/atlas/reuse.mjs': 'packages/atlas/reuse.mjs', '/atlas/roadmap.mjs': 'packages/atlas/roadmap.mjs',
  '/atlas/roadmap-assets.mjs': 'packages/atlas/roadmap-assets.mjs',
  '/atlas/techniques.mjs': 'packages/atlas/techniques.mjs',
  '/atlas/foundations.mjs': 'packages/atlas/foundations.mjs',
};

export function startExoplanetServer(options = {}) {
  return startSceneServer({ port: 4317, projectDirectory: fileURLToPath(new URL('../.local/exoplanet-projects/', import.meta.url)),
    ...options, workspace: true, composition, staticAliases, studies: { 'planetary-transits': composition.buildExoplanetManifest } });
}

export async function runExoplanet(args) {
  if (['export', 'package'].includes(args[0])) return runDelivery(args, playerComposition);
  if (args[0] === 'player') return runPlayer(args.slice(1), playerComposition);
  let slot;
  const openFlag = args.indexOf('--open');
  if (openFlag >= 0) {
    slot = args[openFlag + 1];
    if (!slot || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slot)) throw new Error('Choose a named local project with --open.');
    args = [...args.slice(0, openFlag), ...args.slice(openFlag + 2)];
  }
  const app = await startExoplanetServer(parseSceneFlags(args));
  if (slot) {
    try { await app.portable.action('open', { name: slot, expected: app.project.token }); }
    catch (error) { await app.close(); throw error; }
  }
  console.log('Cosmic Lego: ' + app.url + '/');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runExoplanet(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = error.code === 'EXPORT_INTERRUPTED' ? 130 : 1; }
}
