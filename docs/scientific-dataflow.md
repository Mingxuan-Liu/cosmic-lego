# Scientific values and dataflow

F02 adds serializable scientific calculations and synchronous evaluation over the
[F01 project graph](composition-kernel.md). Generic moving-point and field fixtures
exercise these interfaces without importing astronomy. This is not a renderer,
an extension marketplace, a stateful simulation scheduler, or the migrated
exoplanet application.

F03 now layers [trusted extension registration](extension-registry.md) over these
contracts. Its immutable bindings add manifest discovery, exact saved pins and
parameter/guard validation. The lower-level injection interface described here
remains useful for direct software tests.

Run the checked public example from the repository root:

```sh
node examples/scientific-dataflow.mjs
```

Use `bash scripts/node.sh` in place of `node` when Node is absent from PATH. The
example compares equivalent meter/kilometer trajectories, transforms a frame,
selects fields, and computes fixed/live collection means. It checks that a camera
edit leaves the science unchanged and that signed samples, coordinates, and
warnings survive a JSON graph round trip.

## Start at the composition root

```js
import { Project } from './src/core/index.js';
import { createDataflow } from './src/dataflow/index.js';
import { fixtureModels } from './examples/fixtures/dataflow-models.js';

const flow = createDataflow({ models: fixtureModels });
const project = new Project({ id: 'point-study', validators: flow.validators });
const draft = project.begin();
const author = flow.author(draft);
const point = author.component('fixture.moving-point', {
  id: 'point',
  parameters: {
    position: [0, 0, 0], velocity: [3, 4, 0],
    positionUnit: 'm', velocityUnit: 'm/s', frame: 'lab',
  },
});
const speeds = author.map('magnitude', { node: point, port: 'velocity' }, { id: 'speed' });
draft.accept();
const result = flow.evaluate(project, speeds.id, { time: { value: 2, unit: 's' } });
// result.valid === true; result.value.data === 5; result.value.unit.symbol === 'm/s'
```

`flow.author(draft)` returns a facade over the actual F01 draft. It does not own
another graph, identity, mutation token, or edit history. Returned objects are
ordinary F01 handles, with the same stable IDs, staging, atomic acceptance,
read-only accepted handles, undo/redo, and load-generation rules. Author loops and
helper functions execute in the author's process.

`createDataflow({ models = {}, adapters = {}, limits = {} })` installs trusted local
implementations supplied by the composition root. Neither graph strings nor
learner commands import modules or execute source. Its public methods are:

| Interface | Result |
| --- | --- |
| `flow.validators` | F01 structural hooks; pass them when creating or reopening a project. |
| `flow.author(draft)` | Authoring facade described below. |
| `flow.inspect(graphData)` | `{ valid, errors }` for core and scientific graph contracts. |
| `flow.describe(graphData)` | `{ valid, errors, outputs }`, with resolved F02 output descriptors by node ID; added for F03 visual-port checking. |
| `flow.dependencies(graphData, nodeId)` | Sorted direct effective computational dependency IDs, including current live members. |
| `flow.evaluate(project, nodeId, { port?, time? })` | Identity-tagged result envelope from accepted state. |
| `flow.limits` | The configured size/work/depth limits. |

The default output port is `value`. Moving-point fixtures expose `position` and
`velocity`, so name the port when evaluating them directly. Evaluation accepts an
F01 `Project` instance, not a detached draft or raw graph.

Scientific acceptance checks apply to every F01 editing route when that Project
was constructed with `flow.validators`. A plain F01 Project has only its installed
hooks; it does not acquire scientific validation merely because dataflow nodes
are present. `flow.evaluate` independently rechecks the scientific graph before
executing it, including a project initially created without these hooks.

## Value schema

Import `value`, `validateValue`, `descriptorOf`, and `unit` from
`src/dataflow/index.js`. `value(spec)` constructs a normalized, detached value;
`validateValue(spec)` returns `{ valid, errors }`. For example:

