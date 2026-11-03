# F01 — Implement the domain-independent composition kernel

You are implementing F01 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` or its designated checkout. Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the current code. The product lets people and their own agents construct interactive astronomy visualizations from reusable pieces. Infrastructure must work before any astronomy package is installed. The existing exoplanet prototype is a later F12 migration/regression target, not the generic readiness test.

Prerequisites: none. Build the smallest working composition kernel, incrementally using the existing JavaScript/Node environment. Do not choose a permanent renderer or rewrite unrelated code. Inspect current stable-handle and atomic-edit behavior for useful guarantees without carrying its stellar vocabulary into the new core.

Implement a generic project graph with stable component IDs, typed relationship instances, explicit references, and room for calculation and presentation definitions. A project can be empty or contain only geometric/data fixtures. Core schema must not require bodies, stars, planets, orbits, physical observers, or a particular measurement. Separate reference relationships from computational dependencies; ordinary relationships are not globally required to form a directed acyclic graph.

Expose public handles and atomic operations for creation, update, connection, disconnection, removal, and dependency inspection. Ordinary author code must remain able to construct arrangements with loops and helper functions. Support incomplete staged drafts: an object may acquire required relationships before final validation. Validation at acceptance must be authoritative; failure leaves the accepted project untouched. Make deletion behavior explicit, including rejected referenced removals and deliberate cascading removal.

Provide non-mutating transaction preview and accepted-state undo/redo. Undo restores content but issues a fresh revision; it must not resurrect an old mutation token. Distinguish project identity, runtime/load generation, and revision so loading another project or an older saved revision cannot make stale commands valid. Do not conflate edit history with an authored animation timeline. Define injectable structural/type-validation hooks for later registration and exercise them with real fixture validators.

Acceptance:
- An empty project and generic point/label components can be authored without astronomy modules.
- Multi-operation failure, broken references, duplicate IDs, and stale tokens preserve accepted state.
- A draft gains its missing relationship and then validates successfully.
- Undo/redo restores IDs and references; a new edit after undo handles the redo branch explicitly.
- Valid relationship cycles work; dependency queries and cascade removal terminate correctly.
- Core imports do not reach domain packages, directly or transitively. The composition root supplies extensions.

Keep author scripts in the author's own execution process. Project data and routine learner commands must never execute stored source or import unknown modules. Do not implement scientific equations, agent providers, cloud collaboration, or persistence packaging here. Preserve the approved logo and BSD-3-Clause notices.

Deliver code, public-interface examples, meaningful tests, and guide updates. Run applicable checks and report actual results. Write `docs/handoffs/F01.md` describing concrete interfaces, identity/revision semantics, draft/acceptance rules, files changed, checks, limitations, and requirements for F02–F09. Do not claim planned or mocked capabilities are complete.
