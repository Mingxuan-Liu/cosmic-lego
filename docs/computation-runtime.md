# Computation runtime

F04 runs registered analytic and stateful scientific components in interruptible
Node workers. It reuses F01 projects/identity, F02 Values/dataflow, and F03 manifests
and implementations. Extensions own equations, integration steps, settings, and
random procedures; the runtime schedules them and checks the resulting contracts.

Run the public software-fixture example from the repository root:

```sh
node examples/computation-runtime.mjs
```

Use `bash scripts/node.sh` instead of `node` when Node is absent from PATH. The
example checks analytic positions, deterministic stepping and resume, seeded
repeatability, backward replay, off-lattice sampling, dependent arithmetic, and
compatible checkpoint reuse after reopening with a new load generation. This
runtime does not render a scene or implement an astrophysical solver.

## Submit and observe a job

```js
import { createRuntime } from './src/runtime/index.js';
import { buildExample } from './examples/computation-runtime.mjs';

const { project } = buildExample();
const runtime = createRuntime({
  registryModule: new URL('./examples/fixtures/runtime-extensions.js', import.meta.url),
});
try {
  const job = runtime.submit(project, 'accumulator', {
    port: 'value',
    time: { value: 2, unit: 's' },
    mode: 'stateful',
    settings: { accumulator: { step: 0.25, tolerance: 1e-12 } },
  });
  // Poll job.status / job.progress from a UI timer, or call job.cancel().
  const result = await job.promise;
  if (!result.valid) console.error(result.diagnostics);
  else console.log(result.value.data, result.metadata.runtime.achievedTime);
} finally {
  await runtime.dispose();
}
```

`createRuntime({ registryModule, limits? })` is synchronous. The trusted
composition-root URL must be a local `file:` URL without query/fragment. Its module
must export a synchronous `createRegistry()` returning the shared
`ExtensionRegistry`. The worker imports that explicitly configured host; project
data, manifests, job requests, and checkpoints cannot supply a module path or
source callback. The same registry factory should construct the author's binding
and the worker's binding so saved implementation pins agree.

| Interface | Behavior |
| --- | --- |
| `runtime.submit(project, nodeId, options?)` | Captures an accepted F01 snapshot and starts/queues the latest requested computation. |
| `job.id` | Runtime-local job identifier. |
| `job.promise` | Resolves to a scientific result or diagnostic failure envelope. |
| `job.status` | `queued`, `running`, `completed`, `failed`, or `cancelled`. |
| `job.progress` | Detached phase/counter data from the worker, then terminal status. |
| `job.cancel()` | Rejects publication from this job and requests worker termination. |
| `runtime.setProject(project)` | Selects a project and invalidates work/cache when selection or accepted identity changes. |
| `runtime.dispose()` | Cancels active work, clears cache, and asynchronously waits for worker termination. |
| `runtime.limits` | Frozen configured runtime limits. |

Submission options are exactly `port`, `time`, `mode`, `settings`, and
`checkpoints`. Defaults are port `value`, time 0 seconds, mode `auto`, and an empty
settings map. Settings are keyed by component ID and filled/checked against each
component's manifest schema. Known overrides outside the requested dependency
closure are ignored; unknown component IDs reject. A malformed submission may
throw before a job is created. Reported computation/cancellation failures resolve
`job.promise` with `valid: false`, rather than pretending to return a numeric zero.

There is one active request per runtime. A newer submission supersedes the older
one with `SUPERSEDED`. A replacement waits for terminated workers to exit.
After a successful analytic job, the runtime retains one worker for the current
accepted project, generation and revision. It closes the worker after 30 idle
seconds, a project change, cancellation, failure, a completed stateful job or
disposal. Each stateful job uses its own lifecycle state and checkpoint rules.