```js
const signal = value({
  kind: 'series',
  data: [0, -2, 4],
  unit: 'm',
  meaning: 'signed-fixture-signal',
  reference: 'sample-source',
  coordinates: { kind: 'time', unit: 's', values: [0, 1, 3] },
  metadata: {
    warnings: [{ code: 'FIXTURE_SAMPLES', path: '$', message: 'Declared fixture samples.' }],
    approximation: [],
  },
});
```

The normalized schema is:

```js
{
  kind: 'scalar' | 'vector' | 'collection' | 'field' | 'series',
  shape: [],              // scalar: []; vector: [3]; containers: [N] or [N, 3]
  data: 1,                // matching scalar/array; null represents a missing scalar
  unit: { symbol: 'm', dimensions: { length: 1 }, scale: 1 },
  meaning: 'quantity-meaning',
  reference: null,         // semantic reference ID, or an explicit lack of one
  frame: null,             // or { id: 'lab', kind: 'position' | 'direction' | 'display' }
  normalization: null,     // or { reference: 'baseline-id', definition: 'stated ratio' }
  coordinates: null,       // time/space coordinates for series/fields
  objectIds: null,         // collections: one distinct source object ID per row
  time: null,              // or { value: 2, unit: normalizedTimeUnit }
  metadata: { warnings: [], approximation: [] },
}
```

`value` infers shape when omitted and supplies null context and empty metadata
defaults. Quantity meaning and units must be supplied. When metadata is supplied,
include both arrays; warnings are `{ code, path, message }` diagnostics and
approximations are descriptive strings. A vector has three components. A vector
container with wholly missing rows should declare `[N, 3]` and represent each such
row as `[null, null, null]`.

Collections require `objectIds` of length `N`; other kinds do not carry this
field. Series require strictly increasing finite time coordinates:

```js
{ kind: 'time', unit: 's', values: [0, 1, 3] }
```

Fields require finite spatial positions with a named position frame:

```js
{
  kind: 'space', unit: 'm', frame: { id: 'lab', kind: 'position' },
  values: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
}
```

Coordinate count must match data rows. Field coordinates and field-vector values
carry separate frame conventions: sample locations are positions; a velocity
field's values are directions. `reference` and normalization identifiers describe
semantic context and may name external sources or author-defined comparisons.
Actual graph input nodes also appear in explicit F01 references and dependencies;
they are not hidden only in these value fields.

Non-finite numbers, functions, getters, class instances, and other non-JSON data
are rejected. Missing samples use `null`; they are never silently replaced with
zero. Direct values and field selection can retain missing samples. Arithmetic,
interpolation across missing samples, and reductions produce diagnostics when
they cannot compute a defined result. Signed values remain signed unless an
author explicitly requests `abs` or `magnitude`.

## Units, frames, normalization, and time

`unit(symbol)` normalizes these built-in symbols:
`1`, `m`, `km`, `cm`, `s`, `min`, `h`, `kg`, `K`, `m/s`, `km/s`, and `m/s^2`.
An explicit descriptor can define a derived unit using `length`, `time`, `mass`,
and `temperature` exponents and a positive SI scale. Exponents must be integers
between −12 and 12. Known symbols cannot be redefined inconsistently. Offset
conversions and a general unit parser are not implemented.

`convertValue(input, targetUnit)` converts data through the unit scales and
preserves semantic context, coordinates, time, missing entries, and metadata.
`sameDimensions(a, b)` tests dimensions only. Equal dimensions alone do not
authorize a scientific connection: meaning, reference, frame, normalization, and
declared sampling context also matter.

`transformValue(input, { from, to, rotation, translation?, unit? })` applies a
checked 3×3 proper orthonormal rotation and optional length translation. Positions
rotate and translate; directions rotate. A standalone direction rejects a supplied
translation. Spatial-field coordinates can translate while directional field
values only rotate. Display coordinates cannot be promoted to physical coordinates.
This is a bounded Cartesian transform, not an astronomical coordinate library.

