import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRuntime } from '../src/runtime/index.js';
import { createWorkspaceLayer } from '../src/workspace/index.js';
import { createPortableManifest, openPortableManifest, serializePortableManifest } from '../src/portable/format.js';
import { createPortableStore } from '../src/portable/store.js';
import { buildExample, dataSources, registryModule } from './workspace.mjs';
import { createRegistry } from './fixtures/workspace-registry.js';

const rateUnit = { symbol: '1/s', dimensions: { time: -1 }, scale: 1 };
const settings = { accumulator: { step: 0.25, tolerance: 1e-12 }, noise: { seed: 2871, step: 0.25, tolerance: 1e-12 } };
const targets = [{ nodeId: 'point-0', port: 'position' }, { nodeId: 'accumulator', port: 'value' }, { nodeId: 'noise', port: 'value' }];
const instant = value => ({ value, unit: 's' });

function addAccumulators(context) {
  const draft = context.project.begin(), author = context.binding.author(draft);
  const rate = author.constant({ kind: 'scalar', data: 2.5, unit: rateUnit, meaning: 'accumulation-rate' }, { id: 'rate' });
  author.instantiate('fixture.accumulator', { id: 'accumulator', inputs: { source: rate }, parameters: { initial: 1 } });
  author.instantiate('fixture.seeded-accumulator', { id: 'noise' });
  draft.accept();
}

async function sample(runtime, project, nodeId, port, time, settings, mode = 'auto') {
  const result = await runtime.submit(project, nodeId, { port, time, mode, settings }).promise;
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  return result;
}

async function render(context, runtime, time, settings, mode) {
  const results = [];
  for (const { nodeId, port } of context.layer.sources(context.project)) results.push(await sample(runtime, context.project, nodeId, port, time, settings, mode));
  const snapshot = await context.layer.compile(context.project, { time, results });
  assert.equal(snapshot.valid, true, JSON.stringify(snapshot.diagnostics));
  return { results, snapshot };
}

async function authorAndSave(store) {
  const context = buildExample(), { project } = context;
  const originalSource = await readFile(new URL('./workspace.mjs', import.meta.url), 'utf8');
  const source = { path: 'examples/workspace.mjs', language: 'javascript', text: originalSource, producedGraph: project.snapshot(),
    files: [{ path: 'examples/scene-and-assets.mjs', language: 'javascript', text: await readFile(new URL('./scene-and-assets.mjs', import.meta.url), 'utf8') }] };
  // These later authored changes are distinct from the graph produced by the
  // original workspace recipe. The portable file retains both associations.
  addAccumulators(context);
  const edit = project.begin(); context.layer.author(edit).update('mean-plot', { hidden: false, x: 470 }); edit.accept();
  const runtime = createRuntime({ registryModule });
  try {
    const time = instant(1), mode = 'auto', initial = await render(context, runtime, time, settings, mode);
    const point = await sample(runtime, project, 'point-0', 'position', time, settings, mode);
    const accumulator = await sample(runtime, project, 'accumulator', 'value', time, settings, mode);
    const noise = await sample(runtime, project, 'noise', 'value', time, settings, mode);
    assert.equal(accumulator.value.data, 3.5); assert.equal(noise.checkpoints[0].random.state.draws, 4);
    const manifest = createPortableManifest({ ...context, source, dataSources, playback: { policy: 'replay-from-initial', mode, time, settings, targets } });
    const saved = await store.save('portable-fixtures', serializePortableManifest(manifest), { expectedVersion: null, beforePublish() {
      assert.deepEqual(project.token, manifest.savedFrom);
    } });
    // Continue the original run to establish the expected next four random draws.
    const later = await sample(runtime, project, 'noise', 'value', instant(2), settings, mode);
    return { saved, originalSource, graph: project.snapshot(), identity: project.token, initial, point, accumulator, noise, later };
  } finally { await runtime.dispose(); }
}

