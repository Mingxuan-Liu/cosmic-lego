# AstroCompose: architecture decisions

Decision date: 2026-11-01. Status: provisional prototype design. This note records the intended boundaries; the README and demo status record what has actually been implemented and checked.

AstroCompose is a compositional astrophysics visualization toolkit for exploration and explanation. The first demonstration connects orbital geometry, transit flux, and stellar radial velocity. Its useful unit is a physical model with an explicit contract, not a decorative asset or an unconstrained generated program.

## 1. Independent physics; replaceable presentation

Use small JavaScript ES modules with pure numerical functions that can run in both Node and a browser. Keep physics independent of the DOM, canvas, UI, wall-clock time, and language model. A saved scene specifies systems, observers, views, parameters, and playback speed. Physical time is a separate runtime input shared by every view; the current playhead is not saved in scene JSON.

```text
Human or external agent
        ↓
Versioned scene JSON → validation → physical state at time t
                                           ↓
                                observer measurements
                                           ↓
                             browser views / later exports
```

The current presentation direction is a browser interface served by a small local Node server, with no external package dependencies. This makes the demonstration easy to inspect and keeps the physical core reusable. The server and CLI are thin access paths to that core, not separate implementations of its equations.

### Why not start as a Manim extension?

Manim already provides valuable animation, camera, text, and equation machinery. It remains a plausible later presentation adapter for narrated sequences. However, the first experiment needs editable physical scenarios, direct parameter interaction, and several synchronized measurements. Making those semantics depend on Manim objects would unnecessarily couple the scientific library to one presentation system.

This is a scope decision, not a claim that Manim cannot support interaction. Reconsider the adapter after the same scene can drive a useful interactive demonstration and a short deterministic export. Do not build two independent physics implementations to serve those outputs. See [references](references.md) for the relevant project documentation and architectural precedents.

## 2. Contracts are executable boundaries

Scene JSON is data. Version 0.1 implies one fixed circular two-body model; there is no model-selection field yet. The application validates required values, finite numbers, parameter ranges, unique identifiers, and cross-references before evaluating it. Domain validation additionally checks geometric intersection and numerical range. Omitted effects are rejected as unsupported fields, while astrophysical realizability of every mass/radius pair is not checked. A JSON schema alone cannot establish physical validity.

The LLM may select components, set permitted parameters, connect supported views, and explain the resulting scene. It does not gain a new physical capability by describing it in a prompt. Unsupported effects require a separately implemented and checked model; instructions such as “obey conservation laws” are not an enforcement mechanism.

Each model needs:

- Parameter units and coordinate/sign conventions.
- Its equations, approximations, supported range, and omitted effects.
- Defined state and observable outputs.
- Reference cases, limiting cases, and failure behavior.

Visual choices are separate parameters: magnified bodies, camera movement, colors, annotations, and playback speed must not change the physical values used to calculate observables. Exaggerated scales must be labeled in the relevant view.

## 3. First physical domain: circular star–planet systems

Start with a Newtonian circular two-body model, including stellar motion about the barycenter; a spherical star with uniform projected brightness; an opaque, dark spherical planet; and distant observers. Compute transit flux from foreground disk overlap, and radial velocity from the star's velocity projected onto the observer's line of sight. Document the convention for positive radial velocity in the implementation and UI.

Multiple systems, observers, and views can be composed in a scene. Multiple systems are independent comparisons; their coexistence does not imply gravitational coupling, shared illumination, or combined unresolved photometry. Several observers of one system should change the projected measurements without changing that system's intrinsic evolution.

Use one simulation time for synchronized views. Changing playback speed changes presentation time, not the orbital period or velocities. A view may sample a curve over an interval, but its current-time marker must correspond to the same state shown elsewhere.

The initial model omits eccentricity, planet–planet interactions, limb darkening, stellar activity, reflected/emitted planetary light, instrumental noise, exposure integration, and light-travel delays. It demonstrates geometry and idealized signals; it is not a fit to observational data or a complete detection pipeline. Independent stellar mass and radius controls describe a toy system, not an enforced stellar-evolution relation.

## 4. Local browser application before desktop packaging

A local web interface gives the user an interactive application while preserving ordinary files and an inspectable repository. It does not require a public website, account, hosted backend, or desktop wrapper. Keep the server local and avoid adding accounts, deployment, synchronization, or native packaging until there is a demonstrated need.

An eventual shared teaching version should preserve exportable scenes and clear model limitations. Its accessibility, browser compatibility, hosting, and classroom workflow will need separate validation. A local demonstration does not establish those properties.

## 5. Use the user's agents; do not embed a model

The integration surface consists of CLI and local HTTP operations for discovering capabilities, reading the schema, reading/updating a scene, and evaluating supported physics. Exact commands and routes belong in the README so that this note does not duplicate their specification. All paths should use the same validation and evaluation functions.

No API key or embedded LLM is required to run the demonstration. An agent capable of reading local files and invoking a CLI or local HTTP service can compose scene data using the exposed contract. That is an interface design, not a claim of compatibility testing with every agent client. Provider credentials remain with whichever external client the user chooses.

An MCP adapter is a possible later convenience and is **not implemented in this prototype**. It should wrap the same operations rather than introduce a separate scene format or privileged physics path. Do not present ordinary local HTTP endpoints as an MCP server.

## 6. What would count as progress?

The first useful checks are consistent phase across views, barycentric motion, geometric transit limits, inclination dependence, and clear handling of invalid scenes. Compare outputs with independently calculated reference values; a successful render, schema acceptance, or an LLM's approval does not establish scientific correctness.

After this demonstration, test a few requested variations without modifying the physical core. Record whether the composition contract is expressive enough, how much expert correction is required, and whether the visual explanation remains intelligible. Add another topic only when it exposes a concrete reusable need. “Extensible” means new supported models can be added; it does not mean arbitrary combinations are already valid.

## 7. Working name

Choose **AstroCompose**: it describes constructing astrophysical explanations and leaves room beyond exoplanets. Exact-name web searches, including GitHub/PyPI/npm-targeted queries, returned no matches on 2026-11-01. That limited search does not establish trademark, domain, or package-name availability. AstroWeave had an existing repository; AstroLoom had an active software company and an astrology app. Astralgebra was less clear and could suggest a symbolic-algebra system. See the linked evidence in [references](references.md).
