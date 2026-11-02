# References and evidence boundaries

Sources inspected on 2026-11-01. These support the physical model and design rationale; citing them does not validate this implementation. No claim of educational efficacy, complete compositional correctness, or agent interoperability follows from this list.

## Initial physical model

1. **Mandel & Agol (2002), Analytic Light Curves for Planetary Transit Searches.** [Paper](https://faculty.washington.edu/agol/MandelAgol2002.pdf), §2, p. L171, Eq. 1. The uniform-source case supplies the reference geometry for an opaque dark sphere occulting a uniformly bright stellar disk. The later limb-darkening treatment is not part of the initial prototype. A transit also requires foreground ordering; projected overlap alone is insufficient.

2. **NASA Exoplanet Archive, How Predicted Observables for Exoplanets are Calculated.** [Technical documentation](https://exoplanetarchive.ipac.caltech.edu/docs/poet_calculations.html), “Orbital Period,” “Radial Velocity Semi-amplitude,” “Astrometric Semi-Amplitude,” and “Transit Depth.” Useful independent descriptions of orbital and observable dependencies. Its period subsection neglects planet mass, while its radial-velocity expression retains it; do not silently mix these approximations. AstroCompose's selected two-body model should retain both masses consistently. The displayed equations on the page are images; numerical implementation still requires an explicit derivation and checks.

3. **IAU 2015 Resolution B3, recommended nominal conversion constants.** [Resolution PDF](https://arxiv.org/pdf/1510.07674), table on PDF p. 3. Defines nominal solar/planetary radii and mass parameters as conversion factors, not current measured properties. Distinguish mass parameters GM from masses in kilograms, and state whether a planetary radius convention is equatorial or another choice. The constants actually adopted by the code must be documented there; this reference alone does not assert that all conversions have been audited.

## Architecture and prior work

4. **Manim Community documentation.** [Overview](https://docs.manim.community/en/stable/) and [Scene API](https://docs.manim.community/en/stable/reference/manim.scene.scene.Scene.html). Relevant animation and presentation machinery. It is a candidate output adapter, not an installed or tested dependency of AstroCompose. The decision to separate physics from rendering is provisional project judgment.

5. **Ye et al. (2020), Penrose.** [Author project and paper](https://penrose.cs.cmu.edu/siggraph20). Separates mathematical domain, particular content, and visual style, then lays out diagrams using constraints. This motivates separating semantics from presentation. Its abstract types and relations do not supply astronomical dynamics or certify physical truth. The historical page's early-stage notice is not a current availability assessment; the [repository](https://github.com/penrose/penrose) provides the current project entry point.

6. **Modelica Association, language overview.** [Official documentation](https://modelica.org/projects/language/). Equation-based reusable components demonstrate that compositional physical modeling predates LLMs. This is an architectural precedent, not a proposal to depend on Modelica or reproduce its general solver machinery.

7. **Kaputa et al., SimStep.** [CHI 2026 publication](https://doi.org/10.1145/3772318.3791514); [2025 full-text preprint](https://arxiv.org/html/2507.09664v1), architecture and limitations sections. Uses inspectable conceptual, scenario, learning-goal, and interaction representations between teacher intent and generated simulation code. Supports exposing assumptions and allowing correction. The versions differ; the preprint is identified explicitly. Authoring studies do not establish student learning gains or general physical correctness.

8. **Gunturu et al. (2024), Augmented Physics.** [Full paper](https://arxiv.org/html/2405.18614v2), §§4.4–4.5. Combines image extraction and LLM-assisted configuration with existing rigid-body and custom optics/circuit simulators. A close precedent for selecting supported physical machinery rather than generating every equation. Its prototype's unsupported cases and manual corrections illustrate why a component catalog still needs explicit scope.

9. **Wang et al. (2026), ChronoLLM.** [Published paper](https://link.springer.com/article/10.1007/s11044-026-10152-x), abstract and introduction. Adapts LLMs to generate scripts using the established PyChrono engine. The authors describe generated scripts as often requiring human improvement. This supports testing the agent-to-library interface separately from testing the library itself.

10. **Chen et al. (2025), VisualEDU.** [Paper and benchmark overview](https://aclanthology.org/2025.findings-emnlp.889/). Evaluates Manim-generated explanations using code and visual feedback. It motivates checking rendered meaning and temporal consistency in addition to execution. Its reported results concern its tasks and tested models, not a forecast of this prototype's performance.

These precedents rule out a broad novelty claim for “LLM-generated educational simulations.” The prospective contribution is an astronomy-specific combination of explicit physical contracts, observer measurements, inspectable scene composition, and reusable interactive/presentation outputs. Whether that combination is useful or publishable remains an empirical question.

## Preliminary naming check

The 2026-11-01 exact-name searches found no matches for AstroCompose or Astralgebra, including searches restricted to GitHub, PyPI, and npm. Negative search results are limited evidence and have no stable source page to cite. Positive collisions were verified at [ityeri/astroweave](https://github.com/ityeri/astroweave) and the [Astroloom software company](https://www.astroloom.com/); a separate [AstroLoom astrology app](https://play.google.com/store/apps/details?id=com.acom.astroloom) also exists. This was not a trademark search or a reservation of any public name.
