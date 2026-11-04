import test from 'node:test';
import assert from 'node:assert/strict';
import { locateStars } from '../demo/atlas/layout.js';
import { roadmap } from '../packages/atlas/roadmap.mjs';
import { foundationFor } from '../packages/atlas/foundations.mjs';

for (const rows of [roadmap.domains, roadmap.phenomena]) {
  const topics = rows.map(n => ({ ...n, ...foundationFor(n.id) }));
  test(topics[0].level + ' maps place equal ranks at equal distances from their true center of mass', () => {
    const stars = locateStars(topics);
    assert.deepEqual(locateStars([...topics].reverse()), stars);
    const totalMass = stars.reduce((sum, star) => sum + star.mass, 0);
    const center = ['x', 'y', 'z'].map(axis =>
      stars.reduce((sum, star) => sum + star.mass * star[axis], 0) / totalMass);
    // Measure the result from the independently computed center, including its depth.
    const distance = s => Math.hypot(s.x - center[0], s.y - center[1], s.z - center[2]);
    assert.ok(Math.hypot(...center) < 1e-11, 'Camera origin must coincide with the weighted center.');
    assert.ok(distance(stars[0]) < 1e-11);
    assert.ok(Math.abs(distance(stars.at(-1)) - 1) < 1e-11);
    const distinctPositions = new Set();
    let last = stars[0];
    for (const star of stars) {
      const q = (star.percentile - stars.at(-1).percentile) / (stars[0].percentile - stars.at(-1).percentile);
      assert.ok(Math.abs(star.size - 2 * 9 ** q) < 1e-12);
      assert.equal(star.flat.z, 0);
      assert.ok(Math.abs(Math.hypot(star.flat.x, star.flat.y) - distance(star)) < 1e-11);
      if (star.score === last.score) assert.ok(Math.abs(distance(star) - distance(last)) < 1e-11);
      else assert.ok(star.score < last.score && distance(star) > distance(last));
      distinctPositions.add([star.x, star.y, star.z].join(','));
      last = star;
    }
    assert.equal(distinctPositions.size, topics.length);
    const flatCentroid = ['x','y'].map(axis =>
      stars.reduce((sum,s) => sum + s.mass * s.flat[axis],0) / totalMass);
    assert.ok(Math.hypot(...flatCentroid) < 1e-11, 'Flat map has the same weighted center and radial order.');
    assert.equal(stars[0].size / stars.at(-1).size, 9);

    // At least one tetrahedron with a base at the origin must enclose appreciable
    // volume. This catches a planar scatter plot shown from a tilted camera.
    const [a, b] = stars.slice(-2);
    const volumes = stars.map(c => Math.abs(
      (a.y*b.z - a.z*b.y)*c.x + (a.z*b.x - a.x*b.z)*c.y + (a.x*b.y - a.y*b.x)*c.z) / 6);
    assert.ok(Math.max(...volumes) > 0.01);
  });
}

test('learning-layout mass takes priority over reference pages even with very small masses and many tied leaves', () => {
  const nodes = Array.from({length: 29}, (_, i) => ({
    id: 'topic-' + i, partId: 'field-' + i % 3, order: i,
    percentile: i < 4 ? 90 - 9*i : 20, mass: (i < 4 ? 6 - i : 1) * 1e-300,
    pages: i === 26 ? 2000 : 2,
  }));
  const stars = locateStars(nodes);
  for (const flat of [true, false]) {
    const total = nodes.reduce((sum, n) => sum + n.mass, 0);
    const center = ['x','y','z'].map(axis =>
      stars.reduce((sum, n) => sum + n.mass/total * (flat ? n.flat : n)[axis], 0));
    assert.ok(Math.hypot(...center) < 1e-11);
    for (const n of stars) {
      const p = flat ? n.flat : n;
      assert.ok(Math.abs(Math.hypot(p.x,p.y,p.z) - n.radius) < 1e-11);
      if (n.percentile === 20) assert.equal(n.radius, 1);
    }
  }
});

test('tied scores and zero masses yield finite distinct positions, and a lone topic stays centered', () => {
  const nodes = Array.from({length: 67}, (_, i) => ({
    id: 'topic-' + i, partId: 'field', percentile: 100, mass: 0,
  }));
  const ties = locateStars(nodes);
  assert.equal(new Set(ties.map(n => n.flat.x + ',' + n.flat.y)).size, nodes.length);
  for (const n of ties) {
    assert.ok(Math.abs(Math.hypot(n.x,n.y,n.z) - 1) < 1e-11);
    assert.ok(Math.abs(Math.hypot(n.flat.x,n.flat.y) - 1) < 1e-11);
  }
  assert.equal(locateStars([nodes[0]])[0].radius, 0);
});
