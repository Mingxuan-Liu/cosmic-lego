# Implementation status — F01–F12 and v0.2 compatibility

Updated 2026-11-03. This is a rough local authoring experiment, not a release-ready
educational application.

## F12 optional exoplanet package — 2026-11-03

The shared workspace now opens a synthetic transit study. At conjunction a real in-app agent added a fourth orbit and a separate plot of the excess deficit in the naive depth sum. The physical union gives **0.965785051** of the unobscured stellar flux. The naive calculation gives **0.938328610**. Two Undos and two Redos restored the expected graphs. Provider-free reopening, seeking, 33 exported frames and a clean offline player were verified. All 485 tests passed with browser capture enabled. The package-free F11 deployment also reopened and exported its original 17 frames. [Open or author the study](exoplanet-authoring.md) · [Four-planet project](evidence/F12-shared-shadow.json) · [Handoff, evidence and limitations](handoffs/F12.md)

## F11 independent readiness — 2026-11-03

An independently authored timing bench passed the generic workflow in an isolated deployment with no astronomy packages. An actual in-app Codex edit added a fourth moving point, changing the mean distance at 2 s from ⅔ m to 1 m. Undo, Stop, agent-free reopen and a 17-frame export were verified. All 466 repository tests passed. The original and edited graphs retain separate source associations. [Evidence and reproducible commands](domain-independent-readiness.md) · [Handoff](handoffs/F11.md)

## F10 authored timelines and local delivery — 2026-11-03

An eight-second comparison groups nine moving points, changes playback speed,
holds the scientific clock while moving the camera, switches configurations
and seeks backward. At physical time 4 s the original configuration gives a
mean distance of 2.613344 m and the alternative gives 2.288084 m. The same
evaluator serves the workspace player, packaged player and scheduled PNG export.
All 458 tests passed. Two complete 960 × 540 exports reproduced all 65 PNG hashes
on the tested renderer. A clean extracted player opened offline in Chrome.
See the [guide](authored-timelines.md), [example](../examples/authored-timeline.mjs)
and [F10 handoff](handoffs/F10.md) for the inspected output and verification.

Earlier milestones record the capabilities available at the time.

## F09 portable projects — 2026-11-03

The Project menu supports named local saves, reopening after a companion restart,
and portable JSON download and import. A fresh runtime reproduced both fixture
fields, eight scene assets and five overlay layouts. With a 0.25 s step, the
seeded fixture reproduced its value and complete generator state at 1 s and
again at 2 s. The browser can play and inspect a file with its agent disconnected.
Conversation sharing is opt-in. All 444 offline tests and five F09 Chrome checks passed.
The [guide](portable-projects.md),
[example](../examples/portable-project.mjs) and [handoff](handoffs/F09.md) cover
the format, compatibility checks, recovery and verification evidence.

## F08 in-app agent sessions — 2026-11-03

The floating Conversation window now connects a configured local Codex runtime.
The provider-neutral bridge supplies bounded selection/time/project context and
one validated F07 construction tool. Stop revokes the turn before cooperative
native interruption. Undo preserves control over accepted changes. Browser
drafts and visible transcript are distinct from the ephemeral provider thread.

The [real browser acceptance](../scripts/verify-agent-browser.mjs) passed six
groups using existing runtime authentication and **Codex 0.166.0-alpha.5.1**.
The agent discovered commands and created three moving points, a collection,
magnitude map and mean reduction, visible scene binding and plot. At 0 s the
worker and mean plot agreed at **2 m**. The agent created an independently bound
second plot and removed it; browser Undo restored it. Keyboard Send, real Stop
and disconnected playback passed. There were 24 gateway calls and three
accepted transactions; two superseded render reads retried successfully.
There were no unexpected browser errors or dialogs.

An additional real two-tab check verified that closing an observer leaves the
turn running, Stop targets the originating turn, and reload recovers the public
transcript after disconnect. Reordered Send/Stop and reconnect races are covered
by deterministic bridge, browser and HTTP checks.

