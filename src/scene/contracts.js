import { KernelError } from '../core/index.js';
import { copyData, isRecord } from '../core/data.js';

export const SCENE_LIMITS = Object.freeze({ maxNodes: 256, maxInstances: 10000, maxAssetBytes: 4000000, maxAssets: 128, maxTextChars: 256 });
export const diagnostic = (code, message, path = '$', severity = 'error') => ({ code, path, message, severity });
export const issue = error => diagnostic(error?.code ?? 'SCENE_ERROR', error?.message ?? String(error), error?.path ?? '$');
export function insist(condition, code, message, path = '$') { if (!condition) throw new KernelError(code, message, { path }); }
export const sameIdentity = (a, b) => a && b && a.projectId === b.projectId && a.generation === b.generation && a.revision === b.revision;
export const canonical = data => Array.isArray(data) ? `[${data.map(canonical).join(',')}]` : isRecord(data)
  ? `{${Object.keys(data).sort().map(key => `${JSON.stringify(key)}:${canonical(data[key])}`).join(',')}}` : JSON.stringify(data);
export const dataBytes = data => new TextEncoder().encode(JSON.stringify(data)).length;
export function sceneLimits(input = {}) {
  const limits = { ...SCENE_LIMITS, ...copyData(input) };
  insist(Object.keys(limits).every(key => Object.hasOwn(SCENE_LIMITS, key)) && Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0), 'SCENE_LIMITS', 'Scene limits must use supported positive safe-integer fields.');
  return Object.freeze(limits);
}
