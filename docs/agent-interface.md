# Agent construction interface v0.2

Start with semantic handles and operations. JSON is used to serialize a world or
tool request; it does not define the ceiling of the authoring workflow.

## Public JavaScript SDK

An agent can write an ordinary local `.mjs` script. For scripts in `examples/` or
`experiments/`, import `World` from `../src/sdk.js`. Export a World, or a function
returning one. Execute with `node scripts/agent.mjs run path/to/recipe.mjs`.
Use `--dry-run` to validate and print the scene without a running server.

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

## Discoverable tools and atomic edits

```sh
node scripts/agent.mjs tools
node scripts/agent.mjs inspect
node scripts/agent.mjs run experiments/my-world.mjs --dry-run
node scripts/agent.mjs run experiments/my-world.mjs --base-revision 1
node scripts/agent.mjs transact operations.json --base-revision 2
node scripts/agent.mjs evaluate --time-days 0
```

`bash scripts/node.sh` can replace `node` on the original workstation.
`--url http://127.0.0.1:4317` selects a different local server for commands requiring
one. `tools` and SDK dry-runs work offline. CLI flags are checked; use `help` to list
commands. The server serves only loopback HTTP and does not execute submitted JS.

`GET /api/tools` returns tool descriptions and physical capabilities.
Its argument descriptions are human/agent-readable metadata, not provider-specific
function-calling JSON Schemas. A provider adapter must supply its own binding.
Annotation cues have stable IDs and can be removed with a semantic `remove`
operation; editable annotation handles are not yet part of the SDK.
`GET /api/scene` returns `{revision,scene,source,history}`.
`POST /api/commands` accepts `{baseRevision?,commands:[...]}`. For example:

```json
{
  "baseRevision": 1,
  "commands": [
    {"op":"add_body","body":{"id":"new-planet","kind":"planet","name":"New planet","radiusJupiter":0.7,"massJupiter":0.1}},
    {"op":"attach_orbit","orbit":{"id":"new-orbit","bodyId":"new-planet","hostId":"sun","semiMajorAxisAU":0.08,"eccentricity":0.2,"inclinationDeg":86}}
  ]
}
```

Both operations commit together, or neither does. Existing `'orbiting'` photometers
automatically include the attached body. API errors return structured validation
details; HTTP 409 means a stale revision. Re-read and reconcile before retrying.

Other routes: `GET /api/capabilities`, `GET /api/examples`, `POST /api/example {id}`,
`POST /api/scene {scene,source?,baseRevision?}`, `POST /api/validate {scene}`,
`POST /api/evaluate {timeDays,scene?}`, `POST /api/sample {samples,scene?}`.
Use JSON content type. Source is displayed as text, never executed by the server.

`publish(world,{url?,baseRevision?,source?})`, exported by the SDK, applies a world
directly. External agents can execute scripts in their own authorized process or
bind these semantic operations as tools. A remote chat assistant may generate a
script/operation plan for the user to run; it cannot directly reach loopback.
There is no embedded LLM and no fake natural-language command parser. An MCP adapter
has not been implemented; these are the operations it would wrap.

## Author challenge boundary

Use the public SDK and discoverable tools. You may create arbitrary numbers of
supported bodies/relationships up to the documented resource limits, select
measurements, write loops, compare constructions, and add explanatory cues. Do not
modify physics or rendering to make a scenario appear to work. Report missing
capabilities and errors: a useful abstraction must survive new compositions.
