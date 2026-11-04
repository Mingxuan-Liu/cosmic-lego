// Trusted deployment configuration. Project files supply data only.
import { pathToFileURL } from 'node:url';
import { runPlayer } from '../../scripts/timeline-server.mjs';
import { createRegistry } from './registry.js';

export const playerComposition = {
  createRegistry, registryModule: new URL('./registry.js', import.meta.url),
  playerEntry: 'packages/exoplanet/player.mjs',
  playerFiles: ['physics.js', 'models.js', 'visuals.js', 'registry.js', 'player.mjs'].map(file => 'packages/exoplanet/' + file),
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runPlayer(process.argv.slice(2), playerComposition);
