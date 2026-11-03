# Implement scientific values and shared results

You are implementing task 01 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: None. Add this incrementally alongside the current exoplanet interfaces. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Give every calculation enough context to distinguish a number from a scientific quantity. Read src/physics.js, src/contract.js, src/scene.js and docs/physics.md. The existing public fields such as semiMajorAxisAU and timeDays should remain convenient to author.

Implement a small shared representation for scalars, vectors, per-object arrays, and sampled series. Describe units, quantity meaning, object/reference identity, coordinate frame where relevant, and physical time with its origin. A normalized flux must identify its normalization source. Keep presentation time and camera coordinates separate. Implement only the conversions exercised by the existing domain and small test fixtures; normalize at model boundaries, not repeatedly in rendering.

Define the common result envelope used by later models, calculations and views: project/scene identity plus revision (or an equivalent generation token), model identity/version, requested physical time or sample coordinates, values, validity diagnostics, and sampling/approximation metadata. A revision number alone can recur after project replacement. Distinguish instantaneous results from plotted samples. Do not silently interpolate, treat missing values as zero, or represent an unavailable model as an empty valid result.

Dimensions alone do not establish a physically meaningful connection. Provide explicit context that a model can check; do not claim a universal semantic checker. Distinguish calculation-dependency errors from model-applicability warnings. Keep these contracts small and document examples rather than designing a universal scientific ontology.

Acceptance:

- Equivalent SI and AU/day inputs produce equivalent existing orbital results within stated tolerances.
- Incompatible dimensions, non-finite values, unknown frames, and conflicting normalization references produce useful diagnostics where those contexts are required.
- A sampled curve retains its time coordinates and sampling warnings through serialization.
- Existing recipes keep working. A change of display units changes labels and representations, not physical results.

Do not add full celestial-coordinate catalogues, leap-second/time-standard machinery, symbolic algebra, uncertainty propagation, or new astronomy models. Suggested seam: src/core/values.js and a documented result contract; adjust locations to the actual checkout.

Keep this change bounded to task 01. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/01.md`. Do not describe mocked, unrun or planned functionality as implemented.
