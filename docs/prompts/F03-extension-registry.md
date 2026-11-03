# F03 — Implement extension registration and scientific contracts

You are implementing F03 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` or its designated checkout. Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, the current code, and handoffs F01–F02. The core must support independently authored scientific and visual building blocks, with no astronomy module required to start. The old exoplanet code will migrate in F12; do not make it the reference architecture here.

Prerequisites: F01 and F02 integrated and tested. Reuse their graph, identity, scientific-port, arithmetic, and result contracts. Resolve missing prerequisites explicitly instead of creating alternate validators or data types.

Implement a small registry for model, operator, asset-factory, and view-adapter extensions. A manifest declares stable namespaced identity, version and implementation/build identity, extension kind, parameters, input/output ports, dependencies, required runtime capabilities, and documentation. Scientific extensions additionally state equations/algorithm references, assumptions, applicability guards, supported sampling/evaluation behavior, diagnostics, and experimental/review status. Preserve the distinction between declared metadata and evidence that a reviewer actually checked it.

The composition root selects trusted installed modules and injects them. Kernel, scientific-dataflow, runtime, renderer, and UI code must not import domain packages or dispatch on domain names. Registered definitions supply authoring defaults, connection requirements, validators, calculation/model implementations, and visual adapters through published contracts. Asset factories produce declared geometry/material/data artifacts; they are not an untracked escape into arbitrary application state.

Separate ordinary learner authoring from model development. Learners and their agents instantiate, connect, compare, and revise installed blocks. Model authors can add trusted local modules, provide contracts and reference cases, and explicitly register experimental behavior. A normal project import or conversation command must not execute embedded source, fetch/install dependencies, or promote a generated scientific claim into a reviewed model. Preserve ordinary external author scripts and a documented developer extension workflow.

Provide machine-readable discovery sufficient for later command and agent-session tasks: schemas, examples, limits, dependencies, capabilities, and diagnostic codes. Add a small contract-test harness through which extensions supply meaningful reference cases, numerical tolerances, and applicability failures. Do not impose a universal conservation law or treat passing tests as scientific certification.

Acceptance:
- Independently register an analytic moving-point model, arithmetic operator, generic geometry factory, and view adapter without changing central dispatch.
- Discover their actual schemas and requirements through one public registry interface.
- Duplicate identities, unsupported versions, missing dependencies/capabilities, and incompatible ports fail clearly before project acceptance.
- Unavailable extensions remain identifiable when inspecting project requirements; they do not become empty valid results.
- Import-boundary checks and a startup run with no astronomy packages prove core independence.
- A saved project containing executable-looking source cannot register or run it.

Use the current JavaScript/Node environment incrementally. Avoid a marketplace, package downloader, universal ontology, provider-specific agent API, or full domain migration. Preserve the approved logo and BSD-3-Clause notices.

Deliver code, a developer registration example, contract tests, and documentation. Write `docs/handoffs/F03.md` with manifest/discovery interfaces, trust and review boundaries, dependency/version rules, checks, limitations, and what F04–F09 must consume.
