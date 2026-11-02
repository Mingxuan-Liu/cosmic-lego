# Independent author challenge A: three planets, one shared shadow

Date: 2026-11-02. Recipe: [agent-a-overlap.mjs](agent-a-overlap.mjs).

## Authoring boundary

I read only `AGENTS.md`, `docs/agent-interface.md`, and `docs/physics.md`, and discovered the public semantic tools through the CLI. I imported the public `World` SDK without reading its implementation or the rebuilt numerical/rendering source. I authored a new case rather than adapting a supplied recipe. I did not change the engine, renderer, documentation, or shared live scene.

This is an independent **authoring feasibility** exercise, not independent certification of the physical model. It establishes that this particular composition was expressible and evaluable through the interface.

## The authored case

One uniform solar-size star hosts three independent planets:

| Planet | Radius, Jupiter nominal equatorial units | Semimajor axis, AU | Eccentricity | Inclination | Derived period, days |
| --- | ---: | ---: | ---: | ---: | ---: |
| Amber | 1.20 | 0.045 | 0 | 90° | 3.486721 |
| Cyan | 0.75 | 0.080 | 0.35 | 89.4° | 8.264820 |
| Violet | 0.55 | 0.130 | 0.20 | 88.5° | 17.120382 |

The aligned observer looks along +z. At time zero, amber and cyan partially overlap in projection while violet covers a separate patch of the stellar disk. The planets do not physically touch: amber–cyan projected center separation is about 81.461 million meters, their radii sum is 139.409 million meters, and their three-dimensional center separation is about 1,049.924 million meters.

The recipe creates a combined photometer **before** adding the planets, then uses a loop to construct bodies, attach distinct orbits, and add individual photometers. Further handles measure the amber–cyan pair and the complete system from a tilted sightline. Four explanatory cues accompany a 0.36-day transit window. The SDK provided all required physical handles on the first construction attempt.

## Quantitative result at time zero

| Measurement | Normalized stellar flux |
| --- | ---: |
| Amber alone | 0.984793356004 |
| Cyan alone | 0.994059904689 |
| Violet alone | 0.996805548744 |
| Amber + cyan, union photometry | 0.981718523620 |
| All three, union photometry | 0.978524072364 |
| All three, tilted observer | 1.000000000000 |
| Naive result from adding the three individual deficits | 0.975658809437 |

Adding individual deficits predicts a loss of **2.434119%**. The combined photometer gives **2.147593%**. The naive method overstates the loss by **2,865.263 ppm of unobscured stellar flux**, or **13.341742% of the actual combined loss**. It double-counts the amber–cyan shared shadow. These values are measured outputs of this prototype, not observational data.

The tilted photometer returned flux 1 at all 721 inspected times over the stated window. That is a sampled check; it is not a general transit-search guarantee.

## Structural edit and limits

Using `World.from(world.build())`, I made an independent copy and removed cyan with `cascade: true`. Its orbit and explicitly dependent photometers were removed. The general combined photometer remained and automatically measured amber plus violet, giving flux **0.981598904748** at time zero. Amber's evaluated position was unchanged. The exported default recipe still contains all three planets.

One missing authoring capability emerged: the documented measurement API offers transit photometers, but no custom derived-curve handle. I can compute the naive deficit sum in the author process through `world.at()`, but cannot register that arithmetic comparison as an additional viewer curve through the documented SDK. The scene therefore presents valid combined/selective photometers and explains the comparison in text; this report supplies the numerical contrast.

The browser presentation has not been inspected by this author. The recipe uses the documented annotations and camera controls, but layout, full motion, visibility of all six curves, and cue timing still require visual review. The idealized dynamics also exclude interactions, stability analysis, collisions, limb darkening, and stellar reflex motion.

## Reproduce without changing the shared live scene

From the repository root:

```sh
bash scripts/node.sh scripts/agent.mjs run experiments/agent-a-overlap.mjs --dry-run
bash scripts/node.sh --input-type=module -e "import {auditOverlapLesson} from './experiments/agent-a-overlap.mjs'; console.log(JSON.stringify(auditOverlapLesson(), null, 2));"
```

The first command passed with `valid: true`; the second reproduces the numerical comparison and transient structural edit. Neither publishes to the live browser. No commit was made by this author.