The offline suite passes **419 tests**, zero failures/skips. A separate mock
browser run passes four groups covering streaming, input/permissions, cancellation,
late writes, drafts and failed auth. F06/F07 browser regressions also pass.
The native adapter verifies read-only mode, no shell/native network tools and
disabled inherited connectors; its dynamic dispatcher stays enabled. Read-only
mode does not confine all filesystem reads. No credentials enter browser storage.
See the [setup guide](in-app-agent-sessions.md) and [F08 handoff](handoffs/F08.md)
for real versus mock evidence, exact versions, screenshots and remaining limits.

## F07 command gateway — 2026-11-03

Implemented one discoverable data-only command boundary shared by the handle
SDK, JSON CLI, loopback HTTP and future scoped agent tools. Registered manifests
generate create/update schemas; the command catalog stages F01 handles and the
gateway validates F02–F06 contracts before atomic acceptance. Existing scene and
workspace edit routes now translate into that boundary. Discovery also exposes
capabilities, defaults, examples, scientific contracts, limits and result schemas.

Complete project/load/revision tokens guard writes, previews and computations.
Content/context-bound retry keys return original successful outcomes without
repeating effects. A changed request with a retained key fails. Cache retention
is bounded to at most 10 minutes, 256 successes and 8 MiB, with no restart
durability. Host-issued sessions/turns can narrow permissions and revoke future
writes/replays. Cancellation, load/switch and supersession invalidate pending
results; committed effects remain until a separate Undo. Failures report stable
codes, categories, affected IDs/paths and supported repairs.

The [public recipe](../examples/command-gateway.mjs) discovers and constructs
three moving points, a collection, magnitude/mean calculation, shared scene
assets, camera, visual binding and plot. Its checked mean at 2 s is
**5.699889623513833 m**. A real child CLI, HTTP client and local SDK agree on
discovery, mutations, atomic validation failures and worker Values.

The [F07 browser harness](../scripts/verify-gateway-browser.mjs) passes **four
interaction groups** with **zero dialogs, console errors or page errors**.
An external SDK batch adds a scene instance and linked plot; the workspace
refreshes automatically with a summary and Undo. One Undo restores content at a
fresh revision. Exact retries have no extra effects, changed-key requests fail,
and browser edits reach the same accepted graph. Inspected screenshots are
`.local/f07-qa/external-edit.png` and `undo-restored.png`; `report.json` records
Chrome **156.0.8078.80**, Playwright **1.62.1**, headless WebGL2/SwiftShader,
1440×1000. This does not certify hardware GPU performance or an agent connection.

The existing F06 browser harness also passes all **eight groups** after gateway
integration, keeping the desktop tab open throughout narrow-screen/touch checks.
Its `.local/f06-qa/report.json` records 20 expected cancelled reads (16
`SUPERSEDED`, 4 `STALE_RESULT`) and 20 matching network-console messages, with
zero unexpected console/page errors. Both viewers recover through bounded read
backoff without repeating writes. Desktop/narrow layout, source selection,
scientific values, Undo/Redo and touch orbit/pinch remain working.

Gateway/catalog/SDK/CLI/HTTP tests cover derived contracts, finite data transport,
origin/body bounds, preview/history, retries/eviction, turn revocation during
final validation/worker/compile, project loads and supersession. The full suite
passes **361 tests**, zero failures/skips, on **Node 24.22.1**: 298 prior checks
plus 63 new checks. Results are saved in `.local/f07-qa/test-results.txt`.
F01's optional trusted synchronous `beforeCommit` hook lets the gateway validate
actual history targets and recheck authorization after the last validator,
before accepted content/history/revision changes. Bounded HTTP and CLI byte
decoding also preserves Chinese labels across arbitrary UTF-8 chunk boundaries.

