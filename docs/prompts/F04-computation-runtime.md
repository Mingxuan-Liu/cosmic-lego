# F04 — Implement analytic and basic stateful computation lifecycles

You are implementing F04 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` or its designated checkout. Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, the current code, and handoffs F02–F03, following F01 references as needed. Build genuinely reusable computation infrastructure before astronomy topics. The exoplanet prototype is a later F12 migration/regression target.

Prerequisites: F02 and F03 integrated and tested. Consume their scientific values, ports, identities, registered capabilities, and result envelopes. Do not invent a second graph, units layer, or extension mechanism.

Implement both runtime capability paths now. Analytic components evaluate requested physical times/sample coordinates directly. Stateful components expose initialization, bounded advancement, result extraction, and checkpoint/restore. Define state ownership and lifecycle explicitly. A component may advertise one or both paths; unsupported requests must return meaningful capability errors. The scientific extension supplies its equations, integrator, tolerances, and applicability conditions. The runtime is a scheduler, not a universal solver.

Separate physical evolution from display frame rate and presentation time. Coordinate dependent computations from shared scientific snapshots, preserving requested and actually achieved physical times. If a stateful component cannot land exactly at a requested time, it must report its result coordinates and declared sampling policy rather than fabricate alignment. A computational cycle needs an explicit coupled model/solver; ordinary object relationships may still cycle.

Provide bounded jobs, cancellation, progress, resource limits, and invalidation when relevant inputs change. Tag results and checkpoints with project/load identity, revision, component implementation, input identity, numerical settings, and random-state information where needed. Late results from another project or revision cannot replace current results. Use a worker/process boundary where needed for a responsive application; do not rely on an uncancellable synchronous loop behind a cancellation button.

Implement a documented backward-seek strategy using reset/replay or compatible checkpoints. Never reverse a dissipative algorithm to imitate rewind. Preserve analytic random access as a simple path. Leave checkpoint serialization accessible to F09 without requiring a final project archive format here.

Acceptance fixtures, all explicitly labeled software tests:
- Analytic moving points follow `r(t) = r0 + v*t` at requested times without astronomical objects.
- A deterministic stepping accumulator agrees between fresh, sequential, and checkpoint-resumed runs under declared criteria.
- A seeded stochastic accumulator retains algorithm and generator state across resume; a seed alone is insufficient.
- Display frame-rate changes leave computed trajectories unchanged.
- Cancellation, exhausted budgets, changed inputs, and switching projects reject stale results and leave diagnostics visible.
- Dependency results use declared times and preserve approximation warnings.

Keep core/runtime independent of domain imports; registered implementations arrive from the composition root. Do not execute project source, add GPU/distributed computing, implement astrophysical solvers, or hide numerical errors as zeros. Preserve branding and BSD-3-Clause notices.

Deliver working capabilities, fixture examples, meaningful tests, and measured responsiveness/resource observations. Write `docs/handoffs/F04.md` with lifecycle signatures, time/seek semantics, cancellation guarantees, checkpoint identities, executed checks, limits, and integration requirements for rendering, agents, and persistence.