The worker prepares the graph's checked scientific ports and dependency order
once per revision. Its analytic cache keys whole model output maps by the
transitive input identity, numerical settings and the actual sample time and
unit. An explicitly scheduled analytic series has its own physical clock. It
can be reused at another display time, with fresh job identity, request and
achieved-time metadata. Stored series and model snapshots share the entry and
byte limits below. Short-lived model outputs are evicted before scheduled
series. The visual compiler also reuses validation for an accepted revision and
indexes supplied snapshots once per frame. It checks their identity, producer,
port contract and time on consumption.

Run `bash scripts/node.sh scripts/benchmark-workspace.mjs` to measure the
exoplanet preset's complete scientific source list and workspace compilation at
0, 60, 120 and 180 seconds. The first frame includes worker startup. Each frame
reports its total, per-source timings and a SHA-256 digest of the returned
scientific Values. Browser rendering, gateway serialization and network latency
are measured separately.

Progress includes phases such as `validating`, `advancing`, and `extracting`,
aggregate `steps` and `work`, a component ID, requested time, and the last reported
physical time. Values may be absent before validation or on early failure. The
phase changes to the final job status on settlement. Progress is advisory and
throttled; it is not an integration result or percentage-complete guarantee.

## Analytic and stateful contracts

Scientific manifests can now declare `science.evaluation.mode` as `analytic`,
`stateless`, `stateful`, or `hybrid`. They add runtime metadata:

```js
runtime: {
  paths: ['analytic', 'stateful'],
  settings: {
    type: 'object',
    properties: { step: { type: 'number', minimum: 0.001, default: 0.25 } },
    required: ['step'], additionalProperties: false,
  },
  stateful: {
    initialTime: { value: 0, unit: 's' },
    sampling: 'exact', // or at-or-before
    random: { algorithm: null }, // or a declared algorithm identity
  },
}
```

`paths` must match the scientific mode: analytic/stateless → analytic only,
stateful → stateful only, hybrid → both. Older analytic/stateless manifests without
`runtime` normalize to an analytic path and an empty settings schema. Stateful
metadata is required exactly when the stateful path is present. Visual manifests
do not declare scientific lifecycle metadata.

An analytic path requires the existing `evaluate({ node, inputs, request,
settings }) -> { port: Value }`. A stateful path requires all five synchronous
functions under `implementation.stateful`:

```js
initialize({ node, inputs, settings, request })
  // -> { state, random, time }

advance({ node, inputs, settings, state, random, time, targetTime })
  // -> { state, random, time, done: boolean }

extract({ node, inputs, settings, state, random, time, request })
  // -> { port: Value }

checkpoint({ node, inputs, settings, state, random, time, request })
  // -> plain data payload

restore({ node, settings, checkpoint })
  // -> { state, random, time }
```

Inputs are detached/frozen and outputs cross the shared finite-data boundary.
`state` is model-owned data. `random` is explicitly null for deterministic models,
or `{ algorithm: declaredId, state: generatorData }`. The generator payload must
retain all information needed for resume, not only an initial seed. Promise-based
callbacks fail; stateful async/generator functions are also rejected at registration.

Initialization returns the declared initial time. Every unfinished advancement
must make forward physical-time progress. Steps cannot overshoot the requested
target beyond the shared floating-point time tolerance. An exact-sampling model
must reach its target; an `at-or-before` model may finish at its previous sample,
including returning unchanged time with `done: true` for an off-lattice request.
All extracted Values must identify the achieved state time and match their F02
output descriptors.

The model supplies a bounded step, numerical method, and settings semantics.
The scheduler does not assume a universal `step` or `tolerance` parameter and
does not adapt them to achieve a desired scientific answer. Lifecycle callbacks
execute inside the worker, so cancellation can terminate a long callback; ordinary
callbacks should still be small and bounded for useful progress and predictable
resource use.

`mode: 'auto'` prefers an analytic path when available and otherwise chooses
stateful. An explicit `analytic` or `stateful` mode controls the requested root
component only; dependencies select their own paths automatically. Unsupported
choices return `CAPABILITY_UNSUPPORTED`. Built-in arithmetic is analytic but can
depend on a stateful component; the resulting job reports a stateful path when
any component in its scientific dependency closure evolves state.

