# Public authoring challenge B — eccentricity and preserved quantities

Date: 2026-11-02. Recipe: `experiments/agent-b-eccentricity.mjs`.

## Outcome

Constructed a new four-planet world from an empty `World`, using public handles,
loops, structural additions/removals, measurement rewiring, and semantic
`eccentricity()` edits. No preset was loaded, no graph JSON was authored by hand,
and no physics, scene implementation, renderer, or server was modified. The recipe
exports its world and a numerical `audit`; it does not publish anything.

During this challenge I read only `docs/agent-interface.md`, `docs/physics.md`, and
`node scripts/agent.mjs tools`. I used only the documented SDK surface. This is a
separate agent authoring exercise, not a blind novice usability study: the agent
had worked on the UI earlier in the project and knew the general architecture.

## What was composed

The final world has one star, four planets with separate orbital handles, two
physical observers, three photometers, and three time-based explanation cues.

| Planet | a / AU | e | i | node | periapsis argument | initial mean anomaly | Period / days |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Hold the semimajor axis | 0.080 | 0.60 | 90° | 0° | 90° | 0° | 8.264820151 |
| Hold the nearest approach | 0.160 | 0.55 | 89.5° | 40° | 90° | 0° | 23.376441497 |
| Unchanged reference clock | 0.080 | 0.10 | 76° | 15° | 110° | 58° | 8.264820151 |
| Outer tilted clock | 0.200 | 0.30 | 48° | 75° | 40° | 175° | 32.669570161 |

The reference planet makes the equal-period result inspectable in the final
world: it shares a with the green planet while retaining a different e, plane,
and phase. The outer planet establishes that the scene is not limited to two
predefined comparison objects.

Both edited orbits began with a = 0.08 AU and e = 0.10. The recipe then reacquired
their orbit handles by ID and made two different semantic edits:

- Fixed a: e changed to 0.60. P remained **8.264820151120695 days**, exactly equal
  in the evaluated output before/after and equal to the unchanged reference.
- Fixed periapsis: e changed to 0.55 while q remained **0.072 AU**. a became
  **0.16000000000000003 AU** and P became **23.376441496578686 days**. The measured
  period ratio was **2.8284271247461907**, matching `2 * sqrt(2)` to floating-point
  precision.

These checks compare the results to the independently known Kepler scaling
`P ∝ a^(3/2)`. They validate this authoring operation under the declared fixed-star
model; they are not an independent validation of all numerical orbital physics.

## Structural operations exercised

1. Created an `occulters:'orbiting'` photometer before creating any planets.
2. Added four independent planet/orbit pairs through a loop of object handles.
3. Added a fifth zero-radius construction probe. The existing photometer included
   five planets without being rebuilt.
4. Removed the probe with explicit `cascade:true`. Its orbit disappeared and the
   existing photometer returned to four planets.
5. Created a scouting observer and its measurement, then a replacement observer.
6. Rewired the measurement with `handle.set()` to the replacement observer and
   to an explicit two-planet subset. Removed the old observer without cascade,
   demonstrating that its dependent measurement had actually been rewired.
7. Added a second all-planets measurement at the replacement sightline.

All assertions passed. The final IDs contain neither the removed probe/orbit nor
the removed observer. The selective photometer contains exactly `axis-held` and
`periapsis-held`.

At day 0:

| Measurement | Normalized flux | Planets in foreground transit |
| --- | ---: | --- |
| All planets, direction [0,0,1] | 0.9822903561466615 | axis-held; periapsis-held |
| Edited pair, direction [.07,.12,1] | 0.9940745475478912 | axis-held |
| All planets, direction [.07,.12,1] | 0.9940745475478912 | axis-held |

The latter two match at this instant because the two excluded planets are not
occulting. Observer replacement changes the measured signal without changing any
orbital configuration.

## Verification and reproduction

Executed successfully:

```sh
bash scripts/node.sh scripts/agent.mjs tools
bash scripts/node.sh scripts/agent.mjs run experiments/agent-b-eccentricity.mjs --dry-run
```

The dry run returned `valid: true`. The recipe runs assertions for preserved a,
preserved q, both period relations, automatic photometer membership, cascading
removal, measurement subset size, observer rewiring, and flux bounds. To inspect
the numerical audit without publishing:

```sh
node --input-type=module -e "import('./experiments/agent-b-eccentricity.mjs').then(m => console.log(JSON.stringify(m.audit, null, 2)))"
```

No request was sent to the shared local server, and no browser review was done as
part of this challenge. The owner can publish the completed recipe afterward.

## Does the API constrain the idea?

It did not block this proposed lesson. I could choose object count, geometry,
phases, per-object eccentricity, measurement membership, and observer connections
without changing implementation code. The explicit preserved quantity for an
ellipticity edit is useful scientific guidance, not a preset limitation.

The boundaries remain material:

- This models independent trajectories around one fixed star. It cannot establish
  orbital stability, interactions, resonant timing changes, collisions, or a
  self-consistent reflex signal. Several paths overlap; that does not make the
  construction a plausible stable planetary system.
- The saved world is the final configuration. Intermediate construction states
  and before/after numerical evidence live in the recipe/audit. It cannot yet
  save a sequence of scene snapshots to animate an authoring edit as a visual
  comparison. Such an edit would still need to be distinguished from a physical
  impulse.
- The declaration can express more than the fixed viewer currently chooses to
  show. An agent can calculate period comparisons but cannot yet attach its own
  custom period plot, equation overlay, or arbitrary measurement component using
  the same public graph. That is the most relevant next abstraction gap for the
  broader Manim-like ambition.
- The lesson would benefit from simultaneously showing two observer feeds. The
  graph supports them; the current viewer chooses one measurement at a time.

This exercise demonstrates structural recomposition in a bounded domain. It does
not establish arbitrary astrophysical composition or educational effectiveness.
