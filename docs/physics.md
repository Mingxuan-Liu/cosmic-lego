# Physics contract — independent Kepler graph (v0.2)

This is an idealized **model**, not observed data. A system contains one fixed spherical star and zero or more opaque dark planets. Each planet owns its elliptical orbit, orientation, and orbital phase. Planets share the stellar gravity parameter but do not gravitationally perturb the star or each other. The observer and composite photometry operate on their shared physical state.

This is the **star-dominated independent Kepler approximation**, not an N-body model. The sum of planetary masses may not exceed 1% of the stellar mass; this is a deliberately conservative interface bound, not a proof that mutual interactions are negligible. Resonances, close encounters, or long integrations can invalidate independent orbits even below that bound. Planetary masses are retained as physical metadata and for that guard but do not change trajectories, period, or flux in this approximation. Stellar reflex motion and radial velocity are deliberately absent.

The model omits planet–planet gravity and collisions, limb darkening, stellar activity, planetary emission/reflection, atmospheres, finite exposures, noise, light-time delay, and relativity. Different orbital paths may cross without collision handling. A star/planet radius and mass pair is not checked against a stellar or planetary structure relation. Display scale and illustrative camera movement are never physical inputs.

## Constructing physical systems

```js
createKeplerSystem({
  star: { id: 'sun', massSolar: 1, radiusSolar: 1 },
  planets: [{
    id: 'planet', massJupiter: 1, radiusJupiter: 1,
    orbit: {
      semiMajorAxisAU: 0.08,
      eccentricity: 0.2,
      inclinationDeg: 90,
      longitudeAscendingNodeDeg: 0,
      argumentPeriapsisDeg: 90,
      meanAnomalyDegAtEpoch: 0,
      epochDays: 0
    }
  }]
})
```

Semi-major axis is independent. The period is derived using **only the stellar** gravity parameter:

\[
\mu=GM_\star,\qquad n=\sqrt{\mu/a^3},\qquad P=2\pi/n.
\]

Changing eccentricity at fixed semi-major axis does not change period. Changing eccentricity at fixed periapsis requires changing `a = q/(1-e)` and therefore changes period. Every orbit has `0 ≤ e < 1`; stellar mass/radius and semi-major axis must be positive. Periapsis must satisfy `a(1-e) > R_star + R_planet`. Planet radius/mass may be zero for limiting cases. IDs must be distinct. All numerical inputs must be finite. The scene layer places additional practical bounds on the supported demo.

The returned system is immutable. `system.star` contains canonical properties, `massKg`, `radiusMeters`, and `gravitationalParameterM3S2`. Each entry in `system.planets` contains its canonical properties and `orbit`, plus `massKg`, `radiusMeters`, `semiMajorAxisMeters`, `periapsisMeters`, `apoapsisMeters`, `meanMotionRadPerSecond`, `periodDays`, and the two rotated orbital basis vectors. `planetStarMassRatio` records the approximation guard. Saved scenes must reconstruct models through `createKeplerSystem`, rather than deserialize computed state directly.

## Orbital evolution and coordinates

The reference plane is world `xy`. Rotation from orbital coordinates is explicitly

\[
R_z(\Omega)R_x(i)R_z(\omega).
\]

Here `Ω` is longitude of the ascending node, `i` is inclination, and `ω` is argument of periapsis. These are separate properties of **each planet**, independent of observer direction. At eccentric anomaly `E`, position in the orbital plane is

\[
x'=a(\cos E-e),\qquad y'=a\sqrt{1-e^2}\sin E.
\]

The shared physical time gives `M = M_epoch + n(t-t_epoch)`. The safeguarded Newton/bisection solver evaluates `E-e sin(E)=M`. Velocity is the analytic derivative, using `dE/dt=n/(1-e cos(E))`; motion is not uniform in true anomaly. `solveEccentricAnomaly(M,e)` is exposed for testing, takes radians, and returns a reduced solution in `[-π,π]`.

`keplerStateAt(system,timeDays)` returns:

- `timeDays`.
- `star: { id, worldMeters:{x:0,y:0,z:0}, radiusMeters }`.
- `planets: [{ id, worldMeters:{x,y,z}, velocityWorldMps:{x,y,z}, radiusMeters, periodDays, meanAnomalyRad, eccentricAnomalyRad, trueAnomalyRad, orbitalDistanceMeters }]`.

Mean and true anomaly outputs are reduced to `[0,2π)`. Eccentric anomaly uses `[-π,π]`. Times may be negative. All positions and velocities use meters and meters/second. Each planet's energy and angular momentum are conserved in the fixed central potential; the model makes no claim of a self-consistent moving barycenter.

`sampleOrbitPath(system,planetId,samples=160)` returns a closed array of world `{x,y,z}` positions with `samples` total entries, including a repeated endpoint. Sampling is uniform in eccentric anomaly for a geometric ellipse outline. Those samples are **not equally spaced times**.

