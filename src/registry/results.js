// Shared gate for consumers of previously evaluated scientific snapshots.
// This validates data and declared provenance; it never runs a producer.
import { copyData, isRecord } from '../core/data.js';
import { checkPort, unit, value } from '../dataflow/index.js';
import { reject, requireThat, tokenEqual } from './contracts.js';

export function validateSuppliedResult(input, { identity, nodeId, port, implementation, descriptor, time }) {
  const result = copyData(input);
  requireThat(isRecord(result) && isRecord(result.producer) && result.producer.nodeId === nodeId && result.producer.port === port,
    'RESULT_REQUIRED', 'A scientific snapshot must identify its exact producing node and port.');
  requireThat(Array.isArray(result.diagnostics) && result.diagnostics.every(item => isRecord(item) && typeof item.code === 'string' && typeof item.message === 'string') && isRecord(result.metadata),
    'RESULT_REQUIRED', 'A scientific snapshot must retain diagnostics and sampling metadata.');
  if (result.valid !== true) {
    const error = result.diagnostics.find(item => item.severity !== 'warning') ?? result.diagnostics[0];
    reject(error?.code ?? 'RESULT_REQUIRED', error?.message ?? 'A failed scientific snapshot cannot be consumed.', error?.path);
  }
  requireThat(isRecord(result.identity) && tokenEqual(identity, result.identity), 'STALE_RESULT', 'Scientific input belongs to a different project snapshot.');
  requireThat(isRecord(result.producer.implementation) && ['id', 'version', 'build'].every(key => result.producer.implementation[key] === implementation[key]),
    'IMPLEMENTATION_MISMATCH', 'Scientific result implementation differs from its installed producer.');
  result.value = value(result.value);
  const errors = checkPort(result.value, descriptor);
  if (errors.length) reject(errors[0].code, errors[0].message, errors[0].path);
  function seconds(inputTime) {
    requireThat(isRecord(inputTime), 'TIME_MISMATCH', 'A supplied result must retain its physical sampling time.');
    const normalized = unit(inputTime.unit), seconds = inputTime.value * normalized.scale;
    requireThat(Number.isFinite(inputTime.value) && Number.isFinite(seconds) && JSON.stringify(normalized.dimensions) === JSON.stringify(unit('s').dimensions),
      'TIME_MISMATCH', 'Scientific sampling time must be finite physical time.');
    return seconds;
  }
  const requested = seconds(time), actualTime = result.metadata.runtime?.achievedTime ?? result.value.time ?? result.request?.time;
  for (const actual of [seconds(actualTime), ...(result.value.time ? [seconds(result.value.time)] : [])]) {
    requireThat(Math.abs(actual - requested) <= 16 * Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(requested)),
      'TIME_MISMATCH', 'Supplied scientific result describes another physical time.');
  }
  return result;
}
