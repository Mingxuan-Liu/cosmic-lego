import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { coverage } from '../packages/atlas/coverage.mjs';
import { assetTemplates, assetsForTopic, buildReuseGraph, topicAssetUses } from '../packages/atlas/reuse.mjs';
import { buildExample as makeSkyStudy } from '../packages/exoplanet/recipe.mjs';
import { buildExample as makeScene } from '../examples/scene-and-assets.mjs';

test('cited recipes and template specifications resolve to local evidence', async () => {
  const files = new Map();
  const refs = [...assetTemplates.flatMap(asset => asset.source), ...topicAssetUses.flatMap(use => use.evidence)];
  for (const ref of refs) {
    if (!files.has(ref.path)) files.set(ref.path, readFile(new URL('../' + ref.path, import.meta.url), 'utf8'));
    assert.ok((await files.get(ref.path)).includes(ref.anchor), ref.path + ' / ' + ref.anchor);
  }
  assert.equal(new Set(assetTemplates.map(asset => asset.id)).size, assetTemplates.length);
  const sections = new Set(coverage.sections.map(topic => topic.id));
  for (const asset of assetTemplates) {
    assert.ok(asset.inputContract && asset.limits && asset.summary);
    const uses = topicAssetUses.filter(use => use.assetId === asset.id);
    assert.ok(uses.length >= 2);
    assert.equal(new Set(uses.map(use => use.topicId)).size, uses.length);
    for (const use of uses) {
      assert.ok(sections.has(use.topicId) && use.rationale);
      if (asset.implementationStatus === 'proposed') assert.equal(use.status, 'proposed');
      if (use.status === 'demonstrated') assert.ok(use.evidence.every(ref => ref.path !== 'packages/atlas/reuse.mjs'));
    }
  }
});

test('authored assets exist in the executable science or generic demonstration graph', () => {
  const sky = new Map(makeSkyStudy().project.snapshot().nodes.map(n => [n.id, n]));
  assert.equal(sky.get('ember').type, 'exoplanet.orbit');
  assert.equal(sky.get('shape-ember').type, 'exoplanet.silhouette');
  assert.equal(sky.get('place-ember').references['input.source'], 'sky-ember');
  assert.equal(sky.get('curve-transit').references['input.source'], 'transit');
  const scene = new Map(makeScene().project.snapshot().nodes.map(n => [n.id, n]));
  assert.equal(scene.get('moving-points').type, 'scene.points');
  assert.equal(scene.get('scalar-binding').data.parameters.unit, 'K');
  assert.equal(scene.get('vector-binding').data.parameters.unit, 'm/s');
});

test('a chapter counts each asset once and retains all section-specific uses', () => {
  const orbit = assetsForTopic('ch-2').find(mapping => mapping.assetId === 'kepler-state');
  assert.equal(orbit.status, 'demonstrated');
  assert.deepEqual(orbit.uses.map(use => use.topicId), ['sec-2-1', 'sec-2-3']);
  assert.ok(coverage.chapters.every(topic => assetsForTopic(topic.id).length));
  assert.deepEqual(assetsForTopic('sec-1-4'), []);
  assert.deepEqual(assetsForTopic('unknown'), []);
  const pair = (...numbers) => buildReuseGraph(coverage.chapters.filter(node => numbers.includes(node.number))).allEdges[0];
  const proven = pair('2', '7');
  assert.deepEqual(proven.assetIds, ['kepler-state']); assert.equal(proven.status, 'demonstrated');
  const proposed = pair('4', '17');
  assert.deepEqual(proposed.assetIds, ['spacetime-cone']); assert.equal(proposed.authoredCount, 0);
  assert.equal(proposed.status, 'proposed'); assert.equal(proposed.demonstratedCount, 0);
  const potential = pair('18', '24');
  assert.ok(potential.assetIds.includes('velocity-arrows') && potential.authoredCount > 0);
  assert.equal(potential.demonstratedCount, 0);
});

test('shared IDs explain every edge, including links outside the sparse overview', () => {
  for (const nodes of [coverage.parts, coverage.chapters, coverage.sections]) {
    const { edges, allEdges, policy } = buildReuseGraph(nodes);
    assert.equal(policy.omitted, allEdges.length - edges.length);
    assert.ok(edges.every(edge => allEdges.includes(edge)));
    assert.equal(new Set(allEdges.map(e => e.source + '/' + e.target)).size, allEdges.length);
    for (const node of nodes) assert.ok(edges.filter(e => e.source === node.id || e.target === node.id).length <= 3);
    for (const edge of allEdges) {
      assert.notEqual(edge.source, edge.target);
      const right = new Set(assetsForTopic(edge.target).map(item => item.assetId));
      const shared = assetsForTopic(edge.source).map(item => item.assetId).filter(id => right.has(id));
      assert.deepEqual(edge.assetIds, shared);
      assert.equal(edge.weight, shared.length);
      assert.deepEqual(edge.evidence.map(item => item.assetId), edge.assetIds);
      for (const item of edge.evidence) assert.ok(item.sourceUses.length && item.targetUses.length);
    }
  }
  const { edges, allEdges } = buildReuseGraph(coverage.chapters, { maxDegree: 0 });
  assert.deepEqual(edges, []); assert.ok(allEdges.length > 0);
});

test('changing textbook page counts, importance ranks or input order cannot change an edge', () => {
  const altered = coverage.chapters.toReversed().map(node => ({ ...node, pages: 1, percentile: 0, rank: 999 }));
  const reference = buildReuseGraph(coverage.chapters);
  assert.deepEqual(buildReuseGraph(altered).edges, reference.edges);
  assert.deepEqual(buildReuseGraph(altered).allEdges, reference.allEdges);
  assert.throws(() => buildReuseGraph([coverage.parts[0], coverage.sections[0]]));
  assert.throws(() => buildReuseGraph([coverage.parts[0], coverage.parts[0]]));
  assert.throws(() => buildReuseGraph([{ id: 'missing' }]));
  assert.throws(() => buildReuseGraph([], { maxDegree: -1 }));
});
