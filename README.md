# Cosmic Lego

<img src="assets/branding/cosmic-lego-galaxy.png" alt="Cosmic Lego spiral galaxy assembled from colorful interlocking bricks" width="180">

**Reusable scientific building blocks for interactive astronomy visualizations.**

When two planets cross the face of a star, how much light do they block? At astronomical distances we often have a light curve and cannot see either shadow. In Cosmic Lego you can move an observer, follow each planet, and compare the shadows on the stellar disk with the signal that observer would measure.

The **astronomy learning map** opens as a 3D star cluster. Pick *Light & color* to see what starlight can tell you, or search for *Moon phases* to explore why the Moon changes shape. Larger stars mark ideas that help explain more topics. Follow a dashed line to see how the same diagram helps explain two topics. You can rotate the 3D cluster, pan across the 2D map, or browse the same topics in a table. Choose **Planetary transits** to try the playable study. [Launch the map](docs/getting-started.md) · [How the stars are sized](docs/atlas-sources.md)

![The astronomy learning map in 3D cluster view. Light & color sits near the center, and dashed lines connect topics you can explore with the same diagram.](docs/evidence/roadmap-3d.png)

Choose **Open workspace** to explore **When shadows overlap**. At conjunction the modeled star retains 97.9302% of its unobscured flux. Summing the individual transit depths instead predicts 97.2544% because the smaller foreground shadow lies inside the larger one. Inspect the geometry, change the system, and see both measurements update. [Open the workspace](docs/getting-started.md) · [Reproduce the study](docs/exoplanet-authoring.md)

Cosmic Lego aims to let students, teachers, and creators assemble stars, planets, gas, light, and observers with their own agents. The first installed astronomy package supplies independent Kepler orbits and transit photometry. The other astronomy questions below guide future model development. A saved study can be explored and replayed locally without connecting an agent.

## The whole idea

```mermaid
flowchart LR
    Q["Ask inside the visualization<br/>What happens if…?"] --> A["Your chosen agent assembles<br/>and revises the pieces"]
    B["Reusable blocks with checked physics<br/>stars · orbits · gas · light · observers"] --> A
    A --> P["Physical models calculate<br/>motion, light, and measured quantities"]
    P --> V["An immersive central scene<br/>with floating, foldable plots and measurements"]
    V --> E["Change the arrangement<br/>Observe · compare · ask again"]
    E --> A
    V --> R["Save and reuse<br/>in a lesson, visualization or animation"]
```

**The agent arranges the pieces; the implemented models supply the physical
rules. The scene and its measurements must describe the same modeled objects.**

## Why astronomy especially needs this

In introductory physics, chemistry, and biology, students can often learn through
experiments: change a circuit, compare a reaction, or examine cells under a
microscope. Many basic concepts have a classroom or everyday counterpart, even
though these sciences also study inaccessible phenomena.

Astronomy frequently lacks that immediate connection. We can observe a star,
but cannot move around it to inspect its geometry, place another planet beside
it, or wait through its lifetime. Distances and times range far beyond everyday
intuition—from microscopic interactions that produce spectral lines to the
formation and evolution of galaxies. Even when an astronomical image is familiar,
the spatial arrangement, motion, and physical processes behind it may not be.

Interactive visualizations let a learner rotate an orbit, look along another
sightline, follow a particle, or watch slow or fast motion at a readable pace.
Interactive 3D is particularly useful when geometry matters; light curves,
spectra, diagrams, and equations connect that geometry to measurable quantities.
The relevant relationships matter more than rendering every topic in 3D.

Creating such a visualization should not become a second course in graphics
programming or prompt engineering. Beginners should spend their time understanding
transits, temperature, or radiation, rather than repeatedly coding simulations or
coaxing an LLM into drawing them correctly. Models, views, and examples can be
shared and reused. When the necessary physics exists, a new question should need
a new arrangement of those pieces.

## What people should be able to explore

