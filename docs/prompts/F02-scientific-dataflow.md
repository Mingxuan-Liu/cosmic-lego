# F02 — Implement scientific values, ports, and reusable arithmetic

You are implementing F02 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` or its designated checkout. Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, the current code, and `docs/handoffs/F01.md`. People and their agents need structural freedom to combine scientific objects, calculations, and views. Infrastructure must operate without astronomy-specific modules; exoplanet migration belongs to F12.

Prerequisites: F01 integrated and tested. Use its real graph, handles, transaction, and project-identity interfaces. If a prerequisite is missing, identify the gap rather than implementing a competing kernel or hiding it with a stub.

Implement small scientific value descriptions for scalars, vectors, per-object collections, fields, and sampled series. Include units/dimensions, quantity meaning, object/reference identity, shape, frame where applicable, normalization reference, and physical time/sample coordinates. Coordinate conventions must distinguish positions, directions, and display coordinates. Support a bounded set of conversions and explicit frame transformations demonstrated by software fixtures. Do not build a complete astronomical coordinate/time library.

Define scientific input/output ports and explicit connection checks. Equal dimensions alone cannot establish equivalent meanings, frames, normalizations, or sampling coordinates. The receiving component declares required context; a registered adapter supplies an actual justified transformation. Missing information or adapters must produce actionable diagnostics. Generic arithmetic may compare unlike references when the author explicitly defines that comparison; it must not silently relabel the result as a validated physical observable.

Expose create/update/remove handles for constants, field selection, arithmetic, per-object mapping, and reductions. Ordinary JavaScript can construct reusable expressions, while accepted projects retain a serializable calculation graph. Distinguish fixed collections from live selections. Selection/reduction must not silently create new physical models or measurements. Bound calculation size/work and diagnose computational cycles without banning ordinary relationship cycles.

Define the shared result envelope: project identity/load generation/revision, producing component and implementation identity, requested coordinates/time, values, validity diagnostics, and approximation/sampling metadata. Align samples explicitly by coordinates or a declared reevaluation/interpolation policy; never combine adaptive series by array index or replace missing values with zero. Preserve signed results and unit meaning.

Acceptance:
- Generic moving points `r(t) = r0 + v*t` produce equivalent results under compatible unit conversions.
- A scalar/vector-field fixture exposes coordinates, units, and field values without domain imports.
- Fixed/live collection membership and reductions update according to declared semantics.
- Unit/frame/normalization conflicts, division by zero, absent inputs, cycles, and misaligned samples produce useful diagnostics.
- Camera or display-unit changes cannot change scientific values.
- Calculation definitions, sample coordinates, and warnings survive a graph round trip.

These fixtures verify software contracts, not astronomical physics. Equations and domain applicability rules belong to extensions. Keep core independent of domain packages; a composition root supplies implementations. Do not execute arbitrary function strings or project source. Preserve existing working software, branding, and BSD-3-Clause notices.

Deliver working code, public examples, meaningful tests, and necessary documentation. Write `docs/handoffs/F02.md` with exact value/port/result schemas, arithmetic and alignment semantics, checks, limits, and downstream implications. Report executed evidence separately from plans.
