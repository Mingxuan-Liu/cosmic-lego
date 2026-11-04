import assert from 'node:assert/strict';
import test from 'node:test';
import { roadmap } from '../packages/atlas/roadmap.mjs';
import { learningLinks, foundationFor, buildFoundations } from '../packages/atlas/foundations.mjs';

test('foundation scores agree with independently measured shortest learning paths at both levels', () => {
  const {phenomena,domains} = roadmap;
  const index = new Map(phenomena.map((topic,i) => [topic.id,i]));
  const distance = phenomena.map((a,i) => phenomena.map((b,j) => i === j ? 0 : Infinity));
  for (const {from,to,reason} of learningLinks) {
    const i = index.get(from), j = index.get(to);
    assert.ok(i !== undefined && j !== undefined && i !== j && reason.length > 20);
    assert.equal(distance[i][j], Infinity, 'No repeated teaching step');
    distance[i][j] = 1;
  }
  for (let k = 0; k < phenomena.length; k++) {
    for (let i = 0; i < phenomena.length; i++) {
      for (let j = 0; j < phenomena.length; j++) {
        distance[i][j] = Math.min(distance[i][j], distance[i][k] + distance[k][j]);
      }
    }
  }
  for (const rows of [phenomena, domains]) {
    const matrix = rows === phenomena ? distance : domains.map(a => domains.map(b => {
      if (a === b) return 0;
      const from = phenomena.filter(n => n.parentId === a.id), to = phenomena.filter(n => n.parentId === b.id);
      return Math.min(...from.flatMap(x => to.map(y => distance[index.get(x.id)][index.get(y.id)])));
    }));
    const scores = matrix.map(row => Number(row.reduce((sum,d) => sum + (d ? 1/d : 0), 0).toFixed(12)));
    rows.forEach((row,i) => {
      const actual = foundationFor(row.id);
      const direct = rows.filter((n,j) => matrix[i][j] === 1);
      const reached = rows.filter((n,j) => n !== row && Number.isFinite(matrix[i][j]));
      const prerequisites = rows.filter((n,j) => matrix[j][i] === 1);
      assert.equal(actual.score,scores[i]);
      assert.equal(actual.mass,scores[i]+1);
      assert.deepEqual(new Set(actual.directIds),new Set(direct.map(n => n.id)));
      assert.deepEqual(new Set(actual.reachableIds),new Set(reached.map(n => n.id)));
      assert.deepEqual(new Set(actual.prerequisiteIds),new Set(prerequisites.map(n => n.id)));
      assert.equal(actual.examples.length,direct.length);
      assert.ok(actual.examples.every(e => learningLinks.includes(e)));
      assert.equal(actual.rank,1+scores.filter(s => s>scores[i]).length);
      assert.equal(actual.percentile,100*(scores.filter(s => s<scores[i]).length+scores.filter(s => s===scores[i]).length/2)/scores.length);
    });
  }
  assert.ok(foundationFor('orbital-periods').directIds.includes('stellar-masses'));
  assert.ok(foundationFor('stellar-parallax').reachableIds.includes('accelerating-expansion'));
});

test('page allocation, installation and shared asset metadata cannot change foundation scores', () => {
  const changed = rows => rows.map(n => ({...n, pages: 0, rank: 0, percentile: 0, availability: 'planned', launch:null, assetIds:[]}));
  const scores = buildFoundations(changed(roadmap.phenomena),changed(roadmap.domains),learningLinks);
  for (const n of [...roadmap.phenomena,...roadmap.domains]) {
    assert.deepEqual(scores.get(n.id),foundationFor(n.id));
  }
});

test('domains never borrow a learning path from an unrelated sibling', () => {
  const domains = ['A','B','C'].map(id => ({id}));
  const phenomena = ['A1','A2','B1','B2','C1'].map(id => ({id,parentId:id[0]}));
  const edge = (from,to) => ({from,to,reason:'Example teaching step'});
  const links = [edge('A1','B1'),edge('B2','C1'),edge('B2','A2')];
  const scores = buildFoundations(phenomena,domains,links);
  assert.deepEqual(scores.get('A').reachableIds,['B']);
  assert.deepEqual(scores.get('B').reachableIds,['A','C']);
  assert.equal(scores.get('C').score,0);
  assert.equal(scores.get('C').mass,1);
  assert.throws(() => buildFoundations(phenomena,domains,[...links,edge('B1','A1')]),/Circular/);
  assert.throws(() => buildFoundations(phenomena,domains,[...links,links[0]]),/Duplicate/);
});