The approved logo, BSD-3-Clause notices, dependencies and existing astronomy
implementation remain unchanged. Work is local; F08 must connect a real session
and scope its tools to host-issued turns. Native process HTTP/filesystem access
is separate from gateway authorization. Persistence/recovery remains F09.
See the [gateway guide](command-gateway.md) and [F07 handoff](handoffs/F07.md).
F08 integration is recorded above.

## F06 planetarium workspace — 2026-11-03

Implemented a full-viewport workspace using the F05 Three adapter, with movable,
resizable, foldable and restorable inspector, plot, model/provenance and
conversation windows. Scene-only mode has a persistent restore button and
V/Escape keyboard routes. Hidden windows are inert and do not intercept pointers.
Window geometry stays within the viewport; focus, drafts, metadata expansion and
scroll positions survive ordinary layout/result updates. Reduced motion disables
navigation damping. Narrow layouts use overlapping windows with Views restoration.

Public F01 handles create, bind, duplicate, rearrange and remove overlay
instances. Four F03 factories produce layout data; explicit plot-source
relationships retain exact F02 contracts. The workspace compiles supplied F04
snapshots through the shared scientific-result validation gate. Plots, inspector,
selected source IDs and renderer share the same physical sample time. Undo/Redo
uses accepted project history. The [public example](../examples/workspace.mjs)
checks independent field plots and the real derived mean position magnitude:
**2.8817425997262003 m at 2 s**. No astronomy package is imported by the shell.

`bash scripts/node.sh --test --test-reporter=spec` passed **298 tests**, zero
failures/skips, on bundled **Node 24.22.1**: all 261 prior checks plus 37 F06
checks. Tests include view contracts/history, state/port/time validation, bounds,
pointer/keyboard/focus behavior, conversation lifecycle and server request
boundaries. An isolated child copies only shared layers and compiles scalar and
vector-field plots with no astronomy files, examples or node_modules present.
The public recipe, source syntax, documentation links and diff checks pass.

The [browser harness](../scripts/verify-workspace-browser.mjs) passed **eight
interaction groups** in **Chrome 156.0.8078.80**, Playwright **1.62.1**, headless
**WebGL2/SwiftShader**, with no console/page errors. Real mouse/keyboard and
CDP-delivered touch exercised offscreen drag/resize clamping, fold/hide/restore,
scene-only recovery, stable sample selection, direct non-default output ports,
independent plot creation/removal with Undo/Redo, and touch orbit/pinch at
390×844 with reduced motion. Desktop checks used 1440×1000. A final visual pass
made panels opaque, enlarged plot labels and moved copying to the Views menu;
that menu operation and the final desktop/narrow states were rechecked.

Inspected evidence is in ignored `.local/f06-qa/`: `report.json`,
`test-results.txt`, `final-desktop.png`, `final-narrow-plot.png`,
`desktop-linked-selection.png`, `narrow-restored-conversation.png`,
`narrow-restored-plot.png`, `narrow-touch-scene.png`, and other harness states.
This does not certify every browser, screen reader, physical touch device, or
hardware-GPU performance.

Conversation defaults to **disconnected**. Drafts survive hiding/folding within
the current page. Messages/progress/errors/Stop were checked through explicitly
labeled **TEST ONLY** event injection; no real agent or credentials were used.
F08 must connect an actual session and bind cancellation to jobs and write
authority. Draft/transcript persistence, portable archives and timelines remain
future work; removing a composer releases its local draft.

Run `bash scripts/node.sh scripts/scene-server.mjs --workspace --port 4326`.
The approved logo, BSD-3-Clause notices, dependencies and original astronomy
implementation are unchanged. See the [workspace guide](planetarium-shell.md)
and [F06 handoff](handoffs/F06.md). F07 integration is recorded above.

## F05 scene and assets — 2026-11-03

Implemented `src/scene/` with public F01 author handles for groups/transforms,
cameras, basic geometry, shared materials/textures, meshes, instanced points,
polylines, arrows and labels. Explicit bindings consume current F04 scientific
snapshots, retaining source, quantity, units, frame, coordinate conversion,
display scale, color range and sampling metadata. Missing values/assets and
unsupported capabilities produce diagnostics. Assets retain provenance/license,
SHA-256 content identities and dependencies; renderer reuse/disposal is bounded.

