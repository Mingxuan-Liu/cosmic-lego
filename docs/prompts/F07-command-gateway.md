# F07 — Implement discoverable commands and one validated write gateway

You are implementing F07 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` or its designated checkout. Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, the current code, and dependency handoffs F01–F05. People and their own agents must construct objects, relationships, calculations, and interactive views, not merely adjust presets. The foundation must operate without astronomy packages; exoplanet migration belongs to F12.

Prerequisites: F01–F05 integrated and tested. Consume their real composition, scientific-dataflow, registry, runtime, and scene interfaces. Identify missing prerequisites explicitly rather than creating competing implementations or concealing them with stubs.

Coordinate registered view/overlay commands with F06, which may run in parallel. Once integrated, discovery must expose additional plots and their bindings, duplication, arrangement and removal without hard-coded shell widgets. F08 verifies this combined path.

Provide one public command gateway shared by SDK, CLI, local HTTP, and F08's future agent tools. Expose discovery, inspection, creation, update, connection/disconnection, arithmetic, registered scene/view construction, evaluation, transaction preview/commit, and undo/redo. Derive machine-readable input/output schemas, defaults, examples, limits, required capabilities, and diagnostics from registered declarations. Avoid a manually maintained second schema or domain-name dispatch. Ordinary author recipes retain loops, functions, and structural freedom through public handles.

Reuse F01's atomic transactions and accepted-state authority. External writes require the expected project identity, load generation, and revision; a preview must not mutate anything, and committing must revalidate against current state. Add idempotency keys bound to request content and mutation context: retrying a committed request returns its original outcome without duplicating objects; reusing a key with different content fails. Document the retention window and restart behavior instead of promising durability before F09 exists. Undo restores content with a fresh revision.

Scope agent-originated requests to a host-issued project/session/turn context. Provide the lifecycle hooks F08 needs to revoke a turn's ability to commit. Cancelled turns, switched projects, and late computation results cannot write into the current project. Do not treat a caller-supplied turn label as authorization. Existing committed effects remain visible after cancellation; undo is a separate validated operation.

Routine authorized reversible edits should apply and appear immediately, with a change summary and Undo. Preview is an available inspection tool, not a mandatory approval dialog before every edit. Keep authorization decisions distinct from scientific validation. Unsupported operations must not fall back to editing live project files, numerical kernels, arbitrary source execution, or guessed physics.

Return structured failures with stable codes, affected handles/paths, project context, and supported repair actions. Distinguish malformed input, unavailable capability, incompatible scientific connection, applicability failure, exhausted computation budget, stale state, and cancelled work. Failed batches preserve accepted state and report enough information for an agent to repair its request.

Acceptance:
- Through discovery alone, a client constructs generic moving points, a calculation, and visual bindings without domain modules.
- SDK, CLI, and HTTP agree on validation, mutations, and evaluated results.
- Preview is non-mutating; competing commits and duplicate retries behave correctly.
- Invalid batches, reused idempotency keys with changed payloads, stale project tokens, and cancelled-turn writes leave accepted state intact.
- An authorized edit updates the scene without an extra confirmation, and Undo restores content under a new revision.

Preserve loopback/origin safeguards, bounded work, approved branding, and BSD-3-Clause notices. Do not implement an agent provider or conversational UI here. Deliver code, runnable public-interface examples, tests, guide updates, and `docs/handoffs/F07.md` documenting contracts, identity/idempotency semantics, repair behavior, checks, limitations, and F08 integration requirements.
