# Implement authored timelines and explicit presentation time

You are implementing task 08 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: 07 passed; consume task 04's views and task 06's project format. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Implement a small deterministic presentation timeline for original astronomy animations. Read the current playback/cue code in src/app.js, the eccentricity examples, and the new project/view contracts. Current physical-time annotations and runtime mutation history are not an authored sequence.

Introduce an evaluator for presentation time tau that returns active configuration, physical time, view arrangement, camera state and annotations. Support pauses, explicit time-rate mappings, camera transitions, visibility/label changes, and switches between saved model configurations. Store the authored timeline in the project document and expose its construction through the SDK. Keep presentation time distinct from the physical model's time coordinate.

Changing eccentricity or another physical parameter during a lesson is a configuration comparison unless a physical model defines the intervention. Do not tween orbital parameters as though conservation-respecting evolution had been calculated. Interpolate supported presentation properties only; define transition behavior and boundary times. Seeking must derive state from the timeline rather than depend on the sequence of previous animation frames.

Acceptance:

- Author a short comparison of eccentricity changes at fixed semimajor axis versus fixed periapsis, using existing physics.
- Pause on the derived periods, move the camera, change labels and switch configurations with the distinction visible.
- Direct seek, reverse seek, and sequential playback at the same presentation time agree on physical results, configuration and presentation state.
- Saving/reopening preserves the sequence.
- Reduced preview frame rate changes smoothness, not the modeled outcome.
- Inspect representative frames at pauses and configuration boundaries.

Reuse the common evaluated state/results. Keep numeric evaluation callable without the DOM, and keep rendering separate from timeline construction so task 09 can export using this exact evaluator.

Do not implement audio production, narration generation, full video editing, arbitrary physical interventions, or a new animation language. Manim is an optional future presentation adapter, not a prerequisite. Suggested seam: src/timeline/ plus public SDK methods; update the author guide and one reusable scene recipe.

Keep this change bounded to task 08. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/08.md`. Do not describe mocked, unrun or planned functionality as implemented.
