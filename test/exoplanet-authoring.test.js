import assert from 'node:assert/strict';
import test from 'node:test';
import { World } from '../src/sdk.js';
import { createCommandGateway } from '../src/gateway/index.js';
import { createTimelineEvaluator } from '../src/timeline/evaluator.js';
import { openPortableManifest } from '../src/portable/format.js';
import { createWorkspaceLayer } from '../src/workspace/index.js';
import { buildExample, buildExoplanetManifest, registryModule } from '../packages/exoplanet/recipe.mjs';
import { importLegacy } from '../packages/exoplanet/importer.mjs';
import { createRegistry } from '../packages/exoplanet/registry.js';
import { skyDisplayMetres } from '../packages/exoplanet/visuals.js';

const close = (actual, expected, tol = 1e-11) => assert.ok(Math.abs(actual - expected) <= tol,
  'Expected ' + actual + ' to be within ' + tol + ' of ' + expected);
function host() {
  const registry = createRegistry(), binding = registry.bind();
  return { registry, binding, layer: createWorkspaceLayer(binding), registryModule };
}
function legacyWorld() {
  const world = new World({ title: 'Preserved legacy calibration' });
  const star = world.star({ id: 'sun', massSolar: 0.96, radiusSolar: 1.05 });
  const first = world.planet({ id: 'first', name: 'Body one', radiusJupiter: 1.35, massJupiter: 0.9 });
  first.orbit(star, { id: 'first-orbit', semiMajorAxisAU: 0.032, eccentricity: 0.18, epochDays: -0.125,
    meanAnomalyDegAtEpoch: 0, argumentPeriapsisDeg: 90 });
  const second = world.planet({ id: 'second', radiusJupiter: 0.72 });
  second.orbit(star, { id: 'second-orbit', semiMajorAxisAU: 0.052, eccentricity: 0.27, epochDays: -0.125,
    longitudeAscendingNodeDeg: 37, argumentPeriapsisDeg: 90, meanAnomalyDegAtEpoch: 0 });
  const line = world.observer({ id: 'line', name: 'Physical observer', direction: [0, 0, 3] });
  world.transits(star, line, { id: 'all', name: 'Both planets' });
  world.transits(star, line, { id: 'only-second', occulters: [second] });
  world.present({ startDays: -0.15, durationDays: 0.05, playbackSeconds: 10, bodyScale: 3 });
  world.annotate({ id: 'overlap', timeDays: -0.125, title: 'Overlap', text: 'Measure the same blocked area once.', focusId: first });
  return world;
}
test('portable study shares the conjunction geometry, true radii, and live comparison curves', async () => {
  const m = buildExoplanetManifest(), context = host();
  assert.equal(openPortableManifest(m, context).sourceStatus, 'matches');
  const evaluator = await createTimelineEvaluator({ ...context, manifest: m });
  try {
    const f = await evaluator.evaluate(4);
    assert.equal(f.physicalTime.value, 0);
    const values = new Map(f.results.map(r => [r.producer.nodeId + '.' + r.producer.port, r.value]));
    const ratio = 71492000 / 695700000;
    close(values.get('transit.flux').data, 1 - (1.4 * ratio) ** 2);
    close(values.get('naive-flux.value').data, 1 - (1.4 ** 2 + 0.8 ** 2) * ratio ** 2);
    for (const [id, target] of [['curve-transit.value', 'transit.flux'], ['curve-naive.value', 'naive-flux.value']]) {
      const series = values.get(id), center = series.coordinates.values.indexOf(0);
      assert.equal(series.coordinates.unit.symbol, 's');
      assert.ok(center > 0 && center < series.data.length - 1);
      close(series.data[center], values.get(target).data);
    }
    const stage = f.snapshot.scene;
    const body = id => stage.nodes.find(node => node.id === 'disk-' + id);
    for (const id of ['ember', 'cinder', 'ash']) {
      const [x, y, z] = body(id).position;
      close(x, 0); close(y, 0);
      assert.equal(z > 0, id !== 'ash');
    }
    close(stage.assets.find(a => a.id === 'shape-ember').data.radius, 1.4 * 71492000 / skyDisplayMetres);
    const outside = await evaluator.evaluate(0);
    const before = outside.results.find(r => r.producer.nodeId === 'transit' && r.producer.port === 'flux');
    close(before.value.data, 1);
  } finally { await evaluator.dispose(); }
});

