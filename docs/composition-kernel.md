# Composition kernel authoring

The domain-independent graph in `src/core/index.js` handles identity, staged connections, validation, atomic edits, and Undo. Both the astronomy-free timing gate and the default exoplanet workspace use this graph. The composition root installs the scientific models and presentation layers required by each application. Existing v0.2 World graphs enter through an explicit importer. [Scientific dataflow](scientific-dataflow.md) · [Default astronomy application and imports](exoplanet-authoring.md)

Run the working public-interface example from the repository root:

```sh
node examples/composition-kernel.mjs
```

Use `bash scripts/node.sh` instead of `node` if Node is absent from PATH. Author
scripts execute in the author's process. Projects and operation batches contain
data; the kernel does not execute source strings, import named modules, or fetch
extensions.

## Construct and accept a draft

```js
import { Project } from './src/core/index.js';
import { fixtureValidators } from './examples/fixtures/composition-types.js';

const project = new Project({
  id: 'point-lesson',
  title: 'A labeled point',
  validators: fixtureValidators,
});
const draft = project.begin();
const point = draft.component('fixture.point', {
  id: 'origin', data: { position: [0, 0, 0] },
});
const label = draft.component('fixture.label', {
  id: 'caption', data: { text: 'Origin' },
});
draft.validate(); // valid: false; the label still needs an anchor
const anchor = draft.connect('fixture.anchor', label, point, { id: 'anchor' });
label.set({ references: { anchor: anchor.id } });
draft.accept(); // validates the complete graph, then commits atomically
```

The example's composition root imports its trusted validators and passes them to
`Project`; the kernel never imports the fixtures. Ordinary helper functions,
loops, and arrays can build any number of definitions. The executable example
creates three labeled points and closes a ring of typed relationships.

Drafts permit missing targets, relationships, or type-specific data while an
arrangement is being built. Local syntax is still checked: malformed node shapes,
invalid IDs, duplicate IDs, unsupported fields, and invalid data values reject the
individual operation without modifying the draft. `draft.validate()` reports
complete acceptance diagnostics without committing. A failed `accept()` leaves
accepted content, token, and history unchanged; the draft remains repairable.
If another edit or load has made its base token stale, begin a new draft and
intentionally reapply the desired changes instead.

## Project and node data

`createProject({ id?, title? })` returns an empty data object. `new Project(...)`
owns accepted state and edit history; `Project.from(data, { validators? })`
validates existing graph data in a fresh runtime.

```js
{
  schemaVersion: 1,
  id: 'point-lesson',
  title: 'A labeled point',
  nodes: [{
    id: 'origin',
    kind: 'component',
    type: 'fixture.point',
    data: { position: [0, 0, 0] },
    references: {},
    dependsOn: [],
  }],
}
```

All node IDs are unique across the project. Node kinds are `component`,
`relationship`, `calculation`, and `presentation`. Type identifiers are supplied
by authors/extensions; the kernel contains no domain vocabulary. IDs, types, and
reference-slot names use 1–128 characters from letters, digits, `_`, `.`, `:`, and
`-`, beginning with a letter or digit. Omitted IDs receive generated UUID-based
identifiers. `data`, `references`, and `dependsOn` default to `{}`, `{}`, and `[]`.

`data` stores finite JSON-compatible values in a plain object. Functions,
accessors, custom object instances, JavaScript object cycles, sparse arrays, and
non-finite numbers are rejected. Nested data is limited to 100 levels. An
executable-looking string remains inert data. Explicit graph cycles use IDs in
`references`; they are different from cyclic JavaScript objects.

`references` maps named slots to node IDs. A relationship is a node with its own
stable ID, type, data, and at least `references.source` and `references.target`.
Any node can refer to another node, including a relationship. Ordinary reference
cycles and endpoint arrangements with loops are valid.

`dependsOn` lists distinct node IDs that supply computational inputs. Its graph
must be acyclic; the kernel reports `DEPENDENCY_CYCLE` for a cycle and any nodes
blocked by it. Calculation and presentation nodes store definitions. The dataflow layer resolves scientific ports, the registered implementations supply equations, and the runtime schedules evaluation. The renderer consumes evaluated scene bindings.

## Public methods and handles

