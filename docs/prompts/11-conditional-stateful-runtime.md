# Implement conditional runtime for costly or stateful models

You are implementing task 11 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: 07 passed. Start only when the next domain or a measured workload needs incremental computation or background jobs; analytic Kepler playback does not require this first. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Extend evaluation only as far as a demonstrated stateful or costly model requires. Read the shared result/model contracts, current sampling limits and revision handling. Preserve direct analytic evaluation for existing models; do not replace it with an unnecessary integrator.

Choose the capability group justified by the workload. Costly analytic sampling needs job scheduling, not a stepping interface. Only a genuinely stateful workload needs initialization, bounded stepping, checkpoint/restore and result extraction, distinct from stateAt(t). The physical model owns integration and validity conditions; the shared runtime schedules work and prevents stale results replacing current state. Separate physics time steps from display frame rate.

For interactive work, provide cancellation, progress, bounded resources and results tagged with job, project identity and revision. Use a worker/process boundary where measurement shows it is needed. Include model/operator versions/build identities, initial state, requested times, settings and applicable random state in cache/checkpoint identity. Seeds alone are insufficient for a resumed stochastic run. For stateful models, backward seeking needs replay/checkpoints; never fake it by integrating a dissipative model backwards.

For analytic-only scheduling, use a bounded analytic workload. If stateful support is required, add tiny deterministic stepping and seeded stochastic fixtures to test fresh/resumed runs, step changes and random access. These are contract tests, not validated astronomy domains. Connect any checkpoint metadata to task 06's format with an explicit compatibility policy.

Acceptance:

- For implemented stateful capability, sequential and checkpoint-resumed results agree under declared criteria.
- Frame-rate changes do not alter physical trajectories.
- Editing or replacing the project invalidates an old job; a late completion cannot overwrite a different project even if its numeric revision matches.
- Exhausted work budgets and unresolved accuracy are visible rather than silently truncating data.
- Analytic exoplanet examples retain their reference results and simple path.
- Document measured latency/memory before and after; do not claim performance gains without measurements.

Do not build a universal plasma solver, GPU/distributed backend, global adaptive integrator or all-domain conservation checker. This infrastructure enables a later domain model; it does not provide that model's physics. Suggested seam: src/runtime/, reusing common scientific result envelopes.

Keep this change bounded to task 11. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/11.md`. Do not describe mocked, unrun or planned functionality as implemented.
