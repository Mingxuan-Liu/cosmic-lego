// Deliberately small data-schema subset. No references, patterns, or source code.
import { KernelError } from '../core/index.js';
import { copyData, isRecord } from '../core/data.js';

export const SCHEMA_LIMITS = Object.freeze({ schemaDepth: 24, schemaNodes: 1024, dataDepth: 64, dataNodes: 100000 });
const types = ['object', 'array', 'number', 'integer', 'string', 'boolean', 'null'];
const common = ['type', 'description', 'default', 'enum'];
const specific = { object: ['properties', 'required', 'additionalProperties'], array: ['items', 'minItems', 'maxItems'], number: ['minimum', 'maximum'], integer: ['minimum', 'maximum'] };
const diagnostic = (code, path, message) => ({ code, path, message });
const own = (object, key) => Object.hasOwn(object, key);
const scalar = value => value === null || ['string', 'boolean', 'number'].includes(typeof value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const matches = (type, value) => ({
  object: isRecord(value), array: Array.isArray(value), number: finite(value),
  integer: Number.isSafeInteger(value), string: typeof value === 'string',
  boolean: typeof value === 'boolean', null: value === null,
})[type];

function dataErrors(schema, data, path = '$') {
  const errors = [];
  let visited = 0;
  const error = (code, at, message) => errors.push(diagnostic(code, at, message));
  function visit(rule, item, at, depth) {
    if (visited > SCHEMA_LIMITS.dataNodes) return;
    if (++visited > SCHEMA_LIMITS.dataNodes || depth > SCHEMA_LIMITS.dataDepth) {
      error('SCHEMA_BUDGET', at, 'Data exceeds the schema validation depth/work limit.');
      return;
    }
    if (!matches(rule.type, item)) { error('SCHEMA_TYPE', at, `Expected ${rule.type}.`); return; }
    if (rule.enum && !rule.enum.some(candidate => candidate === item)) error('SCHEMA_ENUM', at, 'Value is not one of the declared enum choices.');
    if (rule.type === 'object') {
      for (const key of rule.required ?? []) if (!own(item, key)) error('SCHEMA_REQUIRED', `${at}.${key}`, 'Required property is missing.');
      for (const [key, child] of Object.entries(item)) {
        if (visited > SCHEMA_LIMITS.dataNodes) break;
        if (!own(rule.properties, key)) {
          if (++visited > SCHEMA_LIMITS.dataNodes) error('SCHEMA_BUDGET', at, 'Data exceeds the schema validation depth/work limit.');
          else error('SCHEMA_EXTRA', `${at}.${key}`, 'Additional properties are not allowed.');
        }
        else visit(rule.properties[key], child, `${at}.${key}`, depth + 1);
      }
    } else if (rule.type === 'array') {
      if (own(rule, 'minItems') && item.length < rule.minItems) error('SCHEMA_BOUND', at, `Expected at least ${rule.minItems} items.`);
      if (own(rule, 'maxItems') && item.length > rule.maxItems) error('SCHEMA_BOUND', at, `Expected at most ${rule.maxItems} items.`);
      for (let i = 0; i < item.length && visited <= SCHEMA_LIMITS.dataNodes; i++) visit(rule.items, item[i], `${at}[${i}]`, depth + 1);
    } else if (rule.type === 'number' || rule.type === 'integer') {
      if (own(rule, 'minimum') && item < rule.minimum) error('SCHEMA_BOUND', at, `Expected a value >= ${rule.minimum}.`);
      if (own(rule, 'maximum') && item > rule.maximum) error('SCHEMA_BOUND', at, `Expected a value <= ${rule.maximum}.`);
    }
  }
  visit(schema, data, path, 0);
  return errors;
}

export function validateSchema(input) {
  const errors = [];
  let schema;
  try { schema = copyData(input); }
  catch (error) { return { valid: false, errors: [diagnostic('INVALID_SCHEMA', '$', error.message)] }; }
  let count = 0;
  const defaults = [];
  function visit(rule, path, depth) {
    if (++count > SCHEMA_LIMITS.schemaNodes || depth > SCHEMA_LIMITS.schemaDepth) {
      errors.push(diagnostic('SCHEMA_BUDGET', path, 'Schema exceeds the supported depth/node limit.')); return;
    }
    if (!isRecord(rule) || !types.includes(rule.type)) {
      errors.push(diagnostic('INVALID_SCHEMA', path, 'Declare one supported scalar type, object, or array.')); return;
    }
    const fail = (message, suffix = '') => errors.push(diagnostic('INVALID_SCHEMA', `${path}${suffix}`, message));
    const allowed = [...common, ...(specific[rule.type] ?? [])];
    for (const key of Object.keys(rule)) if (!allowed.includes(key)) fail(`Unsupported schema keyword ${key}.`, `.${key}`);
    if (own(rule, 'description') && typeof rule.description !== 'string') fail('description must be a string.', '.description');
    if (own(rule, 'enum')) {
      if (!Array.isArray(rule.enum) || !rule.enum.length || rule.enum.some(v => !scalar(v) || !matches(rule.type, v)) || new Set(rule.enum.map(v => JSON.stringify(v))).size !== rule.enum.length) fail('enum must contain distinct scalar values matching the schema type.', '.enum');
    }
    if (own(rule, 'default')) defaults.push({ rule, path });
    if (rule.type === 'object') {
      if (!isRecord(rule.properties)) { fail('Object schemas require a properties map.', '.properties'); return; }
      if (rule.additionalProperties !== false) fail('Object schemas must set additionalProperties:false.', '.additionalProperties');
      if (own(rule, 'required') && (!Array.isArray(rule.required) || rule.required.some(key => typeof key !== 'string' || !own(rule.properties, key)) || new Set(rule.required).size !== rule.required.length)) fail('required must list distinct declared properties.', '.required');
      for (const [key, child] of Object.entries(rule.properties)) {
        if (count > SCHEMA_LIMITS.schemaNodes) break;
        visit(child, `${path}.properties.${key}`, depth + 1);
      }
    } else if (rule.type === 'array') {
      for (const key of ['minItems', 'maxItems']) if (own(rule, key) && (!Number.isSafeInteger(rule[key]) || rule[key] < 0)) fail(`${key} must be a nonnegative safe integer.`, `.${key}`);
      if (own(rule, 'minItems') && own(rule, 'maxItems') && rule.minItems > rule.maxItems) fail('minItems exceeds maxItems.');
      if (!own(rule, 'items')) fail('Array schemas require an items schema.', '.items');
      else visit(rule.items, `${path}.items`, depth + 1);
    } else if (rule.type === 'number' || rule.type === 'integer') {
      for (const key of ['minimum', 'maximum']) if (own(rule, key) && !finite(rule[key])) fail(`${key} must be finite.`, `.${key}`);
      if (own(rule, 'minimum') && own(rule, 'maximum') && rule.minimum > rule.maximum) fail('minimum exceeds maximum.');
    }
  }
  visit(schema, '$', 0);
  if (!errors.length) for (const { rule, path } of defaults) errors.push(...dataErrors(rule, rule.default, `${path}.default`));
  return { valid: !errors.length, errors };
}

export function validateData(schema, input, path = '$') {
  const validation = validateSchema(schema);
  if (!validation.valid) return validation.errors;
  try { return dataErrors(schema, copyData(input), path); }
  catch (error) { return [diagnostic('INVALID_DATA', path, error.message)]; }
}

export function applyDefaults(schema, input) {
  const validation = validateSchema(schema);
  if (!validation.valid) throw new KernelError('INVALID_SCHEMA', 'Cannot apply an invalid parameter schema.', { validation });
  const data = copyData(input);
  let visited = 0;
  function fill(rule, item, depth) {
    if (++visited > SCHEMA_LIMITS.dataNodes || depth > SCHEMA_LIMITS.dataDepth) throw new KernelError('SCHEMA_BUDGET', 'Default application exceeds its depth/work limit.');
    if (rule.type === 'object' && isRecord(item)) {
      for (const [key, child] of Object.entries(rule.properties)) {
        if (!own(item, key) && own(child, 'default')) Object.defineProperty(item, key, { value: copyData(child.default), enumerable: true, configurable: true, writable: true });
        if (own(item, key)) item[key] = fill(child, item[key], depth + 1);
      }
    } else if (rule.type === 'array' && Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) item[i] = fill(rule.items, item[i], depth + 1);
    }
    return item;
  }
  return fill(schema, data, 0);
}
