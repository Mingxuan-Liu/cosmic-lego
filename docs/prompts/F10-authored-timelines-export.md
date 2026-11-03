# F10 — Implement authored timelines and reproducible local delivery

You are implementing F10 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` or its designated checkout. Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, the current code, and handoffs F05, F06, and F09, following their runtime/kernel dependencies. Cosmic Lego combines interactive exploration with original authored animation. Use generic moving-point, accumulator, and field fixtures; the exoplanet prototype is a later F12 migration target.

Prerequisites: F05, F06, and F09 integrated and tested. Reuse their renderer, full-stage application, project format, and scientific runtime. Implement one small authoring-to-delivery path.

Define an authorable timeline with a single deterministic presentation evaluator. Interactive playback, seeking, and frame export must request this same evaluator. Separate presentation time from physical time: pauses, speed changes, camera movement, visibility, annotations, and panel emphasis have explicit tracks. Camera/appearance tracks cannot modify scientific outputs. A physical-time track controls requested computation time; stateful models obey F04's checkpoint/replay policy rather than being numerically integrated backwards.

Support explicit configuration comparisons and structural changes as validated graph transactions at authored boundaries. Specify ordering when events share a timestamp. Evaluate these in an isolated playback configuration; seeking and exporting must not commit events into the live authoring project or its undo history. Seeking to a time must reconstruct the same configuration without applying an event repeatedly. Do not interpolate arbitrary topology or imply that changing a parameter is a conservation-respecting physical impulse. Such interventions require a model that actually defines their physics.

Provide public timeline handles and commands, saving their definitions through F09's extension mechanism. Demonstrate a short sequence that groups generic moving points, changes presentation speed, pauses for a derived comparison, adjusts camera framing, and switches an explicitly labeled configuration. Include a stateful fixture to verify seeking and a field fixture to verify data-bound color/geometry consistency. These remain software-contract examples, not validated physical demonstrations.

Export an image sequence from one immutable project/timeline snapshot using an explicit frame schedule, dimensions, and frame rate. Concurrent authoring cannot alter that export. Wait for required scientific results and asset readiness; do not capture whichever asynchronous state happens to be visible. Write a manifest recording project/model identities, settings, presentation and physical times, configuration boundaries, warnings, renderer details, and output filenames. Define numerical reproducibility criteria separately from pixel identity across graphics devices. Interrupted export must leave identifiable completed frames and an honest completion status.

Also produce one portable local player package with documented launch requirements, assets, notices, and trusted installed runtime/modules needed for the creation. Do not turn embedded recipe strings into player code or require an LLM/provider account. No automatic publishing, installer framework, narration generation, or mandatory Manim integration.

Acceptance:
- Interactive and exported frames agree on configuration, requested times, and numerical values at shared timestamps.
- Concurrent live edits cannot mix revisions, models or assets within an export; seek/export leave the authoring project's revision and undo history unchanged.
- Seek/replay does not duplicate structural events or alter state through frame-rate changes.
- Camera and overlay changes leave scientific results unchanged.
- The player reopens on a clean local test environment without an agent.
- Inspect representative frames, transitions, labels, occlusion, and export completion behavior.

Preserve branding and BSD-3-Clause notices. Deliver working examples, meaningful checks, and inspected output. Write `docs/handoffs/F10.md` with timeline semantics, evaluator/export interfaces, delivery requirements, executed evidence, limitations, and follow-up needs.