The [public example](../examples/scene-and-assets.mjs) creates generic moving
points and scalar/vector fields with **34 scene nodes, 8 authored assets and
3 scientific bindings**, without astronomy modules. It checks duplicate bindings,
shared assets, identical scientific Values and project JSON reopening. The
[scene guide](scene-and-assets.md) documents authoring and local browser startup.

The browser adapter uses locally installed **Three.js 0.187.0**, pinned after
checking current primary documentation and its MIT license. The exact approved
logo and BSD-3-Clause license are unchanged; the dependency has a separate
[MIT notice](third-party-notices.md). Existing astronomy code/UI remains intact.

`bash scripts/node.sh --test --test-reporter=spec` passed **261 tests**, with
zero failures/skips, on **Node 24.22.1**: the 203 prior checks plus 58 F05 checks.
The public example, source syntax, import boundaries and `git diff --check` pass.
Coverage includes supplied-snapshot integrity/time, frame/unit mappings,
missing data, row alignment, reference-safe authoring, resource reuse/replacement,
serialization, bounded requests, stale writes and generic isolated workers.

The optional [browser harness](../scripts/verify-scene-browser.mjs) passed ten
interaction groups in **Chrome 156.0.8078.80**, using Playwright **1.62.1** and
headless **WebGL2/SwiftShader**. At 1440×1000 and 390×844, inspected screenshots
show perspective/orthographic scenes, all labels, selection/source metadata,
camera navigation, a fitted narrow layout, opaque depth and missing-asset errors.
Pointer picking follows stable source IDs through physical-time changes. Camera
and marker edits preserve scientific Values; duplication shares resources and
removal preserves remaining users. Rapid edits serialize and controls restore
accepted values after reload. Final disposal reports zero owned graphics
resources. Browser review caught a label texture/material cache collision, now
covered by regression; scaled-parent camera projection was also corrected.

Evidence is in ignored `.local/f05-qa/report.json` and PNGs. This is real browser
rendering with software graphics, not a hardware performance benchmark,
cross-browser certification, full-motion review or touch-device test. The local
server hosts Node workers. Its narrow edit syntax now translates into F07.

F06 now supplies the floating-window workspace above these interfaces. In-app
agent sessions, portable archives, timelines/export and
domain migration remain planned. See [F05 handoff](handoffs/F05.md) for the scene
interfaces and limits.

## F04 computation runtime — 2026-11-03

Implemented `src/runtime/` with analytic random access and registered stateful
initialization, bounded stepping, extraction, checkpoint and restore. Disposable
Node workers keep computation off the caller's event loop. Progress, cancellation,
deadlines, resource budgets and project/load/revision checks prevent failed or
late work from becoming current results. Backward seeks use compatible checkpoints
or reset/replay; random continuation retains the algorithm and generator state.

The [public example](../examples/computation-runtime.mjs) checks direct and stepped
accumulators, fresh/sequential/checkpoint-resumed seeded results, frame-rate
independence, explicit 1.1 s requested versus 1 s achieved sampling, derived
arithmetic and compatible reopening under a fresh identity. Shared producer
outputs are reused across ports at one physical time while retained in bounded
caches. Different stateful sampling grids require explicit alignment.

`bash scripts/node.sh --test --test-reporter=spec` passed **203 checks** on bundled
**Node 24.22.1**: all 167 prior tests, 35 new runtime/registry/edge tests and one
support-module load. No failures or skips. The suite includes actual worker
termination during an entered CPU loop, stale loads/project switches, checkpoint
compatibility, budget failures, a copied shared-layer worker with no astronomy
files, and import-boundary checks. The public example, syntax checks and
`git diff --check` pass. Existing astronomy/UI, branding, license and dependencies
are unchanged; no browser review was performed because no UI changed.

