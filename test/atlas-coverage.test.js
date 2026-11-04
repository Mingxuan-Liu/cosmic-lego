import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { coverage } from '../packages/atlas/coverage.mjs';

test('section numbers and start pages match the independently extracted publisher ledger', () => {
  const { sections, totals } = coverage;
  assert.deepEqual(totals, { parts: 4, chapters: 30, sections: 119, pages: 1274 });
  const ledger = sections.map(s => s.number + '=' + s.startPage + '\n').join('');
  assert.equal(createHash('sha256').update(ledger).digest('hex'), 'a48a10dc78b5a3be78efa0e57f88cf4d663a74854086c880f2e764c3ad76aee8');
});

test('sections partition chapters and chapters partition parts while excluding dividers and appendices', () => {
  const { parts, chapters, sections } = coverage;
  assert.deepEqual(parts.map(p => p.dividerPage), [1, 179, 713, 873]);
  assert.deepEqual(parts.map(p => p.pages), [177, 533, 159, 405]);
  assert.equal(sections.at(-1).startPage, 1247);
  assert.equal(sections.at(-1).endPage, 1278);
  for (const [parents, children] of [[parts, chapters], [chapters, sections]]) {
    for (const node of parents) {
      const members = children.filter(row => row.parentId === node.id);
      assert.ok(members.length);
      assert.equal(members[0].startPage, node.startPage);
      assert.equal(members.at(-1).endPage, node.endPage);
      assert.equal(members.reduce((sum, row) => sum + row.pages, 0), node.pages);
      for (let i = 1; i < members.length; i++) assert.equal(members[i].startPage, members[i-1].endPage + 1);
    }
  }
  assert.equal(sections.filter(s => s.isChapterTail).length, 30);
  assert.equal(sections.filter(s => s.isChapterTail).reduce((sum, s) => sum + s.pages, 0), 451);
});

test('emphasis uses within-level midranks, gives equal spans equal scores and keeps raw shares', () => {
  const { parts, chapters, sections, totals } = coverage;
  const nodes = new Map([...parts, ...chapters, ...sections].map(n => [n.id, n]));
  assert.equal(nodes.size, 153);
  for (const peers of [parts, chapters, sections]) {
    for (const row of peers) {
      const longer = peers.filter(p => p.pages > row.pages).length;
      const ties = peers.filter(p => p.pages === row.pages).length;
      const shorter = peers.length - ties - longer;
      assert.equal(row.pages, row.endPage - row.startPage + 1);
      assert.equal(row.rank, 1 + longer);
      assert.equal(row.peerCount, peers.length);
      assert.equal(row.percentile, 100 * (shorter + ties / 2) / peers.length);
      assert.equal(row.percentOfParent, 100 * row.pages / (nodes.get(row.parentId)?.pages ?? totals.pages));
      assert.equal(row.percentOfBook, 100 * row.pages / totals.pages);
    }
  }
  assert.equal(nodes.get('ch-29').rank, 1);
  assert.equal(nodes.get('ch-25').rank, 5);
  assert.equal(nodes.get('ch-28').rank, 5);
});

test('original labels and search aliases preserve locatable scientific concepts', () => {
  const sections = new Map(coverage.sections.map(s => [s.number, s]));
  for (const [key, term] of [['8.2', 'Hertzsprung–Russell'], ['10.4', 'thermodynamics'], ['14.5', 'asteroseismology'],
    ['16.4', 'Chandrasekhar'], ['16.7', 'pulsars'], ['18.1', 'Roche'], ['29.2', 'Big Bang nucleosynthesis']]) {
    const row = sections.get(key);
    assert.ok([row.label, ...row.keywords].join(' ').includes(term));
    assert.ok(Object.isFrozen(row.keywords));
  }
});
