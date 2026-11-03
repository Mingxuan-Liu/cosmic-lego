import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Project, validateProject } from '../src/core/index.js';

// These are software-fixture contracts supplied by the composition root.
// In particular, the kernel itself must not know what a point or label means.
const fixtures = {
  structure: [project => project.nodes.length > 40
    ? [{ code: 'FIXTURE_LIMIT', path: '$.nodes', message: 'Fixture supports at most 40 nodes.' }]
    : []],
  types: {
    'fixture:point': node => Array.isArray(node.data.position)
      && node.data.position.length === 3
      && node.data.position.every(Number.isFinite)
      ? []
      : [{ code: 'POINT_POSITION', path: `${node.id}.data.position`, message: 'A point needs a finite 3-vector.' }],
    'fixture:label': (node, { project, get }) => {
      const anchors = project.nodes.filter(candidate => candidate.kind === 'relationship'
        && candidate.type === 'fixture:anchor' && candidate.references.source === node.id);
      return anchors.length === 1 && get(anchors[0].references.target)?.type === 'fixture:point'
        ? []
        : [{ code: 'LABEL_ANCHOR', path: node.id, message: 'Connect this label to exactly one point.' }];
    },
  },
};

const component = (id, options = {}) => ({
  op: 'create', node: { id, type: 'fixture:plain', ...options },
});
const ids = project => project.snapshot().nodes.map(node => node.id).sort();
const before = project => ({ data: project.snapshot(), token: project.token, history: project.history });
const unchanged = (project, prior) => {
  assert.deepEqual(project.snapshot(), prior.data);
  assert.deepEqual(project.token, prior.token);
  assert.deepEqual(project.history, prior.history);
};

test('an empty core project accepts generic definitions and ordinary author loops', () => {
  const project = new Project({ id: 'empty', title: 'No astronomy installed', validators: fixtures });
  assert.equal(validateProject(project.snapshot(), fixtures).valid, true);
  assert.deepEqual(project.snapshot().nodes, []);
  const draft = project.begin();
  function addLabeledPoint(index) {
    const point = draft.component('fixture:point', { id: `point-${index}`, data: { position: [index, 0, 0] } });
    const label = draft.component('fixture:label', { id: `label-${index}`, data: { text: `Point ${index}` } });
    label.connect('fixture:anchor', point, { id: `anchor-${index}` });
    return point;
  }
  const points = Array.from({ length: 4 }, (_, index) => addLabeledPoint(index));
  draft.calculation('fixture:definition', { id: 'calculation', data: { operator: 'future-operator' }, dependsOn: points.map(p => p.id) });
  draft.presentation('fixture:view', { id: 'view', references: { value: 'calculation' }, data: { title: 'A generic view' } });
  draft.accept();
  assert.equal(project.snapshot().nodes.length, 14);
  assert.deepEqual(project.get('point-3').value.data.position, [3, 0, 0]);
  assert.equal(project.get('calculation').value.kind, 'calculation');
  assert.equal(project.get('view').value.kind, 'presentation');
});

test('a staged label receives its required relationship before authoritative acceptance', () => {
  const project = new Project({ validators: fixtures });
  const prior = before(project);
  const draft = project.begin();
  const label = draft.component('fixture:label', { id: 'label', data: { text: 'Attach me' } });
  assert.equal(draft.validate().valid, false);
  assert.ok(draft.validate().errors.some(error => error.code === 'LABEL_ANCHOR'));
  assert.throws(() => project.accept(draft));
  unchanged(project, prior);

  const point = draft.component('fixture:point', { id: 'point', data: { position: [1, 2, 3] } });
  draft.connect('fixture:anchor', label, point, { id: 'anchor' });
  assert.equal(draft.validate().valid, true);
  draft.accept();
  assert.deepEqual(project.get('anchor').value.references, { source: 'label', target: 'point' });
});

