# Extension registration

F03 registers trusted local models, operators, asset factories, and view adapters
over the existing [composition kernel](composition-kernel.md) and
[scientific dataflow](scientific-dataflow.md). A composition root selects installed
implementations. Learners instantiate those definitions through checked authoring
interfaces; project data does not select JavaScript modules or execute source.

F04 extends the same registry with analytic/stateful lifecycle declarations and a
trusted execution hook. See [the runtime guide](computation-runtime.md) for
`manifest.runtime`, numerical settings, worker setup and checkpoint semantics.
The F03 synchronous APIs and fixtures below remain supported.

Run the public example from the repository root:

```sh
node examples/extension-registry.mjs
```

Use `bash scripts/node.sh` instead of `node` if needed. The example registers four
independent fixtures, runs eight reference cases, creates and accepts their graph,
evaluates scientific values, produces geometry/view data, and checks that changing
marker scale leaves physical position unchanged. No renderer is invoked.

## Developer registration and learner authoring

Extension development is trusted code work: implement a definition, its manifest,
applicability guards, reference cases, and scientific documentation. The developer
or application composition root explicitly imports that local code and registers
it. A learner or learner's agent uses the installed definitions and ordinary
calculations; submitting a source string cannot register a new implementation.

```js
import { Project } from './src/core/index.js';
import { ExtensionRegistry } from './src/registry/index.js';
import { registryExtensions } from './examples/fixtures/registry-extensions.js';

const registry = new ExtensionRegistry({
  capabilities: ['dataflow.sync', 'assets.data', 'views.data'],
});
for (const extension of registryExtensions) registry.register(extension);

const binding = registry.bind();
const project = new Project({ validators: binding.validators });
const draft = project.begin();
const author = binding.author(draft);
const point = author.instantiate('fixture.moving-point', {
  id: 'point', parameters: { r0: [1, -2, 3], v: [2, -1, 0.5] },
});
draft.accept();
const result = binding.evaluate(project, point.id, {
  port: 'position', time: { value: 2, unit: 's' },
});
// result.value.data is [5, -4, 4], with F01 identity and F02 scientific context.
```

`registry.register({ manifest, implementation, referenceCases? })` validates a
record atomically and returns the registry. Register dependencies first. The
registry has no replacement, unregister, download, or hot-reload operation.
Each `bind()` captures an immutable snapshot of the current registrations and
capabilities. Registering another extension later does not change an existing
binding or the validation installed on its projects. Create a new binding
deliberately to adopt a changed set.

The host declares capability names; the registry checks that required names are
present. This is not automatic probing or proof of a renderer, GPU, account,
network service, or scientific algorithm. In the example, `assets.data` and
`views.data` mean deterministic data production.

## Manifest schema

Every manifest contains these fields:

```js
{
  schemaVersion: 1,
  apiVersion: 1,
  id: 'example.extension',
  version: '1.0.0',
  implementation: { id: 'example.implementation', version: '1.0.0', build: 'build-1' },
  kind: 'model', // or operator, asset-factory, view-adapter
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  ports: { inputs: {}, outputs: {} },
  dependencies: [{ id: 'example.dependency', version: '1.0.0', build: 'build-1' }],
  capabilities: ['dataflow.sync'],
  documentation: {
    summary: 'What this implementation does and its intended limits.',
    links: [{ title: 'Documentation', url: 'https://example.org/documentation' }],
    examples: [{ parameters: {} }],
  },
  diagnostics: [{ code: 'EXAMPLE_LIMIT', description: 'Explain the condition and remedy.' }],
  // Scientific definitions add science; visual definitions add artifact and optional assets.
}
```

Arrays/maps may be empty where appropriate, but their required fields must be
present. Documentation links require absolute HTTP(S) URLs. Example parameters
are checked against the schema after defaults are applied. Extension IDs use
F01 identifier characters and a namespace separator (`.`, `:`, or `-`) with no
empty namespace segment; `dataflow.*` is reserved.

Manifest/API versions must be 1. Extension, implementation, and dependency
versions use exact `N.N.N` strings. Version ranges, prereleases, and compatibility
inference are not supported. An implementation build is a nonempty producer-
supplied identity string, not a verified code hash or signature.

Scientific `model` and `operator` manifests require:

```js
science: {
  equations: ['r(t) = r0 + v t'],
  references: [{ title: 'Equation or algorithm reference', locator: 'Source locator or definition' }],
  assumptions: ['Constant velocity in a fixed Cartesian frame.'],
  applicability: [{ id: 'bounded-speed', description: 'State the supported range.' }],
  evaluation: { mode: 'analytic', sampling: ['instant'] },
  review: {
    status: 'experimental', // or reviewed
    notes: 'Explain the declaration and its evidence.',
    evidence: [], // {title, locator, reviewer?, date?: 'YYYY-MM-DD'}
  },
}
```

