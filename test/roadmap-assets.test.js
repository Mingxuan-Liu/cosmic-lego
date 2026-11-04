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

test('asset evidence names actual phenomena and retains the specific supporting reference section', () => {
  const topics = new Map(roadmap.phenomena.map(n => [n.id,n]));
  for (const domain of roadmap.domains) {
    for (const {assetId,uses} of visualsFor(domain.id)) {
      const diagram = diagramFor(assetId);
      assert.ok(diagram.label && diagram.prompt);
      for (const use of uses) {
        const topic = topics.get(use.topicId);
        assert.equal(topic.parentId,domain.id);
        assert.ok(topic.sectionIds.includes(use.sectionId) && topic.assetIds.includes(assetId));
        assert.ok(use.evidence.length);
        if (use.status === 'demonstrated') assert.ok(topic.demonstratedAssetIds.includes(assetId));
      }
    }
  }
});
