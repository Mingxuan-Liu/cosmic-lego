import { copyData, fail, freshId, freezeData, isId, isRecord, keysOnly } from './data.js';

const kinds = ['component', 'relationship', 'calculation', 'presentation'];
const nodeKeys = ['id', 'kind', 'type', 'data', 'references', 'dependsOn'];

export function createProject({ id = freshId('project'), title = 'Untitled project' } = {}) {
  const project = { schemaVersion: 1, id, title, nodes: [] };
  requireValid(validateProject(project));
  return copyData(project);
}

// Freeze registration at the composition boundary. The functions themselves are
// trusted local code, never identities or module paths supplied by project data.
export function prepareValidators(validators = {}) {
  keysOnly(validators, ['structure', 'types'], 'validators');
  const structure = validators.structure ?? [];
  const types = validators.types ?? {};
  if (!Array.isArray(structure) || structure.some(fn => typeof fn !== 'function') ||
      !isRecord(types) || Object.values(types).some(fn => typeof fn !== 'function')) {
    fail('INVALID_VALIDATORS', 'Expected structure functions and a type-to-function map.');
  }
  return Object.freeze({ structure: Object.freeze([...structure]), types: Object.freeze({ ...types }) });
}

export function validateProject(input, validators = {}) {
  const hooks = prepareValidators(validators);
  const errors = [];
  const error = (path, message, code = 'STRUCTURE') => errors.push({ code, path, message });
  let project;
  try { project = copyData(input); }
  catch (cause) { return { valid: false, errors: [{ code: 'INVALID_DATA', path: '$', message: cause?.message ?? String(cause) }] }; }
  const object = (value, keys, path) => {
    if (!isRecord(value)) { error(path, 'Expected an object.'); return false; }
    for (const key of Object.keys(value)) if (!keys.includes(key)) error(`${path}.${key}`, 'Unsupported field.', 'UNSUPPORTED_FIELD');
    return true;
  };
  const identifier = (value, path) => { if (!isId(value)) error(path, 'Expected 1–128 identifier characters: letters, digits, _, ., :, or -; start with a letter or digit.'); };
  if (!object(project, ['schemaVersion', 'id', 'title', 'nodes'], '$')) return { valid: false, errors };
  if (project.schemaVersion !== 1) error('$.schemaVersion', 'Expected composition schema version 1.');
  identifier(project.id, '$.id');
  if (typeof project.title !== 'string') error('$.title', 'Expected a title string.');
  if (!Array.isArray(project.nodes)) { error('$.nodes', 'Expected an array.'); return { valid: false, errors }; }
  const ids = new Set();
  for (const [i, node] of project.nodes.entries()) {
    const path = `$.nodes[${i}]`;
    if (!object(node, nodeKeys, path)) continue;
    identifier(node.id, `${path}.id`);
    if (ids.has(node.id)) error(`${path}.id`, `Duplicate node ID ${node.id}.`, 'DUPLICATE_ID');
    ids.add(node.id);
    if (!kinds.includes(node.kind)) error(`${path}.kind`, `Expected one of ${kinds.join(', ')}.`);
    identifier(node.type, `${path}.type`);
    if (!isRecord(node.data)) error(`${path}.data`, 'Expected a data object.');
    if (!isRecord(node.references)) error(`${path}.references`, 'Expected named explicit references.');
    else {
      for (const [slot, id] of Object.entries(node.references)) {
        identifier(slot, `${path}.references slot`);
        identifier(id, `${path}.references.${slot}`);
      }
      if (node.kind === 'relationship') {
        for (const slot of ['source', 'target']) if (!Object.hasOwn(node.references, slot)) {
          error(`${path}.references.${slot}`, 'A relationship needs source and target references.');
        }
      }
    }
    if (!Array.isArray(node.dependsOn)) error(`${path}.dependsOn`, 'Expected explicit computational dependency IDs.');
    else {
      node.dependsOn.forEach((id, j) => identifier(id, `${path}.dependsOn[${j}]`));
      if (new Set(node.dependsOn).size !== node.dependsOn.length) error(`${path}.dependsOn`, 'Duplicate computational dependency.', 'DUPLICATE_DEPENDENCY');
    }
  }
  if (errors.length) return { valid: false, errors };
  for (const [i, node] of project.nodes.entries()) {
    for (const [slot, id] of Object.entries(node.references)) {
      if (!ids.has(id)) error(`$.nodes[${i}].references.${slot}`, `Unknown node ${id}.`, 'BROKEN_REFERENCE');
    }
    node.dependsOn.forEach((id, j) => {
      if (!ids.has(id)) error(`$.nodes[${i}].dependsOn[${j}]`, `Unknown dependency ${id}.`, 'BROKEN_DEPENDENCY');
    });
  }
  if (errors.length) return { valid: false, errors };

  // Only computational edges require a DAG. Reference/relationship cycles are
  // ordinary compositions. Iterative traversal also handles very deep graphs.
  const remaining = new Map(project.nodes.map(node => [node.id, node.dependsOn.length]));
  const consumers = new Map(project.nodes.map(node => [node.id, []]));
  for (const node of project.nodes) for (const id of node.dependsOn) consumers.get(id).push(node.id);
  const ready = project.nodes.filter(node => !node.dependsOn.length).map(node => node.id);
  for (let i = 0; i < ready.length; i++) for (const consumer of consumers.get(ready[i])) {
    remaining.set(consumer, remaining.get(consumer) - 1);
    if (!remaining.get(consumer)) ready.push(consumer);
  }
  if (ready.length !== project.nodes.length) {
    const blocked = [...remaining].filter(([, count]) => count > 0).map(([id]) => id);
    error('$.nodes', `Computational cycle blocks: ${blocked.join(', ')}. Coupled solvers are not implemented.`, 'DEPENDENCY_CYCLE');
  }
  if (errors.length) return { valid: false, errors };

  freezeData(project);
  const index = new Map(project.nodes.map(node => [node.id, node]));
  const context = Object.freeze({ project, get: id => index.get(id) });
  const invoke = (fn, args, path) => {
    try {
      const result = fn(...args);
      // Consume a rejected native Promise to avoid an unhandled rejection. Async
      // validation still fails closed and can never authorize acceptance.
      if (result instanceof Promise) result.catch(() => {});
      const diagnostics = copyData(result);
      if (!Array.isArray(diagnostics) || diagnostics.some(d => !isRecord(d) ||
          typeof d.code !== 'string' || typeof d.path !== 'string' || typeof d.message !== 'string')) {
        throw new Error('Validators must synchronously return an array of {code,path,message}.');
      }
      errors.push(...diagnostics);
    } catch (cause) {
      error(path, `Validation hook failed: ${cause?.message ?? String(cause)}`, 'VALIDATOR_FAILURE');
    }
  };
  hooks.structure.forEach(fn => invoke(fn, [project], '$'));
  project.nodes.forEach((node, i) => {
    if (Object.hasOwn(hooks.types, node.type)) invoke(hooks.types[node.type], [node, context], `$.nodes[${i}]`);
  });
  return { valid: errors.length === 0, errors };
}

