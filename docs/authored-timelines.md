# Authored timelines and local delivery

An authored timeline maps presentation seconds to a scientific sample and a view of that sample. The eight-second example follows nine moving points, holds physical time at four seconds for a measurement, then shows a labeled configuration with three changed velocities. A seeded accumulator and the sampled fields accompany the sequence. These fixtures exercise software behavior. [Example recipe](../examples/authored-timeline.mjs)

## Open the example

From the repository root, create a project in a new local slot and start the read-only player.

```sh
bash scripts/node.sh examples/authored-timeline.mjs --directory .local/timeline-input
bash scripts/node.sh scripts/timeline-server.mjs --project .local/timeline-input/motion-study.json --port 0
```

Open the printed loopback URL. **Seek to seconds** accepts an exact presentation time. Compare 3 s with 4 s. Physical time stays at 4 s while the label, configuration and mean distance change. Step to 5 s to see the clock begin moving toward earlier physical samples. Play follows elapsed time on a monotonic clock. Slow rendering skips intermediate display samples and still shows each crossed configuration boundary and the exact endpoint. The step buttons move by a quarter of a presentation second. Stop the server with Ctrl+C.

The full workspace can also import the JSON through its Project controls and serve the same `/timeline/` player. A workspace edit can make an already observed timeline snapshot stale. Reload the player to seek against the new snapshot. [Workspace and files](portable-projects.md)

## Author the clock, camera and events

`createTimeline` takes a duration in seconds and optional stable ID and title. The following code fits in a module at the repository root. The fixture supplies a camera, a plot, moving points and their registered models.

```js
import { buildExample } from './examples/workspace.mjs';
import { createTimeline } from './src/timeline/definition.js';
import { createPortableManifest } from './src/portable/format.js';

const context = buildExample();
const timeline = createTimeline({ id: 'comparison', title: 'A held comparison', duration: 3 });
timeline.track({ id: 'clock', kind: 'physical-time', keys: [
  { at: 0, value: 0 }, { at: 1, value: 2 }, { at: 3, value: 2 },
] });
const caption = timeline.track({ id: 'caption', kind: 'annotation', keys: [
  { at: 0, value: 'Watch the points move.' }, { at: 1, value: 'Read the positions at two seconds.' },
] });
timeline.boundary({ id: 'alternative', at: 2, label: 'B · changed velocity', operations: [
  { command: 'update:fixture.moving-point', args: { id: 'point-0', parameters: { v: [0.5, 0, 0] } } },
] });
const manifest = createPortableManifest({ ...context, timeline: timeline.snapshot() });
```

A track or boundary handle provides `.id`, `.value`, `.set(patch)` and `.remove()`. A handle patch preserves the ID. The data-command interface on the same author supports `timeline.track.set`, `timeline.boundary.set` and `timeline.remove`. The two set commands take a complete record. For example, `timeline.apply({command: 'timeline.remove', args: {id: caption.id}})` removes the caption from subsequent snapshots. To edit a saved sequence, pass `{version: 1, data: manifest.timeline.data}` to `editTimeline`. The next portable save regenerates configuration pins. The workspace's `POST /api/projects/save` and `/api/projects/export` also accept an authored `timeline` alongside the normal F09 fields. [Authoring API](../src/timeline/definition.js) · [File API](portable-projects.md)

| Track kind | Target and key value | Between keys |
| --- | --- | --- |
| `physical-time` | Physical seconds as a finite number | Linear. Equal adjacent values hold the sample. A decreasing segment seeks earlier samples. With no clock track, physical seconds equal presentation seconds. |
| `camera` | Camera node ID and `{position: [x,y,z], target: [x,y,z]}` in scene coordinates | Linear component interpolation |
| `visibility` | Scene node ID and a boolean | Hold |
| `annotation` | Caption text | Hold |
| `emphasis` | Workspace overlay ID and a boolean | Hold |

Each track begins at `at: 0`. Keys increase strictly within the duration, and the last key holds through the end. One current track controls each target/property. Independent captions can coexist. Definitions allow up to 64 tracks, 64 keys per track, 512 keys in total, 16 configuration boundaries and 32 operations per boundary. The authored definition is bounded to 64 KiB and 86,400 presentation seconds.

A boundary runs its listed F07 mutations in order on an isolated F01 draft. Give every created node and relationship an explicit ID. Boundaries take effect at their timestamp. Simultaneous boundaries run in declaration order before the sample and its presentation tracks. A seek selects the validated configuration prefix and evaluates physics at the mapped time. The authoring graph and its Undo history retain their state. A velocity change in this example compares trajectories under two parameter choices. A physical impulse would need a model with an impulse law. [Configuration compiler](../src/timeline/configurations.js)

Stateful samples replay from the declared initial conditions using F04, the saved numerical settings and the model's random algorithm. This also applies when the presentation clock seeks backward. Inspect each result's achieved time for models that sample at or before a request. Incompatible requests, unsatisfied scene inputs and replay limits produce errors. A frame is bounded to 30 seconds of computation and 8 MiB of result data. [Evaluator](../src/timeline/evaluator.js) · [Runtime contract](computation-runtime.md)

## Request the same frame as the browser

