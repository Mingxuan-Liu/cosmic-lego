import { copyData, fail, freshId, freezeData } from './data.js';
import { createProject, dependencies, edit, findNode, prepareValidators, requireValid, validateProject } from './graph.js';

// State never escapes through public properties, handles, previews or hooks.
const projects = new WeakMap();
const drafts = new WeakMap();
const handles = new WeakMap();

function initialize(instance, input, validators) {
  const hooks = prepareValidators(validators);
  const content = copyData(input);
  requireValid(validateProject(content, hooks));
  projects.set(instance, {
    content, validators: hooks, generation: freshId('load'), revision: 0,
    undo: [], redo: [], busy: false,
  });
  return instance;
}

function tokenOf(state) {
  return Object.freeze({ projectId: state.content.id, generation: state.generation, revision: state.revision });
}

// Internal preparation for immutable accepted revisions. Drafts never enter this
// cache. A load, edit or history change invalidates even identical graph data.
export function cacheByRevision(prepare) {
  const entries = new WeakMap();
  return project => {
    const state = projects.get(project);
    if (!state) fail('PROJECT_REQUIRED', 'Use an accepted project.');
    const { generation, revision } = state;
    const known = entries.get(project);
    if (known?.generation === generation && known.revision === revision) return known.value;
    const value = prepare(project);
    if (state.generation === generation && state.revision === revision) entries.set(project, { generation, revision, value });
    return value;
  };
}

function checkToken(state, input) {
  let token;
  try { token = copyData(input); } catch { fail('STALE_TOKEN', 'Supply the complete current project token.'); }
  if (!token || Object.keys(token).length !== 3 || token.projectId !== state.content.id ||
      token.generation !== state.generation || token.revision !== state.revision) {
    fail('STALE_TOKEN', 'The project, load generation, or revision changed. Read the current state before editing.');
  }
}

function checked(state, token, action) {
  if (state.busy) fail('REENTRANT_MUTATION', 'A validation/transaction is already running.');
  checkToken(state, token);
  state.busy = true;
  try { return action(); } finally { state.busy = false; }
}

function nextRevision(state) {
  if (!Number.isSafeInteger(state.revision + 1)) fail('REVISION_EXHAUSTED', 'Start a new runtime before further mutations.');
  return state.revision + 1;
}

// A trusted host may perform a final synchronous authorization/validation check
// while the kernel still holds its mutation guard. This is executable host code,
// never project data, and sees only a detached immutable candidate.
function beforeCommit(content, options) {
  if (options === undefined) return;
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) {
    fail('INVALID_COMMIT_GUARD', 'Commit options must contain only an optional trusted beforeCommit function.');
  }
  for (const key of Reflect.ownKeys(options)) {
    if (key !== 'beforeCommit') fail('INVALID_COMMIT_GUARD', 'Only beforeCommit is supported in commit options.');
  }
  const field = Object.getOwnPropertyDescriptor(options, 'beforeCommit');
  if (!field) return;
  if (!Object.hasOwn(field, 'value') || typeof field.value !== 'function') fail('INVALID_COMMIT_GUARD', 'beforeCommit must be a trusted function without an accessor.');
  const callback = field.value;
  if (['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(callback.constructor?.name)) {
    fail('ASYNC_COMMIT_GUARD', 'beforeCommit must complete synchronously.');
  }
  const result = callback(freezeData(copyData(content)));
  if (result instanceof Promise) { result.catch(() => {}); fail('ASYNC_COMMIT_GUARD', 'beforeCommit must complete synchronously.'); }
  if (result !== undefined) fail('INVALID_COMMIT_GUARD', 'beforeCommit must return undefined or throw to reject the mutation.');
}

function commit(state, content, options) {
  requireValid(validateProject(content, state.validators));
  const revision = nextRevision(state);
  beforeCommit(content, options);
  state.undo.push(state.content);
  state.redo = [];
  state.content = copyData(content);
  state.revision = revision;
  return copyData(state.content);
}

