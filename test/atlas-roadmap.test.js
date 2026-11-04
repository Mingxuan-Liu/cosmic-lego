import assert from 'node:assert/strict';
import test from 'node:test';
import { coverage } from '../packages/atlas/coverage.mjs';
import { roadmap } from '../packages/atlas/roadmap.mjs';
import { assetTemplates, topicAssetUses } from '../packages/atlas/reuse.mjs';

const { families, domains, phenomena, totals } = roadmap;
const byReference = new Map(coverage.sections.map(section => [section.id, section]));
const byId = new Map([...families, ...domains, ...phenomena].map(node => [node.id, node]));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, 'Expected ' + a + ' to equal ' + b);

test('the roadmap has original short labels, study questions and original explanations within a phenomenon hierarchy', () => {
  assert.deepEqual(totals, { families: 4, domains: 29, phenomena: 104, sections: 119, pages: 1274 });
  assert.equal(byId.size, families.length + domains.length + phenomena.length);
  for (const peers of [domains, phenomena]) {
    assert.equal(new Set(peers.map(p => p.order)).size, peers.length);
    assert.equal(new Set(peers.map(p => p.label)).size, peers.length);
    for (const n of peers) {
      assert.match(n.id, /^[a-z][a-z0-9-]+$/);
      assert.ok(n.label.length <= 24, n.label);
      assert.ok(n.label.split(' ').length <= 4, n.label);
      assert.match(n.question, /\?$/);
      assert.ok(n.sectionIds.length && new Set(n.sectionIds).size === n.sectionIds.length);
      assert.ok(families.some(f => f.id === n.partId));
      assert.ok(n.sectionIds.every(id => byReference.has(id)));
      assert.ok(Object.isFrozen(n));
    }
  }
  for (const n of phenomena) {
    assert.equal(byId.get(n.parentId).partId, n.partId);
    assert.equal(byId.get(n.parentId).level, 'domain');
    assert.ok(n.insight.length > 45, n.id);
  }
  assert.ok(domains.some(n => new Set(n.sectionIds.map(s => byReference.get(s).parentId)).size >= 5));
  assert.equal(byId.get('eclipses').parentId, 'sky-cycles');
  assert.deepEqual(byId.get('meteor-showers').sectionIds, ['sec-19-1', 'sec-22-4']);
});

test('every printed section is divided equally among its mapped phenomena and counted once at either roadmap level', () => {
  const allocated = new Map();
  for (const s of coverage.sections) {
    const members = phenomena.filter(n => n.sectionIds.includes(s.id));
    assert.ok(members.length, s.id);
    const share = s.pages / members.length;
    for (const n of members) {
      allocated.set(n.id, (allocated.get(n.id) ?? 0) + share);
      const allocation = n.allocations.find(a => a.sectionId === s.id);
      near(allocation.pages, share);
      assert.equal(allocation.share, members.length);
    }
    const directSum = domains.reduce((sum, d) => sum + (d.allocations.find(a => a.sectionId === s.id)?.pages ?? 0), 0);
    near(directSum, s.pages);
  }
  for (const n of phenomena) near(n.pages, allocated.get(n.id));
  for (const d of domains) {
    const children = phenomena.filter(n => n.parentId === d.id);
    near(d.pages, children.reduce((sum, n) => sum + allocated.get(n.id), 0));
    assert.deepEqual(new Set(d.sectionIds), new Set(children.flatMap(n => n.sectionIds)));
  }
  for (const peers of [domains, phenomena]) {
    near(peers.reduce((sum, n) => sum + n.pages, 0), coverage.totals.pages);
    for (const n of peers) {
      const shorter = peers.filter(p => p.pages < n.pages).length;
      const tied = peers.filter(p => p.pages === n.pages).length;
      assert.equal(n.rank, 1 + peers.length - tied - shorter);
      assert.equal(n.peerCount, peers.length);
      near(n.percentile, 100 * (shorter + tied / 2) / peers.length);
    }
  }
});

test('only relevant, evidenced visuals are nominated and study availability is independent from asset use', () => {
  const ids = new Set(assetTemplates.map(a => a.id));
  for (const n of phenomena) {
    for (const id of n.assetIds) {
      assert.ok(ids.has(id));
      assert.ok(topicAssetUses.some(use => use.assetId === id && n.sectionIds.includes(use.topicId)), n.id + ': ' + id);
    }
    for (const id of n.demonstratedAssetIds) {
      assert.ok(n.assetIds.includes(id));
      assert.ok(topicAssetUses.some(use => use.assetId === id && use.status === 'demonstrated' && n.sectionIds.includes(use.topicId)), n.id);
    }
    assert.equal(Boolean(n.launch), n.availability === 'available');
  }
  assert.deepEqual(phenomena.filter(n => n.launch).map(n => n.id), ['planetary-transits']);
  assert.equal(byId.get('planetary-transits').launch.href, '/studies/planetary-transits/');
  assert.equal(byId.get('orbital-periods').availability, 'planned');
  assert.deepEqual(byId.get('orbital-periods').demonstratedAssetIds, ['kepler-state']);
  assert.deepEqual(byId.get('stellar-wobble').demonstratedAssetIds, []);
  for (const d of domains) {
    const children = phenomena.filter(n => n.parentId === d.id);
    assert.equal(d.availability === 'available', children.some(n => n.launch));
    assert.deepEqual(new Set(d.assetIds), new Set(children.flatMap(n => n.assetIds)));
    assert.deepEqual(new Set(d.demonstratedAssetIds), new Set(children.flatMap(n => n.demonstratedAssetIds)));
  }
});
