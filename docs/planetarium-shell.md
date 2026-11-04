# Planetarium workspace

The workspace puts the navigable simulation on a near-black, full-window canvas.
Scientific instruments and plots float on the left. Inspection, provenance and
conversation share the right. The HUD presents the accepted F01 project and its
current F04 scientific results. Public handles can create additional views.

The [workspace recipe](../examples/workspace.mjs) uses generic moving points and
static scalar/vector fields. No astronomy package is loaded. F01–F10 are
implemented, including the [shared command gateway](command-gateway.md). The conversation surface
is disconnected unless the [F08 companion](in-app-agent-sessions.md) is configured
and connects a real compatible agent.

## Open the workspace

Use Node.js 20 or later, pnpm, and a WebGL2-capable browser:

```sh
pnpm install --frozen-lockfile --ignore-scripts
node examples/workspace.mjs
node scripts/scene-server.mjs --workspace --port 4326
```

Open `http://127.0.0.1:4326/workspace/`. The root URL also opens workspace mode.
On the original workstation, `bash scripts/node.sh` can replace `node`. The
workspace uses the same pinned Three.js 0.187.0 dependency and local server as
[F05](scene-and-assets.md); there is no additional rendering library or CDN.
Without `--workspace`, the server still opens the F05 scene laboratory on port 4325.

Drag the scene to orbit, right-drag to pan, and use the wheel to zoom. Click an
object or plot sample to select its stable ID. Fit and Reset recover camera views.
Changing the presentation camera does not change physical observer geometry or
scientific values.

The **Instruments** and **Inspection** buttons independently open or close their
sides on desktop. At viewport widths up to 760 pixels both drawers initially
close, and opening one closes the other. The canvas keeps the same dimensions.
Fold a panel to retain its title or hide it and restore it through **Views**.
The Views menu can also create another bound plot. Fold, hide, removal and
restoration are project edits with Undo. Opening a rail is local to the viewer.

**Scene only** temporarily hides both sides and retains folds, visibility and
composer drafts. Press **V** to toggle it, **F** to fit the scene, or **Escape**
to close a menu or return focus to the stage. Tab reaches the rail and panel
controls. In portrait the workspace's orthographic camera maintains the authored
span on the shorter axis. Timeline captures retain their authored camera framing.

During playback the clock and measurements advance together when a scientific
sample arrives. Analytic playback samples the elapsed clock with at most one
playback read in flight per tab. Stateful playback retains its requested steps.
See the [timing experiments](workspace-performance.md) for the measured presets.

## Author views through the project

The trusted composition root calls `registerSceneExtensions(registry)` and
`registerWorkspaceExtensions(registry)` before binding the registry. Create
`layer = createWorkspaceLayer(binding)` and use `layer.validators` when creating
or reopening the project. `layer.author(draft)` authors overlays;
`layer.scene.author(draft)` retains the F05 scene/asset authoring API.

Four F03 view factories are registered as `workspace.inspector`, `workspace.plot`,
`workspace.provenance`, and `workspace.conversation`. Each returns declarative
layout data in `cosmic.workspace.overlay.v1`. The trusted workspace layer admits
this additional view format through F05's `additionalViewFormats` composition
option; project data cannot install its own consumer.

From the repository root, this authoring example adds a field plot:

```js
import { buildExample } from './examples/workspace.mjs';

const { project, layer } = buildExample();
const draft = project.begin();
const views = layer.author(draft);
const plot = views.plot({
  id: 'temperature-plot', title: 'Temperature samples',
  x: 40, y: 40, width: 390, height: 280,
});
views.bind(plot, 'scalar-field', { id: 'temperature-source', port: 'value' });
const copy = views.duplicate(plot, { id: 'temperature-copy', hidden: true });
views.update(copy, { title: 'Comparison workspace', folded: true });
views.remove(copy);
draft.accept();
project.undo(project.token);
project.redo(project.token);
```

The author methods are:

| Method | Contract |
| --- | --- |
| `create(kind, options)` | Create any of the four registered overlay kinds. |
| `inspector(options)`, `plot(options)`, `provenance(options)`, `conversation(options)` | Equivalent named constructors returning ordinary F01 draft handles. |
| `bind(plot, source, {id?,port?,component?})` | Bind an installed scientific output. The port defaults to `value`. An optional relationship ID makes repeated constructions reproducible. Rebinding preserves the original ID. |
| `update(overlay, patch)` | Merge flat layout/title parameters. |
| `duplicate(overlay, {id?,...overrides})` | Copy layout and any plot binding; the new plot can be independently rebound. |
| `remove(overlay, {cascade?})` | Remove the overlay and its source relationship through F01 operations. |