| A question | What the learner and agent could build |
| --- | --- |
| **What happens when several planets cross the same star?** | Add planets with different sizes, orbital planes, eccentricities, and phases. Link the orbital view, the observer's view of the stellar disk, and the combined light curve. Move the observer and see which transits disappear. |
| **Does a hotter star always look brighter?** | Compare idealized stars at fixed radius or luminosity. Change distance or wavelength band, linking the comparison to spectra and received flux. Keep this thermal-emitter approximation distinct from real stellar atmospheres or evolution. |
| **How do particle motions relate to gas temperature?** | Compare random particle motion relative to the mean flow, apply a stated collision model, and connect trajectories to velocity distributions. Distinguish heating from faster collective motion, and investigate which equilibrium the model predicts. |
| **Why does the same source look different through different material?** | Place gas or dust along a sightline and compare images or spectra using available absorption, emission, or scattering models. Show which change comes from the source and which comes from intervening matter. |

The library should grow through real astronomical questions, beyond any
predetermined set of demonstrations.

## Building blocks that agents can actually assemble

An agent should be able to retain a star as an object and connect it to different orbits, observers, and measurements. Orbits, gas populations, light sources,
measurements, and plots need ways to be created, connected, changed, and reused.
Their quantities, units, assumptions, and limits of applicability travel with them.

Agents need freedom to change both astronomy and presentation: add an observer,
derive a comparison between signals, place views side by side, or sequence an
animation. Loops, functions, and reusable recipes should express combinations
the library's authors did not anticipate.

The project includes reusable code and a place to explore its results. Existing
visualizations should open, play, and support their available interactions without
programming or LLM access. Agents or code help learners build new arrangements.

The common foundation must work across topics: constructing objects, connecting
quantities, evolving models, drawing results, conversing with an agent, and saving
or presenting a creation. Astronomy packages supply the particular physics and
assets. A new topic should not need a new application or conversation interface.
The foundation must also work without an astronomy package loaded; exoplanets
are one application of it, not its underlying vocabulary.

## A place to explore, like a planetarium

The visualization should occupy the main stage. A learner can move around the
scene, select something interesting, and ask their own agent to change or extend
it from within the same app. Plots, equations, object details, and the conversation
float above the scene and can be moved, folded, or hidden. A clear way to restore
them makes it easy to move between watching and investigating.

Imagine following gas through a region of space, opening a velocity distribution
over the scene, then asking for a second population to compare. Or inspect an
orbit, ask for another observer, and bring its measurement into view. The agent
can construct new arrangements and views using the available blocks. Sliders
and numerical inputs remain useful for precise adjustments, but do not define
the limits of exploration.

This is a planetarium-like workspace, not a requirement to make every concept
three-dimensional. A spectrum or diagram can become the main view when it best
serves the question. The user's chosen compatible agent supplies the conversation;
the implemented models and checked operations govern changes to the visualization.

## Four commitments

| Commitment | What it means here |
| --- | --- |
| **Arithmetic** | Calculate and combine meaningful quantities and visual elements: derive a flux difference, transform coordinates, connect particle motions to a histogram, or turn a physical relation into an animation. |
| **Interactive** | Change objects and their relationships as well as numerical values. Observe the consequences through linked views and measurements. |
| **Infinite possibilities** | A finite set of pieces should support unanticipated combinations. Physical assumptions and computational limits still apply; not every conceivable connection is valid. |
| **Future-proof** | Keep physics and saved visualizations usable as agents, renderers, and formats change. People choose their agents; playback does not depend on a model provider. Maintenance and migration will still be necessary. |

## The physics must remain accountable

An LLM helps assemble a visualization; it does not decide the laws of nature.
Physical behavior comes from implemented models with stated assumptions and
checks. Changing eccentricity at fixed semimajor axis does not change the
Keplerian period. Moving a presentation camera must not silently change a
measured light curve. Particle velocities are not automatically an emission
spectrum: that connection needs its own physics.

Supported pieces can be rearranged within their stated limits. The agent should
identify connections that need missing physics. New models can be developed
experimentally, with that status visible; admitting them to the supported library
requires documentation, reference cases, tests, and appropriate scientific
review. Passing those checks does not prove every application correct.

Distinguish observations, model predictions, and artistic illustrations. Make
changes of scale, time, viewpoint, or approximation clear when they affect
interpretation. Saved work should retain the editable objects, calculations,
assumptions, data sources, and relevant random procedures behind a plot or
animation. Reproduction concerns scientific results under stated criteria,
rather than identical pixels on every computer.

## How we want this to grow

