import { parentPort, workerData } from 'node:worker_threads';
import { ExtensionRegistry } from '../registry/index.js';
import { prepareComputation, runComputation } from './engine.js';
import { bytes, failed, insist } from './contracts.js';

if (parentPort) {
  const { registryModule, graph, identity, limits } = workerData;
  let plan, startupError;
  try {
    // Host configuration, never a field from a project, manifest or checkpoint.
    const host = await import(registryModule);
    insist(typeof host.createRegistry === 'function', 'RUNTIME_HOST', 'The installed host must export createRegistry().');
    const registry = host.createRegistry();
    insist(registry instanceof ExtensionRegistry, 'RUNTIME_HOST', 'createRegistry must return the shared ExtensionRegistry.');
    plan = prepareComputation(registry, graph, limits);
  } catch (error) { startupError = error; }
  function execute({ id, nodeId, request, cached }) {
    let result;
    try {
      if (startupError) throw startupError;
      result = runComputation({ plan, identity, nodeId, request, cached, limits,
        progress: progress => parentPort.postMessage({ id, kind: 'progress', progress }) });
      insist(bytes(result) <= limits.maxResultBytes, 'RESULT_BUDGET', 'Result exceeds the runtime byte limit.');
    } catch (error) { result = failed(identity, nodeId, request, error); }
    parentPort.postMessage({ id, kind: 'result', result });
  }
  // A running host from the previous release submits its one job at construction.
  if (workerData.request) {
    execute(workerData);
    parentPort.close();
  } else parentPort.on('message', execute);
}