In the final local run, four parent timer ticks occurred during busy worker code;
cancellation settled in **0.128 ms**, worker termination/disposal took **2.579 ms**,
and a **250 ms** deadline returned in **251.154 ms**. A deterministic checkpoint
occupied **704 bytes**. These observations include this machine's scheduling and
do not promise browser frame rate or hard real-time latency. The runtime uses one
disposable worker per job; workers are trusted execution, not an OS sandbox.

F05 now supplies browser rendering through a local Node runtime host. Worker
pooling, agent sessions and portable archives remain unimplemented. F07 now supplies
the shared command gateway. See
the [runtime guide](computation-runtime.md) and [F04 handoff](handoffs/F04.md) for
actual signatures, time/checkpoint semantics, limits and integration requirements.

## F03 extension registry — 2026-11-03

Implemented `src/registry/` on F01/F02 with model, operator, asset-factory and
view-adapter registration. Manifests declare parameter schemas/defaults, scientific
ports, exact versions/builds, dependencies, capabilities, documentation, guards,
provenance and review metadata. The composition root explicitly injects trusted
installed code; ordinary project data cannot install or execute extensions.
Discovery exposes those contracts and reference-test reports through one API.

The [public example](../examples/extension-registry.mjs) registers all four kinds,
runs **8 reference cases**, evaluates a moving point and signed arithmetic, and
produces schema-checked geometry/view data. Marker-scale changes preserve the
scientific position. Missing or incompatible extensions remain inspectable and
prevent acceptance; passing tests never promote a declared model to reviewed.

**167 automated tests passed** using bundled Node **24.22.1** and
`bash scripts/node.sh --test`: all 121 prior tests plus 46 F03 tests. An isolated
process runs copied core/dataflow/registry modules and all four generic extension
kinds without astronomy files. Tests cover dependency/build failures, bad ports,
inert source text, applicability failures, stale results, asynchronous callback
rejection, artifact limits and failed reference expectations. Example assertions,
syntax checks, import-boundary checks and `git diff --check` passed. The approved
logo, BSD-3-Clause license, dependencies and existing astronomy/UI are unchanged.

F04 now supplies worker computation and a stateful lifecycle above the registry.
Direct registry callbacks remain trusted synchronous code. Visual artifacts are data;
F05 supplies browser rendering and resource disposal; F07 supplies the command gateway.
The agent session and portable package remain planned. See the [registry guide](extension-registry.md)
and [F03 handoff](handoffs/F03.md) for interfaces, evidence and boundaries.

## F02 scientific dataflow — 2026-11-03

Implemented `src/dataflow/` over the F01 graph: scientific scalar/vector,
collection, field and series Values; explicit units, meanings, references, frames,
normalization and coordinates; checked input/output ports; real injected adapters;
constants, arithmetic, selections, mapping/reduction and bounded synchronous
evaluation. Results retain project/load/revision and implementation identity,
physical time, warnings and sampling metadata. Fixed and live membership have
different declared semantics, and live dependency cycles are checked.

The [public example](../examples/scientific-dataflow.mjs) verifies equivalent
meter/kilometer trajectories, a rigid frame transformation, scalar/vector fields,
fixed/live means, camera independence and sample/warning round trips. Scientific
conflicts, zero division, missing data, unavailable adapters, stale results and
misaligned samples produce diagnostics. Explicit linear time interpolation never
extrapolates or zero-fills. Ordinary relationships can still contain cycles.

**121 automated tests passed** using bundled Node **24.22.1** and
`bash scripts/node.sh --test`: all 71 prior tests plus 50 F02 tests. An isolated
process runs copied core/dataflow modules with locally injected fixtures and no
domain files. Syntax checks, example assertions, import-boundary checks and
`git diff --check` passed. Existing astronomy code, logo, package dependencies and
BSD-3-Clause license are unchanged; no UI changed or browser review was added.