function travel(project, from, to, token, options) {
  const state = projects.get(project);
  return checked(state, token, () => {
    if (!state[from].length) fail('EMPTY_HISTORY', `No ${from} state is available.`);
    const content = state[from].at(-1);
    requireValid(validateProject(content, state.validators));
    const revision = nextRevision(state);
    beforeCommit(content, options);
    state[to].push(state.content);
    state[from].pop();
    state.content = content;
    state.revision = revision;
    return copyData(content);
  });
}

function batch(content, commands) {
  const operations = copyData(commands);
  if (!Array.isArray(operations) || !operations.length) fail('INVALID_OPERATION', 'Provide a nonempty array of operations.');
  const candidate = copyData(content);
  for (const operation of operations) edit(candidate, operation);
  return candidate;
}

function draftState(draft, { writable = false } = {}) {
  const state = drafts.get(draft);
  if (!state) fail('INVALID_DRAFT', 'Expected a kernel-created draft.');
  if (writable && state.closed) fail('CLOSED_DRAFT', 'This draft has already been accepted. Begin a new draft.');
  if (writable && state.busy) fail('REENTRANT_MUTATION', 'This draft is being validated.');
  return state;
}

function readHandle(handle) {
  const entry = handles.get(handle);
  const runtime = projects.get(entry.project);
  if (entry.generation !== runtime.generation) fail('STALE_HANDLE', 'This handle belongs to a previous project load.');
  const content = entry.draft ? draftState(entry.draft).content : runtime.content;
  return { entry, content, node: findNode(content, entry.id) };
}

function idInDraft(draft, value) {
  if (typeof value === 'string') return value;
  const entry = handles.get(value);
  const state = draftState(draft);
  if (!entry || entry.project !== state.project || entry.generation !== state.baseToken.generation ||
      (entry.draft && entry.draft !== draft)) {
    fail('FOREIGN_HANDLE', 'Use a handle from this draft or its accepted project, or an explicit ID.');
  }
  readHandle(value);
  return entry.id;
}

class Handle {
  constructor(project, id, draft = null) {
    handles.set(this, { project, id, draft, generation: draft ? draftState(draft).baseToken.generation : projects.get(project).generation });
    Object.freeze(this);
  }
  get id() { return handles.get(this).id; }
  get value() { return copyData(readHandle(this).node); }
  set(patch) {
    const { entry } = readHandle(this);
    if (!entry.draft) fail('READ_ONLY_HANDLE', 'Begin a draft and get this ID to update it atomically.');
    entry.draft.update(this.id, patch);
    return this;
  }
  connect(type, target, options) {
    const { entry } = readHandle(this);
    if (!entry.draft) fail('READ_ONLY_HANDLE', 'Begin a draft to connect nodes.');
    return entry.draft.connect(type, this, target, options);
  }
  remove(options) {
    const { entry } = readHandle(this);
    if (!entry.draft) fail('READ_ONLY_HANDLE', 'Begin a draft to remove nodes.');
    return entry.draft.remove(this.id, options);
  }
  dependencies(options) {
    const { content } = readHandle(this);
    return dependencies(content, this.id, options);
  }
}

