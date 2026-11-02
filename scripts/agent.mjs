#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { capabilities, sceneSchema, validateScene, evaluateScene, sampleScene } from '../src/scene.js';

const [command, ...args] = process.argv.slice(2);
let flags = new Map(), scenePath;
const option = (name, fallback) => flags.has(name) ? flags.get(name) : fallback;
const print = value => console.log(JSON.stringify(value, null, 2));
const sceneFromFile = () => JSON.parse(readFileSync(scenePath === '-' ? 0 : scenePath, 'utf8'));
try {
  const allowed = { capabilities: [], schema: [], validate: [], evaluate: ['--time-days'], sample: ['--samples'], inspect: ['--url'], apply: ['--url', '--base-revision'], help: [], '--help': [] };
  const needsScene = ['validate', 'evaluate', 'sample', 'apply'].includes(command);
  if (Object.hasOwn(allowed, command)) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        if (!allowed[command].includes(arg)) throw new Error(`Unknown option ${arg} for ${command}.`);
        if (flags.has(arg)) throw new Error(`Duplicate option ${arg}.`);
        const value = args[++i];
        if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
        flags.set(arg, value);
      } else if (needsScene && scenePath === undefined) scenePath = arg;
      else throw new Error(`Unexpected argument: ${arg}.`);
    }
    if (needsScene && !scenePath) throw new Error('A scene JSON path (or - for stdin) is required.');
    if (flags.has('--base-revision') && (!Number.isInteger(Number(flags.get('--base-revision'))) || Number(flags.get('--base-revision')) < 1)) throw new Error('--base-revision must be a positive integer.');
  }
  if (command === 'capabilities') print(capabilities);
  else if (command === 'schema') print(sceneSchema);
  else if (command === 'validate') {
    const result = validateScene(sceneFromFile()); print(result); if (!result.valid) process.exitCode = 1;
  } else if (command === 'evaluate') print(evaluateScene(sceneFromFile(), Number(option('--time-days', 0))));
  else if (command === 'sample') print(sampleScene(sceneFromFile(), { samples: Number(option('--samples', 721)) }));
  else if (command === 'inspect' || command === 'apply') {
    const url = new URL(option('--url', 'http://127.0.0.1:4317'));
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('The demo agent endpoint must be an HTTP loopback URL.');
    const endpoint = new URL('/api/scene', url);
    let init;
    if (command === 'apply') {
      const scene = sceneFromFile(), validation = validateScene(scene);
      if (!validation.valid) { print(validation); process.exit(1); }
      const base = option('--base-revision', undefined);
      init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene, ...(base === undefined ? {} : { baseRevision: Number(base) }) }) };
    }
    const response = await fetch(endpoint, { ...init, signal: AbortSignal.timeout(5000) });
    print(await response.json()); if (!response.ok) process.exitCode = 1;
  } else {
    console.log('AstroCompose agent portal\n\nnode scripts/agent.mjs capabilities\nnode scripts/agent.mjs schema\nnode scripts/agent.mjs validate scene.json\nnode scripts/agent.mjs evaluate scene.json --time-days 0\nnode scripts/agent.mjs sample scene.json --samples 721\nnode scripts/agent.mjs inspect [--url http://127.0.0.1:4317]\nnode scripts/agent.mjs apply scene.json [--base-revision N] [--url http://127.0.0.1:4317]\n\nUse - as the scene path to read JSON from stdin.');
    if (command && !['--help', 'help'].includes(command)) process.exitCode = 1;
  }
} catch (error) { print({ error: error.code ?? 'AGENT_ERROR', message: error.message, ...(error.validation ? { validation: error.validation } : {}) }); process.exitCode = 1; }