Review added regressions for timeless collections, explicit collection references,
normalization preservation in both scalar-multiplication orders, mismatched
physical timestamps, and repeated reductions consuming cached data under a work
budget. Generic fixture success does not establish astronomical validity.

F03 now supplies manifest/registry/discovery using the actual contracts in the
[dataflow guide](scientific-dataflow.md) and [F02 handoff](handoffs/F02.md). F04 adds
worker scheduling and stateful execution; F05 supplies a generic browser viewer.
F07 supplies the command gateway; agent sessions and portable packages remain unimplemented. Direct synchronous
callbacks are not sandboxed or preempted by the graph work counter. The old
UI/CLI/HTTP demo remains separate.

## F01 composition kernel — 2026-11-03

Implemented a generic graph in `src/core/`, independently of the existing demo.
It provides stable IDs and handles, typed relationship instances, explicit
references, separate computational dependencies, calculation/presentation
definitions, staged drafts, atomic operation batches, non-mutating previews,
rejected referenced deletions and explicit cascades. Injected synchronous hooks
validate real point/label fixtures. Acceptance, load, and history restoration
use the same authoritative validation.

Mutation tokens carry project identity, runtime/load generation and revision.
Undo/redo restores content while advancing revision; a new accepted edit discards
the redo branch. Loading validates first, rotates generation and clears history.
The [public example](../examples/composition-kernel.mjs) constructs three labeled
points and a relationship ring with helper functions and loops.

**71 automated tests passed** on bundled Node **24.22.1** with
`bash scripts/node.sh --test`: the 38 previous regressions plus 33 F01 tests.
The new suite checks rollback, stale tokens, staged completion, cycle-safe
inspection/removal, history, immutable data and hooks, inert source text, and
import boundaries. An isolated subprocess constructs and round-trips a labeled
point with only copied core files and a local fixture validator present; no
astronomy modules are available in that test directory. The example, syntax
checks, and `git diff --check` passed. There were no UI changes or new browser
verification in F01.

The generic kernel is not yet connected to the v0.2 UI, CLI or HTTP API. It has no
scientific evaluator, registry, renderer, command gateway, provider adapter,
authored timeline, or portable package implementation within F01. F02 now supplies
the separate scientific-dataflow layer described above. See the
[kernel guide](composition-kernel.md) and [F01 handoff](handoffs/F01.md).

The sections below retain the earlier prototype's implementation and verification
record; they do not describe generic infrastructure as complete.

## Architecture correction

The first prototype bundled a complete star–planet pair and exposed parameter
controls and JSON replacement. That was too coarse for the requested
programmatic construction of physical scenes.

The active implementation now exposes body, orbit, observer, measurement, and
annotation handles through a public `World` SDK. An author can add/remove
components and revise their connections. JSON stores and transports the resulting
graph. This correction is documented in [architecture.md](architecture.md).

The former dashboard, v0.1 schema, and circular two-body/RV model are removed from
the active design. Git tag `prototype-v0.1` preserves that implementation. v0.2
uses `.local/world-v2.json`; old saved scenes are not treated as v0.2 worlds.

## Implemented

- Public JavaScript SDK with stable handles, graph reconstruction, semantic edits,
  shared-time evaluation, sampling, and scene serialization.
- Multiple independent planets around one fixed star, with separate eccentricity,
  inclination, node, periapsis orientation, phase, and epoch.
- Explicit eccentricity-edit semantics: preserve semimajor axis or periapsis.
- Physical observers separate from the illustrative camera; combined or selected
  transit photometers attach to the same world.
- Analytic boundary integration of foreground silhouettes clipped to the star,
  including projected overlap without double-counting.
- Atomic semantic-operation batches, reference/dependency checks, rejected
  unsupported operations, optional revision checks, and accepted-state retention
  after failure.
- Local server, CLI, tool discovery, live agent updates, persistence, and macOS
  launcher. Author scripts run locally in the author process, not on the server.
