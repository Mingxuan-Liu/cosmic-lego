#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { validateScene } from '../src/scene.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
if (args.includes('--help')) {
  console.log('Usage: node scripts/serve.mjs [--port 4317] [--scene path.json] [--resume]\nServes on 127.0.0.1 only. Accepted edits are saved in .local/live-scene.json.');
  process.exit(0);
}
const port = Number(option('--port', 4317));
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid --port.');
const saved = path.join(root, '.local/live-scene.json');
const scenePath = option('--scene', args.includes('--resume') && existsSync(saved) ? saved : path.join(root, 'examples/viewing-angles.json'));
const initialScene = JSON.parse(readFileSync(scenePath, 'utf8'));
const validation = validateScene(initialScene);
if (!validation.valid) { console.error(JSON.stringify(validation, null, 2)); process.exit(1); }
const server = createApp({ root, initialScene, onScene: scene => {
  mkdirSync(path.dirname(saved), { recursive: true });
  writeFileSync(saved, JSON.stringify(scene, null, 2) + '\n');
} });
server.listen(port, '127.0.0.1', () => console.log(`AstroCompose local demo: http://127.0.0.1:${server.address().port}\nAgent API: /api/capabilities · /api/schema · /api/scene\nPress Ctrl+C to stop.`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