Equations, references, assumptions, and sampling descriptions must be nonempty.
The original synchronous modes are `analytic` and `stateless`; F04 adds
`stateful` and `hybrid` with explicit `runtime` declarations. Sampling declarations
are `instant` and `stored-series`. Every declared applicability guard requires
exactly one matching installed function. A `reviewed` declaration requires
nonempty evidence records, but the registry does not independently verify those
claims. Scientific extensions require output ports and do not declare visual
artifacts or asset inputs.

Visual `asset-factory` and `view-adapter` manifests require:

```js
artifact: {
  kind: 'geometry',
  format: 'point-cloud',
  schema: {
    type: 'object', properties: { /* declared artifact data */ },
    required: [], additionalProperties: false,
  },
  provenance: { source: 'Describe the source', license: 'BSD-3-Clause' },
},
assets: { geometry: { kind: 'geometry', format: 'point-cloud' } },
```

Asset factories produce `geometry`, `material`, or `data`; view adapters produce
`view`. Their scientific `ports.outputs` map must be empty. Their input ports may
consume checked scientific Values, while `assets` declares named artifact inputs
by kind and format. `assets` defaults to an empty map. Artifact data has a required
object schema. Provenance is recorded declared source/license metadata; it does
not verify third-party rights automatically.

## Parameter schemas, defaults, and port templates

The bounded schema subset supports:

- Types: `object`, `array`, `number`, `integer`, `string`, `boolean`, and `null`.
- Every type: optional `description` and a validated `default`.
- Scalar types: optional `enum` choices of the declared type.
- Objects: `properties`, optional `required`, and mandatory
  `additionalProperties: false`.
- Arrays: `items`, optional `minItems` and `maxItems`.
- Numbers/integers: optional inclusive `minimum` and `maximum`; integers must be
  safe integers.

`$ref`, regex patterns, unions, open property maps, executable validators in data,
and general JSON Schema are not supported. Root parameter and artifact schemas
must be objects. `applyDefaults(schema, input)` returns detached data with declared
defaults filled; it does not silently repair a wrong value. `instantiate` uses it
before storing parameters. Later raw updates and acceptance validate the stored
parameters rather than automatically rewriting them with defaults.

Ports use the existing seven-field F02 descriptor and optional sampling context:

```js
{
  kind: 'vector', shape: [3], unit: { $param: 'unit' }, meaning: 'position',
  reference: { $node: 'id' },
  frame: { id: { $param: 'frame' }, kind: 'position' },
  normalization: null,
}
```

`{ $param: 'name' }` substitutes a declared top-level parameter.
`{ $node: 'id' }` substitutes the current node ID. Each binding object must contain
exactly its one directive. Nested parameter paths, expressions, source snippets,
and other `$` directives are rejected. A value may be substituted into a descriptor
field, but its resolved form must still satisfy the full F02 contract.

Registration checks the static/template structure; actual parameter values and
resolved ports are checked again during project validation. Unit, shape, frame,
normalization, meaning, reference, and specified sampling requirements remain
authoritative. A template never authorizes a unit conversion or frame change by
relabeling data. Public helpers include `prepareManifest`, `resolvePorts`,
`validateSchema`, `validateData`, `applyDefaults`, and `matchesVersion`.

## Trusted implementations

The `implementation` record is separate from the serializable manifest:

```js
{
  evaluate({ node, inputs, request }) { return { position: scientificValue }; },
  validate(node) { return []; }, // optional
  guards: { 'bounded-speed': node => [] },
}
```

Scientific definitions require `evaluate` and cannot also provide `create`.
Visual definitions require `create({ node, inputs, assets, request })`, returning
only the artifact's data object, and cannot also provide `evaluate`. Optional
validation and guard functions synchronously return arrays of
`{ code, path, message }` diagnostics. Undeclared or missing guard functions reject
registration. Models/operators return named F02 Values matching their ports.

`node.data.parameters` contains accepted parameters. `inputs` maps scientific
slots to evaluated Values. Visual `assets` slots contain complete artifacts
`{ kind, format, data, provenance }`; a view can read `assets.geometry.data`.
`request.time` uses the existing normalized physical-time contract, defaulting to
0 seconds. Inputs are detached and deeply frozen. Output data is copied and
validated. Asynchronous callbacks fail with `ASYNC_IMPLEMENTATION`.

These are trusted functions in the caller's process, not sandboxed third-party
code. They must be pure, respect declared limits, and propagate relevant scientific
warnings/approximations. A project string resembling code remains data; no normal
project load, input command, or contract-case record can turn it into a callback.

