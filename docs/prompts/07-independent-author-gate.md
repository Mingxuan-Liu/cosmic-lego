# Implement independent authoring and infrastructure readiness check

You are implementing task 07 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: 01 through 06 integrated and documented. This task is the gate before broad topic expansion. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Test whether the infrastructure actually enables an unfamiliar construction. Read README.md, docs/demo-status.md and the implementation handoffs, then organize a fresh authoring exercise. Separate the challenge author from implementation/review roles: the author receives public documentation, entry points and the task only, not private engine guidance.

Ask the author to construct a new multi-planet case with distinct inclinations/eccentricities, add and remove an object and a measurement, create actual union flux and a deliberately naive sum-of-deficits comparison, arrange at least three linked views, and save/reopen the result without an LLM. Include a held-out variation chosen after implementation, such as a selective photometer with a second observer. Include an intentionally incompatible normalization that must be diagnosed, or renormalized only through an already-supported explicit conversion. The author must encounter and explain one unsupported physical request using discoverable capabilities rather than modify the core.

Do not quietly patch the engine during the challenge. Record every missing primitive, clarification, failed call and requested engine edit. Preserve failed attempts, fix the owning tasks separately, then rerun a fresh held-out variation rather than hard-code the original challenge. Preserve author recipes and interaction transcripts with no credentials.

Evaluate separate kinds of evidence:

- Numerical agreement with existing independent reference cases and explicitly chosen tolerances.
- Structural freedom through public handles and operations.
- Consistent times/revisions across rendered measurements and plots.
- Save/reopen fidelity, original-source retention and no agent dependency during playback.
- Whether an independent author can understand the required units, assumptions and failures.

Run the existing relevant tests and new contract/round-trip checks. Inspect actual visual states and exercise interaction; test success alone is insufficient. Report author effort and assistance, and distinguish independent contexts from independent model families. No student-learning claim follows from this exercise.

Deliver a concise readiness report, runnable challenge recipe/project and evidence. State which conditions pass, which remain blocked and whether a second domain can start. Do not add a domain, redesign the engine to suit one challenge, or certify universal composability. This task's permitted code is the challenge fixture and verification harness; infrastructure fixes belong in their owning tasks.

Keep this change bounded to task 07. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/07.md`. Do not describe mocked, unrun or planned functionality as implemented.
