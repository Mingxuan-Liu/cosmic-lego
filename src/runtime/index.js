import { Worker } from 'node:worker_threads';
import { Project } from '../core/index.js';
import { copyData, freezeData, isRecord } from '../core/data.js';
import { unit } from '../dataflow/index.js';
import { bytes, failed, fields, insist, limitsOf, sameIdentity, seconds, timeOf } from './contracts.js';

export { RUNTIME_LIMITS } from './contracts.js';

// Only a trusted composition root chooses this file URL. Neither project data
// nor a submitted job can select executable modules or serialized functions.
export function createRuntime({ registryModule, limits: inputLimits = {} } = {}) {
  let moduleURL;
  try { moduleURL = new URL(registryModule); } catch { insist(false, 'RUNTIME_HOST', 'Supply an explicit trusted composition-root file URL.'); }
  insist(moduleURL.protocol === 'file:' && !moduleURL.search && !moduleURL.hash, 'RUNTIME_HOST', 'The registry host must be an installed local file URL.');
  const limits = limitsOf(inputLimits);
  let active = null, selected = null, cacheToken = null, cached = [], disposed = false, sequence = 0;
  const terminating = new Set();
  function stopWorker(worker) {
    if (!worker) return Promise.resolve();
    const completion = worker.terminate().catch(() => {}).finally(() => terminating.delete(completion));
    terminating.add(completion);
    return completion;
  }
  const runtime = {
    limits,
    setProject(project) {
      insist(project instanceof Project, 'PROJECT_REQUIRED', 'Use an accepted F01 Project.');
      if (selected !== project || (cacheToken && !sameIdentity(cacheToken, project.token))) {
        active?.stop('STALE_RESULT', 'The selected project or accepted revision changed.');
        cached = []; cacheToken = null;
      }
      selected = project;
    },
    submit(project, nodeId, input = {}) {
      insist(!disposed, 'RUNTIME_DISPOSED', 'Create another runtime after disposal.');
      insist(project instanceof Project && typeof nodeId === 'string', 'PROJECT_REQUIRED', 'Use an accepted Project and producing node ID.');
      const request = copyData(input);
      fields(request, ['port', 'time', 'mode', 'settings', 'checkpoints'], 'job request');
      request.port ??= 'value'; request.time ??= timeOf(0); request.mode ??= 'auto'; request.settings ??= {};
      insist(typeof request.port === 'string' && request.port.length > 0 && ['auto', 'analytic', 'stateful'].includes(request.mode), 'RUNTIME_REQUEST', 'Use an output port and a supported evaluation path.');
      seconds(request.time);
      request.time = { value: request.time.value, unit: unit(request.time.unit) };
      insist(isRecord(request.settings), 'RUNTIME_REQUEST', 'Settings are a map keyed by component ID.');
      if (request.checkpoints !== undefined) insist(Array.isArray(request.checkpoints), 'CHECKPOINT_SCHEMA', 'Checkpoints must be an array of data records.');
      insist(bytes(request) <= limits.maxCheckpointBytes, 'CHECKPOINT_BUDGET', 'Job request/checkpoints exceed the byte limit.');
      const graph = project.snapshot(), identity = project.token;
      insist(bytes(graph) <= limits.maxGraphBytes, 'GRAPH_BUDGET', 'The graph exceeds the runtime byte limit.');
      runtime.setProject(project);
      active?.stop('SUPERSEDED', 'A newer requested snapshot superseded this job.');
      const id = `job-${++sequence}`, started = performance.now();
      const state = { status: 'queued', progress: { phase: 'queued', steps: 0, work: 0 } };
      let worker = null, settled = false, timer, monitor, resolve;
      const promise = new Promise(done => { resolve = done; });
      const finish = result => {
        if (settled) return;
        if (selected !== project || !sameIdentity(identity, project.token)) {
          result = failed(identity, nodeId, request, { code: 'STALE_RESULT', message: 'Project identity changed; this job cannot publish results.' });
        }
        settled = true;
        clearTimeout(timer); clearInterval(monitor);
        result.metadata ??= {};
        result.metadata.runtime = { ...result.metadata.runtime, jobId: id, elapsedMs: performance.now() - started };
        state.status = result.valid ? 'completed' : ['CANCELLED', 'SUPERSEDED'].includes(result.diagnostics[0]?.code) ? 'cancelled' : 'failed';
        state.progress = { ...state.progress, phase: state.status };
        if (result.valid) {
          const retained = new Map(cached.map(checkpoint => [checkpoint.nodeId, checkpoint]));
          for (const checkpoint of result.checkpoints) {
            retained.delete(checkpoint.nodeId);
            retained.set(checkpoint.nodeId, copyData(checkpoint));
          }
          while (retained.size > limits.maxSnapshots || bytes([...retained.values()]) > limits.maxCheckpointBytes) retained.delete(retained.keys().next().value);
          cached = [...retained.values()]; cacheToken = copyData(identity);
        }
        if (active?.id === id) active = null;
        stopWorker(worker);
        resolve(freezeData(copyData(result)));
      };
      const stop = (code = 'CANCELLED', message = 'Computation was cancelled; accepted project and previous checkpoints are unchanged.') =>
        finish(failed(identity, nodeId, request, { code, message }));
      const job = Object.freeze({ id, promise, cancel: () => stop(),
        get status() { return state.status; }, get progress() { return copyData(state.progress); } });
      active = { id, stop };
      timer = setTimeout(() => stop('TIME_BUDGET', `Job exceeded ${limits.maxWallMs} milliseconds including worker startup.`), limits.maxWallMs);
      monitor = setInterval(() => {
        if (selected !== project || !sameIdentity(identity, project.token)) stop('STALE_RESULT', 'Project changed during computation.');
      }, Math.min(limits.progressIntervalMs, 25));
      // Wait for prior workers to exit so repeated replacement cannot accumulate
      // uncancellable threads. Only the newest queued request can launch.
      Promise.all([...terminating]).then(() => {
        if (settled) return;
        try {
          worker = new Worker(new URL('./worker.js', import.meta.url), {
            workerData: { registryModule: moduleURL.href, graph, identity, nodeId, request, limits,
              cached: cacheToken && sameIdentity(cacheToken, identity) ? copyData(cached) : [] },
            execArgv: [], resourceLimits: { maxOldGenerationSizeMb: limits.workerMemoryMb },
          });
          state.status = 'running';
          worker.on('message', message => {
            if (settled) return;
            if (message.kind === 'progress') state.progress = copyData(message.progress);
            else if (message.kind === 'result') finish(message.result);
          });
          worker.on('error', error => stop(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'MEMORY_BUDGET' : 'WORKER_ERROR', error.message));
          worker.on('exit', code => { if (!settled) stop('WORKER_EXIT', `Worker exited before returning a result (code ${code}).`); });
        } catch (error) { stop(error.code ?? 'WORKER_ERROR', error.message); }
      });
      return job;
    },
    async dispose() {
      disposed = true; active?.stop('CANCELLED', 'Runtime disposed.');
      cached = []; cacheToken = null; selected = null;
      await Promise.all([...terminating]);
    },
  };
  return Object.freeze(runtime);
}
