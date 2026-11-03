import { KernelError } from '../core/index.js';
import { copyData, freezeData, isRecord } from '../core/data.js';

export const REGISTRY_LIMITS = Object.freeze({ maxExtensions: 64, maxCases: 64, maxArtifactEntries: 10000 });
export const SCIENTIFIC = new Set(['model', 'operator']);
export const diagnostic = (code, message, path = '$') => ({ code, path, message, severity: 'error' });
export function reject(code, message, path = '$') { throw new KernelError(code, message, { path }); }
export function requireThat(condition, code, message, path) { if (!condition) reject(code, message, path); }
export function issue(error, path = '$') { return diagnostic(error?.code ?? 'EXTENSION_ERROR', error?.message ?? String(error), error?.path ?? path); }
export function keys(input, allowed, name) {
  requireThat(isRecord(input), 'EXTENSION_CONTRACT', `${name} must be an object.`);
  for (const key of Object.keys(input)) requireThat(allowed.includes(key), 'EXTENSION_CONTRACT', `Unknown ${name} field ${key}.`);
}
export function invoke(fn, argument) {
  const result = fn(freezeData(copyData(argument)));
  if (result instanceof Promise) {
    result.catch(() => {});
    reject('ASYNC_IMPLEMENTATION', 'F03 callbacks must be synchronous. Stateful/asynchronous execution belongs to F04.');
  }
  return copyData(result);
}
export function diagnostics(input) {
  requireThat(Array.isArray(input) && input.every(item => isRecord(item) && typeof item.code === 'string' &&
    typeof item.path === 'string' && typeof item.message === 'string'), 'EXTENSION_CONTRACT', 'Validators must return {code,path,message} diagnostics.');
  return input;
}
export function identityEqual(a, b) {
  return isRecord(a) && isRecord(b) && ['id', 'version', 'build'].every(key => a[key] === b[key]) && Object.keys(a).length === 3;
}
export function tokenEqual(a, b) {
  return a.projectId === b.projectId && a.generation === b.generation && a.revision === b.revision;
}
export function artifactSize(data) {
  if (Array.isArray(data)) return 1 + data.reduce((sum, item) => sum + artifactSize(item), 0);
  if (isRecord(data)) return 1 + Object.values(data).reduce((sum, item) => sum + artifactSize(item), 0);
  return typeof data === 'string' ? Math.max(1, data.length) : 1;
}
