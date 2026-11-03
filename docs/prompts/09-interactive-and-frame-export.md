# Implement portable interactive delivery and frame export

You are implementing task 09 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: 08 complete, including 04's views and 06's portable project format. Task 11 is not required for analytic models. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Deliver creations that another person can explore and that the creator can render for outreach. Read the project format, renderer/timeline interfaces and current launch scripts. Use the same physical evaluation and presentation-time evaluator for interactive playback and export.

Produce a local shareable folder containing the project, approved assets and required trusted runtime/model modules, with an explicit launch path and dependency manifest. It must reopen without author machine paths, an LLM, an API key or network retrieval. A small local server is acceptable; do not claim file-double-click portability if it requires one. Preserve license notices. Only package declared runtime modules, never auto-execute the saved author recipe.

Add a bounded frame-export command with explicit dimensions, frame rate, duration/range, background, sample-time convention and output directory. Pin an immutable project/timeline/model snapshot for the entire run. Drive frames by specified presentation times, not real-time screen recording or accumulated wall-clock delay. Export an image sequence and a manifest recording that snapshot, frame times, versions and numerical settings. Report incomplete exports clearly. Optional encoding may use an already verified local tool; a correct frame sequence is required.

Acceptance:

- Copy the delivery folder to a fresh directory, disconnect the authoring agent, and reopen it using documented dependencies.
- Play, scrub and select objects; linked values match the source project within stated tolerance.
- Export a short timeline covering a pause and a configuration switch. Edit the live project during export: output must retain the pinned snapshot or fail explicitly, never mix revisions.
- Compare selected frame-time numerical values with interactive evaluation, inspect first/last/boundary frames, and confirm labels, scales, dimensions and transparency where requested.
- Missing trusted runtime modules fail clearly; saved source never runs automatically.

Keep the approved galaxy logo and BSD notices in delivered materials where branding/notices appear. Document tested operating environment and reproducibility limits. No cloud publishing, paid rendering, full application installer, or mandatory Manim/Blender/video-editor integration. Suggested seams: scripts/export.mjs and a small delivery builder; avoid a second physics/render implementation.

Keep this change bounded to task 09. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/09.md`. Do not describe mocked, unrun or planned functionality as implemented.
