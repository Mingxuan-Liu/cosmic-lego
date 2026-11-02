# Physics contract

This prototype is a **model**, not observed exoplanet data. It uses a circular Newtonian two-body orbit, spherical opaque bodies, a spatially uniform stellar surface brightness, a dark planet, and an observer effectively at infinity. Star and planet move around the barycenter. The light curve and radial-velocity curve are evaluated from the same physical state and time.

The model omits eccentricity, interactions with additional planets, limb darkening, stellar variability, reflected/emitted planetary light, atmosphere, finite exposures, measurement noise, light-travel time, and relativistic effects. It is intended for ordinary nonrelativistic stellar/planetary parameters. The library checks finite values and geometric intersection, not whether arbitrary mass/radius choices represent a realizable star or planet. Broadening the interface requires further validity constraints.

## Inputs and units

`createSystem({ starMassSolar, starRadiusSolar, planetMassJupiter, planetRadiusJupiter, periodDays })` returns an immutable system. Defaults are `(1, 1, 1, 1, 4)`. Stellar mass/radius and period must be positive. Planetary mass/radius may be zero for explicit limiting experiments. Strings, nonfinite numbers, negative values, and numerically overflowing derived quantities are rejected.

The period and masses determine the relative orbital semimajor axis:

\[
a^3=\frac{(GM_\star+GM_p)P^2}{4\pi^2}.
\]

The code rejects a separation at or within the sum of the **physical** radii. The barycentric radii are `starOrbitRadiusMeters = a M_p/(M_star+M_p)` and `planetOrbitRadiusMeters = a M_star/(M_star+M_p)`. Physical separation and period are not independently adjustable.

Exported `CONSTANTS` includes SI units: solar nominal mass parameter `1.3271244e20 m³ s⁻²`, Jupiter nominal mass parameter `1.2668653e17 m³ s⁻²`, solar nominal radius `6.957e8 m`, and Jupiter nominal equatorial radius `7.1492e7 m`. Mass values in kg are derived from the nominal mass parameters using `G = 6.67430e-11 m³ kg⁻¹ s⁻²`; they are conversion conventions rather than claims of exact measured stellar/planetary masses. One day is 86400 s and one AU is 149597870700 m.

References: [IAU 2015 nominal solar and planetary conversion constants](https://arxiv.org/html/1510.07674v1), [NIST CODATA 2022 constants table](https://physics.nist.gov/cuu/pdf/wall_2022.pdf).

The system preserves its five canonical physical inputs and exposes `starMassKg`, `planetMassKg`, `totalMassKg`, `starRadiusMeters`, `planetRadiusMeters`, `periodSeconds`, `gravitationalParameterM3S2`, `omega` (radians/s), `semiMajorAxisMeters`, `semiMajorAxisAU`, `starOrbitRadiusMeters`, `planetOrbitRadiusMeters`, and `relativeOrbitalSpeedMps`. Composition labels and IDs belong to the scene layer. To load a saved composition, reconstruct the system from its five canonical inputs with `createSystem`; do not pass an arbitrary deserialized derived system into `stateAt`.

## Coordinate and sign conventions

`stateAt(system, timeDays, { inclinationDeg = 90 })` evaluates one time without advancing hidden state. Time may be negative. Inclination is in `[0, 180]` degrees; 0° and 180° are face-on and 90° is edge-on. At `timeDays = 0`, the planet is at inferior conjunction, producing a central transit for an edge-on observer.

With `phase = 2π time / period`, the relative world position is `(a sin(phase), a cos(phase), 0)`. The observer direction is `(0, sin(i), cos(i))`. The sky basis vectors are `(1, 0, 0)` and `(0, cos(i), -sin(i))`. Increasing line-of-sight distance points **toward** the observer. Positive spectroscopic radial velocity means **receding**, so `RV = −v_star · observerDirection`.

Returned state fields:

| Field | Meaning |
| --- | --- |
| `timeDays`, `phaseRad`, `inclinationDeg` | Physical time, reduced phase in `[0, 2π)`, observer inclination |
| `star.worldMeters`, `planet.worldMeters` | Barycentric positions `{x,y,z}` in meters |
| `star.skyMeters`, `planet.skyMeters` | Projected barycentric positions `{x,y}` in meters |
| `star.lineOfSightMeters`, `planet.lineOfSightMeters` | Barycentric distance along the observer direction |
| `star.velocityWorldMps`, `planet.velocityWorldMps` | Barycentric velocities `{x,y,z}` in meters/second |
| `relative.worldMeters`, `relative.skyMeters`, `relative.lineOfSightMeters` | Planet position relative to the star in those same coordinates |
| `projectedSeparationMeters` | Distance between projected disk centers |
| `planetInFront` | True when planet-star relative line-of-sight distance is positive |
| `flux` | Stellar flux divided by unocculted stellar flux, bounded `[0,1]` |
| `stellarRVMps` | Stellar radial velocity in m/s, positive receding |

## Observable calculations

`circleOverlapArea(radius1, radius2, separation)` returns the analytic area of intersection of two circles in squared input length units. It handles nonoverlap, tangency, containment, concentric circles, and zero radius. Intermediate lengths are normalized; segment angles use `atan2` and tiny-segment areas use a series expansion to avoid cancellation near tangency. The chord radicand and output area are clamped only to geometrically valid bounds to control floating-point roundoff.

When the planet is in front, stellar flux is `1 − overlapArea/(π R_star²)`. Otherwise it is 1. For a small fully superimposed planet, the depth is exactly `(R_p/R_star)²` in this uniform-brightness model. A planet behind the star does not cause a stellar transit; because the model assigns the planet no luminosity, no secondary eclipse is shown. The stellar RV semi-amplitude is `2π a_star sin(i)/P`.

`sampleOrbit(system, { inclinationDeg = 90, samples = 361, startDays = 0, durationDays = system.periodDays })` returns an array of `stateAt` objects including both time endpoints. It accepts 2–100000 integer samples and a positive duration. Renderer frame rate does not enter any calculation.

## Presentation contract

Screen radius, trail length, camera position, visual exaggeration, and animation playback speed are intentionally absent from the physics API. A renderer may enlarge an icon or compress an orbit for legibility, but must label that choice; it must never feed display geometry into the light curve. The observer inclination is physical; the illustrative camera is not an observer parameter. Changing physical inputs represents a new comparison system, not a conservation-respecting in-flight intervention.

## Verification

`test/physics.test.js` checks an Earth-like orbital scale, Kepler's law, barycenter/total momentum, constant energy/angular momentum, observer projection, RV sign and inclination/mass scaling, central transit depth, foreground/background discrimination, face-on and zero-mass/radius limits, independently known circle-intersection geometry, grazing continuity, repeatability, and invalid inputs.

These tests validate the implemented idealized model. They do not validate realistic stellar structure, omitted astrophysics, lesson quality, or the renderer's geometry and labels, which require separate review.