Affine arithmetic retains the distinction: position minus position produces a
direction/displacement; position plus or minus a direction produces a position.
Position plus position and direction minus position are rejected. Frame IDs must
still agree, and meaning/reference differences may still need a comparison.

Normalization records its reference and definition. Matching dimensions or
generic arithmetic does not silently change a normalization. An installed,
explicit adapter must justify any conversion of semantic context.

Always supply the intended physical time when evaluating moving models:
`{ time: { value: 2, unit: 's' } }`. If omitted, evaluation uses **0 seconds**.
F02 evaluates analytically at that request; it
does not advance an integrator or derive physical time from camera animation or
display frame rate. Values can carry a physical instant independently of sampled
series coordinates. Arithmetic requires compatible physical instants, with a
timeless scalar allowed for scaling. Static values retain null physical time,
including collections of timeless values. Any non-null returned physical instant
must match the evaluation request; time-series sample coordinates remain an
independent declaration.

## Ports and injected implementations

A port descriptor declares all seven fields `kind`, `shape`, `unit`, `meaning`,
`reference`, `frame`, and `normalization`. Explicit null context differs from
omitting a required declaration. It may additionally require `coordinates`,
`time`, and `objectIds`. Container descriptors may use `null` as a variable length,
such as `[null, 3]`; evaluated values always have concrete shapes.

`descriptorOf(value)` produces its full descriptor. `checkPort(source, requirement)`
returns diagnostic errors. Different unit scales require an adapter at model/input
connections. An omitted optional requirement imposes no equality constraint on
that context; a present requirement is checked. Structural acceptance checks
declared output/input contracts, and evaluation checks actual returned values
against the same contracts.

Trusted models are supplied in a map keyed by component type:

```js
{
  'my.model': {
    implementation: { id: 'my.implementation', version: '1' },
    outputs(node) { return { value: outputDescriptor }; },
    inputs(node) { return { source: requiredDescriptor }; }, // optional
    validate(node) { return []; },                           // optional diagnostics
    evaluate({ node, inputs, request }) { return { value: resultValue }; },
  },
}
```

Parameters live at `node.data.parameters`; evaluated named inputs arrive as
Values. Output keys must exactly match declared port names. Adapter records use:

```js
{
  implementation: { id: 'my.adapter', version: '1' },
  input: requiredDescriptor,
  output: outputDescriptor,
  apply(inputValue) { return transformedValue; },
}
```

All implementation functions run synchronously on detached, frozen input data.
Promises fail with `ASYNC_IMPLEMENTATION`. These functions are trusted code, not
sandboxed plugins. Implementations must preserve relevant input warnings and
approximation context when they produce a new value. The sample unit and frame
adapters use shared helpers that retain metadata.

The `dataflow.*` namespace is reserved for built-in calculations. Unknown
calculation implementations reject acceptance. Unregistered generic components
and presentation definitions can remain inert graph content; they cannot become
computed results without an implementation. F03's [registry](extension-registry.md)
adds manifests, discovery and availability/version rules. Registry-backed projects
reject unavailable extension instances; [F04](computation-runtime.md) now supplies
lifecycle scheduling over these same contracts.

## Authoring calculations

Inputs accept a same-project handle, an ID string, or `{ node: handleOrId,
port: 'position' }`. Bare handles and IDs select the `value` port. Factory methods
accept `{ id? }` unless listed otherwise:

| Author method | Definition |
| --- | --- |
| `constant(value, { id? })` | Stores a validated Value. |
| `component(type, { id?, parameters?, inputs? })` | Instantiates a trusted injected model; `inputs` maps slots to references. |
| `select({ mode: 'fixed', members, element? }, { id? })` | Selects an explicit ordered list of source objects/ports. |
| `select({ mode: 'live', type, port, element? }, { id? })` | Selects current nodes of an exact type and their named port. |
| `field(source, indices, { id? })` | Selects distinct, in-range spatial-field rows and corresponding coordinates in the requested order. |
| `arithmetic(op, left, right, { id?, comparison?, alignment? })` | `add`, `subtract`, `multiply`, or `divide`. |
| `map(op, source, { id? })` | `magnitude` for vectors/vector containers; `abs` for scalar-valued data. |
| `reduce(op, source, { id? })` | `sum` or `mean` over scalar per-object collections. |
| `adapt(adapterId, source, { id? })` | Applies an explicitly installed adapter. |
| `update(handleOrId, patch)` | Updates the existing F01 node; returns its draft handle. |
| `remove(handleOrId, options)` | Uses F01 referenced-removal/cascade behavior. |

Handle `.set(patch)` and F01 transactions remain available. Updates replace
supplied `data`, `references`, and `dependsOn` fields in full. To change parameters,
retain the input declarations:

```js
const draft = project.begin();
const point = draft.get('point');
point.set({ data: {
  ...point.value.data,
  parameters: { ...point.value.data.parameters, velocity: [6, 8, 0] },
} });
draft.accept();
```

Definitions retain their input port names in `data.inputs`, targets in
`references['input.<slot>']`, and distinct target IDs in `dependsOn`. Validation
requires these declarations to agree. Rewiring with raw updates must update all
three together in one transaction. The author factories build those declarations
automatically. A staged incomplete definition can be repaired before acceptance;
acceptance remains authoritative.

Addition/subtraction preserve units through compatible conversion; multiplication
and division derive dimensional exponents. Scalar scaling is supported. Generic
vector products are rejected rather than choosing an undocumented dot, cross, or
elementwise operation. Division by zero and non-finite results produce errors.

An explicit comparison permits mathematical combinations of differing meanings or
references:

```js
author.arithmetic('subtract', leftPosition, rightPosition, {
  comparison: { meaning: 'displacement', reference: 'left-vs-right' },
});
```

It emits `UNVALIDATED_COMPARISON` and does not certify a physical observable.
Comparison declarations do not bypass units, frames, normalization, time, or
sampling checks. A scalar with no frame or normalization can scale a contextual
quantity; differing non-null references still require a comparison.
Neutral scalar multiplication preserves the contextual quantity's normalization
in either order, as does a normalized numerator divided by an unnormalized scalar.
Products of two normalized quantities and any normalized denominator require an
explicit adapter defining the output normalization. A comparison declaration
cannot bypass this restriction.

## Collections and effective dependencies

Selections collect scalar or vector outputs. An omitted `element` contract is
inferred from the first available member and saved with the definition; an
initially empty selection requires an explicit element descriptor. Collection
units are fixed by this contract. Compatible member unit scales convert to it;
meaning, frame, and normalization must match.

Fixed membership stores input references and stays fixed when other nodes are
added. Referenced removal of a fixed member follows F01 rejection/cascade rules.
Live membership is reevaluated from the accepted graph on every inspection and
evaluation. Adding or removing a matching object changes that membership without
rewriting the query or inventing a new scientific model.

`flow.dependencies(project.snapshot(), selectionId)` reports the current direct
effective inputs, including live members. F01 `project.dependencies()` continues
to report authored edges only. Live edges participate in cycle detection and
evaluation ordering; they do not become persistent ownership references for
cascading removal. A query can therefore become empty after deleting a member.
An empty selection is valid; reducing it reports `EMPTY_COLLECTION`.

Collection Values preserve source identities in `objectIds`. Inferred element
contracts use a null collection-level reference; an explicitly supplied non-null
element reference must match every member and is retained in the result.
Grouping differing source references with a null collection reference produces
`COLLECTION_REFERENCES`; it does not assert one common physical reference.
Arithmetic aligns collections by object ID, never accidental row order.
Reductions require scalar collections with no missing entries; the shared
implementation uses compensated summation.

