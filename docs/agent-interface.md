# Agent construction interfaces

An agent can inspect the current project, add a registered orbit, wire a photometer, create a plot, and commit the complete construction in one checked transaction. The same gateway serves the local SDK, JSON CLI, HTTP host and native agent tools. The running workspace selects the installed vocabulary. [Command schemas, SDK, retries and errors](command-gateway.md)

## Discover the current workspace

Start the astronomy app in one terminal and inspect it from a second:

```sh
bash scripts/node.sh apps/exoplanet.mjs
# In the second terminal
bash scripts/node.sh scripts/gateway.mjs discover --url http://127.0.0.1:4317
bash scripts/node.sh scripts/gateway.mjs inspect transit --url http://127.0.0.1:4317
```

The astronomy registry exposes `exoplanet.primary`, `exoplanet.orbit`, `exoplanet.observer`, `exoplanet.projection`, `exoplanet.photometry` and `exoplanet.silhouette`, plus generic scene, overlay and dataflow operations. The worker and UI share the accepted project and implementation pins. At conjunction in the unmodified **When shadows overlap** project, `transit.flux` is the combined relative flux. `naive-flux.value` is the comparison built from individual depths. The package guide supplies a fourth-planet construction with predicted values for both. [Exoplanet authoring](exoplanet-authoring.md)

The separate generic host uses `bash scripts/node.sh scripts/scene-server.mjs --workspace --port 4326`. Use `scripts/gateway.mjs discover` against that port to inspect its fixture registry. A portable document declares requirements. It cannot install extensions or select worker code.

## Construct, inspect and replay

1. **Read the contracts.** `discover` returns command and port schemas. `inspect` returns accepted content, including the project ID, load generation and current revision. Use the F07 SDK for handles, selection, arithmetic, scene bindings and plots. Author scripts execute in their own local process. [Gateway](command-gateway.md) · [SDK example](../examples/command-gateway.mjs)
2. **Commit a coherent edit.** Every write carries the current full identity and an idempotency key. Optional preview checks the candidate. Acceptance validates graph references, scientific contracts, package coupling, bindings and resources before committing. Undo restores the previous content under a new revision. [Kernel](composition-kernel.md) · [Registry](extension-registry.md)
3. **Measure at an explicit physical time.** F04 workers return values, units, coordinates and implementation identity. The scene compiler and floating plots consume those results. The generic F02 sampler can build a time series from an analytic scalar source at declared physical coordinates. [Dataflow](scientific-dataflow.md) · [Worker runtime](computation-runtime.md) · [Visual bindings](scene-and-assets.md)
4. **Keep authoring and playback separate.** The F08 host scopes the native Codex tool to a turn. Stop and disconnect revoke that turn. F09 saves and the F10 player operate without an agent. Opening a project installs a new generation and opens any included public conversation as disconnected history. [Sessions](in-app-agent-sessions.md) · [Portable projects](portable-projects.md) · [Timelines](authored-timelines.md)

## Compatibility SDK for v0.2 World recipes

An agent can write an ordinary local `.mjs` script. For scripts in `examples/` or
`experiments/`, import `World` from `../src/sdk.js`. Export a World, or a function
returning one. Run `bash scripts/node.sh scripts/agent.mjs run path/to/recipe.mjs --dry-run` to validate and print its legacy scene in your authoring process.

```js
import { World } from '../src/sdk.js';

const world = new World({ title: 'A system I constructed' });
const sun = world.star({ id: 'sun', name: 'Host', massSolar: 1, radiusSolar: 1 });
const earthward = world.observer({ id: 'observer', direction: [0, 0, 1] });

// This is a live relationship: future orbiting planets also enter this measurement.
world.transits(sun, earthward, { id: 'flux', name: 'Combined starlight' });

for (const [index, a] of [0.04, 0.07, 0.1].entries()) {
  const planet = world.planet({ id: `p${index}`, name: `Planet ${index + 1}`,
    radiusJupiter: 0.8, massJupiter: 0.1 });
  planet.orbit(sun, { id: `orbit${index}`, semiMajorAxisAU: a,
    eccentricity: index * 0.15, inclinationDeg: 90 - index * 4 });
}

world.present({ startDays: -0.1, durationDays: 15, playbackSeconds: 80 });
world.annotate({ timeDays: 0, title: 'One star, several independent orbits',
  text: 'Every planet contributes its foreground silhouette to the same signal.' });
export default world;
```

