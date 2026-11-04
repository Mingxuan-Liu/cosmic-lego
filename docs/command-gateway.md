# Discoverable construction commands

The SDK, JSON CLI, HTTP host and in-app agent use the same data-only command gateway. Mutations stage through F01 handles and the host validates the complete candidate before accepting it. The default astronomy host registers exoplanet models and assets alongside shared dataflow, scene and overlay commands. A generic host can use the same gateway without the package.

## Run and discover

To discover the astronomy package, start `bash scripts/node.sh apps/exoplanet.mjs` in one terminal. In another, run `bash scripts/node.sh scripts/gateway.mjs discover --url http://127.0.0.1:4317`. The returned declarations include model inputs, ports and checked parameters for `exoplanet.orbit` and `exoplanet.photometry`. [Astronomy recipe and expected measurements](exoplanet-authoring.md)

To run the astronomy-free gateway example, use the following from the repository root with the pinned dependencies installed:

```sh
bash scripts/node.sh examples/command-gateway.mjs
bash scripts/node.sh scripts/scene-server.mjs --workspace --port 4326
# In another terminal:
bash scripts/node.sh scripts/gateway.mjs discover
bash scripts/node.sh scripts/gateway.mjs inspect
```

Open `http://127.0.0.1:4326/workspace/`. An authorized external edit refreshes
the scene and floating views automatically, normally within the one-second
identity polling interval plus computation time. The status reports the change;
Undo restores content under a fresh revision. No preview confirmation is required.
Concurrent viewers share the runtime's latest-request scheduling. A superseded
viewer retries its read with bounded backoff; this never repeats the accepted edit.
The [F08 session bridge](in-app-agent-sessions.md) connects a configured local
agent and scopes its tools to revocable turns. Without configuration, conversation
remains disconnected.

`discover` returns installed commands, argument/result JSON Schemas, defaults,
examples, capabilities, limits, diagnostics, ports, assets, implementation pins
and scientific review metadata. Each registered `create:<extension-id>` takes
its parameter schema directly from the immutable registry binding. Its matching
`update:<extension-id>` derives a partial schema and shallow-merges parameters
and supplied input/asset slots. Omitted values and implementation pins survive.
New installed extensions appear without adding domain-name dispatch to the gateway.
F08 adds `args: {detail: "summary"}` for compact metadata and `args: {names: [...]}`
for selected full declarations, both derived from this same catalog. Full discovery
without arguments keeps its existing behavior.

For a plot, `overlay.create` accepts a relationship ID in `binding.id` and `overlay.bind` accepts it in `options.id`. Pass both plot and relationship IDs when creating a bound plot in a timeline configuration. Subsequent binds preserve the existing relationship ID.

Schemas describe data structure; `x-semanticValidator` markers identify existing
F01/F02/F04 scientific and graph checks. A structurally valid argument can still
fail unit, frame, reference, applicability, asset or dependency validation.
Use the discovered gateway limits as well as the underlying registry/dataflow
limits; the gateway's whole-request bound can be smaller than an individual
catalogue argument bound.
Builtin declarations additionally report `hostRequirements`,
`missingHostRequirements` and `available` for runtime/compiler requirements.

## Author with handles

`src/gateway/sdk.js` exports `createHttpGatewayClient`, `createGatewayClient`,
`createLocalGatewayClient`, `requireSuccess` and `GatewayClientError`. A client
transport receives a detached data request and returns the gateway envelope.
Author recipes run in the author's process and retain ordinary loops/functions.
The server never executes uploaded JavaScript.

