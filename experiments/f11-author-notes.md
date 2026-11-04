# Independent author exercise · Timing gate

I started with an empty project and a public generic registry. I wanted a screen on which I could predict a number, add an object, and see the same change in a measurement and the geometry. I chose an instrument bench with three parallel lanes. Each coral puck travels at 1 m/s. The blue-to-gold tiles mark nominal arrival times, and three cyan arrows show the reference velocity. By holding the clock as the pucks cross the gate I can distinguish their shared x coordinate from their different distances to its center.

My authoring inputs were the product guides for the kernel, scientific dataflow, extension registry, runtime, scene, workspace, gateway, portable projects and authored timelines, plus calls to the public registry and gateway discovery commands. I imported the trusted workspace registry factory, public SDK entry points and the Node file reader for including my own source. I did not inspect a preset recipe, test, implementation body, private transcript or handoff. All geometry and samples are original, synthetic software fixtures.

## Repeat the construction

From the repository root in a POSIX shell:

```sh
bash scripts/node.sh --input-type=module <<'JS'
import { buildReadinessManifest } from './experiments/f11-author.mjs';
import { writeFile } from 'node:fs/promises';
const manifest = await buildReadinessManifest();
await writeFile('/tmp/timing-gate.json', JSON.stringify(manifest));
console.log(manifest.integrity.graphHash);
JS
```

Import the file through the workspace Project menu. Its saved physical time is 2 s. Click the middle coral puck or its matching sample in **Puck x · select a sample**, then unfold **Selected sample**. **Mean distance from gate center** stays visible alongside the stage. The additional signed margin plot is available through Views. In the authored player, 1.5 to 2.5 presentation seconds hold physical time at 2 s and emphasize the mean. The full four presentation seconds cover four physical seconds. The conversation overlay is part of the construction. Session connection and authorization are host decisions.

Two fresh builds produced the same accepted graph hash, `sha256:5c70f450612c5c68fab757c10c66013ce956cf4ac88da1a6725e152e025d15d4`. The accepted graph has 46 nodes. The portable original contains this recipe text under `experiments/f11-author.mjs`, its produced graph, citations for both authored fields, and implementation pins. Opening a serialized copy reported source status `matches`. Each fresh construction/load has a fresh generation. Use the graph hash to compare construction content.

## Requests and evidence

| Author's request | Public calls and observations |
| --- | --- |
| Identify a blank host's usable components | `registry.discover()`, `discover({detail:'summary'})` and selected full gateway declarations exposed the analytic moving point, seeded accumulator with LCG32, field mappings, assets, cameras and workspace factories. Scientific inputs and outputs carry units, meaning and frames. |
| Build three selectable pucks and compute a quantity over any future fourth puck | A JavaScript loop called `instantiate('fixture.moving-point', …)` for `puck-low`, `puck-mid`, `puck-high`. A live selection of their position ports (`scan-pucks`) feeds `map('magnitude')` and `reduce('mean')`. The stage's `pucks-stage` instances and `lane-readout` plot retain their source IDs. |
| Compare the mean with one lane spacing | `lane-gap` subtracts midpoint position from upper-lane position with an explicit comparison. Its magnitude `reference-radius` is 1 m. `radius-margin` subtracts that value from `mean-gate-radius`. The inputs share time, frame and compatible units. The author's physical interpretation is the signed difference between mean radius and lane spacing. |
| Revise an authored relationship and retire a trial view | The accepted graph initially connected `inspection-pair` from low to middle puck. I preserved that ID and changed its target to the high puck. The relationship is an inspection cue. In separate accepted drafts I created and bound the plot `trial-meter`, then removed it. The final graph contains the revised relationship and omits both trial plot and its binding. |
| Render and inspect the independent calibration fields | Two `constant(value({kind:'field',…}))` calls define 15 arrival-time samples and three velocity vectors. Explicit scene bindings select units, frame, palette, range, geometry and arrow-length exaggeration. The scalar material is white and unlit. |
| Give the bench a reproducible stochastic control | `timing-dither` is a separate playback target. It has a dimensionless initial value of 1.5, seed 20261103, step 0.25 s and tolerance 1e−12. The pucks and fields have no dependency on it. |
| Keep the construction inspectable and navigable | The F06 author created two open measurement plots, an initially folded inspector, an additional hidden arithmetic plot, and a visible conversation overlay. The stage has an orthographic camera. F10 clock, annotation and emphasis tracks direct attention to the held measurement. |
| Reopen, reject a bad connection, add a puck, then undo | I ran the requests below against a fresh, isolated F07 local gateway with F04 workers. The bad command preserved the entire accepted graph and token. The successful addition changed the live stage source, mean and margin. Undo restored the exact pre-edit graph. In-app conversation is a separate host exercise. |