test('injected structural and type fixture constraints reject otherwise valid graphs', () => {
  const project = new Project({ validators: fixtures });
  const prior = before(project);
  const oversized = project.preview(Array.from({ length: 41 }, (_, index) => component(`p-${index}`)), project.token);
  assert.equal(oversized.validation.valid, false);
  assert.ok(oversized.validation.errors.some(error => error.code === 'FIXTURE_LIMIT'));
  assert.throws(() => project.apply(Array.from({ length: 41 }, (_, index) => component(`p-${index}`)), project.token));
  unchanged(project, prior);
  const malformedPoint = project.preview([component('bad-point', { type: 'fixture:point', data: { position: [1, 2] } })], project.token);
  assert.ok(malformedPoint.validation.errors.some(error => error.code === 'POINT_POSITION'));
  assert.throws(() => project.apply([component('bad-point', { type: 'fixture:point', data: { position: [1, 2] } })], project.token));
  unchanged(project, prior);
});

test('atomic multi-operation failure preserves content, token, and undo history', () => {
  const project = new Project();
  project.apply([component('existing', { data: { value: 1 } })], project.token);
  const prior = before(project);
  assert.throws(() => project.apply([
    { op: 'update', id: 'existing', patch: { data: { value: 99 } } },
    component('temporary'),
    { op: 'update', id: 'missing', patch: { data: { value: 2 } } },
  ], project.token));
  unchanged(project, prior);
});

test('broken references and duplicate IDs across node kinds reject atomic acceptance', () => {
  const project = new Project();
  project.apply([component('a')], project.token);
  for (const operations of [
    [component('dangling', { references: { target: 'absent' } })],
    [component('consumer', { dependsOn: ['absent'] })],
    [component('new'), component('a', { kind: 'presentation' })],
    [component('same'), component('same', { kind: 'calculation' })],
    [{ op: 'connect', id: 'broken-relationship', type: 'fixture:link', source: 'a', target: 'absent' }],
  ]) {
    const prior = before(project);
    assert.throws(() => project.apply(operations, project.token));
    unchanged(project, prior);
  }

  // Serialized input has the same reference/identity boundary as author commands.
  const broken = project.snapshot();
  broken.nodes.push({ ...broken.nodes[0], kind: 'presentation' });
  assert.equal(validateProject(broken).valid, false);
  assert.throws(() => Project.from(broken));
});

test('forward references can resolve within one batch without intermediate full validation', () => {
  const project = new Project();
  project.apply([
    component('dependent', { references: { target: 'target' }, dependsOn: ['target'] }),
    component('target'),
  ], project.token);
  assert.deepEqual(project.get('dependent').value.references, { target: 'target' });
  assert.deepEqual(project.dependencies('dependent', { edge: 'computation' }), ['target']);
});

test('non-mutating previews show candidate content and validation without changing history', () => {
  const project = new Project({ validators: fixtures });
  const prior = before(project);
  const valid = project.preview([
    component('p', { type: 'fixture:point', data: { position: [0, 0, 0] } }),
  ], project.token);
  assert.equal(valid.validation.valid, true);
  assert.equal(valid.project.nodes[0].id, 'p');
  assert.deepEqual(valid.baseToken, prior.token);
  unchanged(project, prior);

  const invalid = project.preview([
    component('label', { type: 'fixture:label' }),
  ], project.token);
  assert.equal(invalid.validation.valid, false);
  unchanged(project, prior);
  valid.project.nodes[0].data.position[0] = 999;
  unchanged(project, prior);
});

test('a preview is advisory: a later commit invalidates the preview token and old draft', () => {
  const project = new Project();
  const draft = project.begin();
  draft.component('fixture:plain', { id: 'old-draft' });
  const preview = project.preview([component('previewed')], project.token);
  project.apply([component('winner')], project.token);
  const prior = before(project);
  assert.throws(() => project.apply([component('previewed')], preview.baseToken));
  assert.throws(() => project.accept(draft));
  unchanged(project, prior);
});

test('every raw mutation requires the full current identity token', () => {
  const project = new Project({ id: 'identity' });
  project.apply([component('a')], project.token);
  const current = project.token;
  for (const token of [
    undefined, {}, { revision: current.revision },
    { ...current, projectId: 'another-project' },
    { ...current, generation: 'old-generation' },
    { ...current, revision: current.revision - 1 },
  ]) {
    const prior = before(project);
    assert.throws(() => project.apply([component('b')], token));
    unchanged(project, prior);
  }
});