## Instantiate, edit, evaluate, and produce

`binding.author(draft)` retains F02 arithmetic/constant/selection methods and adds:

```js
author.instantiate(extensionId, {
  id: 'instance-id',
  parameters: {},
  inputs: { position: { node: pointHandle, port: 'position' } },
  assets: { geometry: geometryHandle },
});
```

All options are optional when the chosen definition permits them. Scientific
inputs accept an ID, compatible F01 handle, or `{ node, port }`; bare IDs/handles
select the `value` port. Asset inputs accept IDs or compatible handles. Returned
handles are actual F01 handles, with its ownership, staging, atomic edits,
deletion, undo/redo, and generation semantics.

| Extension kind | F01 node kind | Output route |
| --- | --- | --- |
| `model` | `component` | `binding.evaluate(project, id, { port?, time? })` |
| `operator` | `calculation` | `binding.evaluate(project, id, { port?, time? })` |
| `asset-factory` | `presentation` | `binding.produce(project, id, { time? })` |
| `view-adapter` | `presentation` | `binding.produce(project, id, { time? })` |

Registered instances store:

```js
node.data = {
  parameters: { /* materialized defaults and authored values */ },
  inputs: { position: { port: 'position' } },
  extension: {
    id: 'fixture.point-view', version: '1.0.0',
    implementation: {
      id: 'fixture.point-view.implementation', version: '1.0.0', build: 'fixture-build-1',
    },
  },
};
node.references = { 'input.position': 'point', 'asset.geometry': 'geometry' };
node.dependsOn = ['point', 'geometry'];
```

Validation requires pins to match the installed extension, implementation ID,
implementation version, and build. Dependencies and references must agree with
declared input slots. Unknown extensions, version/build mismatches, incompatible
ports, missing asset slots, and incorrect artifact kinds/formats reject acceptance.
Edits use F01 handles or operations; full-field replacement rules still apply.
Preserve `extension` and input declarations when replacing `data`.

Install `binding.validators` on every registry-managed Project, including
`Project.from(savedGraph, { validators: binding.validators })`. This gives raw
transactions, handle edits, load, and undo/redo the same registry checks.
`binding.inspect(graph)` reports complete acceptance diagnostics. Evaluation and
artifact production independently inspect the graph again.

Built-in `dataflow.*` calculations remain available without extension pins and
cannot impersonate a registered extension by adding one. Ordinary unpinned
relationship nodes also remain valid, including reference cycles. Other
components, calculations, and presentation definitions require an installed,
pinned extension. Use `instantiate` for registered definitions; the lower-level
F02 `component` factory does not add a registry pin for you.

`binding.flow` exposes the underlying F02 scientific facilities. Use
`binding.evaluate` and `binding.produce`, with the binding's validators installed,
for the complete registry and visual checks.

Scientific evaluation returns the F02 envelope, retaining implementation/build
identity. Artifact production returns:

```js
{
  identity: { projectId, generation, revision },
  producer: { nodeId, implementation: { id, version, build } },
  valid: true,
  artifact: {
    kind: 'view', format: 'point-view', data: {},
    provenance: { source, license },
  },
  diagnostics: [],
}
```

Artifact schemas are checked on actual outputs, not just declarations. Required
scientific inputs are evaluated at the requested physical time and checked against
their ports. Referenced artifacts are produced recursively with per-call reuse.
Scientific warnings are retained in artifact diagnostics. Failure returns a null
artifact and diagnostics. Results cannot succeed after project identity changes;
stale completed outputs report `STALE_RESULT`, while other failures may report
their own diagnostic first. Consumers must also reject old results after a later
revision or load.

The fixture `point-view` returns position, units, frame, geometry, and marker scale
as declarative data. It does not create a browser scene or validate an apparent
brightness, physical size, or radiative-transfer interpretation.

## Dependencies, missing modules, and binding changes

`dependencies` require an already registered extension with exactly the declared
extension version, plus the implementation build when specified. A missing
dependency, unsupported manifest/API version, duplicate extension ID, or missing
capability rejects registration before a project is accepted. Multiple versions
of one extension require separate registries; no range resolution occurs.

Inspect saved requirements before attempting acceptance:

```js
const report = registry.inspectRequirements(savedGraph);
// or binding.requirements(savedGraph) for the binding's fixed environment
```

The result is `{ valid, requirements, errors }`. Requirement records contain
`id`, `version`, `implementation`, `nodeIds`, `dependencyOf`, and `available`.
Unavailable pins remain visible with useful errors; they do not yield empty valid
scientific results. Inspection is read-only and works without the missing module.
Transitive requirements can be expanded from installed manifests; an absent
manifest's unrecorded dependencies cannot be invented. Requirement inspection is
not a substitute for full graph acceptance.

