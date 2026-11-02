# AstroCompose: agent-built scientific worlds

User clarification, 2026-11-02: the goal is an extensible construction environment.
Agents must create bodies, attach physical relationships, create measurements,
and arrange explanations. A fixed experiment with exposed parameters is insufficient.

- Start with README.md, docs/physics.md and docs/agent-interface.md.
- Author with the public `World` SDK in `src/sdk.js` or discover semantic tools
  with `node scripts/agent.mjs tools`. JSON is persistence/transport, not the
  intended limit of the authoring vocabulary. Do not hand-edit numerical kernels
  to fulfill a request already expressible through handles and relationships.
- The scene graph separates bodies, orbits, observers, measurements and annotations.
  Stable handles support creation, attachment, modification and explicit removal.
  Apply multi-operation edits atomically through the same validation as the SDK.
- v0.2 uses a fixed primary and independent, star-dominated Kepler orbits. Each
  planet has its own eccentricity, inclination, node, periapsis and epoch/phase.
  Planet masses are metadata in this approximation; reject total mass >1% of
  the host mass. This bound does not certify orbital stability. No stellar RV
  should be inferred from this fixed-primary model.
- Period derives from semimajor axis and host GM. Eccentricity edits must state
  whether semimajor axis or periapsis distance is held fixed.
- Transit photometry computes the union of foreground disks clipped to the star.
  Never add independent transit depths when occultors overlap.
- Keep camera/size exaggeration separate from physical observer geometry. The
  immersive stage may enlarge icons; the sky-plane measurement uses real ratios.
- Unknown physics still needs a new reviewed model and tests. LLM instructions
  explain laws; equations, contracts and independent checks enforce known limits.
- Run `node --test` for scientific/API changes. Inspect rendered states for UI
  changes. Validate novel constructions by agents using only the public interface.
- Work locally; no publishing, accounts, credentials or paid services are needed.
  Scripts authored by an agent run in that agent's own process; never execute
  arbitrary uploaded JavaScript inside the local API server or browser.
- Preserve old work in Git history, not parallel obsolete implementations.
  Public license and broad architecture remain open pending prototype feedback.
