import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/core/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';
import { createCommandGateway } from '../src/gateway/index.js';

const constant = id => ({ command: 'dataflow.constant', args: {
  id, value: { kind: 'scalar', data: 1, unit: '1', meaning: 'generic-number' },
} });
const accepted = project => ({ graph: project.snapshot(), token: project.token, history: project.history });
const unchanged = (project, before) => assert.deepEqual(accepted(project), before);

test('revocation during final Project validation prevents gateway acceptance', async () => {
  const registry = new ExtensionRegistry(), binding = registry.bind();
  let gateway, turn, validations = 0;
  const project = new Project({ validators: { ...binding.validators, structure: [
    ...binding.validators.structure,
    () => {
      // The first call previews the draft; the second validates final acceptance.
      if (turn && ++validations === 2) gateway.revokeTurn(turn);
      return [];
    },
  ] } });
  gateway = createCommandGateway({ project, registry, binding });
  turn = gateway.issueTurn(gateway.createSession());
  const before = accepted(project);
  const outcome = await gateway.dispatch({ ...constant('late'), expected: project.token, idempotencyKey: 'late-final-validation' }, turn);
  assert.equal(validations, 2);
  assert.equal(outcome.ok, false, JSON.stringify(outcome));
  assert.equal(outcome.error.code, 'TURN_REVOKED');
  unchanged(project, before);
});

for (const direction of ['undo', 'redo']) {
  test(`revocation during final ${direction} validation preserves history and content`, async () => {
    const registry = new ExtensionRegistry(), binding = registry.bind();
    let gateway, turn;
    const project = new Project({ validators: { ...binding.validators, structure: [
      ...binding.validators.structure,
      () => { if (turn) gateway.revokeTurn(turn); return []; },
    ] } });
    const draft = project.begin(); binding.author(draft).constant(constant('n').args.value, { id: 'n' }); draft.accept();
    if (direction === 'redo') project.undo(project.token);
    gateway = createCommandGateway({ project, registry, binding });
    turn = gateway.issueTurn(gateway.createSession());
    const before = accepted(project);
    const outcome = await gateway.dispatch({ command: `history.${direction}`, expected: project.token, idempotencyKey: `revoked-${direction}` }, turn);
    assert.equal(outcome.ok, false, JSON.stringify(outcome));
    assert.equal(outcome.error.code, 'TURN_REVOKED');
    unchanged(project, before);
  });

  test(`gateway ${direction} validates the actual target even when the host Project has only core validators`, async () => {
    const registry = new ExtensionRegistry(), binding = registry.bind(), project = new Project();
    const draft = project.begin(); draft.component('uninstalled.model', { id: 'invalid' }); draft.accept();
    if (direction === 'undo') { const removal = project.begin(); removal.remove('invalid'); removal.accept(); }
    else project.undo(project.token);
    assert.equal(registry.inspectRequirements(project.snapshot()).valid, true);
    const gateway = createCommandGateway({ project, registry, binding }), before = accepted(project);
    const outcome = await gateway.dispatch({ command: `history.${direction}`, expected: project.token, idempotencyKey: `invalid-${direction}` }, gateway.localAuthority);
    assert.equal(outcome.ok, false, JSON.stringify(outcome));
    assert.ok(outcome.error.diagnostics.some(issue => ['EXTENSION_PIN_REQUIRED', 'EXTENSION_MISSING'].includes(issue.code)));
    unchanged(project, before);
  });
}

test('commit guard receives a frozen detached candidate before accepted state changes', () => {
  const project = new Project(), draft = project.begin(), before = accepted(project);
  draft.component('fixture.point', { id: 'point', data: { coordinates: [1, 2, 3] } });
  let called = 0, inspected;
  draft.accept({ beforeCommit(candidate) {
    called++; inspected = candidate;
    unchanged(project, before);
    assert.ok(Object.isFrozen(candidate));
    assert.ok(Object.isFrozen(candidate.nodes));
    assert.ok(Object.isFrozen(candidate.nodes[0].data.coordinates));
    assert.throws(() => { candidate.nodes[0].data.coordinates[0] = 99; }, TypeError);
  } });
  assert.equal(called, 1);
  assert.equal(project.token.revision, before.token.revision + 1);
  assert.deepEqual(project.get('point').value.data.coordinates, [1, 2, 3]);
  const next = project.begin(); next.get('point').set({ data: { coordinates: [4, 5, 6] } }); next.accept();
  assert.deepEqual(inspected.nodes[0].data.coordinates, [1, 2, 3]);
});

for (const method of ['accept', 'undo', 'redo']) {
  test(`${method} rejects asynchronous or reentrant commit guards without accepted effects`, () => {
    const project = new Project();
    let draft = project.begin(); draft.component('fixture.point', { id: 'point' });
    if (method !== 'accept') { draft.accept(); if (method === 'redo') project.undo(project.token); }
    const before = accepted(project);
    const invoke = beforeCommit => method === 'accept'
      ? project.accept(draft, { beforeCommit })
      : project[method](project.token, { beforeCommit });
    let asyncEntered = false;
    assert.throws(() => invoke(async () => { asyncEntered = true; }), { code: 'ASYNC_COMMIT_GUARD' });
    assert.equal(asyncEntered, false, 'Async guards must be rejected before their body starts.');
    unchanged(project, before);
    assert.throws(() => invoke(() => Promise.resolve()), { code: 'ASYNC_COMMIT_GUARD' });
    unchanged(project, before);
    assert.throws(() => invoke(() => project.load(project.snapshot(), project.token)), { code: 'REENTRANT_MUTATION' });
    unchanged(project, before);
    // A rejected guard must not close the draft or consume an Undo/Redo entry.
    invoke(() => {});
    assert.equal(project.token.revision, before.token.revision + 1);
  });
}