For each F07 mutation use the full current token from `inspect` and a fresh idempotency key. The two requests below are operation bodies.

```json
[
  {"command":"create:fixture.accumulator","args":{"id":"bad-rate-integrator","inputs":{"source":{"node":"puck-mid","port":"position"}}}},
  {"command":"create:fixture.moving-point","args":{"id":"late-puck","parameters":{"r0":[-3,0,0],"v":[0.5,0,0]}}}
]
```

Submit them **separately**. The first returned `KIND_MISMATCH`, category `incompatible-connection`, with “bad-rate-integrator.source: Input/output kinds differ.” The accumulator requires a scalar accumulation rate in 1/s. The puck supplies a position vector in m. The second request adds an independently modeled, slower puck.

## Independent numerical predictions

Coordinates are in lab-frame metres. Initially each original puck is at `[−2,y,0]` with `y = −1,0,1`, so its position at time t in seconds is `[t−2,y,0]`. At t = 2 s all reach x = 0. Their distances from the gate center are 1, 0 and 1 m. A fourth puck launched from −3 m at 0.5 m/s reaches x = −2 m at the same time.

| At physical 2 s | Baseline | After adding late-puck | Observed after Undo |
| --- | ---: | ---: | ---: |
| Source objects in plot/instanced collection | 3 | 4 | 3 |
| Mean center distance, m | 2/3 | 1 | 0.6666666666666666 |
| Mean minus 1 m lane spacing, m | −1/3 | 0 | −0.33333333333333337 |
| Extra puck position, m | absent | [−2, 0, 0] | absent |
| Seeded control | 0.910199468024075 | 0.910199468024075 | 0.910199468024075 |

The nominal calibration field has T = (x + 2 m)/(1 m/s). In each lane x = −2, −1, 0, 1, 2 m gives T = 0, 1, 2, 3, 4 s. Rows run from the low to high lane. Compiled first-row tiles have endpoint RGBs [0.208, 0.345, 0.659] and [0.949, 0.753, 0.388], with center [0.431, 0.773, 0.729]. Their positions equal the scientific grid coordinates. The arrows originate at [−2.75,y,0] m and have scientific directions [1,0,0] m/s. An authored vectorScale of 0.45 sets their visible length. These stay fixed after the fourth puck is added.

For an independent seeded check, start with integer s = 20261103, x = 1.5. At each completed quarter-second set s to (1664525s + 1013904223) modulo 2³², then add s/2³² − 0.5 to x. Eight steps give s = 698001015 and x = 0.910199468024075, matching the runtime. At 1.4 presentation seconds the physical sample is 1.8666… s, while the seeded result comes from the preceding 1.75 s step. Only the continuous point models drive the gate measurement.

I inspected a 1280 × 720 PNG capture of the timeline at presentation 2 s. Three coral disks line up at the gate, alongside the three direction arrows and calibrated tiles. The emphasized readout displays 0.666667 m, and the footer describes the held clock. This inspection covered a single captured frame.

## Friction and repairs

- The first draft subtracted a timeless 1 m scalar from a time-stamped measurement. Graph validation accepted their descriptors. A real timeline seek returned `TIME_MISMATCH` because arithmetic requires aligned physical samples. I replaced the scalar with the upper-minus-middle separation measured at the current time and checked integer and fractional seeks.
- The original F06 plot binding assigned a fresh anonymous relationship ID. Rebuilding with identical authored data changed the graph hash. The early recipe retained the inferred contract, disconnected the anonymous relationship, and recreated it through F01 with a stable ID. The public F06/F07 binding now accepts an explicit relationship ID. The final recipe passes that ID to the existing binding call. Rerunning it preserved the same accepted graph hash as the early workaround.
- The F09 guide described data-source citations without giving a complete example record. Public format errors rejected `id` and pointed to `nodeId`, followed by `source`. I submitted `{nodeId,source,license}` for each synthetic field and reopened the resulting file. When including source text I corrected a Node file-reader error by passing a URL object instead of a file-URL string.

The timing bench exercises geometry, quantitative readouts, reversible construction and replay. The seeded control is an algorithmic fixture. The arrival times and reference velocities are authored calibration samples.