### Handles

| Method | Meaning |
| --- | --- |
| `world.star({id?,name?,massSolar?,radiusSolar?,color?})` | Create the fixed stellar host; defaults 1 solar mass/radius |
| `world.planet({id?,name?,massJupiter?,radiusJupiter?,color?})` | Create a separate body; defaults zero mass metadata and one Jupiter radius |
| `planet.orbit(star,{id?,semiMajorAxisAU,...})` | Attach the body to a new orbit handle |
| `world.observer({id?,name?,direction?})` | Physical sightline from star toward observer; default +z |
| `world.transits(star,observer,{id?,name?,occulters?})` | Measurement handle; default `occulters:'orbiting'`, or explicit planet handles/ids |
| `handle.set(patch)` | Revise supported fields on body/orbit/observer/measurement |
| `orbit.eccentricity(e,{hold:'semimajorAxis'})` | Change e while preserving a, hence period |
| `orbit.eccentricity(e,{hold:'periapsis'})` | Preserve q=a(1−e); update a and derived period |
| `handle.remove({cascade:true})` | Explicitly remove dependencies too; omission rejects referenced removals |
| `world.get(id)` | Reacquire a body, orbit, observer, or measurement handle |
| `World.from(scene)` | Edit a saved/current graph with the same public handles |
| `world.present({...})` | Set shared time window, playback duration, stage scale/camera |
| `world.title(text)` | Rename the world |
| `world.annotate({id?,timeDays,title,text,focusId?})` | Author a time-based explanatory cue; focus may be a body handle |
| `world.build()` | Validate and return a serializable graph |
| `world.at(timeDays)` | Evaluate the shared state and all measurements |
| `world.sample({samples:721})` | Sample all measurements with this baseline cadence plus event-guided refinement |

Orbit fields: `semiMajorAxisAU`, `eccentricity` (0–0.85), `inclinationDeg` (0–180),
`longitudeAscendingNodeDeg`, `argumentPeriapsisDeg`, `meanAnomalyDegAtEpoch`,
`epochDays`. Defaults: a=.05 AU, e=0, i=90°, node=0°, periapsis argument=90°,
mean anomaly=0°, epoch=0 d. Inclination belongs to the orbital plane relative to
world xy, not to the presentation camera. With observer +z, defaults transit at t=0.
Period derives from a and stellar GM. Changing e via `set()` is rejected: use the
explicit method above. Radius is in Jupiter equatorial nominal radii.

Presentation fields: `startDays`, `durationDays`, `playbackSeconds`, `bodyScale`,
`camera:{azimuthDeg,elevationDeg,zoom}`. Structural/parameter edits describe a new
configuration, not physical impulses. Current browser playhead is runtime state.

Sampling accepts 3–4097 baseline samples and adds points around predicted transit
windows. Each track has at most 8192 points and 160 refined event instances.
Read the returned `sampling` metadata: budget limits can omit events, and curves
remain approximate for grazing or mutual-overlap details. The instantaneous
`world.at(t)` measurement is evaluated independently of this plot grid.

The fixed-star approximation ignores planet masses in motion, uses at most 16
planets, and requires total planet/host mass ≤1%. This is not a stability guarantee.
The core has no limb darkening, interacting N-body dynamics, or RV observable.
See `docs/physics.md` for equations and conventions.

## Migrate an existing authoring program

For a bare v0.2 scene or saved API response, run `bash scripts/node.sh scripts/exoplanet-project.mjs import input.json /tmp/migrated.json` and import the new file in the shared astronomy workspace. A dry-run envelope (`{valid:true,scene}`) contains the graph. An envelope with a `source` string also preserves that author text. When starting directly from a trusted local `.mjs`, call `importLegacy({scene: world.build(), source: originalText})` in that author's process. The old HTTP tool names and numeric revisions belong to the v0.2 transport. New edits to an imported construction use F07. [Migration rules and source association](exoplanet-authoring.md#import-a-v02-world)

The original JavaScript examples still exercise this route, including independently configured observers and both eccentricity conventions. [Overlapping shadows](../experiments/agent-a-report.md) · [Eccentricity and preserved distances](../experiments/agent-b-report.md)
