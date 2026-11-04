# Get started with Cosmic Lego

## Open the astronomy roadmap

From the repository root, install the pinned dependencies once and launch the local application with Node.js 20 or later.

```sh
pnpm install --frozen-lockfile --ignore-scripts
bash scripts/node.sh apps/exoplanet.mjs
```

Open the printed address. The usual port is 4317. On macOS, double-click **Start Cosmic Lego.command** to reuse a running roadmap or launch one on an available port. `npm start` launches the same product. [Open on the default port](http://127.0.0.1:4317/)

The map opens in **3D cluster** with all domains in view. Drag to orbit, Shift-drag to pan, or use two fingers to pan and zoom. Follow a dashed line to explore the diagram two topics share. Switch to **2D overview** for a flat map you can pan and zoom. **Fit** resets the current view. Type a topic name to light up its star. Other stars stay visible in the background. Switch to **Table** for a sorted list of matches. Filters and selection carry across views.

Choose a topic group to see the phenomena or techniques inside it. To explore how astronomers work, choose **Observation** or **Simulations** under **Field**, or search for a technique such as *interferometry* or *MHD*. A technique leads to questions it can help answer. From a phenomenon, **How can we study this?** takes you back to those methods when a connection is mapped. Follow a line to see how the same diagram can help explain both topics. **Available now** finds implemented studies. Under **Exoplanets → Planetary transits**, the study link opens a dedicated player with playback and scrubbing controls. Select **Roadmap** to return to that phenomenon. Planned studies already have short explanatory entries on the map. Larger stars mark ideas that help explain more of the map. Open **Why this star is this size** for specific examples. [Learning paths and ranking](atlas-sources.md)

## Open the editing workspace

Choose **Open workspace** in the header. This opens the editable current project. Click the Cosmic Lego brand to return to the roadmap. [Direct workspace link](http://127.0.0.1:4317/workspace/)

**When shadows overlap** puts three independently orbiting planets around a uniformly bright star. At physical time **0 s**, the two foreground disks overlap and the third planet is behind the star. The correct light curve reads **0.979302**. The deliberately naive sum of depths gives **0.972544**. Drag the stage to examine depth, then use **Reset** to restore the physical observer’s sky view. Open **Views** to inspect the comparison curve. The timeline holds the conjunction between presentation seconds 3 and 5. [Build or modify this study](exoplanet-authoring.md)

**Project → Save locally** creates a named slot. The default astronomy store is `.local/exoplanet-projects/`. Resume a named save with `bash scripts/node.sh apps/exoplanet.mjs --open SLOT`, replacing `SLOT` with its displayed name. **Download** produces an F09 JSON file for import or delivery. The camera, instrument rail, timeline and physical clock work locally without an agent. To connect a compatible Codex installation, start the same application with `--codex /absolute/path/to/codex --agent-workspace /absolute/path/to/separate-workspace` and use **Connect** in Conversation. [Project files](portable-projects.md) · [Session setup](in-app-agent-sessions.md)

## Try the independent timing gate

Start the workspace using `bash scripts/node.sh scripts/scene-server.mjs --workspace --port 0`. Open its Project menu and import the [four-puck save](evidence/readiness-saved.json). Seek the timeline to 1.5 s to see the mean distance at the gate. The [F11 exercise](domain-independent-readiness.md) includes the three-puck recipe and commands for an isolated launch and frame export.

## Compose without an astronomy package

F01 supplies a separate domain-independent authoring API in `src/core/index.js`.
It accepts empty projects, points and labels, staged connections, atomic edits,
non-mutating previews, and undo/redo. Run its public example in your own authoring
process:

```sh
bash scripts/node.sh examples/composition-kernel.mjs
bash scripts/node.sh --test test/composition.test.js
```

Read [the composition-kernel guide](composition-kernel.md) for the graph schema,
handle/command APIs, identity tokens, injected validators, and deletion rules.
The example prints checked graph/history results; it does not render a scene.
The default astronomy application uses this same graph with its optional exoplanet registry. Existing v0.2 `World` programs have a separate compatibility and import path, described below.

F02 adds scientific values, explicit input/output ports, arithmetic, field
selection, per-object mapping/reduction, fixed/live membership, and synchronous
evaluation tagged with project identity. Run its checked example:

```sh
bash scripts/node.sh examples/scientific-dataflow.mjs
bash scripts/node.sh --test test/dataflow.test.js test/values.test.js
```

The [scientific-dataflow guide](scientific-dataflow.md) documents units, frames,
normalization, physical time, coordinate alignment, calculation handles, trusted
fixture injection and result diagnostics. F04 supplies worker scheduling and
F05 maps these scientific results into a generic 3D scene.

F03 adds trusted extension registration, data-only discovery, exact version/build
requirements, declared parameter/port contracts, and a reference-case harness:

```sh
bash scripts/node.sh examples/extension-registry.mjs
bash scripts/node.sh --test test/registry-contracts.test.js test/registry.test.js
```

The [extension-registry guide](extension-registry.md) separates the developer
registration workflow from ordinary authoring with installed definitions. The
example runs four real extensions and produces checked geometry/view data.
The F05 example below uses registered scene formats and a browser renderer.

F04 runs analytic and stateful scientific jobs in disposable Node workers, with
progress, cancellation, deadlines, checked checkpoint/resume and reset/replay for
backward seeks:

```sh
bash scripts/node.sh examples/computation-runtime.mjs
bash scripts/node.sh --test test/runtime.test.js test/runtime-registry.test.js test/runtime-edge.test.js
```

The [runtime guide](computation-runtime.md) documents trusted worker setup,
lifecycle callbacks, numerical settings, requested/achieved physical times,
checkpoint identity and resource limits. The example compares analytic and
stepped accumulators and resumes a seeded generator from its full state.
These software fixtures exercise the same worker scheduling used by the astronomy workspace. Its optional registry supplies the orbital and photometric models.

## Open the generic scene laboratory

F05 supplies authorable groups, cameras, geometry, materials, local textures,
instanced points, polylines, arrows, labels, and explicit scientific bindings.
Its [public recipe](../examples/scene-and-assets.mjs) assembles moving-point
collections and static scalar/vector fields without an astronomy package.

Use **Node.js 20 or later**, pnpm, and a **WebGL2-capable browser**. Install the
pinned Three.js dependency, run the checked recipe, then start the local stage:

```sh
pnpm install --frozen-lockfile --ignore-scripts
node examples/scene-and-assets.mjs
node scripts/scene-server.mjs --port 4325
```

Open **http://127.0.0.1:4325**. Left drag orbits the presentation camera, right drag
pans, and the wheel zooms. Click an object to select its stable scene/source ID.
The fixture stage supports perspective/orthographic views, physical-time sampling,
and checked instance/appearance edits. Stop the server with Ctrl+C. On the original
workstation, `bash scripts/node.sh` can replace `node` and find the bundled runtime;
`COSMIC_LEGO_NODE` selects an explicit executable.

Scientific evaluation runs in the Node host's F04 workers. The browser consumes
checked snapshots; its render loop and camera motion do not advance physics.
Dependencies are served locally after installation. See the [scene guide](scene-and-assets.md)
for authoring, units/frame/color mappings, asset provenance and renderer APIs, and
the [F05 handoff](handoffs/F05.md) for checks and limitations.

This is the generic fixture host. Its workspace mode below reuses the scene and
runtime with floating views. Both modes now use the F07 command gateway;
the optional [F08 companion](in-app-agent-sessions.md) connects in-app agent sessions.

## Open the astronomy-free planetarium workspace

The same fixed HUD also opens with the generic fixture registry. With dependencies installed as above:

```sh
node examples/workspace.mjs
node scripts/scene-server.mjs --workspace --port 4326
```

Open [the generic workspace](http://127.0.0.1:4326/workspace/). **Instruments**
opens the plots on the left. **Inspection** opens the inspector, model notes and
conversation on the right. Scroll a side, fold individual panels or restore
hidden ones through **Views**. Press **V** for scene-only mode, **F** to fit,
and **Escape** to return to the stage. Views can add independently bound plots,
and project edits have Undo and Redo.

The collection plot and inspector use current physical-time samples and stable
source IDs. Restore the initially hidden mean-position-magnitude plot to inspect
a real F02 mapping/reduction. These are current-sample plots, not accumulated time
series. The composer preserves drafts while hidden and honestly reports no agent
connection. Read [the workspace guide](planetarium-shell.md) for public handles,
host/browser APIs and the session boundary, and [the F06 handoff](handoffs/F06.md)
for browser evidence and limitations.

To keep your work, open **Project**, enter a local name and save. **Open** restores
the saved construction and playhead. **Download** writes portable JSON and
**Import** opens it in another companion with compatible installed extensions.
Public conversation is opt-in for each save or download. Run the fixture round trip
with `node examples/portable-project.mjs`. See the [project-file guide](portable-projects.md)
for storage, conflict recovery and replay limits.

## Play and deliver an authored timeline

Build the eight-second generic comparison from the repository root. The example
creates a new named file and protects an existing file of the same name.

```sh
bash scripts/node.sh examples/authored-timeline.mjs --directory "$PWD/.local/projects"
bash scripts/node.sh scripts/timeline-server.mjs --project .local/projects/motion-study.json --port 4327
```

Open the printed player URL and seek to 3.5 s and 4 s. Both frames request
physical time 4 s. The second selects the alternate velocities and updates the
mean-distance readout. You can also open the named file in the workspace and
launch its timeline through **Project**. The [guide](authored-timelines.md) gives
the frame export and player packaging commands, limits and file formats.

## Construct through the shared gateway

The data-only SDK, CLI and HTTP host share registered discovery, validation,
atomic edits, evaluation and Undo/Redo. Try the discovery-driven public recipe:

```sh
bash scripts/node.sh examples/command-gateway.mjs
# With the workspace server running:
bash scripts/node.sh scripts/gateway.mjs discover
bash scripts/node.sh scripts/gateway.mjs inspect
bash scripts/node.sh scripts/gateway.mjs request operation.json
```

The [gateway guide](command-gateway.md) supplies a request example, handle recipes,
identity/retry semantics, structured repairs and F08 host lifecycle hooks.
Every write requires the full token returned by inspection and a unique key for
that logical edit. Preview is optional. The workspace refreshes accepted external
changes automatically and offers Undo. The JSON CLI does not execute source files.

## Load a v0.2 World or source recipe

For a saved legacy file, use the explicit importer. It reports field-specific migration decisions and writes to a new destination.

```sh
bash scripts/node.sh scripts/exoplanet-project.mjs import old-world.json /tmp/imported-world.json
```

Import the new file through **Project** in the astronomy workspace. A legacy `World` recipe can still use bodies, orbits, observers, measurements, `world.at(timeDays)`, and `world.sample()`. To carry its exact source text into the portable file, assemble the recipe in your authoring process and call `importLegacy({scene: world.build(), source: originalText})`. The importer preserves the original separately from the migrated construction. [Compatibility SDK](agent-interface.md) · [Supported fields and known differences](exoplanet-authoring.md#import-a-v02-world)

The compatibility launcher opens the shared application. `--resume` imports the previous `.local/world-v2.json` when present. `--example` selects one of the shipped v0.2 recipes and includes its author source. Both leave the original input on disk. On macOS, **Start Cosmic Lego.command** enters through the resume path.

```sh
bash scripts/node.sh scripts/serve.mjs --resume
bash scripts/node.sh scripts/serve.mjs --example tilted-orbits --port 4318
```

## Verify a local checkout

```sh
bash scripts/node.sh --test
```

The star is fixed and the planet masses serve as metadata for a 1% total planet-to-star mass guard. Each period derives from the stellar GM and semimajor axis. The model omits mutual perturbations, stellar reflex motion, limb darkening, and finite exposures. The physics guide gives the equations, independent checks and references. [Physics contract](physics.md) · [Scientific references](references.md)

The generic timing gate and the astronomy study exercise different parts of the implementation. Their tests cover software behavior and specified physical limits. Learner outcomes require separate evidence. [Generic readiness](domain-independent-readiness.md) · [Architecture](architecture.md) · [Current verification record](demo-status.md)
