# AstroCompose

**Composable astrophysics visualizations for exploration and explanation.**

Build a model. Connect observers. See the signal.

AstroCompose is an experimental toolkit for assembling scientific explanations
from explicit physical models, measurements, and views. Its first domain is
**exoplanet detection**: an orbit, a transit light curve, and stellar radial velocity
all derive from one circular two-body model and one physical clock.

The prototype demonstrates a small composition language. A scene can contain
several independent systems, several observers, and any supported pairing of them.
The browser, command line, and local agent API share the same validation and physics.
There is no embedded LLM, API key, account, dependency installation, or network
service required for playback. Internet access is not needed once the repo and
Node.js are available.

**Status:** local research/authoring prototype, v0.1. Architecture is provisional.
This is an idealized model, not observational data or a complete detection pipeline.

## Try it

Requires **Node.js 20 or later** and a modern browser.

```sh
node scripts/serve.mjs
```

Open **http://127.0.0.1:4317**. Stop the server with Ctrl+C.
On macOS, double-click **Start AstroCompose.command** to start the local server and
open your browser. The launcher also recognizes the bundled Codex Node runtime
when Node is not on PATH; `ASTROCOMPOSE_NODE` can select an explicit executable.

The launcher resumes `.local/live-scene.json` if it exists. The plain server
command starts with the two-observer example; `--resume` restores saved edits.
To select an example or another port:

```sh
node scripts/serve.mjs --scene examples/planet-comparison.json --port 4318
```

### Three things to try

1. **One system, different viewpoints:** at phase zero, the edge-on observer sees
   a transit; the 80° observer misses it. Press Play or scrub phase.
2. **Compare mass and radius:** twice the radius produces four times the central
   transit depth in this uniform-star model. Twice the mass changes the stellar
   velocity. The paired charts use common vertical scales.
3. **Compose your own scene:** duplicate a system, add an observer, or connect a
   different system–observer pair. No physics or drawing code changes are needed.

The orbit overview uses schematic body sizes; the close-up uses physical radius
ratios. The display-size control cannot change a light curve or radial velocity.
Physical parameter edits create a new idealized configuration at the same time;
they do not represent an in-flight impulse or a conserving physical intervention.

Open **Scene specification** to inspect, edit, import, or download JSON. Unsupported
fields and invalid configurations are rejected while the last accepted scene remains
visible. Saved JSON contains configuration, not the current playhead position.

## Bring your own agent

Use any agent that can read local files and run commands, or call local HTTP tools:

```sh
node scripts/agent.mjs capabilities
node scripts/agent.mjs schema
node scripts/agent.mjs validate examples/viewing-angles.json
node scripts/agent.mjs evaluate examples/viewing-angles.json --time-days 0.75
node scripts/agent.mjs inspect
node scripts/agent.mjs apply examples/viewing-angles.json
```

The last two commands address a running local demo. Accepted changes appear in the
browser automatically. Scene JSON may also be read from stdin using `-` as the path.
For machines using the bundled runtime, replace `node` with `bash scripts/node.sh`.

A chat-only assistant can produce scene JSON for manual import. A remote agent
cannot reach your computer's loopback API without a separately configured bridge.
**MCP is not implemented yet.** This prototype establishes the underlying operations
that an MCP adapter could expose later.

See [the agent interface](docs/agent-interface.md) for commands, HTTP payloads,
structured errors, and an example instruction to give your agent.

## Scientific scope

- One spherical star and one opaque, dark planet per independent system.
- Newtonian circular two-body motion, including the stellar barycentric motion.
- Stellar disk has uniform brightness; transit flux uses analytic disk overlap.
- Distant observers with inclination 0° (face-on) through 90° (edge-on).
- Period and masses determine the orbit size; positive RV means receding.

No eccentricity, multiple interacting planets, limb darkening, stellar activity,
atmospheric transmission, instrumental noise, finite exposure, light-time effects,
or relativistic corrections are included. Independent mass/radius controls do not
enforce stellar or planetary structure. Bounds limit the supported demonstration
space; they are not a claim that all allowed configurations occur in nature.

Read [the physics contract](docs/physics.md) and [source references](docs/references.md).

## Why this implementation?

The first experiment keeps the physics independent of rendering and uses a local
browser interface. Manim remains a possible later export adapter. The LLM composes
declarative data through a checked interface; physical laws live in tested numerical
code rather than being enforced by prompting alone.

[Architecture decisions](docs/architecture.md) address Manim, component coupling,
agent constraints, delivery options, and future integrations. [Demo status](docs/demo-status.md)
records what has actually been checked and which decisions remain open.

```text
src/physics.js       pure physical model and observables
src/contract.js      machine-readable authoring capabilities and schema
src/scene.js         validation, references and scene evaluation
src/app.js           browser interaction and Canvas rendering
src/server.js        local HTTP transport
scene.schema.json   portable scene contract
scripts/agent.mjs    agent-facing command line
examples/           reusable scene compositions
test/               scientific, composition and transport checks
docs/               assumptions, references and decisions
```

## Check the prototype

```sh
node --test
```

Tests cover conservation, reference scales, transit limits, grazing geometry,
inclination and mass dependence, display/physics isolation, cross-references,
unsupported physics, CLI errors and HTTP state preservation. Tests are conditional
on the declared model; they do not prove general physical or pedagogical correctness.

## Collaboration and release

Useful next contributions begin with a concrete explanatory need, a reproducible
scene, and a reference case. Read [AGENTS.md](AGENTS.md) before changing behavior.
New physics should be a documented model extension with meaningful tests.

The repository is currently local and unpublished. No public license has been
selected; choose one before inviting public reuse/contributions. The package's
`private` flag prevents accidental npm publication and does not control Git hosting.
The name had no obvious exact software collision in a limited 2026-11-01 search;
this is not trademark or package-name clearance.
