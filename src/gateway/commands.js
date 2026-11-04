// One declaration/dispatch catalogue for generic authoring. Trusted manifests
// supply parameter contracts; scientific semantics remain in F01–F06.
import { KernelError } from '../core/index.js';
import { copyData, freezeData, isRecord } from '../core/data.js';
import { value } from '../dataflow/index.js';
import { applyDefaults } from '../registry/index.js';

export const COMMAND_LIMITS = Object.freeze({ maxArgumentBytes: 1000000, maxArgumentNodes: 100000, maxArgumentDepth: 64 });
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const text = { type: 'string' };
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' };
const reference = { anyOf: [id, object({ node: id, port: { ...id, default: 'value' } }, ['node'])] };
const jsonObject = description => ({ type: 'object', additionalProperties: true, description });
const scientificValue = { ...jsonObject('Scientific Value data, validated and normalized by the existing F02 value() contract.'), 'x-semanticValidator': 'F02.value' };
const scientificDescriptor = { ...jsonObject('Scientific port descriptor, validated by the existing F02 descriptor contract.'), 'x-semanticValidator': 'F02.descriptor' };
const resultSchema = object({ id, ids: { type: 'array', items: id }, value: {} });
const diagnostic = (code, path, message) => ({ code, path, message });
const fail = (code, message, path = '$', details = {}) => { throw new KernelError(code, message, { path, ...details }); };
const insist = (condition, code, message, path) => { if (!condition) fail(code, message, path); };

function boundedInput(input) {
  let count = 0, characters = 0;
  const active = new Set();
  function scan(item, depth) {
    insist(++count <= COMMAND_LIMITS.maxArgumentNodes && depth <= COMMAND_LIMITS.maxArgumentDepth, 'COMMAND_BUDGET', 'Command arguments exceed their data depth/work limit.');
    if (typeof item === 'string') characters += item.length;
    insist(characters <= COMMAND_LIMITS.maxArgumentBytes, 'COMMAND_BUDGET', 'Command arguments exceed their byte limit.');
    if (item === null || typeof item !== 'object') return;
    insist(!active.has(item), 'INVALID_DATA', 'Command data cannot contain JavaScript cycles.'); active.add(item);
    if (Array.isArray(item)) insist(item.length <= COMMAND_LIMITS.maxArgumentNodes, 'COMMAND_BUDGET', 'Command array exceeds its work limit.');
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const field = Object.getOwnPropertyDescriptor(item, key);
      insist(typeof key === 'string' && field.enumerable && Object.hasOwn(field, 'value'), 'INVALID_DATA', 'Commands require enumerable data properties, without getters.');
      characters += key.length; scan(field.value, depth + 1);
    }
    active.delete(item);
  }
  scan(input, 0);
  const data = copyData(input);
  insist(new TextEncoder().encode(JSON.stringify(data)).length <= COMMAND_LIMITS.maxArgumentBytes, 'COMMAND_BUDGET', 'Command arguments exceed their byte limit.');
  return data;
}

