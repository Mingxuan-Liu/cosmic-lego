import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversation } from '../src/workspace/session.js';

test('disconnected conversation retains separate hidden composer drafts and cannot fabricate a send', () => {
  const events = [], conversation = createConversation({ onEvent: event => events.push(event) });
  conversation.draft('one', 'Keep my question'); conversation.draft('two', 'Another question');
  assert.equal(conversation.submit('one'), false);
  assert.equal(conversation.snapshot().drafts.one, 'Keep my question');
  assert.deepEqual(conversation.snapshot().messages, []); assert.deepEqual(events, []);
});

test('injected connection streams real event data, captures immutable selection and revokes late chunks after Stop', () => {
  const events = [], conversation = createConversation({ onEvent: event => events.push(event) });
  const context = { identity: { projectId: 'p', generation: 1, revision: 1 }, time: { value: 2, unit: 's' }, selection: { nodeId: 'points', objectId: 'point-3' } };
  conversation.context(context); conversation.draft('one', 'Inspect this');
  conversation.receive({ type: 'connection', status: 'connected', label: 'Test transport' });
  const turnId = conversation.submit('one'); context.selection.objectId = 'changed';
  assert.equal(events[0].context.selection.objectId, 'point-3');
  conversation.receive({ type: 'delta', turnId, id: 'answer', text: 'Part 1' });
  conversation.receive({ type: 'delta', turnId, id: 'answer', text: ' and 2' });
  conversation.receive({ type: 'progress', turnId, label: 'Reading', fraction: 0.5 });
  assert.equal(conversation.snapshot().messages.at(-1).text, 'Part 1 and 2');
  assert.equal(conversation.cancel(), true); assert.equal(events.at(-1).type, 'cancel');
  assert.equal(conversation.receive({ type: 'delta', turnId, id: 'answer', text: 'late' }), false);
  assert.equal(conversation.snapshot().messages.at(-1).text, 'Part 1 and 2');
});

test('project/load changes revoke a conversation while normal accepted revisions retain an active turn', () => {
  const conversation = createConversation();
  const context = revision => ({ identity: { projectId: 'p', generation: 1, revision }, selection: null });
  conversation.context(context(1)); conversation.receive({ type: 'connection', status: 'connected' });
  conversation.draft('one', 'Start'); const turnId = conversation.submit('one');
  conversation.context(context(2)); assert.equal(conversation.snapshot().activeTurn, turnId);
  conversation.context({ identity: { projectId: 'p', generation: 2, revision: 2 } });
  assert.equal(conversation.snapshot().activeTurn, null); assert.deepEqual(conversation.snapshot().drafts, {});
  assert.equal(conversation.receive({ type: 'complete', turnId }), false);
});

test('conversation validation bounds content and prevents overwriting another message identity', () => {
  const conversation = createConversation();
  assert.throws(() => conversation.draft('one', 'a'.repeat(12001)));
  conversation.receive({ type: 'connection', status: 'connected' }); conversation.draft('one', 'Start');
  const turnId = conversation.submit('one');
  assert.throws(() => conversation.receive({ type: 'message', turnId, id: `${turnId}:user`, text: 'overwrite' }));
  assert.throws(() => conversation.receive({ type: 'progress', turnId, label: 'invalid', fraction: 2 }));
  conversation.receive({ type: 'error', turnId, message: 'Transport unavailable' });
  assert.equal(conversation.snapshot().error, 'Transport unavailable');
  assert.equal(conversation.snapshot().activeTurn, null);
});

test('failed event delivery remains visible, retains the draft, and revokes the unaccepted turn', () => {
  let attempted;
  const conversation = createConversation({ onEvent: event => { attempted = event; throw new Error('Transport is unavailable'); } });
  conversation.receive({ type: 'connection', status: 'connected' });
  conversation.draft('composer', '  Retain this question  ');
  assert.equal(conversation.submit('composer'), false);
  const state = conversation.snapshot();
  assert.equal(state.connection, 'error');
  assert.match(state.error, /Transport is unavailable/);
  assert.equal(state.activeTurn, null);
  assert.equal(state.progress, null);
  assert.equal(state.drafts.composer, '  Retain this question  ');
  assert.deepEqual(state.messages, []);
  assert.equal(conversation.receive({ type: 'delta', turnId: attempted.turnId, id: 'late', text: 'No longer accepted' }), false);
});

test('local Stop revokes late events even if transport cancellation throws', () => {
  const conversation = createConversation({ onEvent: event => { if (event.type === 'cancel') throw new Error('Cancellation transport failed'); } });
  conversation.receive({ type: 'connection', status: 'connected' }); conversation.draft('one', 'Start');
  const turnId = conversation.submit('one');
  assert.equal(conversation.cancel(), true);
  assert.equal(conversation.snapshot().activeTurn, null);
  assert.match(conversation.snapshot().error, /Cancellation transport failed/);
  assert.equal(conversation.receive({ type: 'complete', turnId }), false);
});

test('unknown composer names and invalid subscriptions do not invoke object prototypes or poison state', () => {
  const conversation = createConversation();
  conversation.receive({ type: 'connection', status: 'connected' });
  for (const id of ['constructor', '__proto__', 'toString']) assert.equal(conversation.submit(id), false);
  assert.throws(() => conversation.subscribe(null));
  assert.throws(() => conversation.subscribe(() => { throw new Error('Bad subscriber'); }));
  conversation.draft('constructor', 'A real explicitly stored draft');
  assert.equal(typeof conversation.submit('constructor'), 'string');
  assert.throws(() => createConversation({ onEvent: null }));
});

test('removing composer drafts bounds repeated view lifetimes without cancelling the shared conversation', () => {
  const conversation = createConversation();
  for (let i = 0; i < 24; i++) conversation.draft(`composer-${i}`, `Draft ${i}`);
  assert.throws(() => conversation.draft('next', 'Over the simultaneous draft limit'));
  assert.equal(conversation.forgetDraft('composer-0'), true);
  assert.equal(conversation.forgetDraft('composer-0'), false);
  conversation.draft('next', 'A replacement view can retain its draft');
  assert.equal(conversation.snapshot().drafts.next, 'A replacement view can retain its draft');
  assert.equal(conversation.snapshot().drafts['composer-1'], 'Draft 1', 'Unremoved/hidden drafts remain intact.');
  conversation.receive({ type: 'connection', status: 'connected' });
  const turnId = conversation.submit('next');
  conversation.forgetDraft('next');
  assert.equal(conversation.snapshot().activeTurn, turnId);
  assert.equal(conversation.receive({ type: 'message', turnId, id: 'answer', text: 'Shared conversation continues.' }), true);
  for (let i = 0; i < 100; i++) {
    conversation.draft(`temporary-${i}`, 'A view-local draft');
    conversation.forgetDraft(`temporary-${i}`);
  }
  assert.equal(Object.keys(conversation.snapshot().drafts).length, 23);
  assert.equal(conversation.snapshot().messages.at(-1).text, 'Shared conversation continues.');
});