test('undo/redo restores exact content and references while always issuing fresh revisions', () => {
  const project = new Project({ id: 'history' });
  project.apply([
    component('p'), component('label'),
    { op: 'connect', id: 'anchor', type: 'fixture:anchor', source: 'label', target: 'p' },
  ], project.token);
  const original = project.snapshot();
  const oldToken = project.token;
  project.apply([{ op: 'update', id: 'p', patch: { data: { x: 7 } } }], project.token);
  const revised = project.snapshot();
  const editToken = project.token;
  project.undo(project.token);
  assert.deepEqual(project.snapshot(), original);
  assert.ok(project.token.revision > editToken.revision);
  assert.equal(project.token.projectId, oldToken.projectId);
  assert.equal(project.token.generation, oldToken.generation);
  const undoToken = project.token;
  assert.throws(() => project.apply([component('stale')], oldToken));
  project.redo(project.token);
  assert.deepEqual(project.snapshot(), revised);
  assert.ok(project.token.revision > undoToken.revision);
  assert.deepEqual(project.get('anchor').value.references, { source: 'label', target: 'p' });
  assert.equal(project.history.canRedo, false);
});

test('a failed branch edit preserves redo; an accepted edit after undo discards it', () => {
  const project = new Project();
  project.apply([component('a')], project.token);
  project.apply([component('b')], project.token);
  project.undo(project.token);
  assert.equal(project.history.canRedo, true);
  const prior = before(project);
  assert.throws(() => project.apply([component('broken', { references: { target: 'absent' } })], project.token));
  unchanged(project, prior);
  project.apply([component('c')], project.token);
  assert.equal(project.history.canRedo, false);
  const branched = before(project);
  assert.throws(() => project.redo(project.token));
  unchanged(project, branched);
  assert.deepEqual(ids(project), ['a', 'c']);
});

test('loading the same graph or another project rotates generation and invalidates old handles', () => {
  const project = new Project({ id: 'one' });
  project.apply([component('p')], project.token);
  const saved = project.snapshot();
  const retained = project.get('p');
  const old = project.token;
  project.apply([{ op: 'update', id: 'p', patch: { data: { value: 2 } } }], project.token);
  project.load(saved, project.token);
  assert.deepEqual(project.snapshot(), saved);
  assert.equal(project.token.projectId, old.projectId);
  assert.notEqual(project.token.generation, old.generation);
  assert.equal(project.history.canUndo, false);
  assert.equal(project.history.canRedo, false);
  assert.throws(() => retained.value);
  assert.throws(() => project.apply([component('stale')], old));

  const beforeOther = project.token;
  const other = new Project({ id: 'two' });
  project.load(other.snapshot(), project.token);
  assert.equal(project.token.projectId, 'two');
  assert.notEqual(project.token.generation, beforeOther.generation);
  assert.throws(() => project.apply([component('stale')], beforeOther));

  const reopened = Project.from(saved);
  assert.notEqual(reopened.token.generation, old.generation);
  assert.throws(() => reopened.apply([component('stale')], old));
});

test('invalid or stale loads leave accepted content and generation untouched', () => {
  const project = new Project({ validators: fixtures });
  const old = project.token;
  project.apply([component('p', { type: 'fixture:point', data: { position: [0, 0, 0] } })], project.token);
  const invalid = project.snapshot();
  invalid.nodes[0].data.position = [NaN, 0, 0];
  const prior = before(project);
  assert.throws(() => project.load(invalid, project.token));
  unchanged(project, prior);
  assert.throws(() => project.load(project.snapshot(), old));
  unchanged(project, prior);
});

