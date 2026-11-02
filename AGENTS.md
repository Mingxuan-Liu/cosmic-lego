# AstroCompose — contributor and agent instructions

AstroCompose explores composing scientific models, observations, and explanations.
The first domain is exoplanet detection. This is an experimental prototype, not a
general astronomy simulator or a claim of universally valid composition.

- Read README.md, docs/architecture.md and docs/physics.md before changing behavior.
- Author scenes through scene.schema.json and the documented CLI/API. A scene is
  declarative data; it must never contain executable code or remote dependencies.
- Physics belongs in src/physics.js. Scene validation/composition belongs in
  src/scene.js. Rendering and display exaggeration belong in src/app.js.
- Do not silently broaden physical assumptions. Unsupported physics requires a
  separate reviewed model, documentation, and independent reference tests.
- Preserve a shared physical clock and consistent observer conventions. Labels,
  colors, zoom and explanatory size exaggerations must not alter measurements.
- Derive orbital separation from period and masses. Never independently animate
  a light curve or radial velocity unrelated to the physical state.
- Run `node --test` for model/API changes. Inspect relevant browser views after UI
  changes; program execution alone is insufficient visual/scientific validation.
- Runtime validation checks declared contracts, not all possible scientific truth.
- Keep the demo local, dependency-light and provider-independent. Do not add API
  keys, accounts, paid services, publishing, or an embedded LLM without a need.
- Preserve source provenance and label schematic scale. Do not represent a
  toy model as observed data or a numerically validated plasma/universe solver.
- Record provisional architecture decisions and limits; prefer a small working
  example over speculative infrastructure. Public release license is undecided.
