# Demo status — v0.2

Updated 2026-11-02. This is a rough local authoring experiment, not a release-ready
educational application.

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

A useful next experiment is to express the agent-A arithmetic comparison as a
reusable derived measurement/view, then render both its interactive form and a
short deterministic explanation. That directly tests the broader Manim-like
ambition before adding another large physical topic.

## Release and maintenance state

The repository remains local and unpublished. Public license/contribution policy,
hosting, packaging, broader accessibility, name clearance, and long-term
maintenance are unresolved. The source examples and contracts are inspectable,
but current work should still be treated as a prototype for review and revision.