Options include `id`, `title`, `x`, `y`, `width`, `height`, `folded`, and `hidden`.
Portable files retain the historical rectangle fields. The shared HUD assigns each panel by purpose and lays it out at the current screen size. Plots additionally have `component`: `-1` means all vector components; `0`, `1`,
and `2` select X, Y, and Z. Scalar sources accept `-1` or `0`.

A plot binding is an ordinary F01 relationship of type `workspace.plot-source`:
`references:{source,target}`, `data:{port,contract}`, and dependencies on both
endpoints. The contract is inferred from the F02 output and checked again on
acceptance. A changed source contract requires explicit rebinding. Each accepted
plot must have exactly one source, so create and bind it in the same draft.
The layout factory does not contain an executable plotting function or model.

## Current samples, shared time, and selection

`layer.sources(project)` combines scene and plot requirements as distinct
`{nodeId,port}` pairs. Evaluate these through F04 at one physical sample time,
then call `await layer.compile(project,{results,time,capabilities})`. As with F05,
missing snapshots are not recomputed during compilation. Producer identity,
project/load/revision token, port contract, and achieved time must match.

The workspace result is:

```text
{ valid, identity, time, scene, overlays, diagnostics }
```

`scene` is the ordinary F05 snapshot for the existing Three adapter. Each overlay
has flat layout fields and its stable ID/kind. A compiled plot adds `data` (the
full scientific Value), `source:{nodeId,port,implementation,identity}`, `sampling`,
and `sampleMode:'current-physical-time'`. Missing values and metadata remain
available to the presentation; plots do not invent replacement samples.

The initial visible plot shows the moving collection's X positions against sample
index, retaining source object IDs. The initially hidden mean plot is a real F02
calculation: `reduce('mean', map('magnitude', movingCollection))`. Its meaning is
**mean position magnitude in the declared frame**, not a vector centroid. The
Views menu can restore it or add a scalar-field plot without changing shell code.

These plots show the **current physical-time sample**. Changing the time replaces
their values. They do not accumulate a time history or manufacture a time-series
curve from display frames. A scalar is one derived value; vector components and
field/collection entries are samples within that snapshot.

Application selection is `{nodeId,objectId?,instanceIndex?}`. Scene picking and
plot sample selection share source IDs. Inspector content resolves those IDs
against the accepted graph, mapped results, units, frames, and physical time.
It does not infer identity from a label or pixel coordinate. The browser emits
`cosmic:selection` with `{selection,identity,time}` for downstream consumers.

## Host and browser interfaces

`startSceneServer({workspace:true,port:4326,host:'127.0.0.1'})` extends the existing
host; default workspace port is 4326. Requests are bounded JSON, same-origin and
loopback checked. Every evaluation or edit requires the full current identity.

| Route | Data |
| --- | --- |
| `GET /api/workspace/state` | `{graph,identity,discovery,sources,outputs,history}`. `outputs` exposes installed F02 port descriptors for the source picker. |
| `POST /api/workspace/evaluate` | `{identity,time,capabilities?}` → `{identity,time,results,snapshot}`. |
| `POST /api/workspace/edit` | `{identity,action,...}` → `{graph,identity,history,createdId?}`. |

Overlay edit actions are `overlay.create {kind,options,source?,binding?}`,
`overlay.bind {id,source,options?}`, `overlay.duplicate {id,options?}`,
`overlay.update {id,parameters}`, and `overlay.remove {id}`. Create's optional
source/binding performs both steps in one transaction. `undo` and `redo` use the
same checked route. Existing scene duplication/removal, marker-size and projection
demo actions remain available. A newer evaluation supersedes an older worker
sequence; stale tokens or late results never replace the current workspace.

