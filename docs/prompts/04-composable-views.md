# Implement composable linked views and drawing primitives

You are implementing task 04 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: 01 through 03, with shared results and derived outputs available. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Make presentation structure authorable. Read src/app.js, index.html, styles.css, the public SDK, and the new model/calculation contracts. The current viewer assumes one star, planet arrays and a single selected photometer; preserve the immersive stage while removing those assumptions from shared layout code.

Provide serializable view definitions and SDK/semantic handles for creating, arranging, binding and removing multiple views. Begin with the existing spatial scene, physical observer projection, multi-series plots, and text/value overlays. Extract reusable drawing primitives such as points, paths, axes and labels so authors can build new comparisons, including a scatter plot, without adding a special case to app.js. Domain-specific geometry/drawing adapters belong with their registered model or view module.

Every linked view must identify the scene revision and physical time of its data. Time scrubbing, selection and related-object highlighting should be consistent. Presentation cameras, size exaggeration and colors must not mutate physical observers or observables. Show units, normalization, model assumptions and approximation warnings where they affect interpretation. Do not silently hide an invalid binding.

Demonstrate one author recipe that places the orbital scene, a projected stellar disk, the true/naive flux curves and their difference together. Include a second arrangement using the same primitives to prove that the first layout is not a new fixed dashboard. Preserve the existing example-loading workflow.

Acceptance:

- An author creates and rearranges the views, and constructs a periapsis-versus-period scatter plot from public points, axes, labels and data bindings without editing app.js or renderer internals. Rearranging fixed widgets alone is insufficient.
- Scrubbing gives consistent cursors and current values across panels.
- Rotating the camera leaves flux unchanged; moving the physical observer updates the appropriate measurements.
- Removing a bound object follows documented reference handling.
- Inspect real rendered states at desktop and narrow widths, keyboard selection/playback, readable labels, and extreme numerical cases. Record the frames/interactions actually checked.

Reuse the current renderer when sufficient. Do not force a WebGL/Manim migration, full GUI editor, or decorative polish. Suggested seams: src/views/ and a thin application shell; retain an extension route beyond the initial four view types.

Keep this change bounded to task 04. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/04.md`. Do not describe mocked, unrun or planned functionality as implemented.