Direct F03 synchronous evaluation continues to serve analytic paths. A
stateful-only definition instead returns `RUNTIME_REQUIRED`; it is not secretly
advanced inside a synchronous UI call. Registry bindings expose trusted
`computations` records and an optional `execute` hook for the scheduler. Those
functions are developer/runtime interfaces, not serialized learner commands.

## Physical time and dependency snapshots

Physical times use the existing `{ value, unit }` contract and are normalized to
seconds by the runtime. Display frames, playback speed, and presentation cameras
do not choose integration steps. A player should request a physical time
explicitly; the example requests the same 2-second point at both 24 and 60 display
frames per second and gets the same coordinates.

Before each stateful advancement, scientific inputs are evaluated at that step's
starting time through the shared F02 evaluator. Initialization uses the model's
initial time. Extraction and final dependent arithmetic use the common achieved
time. A model with time-dependent coupling must state how it uses those supplied
samples within its numerical step; the runtime does not invent midpoint values or
solve an implicit coupled system.

Whole model output maps are cached by component and physical time across separate
port reads. Retained outputs provide one shared snapshot for those reads; bounded
cache eviction can require recomputation, so implementations must remain pure.

Effective F02 dependencies, including live selections, determine computation
order. Ordinary reference cycles remain legal; computational cycles still need
an explicit coupled-model facility and currently reject. All stateful dependencies
of a final result must reach compatible physical times. Different fixed grids
produce `SNAPSHOT_TIME_MISMATCH` when they cannot provide the required snapshot.
There is no automatic interpolation or search for a different common time.

For an `at-or-before` model, a request for 1.1 seconds on a 0.25-second grid can
return a valid 1-second result. The original request remains visible, the Value
has time 1 second, and the result adds `TIME_APPROXIMATION` with an
`at-or-before` sampling policy. It does not label the last sample as 1.1 seconds.
The complete dependent result is evaluated at that achieved time.

Warnings and approximation metadata from upstream reads are retained through
state advancement, extraction, dependent arithmetic, and checkpoint resume.
Metadata is deduplicated rather than silently discarded. Numerical errors remain
diagnostics with null failed results.

## State ownership, sequential access, and rewind

State lives only inside the disposable worker during a job. The Project graph
stores definitions and settings declarations, not a hidden mutable integrator.
Successful results expose serializable checkpoints and update a host-side cache.
The next job can restore compatible cached state and continue forward.

Automatic cache entries are keyed by component and kept only for the exact active
F01 identity triple. Successful results merge the latest checkpoint for each
component; unrelated analytic requests do not erase those entries. Old entries
are evicted when checkpoint count/byte limits are reached. Failures and cancellation
retain earlier valid cache entries. Any project selection, revision, or load-
generation change clears the automatic cache.

Within a job, compatible in-memory states and checkpoints at or before the target
can be used. A checkpoint later than a backward target causes reset from initial
conditions and forward replay. Numerical evolution and random draws are never
run backward to imitate rewind. Strategies such as `initialize`, `checkpoint`,
`memo`, and `reset-replay` are reported per stateful component. A request before
the model's initial time returns `TIME_RANGE`.

This is computation history, separate from F01 edit Undo/Redo and future authored
animation tracks. Undo changes accepted model definitions/revision; it does not
restore a worker's old mutation authority or reverse a dissipative numerical step.

## Checkpoint schema and explicit reuse

Successful jobs return `result.checkpoints`, with at most one final checkpoint per
stateful component in the requested closure:

```js
{
  schemaVersion: 1,
  identity: { projectId, generation, revision },
  nodeId: 'noise',
  implementation: { id, version, build },
  inputIdentity: 'sha256:...',
  settings: { step: 0.25, tolerance: 1e-12, seed: 12345 },
  time: { value: 1, unit: normalizedSeconds },
  random: { algorithm: 'lcg32', state: { value: 2726892157, draws: 4 } },
  metadata: { warnings: [], approximation: [] },
  payload: { /* extension-owned checkpoint data */ },
}
```

