# Authoring guide

This guide describes the implemented F01–F05 foundation and the existing astronomy
prototype. The enduring purpose and design commitments are defined in
[the project charter](../README.md). Run commands
from the repository root.

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
The astronomy browser and its HTTP/CLI below still use the earlier exoplanet `World` API.
Their migration belongs to F12, after the generic infrastructure is ready.

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
These are software fixtures, not physical models. The F05 scene host uses this
runtime; the existing astronomy demo remains on its earlier evaluation path.

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

This is the F05 fixture host. F06 is next for the full application shell and
movable, foldable windows; F07/F08 will add the shared command gateway and in-app
agent sessions. The scene host's limited edit endpoints do not supply those APIs.

## Open the existing astronomy demo

Requires **Node.js 20 or later** and a modern browser:

```sh
node scripts/serve.mjs
```

Open **http://127.0.0.1:4317**. On macOS, double-click
**Start Cosmic Lego.command** instead. The launcher can use the bundled Codex
Node runtime when Node is not on PATH; `COSMIC_LEGO_NODE` selects an explicit
executable. In commands below, `bash scripts/node.sh` can replace `node`.

The plain server starts the `cosmic-clockwork` world. The macOS launcher resumes
`.local/world-v2.json` when available. To resume or select another starting world:

```sh
node scripts/serve.mjs --resume
node scripts/serve.mjs --example tilted-orbits --port 4318
```

Use the scene menu to explore authored worlds. Drag the stage to rotate the
presentation camera, scroll to zoom, click an object to inspect its handle, and
play or scrub physical time. Switch observer feeds to inspect different
measurements of the same world. **Scene & agent** exposes the source, object graph,
and available agent tools. After graph edits or resuming saved state, the source
may be an equivalent generated SDK program rather than the original recipe.

Body markers are enlarged in the orbital stage. Orbital distances remain linear,
and the observer close-up uses physical radius ratios. Rotating the camera cannot
change a measured transit.

## Construct a world

Save a recipe such as `experiments/my-world.mjs`:

```js
import { World } from '../src/sdk.js';

const world = new World({ title: 'A world assembled from handles' });
const sun = world.star({ id: 'sun', name: 'Host star' });

// Measurements can be connected before their orbiting planets exist.
for (const [id, direction] of [
  ['earthward', [0, 0, 1]],
  ['displaced', [0.1, 0.1, 1]],
]) {
  const observer = world.observer({ id, direction });
  world.transits(sun, observer, { id: `${id}-flux` });
}

for (const [index, a] of [0.04, 0.07, 0.11].entries()) {
  const planet = world.planet({
    id: `planet-${index}`, name: `Planet ${index + 1}`,
    massJupiter: 0.1, radiusJupiter: 0.8,
  });
  planet.orbit(sun, {
    id: `orbit-${index}`, semiMajorAxisAU: a,
    eccentricity: 0.1 * index,
    inclinationDeg: 90 - 3 * index,
    longitudeAscendingNodeDeg: 20 * index,
    meanAnomalyDegAtEpoch: 35 * index,
  });
}

// State which quantity the edit preserves.
world.get('orbit-0').eccentricity(0.6, { hold: 'semimajorAxis' });
world.get('orbit-1').eccentricity(0.55, { hold: 'periapsis' });
world.present({ startDays: -0.1, durationDays: 20, playbackSeconds: 80 });
export default world;
```

Validate the recipe, then apply it to the running local viewer:

```sh
node scripts/agent.mjs run experiments/my-world.mjs --dry-run
node scripts/agent.mjs run experiments/my-world.mjs
```

A recipe executes in your local authoring process. The web server receives the
validated graph and displays the source as text; it does not execute submitted
JavaScript. Accepted changes appear in the browser automatically.

Orbit period follows the semimajor axis and stellar mass. Raising eccentricity at
**fixed semimajor axis** preserves the period. At **fixed periapsis**, it changes
the semimajor axis and hence the period. The API requires this choice explicitly.
Structural edits create new configurations; they are not physical impulses.

## Connect your own agent

The SDK, CLI, and local HTTP semantic tools expose the same model constraints:

```sh
node scripts/agent.mjs tools
node scripts/agent.mjs inspect
node scripts/agent.mjs evaluate --time-days 0
node scripts/agent.mjs transact operations.json --base-revision 2
```

Tools support body creation, orbit attachment, observer creation, measurement
rewiring, explicit eccentricity edits, removal with dependency checks, and
annotations. Operation batches validate and commit atomically. A failed operation
leaves the accepted world intact; optional revision checks prevent stale edits.

Read [the agent interface](agent-interface.md) for exact handle methods,
operations, payloads, and errors. Remote chat-only clients cannot directly reach
your loopback server. **MCP is not implemented**; an adapter could wrap the same
operations later.

## What the author challenges demonstrate

Two separate agents used the public SDK to construct unanticipated cases without
editing the engine:

- [Overlapping shadows](../experiments/agent-a-report.md): three planets, selective
  and combined photometers, a second observer, and cascading removal. Adding
  individual transit deficits overcounted the shared shadow; union photometry
  handled it once.
- [Eccentricity and preserved distances](../experiments/agent-b-report.md): four
  independently oriented planets, temporary-object removal, and observer/
  measurement rewiring. Fixed-a eccentricity kept the period at 8.264820151 days;
  fixed-q eccentricity doubled a and multiplied the period by 2√2.

These exercises demonstrate specific structural compositions through the public
interface. They are not two-model scientific validation, a novice-user study, or
evidence of learning gains. Their numerical assertions and dry-runs passed; see
[demo status](demo-status.md) for the broader verification record.

## Physical scope

The active model is a **fixed star with independent Keplerian planets**. Each
planet has its own semimajor axis, eccentricity, orbital plane, periapsis
orientation, and phase. All share a physical clock. Planet masses are metadata
and do not affect trajectories in this approximation.

The total planetary mass must be at most **1% of the host mass**. This is a model
guard, not an error bound or a stability guarantee. The model has no mutual
planetary gravity, collisions, resonant dynamics, stellar reflex motion, or
radial-velocity observable.

Transit flux is the unblocked fraction of a uniformly bright stellar disk.
Foreground planet silhouettes are combined through an analytic boundary integral
for their clipped union, so overlapping silhouettes are not double-counted.
Floating-point calculations still require numerical checks. Limb darkening,
stellar activity, planetary light, atmospheres, finite exposure, and measurement
noise are absent.

Read [the physics contract](physics.md), [architecture decisions](architecture.md),
and [source references](references.md). Validation enforces the declared
contract; it does not establish general scientific validity.

## Development and next steps

```sh
node --test
# Or on the original workstation:
bash scripts/node.sh --test
```

The numerical, composition, SDK, and transport checks are separate from visual and
pedagogical review. F01–F05 are implemented; F06 is the next application task.
Movable plots/equation overlays, portable project archives, authored timelines,
and deterministic video export remain open work. New model packs need their own
physical contracts and verification; more presets alone do not supply that
capability.

```text
src/core/          domain-independent graph, drafts, transactions and undo/redo
src/dataflow/      scientific values, ports, calculations and synchronous evaluation
src/registry/      manifests, trusted registration, pinned requirements and contract tests
src/runtime/       analytic/stateful workers, cancellation, checkpoints and budgets
src/scene/         generic scene/asset graph, scientific bindings and Three adapter
demo/scene/        generic fixture stage served by scripts/scene-server.mjs
src/sdk.js         existing astronomy World and semantic handles
src/contract.js    existing astronomy tools and structural rules
src/scene.js       existing astronomy composition and shared evaluation
src/physics.js     Kepler motion and composite shadow geometry
src/app.js         existing astronomy presentation
src/server.js      existing astronomy HTTP transport
examples/          generic foundation examples and authored astronomy worlds
experiments/       independent author recipes and reports
docs/              contracts, decisions and verification record
```

The previous parameter dashboard, v0.1 JSON schema, and circular two-body/RV model
were replaced. The old prototype is preserved at Git tag **`prototype-v0.1`**;
its scenes are not the active v0.2 contract. The new persistence path keeps the
old saved state separate.

This repository is local and unpublished, under the [BSD 3-Clause License](../LICENSE).
A contribution policy and release/distribution plan remain undecided.
See [AGENTS.md](../AGENTS.md) before changing behavior.
