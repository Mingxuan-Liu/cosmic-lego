import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { World } from '../src/sdk.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const recipe = 'experiments/agent-a-overlap.mjs';

function cli(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ['scripts/agent.mjs', ...args], {
      cwd: root, timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      try { resolve({ code: error?.code ?? 0, body: JSON.parse(stdout), stderr }); }
      catch { reject(new Error(`CLI did not return JSON: ${stderr || stdout || error?.message}`)); }
    });
    child.stdin.end(input);
  });
}

async function endpoint(t) {
  const world = new World({ title: 'Before CLI publication' });
  const star = world.star({ id: 'host' });
  const observer = world.observer({ id: 'observer' });
  world.transits(star, observer, { id: 'light' });
  const server = createApp({ root, initialScene: world.build() });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('CLI discovers semantic tools and validates a new SDK-authored recipe offline', async () => {
  const tools = await cli(['tools']);
  assert.equal(tools.code, 0);
  assert.ok(tools.body.tools.some(tool => tool.name === 'observe_transits'));
  const dryRun = await cli(['run', recipe, '--dry-run']);
  assert.equal(dryRun.code, 0);
  assert.equal(dryRun.body.valid, true);
  assert.equal(dryRun.body.scene.bodies.filter(body => body.kind === 'planet').length, 3);
  assert.equal(dryRun.body.scene.observers.length, 2);
  assert.equal(dryRun.body.scene.measurements.length, 6);
  const validated = await cli(['validate', '-'], JSON.stringify(dryRun.body.scene));
  assert.equal(validated.code, 0);
  assert.equal(validated.body.valid, true);
});

test('CLI rejects malformed flags rather than substituting defaults or dropping revision guards', async () => {
  const cases = [
    { args: ['evaluate', '--time-day', '0.75'], message: /Unknown or duplicate option/ },
    { args: ['run', recipe, '--base-revision'], message: /Missing value/ },
    { args: ['run', recipe, '--base-revision', '--dry-run'], message: /Missing value/ },
    { args: ['run', recipe, '--dry-run', '--dry-run'], message: /Unknown or duplicate option/ },
    { args: ['run', recipe, '--base-revision', '0', '--dry-run'], message: /positive integer/ },
    { args: ['sample', '--samples', '3.5'], message: /samples must/ },
    { args: ['inspect', 'unexpected'], message: /Unexpected argument/ },
  ];
  for (const entry of cases) {
    const result = await cli(entry.args);
    assert.equal(result.code, 1, entry.args.join(' '));
    assert.equal(result.body.error, 'AGENT_ERROR');
    assert.match(result.body.message, entry.message);
  }
});

test('a real CLI process publishes, inspects, measures and transactionally revises a local world', async t => {
  const url = await endpoint(t);
  const published = await cli(['run', recipe, '--url', url, '--base-revision', '1']);
  assert.equal(published.code, 0);
  assert.equal(published.body.revision, 2);
  assert.equal(published.body.scene.title, 'Three planets, one shared shadow');
  assert.match(published.body.source, /export default function buildOverlapLesson/);
  const inspected = await cli(['inspect', '--url', url]);
  assert.equal(inspected.code, 0);
  assert.deepEqual(inspected.body, published.body);
  const atZero = await cli(['evaluate', '--time-days', '0', '--url', url]);
  assert.equal(atZero.code, 0);
  assert.equal(atZero.body.planets.length, 3);
  const measured = Object.fromEntries(atZero.body.measurements.map(m => [m.id, m.flux]));
  assert.ok(measured.combined < 1);
  assert.equal(measured['tilted-combined'], 1);
  const sampled = await cli(['sample', '--samples', '7', '--url', url]);
  assert.equal(sampled.code, 0);
  assert.equal(sampled.body.tracks.length, 6);
  assert.equal(sampled.body.sampling.baselineSamples, 7);
  assert.ok(sampled.body.tracks.every(track => track.points.length >= 7));

  const transaction = await cli(['transact', '-', '--url', url, '--base-revision', '2'],
    JSON.stringify([{ op: 'set_title', title: 'Revised through CLI operations' }]));
  assert.equal(transaction.code, 0);
  assert.equal(transaction.body.revision, 3);
  assert.equal(transaction.body.scene.title, 'Revised through CLI operations');
  const stale = await cli(['run', recipe, '--url', url, '--base-revision', '2']);
  assert.equal(stale.code, 1);
  assert.match(stale.body.message, /Re-read the world/);
  assert.deepEqual((await cli(['inspect', '--url', url])).body, transaction.body);
});
