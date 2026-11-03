# Implementation status — F01–F05 and v0.2 demo

Updated 2026-11-03. This is a rough local authoring experiment, not a release-ready
educational application.

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
server hosts Node workers and a narrow checked demo edit API; it is not F07.

Next is **F06 planetarium shell**. Floating-window layout, in-app agent sessions,
the command gateway, portable archives, timelines/export and domain migration
remain planned. See [F05 handoff](handoffs/F05.md) for interfaces and limits.

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
pooling, command gateway, agent sessions and portable archives remain unimplemented. See
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
F05 now supplies browser rendering and resource disposal. The command gateway, agent session
and portable package remain planned. See the [registry guide](extension-registry.md)
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
The command gateway, agent session and portable package remain unimplemented. Direct synchronous
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