A fresh binding does not update existing Project validation automatically. Create
or reopen with its validators and deliberately migrate graph pins/parameters when
needed. The registry does not implement automatic migrations or restore serialized
mutation authority; F01 load generations remain fresh.

## Discovery, review declarations, and contract evidence

`registry.discover({ kind? })` returns:

```js
{
  apiVersion: 1,
  capabilities: [],
  limits: { registry, dataflow, schema },
  diagnostics: ['INVALID_MANIFEST', /* supported diagnostic codes */],
  extensions: [{
    manifest,
    review: { declaredStatus: 'experimental', independentlyVerified: false },
    referenceCases: [{ id, description, tolerance, expectedError }],
    contractTests: null, // latest locally executed report after a run
  }],
}
```

`kind` filters one of the four extension kinds. Discovery is detached data and
contains no implementation functions. Visual definitions report review status
`not-applicable`. Scientific `experimental`/`reviewed` status is the author's
declaration; `independentlyVerified` remains false. Evidence records are retained
for inspection, not treated as verified reviewer identity or automatic approval.

Run supplied cases with `registry.runContractTests(id)` or the exported
`runContractTests(registry, id)`. Reports identify the implementation and provide
`passed`, `total`, `failed`, per-case results, and `scientificCertification: false`.
Running tests stores observed results in discovery but never changes declared
review status. A suite with no cases does not pass. Passing software cases does
not establish astronomical validity or educational effectiveness.

## Reference cases and tolerances

Reference cases are data attached to a trusted registration record:

```js
{
  id: 'signed-length',
  description: 'Preserve sign while multiplying by a scale factor.',
  parameters: { factor: 2.5 },
  inputs: { source: value({ kind: 'scalar', data: -3, unit: 'm', meaning: 'length' }) },
  assets: {},
  request: { time: { value: 0, unit: 's' } },
  expected: {
    outputs: { value: value({ kind: 'scalar', data: -7.5, unit: 'm', meaning: 'length' }) },
  },
  tolerance: { absolute: 1e-12, relative: 1e-12 },
}
```

Omitted parameter/input/asset maps default to empty objects. A case either expects
scientific `outputs`, expects `artifact` data, or supplies one `expectedError` code.
Artifact expectations compare the data object, not the envelope. A case can request
an installed asset through
`assets: { geometry: { extension: 'fixture.point-geometry', parameters: { size: 1 } } }`.

Each case constructs a fresh F01 Project through the real registry binding and
accepts it before evaluating/producing. Its extension node ID is `subject`; input
and asset nodes use internal index-generated IDs. Case labels are independent of
project/node identifiers, so descriptive punctuation does not create a setup
failure. Expected Values must use `subject` where their reference is the producing
node. There are no case-specific executable test strings.

Numeric data/artifact values pass when
`abs(actual - expected) <= absolute + relative * abs(expected)`.
Tolerances must be finite and nonnegative and default to zero. Scientific
comparison also checks the complete expected F02 context, including units,
meaning, reference, frames, normalization, coordinates, and time. Expected warning
records and approximation strings are required subsets; additional actual
diagnostics may remain. Artifact object fields and array shapes must match.

An expected-error case passes when its code occurs among observed errors; the
report retains those errors. This exercises applicability failures without
weakening accepted project validation. Expected outcomes supplied by an extension
author remain assertions to review; executing them does not independently prove
their scientific premise.

## Limits and next interfaces

Registry defaults are 64 extensions, 64 reference cases per extension, and 10,000
artifact entries/string characters per production call. Constructor `limits`
accepts positive safe-integer overrides. `registry.bind({ limits })` configures
F02 dataflow limits for that binding. Schema defaults separately bound schemas
to depth 24/1,024 nodes and validated data to depth 64/100,000 nodes. Discovery
reports registry/schema limits and F02 defaults; a binding's effective F02 limits
are available at `binding.flow.limits`.

These are data/work bounds, not a sandbox, process-memory guarantee, or preemptive
wall-clock limit for trusted callbacks. There is no package downloader, remote
registry, credential integration, provider-specific agent adapter, or renderer
here. F04 adds worker scheduling and stateful checkpoints in a separate runtime
layer; direct registry calls remain synchronous.

F04 consumes the pinned contracts, effective dataflow dependencies, and full
identity triples for scheduling, cancellation, stateful execution, and checkpoints.
F05 must turn declared geometry/material/data/view artifacts into actual scene
bindings and navigation while retaining scientific units, provenance, and display
distinctions. Current artifact production alone does not implement those features.

See the [F03 handoff](handoffs/F03.md) for executed checks and downstream details.