test('legacy import preserves units, chosen occulters and inert source while reporting presentation differences', () => {
  const world = legacyWorld(), raw = world.build(), source = 'throw new Error("must never execute")';
  const json = JSON.stringify({ revision: 37, history: [{ revision: 37, summary: 'Legacy save' }], scene: raw, source }, null, 2);
  const { manifest, warnings } = importLegacy(json), context = host(), opened = openPortableManifest(manifest, context);
  assert.equal(opened.sourceStatus, 'matches');
  assert.equal(manifest.resources.find(r => r.path === 'legacy/input.json').content, json);
  assert.equal(manifest.resources.find(r => r.path === 'legacy/original-source.mjs').content, source);
  assert.ok(warnings.some(r => r.path === '$.presentation.bodyScale'));
  assert.ok(warnings.some(r => r.path.includes('focusId')));
  assert.equal(manifest.playback.time.value, -0.15 * 86400);
  for (const day of [-0.15, -0.125, -0.10]) {
    const expected = world.at(day);
    for (const m of expected.measurements) {
      const actual = context.binding.evaluate(opened.project, m.id, { port: 'flux', time: { value: day * 86400, unit: 's' } });
      assert.ok(actual.valid, JSON.stringify(actual.diagnostics));
      close(actual.value.data, m.flux);
    }
  }
  const schedules = world.sample({ samples: 33 });
  for (const track of schedules.tracks) {
    const series = context.binding.evaluate(opened.project, 'v2:curve-' + track.id, { time: { value: 0, unit: 's' } });
    assert.ok(series.valid, JSON.stringify(series.diagnostics));
    assert.deepEqual(series.value.coordinates.values, [...new Set(track.points.map(point => point.timeDays * 86400))]);
  }
  const cue = manifest.timeline.data.tracks.find(t => t.kind === 'annotation');
  assert.ok(cue.keys.some(key => key.value.includes('Measure the same blocked area once.')));
  assert.equal(manifest.graph.nodes.find(n => n.id === 'first-orbit').references.source, 'first');
  assert.equal(manifest.graph.nodes.find(n => n.id === 'v2:all-positions').data.mode, 'live');
  assert.equal(manifest.graph.nodes.find(n => n.id === 'v2:set-1-positions').data.mode, 'fixed');
  assert.ok(manifest.dataSources.every(item => item.license === 'Unspecified in legacy document'));
});

test('legacy importer rejects unknown versions, fields and malformed source with locations', () => {
  const scene = legacyWorld().build();
  assert.throws(() => importLegacy({ ...scene, schemaVersion: '0.1' }), { code: 'LEGACY_VERSION' });
  assert.throws(() => importLegacy({ scene, source: { url: 'remote-file' } }), { code: 'LEGACY_SCHEMA', path: '$.source' });
  assert.throws(() => importLegacy({ scene, surprise: true }), { code: 'LEGACY_UNSUPPORTED', path: '$.surprise' });
  scene.orbits[0].periodDays = 100;
  assert.throws(() => importLegacy(scene), error => error.code === 'LEGACY_INVALID' &&
    error.diagnostics.some(issue => issue.path.endsWith('periodDays')));
});

test('a radius edit changes the silhouette asset and flux together, including zero area', async () => {
  const context = buildExample(), { project, binding } = context;
  const gateway = createCommandGateway(context), time = { value: 0, unit: 's' };
  for (const radiusJupiter of [1.8, 0]) {
    const command = await gateway.dispatch({
      command: 'update:exoplanet.orbit', args: { id: 'ember', parameters: { radiusJupiter } },
      expected: project.token, idempotencyKey: 'set-radius-' + radiusJupiter,
    }, gateway.localAuthority);
    assert.ok(command.ok, JSON.stringify(command.error));
    const shape = binding.produce(project, 'shape-ember', { time });
    assert.ok(shape.valid, JSON.stringify(shape.diagnostics));
    close(shape.artifact.data.radius, radiusJupiter * 71492000 / skyDisplayMetres);
    if (radiusJupiter === 0) {
      assert.equal(shape.artifact.data.primitive, 'triangles');
      assert.deepEqual(shape.artifact.data.positions, [[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    }
    const measured = binding.evaluate(project, 'transit', { port: 'flux', time });
    assert.ok(measured.valid, JSON.stringify(measured.diagnostics));
    close(measured.value.data, 1 - (Math.max(radiusJupiter, 0.8) * 71492000 / skyDisplayMetres) ** 2);
  }
});