export function requireValid(validation) {
  if (!validation.valid) fail('VALIDATION_FAILED', 'Project acceptance failed.', { validation });
}

export function findNode(project, id) {
  const node = project.nodes.find(node => node.id === id);
  if (!node) fail('UNKNOWN_ID', `Unknown node ${id}.`);
  return node;
}

export function dependencies(project, id, { direction = 'outgoing', edge = 'all', transitive = false } = {}) {
  findNode(project, id);
  if (!['outgoing', 'incoming'].includes(direction) || !['reference', 'computation', 'all'].includes(edge) || typeof transitive !== 'boolean') {
    fail('INVALID_QUERY', 'Expected incoming/outgoing direction, reference/computation/all edge, and boolean transitive.');
  }
  const adjacency = new Map(project.nodes.map(node => [node.id, new Set()]));
  for (const node of project.nodes) {
    const targets = [...(edge === 'computation' ? [] : Object.values(node.references)), ...(edge === 'reference' ? [] : node.dependsOn)];
    for (const target of targets) {
      if (direction === 'outgoing') adjacency.get(node.id).add(target);
      else if (adjacency.has(target)) adjacency.get(target).add(node.id);
    }
  }
  const visited = new Set([id]);
  const queue = [id];
  const result = new Set();
  for (let i = 0; i < queue.length; i++) for (const target of adjacency.get(queue[i]) ?? []) {
    if (target !== id) result.add(target);
    if (transitive && !visited.has(target)) { visited.add(target); queue.push(target); }
  }
  return [...result].sort();
}

