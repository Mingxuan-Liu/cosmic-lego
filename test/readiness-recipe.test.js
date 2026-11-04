import { createRuntime } from '../src/runtime/index.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildReadinessManifest } from '../experiments/f11-author.mjs';
import { createRegistry } from '../examples/fixtures/workspace-registry.js';
import { openPortableManifest } from '../src/portable/format.js';
import { createTimelineEvaluator } from '../src/timeline/evaluator.js';
import { createWorkspaceLayer } from '../src/workspace/index.js';

test('timing gate rebuilds with the same graph, attributed fields, and held measurements', async () => {
  const first = await buildReadinessManifest();
  const second = await buildReadinessManifest();
  assert.deepEqual(second.graph, first.graph);
  assert.equal(second.integrity.graphHash, first.integrity.graphHash);
  assert.equal(second.source.original.producedGraphHash, first.integrity.graphHash);
  assert.equal(second.source.original.sha256, first.source.original.sha256);
  const recipe = await readFile(new URL('../experiments/f11-author.mjs', import.meta.url), 'utf8');
  assert.equal(first.resources.find(resource => resource.path === first.source.original.path).content, recipe);
  assert.deepEqual(first.dataSources.map(entry => entry.nodeId).sort(), ['arrival-field', 'velocity-field']);
  for (const entry of first.dataSources) {
    assert.equal(entry.license, 'BSD-3-Clause');
    assert.match(entry.source, /experiments\/f11-author\.mjs/);
  }

  const registry = createRegistry();
  const binding = registry.bind();
  const context = { registry, binding, layer: createWorkspaceLayer(binding) };
  assert.equal(openPortableManifest(JSON.stringify(first), context).sourceStatus, 'matches');
  const evaluator = await createTimelineEvaluator({
    ...context, manifest: first, registryModule: new URL('../examples/fixtures/workspace-registry.js', import.meta.url),
  });
  try {
    const frame = await evaluator.evaluate(2);
    assert.deepEqual(frame.physicalTime, { value: 2, unit: 's' });
    const values = new Map(frame.results.map(result => [result.producer.nodeId, result.value.data]));
    assert.equal(values.get('mean-gate-radius'), 2 / 3);
    assert.equal(values.get('radius-margin'), 2 / 3 - 1);
    assert.equal(values.get('timing-dither'), 0.910199468024075);
  } finally {
    await evaluator.dispose();
  }
});

test('the saved four-puck project continues its seeded control from the held sample in a fresh worker', async () => {
  const registry = createRegistry(), binding = registry.bind();
  const { project, manifest } = openPortableManifest(
    await readFile(new URL('./fixtures/four-puck-project.json', import.meta.url), 'utf8'),
    { registry, binding, layer: createWorkspaceLayer(binding) },
  );
  const registryModule = new URL('../examples/fixtures/workspace-registry.js', import.meta.url);
  const first = createRuntime({ registryModule }), next = createRuntime({ registryModule });
  const sample = (runtime, time, extra = {}) => runtime.submit(project, 'timing-dither', {
    time: { value: time, unit: 's' }, settings: manifest.playback.settings, ...extra,
  }).promise;
  try {
    const held = await sample(first, 2);
    assert.equal(held.valid, true);
    assert.deepEqual(held.checkpoints[0].random.state, { value: 698001015, draws: 8 });
    const resumed = await sample(next, 4, { checkpoints: held.checkpoints });
    assert.equal(resumed.valid, true);
    assert.equal(resumed.metadata.runtime.steps, 8);
    assert.deepEqual(resumed.checkpoints[0].random.state, { value: 3698840831, draws: 16 });
    assert.equal(resumed.value.data, 1.8784071151167154);
  } finally {
    await Promise.all([first.dispose(), next.dispose()]);
  }
});