The browser's `globalThis.cosmicWorkspace` exposes `views.create/bind/duplicate/
update/remove`, `select`, `setSceneOnly`, `refresh`, `edit`, `adapter`,
`conversation`, and current `snapshot`, `results`, and `state` for local
integration and inspection. View methods call the checked server; they do not
mutate Three objects into project definitions. These compatibility routes now
translate through the F07 gateway. New clients use `POST /api/gateway`; the
browser polls its lightweight identity route and refreshes accepted external
changes with a summary and Undo. Browser writes supply an idempotency key;
legacy keyless writes derive a deterministic key from their identity and action.
Superseded reads retry with bounded backoff, including when a second visible tab
uses the shared runtime, without repeating accepted edits.
No filesystem or source-execution operation is provided.

The reusable `createOverlayManager` in `src/workspace/browser.js` accepts
`{container,restoreContainer?,onChange,onFocus?,onRemove?,renderContent?,onError?}`.
`onChange(id,patch)` asks the host to commit an edit; the next `render(overlays)`
supplies accepted layouts. Failed commits revert pending layout fields.
`body(id)` exposes a content container; `focus(id)`, `resize()`,
`setSceneOnly(boolean)`, and `dispose()` manage the view lifecycle. Content DOM is
retained across layout changes. Hidden panels are inert and cannot block the
scene; keyboard/pointer gesture handling keeps headers within the viewport.

## Conversation boundary for F08

`createConversation({onEvent})` in `src/workspace/session.js` owns detached UI
state: connection, messages, progress, error, active turn, selection context,
and per-composer drafts. It does not connect a provider or grant edit authority.
The unconfigured workspace says **No agent connected** and disables submission.
F08's `createAgentClient` consumes host snapshots and supplies real connection,
text, tool, permission/input and Stop behavior. There are no scripted replies
represented as a real session. The event interface below remains a labeled test
seam; it cannot launch a provider or mint gateway authority.

Use `draft(composerId,text)`, `context({identity,time,selection})`, `snapshot()`,
and `subscribe(listener)`. `submit(composerId)` emits
`{type:'submit',turnId,composerId,text,context}` only while connected and idle.
`cancel()` emits `{type:'cancel',turnId,context}` and revokes that active turn.
The demo forwards these events as `cosmic:conversation` browser events.

A trusted session adapter supplies `receive(event)`:

| Event | Required data |
| --- | --- |
| `connection` | `status:'disconnected'|'connecting'|'connected'|'error'`, optional `label`. |
| `message` / `delta` | Current `turnId`, stable message `id`, `text`, optional `role:'assistant'|'system'|'tool'`. A delta appends text. |
| `progress` | Current `turnId`, `label`, optional fraction in `[0,1]`. |
| `error` | Current `turnId`, `message`; ends the turn. |
| `complete` | Current `turnId`; ends the turn. |

Late events after Stop, completion, or project/load changes are ignored. A project
or generation change clears transcript/drafts and revokes the turn; ordinary
revision changes update context. F08 binds actual tool writes to F07's
host-issued turn authority and current-token checks. Hiding or folding a composer preserves its draft in this browser session.
Removing a composer calls `forgetDraft(id)` to release its draft; Undo restores
the view definition, not that deleted draft. Reloading the page is not persistent
conversation storage. Transport callback failures are visible, preserve an unsent
draft, and cannot un-revoke a stopped local turn.

## Bounds and remaining work

Workspace defaults allow 16 overlays and 10,000 numeric/missing plot entries.
Titles allow 160 characters. Authored layouts use nonnegative coordinates up to
100,000, and widths/heights 1–2,000. The HUD scrolls each rail when its open panels exceed the available height.
Existing scene/registry/runtime budgets still apply.
Conversation state retains at most 200 messages/turn IDs and 24 composer drafts;
message/draft text is limited to 12,000 characters. HTTP request bodies are
bounded at 64 KiB.

The executable recipe and `test/workspace*.test.js` cover public authoring,
checked results, layout/session behavior, host edits, history, and stale requests.
See [the F06 handoff](handoffs/F06.md) for current totals, browser inspection,
screenshots, and limitations. The [F07 handoff](handoffs/F07.md) records the
integrated command gateway and external-edit browser checks. The [F08 handoff](handoffs/F08.md)
records connected native-agent evidence and confinement limits. The Project menu
saves and reopens the accepted workspace and its physical playhead. See the
[project-file guide](portable-projects.md) and [F09 handoff](handoffs/F09.md).
Open the authored player from the Project menu after loading a timeline project.
See the [timeline and export guide](authored-timelines.md).
The shell itself does not add a scientific solver, archive format or time-history
recorder.
