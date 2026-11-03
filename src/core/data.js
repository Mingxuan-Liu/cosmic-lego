// Domain-independent, data-only boundary. Trusted code is supplied separately.
export class KernelError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'KernelError';
    this.code = code;
    Object.assign(this, details);
  }
}

export function fail(code, message, details) {
  throw new KernelError(code, message, details);
}

export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);

// Unlike JSON.stringify, reject lossy values, getters and custom prototypes.
// In particular, never invoke an input object's getter or toJSON method.
export function copyData(value) {
  const active = new Set();
  function copy(item, path, depth) {
    if (depth > 100) fail('INVALID_DATA', `${path}: data nesting exceeds 100.`);
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object') fail('INVALID_DATA', `${path}: expected finite JSON data.`);
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      fail('INVALID_DATA', `${path}: expected a plain data object.`);
    }
    if (active.has(item)) fail('INVALID_DATA', `${path}: cyclic JavaScript data is not a graph reference.`);
    active.add(item);
    const output = array ? [] : {};
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) fail('INVALID_DATA', `${path}: expected a dense JSON array.`);
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') ||
          (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))) {
        fail('INVALID_DATA', `${path}: expected enumerable data properties, without accessors.`);
      }
      Object.defineProperty(output, key, {
        value: copy(descriptor.value, `${path}.${key}`, depth + 1),
        writable: true, enumerable: true, configurable: true,
      });
    }
    active.delete(item);
    return output;
  }
  return copy(value, '$', 0);
}

export function freezeData(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

export function keysOnly(value, allowed, label) {
  if (!isRecord(value)) fail('INVALID_OPERATION', `${label} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('UNSUPPORTED_FIELD', `${label}.${key} is not supported.`);
  }
}

export function freshId(prefix) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}
