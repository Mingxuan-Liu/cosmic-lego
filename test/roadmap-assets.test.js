import assert from 'node:assert/strict';
import test from 'node:test';
import { roadmap } from '../packages/atlas/roadmap.mjs';
import { diagramFor, roadmapGraph, visualsFor } from '../packages/atlas/roadmap-assets.mjs';

test('sharing a reference section only creates a reuse link when both phenomena nominate the same visual', () => {
  for (const nodes of [roadmap.domains, roadmap.phenomena]) {
    const {allEdges, edges} = roadmapGraph(nodes);
    const matching = new Map(allEdges.map(e => [[e.source,e.target].sort().join('/'),e]));
    for (const [index,a] of nodes.entries()) {
      assert.deepEqual(visualsFor(a.id).map(v => v.assetId).sort(), [...a.assetIds].sort());
      for (const b of nodes.slice(index + 1)) {
        const intersection = a.assetIds.filter(id => b.assetIds.includes(id)).sort();
        const pair = matching.get([a.id,b.id].sort().join('/'));
        assert.deepEqual([...(pair?.assetIds ?? [])].sort(), intersection);
      }
    }
    assert.ok(edges.length && edges.length < allEdges.length);
  }
});

test('visuals identify the original topic and its supporting textbook section or technique source', () => {
  const topics = new Map(roadmap.phenomena.map(n => [n.id,n]));
  for (const domain of roadmap.domains) {
    for (const {assetId,uses} of visualsFor(domain.id)) {
      const diagram = diagramFor(assetId);
      assert.ok(diagram.label && diagram.prompt);
      for (const use of uses) {
        const topic = topics.get(use.topicId);
        assert.equal(topic.parentId,domain.id);
        assert.ok(topic.assetIds.includes(assetId));
        if (!use.sectionId) {
          assert.equal(use.status, 'proposed');
          const nomination = topic.sourcedVisuals.find(v => v.assetId === assetId);
          assert.equal(use.rationale, nomination.rationale);
          assert.deepEqual(use.evidence, [nomination.source]);
        } else {
          assert.ok(topic.sectionIds.includes(use.sectionId));
        }
        assert.ok(use.evidence.length);
        if (use.status === 'demonstrated') assert.ok(topic.demonstratedAssetIds.includes(assetId));
      }
    }
  }
});

test('two-beam interference and recoil directions connect the specified techniques and physics topics', () => {
  const groups = [['two-beam-interference','interferometry','gravitational-wave-detection','linked-dishes'],
    ['solar-recoil-angle','solar-neutrinos','neutrino-detection']];
  for (const [assetId, ...ids] of groups) {
    const pairs = roadmapGraph(roadmap.phenomena.filter(n => ids.includes(n.id))).allEdges;
    assert.equal(pairs.length, ids.length*(ids.length-1)/2);
    for (const pair of pairs) {
      const diagram = pair.evidence.find(e => e.assetId === assetId);
      assert.equal(diagram.implementationStatus, 'proposed');
      assert.ok([...diagram.sourceUses,...diagram.targetUses].every(use =>
        use.status === 'proposed' && !use.sectionId && use.rationale && use.evidence[0].url.startsWith('https://')));
    }
  }
});