| Interface | Behavior |
| --- | --- |
| `project.snapshot()` | Returns a detached copy of accepted graph data. |
| `project.token` | Returns `{ projectId, generation, revision }`. |
| `project.history` | Reports `{ canUndo, canRedo }`. |
| `project.begin(token = project.token)` | Copies accepted state into a staged draft and captures its base token. |
| `project.get(id)` | Returns a stable, read-only handle into current accepted content. |
| `draft.create(node)` | Creates a node and returns its draft handle. |
| `draft.component(type, options)` | Creates a component; options are `id`, `data`, `references`, and `dependsOn`. |
| `draft.calculation(type, options)` / `draft.presentation(type, options)` | Create the corresponding definition kinds. |
| `draft.connect(type, source, target, { id?, data? })` | Creates a relationship; endpoints may be IDs or compatible handles. |
| `draft.get(id)` | Returns a writable handle into this draft. |
| `draft.idOf(handleOrId)` | Resolves a reference using the kernel's same-project/draft/generation checks; added for F02 composition helpers. |
| `draft.update(id, patch)` | Replaces supplied `data`, `references`, or `dependsOn` fields. |
| `draft.disconnect(id)` | Removes a relationship, subject to referenced-removal rules. |
| `draft.remove(id, { cascade = false })` | Removes the node, optionally its transitive dependents; returns removed IDs. |
| `draft.snapshot()` / `draft.validate()` | Return draft data or `{ valid, errors }`. |
| `draft.preview()` | Returns `{ project, validation, baseToken }` without committing. |
| `draft.accept()` / `project.accept(draft)` | Recheck the captured token and all validation before atomic acceptance. |

F07 adds an optional trusted host hook to `draft.accept({beforeCommit})`,
`project.accept(draft,{beforeCommit})`, and `project.undo/redo(token,{beforeCommit})`.
The callback receives a deeply frozen detached candidate after validators run,
inside the kernel's existing mutation guard, before changing content, history or
revision. It returns undefined to proceed or throws to reject atomically; async,
generator, Promise-returning, accessor-bearing and malformed guards reject.
This lets the gateway validate history targets and check turn authorization at
the final write boundary. It is executable host configuration, never project or
transport data. Existing calls without options retain their behavior.

Draft `update`, `disconnect`, `remove`, and `dependencies` also accept compatible
handles in place of IDs. A handle exposes `id`, a detached `value`, and
`dependencies(options)`. Draft handles additionally support `set(patch)`,
`connect(type, target, options)`, and `remove(options)`.

Updates replace entire supplied fields, without deep merging. To retain other
data fields explicitly, write `handle.set({ data: { ...handle.value.data,
position: [1, 2, 3] } })`. An empty `references` object clears all named references;
an empty `dependsOn` array clears computational inputs. IDs, kinds, and types
cannot be changed through an update.

Accepted handles remain read-only and follow their ID across edits and undo/redo.
They fail if that ID is absent and become stale after a load. Draft handles belong
to their originating draft; accepting it closes further draft mutations. They
continue to read that draft's content, rather than becoming live accepted handles.
Use `project.get(id)` or obtain a handle from a new draft for subsequent work.
Cross-project handles and handles from another draft are rejected; a handle from
the same accepted project may be used as an endpoint in its draft. Explicit
string IDs resolve within the destination graph.

## Atomic commands and previews

```js
const token = project.token;
const operations = [{
  op: 'update', id: 'origin',
  patch: { data: { position: [1, 0, 0] } },
}];
const preview = project.preview(operations, token);
if (preview.validation.valid) project.apply(operations, token);
```

`apply` and `preview` require a nonempty operation array and an explicit token.
They use the same operation and acceptance rules as drafts.

| Operation | Fields |
| --- | --- |
| `create` | `node: { id?, kind?, type, data?, references?, dependsOn? }` |
| `update` | `id`, `patch: { data?, references?, dependsOn? }` |
| `connect` | `type`, `source`, `target`, optional `id` and `data` |
| `disconnect` | `id` of a relationship |
| `remove` | `id`, optional boolean `cascade` |

Command endpoints use ID strings. A multi-operation failure leaves the accepted
project, token, and history unchanged. Preview returns candidate data and complete
validation diagnostics without altering accepted state or the redo branch.
Malformed operations still throw. Preview is advisory: it neither reserves a
revision nor issues an acceptance capability. Applying the same operations or
accepting a draft validates again and rejects stale tokens. Editing a returned
snapshot or preview never changes the project.

For raw preview/apply pairs, supply explicit IDs when creating nodes: omitted IDs
are freshly generated on each call. To review and then accept exactly the same
generated IDs, construct a draft, call `draft.preview()`, and accept that draft.

## Dependency inspection and deletion