- An immersive projected orbital stage with camera rotation/zoom, object selection
  and following, orbit visibility, physical-time playback, annotation cues,
  observer close-up, composite flux curve, and source/graph/tool inspection.
- Authored SDK examples and two separate agent-authored challenge recipes.

No embedded LLM, MCP adapter, public hosting, account system, generated narration,
or finished video export is implemented.

## Scientific model and its limits

The numerical core uses the independent Kepler approximation around a fixed
primary. Planetary masses are neglected in orbital motion; their sum must not
exceed 1% of the host mass. This bound is a declared model guard, not a general
accuracy bound or long-term stability guarantee. Close encounters, resonances,
and long evolution can invalidate the approximation even below it.

There is no planet–planet gravity, collision response, reflex stellar motion, or
RV observable. All periods derive from a and the host gravity parameter. Editing
parameters constructs a new configuration; it is not a physical impulse.

The stellar disk is uniform and planets are dark opaque disks in projection.
Composite flux comes from the clipped union of foreground silhouettes. Projected
overlap does not imply physical contact. Limb darkening, planetary light,
atmospheres, stellar variability, detector noise, finite exposure, and light-time
effects remain outside scope.

See [physics.md](physics.md) for equations, conventions, numerical methods,
references, and the verification design. Tests and validation are conditional on
that declared model; they do not prove arbitrary scientific composition.

## Authoring checks completed

Two agents constructed new scenarios through the documented SDK and discoverable
tools, without modifying numerical or rendering implementations during their
challenges. Both recipe dry-runs returned `valid: true` and their numerical/
structural assertions passed.

| Exercise | Structural construction | Numerical result |
| --- | --- | --- |
| [A: shared shadows](../experiments/agent-a-report.md) | Three independently specified planet/orbit pairs; photometers created before planets; selective and combined measurements; second observer; copied-world cascading removal | At the chosen instant, summing separate transit deficits overestimated the loss by 2,865.263 ppm of unobscured stellar flux, or 13.341742% of the actual combined loss. The union photometer counted the shared area once. |
| [B: eccentricity choices](../experiments/agent-b-report.md) | Four separate orbital planes/phases; handle reacquisition and edits; fifth probe add/remove; observer replacement; measurement rewiring | At fixed a, the period stayed 8.264820151 days. At fixed q = 0.072 AU, a doubled to 0.16 AU and period increased by 2√2 to 23.376441497 days. |

These are limited authoring-feasibility exercises. They are **not independent
validation by two model families**, formal model certification, or evidence of
student learning. Author B previously worked on the viewer, so that exercise is
not a blind novice usability test. Each report records its public-interface
boundary and limitations. Neither challenge author published to the shared server
as part of its exercise.

## Integrated verification

All **38 automated tests pass** on Node 24.22.1 using `node --test`. They cover
Kepler conservation/reference cases, independent numerical checks of shadow
union area, graph/SDK coupling, eccentricity constraints, the two author recipes,
atomic structural transactions, revision conflicts, and real CLI publication.
Syntax checks and `git diff --check` also passed.

Review found and fixed a plot-grid defect: a short transit could fall entirely
between uniform samples. Event-guided refinement now recovers the tested case;
long-window budget limits and unresolved detail are disclosed in sampling
metadata and the viewer. Regression checks cover narrow and eccentric events,
bounded cost, and exact instantaneous measurements. Zero-radius transit counts
and selective-photometer labeling were also corrected.

The integration pass published both challenge recipes through the external CLI
into the running viewer. The browser updated to three planets/six photometers,
then four planets/three photometers. A separate semantic transaction added a fifth
planet and its orbit; the existing combined photometer included it automatically.
A subsequent cascade removed that body and its orbit. These were local runtime
updates, with no renderer or numerical-core edits.

