import { copyData, freezeData, isRecord } from '../core/data.js';
import { DEFAULT_LIMITS } from '../dataflow/index.js';
import { prepareManifest, API_VERSION, matchesVersion } from './manifest.js';
import { SCHEMA_LIMITS } from './schema.js';
import { REGISTRY_LIMITS, SCIENTIFIC, keys, requireThat } from './contracts.js';
import { inspectRequirements } from './requirements.js';
import { bindRegistry } from './binding.js';
import { prepareCases, runCases } from './harness.js';

export { prepareManifest, resolvePorts, matchesVersion, API_VERSION, MANIFEST_VERSION } from './manifest.js';
export { validateSchema, validateData, applyDefaults, SCHEMA_LIMITS } from './schema.js';
export { REGISTRY_LIMITS } from './contracts.js';
export { validateSuppliedResult } from './results.js';

const diagnosticCodes = [
  'INVALID_MANIFEST', 'UNSUPPORTED_VERSION', 'INVALID_VERSION', 'INVALID_SCHEMA', 'PORT_TEMPLATE',
  'DUPLICATE_EXTENSION', 'DEPENDENCY_MISSING', 'DEPENDENCY_VERSION', 'CAPABILITY_MISSING',
  'EXTENSION_MISSING', 'EXTENSION_PIN_REQUIRED', 'EXTENSION_PIN', 'EXTENSION_KIND', 'VERSION_MISMATCH', 'IMPLEMENTATION_MISMATCH',
  'MISSING_INPUT', 'OUTPUT_PORT', 'INPUT_DECLARATION', 'DEPENDENCY_DECLARATION', 'ARTIFACT_MISMATCH', 'ARTIFACT_SCHEMA', 'ARTIFACT_BUDGET',
  'REFERENCE_MISMATCH', 'REFERENCE_METADATA', 'EXPECTED_ERROR', 'CONTRACT_CASES', 'ASYNC_IMPLEMENTATION', 'STALE_RESULT',
  'UNIT_MISMATCH', 'UNIT_CONVERSION_REQUIRED', 'FRAME_MISMATCH', 'NORMALIZATION_MISMATCH', 'TIME_MISMATCH', 'SAMPLE_ALIGNMENT',
  'RUNTIME_CONTRACT', 'RUNTIME_REQUIRED',
];

export class ExtensionRegistry {
  #records = new Map();
  #validators = new Map();
  #capabilities;
  #limits;
  #reports = new Map();
  #testing = new Set();

