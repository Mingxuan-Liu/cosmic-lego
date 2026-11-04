#!/usr/bin/env node
// Compatibility launcher for trusted v0.2 recipes and the previous local save.
// Convert into a fresh shared workspace. The input is never overwritten.
import { readFile } from 'node:fs/promises';
import { runExoplanet, startExoplanetServer } from '../apps/exoplanet.mjs';
import { importLegacy } from '../packages/exoplanet/importer.mjs';
import { parseSceneFlags } from './scene-server.mjs';

const args = process.argv.slice(2);
const examples = new Map([
  ...['cosmic-clockwork', 'tilted-orbits', 'eccentric-periapsis'].map(id => [id, '../examples/' + id + '.mjs']),
  ...['agent-a-overlap', 'agent-b-eccentricity'].map(id => [id, '../experiments/' + id + '.mjs']),
]);
async function main() {
  const flags = [], choices = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resume') choices.push({ resume: true });
    else if (args[i] === '--example') {
      const file = examples.get(args[++i]);
      if (!file) throw new Error('Choose a known v0.2 recipe: ' + [...examples.keys()].join(', '));
      choices.push({ file });
    } else flags.push(args[i]);
  }
  if (choices.length > 1) throw new Error('Choose one saved world or one example.');
  const [choice] = choices;
  if (!choice) return runExoplanet(flags);
  let document;
  if (choice.resume) {
    try { document = await readFile(new URL('../.local/world-v2.json', import.meta.url), 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return runExoplanet(flags); throw e; }
  } else {
    const file = new URL(choice.file, import.meta.url), { default: recipe } = await import(file);
    const world = typeof recipe === 'function' ? recipe() : recipe;
    document = { scene: world.build(), source: await readFile(file, 'utf8') };
  }
  const { manifest, warnings } = importLegacy(document);
  for (const item of warnings) console.log(item.path + ' · ' + item.message);
  const app = await startExoplanetServer(parseSceneFlags(flags));
  try { await app.portable.action('import', { document: manifest, expected: app.project.token }); }
  catch (error) { await app.close(); throw error; }
  console.log('Cosmic Lego: ' + app.url + '/');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
