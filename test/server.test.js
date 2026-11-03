import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { World } from '../src/sdk.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function emptyWorld(title = 'A photometer waiting for planets') {
  const world = new World({ title });
  const star = world.star({ id: 'host' });
  const observer = world.observer({ id: 'observer' });
  world.transits(star, observer, { id: 'light' });
  world.present({ startDays: -0.1, durationDays: 0.2 });
  return world;
}

async function start(t, options = {}) {
  const server = createApp({ root, initialScene: emptyWorld().build(), ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, data) => {
    const response = await fetch(base + route, data === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  };
  return { server, base, request };
}

const addPlanet = (id = 'new-planet') => [
  { op: 'add_body', body: { id, kind: 'planet', name: id, radiusJupiter: 1, massJupiter: 0.1 } },
  { op: 'attach_orbit', orbit: { id: `${id}-orbit`, bodyId: id, hostId: 'host', semiMajorAxisAU: 0.05 } },
];

test('HTTP discovery, evaluation and sampling expose the same authored world', async t => {
  const { request, base } = await start(t);
  const catalog = await request('/api/tools');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.tools.some(tool => tool.name === 'attach_orbit'));
  assert.equal(catalog.body.capabilities.model, 'independent-keplerian-uniform-union');
  assert.equal((await request('/api/capabilities')).body.mcpImplemented, false);
  const snapshot = (await request('/api/scene')).body;
  assert.equal(snapshot.revision, 1);
  assert.equal((await request('/api/validate', { scene: snapshot.scene })).body.valid, true);
  const evaluated = await request('/api/evaluate', { timeDays: 0.035 });
  assert.equal(evaluated.status, 200);
  assert.equal(evaluated.body.timeDays, 0.035);
  assert.equal(evaluated.body.measurements[0].flux, 1);
  const sampled = await request('/api/sample', { samples: 5 });
  assert.equal(sampled.status, 200);
  assert.equal(sampled.body.tracks[0].points.length, 5);
  assert.equal(sampled.body.tracks[0].points[0].timeDays, -0.1);
  assert.equal(sampled.body.tracks[0].points.at(-1).timeDays, 0.1);
  assert.ok(sampled.body.tracks[0].points.every(point => point.flux === 1));
  assert.deepEqual((await request('/api/scene')).body, snapshot);
  assert.equal((await fetch(base + '/src/sdk.js')).status, 200);
  assert.equal((await fetch(base + '/.git/config')).status, 404);
  assert.equal((await fetch(base + '/.local/live-scene.json')).status, 404);
});

test('structural transactions change live measurements and reject invalid or stale edits atomically', async t => {
  const persisted = [];
  const { request } = await start(t, { onScene: scene => persisted.push(structuredClone(scene)) });
  const accepted = await request('/api/commands', { baseRevision: 1, commands: addPlanet() });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.revision, 2);
  assert.equal(accepted.body.scene.bodies.length, 2);
  assert.equal(accepted.body.scene.orbits.length, 1);
  assert.equal(accepted.body.scene.measurements[0].occulters, 'orbiting');
  const atTransit = (await request('/api/evaluate', { timeDays: 0 })).body;
  assert.deepEqual(atTransit.measurements[0].occultingPlanetIds, ['new-planet']);
  assert.ok(atTransit.measurements[0].flux < 1);

  const invalid = await request('/api/commands', {
    baseRevision: 2,
    commands: [
      { op: 'set_title', title: 'This must not leak into the current world' },
      { op: 'add_body', body: { id: 'orphan', kind: 'planet', radiusJupiter: 1 } },
    ],
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.validation.valid, false);
  assert.deepEqual((await request('/api/scene')).body, accepted.body);
  const stale = await request('/api/commands', {
    baseRevision: 1, commands: [{ op: 'set_title', title: 'Outdated author' }],
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'REVISION_CONFLICT');
  assert.deepEqual((await request('/api/scene')).body, accepted.body);
  assert.equal(persisted.length, 1);
});

test('scene publication stores source as text and rejects malformed graphs without replacement', async t => {
  const { request } = await start(t);
  const world = emptyWorld('Published by an external author');
  world.planet({ id: 'authored' }).orbit(world.get('host'), { semiMajorAxisAU: 0.08, eccentricity: 0.3 });
  const marker = '__cosmic_lego_source_should_never_execute__';
  delete globalThis[marker];
  t.after(() => { delete globalThis[marker]; });
  const source = `globalThis.${marker} = true; throw new Error('Submitted source ran');`;
  const accepted = await request('/api/scene', { baseRevision: 1, scene: world.build(), source });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.source, source);
  assert.equal(globalThis[marker], undefined);
  assert.equal(accepted.body.revision, 2);
  assert.equal(accepted.body.scene.bodies[1].id, 'authored');
  const broken = structuredClone(accepted.body.scene);
  broken.orbits[0].hostId = 'nonexistent-star';
  assert.equal((await request('/api/scene', { scene: broken })).status, 422);
  assert.deepEqual((await request('/api/scene')).body, accepted.body);
});

test('a recipe that finishes loading after a transaction cannot overwrite the newer world', async t => {
  let releaseRecipe;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const loading = new Promise(resolve => { releaseRecipe = resolve; });
  const persisted = [];
  const { request } = await start(t, {
    examples: [{ id: 'slow', name: 'Delayed recipe' }],
    loadExample: async () => { markStarted(); return loading; },
    onScene: scene => persisted.push(scene.title),
  });
  assert.equal((await request('/api/examples')).body[0].id, 'slow');
  const pendingRecipe = request('/api/example', { id: 'slow', baseRevision: 1 });
  await started;
  const transaction = await request('/api/commands', {
    baseRevision: 1, commands: [{ op: 'set_title', title: 'Newer accepted transaction' }],
  });
  releaseRecipe({ scene: emptyWorld('Old delayed recipe').build(), source: '// delayed' });
  const delayed = await pendingRecipe;
  assert.equal(transaction.status, 200);
  assert.equal(delayed.status, 409);
  assert.equal(delayed.body.error, 'REVISION_CONFLICT');
  assert.deepEqual((await request('/api/scene')).body, transaction.body);
  assert.deepEqual(persisted, ['Newer accepted transaction']);
});