Both projects and drafts provide:

```js
project.dependencies('origin', {
  direction: 'incoming', // default: 'outgoing'
  edge: 'reference',    // 'reference', 'computation', or default 'all'
  transitive: true,     // default: false
});
```

Results are sorted, distinct IDs and exclude the queried ID even when a cycle
returns to it. Traversal terminates on reference cycles. An outgoing reference
edge goes from the owning node to its referenced node. Thus a relationship has
outgoing edges to both endpoints; this query does not silently turn relationships
into direct edges between their endpoints. Incoming queries find referring nodes
or computational consumers. Choose `edge` explicitly when inspecting computation.

Removal without `cascade` rejects any other node that directly or transitively
refers to the target through either edge category (`REFERENCED_REMOVAL`). An
incident relationship refers to its endpoints and therefore blocks their removal.
Disconnect or rewire those references first, or deliberately use `cascade: true`.
Cascading removal deletes the target and all its incoming transitive dependents,
including incident relationships; it does not delete every object the target
itself refers to. Disconnecting a relationship is also rejected when another node
refers to that relationship.

The example explicitly gives each label a reference to its anchor. Removing a
point with a cascade can therefore find its anchor and label. A hook may impose
additional requirements that cannot be inferred from declared edges. If deleting
an anchor would leave a label required by a hook but lacking an explicit anchor
reference, acceptance rejects the resulting incomplete graph; the author must
also remove or repair that label. Cascade never bypasses final validation.

## Identity, history, and loading

Every mutation token carries three separate values:

- `projectId` identifies authored project content.
- `generation` identifies this runtime/load; it is newly generated for each
  `Project`, `Project.from`, and successful `load`.
- `revision` starts at zero and increases on every successful acceptance,
  undo, redo, and load within that runtime.

`project.undo(project.token)` and `project.redo(project.token)` restore accepted
content, including IDs and references, while issuing a fresh revision. Old
mutation tokens never become valid again. A successful new edit after undo clears
the redo branch; failed edits and previews preserve it. Empty history operations
throw `EMPTY_HISTORY` without changing state. This is edit history, not an
authored animation timeline.

Accepting an unchanged draft is still a successful edit: it advances the revision
and clears the redo branch. History stores in-memory snapshots and currently has
no retention limit. IDs identify the current record with that ID; deliberate
reuse of a removed ID also makes existing accepted handles resolve that ID again.

`project.load(data, project.token)` validates replacement graph data before
changing anything. A successful load creates a fresh generation, advances the
revision, and clears undo/redo history. It invalidates old handles, drafts, and
command tokens even when the incoming project ID matches. Runtime jobs
compare all three token fields before returning results. Loading older
content never restores its old mutation authority. A failed load preserves the
current graph, generation, revision, and history.

Kernel snapshots contain graph data. The portable format adds versioned storage, source, asset requirements, provenance, playback settings and optional accepted-command receipts. Opening a portable construction starts a new runtime generation and edit history. [Portable project format](portable-projects.md)

## Injected validation hooks

`new Project`, `Project.from`, and `validateProject(data, validators)` accept:

```js
const validators = {
  structure: [project => []],
  types: {
    'my.point': (node, { project, get }) => [],
  },
};
```

Each function must be trusted, pure, and synchronous, returning an array of
`{ code, path, message }` diagnostics; an empty array means success. `get(id)`
returns a node or `undefined`. Inputs are detached and deeply frozen. Hook maps
are copied at runtime creation. Validators run after core shape, reference, and
computational-cycle checks succeed. Thrown exceptions, malformed diagnostics, and
asynchronous results fail validation with `VALIDATOR_FAILURE`.

Hooks participate in acceptance, load, and history restoration as well as explicit
validation and previews. They cannot authorize a graph that fails core validation.
Types without a hook receive structural validation only; their acceptance does
not assert an implementation exists or establish scientific meaning. The F03 registry supplies trusted registration and availability checks. The supplied fixture hooks
check real point coordinates, label text, anchor counts and endpoints, relationship
endpoint types, and a fixture-specific 128-node limit.

Failures use `KernelError` with a machine-readable `code`. Acceptance errors use
`VALIDATION_FAILED` and include `error.validation.errors`; stale commands use
`STALE_TOKEN`. Consumers should surface these diagnostics, preserve the accepted
state, and obtain a fresh token before intentionally retrying an obsolete edit.

See the [F01 handoff](handoffs/F01.md) for executed checks, changed files, and
requirements for downstream tasks.
