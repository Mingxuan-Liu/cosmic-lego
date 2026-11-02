// This schema describes the supported authoring surface, not a universal ontology.
const identifier = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]*$', minLength: 1, maxLength: 40 };
const label = { type: 'string', minLength: 1, maxLength: 100 };
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items, maxItems) => ({ type: 'array', items, minItems: 1, maxItems });

export const sceneSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'AstroCompose exoplanet scene v0.1',
  description: 'Independent circular two-body systems, observers, and linked views. Units appear in field names. Physical coupling constraints are checked separately.',
  ...object({
    schemaVersion: { const: '0.1' },
    title: label,
    systems: array(object({
      id: identifier, label,
      starMassSolar: number(0.1, 3),
      starRadiusSolar: number(0.1, 5),
      planetMassJupiter: number(0, 10),
      planetRadiusJupiter: number(0, 2.5),
      periodDays: number(0.2, 365)
    }), 8),
    observers: array(object({ id: identifier, label, inclinationDeg: number(0, 90) }), 8),
    views: array(object({ id: identifier, systemId: identifier, observerId: identifier }), 16),
    presentation: object({ orbitSeconds: number(4, 120), planetDisplayScale: number(1, 12) })
  })
};

export const capabilities = {
  name: 'AstroCompose', version: '0.1.0', schemaVersion: '0.1',
  purpose: 'Compose models, observers and linked explanations of exoplanet detection.',
  models: [{
    id: 'circular-two-body-uniform-transit',
    description: 'One isolated Newtonian star–planet pair; circular orbit; opaque dark planet; uniform spherical stellar disk; distant observer.',
    independentParameters: ['starMassSolar', 'starRadiusSolar', 'planetMassJupiter', 'planetRadiusJupiter', 'periodDays'],
    derivedParameters: ['semiMajorAxisMeters', 'starOrbitRadiusMeters', 'planetOrbitRadiusMeters', 'orbital angular frequency'],
    observables: ['normalized unresolved stellar flux', 'line-of-sight velocity of the stellar center of mass'],
    constraints: ['Orbital separation exceeds the sum of the radii.', 'Observer inclination is 0° face-on to 90° edge-on.', 'Phase zero is inferior conjunction; it is mid-transit only for transiting geometry.'],
    assumptions: ['No eccentricity, planet–planet interaction, limb darkening, spots, atmosphere, finite exposure, noise, light-time correction or relativity.', 'Mass and radius are independent idealized parameters, not a stellar or planetary structure model.', 'Radial velocity is positive receding; spectra and rotation-induced line profile effects are not modeled.']
  }],
  composition: {
    operations: ['instantiate independent systems', 'instantiate observers', 'bind any supported system to any observer', 'compare systems', 'sample a physical clock', 'change presentation without changing observables'],
    limits: { systems: 8, observers: 8, views: 16 },
    meaning: 'Systems in an array are independent experiments, never interacting bodies. Views reference existing system and observer IDs.'
  },
  authoring: {
    workflow: ['Read capabilities and scene.schema.json', 'Create or edit scene JSON', 'Validate it', 'Inspect errors and assumptions', 'Apply it to the local demo', 'Inspect measurements and rendered views'],
    transport: ['CLI JSON', 'same-machine HTTP JSON', 'browser scene import/export'],
    llmRequiredForPlayback: false,
    executableCodeInScene: false,
    mcpAdapterImplemented: false,
    endpoints: ['GET /api/capabilities', 'GET /api/schema', 'GET /api/scene', 'POST /api/validate', 'POST /api/evaluate', 'POST /api/sample', 'POST /api/scene']
  },
  validationLimits: 'Validation checks the supported contract and known physical constraints. It is not proof of general physical correctness or pedagogical quality.'
};

// Minimal validator for the exact JSON Schema subset above. No evaluation of code.
export function validateShape(value, schema = sceneSchema, path = '$', errors = []) {
  const error = (code, message) => errors.push({ path, code, message });
  if ('const' in schema && value !== schema.const) error('CONST', `Expected ${JSON.stringify(schema.const)}.`);
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) error('TYPE', 'Expected a finite number.');
    else if (value < schema.minimum || value > schema.maximum) error('RANGE', `Supported range is ${schema.minimum} to ${schema.maximum}.`);
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') error('TYPE', 'Expected a string.');
    else {
      if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) error('LENGTH', `String length must be ${schema.minLength ?? 0}–${schema.maxLength ?? 'unbounded'}.`);
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) error('PATTERN', 'Use a letter followed by letters, numbers, underscores or hyphens.');
    }
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) error('TYPE', 'Expected an array.');
    else {
      if (value.length < schema.minItems || value.length > schema.maxItems) error('COUNT', `Expected ${schema.minItems}–${schema.maxItems} items.`);
      // Do not spend unbounded time validating oversized input.
      value.slice(0, schema.maxItems).forEach((entry, i) => validateShape(entry, schema.items, `${path}[${i}]`, errors));
    }
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) error('TYPE', 'Expected an object.');
    else {
      for (const key of schema.required) if (!Object.hasOwn(value, key)) errors.push({ path: `${path}.${key}`, code: 'REQUIRED', message: 'Required field is missing.' });
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties, key)) errors.push({ path: `${path}.${key}`, code: 'UNSUPPORTED_FIELD', message: 'This field is not supported. Do not silently introduce new physics.' });
        else validateShape(value[key], schema.properties[key], `${path}.${key}`, errors);
      }
    }
  }
  return errors;
}
