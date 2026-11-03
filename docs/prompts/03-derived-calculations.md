# Implement authorable arithmetic and derived measurements

You are implementing task 03 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: 01 and 02, integrated and passing their acceptance checks. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Let an author register reusable calculations over model outputs through public handles. Read src/sdk.js, src/scene.js, experiments/agent-a-overlap.mjs and experiments/agent-a-report.md. Today an author can compute comparisons in their own process, but cannot retain a derived curve as part of the interactive creation.

Implement constants, selection of named output fields, per-object collection, and the arithmetic/reductions needed for flux comparisons and a period-versus-orbit-size scatter plot. Ordinary JavaScript loops and helper functions should construct reusable expressions; retain a serializable calculation representation for playback. Provide create/update/remove handles and atomic semantic operations. Support a trusted local extension route for new operators through task 02's registration mechanism, without evaluating arbitrary function strings on the server.

Build the concrete comparison F_naive = 1 - sum(1 - F_i), alongside the actual union-photometry result F_union and the difference F_union - F_naive. Every F_i must refer to the same unobscured star and physical observer. Label F_naive as a deliberately incorrect overlap approximation, not a supported measurement law. Preserve signed derived values instead of clamping every result into the physical flux range.

Derived curves need an explicit common time grid or a declared alignment method. The current photometers may have different adaptive sample times; never combine points by array index. Preserve approximation and sampling-budget warnings. Track computational dependencies separately from ordinary object relationships, invalidate results after relevant edits, and bound expression size/work.

Acceptance:

- At shared times the comparison agrees with an independent calculation. For this model, F_union - F_naive is nonnegative within tolerance, zero for disjoint silhouettes and positive for a genuine shared blocked area.
- An author transaction adds a planet, orbit and individual photometer; a live photometer selection then updates the reduction, while a fixed handle list keeps its explicit membership. A reducer never creates measurements implicitly.
- Missing inputs, arithmetic cycles, unit conflicts, division by zero and incompatible normalization are handled explicitly.
- A per-object scatter dataset can be authored without editing numerical kernels.
- Derived definitions survive a basic graph round trip; full project packaging comes in task 06.

Expose the feature through the existing SDK and operation route now; task 05 will unify detailed discovery. Do not invent an emission law from particle velocities or use JSON editing as the only authoring mechanism. Suggested seam: src/core/derive.js.

Keep this change bounded to task 03. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/03.md`. Do not describe mocked, unrun or planned functionality as implemented.