Original astronomy content is the first proving ground. Each useful visualization
should contribute pieces others can adapt. Interactive exploration and authored
animation should share physics while allowing different pacing and presentation.
Manim inspires this programmatic freedom; language, renderer, platform, and use
of Manim itself remain open choices. We do not need one solver that simulates the
universe from the bottom up.

Progress means an independent author can answer an unfamiliar astronomy question,
build a new comparison or view, and save something others can reopen, without
rewriting supported physics. Record effort, failures, and missing pieces;
separately test whether learners understand and apply the concepts.

[PhET research](https://phet.colorado.edu/publications/prst-per-2010.pdf) supports
carefully designed opportunities for learners to ask and investigate questions.
[Astronomy representation research](https://doi.org/10.1103/PhysRevPhysEducRes.14.010145)
shows that diagram choices can affect learners' understanding.
[SimStep's authoring study](https://arxiv.org/html/2507.09664v1) illustrates both
the promise of agent-assisted simulation creation and the difficulty of keeping
its representations consistent. These motivate our approach; they do not yet
establish Cosmic Lego's educational effectiveness.

**The goal is to spend less effort rebuilding visualizations and more time
exploring astronomy.**

## License

Cosmic Lego is released under the [BSD 3-Clause License](LICENSE), a permissive
software license also used by [Astropy](https://docs.astropy.org/en/stable/license.html).
It permits use, modification, and redistribution, including commercial reuse,
with the required notices retained and no implied endorsement by the authors.

Unless otherwise noted, this license covers the project's code, examples,
documentation, and original assets to the extent the contributors hold the
relevant rights. Third-party materials and trademarks retain their own rights.
[arXiv's article licenses](https://info.arxiv.org/help/license/index.html) apply
to manuscripts; any future Cosmic Lego paper would be licensed separately.

---

The [getting-started guide](docs/getting-started.md) gives the default astronomy launcher and the separate astronomy-free workspace. The [exoplanet authoring guide](docs/exoplanet-authoring.md) covers the physical model, source recipe, gateway edits, portable delivery and v0.2 imports.
The implemented generic F01 API has its own [composition guide](docs/composition-kernel.md).
Scientific values, ports and calculations are covered in the [F02 dataflow guide](docs/scientific-dataflow.md).
Trusted model, operator, asset and view registration is covered in the [F03 extension guide](docs/extension-registry.md).
Analytic and stateful worker execution is covered in the [F04 runtime guide](docs/computation-runtime.md).
Authorable 3D scenes, scientific bindings, and reusable assets are covered in the
[F05 scene guide](docs/scene-and-assets.md), with a [runnable example](examples/scene-and-assets.mjs)
and [implementation handoff](docs/handoffs/F05.md).
The [F06 workspace guide](docs/planetarium-shell.md) covers floating views,
linked current-sample plots and the conversation UI boundary, with a
[public recipe](examples/workspace.mjs) and [handoff](docs/handoffs/F06.md).
The [F07 gateway guide](docs/command-gateway.md) covers discovery, shared SDK/CLI/HTTP
commands, atomic edits, retry identity and revocable turn permissions, with a
[public recipe](examples/command-gateway.mjs) and [handoff](docs/handoffs/F07.md).
The [F08 session guide](docs/in-app-agent-sessions.md) covers the local Codex adapter,
in-app conversation, scoped tools and Stop, with [verified evidence](docs/handoffs/F08.md).
The workspace can save named projects and exchange inspectable JSON files. Reopening
restores the construction and saved physical time with the agent disconnected.
See the [F09 project-file guide](docs/portable-projects.md), [runnable example](examples/portable-project.mjs)
and [verification handoff](docs/handoffs/F09.md).
F10 plays an authored sequence, seeks to a scientific comparison and exports the
same frames as PNGs. The [timeline guide](docs/authored-timelines.md),
[example](examples/authored-timeline.mjs) and [F10 handoff](docs/handoffs/F10.md)
cover the local player, offline package and reproducibility checks.
An independent author built a three-lane timing gate with no astronomy package installed.
Adding a fourth puck through the in-app agent changed its measured mean from ⅔ m to 1 m.
The [F11 evidence](docs/domain-independent-readiness.md) includes the editable project and offline replay commands.
Current capabilities and evidence belong in the [implementation record](docs/demo-status.md).
The [shared architecture roadmap](docs/infrastructure-roadmap.md) translates this
purpose into implementation tasks and agent prompts.