## Observer and photometry

`observeSystem(system,timeDays,{direction:[x,y,z]})` uses a nonzero direction from the star **toward** a distant observer. The input is normalized; its magnitude is irrelevant. The default is `[0,0,1]`. A deterministic perpendicular sky basis is constructed using an auxiliary up vector, with a stable alternate near the pole. For the default direction, sky `x,y` equal world `x,y`. Basis orientation may change when switching the auxiliary vector, but separation and measured flux cannot.

For example, `i=90°`, `ω=90°`, `M_epoch=0`, and observer `+z` place a planet in front at periapsis. Zero inclination instead places the orbit in `xy`, face-on to that observer. This differs from the v0.1 fixed conjunction convention; phase now belongs to each independently defined orbit.

Observation returns:

- `timeDays`, `flux`, `blockedAreaMeters2`, `starRadiusMeters`.
- `observer: { direction:[...], skyX:[...], skyY:[...] }`.
- `star`, containing the world-state star fields.
- `planets`, containing all world-state planet fields plus `skyMeters:{x,y}`, `lineOfSightMeters`, `foreground`, and `projectedSeparationMeters`.
- `occultingPlanetIds`, the foreground planets whose projected disks overlap the stellar disk.

Positive line-of-sight distance points toward the observer. The star is uniform in projected surface brightness. The blocked area is the intersection of its disk with the **union** of foreground planetary disks:

\[
F/F_0 = 1 - \operatorname{area}(S\cap\bigcup_j P_j)/(\pi R_\star^2).
\]

Two projected planets covering the same part of the star block that light only once. A planet behind the star blocks no stellar flux. Planet–planet occultation away from the stellar disk produces no signal because planets emit no light in this model.

`occultedArea(starRadius,[{x,y,radius},...])` implements that clipped union in common input-length units. It removes redundant contained/coincident disks, splits circular boundaries at pairwise intersections, retains the exposed arcs, and integrates their oriented boundaries using Green's theorem. The integral for a counterclockwise circle arc is

\[
\frac12\left[r^2(\theta_2-\theta_1)+rx_c(\sin\theta_2-\sin\theta_1)+ry_c(\cos\theta_1-\cos\theta_2)\right].
\]

This follows the geometric method in [Pál (2012), sections 2.1–2.4.1](https://arxiv.org/pdf/1111.1741). [Gordon & Agol (2022), section II](https://arxiv.org/html/2207.06024v1) also describes the Green's-theorem approach. The implementation here covers uniform brightness only. Numerical roundoff guards and the single-occultor analytic lens helper handle near-contact geometry; this is not exact arithmetic or a limb-darkened model.

## Constants

`CONSTANTS` uses IAU nominal solar/Jupiter mass parameters `1.3271244e20` and `1.2668653e17 m³ s⁻²`, nominal solar radius `6.957e8 m`, and nominal Jupiter equatorial radius `7.1492e7 m`. Masses in kg are derived with `G=6.67430e-11 m³ kg⁻¹ s⁻²`. These are documented conversion conventions, not exact measured masses. A day is 86400 s; an AU is 149597870700 m.

Sources: [IAU nominal constants](https://arxiv.org/html/1510.07674v1), [NIST CODATA 2022 constants](https://physics.nist.gov/cuu/pdf/wall_2022.pdf).

## Plot sampling

The scene layer augments a uniform time grid with conjunction-guided samples.
It brackets projected-separation minima in eccentric anomaly, refines external
contacts, converts the resulting anomaly intervals to physical time, and samples
each selected transit interval. This prevents the tested narrow-transit case
from disappearing between coarse plotting samples.

The search is numerical and bounded: at most 160 event instances and 8192 points
per measurement. Longer windows can exceed that budget; metadata and the viewer
explicitly report omitted events. Very grazing events and fine features from
mutually overlapping silhouettes are not guaranteed resolved. The instantaneous
measurement uses the physical state directly, independently of the plot grid;
the viewer includes that value in its vertical range.

## Verification and limitations

Mass and radius are independently authored inputs. The model does not enforce
stellar evolution, planetary composition, or a mass–radius relation. Passing its
geometric and dynamical guards does not make every allowed body astrophysically
realizable.

Tests check Kepler roots at high eccentricity; Earth-like period; fixed-axis/fixed-periapsis behavior; specific energy and angular momentum; vis-viva limits; independently assigned orientations and epochs; analytic velocity against time differences; foreground/background geometry; distinct observers; no-double-counting; disk containment, tangencies, and grazing continuity; and orbital path closure/repetition.

The multi-occultor boundary integral is checked against independently implemented numerical vertical-slice integration, plus inclusion–exclusion cases and rotation/scale/permutation properties. These checks validate this specified idealization. They do not prove arbitrary model composition, dynamical stability, observational fidelity, or instructional quality. Rendering geometry and explanations need their own review.