`GET /api/timeline` returns `{ok:true,result:{title,duration,snapshotId}}`. Send `POST /api/timeline/frame` with `Content-Type: application/json` and a body such as `{"time":4,"snapshotId":"<observed digest>"}`. The snapshot ID pins the request to the observed project. The response's `result` contains presentation and physical times, source identity, timeline, graph hash and applied boundary list, workspace snapshot, F04 results, active camera ID, annotations and warnings. An error response carries `{ok:false,error:{code,message}}`. The standalone host accepts local requests on its loopback origin. [HTTP routes](../scripts/timeline-http.mjs)

An embedding host can construct its own evaluator with `await createTimelineEvaluator({manifest, registry, binding, layer, registryModule})`, await `.evaluate(seconds)`, and call `.dispose()` when finished. The trusted host supplies the registry module. The evaluator matches required model builds against the base graph and every authored boundary. Presentation tracks apply to the rendered snapshot after scientific evaluation. [Portable format](../src/portable/format.js)

## Export a PNG sequence

Local export requires an installed Playwright and compatible Chromium with WebGL 2. Set `COSMIC_LEGO_PLAYWRIGHT` to an installed module entry and `COSMIC_LEGO_CHROME` to an installed browser executable when using installations outside the default Playwright environment. The following command writes nine samples including the endpoint.

```sh
bash scripts/node.sh scripts/timeline-delivery.mjs export \
  .local/timeline-input/motion-study.json .local/motion-frames \
  --start 0 --end 8 --fps 1 --width 1280 --height 720
```

Use a new output directory. `makeFrameSchedule({start,end,fps,width,height})` derives each time as `start + index / fps`. An endpoint on that grid is included. Other endpoints end the range after the last grid sample. A zero-length range captures one frame. The limit is 3,600 frames, 120 frames/s, 8,192 pixels on either axis, 16,777,216 pixels per frame and four billion scheduled pixels per sequence.

The exporter detaches the F09 document before its first asynchronous operation and starts an isolated loopback player. For each scheduled time it requests the ordinary evaluator, gives that result to the player's capture view, and waits for assets, fonts, scene upload and paint. It verifies the player's exact time, graph hash, project identity and viewport dimensions before screenshotting at device pixel ratio one. `exportFrames({manifest,directory,schedule,signal,onFrame})` also supports cancellation with an AbortSignal. [Export API](../src/timeline/export.js)

| Output | Inspect |
| --- | --- |
| `project.json` | The verified visualization document used for this run, including its accepted construction, timeline and implementation pins |
| `sequence.json` | Snapshot ID, base requirements, per-boundary configuration requirements, saved playback settings, planned times, dimensions and filenames |
| `frames/frame-NNNNNN.png` and `.json` | Captured pixels and SHA-256 digest, requested and achieved times, configuration boundaries, scientific values and hashes, implementation/input identities, settings, camera, captions, warnings, asset identities and browser/GL renderer |
| `progress.json` | Status and count of complete PNG/metadata pairs. Completed indices run from zero through `completedFrames - 1`. |

Progress advances after both files are published. A normal Ctrl+C marks the prefix `interrupted`, and rendering errors mark it `failed`. A force-killed process can leave `incomplete`, an uncommitted pair or a `.partial` file. Treat the recorded prefix as committed and verify image digests before using it. Retry in a fresh directory. The first version has no in-place resume. It exports numbered PNGs and leaves editorial assembly and sound to the production tools.

For a comparison, match source snapshot ID, presentation and physical times, configuration graph hash, output node/port and implementation build. Compare descriptors, units, coordinate frames, actual achieved times, warnings and numerical samples. The bundled fixtures use equality of the recorded scientific values for repeated runs under the same installed implementation and settings. A different numerical implementation needs its own declared tolerances. PNG hashes identify the delivered files. GPU/driver, browser, font rasterization and system fonts can affect pixels even when the numerical results agree.

## Share a local player

```sh
bash scripts/node.sh scripts/timeline-delivery.mjs package \
  .local/timeline-input/motion-study.json .local/motion-player
cd .local/motion-player
node scripts/timeline-server.mjs --project project.json --port 0
```

Copy the entire directory to the receiving machine. It requires Node.js 20 or later and a WebGL 2 browser. Runtime modules, the trusted generic fixture registry, Three.js and OrbitControls, local static assets, branding and license notices travel with the package. The receiving machine can run offline without installing packages or connecting an agent. `delivery.json` lists the files and their SHA-256 digests. `README.md` gives the launch command.

Both delivery commands exclude conversation messages and agent turn/call associations, including when the input is a local save that opted into conversation. The source file stays intact. The host validates it before deriving the visualization document's digest. An input already free of these records keeps its snapshot ID. For a redacted delivery, match the source's `savedFrom`, graph hash and configuration pins when comparing its numerical results with the local archive.

Review authored recipes, labels, data, provenance and accepted-command summaries before distributing the resulting `project.json`. These remain inspectable in both outputs. Use a separate F09 archive when intentionally sharing a public conversation. Embedded recipes stay inert, and the fixed package inventory supplies executable modules. Opening a creation with an unavailable model build reports the missing requirement. [Sharing controls](portable-projects.md) · [Licenses and notices](third-party-notices.md)