## Sampling and alignment

Default arithmetic requires matching physical sample coordinates, including
compatible units and floating-point comparison tolerance. Equal array lengths
alone do not establish alignment. Spatial fields require matching coordinates;
there is no field interpolation or spatial-index alignment facility.

For time series, the supported explicit resampling policy is:

```js
author.arithmetic('subtract', leftSeries, rightSeries, {
  alignment: { policy: 'linear', target: 'left' },
});
```

This linearly interpolates the right-hand series onto left-hand coordinates.
It does not extrapolate beyond the right-hand sample range, and it rejects
interpolation across missing samples. The output retains left coordinates and
adds `INTERPOLATED` metadata. There is no implicit reevaluation, adaptive-index
pairing, zero-filling, or higher-order interpolation.

Built-in operations propagate warnings and approximation strings. Data-driven
diagnostics such as zero division or an unavailable interpolation interval may
arise only during evaluation; accepted graph structure is not a promise that
every requested numerical result exists.

## Results, diagnostics, and limits

Evaluation returns:

```js
{
  identity: { projectId, generation, revision },
  producer: { nodeId, port, implementation: { id, version } },
  request: { time: { value, unit } },
  value: normalizedValue, // null on failure
  valid: true,
  diagnostics: [],       // warnings can coexist with valid: true
  metadata: {
    approximation: [],
    sampling: { policy: 'declared-coordinates', coordinates, time },
    implementations: [{ id, version }],
    work: 0,
  },
}
```

The producer implementation can be null when unavailable. Errors return
`valid: false` and a null value with diagnostic codes, paths, and messages.
Values' warnings appear in result diagnostics with warning severity. Sampling
policy becomes `linear-right-to-left` when interpolation contributed to the result.
The implementation list identifies implementations used during evaluation;
approximation descriptions and sample coordinates accompany the result.

Evaluation captures all three F01 identity fields. If trusted code changes the
project during evaluation, the result is rejected with `STALE_RESULT`. Consumers
must also compare all three fields before displaying or reusing an older result,
especially after load or undo. No shared global cache or asynchronous job manager
is implemented here.

Default limits are `maxNodes: 256`, `maxValues: 10000`, `maxWork: 100000`, and
`maxDepth: 128`. `createDataflow({ limits })` accepts positive safe-integer overrides.
Numeric/missing entries in data and coordinates count toward value limits; work
charges nodes and numeric/missing entries consumed and produced, including repeated
reads of cached inputs by reductions. These checks
bound supported graph workloads, but do not preempt arbitrary loops inside trusted
extension code or impose a wall-clock timeout.

Useful diagnostics include `MISSING_INPUT`, `OUTPUT_PORT`, `IMPLEMENTATION_MISSING`,
`ADAPTER_MISSING`, `UNIT_MISMATCH`, `UNIT_CONVERSION_REQUIRED`, `FRAME_MISMATCH`,
`NORMALIZATION_MISMATCH`, `COMPARISON_REQUIRED`, `TIME_MISMATCH`, `SAMPLE_ALIGNMENT`,
`MISSING_DATA`, `DIVISION_BY_ZERO`, `EMPTY_COLLECTION`, `DEPENDENCY_CYCLE`, and the
graph/value/work/depth budget codes. Graph acceptance errors retain F01's
`VALIDATION_FAILED` wrapper and diagnostic array; data helpers throw structured
`KernelError`s. Inspect result validity before using its data.

F03 supplies [registry manifests and discovery/version contracts](extension-registry.md).
F04 supplies [analytic/stateful lifecycle management](computation-runtime.md),
cancellation, checkpoints, and scheduling around these identity-tagged calculations.
F02 itself remains the synchronous evaluator. Renderer bindings, UI integration, portable
packaging, authored timelines, and astronomical validity remain separate work.

See the [F02 handoff](handoffs/F02.md) for executed checks and downstream details.
