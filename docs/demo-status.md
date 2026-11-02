# Demo status — 2026-11-01

## Implemented

- Local Git repository, no remote and no public deployment.
- Dependency-free ES modules, a local Node server, and a browser demo.
- Circular Newtonian star–planet model with barycentric motion, analytic uniform
  disk occultation, and projected stellar radial velocity.
- Composable independent systems, observers and views. Three saved examples.
- Linked geometry and measurements, shared physical time, common comparison scales,
  phase scrubbing, playback, and presentation-only size exaggeration.
- Scene JSON schema, structural/domain validation, rejected unsupported fields,
  machine-readable capabilities, CLI and local HTTP APIs.
- Live scene updates from an external agent, JSON import/export, local scene
  persistence, optional revision guards, and a macOS launcher.

## Checks performed

- 22 automated tests passed on Node 24.22.1, using the built-in test runner.
- Scientific tests: conservation, barycenter/momentum, one-AU reference scale,
  radial-velocity sign and mass/inclination dependence, foreground discrimination,
  central transit depth, grazing overlap, repeatability and zero limits.
- Composition/transport tests: shared physical clock, presentation invariance,
  invalid references/fields, schema synchronization, CLI argument errors, HTTP
  rejection preserving accepted state, and revision conflicts.
- Browser review: initial two-observer scene, phase-zero geometry, quarter-phase
  signals, three-system mass/radius comparison, observer creation, system
  duplication, parameter editing, scene inspection, and unsupported eccentricity
  rejection. Examined desktop and narrow layouts and sampled animation states.
- Agent integration: authored a third face-on observer as JSON, validated it, and
  applied it through the CLI/HTTP path. The browser updated to three views without
  changing model or renderer code. Face-on RV was zero and flux was one.
- In the comparison example, quarter-phase RV was approximately −140.83 m/s for
  the reference and twice-radius systems, and −281.48 m/s for twice the mass.
  The mass response follows the full two-body relation, not exactly a factor two.
- No browser warning/error logs were reported in the inspected session.

These are tests of a bounded model and sampled UI states, not formal proof of all
parameter combinations, a full motion/audio review, or evidence of student learning.
No audio, rendered video export, or astronomical dataset is included.

## Provisional answers to the design questions

| Question | Current experiment |
| --- | --- |
| Extend Manim or borrow its ideas? | Borrow programmatic composition; keep a renderer-independent physical core. Consider Manim as a later export adapter. |
| How are components coupled correctly? | One source of physical state, derived dependent parameters, explicit observer conventions, checked scene references, known domain constraints and tests. |
| Where do physical laws live? | Numerical code and reference tests. Capabilities, schema and AGENTS.md explain the contract to an LLM; prompts do not enforce the laws. |
| What may an LLM manipulate? | Supported scene parameters, independent systems, observers and their view connections. Unsupported new physics is rejected. |
| How is it delivered? | A local browser application now. Public hosting and native desktop packaging remain open. |
| How do users bring agents? | File/CLI and same-machine HTTP operations now; JSON import for chat-only clients. MCP is a possible future adapter, not implemented. |

## Deliberately unresolved

- Whether the authoring vocabulary should become finer-grained than a star–planet
  system, and how to add new domain packs without a large universal ontology.
- Whether a browser renderer plus deterministic capture meets video needs, or a
  Manim/Blender adapter offers enough value to justify maintenance.
- A timeline/event recording format and final-quality video export.
- Eccentricity, limb darkening and realistic instrument behavior, each requiring
  explicit model extensions and verification.
- Formal accessibility, additional browsers, mobile usability, and classroom trials.
- Public contribution workflow, license, hosting, branding and name clearance.

The next decision should follow the user's review of the demo: are the useful
operations primarily composing measurements/views, arranging explanatory scenes,
or adding physical model behaviors? That feedback determines the next abstraction.