```js
import { createHttpGatewayClient, requireSuccess } from '../src/gateway/sdk.js';
const client = createHttpGatewayClient();
const discovered = requireSuccess(await client.discover()).result;
const point = discovered.commands.find(command => command.name.startsWith('create:') &&
  Object.values(command.outputs ?? {}).some(port => port.kind === 'vector' && port.meaning === 'position'));
const port = Object.entries(point.outputs).find(([, value]) => value.meaning === 'position')[0];
const edit = await client.begin();
const members = [0, 1, 2].map(i => edit.create(point.extension.id, {
  id: `my-point-${i}`, parameters: point.examples[0].parameters,
}));
const collection = edit.select({ mode: 'fixed', members: members.map(p => p.port(port)) });
const mean = edit.reduce('mean', edit.map('magnitude', collection));
requireSuccess(await edit.commit());
console.log(requireSuccess(await client.evaluate({ id: mean.id, time: { value: 2, unit: 's' } })).result.value);
```

The complete [runnable recipe](../examples/command-gateway.mjs) also discovers
scene assets, camera, points and plot factories, binds visual instances and a
derived plot, previews, retries, evaluates and exercises Undo/Redo.

`begin()` inspects the accepted graph and captures its full identity. It returns
an author with `create`, `get`, `constant`, `select`, `arithmetic`, `map`, `reduce`,
`field`, `adapt`, `connect`, `disconnect`, `remove`, `bindScene`, `bindPlot` and
`command`. Handles expose `id`, `port`, registered-parameter `set`, `connect` and
`remove`; cross-transaction handles reject. Use explicit IDs to refer to objects
from another transaction. `command(name,args)` reaches any discovered mutation.
`snapshot()` returns the serializable commit request.

`preview()` returns the staged graph, validation, operation results and change
summary without changing accepted content/history/revision. `commit()` captures
the exact request and closes the builder. Calling it again sends that same request,
including IDs, expected token and key, even after a lost transport response.
To change anything after submission, begin a new author with a new key.

## Envelopes and commands

All transports use the same request:

```json
{
  "command": "transaction.commit",
  "expected": {"projectId":"scene-fixtures","generation":"COPY-FROM-INSPECT","revision":0},
  "idempotencyKey": "one-logical-edit-unique-key",
  "args": {"operations":[
    {"command":"overlay.duplicate","args":{"id":"positions-plot","options":{"id":"another-plot","title":"Independent view"}}}
  ]}
}
```

Copy the actual token from `inspect`; the example generation above is a placeholder.
The CLI accepts the JSON file, or `-` for stdin:

```sh
bash scripts/node.sh scripts/gateway.mjs request operation.json
```

Use `--url http://127.0.0.1:PORT` to select another loopback host. The CLI prints
the exact envelope: exit 0 for success, 1 for gateway rejection and 2 for CLI or
transport failure. Both file and stdin reads are bounded. Redirects are rejected
by the HTTP SDK. No recipe-execution, file-edit or module-loading command exists.

Success is `{ok:true,command,identity,result,summary?,replayed?}`. Mutation results
contain per-operation results and history availability, not a second full graph;
`inspect` reads current content. Failure is `{ok:false,command,error,context}`;
`error` includes stable `code`, `category`, diagnostics, affected IDs, paths,
supported repairs and, when available, the failed operation index. Context
contains the current identity. Inspect it before rebasing a rejected edit.

| Command family | Behavior |
| --- | --- |
| `discover`, `inspect` | Installed contracts; whole graph or one component/dependencies |
| `create:<id>`, `update:<id>` | Registered components, calculations, assets and views |
| `dataflow.*` | Constants/set-value, fixed/live selection, arithmetic, map/reduce, field selection, installed adapters |
| `connect`, `disconnect`, `remove` | Inert relationships and explicit referential removal; physics still needs a registered contract |
| `scene.*`, `overlay.*` | Bind, duplicate, arrange/update, reparent scenes, create/remove overlays |
| `transaction.preview`, `transaction.commit` | One validated batch of 1–64 mutations |
| `evaluate`, `render` | F04 results or F05/F06 compiled scene/workspace at explicit physical time |
| `history.undo`, `history.redo` | Restore accepted content with a new revision |

Individual catalogue mutations are shorthand for a one-operation transaction.
Evaluation requires an installed runtime; rendering additionally requires the
scene/workspace compiler. Discovery does not authorize a capability the host lacks.

