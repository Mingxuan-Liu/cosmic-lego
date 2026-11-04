#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { serializePortableManifest } from '../src/portable/format.js';
import { buildExoplanetManifest } from '../packages/exoplanet/recipe.mjs';
import { importLegacy } from '../packages/exoplanet/importer.mjs';

const [action, ...args] = process.argv.slice(2);
try {
  let manifest, destination;
  if (action === 'example' && args.length <= 1) {
    manifest = buildExoplanetManifest();
    [destination] = args;
  } else if (action === 'import' && (args.length === 1 || args.length === 2)) {
    const [source, target] = args;
    const result = importLegacy(await readFile(source, 'utf8'));
    for (const warning of result.warnings) console.error(warning.path + ' · ' + warning.message);
    manifest = result.manifest;
    destination = target;
  } else throw new Error('Usage: exoplanet-project.mjs example [new-output.json] | import legacy.json [new-output.json]');
  const json = serializePortableManifest(manifest);
  if (destination) await writeFile(destination, json, { flag: 'wx' });
  else process.stdout.write(json + '\n');
} catch (error) {
  console.error((error.code ? error.code + ' · ' : '') + error.message);
  process.exitCode = 1;
}