export async function demonstrate({ directory } = {}) {
  const folder = directory ?? await mkdtemp(path.join(tmpdir(), 'cosmic-portable-example-'));
  try {
    const expected = await authorAndSave(await createPortableStore({ directory: folder }));
    // Reopen from the named UTF-8 file using a newly bound registry and a fresh
    // worker. The only inputs to replay are accepted graph data and run settings.
    const store = await createPortableStore({ directory: folder }), file = await store.read('portable-fixtures', { expectedVersion: expected.saved.version });
    const registry = createRegistry(), binding = registry.bind(), layer = createWorkspaceLayer(binding);
    const { project, manifest, sourceStatus } = openPortableManifest(file.document, { registry, binding, layer });
    assert.notEqual(project.token.generation, expected.identity.generation);
    assert.deepEqual(project.snapshot(), expected.graph); assert.deepEqual(project.history, { canUndo: false, canRedo: false });
    assert.equal(sourceStatus, 'diverged'); assert.equal(manifest.resources.find(file => file.path === manifest.source.original.path).content, expected.originalSource);
    assert.equal(manifest.playback.policy, 'replay-from-initial'); assert.equal(manifest.playback.settings.noise.seed, 2871);
    assert.deepEqual(manifest.dataSources, dataSources);
    assert.equal(manifest.sharing.transcriptIncluded, false);
    const runtime = createRuntime({ registryModule });
    try {
      const { time, settings: restored, mode } = manifest.playback;
      const point = await sample(runtime, project, 'point-0', 'position', time, restored, mode);
      const accumulator = await sample(runtime, project, 'accumulator', 'value', time, restored, mode);
      const noise = await sample(runtime, project, 'noise', 'value', time, restored, mode);
      assert.deepEqual(point.value, expected.point.value); assert.deepEqual(accumulator.value, expected.accumulator.value);
      assert.equal(noise.metadata.runtime.steps, 4); assert.deepEqual(noise.value, expected.noise.value);
      assert.deepEqual(noise.checkpoints[0].random, expected.noise.checkpoints[0].random);
      const later = await sample(runtime, project, 'noise', 'value', instant(2), restored, mode);
      assert.deepEqual(later.value, expected.later.value); assert.deepEqual(later.checkpoints[0].random, expected.later.checkpoints[0].random);
      assert.equal(later.checkpoints[0].random.state.draws, 8);
      const replay = await render({ project, layer }, runtime, time, restored, mode);
      for (const field of ['scalar-field', 'vector-field']) {
        const actual = replay.results.find(item => item.producer.nodeId === field);
        assert.deepEqual(actual.value, expected.initial.results.find(item => item.producer.nodeId === field).value);
      }
      assert.deepEqual(replay.snapshot.scene.assets, expected.initial.snapshot.scene.assets);
      assert.deepEqual(replay.snapshot.overlays.map(({ id, x, y, width, height, folded, hidden }) => [id, x, y, width, height, folded, hidden]),
        expected.initial.snapshot.overlays.map(({ id, x, y, width, height, folded, hidden }) => [id, x, y, width, height, folded, hidden]));
      const plot = replay.snapshot.overlays.find(overlay => overlay.id === 'mean-plot'); assert.equal(plot.x, 470); assert.equal(plot.hidden, false);
      return { ...(directory ? { file: path.join(directory, 'portable-fixtures.json') } : {}), diskVersion: file.version,
        sourceStatus, replayPolicy: manifest.playback.policy, savedSeconds: time.value, movingPointMeters: point.value.data,
        accumulator: accumulator.value.data, noiseAtOneSecond: noise.value.data, noiseAtTwoSeconds: later.value.data,
        randomDrawsAtTwoSeconds: later.checkpoints[0].random.state.draws, restoredFields: ['scalar-field', 'vector-field'],
        restoredAssets: replay.snapshot.scene.assets.length, restoredOverlays: replay.snapshot.overlays.length, freshGeneration: true };
    } finally { await runtime.dispose(); }
  } finally { if (!directory) await rm(folder, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--directory' && path.isAbsolute(args[1]))) throw new Error('Usage: portable-project.mjs [--directory /absolute/project-directory]');
  console.log(JSON.stringify(await demonstrate({ directory: args[1] }), null, 2));
}