export function edit(project, input) {
  const command = copyData(input);
  const fields = {
    create: ['op', 'node'], update: ['op', 'id', 'patch'],
    connect: ['op', 'id', 'type', 'source', 'target', 'data'],
    disconnect: ['op', 'id'], remove: ['op', 'id', 'cascade'],
  };
  if (!isRecord(command) || !Object.hasOwn(fields, command.op)) fail('UNKNOWN_OPERATION', 'Unknown composition operation.');
  keysOnly(command, fields[command.op], command.op);
  switch (command.op) {
    case 'connect':
      return edit(project, { op: 'create', node: {
        ...(command.id === undefined ? {} : { id: command.id }), kind: 'relationship', type: command.type,
        data: command.data ?? {}, references: { source: command.source, target: command.target },
      } });
    case 'create': {
      keysOnly(command.node, nodeKeys, 'node');
      const node = { id: freshId('node'), kind: 'component', data: {}, references: {}, dependsOn: [], ...command.node };
      // Check local shape without requiring references or extension constraints.
      const shell = { ...project, nodes: [{ ...node, references: {}, dependsOn: [], kind: node.kind === 'relationship' ? 'component' : node.kind }] };
      requireValid(validateProject(shell));
      if (!isRecord(node.references) || Object.values(node.references).some(id => !isId(id)) ||
          Object.keys(node.references).some(slot => !isId(slot)) || !Array.isArray(node.dependsOn) ||
          node.dependsOn.some(id => !isId(id)) || new Set(node.dependsOn).size !== node.dependsOn.length) {
        fail('INVALID_OPERATION', 'Expected named reference IDs and distinct dependency IDs.');
      }
      if (project.nodes.some(existing => existing.id === node.id)) fail('DUPLICATE_ID', `Node ${node.id} already exists.`);
      project.nodes.push(node);
      return node.id;
    }
    case 'update': {
      const node = findNode(project, command.id);
      keysOnly(command.patch, ['data', 'references', 'dependsOn'], 'patch');
      const replacement = { ...node, ...command.patch };
      // Reuse create's local-shape checks; mutation occurs only after success.
      const scratch = { ...project, nodes: [] };
      edit(scratch, { op: 'create', node: replacement });
      project.nodes[project.nodes.indexOf(node)] = replacement;
      return node.id;
    }
    case 'disconnect':
      if (findNode(project, command.id).kind !== 'relationship') fail('NOT_RELATIONSHIP', 'disconnect requires a relationship ID.');
      return edit(project, { op: 'remove', id: command.id });
    case 'remove': {
      findNode(project, command.id);
      if (command.cascade !== undefined && typeof command.cascade !== 'boolean') fail('INVALID_OPERATION', 'cascade must be a boolean.');
      const dependents = dependencies(project, command.id, { direction: 'incoming', edge: 'all', transitive: true });
      if (dependents.length && !command.cascade) {
        fail('REFERENCED_REMOVAL', `${command.id} is referenced; disconnect/rewire first or explicitly use cascade:true.`, { dependents });
      }
      const removed = new Set([command.id, ...(command.cascade ? dependents : [])]);
      project.nodes = project.nodes.filter(node => !removed.has(node.id));
      return [...removed].sort();
    }
  }
}