The runtime fingerprints the component definition, selected path, implementation,
settings, and recursive effective input identities. Changing a rate, parameter,
member selection, implementation/build, or relevant numerical setting prevents
reuse. The payload remains the extension's responsibility; its restore callback
must validate and interpret it. Restored physical time and random state must match
the wrapper's declared metadata. A seed alone cannot resume the stochastic fixture.

Explicit resume uses:

```js
const result = await runtime.submit(project, 'noise', {
  time: { value: 2, unit: 's' },
  settings: { noise: { step: 0.25, tolerance: 1e-12, seed: 12345 } },
  checkpoints: priorResult.checkpoints,
}).promise;
```

Explicit checkpoints must name distinct stateful components in the requested job
closure. Incompatible explicit input returns `CHECKPOINT_INCOMPATIBLE` or a schema
diagnostic; an incompatible automatic cache entry is simply a cache miss.
Checkpoints from future times remain compatible data but trigger reset/replay
when no earlier state is available.

Explicit reuse can adopt a checkpoint from an older revision or load generation
when the authored project ID, implementation, input fingerprint, and settings
still match. The supplied checkpoint retains its original identity; returned
results and newly produced checkpoints receive the current full identity. This permits a compatible reopen
without reviving stale commands. It is distinct from automatic cache reuse, which
always requires the exact current identity triple.

These hashes describe declared computation inputs, not authenticated checkpoint
contents or a code signature. External data identities must be represented in
the graph if they affect computation. Pure trusted implementations and meaningful
restore checks remain necessary. The JSON-compatible payload is accessible to
F09, but no checkpoint archive, migration, compression, or final persistence format
is implemented here.

## Result envelope

Runtime results retain the F02 envelope and add checkpoints and runtime metadata:

```js
{
  identity: { projectId, generation, revision },
  producer: { nodeId, port, implementation },
  request: { time: originallyRequestedTime },
  valid: true,
  value: normalizedScientificValue,
  diagnostics: [],
  checkpoints: [],
  metadata: {
    approximation: [], sampling: {}, implementations: [], work: 0,
    runtime: {
      jobId: 'job-1', elapsedMs: 0,
      requestedTime: normalizedRequestedTime,
      achievedTime: normalizedAchievedTime,
      path: 'analytic', // or stateful
      steps: 0, work: 0,
      inputIdentity: 'sha256:...',
      settings: {},
      components: [{
        nodeId, implementation, inputIdentity, settings,
        requestedTime, time, random, sampling, strategy,
      }],
    },
  },
}
```

`components` describes the stateful components used; it can be empty for an
analytic-only job. `metadata.runtime.work` covers scheduler callbacks and shared
evaluation work, while the base F02 metadata describes its result evaluation.
Early failures may have only partial runtime metadata. Failure returns
`valid: false`, null Value, visible diagnostics, and no new checkpoints. Successful
results are detached/frozen.

The host checks project identity during work and before publication. Edits, Undo,
load changes, and switching selected projects make in-flight results stale. A
result from a former identity cannot succeed after that change. Consumers must
also compare its full identity before reusing a previously completed result;
computing successfully once does not make it permanently current.

## Cancellation and resource limits

Cancellation settles the job with `CANCELLED`, prevents late publication, and
calls Node's asynchronous worker termination. A replacement request waits for
termination before starting another worker. `await runtime.dispose()` waits for
tracked termination to finish. Accepted project content is never changed by
computation or cancellation.

Node documents worker termination as stopping JavaScript as soon as possible,
with a Promise resolving on worker exit. Its V8 resource limits do not cover
external buffers or prevent every process-wide out-of-memory condition. These
facts were checked on **2026-11-03** against the official documentation served as
Node **24.22.2**; this checkout was tested using bundled Node **24.22.1**.
([Node worker-thread documentation](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html))