class Draft {
  constructor(project, token) {
    const state = projects.get(project);
    checkToken(state, token);
    drafts.set(this, { project, baseToken: tokenOf(state), content: copyData(state.content), closed: false, busy: false });
  }
  get baseToken() { return draftState(this).baseToken; }
  // Composition helpers use the kernel's handle ownership checks rather than
  // extracting .id from a potentially foreign or stale handle themselves.
  idOf(value) { return idInDraft(this, value); }
  snapshot() { return copyData(draftState(this).content); }
  get(id) {
    const state = draftState(this);
    findNode(state.content, id);
    return new Handle(state.project, id, this);
  }
  create(node) {
    const state = draftState(this, { writable: true });
    // edit checks local shape before mutation; final relationships/types may
    // remain incomplete until acceptance. Failed local edits leave the draft.
    const id = edit(state.content, { op: 'create', node });
    return this.get(id);
  }
  component(type, options = {}) { return this.create({ ...copyData(options), kind: 'component', type }); }
  calculation(type, options = {}) { return this.create({ ...copyData(options), kind: 'calculation', type }); }
  presentation(type, options = {}) { return this.create({ ...copyData(options), kind: 'presentation', type }); }
  connect(type, source, target, options = {}) {
    const state = draftState(this, { writable: true });
    const id = edit(state.content, { ...copyData(options), op: 'connect', type, source: idInDraft(this, source), target: idInDraft(this, target) });
    return this.get(id);
  }
  update(id, patch) {
    const state = draftState(this, { writable: true });
    edit(state.content, { op: 'update', id: idInDraft(this, id), patch });
    return this;
  }
  disconnect(id) {
    const state = draftState(this, { writable: true });
    edit(state.content, { op: 'disconnect', id: idInDraft(this, id) });
    return this;
  }
  remove(id, { cascade = false } = {}) {
    const state = draftState(this, { writable: true });
    return edit(state.content, { op: 'remove', id: idInDraft(this, id), cascade });
  }
  dependencies(id, options) { return dependencies(draftState(this).content, idInDraft(this, id), options); }
  validate() {
    const state = draftState(this);
    if (state.busy) fail('REENTRANT_MUTATION', 'This draft is being validated.');
    const runtime = projects.get(state.project);
    // Diagnostics may inspect an outdated draft, but a hook must not change the
    // accepted project (or this candidate) during validation or preview.
    return checked(runtime, tokenOf(runtime), () => {
      state.busy = true;
      try { return validateProject(state.content, runtime.validators); }
      finally { state.busy = false; }
    });
  }
  preview() {
    const state = draftState(this);
    checkToken(projects.get(state.project), state.baseToken);
    return { project: this.snapshot(), validation: this.validate(), baseToken: state.baseToken };
  }
  accept(options) { return draftState(this).project.accept(this, options); }
}

export class Project {
  constructor({ id, title, validators = {} } = {}) {
    initialize(this, createProject({ id, title }), validators);
  }
  static from(content, { validators = {} } = {}) {
    return initialize(Object.create(Project.prototype), content, validators);
  }
  get token() { return tokenOf(projects.get(this)); }
  get history() {
    const state = projects.get(this);
    return Object.freeze({ canUndo: !!state.undo.length, canRedo: !!state.redo.length });
  }
  snapshot() { return copyData(projects.get(this).content); }
  get(id) {
    findNode(projects.get(this).content, id);
    return new Handle(this, id);
  }
  dependencies(id, options) { return dependencies(projects.get(this).content, id, options); }
  begin(token = this.token) { return new Draft(this, token); }
  apply(operations, token) {
    const state = projects.get(this);
    return checked(state, token, () => commit(state, batch(state.content, operations)));
  }
  preview(operations, token) {
    const state = projects.get(this);
    return checked(state, token, () => {
      const project = batch(state.content, operations);
      return { project, validation: validateProject(project, state.validators), baseToken: tokenOf(state) };
    });
  }
  accept(draft, options) {
    const candidate = draftState(draft, { writable: true });
    if (candidate.project !== this) fail('FOREIGN_DRAFT', 'This draft belongs to another runtime.');
    const state = projects.get(this);
    return checked(state, candidate.baseToken, () => {
      candidate.busy = true;
      try {
        const result = commit(state, candidate.content, options);
        candidate.closed = true;
        return result;
      } finally { candidate.busy = false; }
    });
  }
  undo(token, options) { return travel(this, 'undo', 'redo', token, options); }
  redo(token, options) { return travel(this, 'redo', 'undo', token, options); }
  load(input, token) {
    const state = projects.get(this);
    return checked(state, token, () => {
      const content = copyData(input);
      requireValid(validateProject(content, state.validators));
      const revision = nextRevision(state);
      const generation = freshId('load');
      state.content = content;
      state.generation = generation;
      state.revision = revision;
      state.undo = [];
      state.redo = [];
      return copyData(content);
    });
  }
}