  constructor({ capabilities = [], limits = {} } = {}) {
    requireThat(Array.isArray(capabilities) && capabilities.every(item => typeof item === 'string' && item.trim()) && new Set(capabilities).size === capabilities.length,
      'CAPABILITIES', 'Host capabilities must be distinct nonempty names.');
    this.#capabilities = new Set(capabilities);
    this.#limits = { ...REGISTRY_LIMITS, ...copyData(limits) };
    keys(this.#limits, Object.keys(REGISTRY_LIMITS), 'registry limits');
    requireThat(Object.values(this.#limits).every(number => Number.isSafeInteger(number) && number > 0), 'REGISTRY_LIMITS', 'Registry limits must be positive safe integers.');
    Object.freeze(this.#limits);
  }

  // Trusted composition-root rules can constrain relationships across nodes.
  // A binding captures its current rule set just as it captures model records.
  registerValidator(id, validate) {
    requireThat(typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(id) && typeof validate === 'function',
      'REGISTRY_VALIDATOR', 'A graph validator requires a stable ID and a synchronous validation function.');
    requireThat(!this.#validators.has(id) && this.#validators.size < this.#limits.maxExtensions,
      'REGISTRY_VALIDATOR', 'Duplicate or excessive graph validator registration.');
    this.#validators.set(id, validate);
    return this;
  }

  register(extension) {
    keys(extension, ['manifest', 'implementation', 'referenceCases'], 'extension record');
    const manifest = prepareManifest(extension.manifest);
    requireThat(!this.#records.has(manifest.id), 'DUPLICATE_EXTENSION', `${manifest.id} is already registered; bind a separate registry to use another version.`);
    requireThat(this.#records.size < this.#limits.maxExtensions, 'REGISTRY_LIMITS', 'Registry extension limit exceeded.');
    for (const dependency of manifest.dependencies) {
      const installed = this.#records.get(dependency.id)?.manifest;
      requireThat(installed, 'DEPENDENCY_MISSING', `Register dependency ${dependency.id} before ${manifest.id}.`);
      requireThat(matchesVersion(installed.version, dependency.version) && (dependency.build === undefined || dependency.build === installed.implementation.build),
        'DEPENDENCY_VERSION', `${manifest.id} requires ${dependency.id}@${dependency.version}${dependency.build ? ` build ${dependency.build}` : ''}.`);
    }
    for (const capability of manifest.capabilities) requireThat(this.#capabilities.has(capability), 'CAPABILITY_MISSING', `${manifest.id} requires host capability ${capability}.`);
    const implementation = extension.implementation;
    keys(implementation, ['evaluate', 'create', 'validate', 'guards', 'stateful'], 'trusted implementation');
    const scientific = SCIENTIFIC.has(manifest.kind);
    if (scientific) {
      const analytic = manifest.runtime.paths.includes('analytic');
      const stateful = manifest.runtime.paths.includes('stateful');
      requireThat(implementation.create === undefined && (analytic ? typeof implementation.evaluate === 'function' : implementation.evaluate === undefined),
        'EXTENSION_CONTRACT', 'Scientific evaluate is required exactly for the analytic path; create is not allowed.');
      requireThat(stateful ? isRecord(implementation.stateful) : implementation.stateful === undefined,
        'RUNTIME_CONTRACT', 'Stateful callbacks are required exactly for the stateful path.');
      if (stateful) {
        const lifecycle = ['initialize', 'advance', 'extract', 'checkpoint', 'restore'];
        keys(implementation.stateful, lifecycle, 'stateful implementation');
        requireThat(lifecycle.every(name => typeof implementation.stateful[name] === 'function'), 'RUNTIME_CONTRACT', 'Stateful implementations require initialize, advance, extract, checkpoint and restore functions.');
        requireThat(lifecycle.every(name => !['AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction'].includes(implementation.stateful[name].constructor?.name)),
          'ASYNC_IMPLEMENTATION', 'Stateful lifecycle callbacks must be synchronous functions.');
      }
    } else {
      requireThat(typeof implementation.create === 'function' && implementation.evaluate === undefined && implementation.stateful === undefined,
        'EXTENSION_CONTRACT', `${manifest.kind} requires only its create callback.`);
    }
    requireThat(implementation.validate === undefined || typeof implementation.validate === 'function', 'EXTENSION_CONTRACT', 'validate must be a trusted function.');
    const guards = implementation.guards ?? {};
    const declaredGuards = manifest.science?.applicability.map(guard => guard.id) ?? [];
    requireThat(isRecord(guards) && Object.keys(guards).length === declaredGuards.length && declaredGuards.every(id => Object.hasOwn(guards, id) && typeof guards[id] === 'function'),
      'APPLICABILITY_GUARDS', 'Every declared applicability guard needs exactly one installed function.');
    const callbacks = Object.freeze({ ...implementation, guards: Object.freeze({ ...guards }),
      ...(implementation.stateful === undefined ? {} : { stateful: Object.freeze({ ...implementation.stateful }) }) });
    const referenceCases = freezeData(prepareCases(extension.referenceCases, this.#limits.maxCases));
    this.#records.set(manifest.id, Object.freeze({ manifest, implementation: callbacks, referenceCases }));
    return this;
  }

  discover({ kind } = {}) {
    if (kind !== undefined) requireThat(['model', 'operator', 'asset-factory', 'view-adapter'].includes(kind), 'EXTENSION_KIND', 'Unknown discovery kind.');
    const extensions = [...this.#records.values()].filter(record => kind === undefined || record.manifest.kind === kind).map(record => ({
      manifest: record.manifest,
      review: { declaredStatus: record.manifest.science?.review.status ?? 'not-applicable', independentlyVerified: false },
      referenceCases: record.referenceCases.map(item => ({ id: item.id, description: item.description, tolerance: item.tolerance, expectedError: item.expectedError ?? null })),
      contractTests: this.#reports.get(record.manifest.id) ?? null,
    }));
    return copyData({ apiVersion: API_VERSION, capabilities: [...this.#capabilities].sort(),
      limits: { registry: this.#limits, dataflow: DEFAULT_LIMITS, schema: SCHEMA_LIMITS },
      diagnostics: diagnosticCodes, extensions });
  }

  inspectRequirements(graph) { return inspectRequirements(graph, this.#records, this.#capabilities); }
  bind({ limits = {}, execute } = {}) {
    requireThat(execute === undefined || typeof execute === 'function', 'RUNTIME_CONTRACT', 'execute must be a trusted runtime function.');
    return bindRegistry(new Map(this.#records), new Set(this.#capabilities), this.#limits, limits, execute, [...this.#validators.values()]);
  }
  runContractTests(id) {
    const record = this.#records.get(id);
    requireThat(record, 'EXTENSION_MISSING', `No installed extension ${id}.`);
    requireThat(!this.#testing.has(id), 'CONTRACT_REENTRANT', 'This extension contract suite is already running.');
    this.#testing.add(id);
    try {
      const report = runCases(record, this.bind());
      this.#reports.set(id, freezeData(copyData(report)));
      return report;
    } finally { this.#testing.delete(id); }
  }
}

export function runContractTests(registry, id) { return registry.runContractTests(id); }