## Identity, retry and repair

Every mutation, preview, evaluation and render requires
`{projectId,generation,revision}`. Generation changes when a project is loaded;
revision changes for every accepted edit, Undo and Redo. Preview reserves nothing.
Commit stages and validates anew against the current token. A failed batch changes
neither content nor history.
F01's final synchronous host hook checks the actual commit/Undo/Redo candidate
and authorization after ordinary validators, before any accepted-state mutation.

Every write requires a 1–128-character idempotency key. The retained signature
includes command, canonical data arguments, complete expected token and the
host-issued authority context. Object key order does not matter. An exact retry
returns the original successful outcome with `replayed:true`, even after later
edits or Undo, and performs no new edit. The original outcome's identity may be
older than current state: call `inspect` for the current graph. Changed content,
expected token or authority using a retained key returns `IDEMPOTENCY_CONFLICT`.
Authorization is checked before replay; a revoked turn cannot use cached success.

Retention is **at most 10 minutes, 256 successful writes and 8 MiB**, with oldest
entries evicted first. The cache is memory-only and cleared on restart or project
switch/load. Failures are not retained. After eviction an old expected token is
stale, so retry cannot silently duplicate the earlier mutation. Do not reuse a
key with a fresh token to resolve an uncertain outcome: inspect the object IDs
and reconcile first. F09 persists accepted content and selected receipts separately from this in-memory retry cache. [Portable projects](portable-projects.md)

Repair categories distinguish malformed input, unavailable capability,
incompatible scientific connections, applicability, exhausted resources, stale
state, cancelled work and missing authorization. Change only supported arguments
or connections. For stale state, inspect/reconcile and submit a new logical request
with a new key. For scientific failures, fix the reported units/context or choose
a supported model; the gateway never guesses physics or edits numerical source.

For a rejected model input, the diagnostic identifies the producing node and
port and the receiving slot. A kind mismatch names both quantity meanings,
kinds and units. Use `inspect` and check `result.outputs` for a compatible
producer. If you know the input value independently, preview a transaction
that creates a typed `dataflow.constant` and connects its `value` port.
Different physical dimensions require a different quantity. A change of unit
scale can use an installed conversion adapter.

## Host-issued agent context

Trusted host setup creates `createCommandGateway({project,registry,binding,layer,runtime})`.
Ordinary local-user transports call `dispatch(request,gateway.localAuthority)`.
An F08 adapter instead creates a session and issues a turn:

```js
const session = gateway.createSession({ permissions: ['read', 'write', 'evaluate', 'render'] });
const turn = gateway.issueTurn(session);
const toolsForThisTurn = gateway.forTurn(turn); // expose only this dispatch closure
const client = createGatewayClient(toolsForThisTurn.dispatch);
// Stop, failure or completion:
gateway.revokeTurn(turn);
// Disconnect:
gateway.closeSession(session);
```

Sessions and turns are opaque host objects, bound to the current project load.
Turn permissions can only narrow session permissions. No JSON turn label or
copied object grants authority; no HTTP route mints agent grants. Stop revokes
future commits and cancels associated jobs. Accepted edits stay visible; Undo is
an independently authorized edit. Project switching/loading invalidates grants
and computation results. Jobs recheck identity, authority and supersession before
publishing; render loops also recheck between sources and after compilation.

The loopback HTTP route represents the local user's authorized connection. It
is not an operating-system sandbox: a process with native HTTP/filesystem access
has capabilities beyond a scoped agent tool. The F08 companion exposes the turn closure and manages native process permissions separately.

The host preserves exact loopback Host and Origin checks, JSON-only requests,
static-file allowlists and 64 KiB request bounds. Default gateway bounds include
8 MiB responses, 32 active sessions, 128 active turns and 128 render sources;
F01–F06 graph/scientific/worker/scene limits still apply. These limits and the
memory-only cache are exposed by discovery. See [the F07 handoff](handoffs/F07.md)
for checks and F08 integration requirements.
