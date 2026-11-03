import { KernelError } from '../core/index.js';
import { copyData, freezeData, isRecord } from '../core/data.js';

export const TYPES = Object.freeze({
  constant: 'dataflow.constant', selection: 'dataflow.selection', field: 'dataflow.field',
  arithmetic: 'dataflow.arithmetic', map: 'dataflow.map', reduce: 'dataflow.reduce', adapt: 'dataflow.adapt',
});
export const DEFAULT_LIMITS = Object.freeze({ maxNodes: 256, maxValues: 10000, maxWork: 100000, maxDepth: 128 });
export const diagnostic = (code, message, path = '$', severity = 'error') => ({ code, path, message, severity });
export function reject(code, message, path = '$') {
  throw new KernelError(code, message, { path });
}
export function issue(error, path = '$') {
  return diagnostic(error?.code ?? 'DATAFLOW_ERROR', error?.message ?? String(error), error?.path ?? path);
}
export function insist(condition, code, message, path) {
  if (!condition) reject(code, message, path);
}
export function exactKeys(input, allowed, label) {
  insist(isRecord(input), 'INVALID_DEFINITION', `${label} must be an object.`);
  for (const key of Object.keys(input)) insist(allowed.includes(key), 'INVALID_DEFINITION', `Unknown ${label} field ${key}.`);
}
export function invoke(fn, ...args) {
  const result = fn(...args.map(arg => freezeData(copyData(arg))));
  if (result instanceof Promise) {
    result.catch(() => {});
    reject('ASYNC_IMPLEMENTATION', 'F02 implementations must be synchronous; asynchronous execution belongs to the runtime.');
  }
  return copyData(result);
}
export function countValues(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countValues(item), 0);
  return value === null ? 1 : typeof value === 'number' ? 1 : 0;
}
export function implementation(record, fallback) {
  const identity = record?.implementation ?? fallback;
  insist(isRecord(identity) && typeof identity.id === 'string' && identity.id.length > 0 &&
    typeof identity.version === 'string' && identity.version.length > 0,
  'IMPLEMENTATION_ID', 'An implementation needs nonempty id and version strings.');
  return copyData(identity);
}
export const builtinImplementation = Object.freeze({ id: 'cosmic-lego.dataflow', version: '1' });