Browser checks covered the narrow layout and a 1360-pixel desktop layout, orbital
framing, selected-object details, camera interaction, observer and occultor-subset
switching, source/graph inspection, annotation cue jumps, playback progression,
and live external updates. Agent A's simultaneous-transit flux was 0.978524 in the
viewer; its tilted observer showed unity. The inspected session reported no
browser warning/error logs. These are sampled states and interactions, not a
complete review of every frame or possible composition.

The final browser pass used the revised sampler, checked loading a saved world
after restart and selecting the independent overlap lesson from the scene menu,
then restored the default world. Its review image is saved locally at
`.local/v2-agent-overlap.jpg` (ignored by Git). Temporary preview processes were
stopped after inspection; launch the demo again with the macOS launcher or the
documented server command.

A successful dry-run or plausible static image does not establish a correct
animation. Full motion review, formal accessibility, multiple-browser testing,
classroom use, and learning evaluation remain unperformed. There is no audio to
review and no rendered release asset.

## What the challenges exposed

1. **Derived representations.** Authors can calculate a naive sum of deficits or
   compare periods in their own process, but cannot yet register an arbitrary
   derived curve, period plot, or equation overlay through the public graph.
2. **Authored comparisons over time.** The saved world contains the final graph.
   Intermediate construction snapshots and before/after comparisons remain in
   the recipe and audit. Annotation cues are not a full explanation timeline.
3. **Presentation composition.** Multiple photometers exist in the graph, but the
   viewer selects one at a time. Simultaneous linked views need a presentation
   abstraction beyond the current fixed HUD.
4. **New model packs.** This vocabulary supports one physical domain. Extending it
   requires explicit interfaces, coupling rules, assumptions, and reference
   cases; neither a larger asset catalog nor free-form prompting supplies them.

The shared [infrastructure roadmap](infrastructure-roadmap.md) now governs this
work: implement generic scientific values and arithmetic in F02, prove the full
domain-independent workflow in F11, then migrate the exoplanet comparisons in
F12. The earlier model-specific exercise remains a regression target.

## Release and maintenance state

The repository remains local and unpublished, under the [BSD 3-Clause License](../LICENSE).
Contribution policy, hosting, packaging, broader accessibility, name clearance, and long-term
maintenance are unresolved. The source examples and contracts are inspectable,
but current work should still be treated as a prototype for review and revision.

## Naming and charter revision — 2026-11-02

The repository directory, package, launcher, runtime messages, saved-file name,
agent capability name, and current documentation now use **Cosmic Lego** or
`cosmic-lego`. The mark installed during this revision has since been replaced
by the approved brick-built galaxy; see [the branding notes](../assets/branding/README.md).
The README now centers astronomy applications and one schematic, with its
follow-up comprehension check recorded in [blueprint-review.md](blueprint-review.md).

All 38 existing tests passed after the rename. The logo was served successfully
as a PNG, the executable launcher was retained, and a browser inspection showed
the new name and logo without warning/error logs. The existing local demo was
restarted under the renamed directory; its physical scene and original authoring
source were retained. Session revision numbers and history restart with the
server. Review screenshots are saved locally as `.local/cosmic-lego-demo.jpg`
and `.local/cosmic-lego-readme.jpg` (ignored by Git). These checks concern the
rename and presentation; they add no new scientific validation or capabilities.

## Approved galaxy logo and license — 2026-11-02

The owner selected `assets/branding/cosmic-lego-galaxy.png` as the project logo.
The README, branding guide, viewer header, favicon, and server asset route now
use that exact PNG. The superseded image is retained only in Git history.
BSD-3-Clause is recorded in LICENSE, the README, and package metadata; references
document the astronomy-software precedent and the distinction from arXiv's
article licenses.

All 38 existing tests passed. Browser inspection confirmed the selected logo in
the viewer and README, the rendered license section, and no warning/error logs.
The image route returned HTTP 200 with `image/png`. The running demo was restarted
with its physical scene and authoring source preserved. Current review images
are `.local/galaxy-adoption-demo.jpg` and `.local/galaxy-adoption-readme.jpg`
(ignored by Git); earlier screenshots above document earlier branding.
