# Authoring the shared-shadow study

At conjunction, two planets can cover the same patch of a star. A photometer counts the missing light from that patch once. This synthetic study gives each planet an independent orbit, then uses the same accepted model to draw the observer’s sky, calculate the combined flux, and construct a deliberately naive comparison. The star has uniform surface brightness. All photometric values are fractions of its unobscured flux. [Physics, constants and numerical references](physics.md)

## Open or reproduce the study

From the repository root, start the shared workspace with the optional astronomy registry:

```sh
bash scripts/node.sh apps/exoplanet.mjs
```

Open [the local study](http://127.0.0.1:4317/workspace/). The default construction is **When shadows overlap**. **Study conversation**, **Selected component**, measurements and Views use the common workspace controls. Save locally from Project and reopen that slot with `bash scripts/node.sh apps/exoplanet.mjs --open SLOT`. The default astronomy store is `.local/exoplanet-projects/`. [Workspace and portable saves](portable-projects.md)

To build the portable file without starting an editing session, use a fresh output filename. Omitting the output argument prints the F09 project to standard output. The player can open it without an agent.

```sh
bash scripts/node.sh scripts/exoplanet-project.mjs example /tmp/shared-shadow.json
bash scripts/node.sh apps/exoplanet.mjs player --project /tmp/shared-shadow.json --port 0
```

For PNG export and offline sharing, start from the same F09 file and choose new output directories. The astronomy launcher supplies the trusted package registry to the common evaluator and delivery tools.

```sh
bash scripts/node.sh apps/exoplanet.mjs export /tmp/shared-shadow.json /tmp/shared-shadow-frames --start 3 --end 5 --fps 1 --width 1280 --height 720
bash scripts/node.sh apps/exoplanet.mjs package /tmp/shared-shadow.json /tmp/shared-shadow-player
```

Open the packaged directory’s README for its receiving-machine command. PNG export requires an installed compatible Playwright/Chromium pair with WebGL2. [Delivery guide](authored-timelines.md)

The camera looks toward the origin from the observing side. In this orthographic pose, comparing disk sizes and projected areas is meaningful. Orbiting the camera exposes the real line-of-sight separation between planets and star. Reset restores the authored view. Physical flux still comes from the named observer. Unlit sphere colors identify bodies. Their radii use the same scale as their projected positions, with one IAU nominal solar radius per display unit. The `exoplanet.silhouette` asset consumes the current radius port, including the zero-radius limit.

The slider spans −7,200 to +7,200 physical seconds around conjunction. The portable file opens at 0 s. The eight-second authored timeline begins at −7,200 s, reaches conjunction at 3 presentation seconds, holds through 5 s, then ends at +7,200 s. The highlighted comparison during the hold makes the overcount visible.

## Predict the readout

The primary has radius 1 nominal solar radius. Ember (1.4 nominal Jupiter radii) and Cinder (0.8) are centered on the star at 0 s and are both in front of it. Ash lies behind it. The supplied nominal radius ratio is `k = 71,492,000 / 695,700,000`.

| At conjunction | How it is obtained | Relative flux |
| --- | --- | ---: |
| Combined `transit.flux` | The smaller foreground disk is inside the larger, so the blocked fraction is `(1.4k)²`. | 0.979302067894 |
| Naive `naive-flux.value` | Subtract the individual deficits `(1.4k)² + (0.8k)²` from unity. | 0.972543559451 |
| Difference | The sum double-counts Cinder's covered area. | 0.006758508443 |

**Combined flux · time (s)** shows the correct light curve. Use Views to open **Naive curve · ignores overlap**. Each curve evaluates its own scalar source using the same 33 physical times, including conjunction. The current readout uses the exact requested time, even between those samples. Faster structure between samples requires a denser or shorter schedule. Separately, the analytic orbit and occultation calculations have the assumptions and numerical limits described in the physics guide.

## Build and change a system

`packages/exoplanet/recipe.mjs` exports `buildExample()`, `buildExoplanetManifest()`, `dataSources` and the worker's `registryModule` URL. The example starts from a new `Project`, instantiates its primary, orbits, observer and photometry using `binding.author(draft)`, and binds plots and geometry using `layer.author(draft)` and `layer.scene.author(draft)`. These APIs obey the same validation as the F07 gateway. Starting a generic workspace without the optional package keeps its registry independent. [Recipe](../packages/exoplanet/recipe.mjs) · [Package registry](../packages/exoplanet/registry.js)

The example declares an independent semimajor axis, eccentricity, node angle, periapsis and epoch phase for each planet. The star supplies its gravitational parameter. Each `exoplanet.orbit` consumes the named primary's `gm` and `radius`. A registered `exoplanet.projection` consumes an orbit, its physical radius, the star's radius and the observing direction. The photometer pairs selected positions and radii by their object IDs. The default `all-positions` and `all-radii` are live selections, so adding a supported orbit changes both calculations.

The correct flux and each independent depth come from `exoplanet.photometry`. The naive construction uses the generic reduction and arithmetic nodes. It sums `transit.independentDepths`, derives the time-aligned unobscured reference by adding `transit.flux` to `transit.depth`, and subtracts the sum from that reference. Both operands carry the same observer, stellar normalization and time. The comparison is explicitly authored as `naive-independent-depth-flux`. Adding a planet updates membership on both sides. Sample the two scalar nodes with `science.sample(source,{times,unit:'s'},{id})` to obtain aligned physical-time series.

For a structural edit at 0 s, add a fourth dark planet with radius 1.8 Jupiter radii and mass 0.2 Jupiter masses. A circular, edge-on 0.12 AU orbit with argument of periapsis 90°, node and mean anomaly 0°, epoch 0 days, puts its disk over both existing foreground disks. The resulting correct flux is 0.965785051008 and the naive flux is 0.938328610460. Create the orbit and bind its projection and silhouette in one accepted transaction to update both measurement and drawing. The calculation can also admit an orbit before an author chooses to draw it. [Gateway authoring and Undo](command-gateway.md)

For an eccentricity change use `eccentricityParameters(existingParameters,newE,hold)` from `packages/exoplanet/models.js`. It returns the `shape` patch to submit with `update:exoplanet.orbit`. Choose `'semiMajorAxis'` to retain the period or `'periapsis'` to retain `a(1 − e)`. The package represents angle fields in degrees, `epochDays` in days and `shape.distanceAU` in AU. Scientific evaluated positions, velocities and periods use metres, m/s and seconds respectively. [Package declarations](../packages/exoplanet/models.js)

## Import a v0.2 World

```sh
bash scripts/node.sh scripts/exoplanet-project.mjs import old-world.json /tmp/migrated-world.json
```

The importer accepts a bare v0.2 scene such as the old `.local/world-v2.json`, a `{valid:true,scene}` dry-run result, or the old `/api/scene` JSON envelope with `revision`, `history` and `source` where available. It checks the old schema and then builds a new project under the installed package. Data from a v0.1 pair-based scene, unknown fields, invalid units/values, or an untranslatable caption yield diagnostics. The CLI writes warnings to standard error and refuses to replace an existing output file. [Importer](../packages/exoplanet/importer.mjs)

- Planet IDs become the orbiting scientific components. Each old orbit ID becomes an attachment relationship to its host. Masses, radii, orbital elements, epochs, observer directions and explicit photometer memberships are retained. The special `"orbiting"` membership stays live. Fixed lists stay fixed. The legacy body's name and color remain identifiable through provenance, the attachment and material, as applicable.
- Dates and durations in the old graph remain days in its archived input. The importer converts timeline and playback coordinates to seconds with 86,400 s/day. The migrated playback starts at the saved window start. Captions follow the last eligible cue, including simultaneous cues under the original ordering.
- The sky adopts the first measurement's observer, or the first available observer when the file has no measurement. Each photometer still uses its own physical direction. When no observer exists, the stage shows the primary and the original orbits remain inspectable. The old navigation camera, exaggerated marker scale and optional cue focus are archived. The warning report explains which visual choices have changed.
- Each imported curve starts with 33 uniform times and adds contact-guided samples from the v0.2 event search for its own observer and selected occulters. F02 accepts at most 256 time coordinates per series. If a schedule is larger, the importer thins the candidate list across its entire extent, retains both endpoints, and reports retained and candidate counts alongside any legacy event-budget or unresolved-geometry notice. Fluxes are recalculated by the migrated meter. Editing an orbit may move a transit away from this fixed schedule; a newly chosen shorter window can recover the detail.
- The F09 source bundle keeps the exact input text in `legacy/input.json` and any supplied original JavaScript in `legacy/original-source.mjs`. Opening the project decodes those resources as inert text. The recorded recipe associated with the new graph is the importer, with the new public recipe alongside it. `legacy/migration-notes.json` records all field-specific notices. The source license remains unspecified unless the legacy document establishes one. The archive retains any old receipts as historical records and the imported graph starts a fresh edit history.

An existing `World` JavaScript author can continue to call `world.build()` and `world.at(timeDays)`. To move that authored work to the shared environment explicitly, call `importLegacy({scene: world.build(), source: originalText})` in the author's process and save the returned `manifest`. The compatibility SDK and registered package use the same numerical engine.