// This checker implements the JSON Schema keywords used by the catalogue. It
// checks data structure only; it never duplicates scientific port/value rules.
function errorsFor(schema, input, path = '$') {
  const errors = [];
  const visit = (rule, item, at) => {
    if (rule.anyOf) {
      if (!rule.anyOf.some(choice => errorsFor(choice, item, at).length === 0)) errors.push(diagnostic('COMMAND_ARGUMENT', at, 'Value does not match a declared argument alternative.'));
      return;
    }
    if (rule.type) {
      const matches = { object: isRecord(item), array: Array.isArray(item), string: typeof item === 'string',
        number: Number.isFinite(item), integer: Number.isSafeInteger(item), boolean: typeof item === 'boolean', null: item === null };
      if (!matches[rule.type]) { errors.push(diagnostic('COMMAND_ARGUMENT', at, `Expected ${rule.type}.`)); return; }
    }
    if (rule.enum && !rule.enum.some(value => value === item)) errors.push(diagnostic('COMMAND_ARGUMENT', at, 'Choose a declared enum value.'));
    if (rule.pattern && !new RegExp(rule.pattern).test(item)) errors.push(diagnostic('COMMAND_ARGUMENT', at, 'Use a stable ID with 1–128 letters, digits, dots, underscores, colons or hyphens.'));
    if (rule.type === 'object') {
      for (const key of rule.required ?? []) if (!Object.hasOwn(item, key)) errors.push(diagnostic('COMMAND_ARGUMENT', `${at}.${key}`, 'Required property is missing.'));
      for (const [key, child] of Object.entries(item)) {
        if (Object.hasOwn(rule.properties ?? {}, key)) visit(rule.properties[key], child, `${at}.${key}`);
        else if (rule.additionalProperties === false) errors.push(diagnostic('COMMAND_ARGUMENT', `${at}.${key}`, 'Unsupported property.'));
        else if (isRecord(rule.additionalProperties)) visit(rule.additionalProperties, child, `${at}.${key}`);
      }
    } else if (rule.type === 'array') {
      if (item.length < (rule.minItems ?? 0) || item.length > (rule.maxItems ?? Infinity)) errors.push(diagnostic('COMMAND_ARGUMENT', at, 'Array length is outside the declared bounds.'));
      item.forEach((child, index) => visit(rule.items ?? {}, child, `${at}[${index}]`));
    } else if (['number', 'integer'].includes(rule.type)) {
      if (item < (rule.minimum ?? -Infinity) || item > (rule.maximum ?? Infinity)) errors.push(diagnostic('COMMAND_ARGUMENT', at, 'Number is outside the declared bounds.'));
    }
  };
  visit(schema, input, path);
  return errors;
}
function defaults(schema, input) {
  if (schema.anyOf) {
    for (const branch of schema.anyOf) {
      const candidate = defaults(branch, copyData(input));
      if (!errorsFor(branch, candidate).length) return candidate;
    }
    return input;
  }
  if (schema.type === 'object' && isRecord(input)) {
    for (const [key, rule] of Object.entries(schema.properties ?? {})) {
      if (!Object.hasOwn(input, key) && Object.hasOwn(rule, 'default')) Object.defineProperty(input, key, { value: copyData(rule.default), enumerable: true, writable: true, configurable: true });
      if (Object.hasOwn(input, key)) input[key] = defaults(rule, input[key]);
    }
  } else if (schema.type === 'array' && Array.isArray(input)) input.forEach((child, index) => { input[index] = defaults(schema.items ?? {}, child); });
  return input;
}
function withoutDefaults(schema) {
  const output = copyData(schema);
  function clean(rule) {
    delete rule.default;
    for (const child of Object.values(rule.properties ?? {})) clean(child);
    if (rule.items) clean(rule.items);
    for (const child of rule.anyOf ?? []) clean(child);
  }
  clean(output); return output;
}
const partial = schema => ({ ...withoutDefaults(schema), required: [] });
const slots = (names, rule, required = true) => object(Object.fromEntries(names.map(name => [name, copyData(rule)])), required ? names : []);
const asResult = handle => ({ id: handle.id, ids: [handle.id] });
const creationOptions = args => args.id === undefined ? {} : { id: args.id };
const refParts = input => typeof input === 'string' ? { node: input, port: 'value' } : input;

