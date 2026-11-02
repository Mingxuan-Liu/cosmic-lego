# References and evidence boundaries

Sources inspected 2026-11-01–02. These support the model and architectural choices; they do not validate this implementation. No claim of educational efficacy, general compositional correctness, or agent interoperability follows from citation alone.

## Current orbital and transit model

1. **JPL Solar System Dynamics, Approximate Positions of the Planets.** [Technical documentation](https://ssd.jpl.nasa.gov/planets/approx_pos.html), “Formulae for using the Keplerian elements” and “Solution of Kepler's Equation.” Gives the relation between mean and eccentric anomalies, coordinates in the orbital plane, and rotations into a reference frame. AstroCompose uses idealized user-authored orbits, not JPL's fitted Solar System element tables or a high-precision ephemeris.

2. **NASA/GSFC, How Orbital Motion is Calculated.** [Archived educational derivation](https://spdf.gsfc.nasa.gov/pub/documents/archived_websites/pwg.gsfc.nasa.gov/stargaze/Smotion.htm). States the orbit equation `r = a(1-e²)/(1+e cos ν)` and distinguishes mean from true anomaly. Setting true anomaly to zero gives `q = a(1-e)`. Combined with Kepler's third law, this explains why changing eccentricity affects period only when the edit also changes semimajor axis or gravitating mass.

3. **Rickman (2020), Introduction to Orbital Mechanics and Spacecraft Attitudes for Thermal Engineers.** [NASA Engineering and Safety Center presentation](https://tfaws.nasa.gov/wp-content/uploads/Rickman-Presentation.pdf), “Kepler's Third Law.” Explicitly illustrates equal periods for equal semimajor axes despite different eccentricities. This is instructional material; it does not supply a validation result for AstroCompose.

4. **Pál (2012), Light-curve modelling for mutual transits.** [Paper](https://arxiv.org/pdf/1111.1741), §§2.1–2.4.1. Constructs disjoint circle-boundary arcs and uses Green's theorem to integrate brightness over the relevant region for an arbitrary number of overlapping bodies. For uniform brightness, the area primitive is analytic. It motivates computing the stellar-disk-clipped union of foreground silhouettes rather than adding independent transit depths. Numerical tangencies, containment, coincident disks, and topology changes still require implementation checks.

5. **Gordon & Agol (2022), Analytic Light Curve for Mutual Transits of Two Bodies Across a Limb-darkened Star.** [Full paper](https://arxiv.org/html/2207.06024v1), §§II and VI.1.2. Relates its two-occultor solution to Pál's general approach and documents independent confocal Keplerian orbits with no interaction-driven timing variations. This supports a bounded independent-orbit demonstration. Its two-body occultation implementation and limb-darkening features are not automatically features of AstroCompose.

6. **Mandel & Agol (2002), Analytic Light Curves for Planetary Transit Searches.** [Paper](https://faculty.washington.edu/agol/MandelAgol2002.pdf), §2, p. L171, Eq. 1. Supplies the single-occultor uniform-source reference case. Recovering that limit is a useful check on the composite transit model; it does not validate every multiple-overlap geometry.

7. **IAU 2015 Resolution B3.** [Resolution PDF](https://arxiv.org/pdf/1510.07674), nominal conversion table on PDF p. 3. Defines nominal solar/planetary radii and mass parameters as conversion factors, not exact measured properties. State the adopted planetary radius convention and distinguish GM from mass in kilograms. The code and [physics contract](physics.md) are authoritative about which constants are actually used.

The fixed-star approximation deliberately ignores planetary masses in dynamics. A 1% total planetary-to-stellar mass-ratio guard is a project scope choice, not a published guarantee of accuracy or system stability. Mutual projected occultations do not imply physical collisions, and prescribed Keplerian paths do not model encounters or impacts.

## Architecture and related work

8. **Manim Community.** [Documentation](https://docs.manim.community/en/stable/) and [Scene API](https://docs.manim.community/en/stable/reference/manim.scene.scene.Scene.html). Relevant animation and presentation machinery. Manim is a potential later adapter, not a tested dependency of the current rebuild.

9. **Ye et al. (2020), Penrose.** [Author project and paper](https://penrose.cs.cmu.edu/siggraph20). Separates domain concepts, particular mathematical assertions, and style, then generates diagrams using constraints. This motivates separating semantic authoring from display. Abstract relations alone neither implement astronomical dynamics nor certify their physical truth. The [repository](https://github.com/penrose/penrose) is the current project entry point; the historical paper page's availability notice should not be treated as current status.

10. **Modelica Association.** [Official language overview](https://modelica.org/projects/language/). Reusable equation-based physical components demonstrate that compositional modeling predates LLMs. This is a precedent, not a plan to reproduce a general multiphysics solver.

11. **Kaputa et al., SimStep.** [CHI 2026 publication](https://doi.org/10.1145/3772318.3791514); [2025 full-text preprint](https://arxiv.org/html/2507.09664v1), architecture and limitations sections. Uses inspectable intermediate representations between teacher intent and generated simulations. Supports exposing assumptions and permitting structural correction. Authoring studies do not establish student learning gains or universal physical correctness; the linked preprint differs from the final publication.

12. **Gunturu et al. (2024), Augmented Physics.** [Full paper](https://arxiv.org/html/2405.18614v2), §§4.4–4.5. Combines LLM-assisted configuration with existing rigid-body and custom optics/circuit simulators. It illustrates the usefulness and limits of selecting supported physical machinery.

13. **Chen et al. (2025), VisualEDU.** [Paper and benchmark](https://aclanthology.org/2025.findings-emnlp.889/). Evaluates Manim-generated explanations using code and visual feedback. Motivates checking rendered meaning and temporal consistency in addition to program execution. Reported performance applies to the tested tasks and models.

These precedents rule out a broad novelty claim for “LLM-generated educational simulations.” The prospective contribution is astronomy-specific semantic composition, explicit model contracts, consistent observer measurements, and evidence that independent authors can construct useful explanations through those interfaces. Its educational value remains to be tested.

## Preliminary naming check

The 2026-11-01 exact-name searches found no matches for AstroCompose or Astralgebra, including GitHub/PyPI/npm-targeted queries. Negative results are limited evidence with no stable source page. Positive collisions were verified at [ityeri/astroweave](https://github.com/ityeri/astroweave), the [Astroloom software company](https://www.astroloom.com/), and a separate [AstroLoom astrology app](https://play.google.com/store/apps/details?id=com.acom.astroloom). This was not a trademark search or a reservation of any public name.
