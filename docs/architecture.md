# Cosmic Lego: architecture decisions

Revised 2026-11-03. The implemented prototype remains a bounded exoplanet
authoring experiment. Its design is recorded below; implementation and
verification status belong in [demo-status.md](demo-status.md).

## The next architecture is shared across domains

The [shared architecture roadmap](infrastructure-roadmap.md) supersedes the
earlier plan to establish infrastructure through an exoplanet-only authoring
exercise. The new core must construct objects, connect scientific quantities,
run analytic and stateful models, present results, host conversation and save
work without importing any astronomy package. Domain models are registered
extensions; the current star/planet vocabulary below is specific to this prototype.

The intended application has a central navigable stage with floating, movable,
foldable plots, inspectors and conversation. Permanent dashboard columns do not
satisfy that presentation goal. In-app conversation with a compatible external
agent is required foundation work. The existing sidebar viewer and external
CLI/HTTP authoring routes do not yet deliver that experience.

These are planned boundaries, not claims of implemented capabilities. Follow
F01–F11 for the generic foundation and its independent readiness exercise;
F12 migrates this prototype into an optional domain package afterward.

## Correcting the first prototype

The first prototype chose the wrong abstraction. It packaged an entire star–planet pair as a unit and let users edit parameters or replace a JSON scene. That demonstrated synchronized views, but it did not demonstrate the user's intended ability to construct and revise physical scenes from reusable objects. This was an implementation decision by the assistant, not a limitation imposed by the user's idea.

The rebuild makes scene structure authorable: create bodies, attach orbits, place observers, define measurements, and arrange interactive visualizations and narration. The test is whether an external agent can construct an unanticipated case and make structural changes through the public interface without editing the engine. Changing one preset's sliders is not sufficient evidence.

## Authoring vocabulary and boundaries

| Concept | Responsibility |
| --- | --- |
| Scene / world | Owns objects and their relationships; evaluates them at a shared physical time. |
| Body | Holds physical properties and identity; a planet is not a prepackaged experiment. |
| Orbit | Connects a planet to the central star and specifies the supported Keplerian motion. |
| Observer | Defines a physical viewing direction, independently of the illustrative camera. |
| Measurement | Connects a target and observer to a supported calculation, such as combined transit flux. |
| View | Presents existing state or measurement results; does not invent a second physical evolution. |
| Narration | Carries explanatory text and presentation intent; does not modify physics or imply a speech-generation service. |

Stable handles let an author retain a planet or orbit reference, add another planet, revise one orbit, change an observer, or attach another measurement. The public JavaScript `World` SDK is the primary programmatic authoring route. JSON is its serialization and transport format, not a vocabulary the user must manually speak. Exact signatures and tool operations are documented in [agent-interface.md](agent-interface.md).

An operation batch is applied to a draft, validated, and committed atomically. A failed edit must leave the prior scene intact. References must resolve; deleting an object with dependents must reject the change or use a documented explicit cascade. The SDK and semantic tools must share validation rather than creating a more permissive authoring path.

```text
User's own agent / author script
          ↓
World SDK or semantic operations
          ↓
Validated objects and relationships
          ↓
Physical state at time t → observer measurement → presentation
```

Validation checks the declared contract: supported fields, finite quantities, bounds, references, and known physical constraints. It does not establish arbitrary scientific truth. A prompt asking a model to obey physics is not a constraint mechanism. New physical behavior requires an implemented model, stated assumptions, and independent checks.

## Keep the physics separate from presentation

Use small JavaScript ES modules and a numerical core independent of the DOM, canvas, model provider, and wall-clock time. The local Node server and CLI expose the same composition/evaluation capabilities. The browser is an interactive application whose main surface is an immersive scene, with the source and object inspector as secondary tools.

The illustrative camera and drawing scales are presentation choices. Observer orientation is a physical input. Magnified icons, colors, zoom, playback speed, and labels must not feed into measured flux. A single physical time drives every object and measurement; a curve may sample an interval but its current-time marker must refer to the same state as the scene. Editing orbital elements creates a new model configuration, not a conservation-respecting impulse during a real orbit.

Manim remains a plausible later presentation adapter because it offers useful animation, camera, text, and equation facilities. The initial implementation does not depend on it: the central experiment is semantic composition and browser interaction. Revisit video export after a useful authoring case works, without duplicating the physics. This is a provisional choice, not a claim that Manim cannot support interactive workflows.

## The deliberately limited physical model

