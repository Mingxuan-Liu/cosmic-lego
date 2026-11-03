# F09 — Implement complete projects, saving, and agent-free reopening

You are implementing F09 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` or its designated checkout. Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, the current code, and handoffs F01–F08. The application is a reusable astronomy authoring environment with a full-stage scene and in-app conversations with the user's agents. Project playback must remain useful without an agent. Infrastructure acceptance uses generic fixtures; exoplanet migration belongs to F12.

Prerequisites: the integrated F01–F08 contracts. Consume their actual graph, scientific values, registry, runtime, assets, UI layout, command, and conversation interfaces. Resolve missing prerequisites explicitly rather than duplicating their authority.

Implement one simple versioned project format, preferably a manifest plus local resources. Preserve accepted construction, calculation definitions, scientific units/frames/time conventions, model/operator requirements and implementation identities, numerical/random settings, data-source provenance, asset identities/licenses, scene bindings, and floating-panel layout. Reserve a bounded timeline extension for F10 without designing its animation language here. Distinguish required authoritative inputs from disposable derived caches and runtime-only objects. Cached values cannot substitute silently for incompatible required models.

Preserve the original author recipe as inert text, its identity, and the project state it produced. Label generated reconstruction source separately. Later agent or manual edits may make source and graph diverge; display that fact instead of pretending the source remains executable documentation of the current state. Rerunning source is an explicit author workflow, never part of ordinary loading or playback.

For stateful runs, record whether reopening replays from initial conditions or resumes a compatible checkpoint. Preserve required inputs/settings and, for continuation, checkpoint time, implementation/input identities and random-generator state. A seed alone is not continuation state. Reuse F04's lifecycle and expose incompatible checkpoints or replay limits honestly.

Treat conversation transcripts as project-associated records, distinct from a provider's resumable session. Reopened messages do not establish a live or resumed agent connection. Keep credentials and provider-private session state outside project files; define transcript inclusion for sharing explicitly so exporting a visualization does not silently export its private conversation. Preserve relevant accepted command/result associations without storing secrets.

Save a consistent accepted revision atomically. Track unsaved changes and avoid overwriting newer edits when an asynchronous save finishes. On loading another project, issue a fresh load generation so stale commands, calculations, or provider replies cannot mutate it. Resolve resources within the project boundary; reject path escapes, malformed manifests, unsupported versions, and missing requirements before replacing the current project. Do not execute project source, install modules, or fetch undeclared resources. Define a migration interface; F12 owns legacy exoplanet conversion.

Acceptance:
- Save, close, and reopen moving-point, accumulator, and field fixtures with definitions, assets, layout, source associations, and selected numerical results retained.
- Playback and inspection work with no agent connected.
- A seeded mid-run save/reopen resumes equivalently or explicitly reconstructs progress by the documented replay policy; it cannot silently restart at a different state.
- Missing models/assets, incompatible versions, interrupted writes, and stale saves preserve recoverable accepted work.
- Changing projects invalidates old results even when numeric revisions coincide.
- A transcript reopens honestly without credentials or a false resumed-session claim.
- Executable-looking source remains inert on import.

Keep the first format local and inspectable; no cloud storage, custom compression framework, or automatic publishing. Preserve branding and BSD-3-Clause notices. Deliver working code, examples, meaningful checks, and documentation. Record format/version rules, exact interfaces, recovery behavior, executed checks, limitations, and F10/F12 implications in `docs/handoffs/F09.md`.