test('reopened projects support undo and redo after their first accepted edit', () => {
  const authored = new Project({ id: 'round-trip' });
  authored.apply([
    component('point'), component('label', { references: { target: 'point' } }),
  ], authored.token);
  const saved = authored.snapshot();
  const reopened = Project.from(JSON.parse(JSON.stringify(saved)));
  assert.equal(reopened.history.canUndo, false);
  const tokenAtLoad = reopened.token;
  reopened.apply([{ op: 'update', id: 'point', patch: { data: { position: [9, 8, 7] } } }], reopened.token);
  const edited = reopened.snapshot();
  reopened.undo(reopened.token);
  assert.deepEqual(reopened.snapshot(), saved);
  assert.ok(reopened.token.revision > tokenAtLoad.revision);
  assert.throws(() => reopened.apply([component('stale')], tokenAtLoad));
  reopened.redo(reopened.token);
  assert.deepEqual(reopened.snapshot(), edited);
});

test('a draft from a prior load cannot mint a fresh-looking handle for stale content', () => {
  const project = new Project();
  project.apply([component('p', { data: { value: 'saved' } })], project.token);
  const draft = project.begin();
  const oldHandle = draft.get('p');
  oldHandle.set({ data: { value: 'old-draft' } });
  const saved = project.snapshot();
  project.load(saved, project.token);
  const prior = before(project);
  assert.throws(() => oldHandle.value);
  assert.throws(() => draft.get('p').value);
  assert.throws(() => draft.accept());
  unchanged(project, prior);
});

test('stable handles retain IDs across accepted edits and never expose writable accepted state', () => {
  const project = new Project();
  const data = { position: [0, 1, 2] };
  project.apply([component('p', { data })], project.token);
  const handle = project.get('p');
  data.position[0] = 500;
  const value = handle.value;
  // Read models may be frozen or detached copies. Neither may mutate accepted data.
  try { value.data.position[0] = 600; } catch (error) { assert.ok(error instanceof TypeError); }
  assert.deepEqual(handle.value.data.position, [0, 1, 2]);
  project.apply([{ op: 'update', id: 'p', patch: { data: { position: [3, 4, 5] } } }], project.token);
  assert.equal(handle.id, 'p');
  assert.deepEqual(handle.value.data.position, [3, 4, 5]);
  project.undo(project.token);
  assert.deepEqual(handle.value.data.position, [0, 1, 2]);
});

test('ordinary cyclic relationships and references work, and queries keep computation separate', () => {
  const project = new Project();
  project.apply([
    component('a', { references: { peer: 'b' } }),
    component('b', { references: { peer: 'c' } }),
    component('c', { references: { peer: 'a' } }),
    { op: 'connect', id: 'ab', type: 'fixture:link', source: 'a', target: 'b' },
    { op: 'connect', id: 'ba', type: 'fixture:link', source: 'b', target: 'a' },
    component('result', { kind: 'calculation', dependsOn: ['a'] }),
    component('summary', { kind: 'calculation', dependsOn: ['result'] }),
  ], project.token);
  assert.equal(validateProject(project.snapshot()).valid, true);
  assert.deepEqual(project.dependencies('a', { edge: 'reference', direction: 'outgoing', transitive: true }), ['b', 'c']);
  assert.deepEqual(project.dependencies('a', { edge: 'computation', direction: 'outgoing', transitive: true }), []);
  assert.deepEqual(project.dependencies('a', { edge: 'computation', direction: 'incoming', transitive: true }), ['result', 'summary']);
  assert.deepEqual(project.dependencies('ab', { edge: 'reference' }), ['a', 'b']);
  assert.deepEqual(project.get('summary').dependencies({ edge: 'computation', transitive: true }), ['a', 'result']);
});

test('unhandled computational cycles reject acceptance without banning reference cycles', () => {
  const project = new Project();
  for (const operations of [
    [component('a', { dependsOn: ['a'] })],
    [component('a', { dependsOn: ['b'] }), component('b', { dependsOn: ['a'] })],
  ]) {
    const prior = before(project);
    assert.throws(() => project.apply(operations, project.token));
    unchanged(project, prior);
  }
});

