# AstroCompose

**Agent-built worlds for astrophysical explanation.**

AstroCompose is a rough authoring toolkit for constructing physical scenes from
reusable objects and relationships. Its first model pack lets an author create a
star, add planets with independent elliptical orbits, place observers, and connect
those observers to composite transit measurements.

The primary authoring interface is a JavaScript SDK with stable handles. An agent
can add a planet, attach its orbit, rewire a measurement, or remove a component
without changing the engine. The browser presents the resulting world, its
measurements, and its source. JSON is the saved graph and transport format.

**Status: v0.2, local research prototype.** The implementation covers one bounded
physical domain. It is not a general astronomy simulator or a validated teaching
product. No embedded LLM, API key, account, package installation, or internet
connection is required for playback once Node.js is available.

## Open the demo

Requires **Node.js 20 or later** and a modern browser:

```sh
node scripts/serve.mjs
```

Open **http://127.0.0.1:4317**. On macOS, double-click
**Start AstroCompose.command** instead. The launcher can use the bundled Codex
Node runtime when Node is not on PATH; `ASTROCOMPOSE_NODE` selects an explicit
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

Read [the agent interface](docs/agent-interface.md) for exact handle methods,
operations, payloads, and errors. Remote chat-only clients cannot directly reach
your loopback server. **MCP is not implemented**; an adapter could wrap the same
operations later.

## What the author challenges demonstrate

Two separate agents used the public SDK to construct unanticipated cases without
editing the engine:

- [Overlapping shadows](experiments/agent-a-report.md): three planets, selective
  and combined photometers, a second observer, and cascading removal. Adding
  individual transit deficits overcounted the shared shadow; union photometry
  handled it once.
- [Eccentricity and preserved distances](experiments/agent-b-report.md): four
  independently oriented planets, temporary-object removal, and observer/
  measurement rewiring. Fixed-a eccentricity kept the period at 8.264820151 days;
  fixed-q eccentricity doubled a and multiplied the period by 2√2.

These exercises demonstrate specific structural compositions through the public
interface. They are not two-model scientific validation, a novice-user study, or
evidence of learning gains. Their numerical assertions and dry-runs passed; see
[demo status](docs/demo-status.md) for the broader verification record.

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

Read [the physics contract](docs/physics.md), [architecture decisions](docs/architecture.md),
and [source references](docs/references.md). Validation enforces the declared
contract; it does not establish general scientific validity.

## Development and next steps

```sh
node --test
# Or on the original workstation:
bash scripts/node.sh --test
```

The numerical, composition, SDK, and transport checks are separate from visual and
pedagogical review. The current viewer is intentionally limited: custom derived
plots/equation overlays, saved authoring snapshots, richer explanation timelines,
and deterministic video export remain open work. New model packs need their own
physical contracts and verification; more presets alone do not supply that
capability.

```text
src/sdk.js          public World and semantic handles
src/contract.js     discoverable tools and structural rules
src/scene.js        composition, operations and shared evaluation
src/physics.js      Kepler motion and composite shadow geometry
src/app.js          interactive presentation
src/server.js       local HTTP transport
examples/          authored SDK worlds
experiments/       independent author recipes and reports
docs/              contracts, decisions and verification record
```

The previous parameter dashboard, v0.1 JSON schema, and circular two-body/RV model
were replaced. The old prototype is preserved at Git tag **`prototype-v0.1`**;
its scenes are not the active v0.2 contract. The new persistence path keeps the
old saved state separate.

This repository is local and unpublished. A public license, contribution policy,
and release/distribution plan remain undecided. See [AGENTS.md](AGENTS.md) before
changing behavior.
