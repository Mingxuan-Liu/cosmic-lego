# Implement registered physical models and coupling rules

You are implementing task 02 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: 01, including its value/result contracts and integrated handoff. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Extract the existing physics behind a small model-registration boundary. Read src/contract.js, src/scene.js, src/sdk.js, src/physics.js, docs/physics.md, and the existing physics/authoring tests. Preserve numerical algorithms and reference cases.

A registered model needs a stable identity/version, machine-readable parameter/connection/output declarations, assumptions/applicability guards, references, evaluator, and optional sampling hook. Scientific guard functions supplement those inspectable declarations; task 05 must be able to consume them without reverse-engineering opaque validators. Put the existing Kepler motion and uniform-disk transit measurement into explicit model modules. The transit sampler's event-guided refinement remains model-specific. Define how a measurement consumes the same evaluated positions used by the scene; independent calculations must agree within declared tolerances.

The shared graph should manage identity, references, transactions and dispatch. Rules such as one stellar host, one Kepler orbit per planet, the mass-ratio guard and periapsis constraints belong to the current model. Keep world.star(), planet(), orbit() and transits() as public conveniences backed by the new boundary. Preserve staged SDK drafts: a new planet may acquire its orbit before build/publication validates the complete construction.

Allow trusted, repository-local model/operator modules to register without adding branches to a central domain switch. Scene files contain identifiers and parameters, never executable plug-in source. Mark experimental extensions honestly; tests alone do not confer scientific-review status. Supply a small harness through which a model contributes reference cases, tolerances and applicability failures.

Acceptance:

- Existing exoplanet recipes and independent numerical tests remain valid.
- A tiny constant or analytic-signal test module runs without a star and without edits to central dispatch.
- Unknown versions and missing physical adapters fail clearly. A quantity with matching units but the wrong required reference cannot connect silently.
- Valid object-relationship cycles are not globally prohibited. Computational dependency cycles are diagnosed; coupled feedback needs an appropriate model/solver.
- Validation or compilation failure leaves the accepted scene unchanged.

Do not implement another educational domain, universal solver, downloaded plug-in marketplace, or a rewrite into a new language. Suggested seams: src/core/models.js and src/models/kepler/. Keep compatibility explicit rather than maintaining two competing engines.

Keep this change bounded to task 02. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/02.md`. Do not describe mocked, unrun or planned functionality as implemented.