test('referenced removals reject by default and deliberate cascade visits cycles once', () => {
  const project = new Project();
  project.apply([
    component('a', { references: { peer: 'b' } }),
    component('b', { references: { peer: 'a' } }),
    component('keep'),
    component('result', { kind: 'calculation', dependsOn: ['b'] }),
    component('view', { kind: 'presentation', references: { value: 'result' } }),
    { op: 'connect', id: 'link', type: 'fixture:link', source: 'a', target: 'keep' },
  ], project.token);
  const original = project.snapshot();
  const prior = before(project);
  assert.throws(() => project.apply([{ op: 'remove', id: 'a' }], project.token));
  unchanged(project, prior);
  project.apply([{ op: 'remove', id: 'a', cascade: true }], project.token);
  assert.deepEqual(ids(project), ['keep']);
  project.undo(project.token);
  assert.deepEqual(project.snapshot(), original);
  project.redo(project.token);
  assert.deepEqual(ids(project), ['keep']);
});

test('disconnect removes a relationship while preserving both endpoints', () => {
  const project = new Project();
  project.apply([
    component('a'), component('b'),
    { op: 'connect', id: 'link', type: 'fixture:link', source: 'a', target: 'b' },
  ], project.token);
  const draft = project.begin();
  assert.throws(() => draft.disconnect('a'));
  draft.disconnect('link');
  draft.accept();
  assert.deepEqual(ids(project), ['a', 'b']);
});

test('cascade remains subject to extension constraints and can be completed in one atomic batch', () => {
  const project = new Project({ validators: fixtures });
  const draft = project.begin();
  const point = draft.component('fixture:point', { id: 'point', data: { position: [0, 0, 0] } });
  const label = draft.component('fixture:label', { id: 'label', data: { text: 'Point' } });
  draft.connect('fixture:anchor', label, point, { id: 'anchor' });
  draft.accept();
  const prior = before(project);
  // Explicit reverse edges reach the anchor, but the label's semantic need for
  // an anchor is an injected rule. Cascading cannot silently override that rule.
  assert.throws(() => project.apply([{ op: 'remove', id: 'point', cascade: true }], project.token));
  unchanged(project, prior);
  project.apply([
    { op: 'remove', id: 'point', cascade: true },
    { op: 'remove', id: 'label' },
  ], project.token);
  assert.deepEqual(ids(project), []);
});

test('an invalid individual draft operation preserves the prior draft and accepted state', () => {
  const project = new Project();
  const prior = before(project);
  const draft = project.begin();
  const point = draft.component('fixture:plain', { id: 'p', data: { x: 1 } });
  const staged = draft.snapshot();
  assert.throws(() => point.set({ id: 'replacement', data: { x: 2 } }));
  assert.deepEqual(draft.snapshot(), staged);
  assert.throws(() => draft.component('fixture:plain', { id: 'p' }));
  assert.deepEqual(draft.snapshot(), staged);
  unchanged(project, prior);
  point.set({ data: { x: 3 } });
  draft.accept();
  assert.equal(project.get('p').value.data.x, 3);
});

test('handles from another project cannot silently connect matching IDs', () => {
  const first = new Project().begin();
  const second = new Project().begin();
  const a = first.component('fixture:plain', { id: 'a' });
  const b = first.component('fixture:plain', { id: 'b' });
  const foreign = second.component('fixture:plain', { id: 'b' });
  const prior = first.snapshot();
  assert.throws(() => first.connect('fixture:link', a, foreign, { id: 'bad' }));
  assert.deepEqual(first.snapshot(), prior);
  first.connect('fixture:link', a, b, { id: 'good' });
  first.accept();
});

test('trusted validators inspect immutable candidates and run at authoritative acceptance', () => {
  let calls = 0;
  let reject = false;
  const validators = {
    structure: [candidate => {
      assert.ok(Object.isFrozen(candidate));
      assert.ok(Object.isFrozen(candidate.nodes));
      calls++;
      return reject ? [{ code: 'LIMIT', path: '$', message: 'Fixture policy now rejects this graph.' }] : [];
    }],
    types: { 'fixture:plain': (node, context) => {
      assert.ok(Object.isFrozen(node));
      assert.equal(context.get(node.id).id, node.id);
      return [];
    } },
  };
  const project = new Project({ validators });
  const draft = project.begin();
  draft.component('fixture:plain', { id: 'a' });
  assert.equal(draft.preview().validation.valid, true);
  const countAfterPreview = calls;
  const prior = before(project);
  reject = true;
  assert.throws(() => draft.accept());
  assert.ok(calls > countAfterPreview);
  unchanged(project, prior);
  reject = false;
  draft.accept();
});

