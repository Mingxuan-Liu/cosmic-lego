import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const appSource = await readFile(new URL('../demo/workspace/app.js', import.meta.url), 'utf8');
const source = appSource.slice(appSource.indexOf('function buildComposer('), appSource.indexOf('conversation.subscribe('));
function ui() {
  class Node {
    constructor(tag, text = '', className = '') { this.tag = tag; this.textContent = text; this.className = className; this.children = []; this.events = new Map(); this.dataset = {}; this.value = ''; this.scrollHeight = 100; this.clientHeight = 80; this.scrollTop = 0; }
    append(...nodes) { this.children.push(...nodes); if (this.tag === 'select' && !this.value && this.children[0]) this.value = this.children[0].value; }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    get childNodes() { return this.children; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { this.events.set(name, callback); }
    querySelectorAll(selectors) { return this.children.flatMap(child => [selectors.split(',').includes(child.tag) ? child : null, ...(child.querySelectorAll?.(selectors) ?? [])].filter(Boolean)); }
  }
  const element = (tag, text, className) => new Node(tag, text, className);
  const button = (text, action) => { const node = element('button', text); node.addEventListener('click', action); return node; };
  const calls = [], composers = new Map(), state = { status: 'disconnected', label: 'No agent connected', managed: false, busy: false, agents: [{ id: 'mock', label: 'TEST ONLY mock' }], requests: [], permissionPolicy: 'deny' };
  const context = vm.createContext({ element, button, composers, agentState: state, selection: null, snapshot: { time: { value: 2 } }, number: String,
    document: { createTextNode: text => element('text', text) }, Option: class extends Node { constructor(text, value) { super('option', text); this.value = value; } },
    conversation: { draft: (...args) => calls.push(['draft', ...args]), submit: (...args) => calls.push(['submit', ...args]), cancel: () => calls.push(['stop']) },
    agentClient: { connect: async (...args) => calls.push(['connect', ...args]), disconnect: async () => calls.push(['disconnect']), reply: async (...args) => calls.push(['reply', ...args]) },
  });
  const functions = new vm.Script(`${source}\n({buildComposer,updateComposer,renderAgentRequests})`).runInContext(context);
  const body = element('div'); functions.buildComposer({ id: 'conversation', title: 'Conversation' }, body);
  return { ...functions, control: composers.get('conversation'), state, calls };
}
const session = patch => ({ connection: 'disconnected', label: 'No agent connected', messages: [], drafts: { conversation: 'A draft' }, activeTurn: null, ...patch });

test('composer connects only the selected configured ID and explicit native permission setting', async () => {
  const h = ui(); h.updateComposer('conversation', session());
  assert.equal(h.control.agentSelect.value, 'mock'); assert.equal(h.control.send.disabled, true);
  h.control.policy.value = 'ask'; await h.control.connect.events.get('click')();
  assert.deepEqual(h.calls, [['connect', 'mock', 'ask']]);
  assert.equal(h.control.textarea.type, undefined, 'The composer does not collect credentials.');
});

test('Ctrl/Cmd+Enter, Send and Stop use the same conversation path and retain the textarea', () => {
  const h = ui(), textarea = h.control.textarea;
  h.updateComposer('conversation', session({ connection: 'connected', label: 'TEST ONLY ready' }));
  for (const key of ['ctrlKey', 'metaKey']) h.control.textarea.events.get('keydown')({ key: 'Enter', [key]: true, preventDefault() {} });
  h.control.send.events.get('click')(); h.control.stop.events.get('click')();
  assert.deepEqual(h.calls.map(call => call[0]), ['submit', 'submit', 'submit', 'stop']);
  h.updateComposer('conversation', session({ messages: [{ role: 'assistant', text: 'Streamed message' }] }));
  assert.equal(h.control.textarea, textarea); assert.equal(h.control.textarea.value, 'A draft');
});

test('runtime permissions display only offered decisions and never invent an Allow control', async () => {
  const h = ui();
  h.renderAgentRequests(h.control, [{ requestId: 'native', kind: 'permission', message: 'Native execution request', options: [{ id: 'deny', label: 'Deny' }] }]);
  const buttons = h.control.requests.querySelectorAll('button');
  assert.deepEqual(buttons.map(button => button.textContent), ['Deny']);
  await buttons[0].events.get('click')();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['reply', 'native', { decision: 'deny' }]]);
});

test('input cards preserve typed answers across streamed updates and refuse secret entry fields', async () => {
  const h = ui(), requests = [{ requestId: 'input', kind: 'input', message: 'Choose a component', questions: [{ id: 'which', header: 'Component', question: 'Which one?' }] }];
  h.renderAgentRequests(h.control, requests);
  const field = h.control.requests.querySelectorAll('input')[0]; field.value = 'point-2';
  h.renderAgentRequests(h.control, requests); assert.equal(h.control.requests.querySelectorAll('input')[0], field);
  await h.control.requests.querySelectorAll('button')[0].events.get('click')();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['reply', 'input', { answers: { which: ['point-2'] } }]]);
  h.renderAgentRequests(h.control, [{ requestId: 'secret', kind: 'input', questions: [{ id: 'token', question: 'Credential?', isSecret: true }] }]);
  assert.equal(h.control.requests.querySelectorAll('input,textarea').length, 0); assert.equal(h.control.requests.querySelectorAll('button')[0].disabled, true);
});

test('managed connecting, authentication and working states cannot enable Send prematurely', () => {
  const h = ui(); h.state.managed = true;
  for (const status of ['connecting', 'auth-needed', 'working', 'cancelling', 'failed', 'offline']) {
    h.state.status = status; h.state.label = status;
    h.updateComposer('conversation', session({ connection: 'connected' })); assert.equal(h.control.send.disabled, true, status);
    assert.equal(h.control.connection.textContent, status);
  }
  h.state.status = 'ready'; h.updateComposer('conversation', session({ connection: 'connected' })); assert.equal(h.control.send.disabled, false);
});
