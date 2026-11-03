import { createHash } from 'node:crypto';
import { KernelError } from '../core/index.js';
import { copyData, freezeData, isRecord } from '../core/data.js';
import { unit } from '../dataflow/index.js';

export const RUNTIME_LIMITS = Object.freeze({
  maxSteps: 10000, maxWork: 1000000, maxStateBytes: 1000000,
  maxCheckpointBytes: 2000000, maxSnapshots: 128, maxWallMs: 5000,
  maxGraphBytes: 2000000, maxResultBytes: 4000000, workerMemoryMb: 64,
  progressIntervalMs: 25,
});
export const diagnostic = (code, message, path = '$') => ({ code, path, message, severity: 'error' });
export const issue = error => diagnostic(error?.code ?? 'RUNTIME_ERROR', error?.message ?? String(error), error?.path ?? '$');
export function insist(condition, code, message, path) {
  if (!condition) throw new KernelError(code, message, { path: path ?? '$' });
}
export function fields(object, allowed, label) {
  insist(isRecord(object), 'RUNTIME_REQUEST', `${label} must be a data object.`);
  insist(Object.keys(object).every(key => allowed.includes(key)), 'RUNTIME_REQUEST', `Unsupported ${label} field.`);
}
export function limitsOf(input = {}) {
  const limits = { ...RUNTIME_LIMITS, ...copyData(input) };
  fields(limits, Object.keys(RUNTIME_LIMITS), 'limits');
  insist(Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0), 'RUNTIME_LIMITS', 'Limits must be positive safe integers.');
  return Object.freeze(limits);
}
export const sameIdentity = (a, b) => a.projectId === b.projectId && a.generation === b.generation && a.revision === b.revision;
export const bytes = data => Buffer.byteLength(JSON.stringify(data), 'utf8');
export const canonical = data => Array.isArray(data) ? `[${data.map(canonical).join(',')}]` : isRecord(data)
  ? `{${Object.keys(data).sort().map(key => `${JSON.stringify(key)}:${canonical(data[key])}`).join(',')}}` : JSON.stringify(data);
export const equal = (a, b) => canonical(a) === canonical(b);
export const fingerprint = data => `sha256:${createHash('sha256').update(canonical(data)).digest('hex')}`;
export function seconds(input) {
  fields(input, ['value', 'unit'], 'physical time');
  const u = unit(input.unit);
  insist(Number.isFinite(input.value) && equal(u.dimensions, unit('s').dimensions), 'INVALID_TIME', 'Physical time needs a finite value and time units.');
  const result = input.value * u.scale;
  insist(Number.isFinite(result), 'INVALID_TIME', 'Physical time exceeds finite seconds.');
  return result;
}
export const timeOf = time => ({ value: time, unit: unit('s') });
export const closeTime = (a, b) => Math.abs(a - b) <= 16 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
export function invoke(fn, argument) {
  const output = fn(freezeData(copyData(argument)));
  if (output instanceof Promise) {
    output.catch(() => {});
    insist(false, 'ASYNC_IMPLEMENTATION', 'Runtime lifecycle callbacks are bounded synchronous steps executed in a worker.');
  }
  return copyData(output);
}
export function failed(identity, nodeId, request, error) {
  return { identity: copyData(identity), producer: { nodeId, port: request.port ?? 'value', implementation: null },
    request: { time: copyData(request.time ?? timeOf(0)) }, value: null, valid: false,
    diagnostics: [issue(error)], metadata: { approximation: [], sampling: {}, implementations: [], work: 0 }, checkpoints: [] };
}