test('draft preview cannot mutate accepted state through a reentrant validator', () => {
  let project;
  let attempt = false;
  const rejected = [];
  const validators = { structure: [() => {
    if (attempt) {
      attempt = false;
      try { project.apply([component('intruder')], project.token); }
      catch (error) { rejected.push(error.code); }
    }
    return [];
  }] };
  project = new Project({ validators });
  const draft = project.begin();
  draft.component('fixture:plain', { id: 'wanted' });
  const prior = before(project);
  attempt = true;
  const preview = draft.preview();
  assert.equal(preview.validation.valid, true);
  unchanged(project, prior);
  assert.deepEqual(rejected, ['REENTRANT_MUTATION']);
  assert.deepEqual(preview.project.nodes.map(node => node.id), ['wanted']);
});

test('validation prevents reentrant edits to the candidate draft and accepted project', () => {
  let project;
  let draft;
  let attempt = false;
  const rejected = [];
  const validators = { structure: [() => {
    if (attempt) {
      attempt = false;
      for (const action of [
        () => draft.component('fixture:plain', { id: 'draft-intruder' }),
        () => project.apply([component('project-intruder')], project.token),
      ]) {
        try { action(); }
        catch (error) { rejected.push(error.code); }
      }
    }
    return [];
  }] };
  project = new Project({ validators });
  draft = project.begin();
  const handle = draft.component('fixture:plain', { id: 'wanted' });
  attempt = true;
  draft.accept();
  assert.deepEqual(rejected, ['REENTRANT_MUTATION', 'REENTRANT_MUTATION']);
  assert.deepEqual(ids(project), ['wanted']);
  assert.throws(() => handle.set({ data: { after: 'acceptance' } }));
  assert.throws(() => draft.component('fixture:plain', { id: 'too-late' }));
});

test('hook failures and rejected non-data values cannot partially accept an edit', () => {
  const project = new Project({ validators: {
    types: { 'fixture:throw': () => { throw new Error('Fixture validator failed'); } },
  } });
  for (const operations of [
    [component('good'), component('bad', { type: 'fixture:throw' })],
    [component('good'), component('bad', { data: { fn() {} } })],
    [component('good'), component('bad', { data: { invalid: Infinity } })],
  ]) {
    const prior = before(project);
    assert.throws(() => project.apply(operations, project.token));
    unchanged(project, prior);
  }
});

test('executable-looking data round-trips as inert text and cannot select imports', () => {
  const project = new Project();
  const source = 'globalThis.__cosmicLegoStoredSourceExecuted = true';
  delete globalThis.__cosmicLegoStoredSourceExecuted;
  project.apply([component('text', { data: {
    source, module: 'file:///no-such-extension.mjs', script: `import('file:///no-such-extension.mjs')`,
  } })], project.token);
  const reopened = Project.from(JSON.parse(JSON.stringify(project.snapshot())));
  assert.equal(reopened.get('text').value.data.source, source);
  assert.equal(globalThis.__cosmicLegoStoredSourceExecuted, undefined);
  const prior = before(reopened);
  assert.throws(() => reopened.apply([{ op: 'execute', source }], reopened.token));
  unchanged(reopened, prior);
});

test('data inspection rejects accessors without executing them', () => {
  const project = new Project();
  const prior = before(project);
  let executions = 0;
  const data = {};
  Object.defineProperty(data, 'source', {
    enumerable: true,
    get() { executions++; return 'not inert'; },
  });
  assert.throws(() => project.apply([component('getter', { data })], project.token));
  assert.equal(executions, 0);
  unchanged(project, prior);

  const imported = project.snapshot();
  Object.defineProperty(imported, 'title', {
    enumerable: true,
    get() { executions++; return 'unexpected execution'; },
  });
  assert.throws(() => Project.from(imported));
  assert.equal(executions, 0);
});

