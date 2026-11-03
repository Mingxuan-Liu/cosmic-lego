import { parentPort, workerData } from 'node:worker_threads';
import { ExtensionRegistry } from '../registry/index.js';
import { runComputation } from './engine.js';
import { bytes, failed, insist } from './contracts.js';

if (parentPort) {
  const { registryModule, graph, identity, nodeId, request, cached, limits } = workerData;
  try {
    // Host configuration, never a field from a project, manifest or checkpoint.
    const host = await import(registryModule);
    insist(typeof host.createRegistry === 'function', 'RUNTIME_HOST', 'The installed host must export createRegistry().');
    const registry = host.createRegistry();
    insist(registry instanceof ExtensionRegistry, 'RUNTIME_HOST', 'createRegistry must return the shared ExtensionRegistry.');
    const result = runComputation({ registry, graph, identity, nodeId, request, cached, limits,
      progress: progress => parentPort.postMessage({ kind: 'progress', progress }) });
    insist(bytes(result) <= limits.maxResultBytes, 'RESULT_BUDGET', 'Result exceeds the runtime byte limit.');
    parentPort.postMessage({ kind: 'result', result });
  } catch (error) { parentPort.postMessage({ kind: 'result', result: failed(identity, nodeId, request, error) }); }
  parentPort.close();
}
