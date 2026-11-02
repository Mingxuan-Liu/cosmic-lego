# Blueprint comprehension review

2026-11-02. This records a qualitative review of the project charter in
[README.md](../README.md); it is not part of the charter itself.

## Method

Six agent readers received fresh conversation contexts in two groups of three.
Each was instructed to read only the README, without repository implementation,
prior conversation, or other readers' findings. They independently reconstructed
the intended product and identified competing interpretations. Prompts asked
about purpose, authoring authority, scientific responsibility, scope, enduring
commitments, and success evidence. They were asked to challenge the document,
not simply approve it.

The first group read the initial charter. The second group read the revision
after its substantive ambiguities were addressed. A separate research agent
checked primary educational and authoring sources used in the rationale.

These are separate agent contexts, not independent human studies or validation
across different model families. Agreement is evidence about the clarity of this
text under these readings; it does not prove feasibility, scientific correctness,
educational efficacy, or complete agreement with every future collaborator.

## What the first readings recovered

All three readers described an extensible authoring environment in which people
and their agents construct physical relationships and explanatory representations.
They understood structural interaction, finite ingredients supporting unforeseen
constructions, explicit scientific contracts, and an architecture not fixed by
the initial domain. None interpreted the goal as a preset simulator catalogue.

Their objections exposed several decisions that the original draft left too
implicit:

| Possible divergence | Clarification incorporated into the charter |
| --- | --- |
| A bare component library versus a usable product | The intended product includes a reusable toolkit and a reference authoring/exploration environment. “Language” does not require a new programming language. |
| Parameter editing versus substantive invention | Agents author physical structure and explanatory representations. Local helpers, derived quantities, visual operators, and compositions are part of ordinary authoring within supported models. |
| Unsupported work prohibited entirely versus silently accepted | Incompatible drafts remain inspectable; experimental model development is visibly distinguished from supported scientific predictions. Model admission has additional evidence and review obligations; routine supported composition has no per-scene approval requirement. |
| Cross-domain composition treated as matching fields | Mappings account for scientific meaning, units, frames, timing, state, feedback, relevant conservation, and approximations. |
| Video export discards the scientific construction | Rendered media remains traceable to retained, editable source and scientific provenance. |
| “Future-proof” requires identical output forever | Preserve construction and scientific results under stated tolerances or statistical criteria; expose model changes during migration. Pixel identity is unnecessary. |
| Every learner must program or bring an agent | Existing exploration works without either. New structural authoring may use agents or code through the same construction. |
| Creator productivity and learner inquiry lack a practical priority | Original explanation production is the first proving ground; reuse and investigability guide early tradeoffs. Classroom effectiveness requires separate evidence. |
| Success is too easy to claim from a polished preset | The independent-author challenge requires unfamiliar physical rearrangement, a new derived comparison, authored presentation, and a reopenable result through the public interface. |

Diagram feedback also led to explicit contract coverage across physical,
measurement, and explanatory components; a proposed rather than presumed-correct
construction; a review-to-revision path; and retained provenance behind all
output forms. Final layout refinements retained those meanings.

## Second independent reading

Readers D, E, and F converged on the following interpretation:

| Dimension | Shared reconstruction |
| --- | --- |
| Purpose | Make an unforeseen astronomical question become an accountable, explorable explanation using reusable scientific ideas. |
| Product | An extensible toolkit plus a reference environment; neither a bare library nor an isolated fixed dashboard is sufficient. |
| Authoring freedom | Create, remove, reconnect, transform, derive, measure, compare, and author views and sequences. |
| Scientific responsibility | Models evaluate declared physics; contracts and tests check known requirements; review addresses their limits. An agent is not the source of physical authority. |
| Trust boundary | Supported composition, unresolved drafts, and experimental model development remain distinguishable. Approximation alone does not make a model unsupported. |
| Scope | Astronomy anchors the purpose, with domain-specific models and explicit cross-domain mappings. No universal solver or unrestricted validity claim is implied. |
| Interaction | Existing artifacts support inquiry without LLM access; agents or code can construct new structures and explanations. |
| Continuity | Retain editable constructions, model/data identity, assumptions, intent and provenance; reproduce scientific results under declared criteria. |
| Open choices | Languages, protocols, serialization, solver families, renderer, platform, Manim adoption, and domain order remain implementation choices. |
| Success evidence | Independent authoring, scientific reliability, reproducibility, and learner reasoning must be evaluated separately. |

One reader applied the charter to an unfamiliar question: whether a hotter star
necessarily looks brighter. Their proposed construction distinguished fixed
radius from fixed luminosity, included observer and band-response assumptions,
and separated an idealized thermal-emitter model from real stellar atmospheres
or evolution. This was a comprehension exercise, not an implemented simulation.

The final readers found no major conflicting purpose-level interpretation in the
complete text. They identified remaining implementation questions: how to admit
and review individual models, distinguish borderline derived functions from new
observation laws, package retained artifacts, and set measurable usability and
learning criteria. Those questions require concrete domain and user evidence;
the charter intentionally does not settle their mechanisms in advance.

## Document checks

- README contains eight Mermaid diagrams and no usage commands, API recipes,
  version history, or current-domain limits.
- Practical material is retained in [the authoring guide](getting-started.md).
- Local Markdown links were checked.
- All eight diagrams rendered in a local Mermaid preview; layout was inspected
  and an overly dense component diagram was simplified.
- AGENTS.md now directs future agents to the charter first and distinguishes
  its enduring commitments from current-domain implementation rules.

No application behavior was changed. The appropriate next review is the
project owner's reading of the charter, followed by real authoring and learner
evidence as implementation proceeds.