test('only finite plain JSON data crosses the command boundary', () => {
  const project = new Project();
  const cyclic = {};
  cyclic.self = cyclic;
  for (const data of [
    cyclic, { value: new Date() }, { value: new Map([['x', 1]]) },
    { value: undefined }, { value: 1n }, { value: Symbol('value') },
  ]) {
    const prior = before(project);
    assert.throws(() => project.apply([component('invalid', { data })], project.token));
    unchanged(project, prior);
  }
});

test('an asynchronous or malformed validator cannot accidentally approve a candidate', () => {
  for (const validator of [async () => [], () => true, () => [{ code: 'BAD' }], () => { throw null; }, () => { throw undefined; }]) {
    const project = new Project({ validators: { types: { 'fixture:invalid-hook': validator } } });
    const prior = before(project);
    const preview = project.preview([component('candidate', { type: 'fixture:invalid-hook' })], project.token);
    assert.equal(preview.validation.valid, false);
    assert.ok(preview.validation.errors.some(error => error.code === 'VALIDATOR_FAILURE'));
    assert.throws(() => project.apply([component('candidate', { type: 'fixture:invalid-hook' })], project.token));
    unchanged(project, prior);
  }
});

test('the copied core starts and authors point/label fixtures in a process with no domain files', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'cosmic-lego-core-'));
  try {
    const core = fileURLToPath(new URL('../src/core', import.meta.url));
    cpSync(core, resolve(directory, 'core'), { recursive: true });
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(resolve(directory, 'probe.mjs'), `
      import { Project, validateProject } from './core/index.js';
      const diagnostic = message => [{ code: 'FIXTURE', path: '$', message }];
      const validators = { types: {
        'fixture.point': node => Array.isArray(node.data.position)
          && node.data.position.length === 3 && node.data.position.every(Number.isFinite)
          ? [] : diagnostic('Expected a finite point.'),
        'fixture.label': (node, { project, get }) => {
          const anchors = project.nodes.filter(item => item.kind === 'relationship'
            && item.type === 'fixture.anchor' && item.references.source === node.id);
          return anchors.length === 1 && get(anchors[0].references.target)?.type === 'fixture.point'
            ? [] : diagnostic('Label requires one anchor to a point.');
        },
      } };
      const project = new Project({ id: 'isolated', validators });
      const empty = project.snapshot().nodes.length === 0;
      const draft = project.begin();
      const label = draft.component('fixture.label', { id: 'label', data: { text: 'Origin' } });
      const incomplete = !draft.validate().valid;
      const point = draft.component('fixture.point', { id: 'point', data: { position: [0, 0, 0] } });
      draft.connect('fixture.anchor', label, point, { id: 'anchor' });
      draft.accept();
      const loaded = Project.from(JSON.parse(JSON.stringify(project.snapshot())), { validators });
      console.log(JSON.stringify({ empty, incomplete, valid: validateProject(loaded.snapshot(), validators).valid,
        ids: loaded.snapshot().nodes.map(node => node.id).sort() }));
    `);
    const result = spawnSync(process.execPath, ['probe.mjs'], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      empty: true, incomplete: true, valid: true, ids: ['anchor', 'label', 'point'],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('all imports reachable from the public core stay inside the domain-free core', () => {
  const coreDir = realpathSync(fileURLToPath(new URL('../src/core', import.meta.url)));
  const visited = new Set();
  function inspect(file) {
    const path = realpathSync(file);
    if (visited.has(path)) return;
    visited.add(path);
    assert.ok(path.startsWith(`${coreDir}${sep}`), `Core reaches non-core source: ${path}`);
    const source = readFileSync(path, 'utf8');
    const imports = /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    for (const match of source.matchAll(imports)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith('node:')) continue;
      assert.ok(specifier.startsWith('.'), `Core imports a package or external URL: ${specifier}`);
      inspect(resolve(dirname(path), specifier));
    }
    assert.doesNotMatch(source, /\b(?:import\s*\(\s*[^'"\s]|require\s*\(|eval\s*\(|new\s+Function\s*\()/,
      `Core must not execute or dynamically resolve authored source: ${path}`);
  }
  inspect(resolve(coreDir, 'index.js'));
  assert.ok(visited.size >= 1);
});
