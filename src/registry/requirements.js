import { copyData, isRecord } from '../core/data.js';
import { TYPES } from '../dataflow/contracts.js';
import { diagnostic, identityEqual, issue } from './contracts.js';

export const builtinTypes = new Set(Object.values(TYPES));

// Read-only inspection works even when a saved graph's extensions are absent.
// Requirements never register implementations or fetch referenced code.
export function inspectRequirements(input, records, capabilities) {
  const requirements = [], errors = [];
  let graph;
  try { graph = copyData(input); }
  catch (error) { return { valid: false, requirements, errors: [issue(error)] }; }
  if (!isRecord(graph) || !Array.isArray(graph.nodes)) return {
    valid: false, requirements, errors: [diagnostic('PROJECT_SCHEMA', 'Expected graph data with nodes.')],
  };
  const groups = new Map();
  const expand = (record, nodeId) => {
    for (const dependency of record.manifest.dependencies) {
      const installed = records.get(dependency.id);
      const pinnedImplementation = dependency.build && installed ? { ...installed.manifest.implementation, build: dependency.build } : null;
      add(dependency.id, dependency.version, pinnedImplementation, nodeId, record.manifest.id);
    }
  };
  const add = (id, version, implementation, nodeId, dependencyOf = null) => {
    const key = JSON.stringify([id, version, implementation?.id, implementation?.version, implementation?.build]);
    if (groups.has(key)) {
      const existing = groups.get(key);
      const newNode = !existing.nodeIds.includes(nodeId);
      if (newNode) existing.nodeIds.push(nodeId);
      if (dependencyOf && !existing.dependencyOf.includes(dependencyOf)) existing.dependencyOf.push(dependencyOf);
      if (newNode && existing.available) expand(records.get(id), nodeId);
      return;
    }
    const record = records.get(id);
    const compatible = !!record && version === record.manifest.version && (!implementation || identityEqual(implementation, record.manifest.implementation));
    const entry = { id, version, implementation: implementation ?? null, nodeIds: [nodeId], dependencyOf: dependencyOf ? [dependencyOf] : [], available: compatible };
    groups.set(key, entry); requirements.push(entry);
    if (!record) errors.push(diagnostic('EXTENSION_MISSING', `Install trusted extension ${id}${version ? ` at ${version}` : ''} before accepting this project.`, nodeId));
    else if (version !== record.manifest.version) errors.push(diagnostic('VERSION_MISMATCH', `${id} requires ${version}; installed ${record.manifest.version}.`, nodeId));
    else if (implementation && !identityEqual(implementation, record.manifest.implementation)) errors.push(diagnostic('IMPLEMENTATION_MISMATCH', `${id} requires a different implementation/version/build.`, nodeId));
    if (record) for (const capability of record.manifest.capabilities) if (!capabilities.has(capability)) errors.push(diagnostic('CAPABILITY_MISSING', `${id} requires capability ${capability}.`, nodeId));
    if (compatible) expand(record, nodeId);
  };
  for (const node of graph.nodes) {
    if (!isRecord(node) || typeof node.type !== 'string') { errors.push(diagnostic('PROJECT_SCHEMA', 'A node needs a type.')); continue; }
    const pin = node.data?.extension;
    if (node.kind === 'relationship' && pin === undefined) continue;
    if (builtinTypes.has(node.type)) {
      if (pin !== undefined) errors.push(diagnostic('EXTENSION_PIN', 'Built-in dataflow nodes cannot register an extension pin.', node.id));
      continue;
    }
    if (!isRecord(pin)) {
      errors.push(diagnostic('EXTENSION_PIN_REQUIRED', `Node ${node.id} needs an explicit extension identity/version/build pin.`, node.id));
      add(node.type, null, null, node.id);
      continue;
    }
    if (Object.keys(pin).length !== 3 || pin.id !== node.type || typeof pin.version !== 'string' || !isRecord(pin.implementation) ||
      !['id', 'version', 'build'].every(key => typeof pin.implementation[key] === 'string') || Object.keys(pin.implementation).length !== 3) {
      errors.push(diagnostic('EXTENSION_PIN', 'An extension pin must contain matching id, version and implementation {id,version,build}.', node.id));
    }
    add(node.type, pin.version ?? null, pin.implementation ?? null, node.id);
  }
  return { valid: !errors.length, requirements, errors };
}