The boundary keeps CPU-heavy worker JavaScript off the caller's event loop and
permits terminating it rather than waiting for cooperative cancellation inside a
loop. It is not an operating-system sandbox or a hard real-time deadline.
Trusted modules can still perform side effects, and cancelling does not undo
those effects. Synchronous submission copying/serialization and ordinary authoring
validation outside the runtime are not made cancellable by this worker boundary.

Defaults, exported as `RUNTIME_LIMITS`, are:

| Limit | Default | What is bounded |
| --- | ---: | --- |
| `maxSteps` | 10,000 | Total advancement calls in a job. |
| `maxWork` | 1,000,000 | Charged lifecycle callbacks and F02 evaluation work. |
| `maxStateBytes` | 1,000,000 | A lifecycle snapshot and aggregate memoized state bytes. |
| `maxCheckpointBytes` | 2,000,000 | Submitted request/checkpoints, produced checkpoints, and automatic checkpoint-cache capacity. |
| `maxSnapshots` | 128 | State/imported-checkpoint counts and bounded cache capacities. |
| `maxWallMs` | 5,000 | Host deadline including queue wait and worker startup. |
| `maxGraphBytes` | 2,000,000 | Serialized accepted graph sent to the worker. |
| `maxResultBytes` | 4,000,000 | Each scientific read/output cache and the returned result. |
| `workerMemoryMb` | 64 | Worker V8 old-generation heap setting. |
| `progressIntervalMs` | 25 | Worker progress throttle; host identity checks run at most 25 ms apart while its event loop is available. |

Overrides must be positive safe integers. Byte bounds refer to serialized finite
data, not exact JavaScript heap use. Scientific reads use bounded eviction rather
than restricting an evolution to the number of cache slots. Excess lifecycle
state count/aggregate bytes still fails. F02 graph/value/depth/work contracts and
registry/schema checks remain active in addition to these limits.

Useful errors include `RUNTIME_HOST`, `CAPABILITY_UNSUPPORTED`, `RUNTIME_SETTINGS`,
`TIME_RANGE`, `STATE_SCHEMA`, `STATE_PROGRESS`, `STATE_TIME`, `RANDOM_STATE`,
`SNAPSHOT_TIME_MISMATCH`, `CHECKPOINT_INCOMPATIBLE`, `STEP_BUDGET`, `WORK_BUDGET`,
`STATE_BUDGET`, `SNAPSHOT_BUDGET`, `CHECKPOINT_BUDGET`, `RESULT_BUDGET`,
`TIME_BUDGET`, `MEMORY_BUDGET`, `CANCELLED`, `SUPERSEDED`, and `STALE_RESULT`.

## Software fixtures and remaining scope

`examples/fixtures/runtime-extensions.js` registers the earlier analytic fixtures
plus two stateful definitions. The hybrid accumulator has a timeless rate input,
can evaluate directly, and can take bounded exact final steps. The seeded fixture
uses LCG32 state and draw count, one uniform increment per fixed step, and an
explicit `at-or-before` policy. Its tolerance setting checks restored lattice
phase; it is not a universal solver accuracy guarantee.

The public example checks the deterministic value 6 at 2 seconds across direct,
fresh stepping, sequential, and checkpoint-resumed paths. For seed 12345 and
0.25-second steps, eight draws give state 2355140353 and accumulated value
−0.7182601829990745. Those are repeatability checks, not a physical noise model.
Local example measurements include worker startup and are not frame-rate or
throughput promises; the F04 handoff records test measurements and responsiveness
observations separately.

The runtime is Node-only. It has no browser worker adapter, renderer, GPU or
distributed scheduler, global adaptive solver, state interpolation, worker pool,
agent connection, or authored timeline. F05 consumes scientific snapshots and
provenance. F07 and F08 cancel and invalidate jobs on edits and revoked turns.
F09 persists inputs, settings, extension pins and physical time, then replays
from initial conditions in a new runtime. Future presentation and export should
request physical times explicitly. See the [portable project guide](portable-projects.md).

See the [F04 handoff](handoffs/F04.md) for executed checks and downstream details.