The selected model is a fixed central star with multiple independently moving Keplerian test-particle planets. Each orbit has its own eccentricity, orientation, and phase: eccentricity, inclination, ascending node, argument of periapsis, and mean anomaly at an epoch. Orbit size and stellar mass determine the period. The exact conventions and numerical implementation belong in [physics.md](physics.md).

Planet masses are metadata and are neglected in the dynamics. A summed planetary-to-stellar mass-ratio limit of 1% is an interface guard for this approximation; it is not an accuracy bound or a stability guarantee. Planet–planet forces, stellar reflex motion, resonances, transit-timing variations, and gravitational encounters are absent. **Radial velocity is removed from this approximation**, rather than displaying a stellar signal inconsistent with the fixed-star model.

A spherical, uniformly bright star and opaque, dark spherical planets supply the transit model. Project each foreground planet into the observer's sky plane, form the union of its blocked area with all other foreground planets, clip that union to the stellar disk, and calculate the normalized remaining flux. Overlapping planet silhouettes block the shared area only once. The same physical positions must drive the rendered silhouettes and measurement.

Projected overlap is not a physical collision. Planets separated along the line of sight can overlap in the image. Conversely, this noninteracting model can prescribe intersecting trajectories without modeling impacts or gravitational deflections. Star intersection must be checked using periapsis and physical radii; any displayed or flagged planet collision is a geometric condition, not collision dynamics.

Limb darkening, spectra, emitted/reflected planetary light, atmosphere, finite exposures, instrumental noise, and light-travel delays remain outside scope. New body/orbit combinations are supported only within the stated model, not by a promise of universal composability.

## Eccentricity edits must say what stays fixed

With fixed stellar mass, the chosen approximation has

\[
P = 2\pi\sqrt{a^3/(GM_\star)}, \qquad q=a(1-e).
\]

Changing eccentricity at fixed semimajor axis changes the orbit's shape and speed distribution, but not its period. Changing eccentricity at fixed periapsis changes the semimajor axis to `a = q/(1-e)` and therefore changes the period. For example, starting at `e = 0`, an edit to `e = 0.6` at fixed periapsis multiplies the period by about 3.952847; at fixed semimajor axis the multiplier is 1.

The authoring operation must express that choice explicitly. The UI should show the resulting orbit size and period so that the learner can inspect the dependency. The agent must not quietly choose a different quantity to preserve to make a requested conclusion appear true.

## Current external authoring and planned in-app conversation

Authors can use their own agents through the SDK, documented CLI, and local HTTP semantic operations. No embedded model or API key is needed for playback or evaluation. Author scripts run in the agent's own process. The web server accepts data and supported operations; it does not execute arbitrary submitted JavaScript. A serialized scene does not carry executable code or remote dependencies.

MCP is not implemented. Do not describe the HTTP service as an MCP server.
The next design adds a provider-neutral session bridge so the user can converse
with a compatible agent inside Cosmic Lego. The agent process may remain external
while the app hosts its messages, progress and supported actions. Conversation
and construction tools are separate interfaces; see the roadmap's researched
ACP/MCP options and F08. Compatibility must be tested before claiming it.

Start with a browser and a local companion that connects the configured agent;
public hosting and desktop packaging remain separate choices. Routine commands
use checked transactions, while adding new executable model code follows a
distinct development workflow. Independent agent filesystem access is not
constrained merely because the application offers validated tools.

## Evidence required from this rebuild

Check both structural authoring and scientific behavior. A useful demonstration should add or remove bodies and measurements, revise an orbit's constraints, and preserve unaffected objects. Numerical checks should cover Keplerian limits, the two eccentricity-edit modes, foreground ordering, and union photometry under disjoint, contained, coincident, grazing, and partially overlapping silhouettes.

Render and inspect the resulting scenes as well as checking data: camera framing, scale labels, occlusion, timing, graph markers, and explanatory text can mislead even when numerical values are correct. Passing tests, a plausible screenshot, schema acceptance, or an LLM review alone does not establish correctness or educational value. An independently authored case provides limited evidence of composability; it does not establish arbitrary-case reliability.

The older prototype remains in Git history. Preserve the current model's checks
through migration, but use the domain-independent F11 exercise to assess shared
architecture readiness. Exoplanet behavior becomes a separate F12 regression
exercise rather than the definition of the reusable core.

## Working name

**Cosmic Lego**, with repository slug **`cosmic-lego`**, emphasizes assembling
interactive astronomical visualizations from reusable physical building blocks.
This is the project owner's chosen working name. The name does not establish
trademark clearance, package availability, or ownership of a public domain.