export function createCommandCatalog({ registry, binding, layer } = {}) {
  insist(registry?.discover && binding?.author && binding?.flow, 'CATALOG_CONFIG', 'Supply the trusted registry and its immutable binding.');
  const registryData = registry.discover();
  const manifests = new Map([...binding.computations, ...binding.visuals].map(record => [record.manifest.id, record.manifest]));
  const commands = new Map();
  const add = (name, inputSchema, execute, metadata = {}, normalize) => {
    insist(!commands.has(name), 'CATALOG_CONFIG', `Duplicate command ${name}.`);
    const declaration = freezeData(copyData({ name, description: name, inputSchema, outputSchema: resultSchema,
      defaults: defaults(inputSchema, {}), examples: [], capabilities: [], diagnostics: ['COMMAND_ARGUMENT', 'UNKNOWN_ID', 'INVALID_PROJECT'],
      limits: COMMAND_LIMITS, ...metadata }));
    commands.set(name, { declaration, execute, normalize });
  };
  const check = (schema, input, path = '$.args') => {
    const errors = errorsFor(schema, input, path);
    if (errors.length) fail('COMMAND_ARGUMENT', errors[0].message, errors[0].path, { validation: { valid: false, errors } });
  };
  const registeredUpdate = (draft, manifest, args) => {
    const handle = draft.get(args.id), node = handle.value;
    insist(node.type === manifest.id && node.data.extension?.id === manifest.id, 'COMMAND_TARGET', `Use an installed ${manifest.id} instance.`, '$.args.id');
    const inputs = Object.fromEntries(Object.entries(node.data.inputs).map(([slot, declaration]) => [slot, { node: node.references[`input.${slot}`], port: declaration.port }]));
    const assets = Object.fromEntries(Object.keys(manifest.assets ?? {}).map(slot => [slot, node.references[`asset.${slot}`]]));
    Object.assign(inputs, args.inputs ?? {}); Object.assign(assets, args.assets ?? {});
    const references = Object.create(null), declarations = Object.create(null);
    for (const [slot, input] of Object.entries(inputs)) {
      const source = refParts(input);
      references[`input.${slot}`] = draft.idOf(source.node); declarations[slot] = { port: source.port };
    }
    for (const [slot, target] of Object.entries(assets)) references[`asset.${slot}`] = draft.idOf(target);
    handle.set({ data: { ...node.data, parameters: { ...node.data.parameters, ...args.parameters }, inputs: declarations },
      references, dependsOn: [...new Set(Object.values(references))] });
    return asResult(handle);
  };
  for (const manifest of manifests.values()) {
    const inputSlots = Object.keys(manifest.ports.inputs), assetSlots = Object.keys(manifest.assets ?? {});
    const required = [...((manifest.parameters.required ?? []).some(key => !Object.hasOwn(manifest.parameters.properties[key], 'default')) ? ['parameters'] : []),
      ...(inputSlots.length ? ['inputs'] : []), ...(assetSlots.length ? ['assets'] : [])];
    const inputSchema = object({ id, parameters: copyData(manifest.parameters), inputs: slots(inputSlots, reference), assets: slots(assetSlots, id) }, required);
    const entry = registryData.extensions.find(item => item.manifest.id === manifest.id);
    const metadata = { description: manifest.documentation.summary, extension: { id: manifest.id, version: manifest.version, implementation: manifest.implementation, kind: manifest.kind },
      defaults: { parameters: applyDefaults(manifest.parameters, {}) }, examples: manifest.documentation.examples.map(example => ({ parameters: example.parameters })),
      capabilities: manifest.capabilities, diagnostics: [...registryData.diagnostics, ...manifest.diagnostics.map(item => item.code)],
      outputs: manifest.ports.outputs, ports: manifest.ports, assets: manifest.assets ?? {}, artifact: manifest.artifact ?? null,
      requirements: manifest.dependencies, review: entry?.review ?? null,
      limits: { ...COMMAND_LIMITS, registry: registryData.limits.registry, dataflow: binding.flow.limits, schema: registryData.limits.schema } };
    add(`create:${manifest.id}`, inputSchema, (draft, args) => asResult(binding.author(draft).instantiate(manifest.id, args)), metadata,
      args => {
        if (isRecord(args)) {
          args.parameters = applyDefaults(manifest.parameters, Object.hasOwn(args, 'parameters') ? args.parameters : {});
          if (!Object.hasOwn(args, 'inputs')) args.inputs = {};
          if (!Object.hasOwn(args, 'assets')) args.assets = {};
        }
        return args;
      });
    const updateSchema = object({ id, parameters: partial(manifest.parameters), inputs: slots(inputSlots, reference, false), assets: slots(assetSlots, id, false) }, ['id']);
    add(`update:${manifest.id}`, updateSchema, (draft, args) => registeredUpdate(draft, manifest, args), {
      ...metadata, description: `Shallow-merge ${manifest.id} parameters and supplied input/asset slots; preserve identity and implementation pin.`, defaults: {}, examples: [],
    });
  }

  add('dataflow.sample', object({ id, source: reference, times: { type: 'array', minItems: 1, maxItems: 256, items: { type: 'number' } },
    unit: { type: 'string' } }, ['source', 'times', 'unit']), (draft, args) =>
    asResult(binding.author(draft).sample(args.source, { times: args.times, unit: args.unit }, creationOptions(args))),
    { description: 'Sample an analytic scalar output at strictly increasing physical times into a scientific time series.' });
  add('dataflow.constant', object({ id, value: scientificValue }, ['value']), (draft, args) => asResult(binding.author(draft).constant(args.value, creationOptions(args))),
    { description: 'Create a finite scientific Value using F02 units, context and shape validation.', examples: [{ value: { kind: 'scalar', data: 1, unit: '1', meaning: 'example' } }] });
  add('dataflow.set-value', object({ id, value: scientificValue }, ['id', 'value']), (draft, args) => {
    const handle = draft.get(args.id), node = handle.value;
    insist(node.type === 'dataflow.constant', 'COMMAND_TARGET', 'Set a constant scientific Value.', '$.args.id');
    handle.set({ data: { value: value(args.value) } }); return asResult(handle);
  });
  const selection = { anyOf: [object({ mode: { type: 'string', enum: ['fixed'] }, members: { type: 'array', items: reference, maxItems: binding.flow.limits.maxNodes }, element: scientificDescriptor }, ['mode', 'members']),
    object({ mode: { type: 'string', enum: ['live'] }, type: id, port: id, element: scientificDescriptor }, ['mode', 'type', 'port'])] };
  add('dataflow.select', object({ id, spec: selection }, ['spec']), (draft, args) => asResult(binding.author(draft).select(args.spec, creationOptions(args))),
    { description: 'Create a fixed or live collection. Initially empty membership needs an explicit F02 element descriptor.' });
  add('dataflow.arithmetic', object({ id, op: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] }, left: reference, right: reference,
    comparison: object({ meaning: text, reference: text }, ['meaning', 'reference']), alignment: object({ policy: { type: 'string', enum: ['linear'] }, target: { type: 'string', enum: ['left'] } }, ['policy', 'target']) }, ['op', 'left', 'right']),
  (draft, args) => asResult(binding.author(draft).arithmetic(args.op, args.left, args.right, { ...creationOptions(args), ...(args.comparison ? { comparison: args.comparison } : {}), ...(args.alignment ? { alignment: args.alignment } : {}) })),
  { description: 'F02 arithmetic preserves semantic context; explicit comparison and sample alignment retain their existing checks.' });
  for (const [name, operations] of [['map', ['magnitude', 'abs']], ['reduce', ['sum', 'mean']]]) add(`dataflow.${name}`,
    object({ id, op: { type: 'string', enum: operations }, source: reference }, ['op', 'source']),
    (draft, args) => asResult(binding.author(draft)[name](args.op, args.source, creationOptions(args))));
  add('dataflow.field', object({ id, source: reference, indices: { type: 'array', items: { type: 'integer', minimum: 0 }, maxItems: binding.flow.limits.maxValues } }, ['source', 'indices']),
    (draft, args) => asResult(binding.author(draft).field(args.source, args.indices, creationOptions(args))));
  add('dataflow.adapt', object({ id, adapter: id, source: reference }, ['adapter', 'source']),
    (draft, args) => asResult(binding.author(draft).adapt(args.adapter, args.source, creationOptions(args))),
    { description: 'Apply an adapter already installed in the bound F02 flow. Registration is trusted host setup; unknown adapters fail validation.' });
  add('connect', object({ id, type: id, source: id, target: id, data: jsonObject('Inert relationship metadata.') }, ['type', 'source', 'target']),
    (draft, args) => asResult(draft.connect(args.type, args.source, args.target, { ...creationOptions(args), ...(args.data === undefined ? {} : { data: args.data }) })),
    { description: 'Create an inert F01 relationship. Scientific input rewiring uses registered update commands or explicit bindings.' });
  add('disconnect', object({ id }, ['id']), (draft, args) => { draft.disconnect(args.id); return { ids: [args.id] }; });
  add('remove', object({ id, cascade: { type: 'boolean', default: false } }, ['id']), (draft, args) => ({ ids: draft.remove(args.id, { cascade: args.cascade }) }));

  const scene = layer?.scene ?? layer;
  const sceneRecords = [...manifests.values()].filter(manifest => manifest.artifact?.format === 'cosmic.scene.node.v1');
  const sceneMappings = [...manifests.values()].filter(manifest => manifest.artifact?.format === 'cosmic.scene.binding.v1' && manifest.id.startsWith('scene.bind-'));
  if (scene?.author && sceneRecords.length) {
    if (sceneMappings.length) {
      const options = { anyOf: sceneMappings.map(manifest => {
        const fields = withoutDefaults(manifest.parameters).properties; delete fields.sourceId;
        return object({ id, property: { type: 'string', enum: [manifest.id.slice('scene.bind-'.length)] }, ...fields }, ['property']);
      }) };
      add('scene.bind', object({ target: id, source: id, options }, ['target', 'source', 'options']),
        (draft, args) => asResult(scene.author(draft).bind(args.target, args.source, args.options)),
        { description: 'Bind a scientific output to scene properties with explicit unit/frame/display mapping.', capabilities: [...new Set(sceneMappings.flatMap(item => item.capabilities))] });
    }
    add('scene.duplicate', object({ id, options: object({ id, parent: id }) }, ['id']), (draft, args) => asResult(scene.author(draft).duplicate(args.id, args.options ?? {})));
    add('scene.reparent', object({ id, parent: id }, ['id', 'parent']), (draft, args) => asResult(scene.author(draft).reparent(args.id, args.parent)));
    const sceneParameters = [...manifests.values()].filter(manifest => /^cosmic\.(scene\.node|geometry|material|texture)\.v1$/.test(manifest.artifact?.format ?? ''));
    add('scene.update', object({ id, parameters: { anyOf: sceneParameters.map(manifest => partial(manifest.parameters)) } }, ['id', 'parameters']), (draft, args) => {
      const manifest = manifests.get(draft.get(args.id).value.type);
      insist(sceneParameters.includes(manifest), 'COMMAND_TARGET', 'Update an installed scene instance or asset.');
      check(partial(manifest.parameters), args.parameters, '$.args.parameters'); return registeredUpdate(draft, manifest, args);
    });
  }
  const overlays = [...manifests.values()].filter(manifest => manifest.artifact?.format === 'cosmic.workspace.overlay.v1');
  if (layer?.scene && overlays.length) {
    const optionsFor = manifest => object({ id, ...withoutDefaults(manifest.parameters).properties });
    const plot = overlays.find(manifest => manifest.artifact.schema.properties.kind.enum?.[0] === 'plot');
    const plotOptions = object({ id, port: { ...id, default: 'value' }, ...(plot ? { component: withoutDefaults(plot.parameters.properties.component) } : {}) });
    add('overlay.create', { anyOf: overlays.map(manifest => {
      const kind = manifest.artifact.schema.properties.kind.enum[0];
      return object({ kind: { type: 'string', enum: [kind] }, options: optionsFor(manifest), ...(kind === 'plot' ? { source: id, binding: plotOptions } : {}) }, ['kind']);
    }) }, (draft, args) => {
      insist(args.source !== undefined || args.binding === undefined, 'COMMAND_ARGUMENT', 'Binding options require a source.', '$.args.binding');
      const author = layer.author(draft), handle = author.create(args.kind, args.options ?? {});
      if (args.source !== undefined) author.bind(handle, args.source, args.binding ?? {});
      return asResult(handle);
    }, { description: 'Create an installed overlay; optionally bind a plot in the same transaction.' });
    if (plot) add('overlay.bind', object({ target: id, source: id, options: plotOptions }, ['target', 'source']),
      (draft, args) => asResult(layer.author(draft).bind(args.target, args.source, args.options ?? {})));
    add('overlay.duplicate', object({ id, options: { anyOf: overlays.map(optionsFor) } }, ['id']), (draft, args) => {
      const manifest = manifests.get(draft.get(args.id).value.type);
      insist(overlays.includes(manifest), 'COMMAND_TARGET', 'Duplicate an installed overlay.');
      check(optionsFor(manifest), args.options ?? {}, '$.args.options');
      return asResult(layer.author(draft).duplicate(args.id, args.options ?? {}));
    });
    add('overlay.update', object({ id, parameters: { anyOf: overlays.map(manifest => partial(manifest.parameters)) } }, ['id', 'parameters']), (draft, args) => {
      const manifest = manifests.get(draft.get(args.id).value.type);
      insist(overlays.includes(manifest), 'COMMAND_TARGET', 'Update an installed overlay.');
      check(partial(manifest.parameters), args.parameters, '$.args.parameters');
      return asResult(layer.author(draft).update(args.id, args.parameters));
    });
    add('overlay.remove', object({ id, cascade: { type: 'boolean', default: false } }, ['id']),
      (draft, args) => ({ ids: layer.author(draft).remove(args.id, { cascade: args.cascade }) }));
  }
  const discovery = freezeData(copyData({ apiVersion: 1, schemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    argumentSemantics: { defaults: 'Apply declared defaults before validation; update schemas intentionally omit defaults.',
      scientificValues: 'x-semanticValidator identifies existing F02 checks beyond the structural JSON Schema.',
      transactions: 'Operations stage one F01 draft. Acceptance performs current registry, dataflow, scene and workspace validation.' },
    commands: [...commands.values()].map(record => record.declaration),
    extensions: registryData.extensions.filter(entry => manifests.has(entry.manifest.id)),
    capabilities: registryData.capabilities, diagnostics: [...new Set(['COMMAND_UNKNOWN', 'COMMAND_ARGUMENT', 'COMMAND_TARGET', 'COMMAND_BUDGET', ...registryData.diagnostics])],
    limits: { ...COMMAND_LIMITS, dataflow: binding.flow.limits, registry: registryData.limits.registry, ...(layer ? { presentation: layer.limits } : {}) } }));
  return Object.freeze({
    discover: () => copyData(discovery),
    has: name => commands.has(name),
    apply(draft, input) {
      const request = boundedInput(input);
      check(object({ command: text, args: { type: 'object', additionalProperties: true, default: {} } }, ['command']), request, '$');
      const command = commands.get(request.command);
      insist(command, 'COMMAND_UNKNOWN', `Unknown command ${request.command}; inspect discovery for installed operations.`, '$.command');
      let args = request.args ?? {};
      if (command.normalize) args = command.normalize(args);
      args = defaults(command.declaration.inputSchema, args);
      check(command.declaration.inputSchema, args);
      const result = command.execute(draft, args);
      return copyData(result);
    },
  });
}
