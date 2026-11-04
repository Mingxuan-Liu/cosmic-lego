// Editorial crosswalk from textbook sections to visual assets. Coverage scores
// never enter the crosswalk or the edge selection.
import { coverage } from './coverage.mjs';

const ref = (path, anchor, label) => ({ path, anchor, label });
const study = ref('packages/exoplanet/recipe.mjs', 'constructStudy(study)', 'Three-planet construction recipe');
const eccentric = ref('examples/eccentric-periapsis.mjs', 'same-q-orbit', 'Fixed-periapsis and fixed-semimajor-axis comparison');
const sightlines = ref('examples/tilted-orbits.mjs', 'other-sightline', 'Second physical observer');
const sky = ref('packages/exoplanet/visuals.js', 'exoplanet.silhouette', 'Physical-radius silhouette factory');
const points = ref('examples/scene-and-assets.mjs', 'moving-collection', 'Instanced position collection');
const temperature = ref('examples/scene-and-assets.mjs', 'scalar-binding', 'Kelvin-valued field and fixed color range');
const vectors = ref('examples/scene-and-assets.mjs', 'vector-binding', 'Spatial velocity samples bound to arrows');
const gate = ref('experiments/f11-author.mjs', 'puck-positions', 'Independent position, field and velocity bindings');
const lightCurve = ref('packages/exoplanet/recipe.mjs', 'plot-curve-', 'Normalized transit flux sampled on a physical time axis');

const proposed = (section, rationale) => ({ topicId: 'sec-' + section.replace('.', '-'), status: 'proposed', rationale });
const shown = (section, rationale, evidence) => ({ ...proposed(section, rationale), status: 'demonstrated', evidence });

// A future specification is itself the artifact shared by two proposed
// lessons. Its source is intentionally separate from runnable recipe sources.
function design(id, label, summary, inputContract, limits, uses) {
  return { id, label, summary, inputContract, limits, uses, implementationStatus: 'proposed',
    source: [ref('packages/atlas/reuse.mjs', "design('" + id + "'", 'Proposed visualization specification')] };
}

const catalog = [
  {
    id: 'kepler-state', label: 'Kepler orbit and period', implementationStatus: 'authored', source: [study, eccentric],
    summary: 'Move a point along an independently phased ellipse and compare its position and period when the eccentricity changes.',
    inputContract: 'Host GM, semimajor axis or periapsis, eccentricity, orientation, epoch and phase. Compare positions in metres at equal times.',
    limits: 'The installed model assumes a fixed primary, bound orbits and negligible companion gravity. Each new system needs compatible parameters.',
    uses: [
      shown('2.1', 'Compare a circular reference with ellipses that hold either their semimajor axis or their periapsis fixed.', eccentric),
      shown('2.3', 'Compare the periods after changing eccentricity at fixed semimajor axis and at fixed periapsis.', eccentric),
      shown('7.4', 'Propagate the independently phased planet positions that enter the transit measurement.', study),
      shown('23.1', 'Compare prescribed orbital sizes, planes and phases within one model of a multiplanet system.', study),
      proposed('20.1', 'Supply Mercury’s orbital elements for a Newtonian reference ellipse. Relativistic precession requires another model.'),
      proposed('21.1', 'Trace heliocentric giant-planet positions from supplied elements within the mass and distance bounds.'),
      proposed('22.3', 'Compare selected bound asteroid orbits using initial elements and the solar GM.'),
    ],
  },
  {
    id: 'sky-silhouettes', label: 'Observer-plane silhouettes', implementationStatus: 'authored', source: [sky, sightlines, study],
    summary: 'Project body centers onto a physical observer’s plane and draw disks at a common radius scale, retaining the sign of line-of-sight depth.',
    inputContract: 'Body positions, radii, primary radius and unit sightline in a common frame. The display scale converts all lengths together.',
    limits: 'The existing flux calculation handles dark disks over a uniformly bright star. Luminous companions require separate emission inputs.',
    uses: [
      shown('7.4', 'Tilt an orbital plane or move the observer and see which foreground disks cross the star.', sightlines),
      shown('23.1', 'View different orbital inclinations and physical radius ratios in the same model system.', study),
      proposed('7.3', 'Reuse the projected disk geometry for a binary eclipse, adding both stellar brightness profiles before predicting flux.'),
      proposed('21.2', 'Place a moon in front of a giant planet using a supplied ephemeris. A reflected-light model would supply the planet’s brightness.'),
      proposed('22.3', 'Draw an asteroid crossing a background star with an appropriate apparent scale and an occultation ephemeris.'),
    ],
  },
  {
    id: 'relative-light-curve', label: 'Relative-flux time series', implementationStatus: 'authored', source: [lightCurve],
    summary: 'Plot flux divided by a declared reference flux against physical time, with a cursor tied to the current sample.',
    inputContract: 'Ordered time coordinates with units, relative flux values, reference definition, missing-sample mask and source identity.',
    limits: 'The existing study supplies synthetic transit flux. Other sources require their own measurements or time-dependent emission models.',
    uses: [
      shown('7.4', 'Plot the modeled transit and compare its normalized depth with the independent-depth approximation.', lightCurve),
      proposed('7.3', 'Supply binary photometry and a declared out-of-eclipse baseline to compare primary and secondary minima.'),
      proposed('14.1', 'Supply a pulsating star’s flux sequence and reference level to inspect amplitude and recurrence.'),
      proposed('15.2', 'Compare flux histories for supernovae with explicit passbands, references and time origins.'),
      proposed('28.1', 'Supply a monitoring light curve for one active nucleus in a specified passband to inspect variability.'),
    ],
  },
  {
    id: 'position-catalog', label: 'Identified 3D point catalog', implementationStatus: 'authored', source: [points, gate],
    summary: 'Draw an instanced point at each catalog position and retain an object ID for picking the same member across views.',
    inputContract: 'An ID and three spatial coordinates per member, with a named frame, length unit and explicit symbol size.',
    limits: 'The fixtures use constructed positions. Astronomical applications require catalog selection, a coordinate transform and distance information.',
    uses: [
      proposed('6.5', 'Map a selected survey catalog into a common coordinate frame and keep each catalog identifier selectable.'),
      proposed('13.3', 'Plot member positions for a stellar cluster with supplied distances and membership selection.'),
      proposed('24.1', 'Show how cataloged star counts vary across a declared spatial sample and selection volume.'),
      proposed('25.2', 'Locate resolved stellar tracers in a nearby galaxy, with deprojection assumptions shown.'),
      proposed('27.3', 'Show cluster galaxy members using declared spatial distances or an explicitly labeled redshift-space coordinate.'),
    ],
  },
  {
    id: 'velocity-arrows', label: 'Sampled velocity arrows', implementationStatus: 'authored', source: [vectors, gate],
    summary: 'Anchor a velocity vector at each measured or computed position. A common scale converts speed into arrow length.',
    inputContract: 'Positions in a length unit and a velocity field in length per time, defined in compatible coordinate frames.',
    limits: 'The arrow field represents supplied velocities. Inferring a three-dimensional velocity from one Doppler component needs a separate model.',
    uses: [
      proposed('11.1', 'Attach velocity vectors to sampled positions in a solar convection calculation.'),
      proposed('12.2', 'Draw simulated gas infall velocities relative to a forming protostar.'),
      proposed('18.2', 'Use velocity samples from a disk model to separate orbital motion from radial inflow.'),
      proposed('24.3', 'Attach stellar space velocities to catalog positions after transforming all components to one rest frame.'),
      proposed('25.2', 'Compare a galaxy velocity field with its disk orientation using a stated deprojection.'),
    ],
  },
  {
    id: 'temperature-field', label: 'Spatial temperature samples', implementationStatus: 'authored', source: [temperature],
    summary: 'Color samples at their physical positions with a labeled temperature range held fixed across comparisons.',
    inputContract: 'Spatial coordinates and unit, temperature in kelvin, frame, numeric color limits and clipping policy.',
    limits: 'The authored fixture displays supplied temperatures. Radiation, surface brightness and a telescope image require their own forward models.',
    uses: [
      proposed('10.4', 'Color computed interior samples by local temperature while inspecting an energy-transport calculation.'),
      proposed('11.1', 'Map a solar model’s temperature samples at their reported interior positions.'),
      proposed('12.1', 'Display a supplied gas-temperature map using its footprint and physical spatial scale.'),
      proposed('19.3', 'Show modeled atmospheric temperatures on a specified altitude surface with a common kelvin scale.'),
      proposed('20.2', 'Place Venus atmospheric temperature measurements at the altitudes and coordinates actually sampled.'),
    ],
  },
  design('parallax-baseline', 'Two-epoch parallax geometry',
    'Draw the two observer positions, the target and both sightlines beside an angular inset showing the apparent shift.',
    'Observer positions and target direction at two epochs, known baseline length, angular unit and background reference.',
    'The source catalog or astrometric model must separate annual parallax from proper motion.', [
      proposed('1.3', 'Show a changing apparent direction against a fixed sky-coordinate grid.'),
      proposed('3.1', 'Relate the measured angular shift to the known projected baseline and target distance.'),
      proposed('6.5', 'Inspect a survey source at two scan epochs with an identified background reference.'),
      proposed('27.1', 'Use nearby parallax calibrators on the first rung of a distance ladder.'),
    ]),
  design('spectral-line-profile', 'Resolved spectral line profile',
    'Draw one line against wavelength or a calibrated velocity offset, with continuum, rest wavelength and measured width marked.',
    'Wavelength grid, rest wavelength, normalized intensity or flux, continuum convention, spectral resolution and optional component IDs.',
    'Each application supplies its own formation or broadening model and instrument response.', [
      proposed('5.1', 'Locate a transition at its laboratory wavelength and measure its profile relative to the continuum.'),
      proposed('7.3', 'Track separate stellar line centroids at several orbital phases with labeled component identities.'),
      proposed('8.1', 'Show how the strength and width of the same absorption line change between spectra.'),
      proposed('9.5', 'Compare alternative broadening calculations on the same wavelength and continuum scale.'),
      proposed('24.3', 'Measure tracer line centroids before interpreting line-of-sight velocities in a Galactic frame.'),
    ]),
  design('spectrum-passband', 'Spectrum and passband integrator',
    'Overlay a calibrated response on a spectral-density curve and shade the interval contributing to the detector reading.',
    'Wavelength or frequency grid, spectral-density units, dimensionless response and energy-counting or photon-counting convention.',
    'Predicted counts depend on the response, collecting area and calibration. Changing spectral coordinates also changes the density scale.', [
      proposed('3.4', 'Sample thermal spectra at different temperatures on the same spectral coordinate.'),
      proposed('3.6', 'Integrate one stellar spectrum through two passbands before comparing calibrated colors.'),
      proposed('6.4', 'Show how an instrument response selects a band of the incident spectrum.'),
      proposed('29.2', 'Compare a calibrated microwave-background spectrum with a thermal reference using the detector frequency bands.'),
    ]),
  design('hr-diagram', 'Temperature–luminosity diagram',
    'Place stars on a logarithmic luminosity axis and a temperature axis decreasing to the right. Track one object or select a cluster.',
    'Effective temperature in kelvin, bolometric luminosity in a declared unit, persistent IDs and optional age or membership.',
    'An observed color–magnitude diagram needs passband, distance and extinction calibration before comparison with these physical axes.', [
      proposed('8.2', 'Build the temperature–luminosity diagram from a specified stellar sample.'),
      proposed('10.6', 'Compare model main-sequence points over a range of masses.'),
      proposed('12.3', 'Follow a pre-main-sequence model as its luminosity and effective temperature evolve.'),
      proposed('13.1', 'Follow a stellar evolutionary track with an age marker.'),
      proposed('13.3', 'Compare a cluster sequence with an isochrone in the same physical coordinates.'),
      proposed('15.1', 'Place the model’s massive-star track on the same axes before core collapse.'),
      proposed('16.5', 'Trace a model white dwarf along its cooling track.'),
    ]),
  design('radial-shells', 'Radial shells and profile',
    'Select a shell in a spherical cutaway and highlight its radius interval on the accompanying one-dimensional density profile.',
    'Physical inner and outer shell radii, density with units, radial normalization and model identity.',
    'Each body requires a radial model. A spherically averaged profile discards angular structure.', [
      proposed('10.1', 'Inspect density at the radius used to evaluate hydrostatic support.'),
      proposed('10.5', 'Compare the radial zones of numerically integrated stellar models.'),
      proposed('11.1', 'Mark radial regions of a solar model and read the corresponding local density.'),
      proposed('15.3', 'Compare mass-density shells from successive model snapshots of core collapse.'),
      proposed('16.2', 'Show the density stratification of a supplied white-dwarf model.'),
      proposed('20.3', 'Identify Earth’s interior layers on a supplied radial density profile.'),
    ]),
  design('opacity-sightline', 'Optical-depth sightline',
    'Draw cells along one ray, label their optical-depth increments and accumulate the attenuation of a background beam.',
    'Ordered cell lengths and extinction coefficients at a chosen wavelength, plus an incident intensity or declared unit baseline.',
    'The transmitted direct beam uses exp(−τ). Emission and light scattered into the ray require a source function.', [
      proposed('9.2', 'Compare extinction coefficients along the same ray at two wavelengths.'),
      proposed('9.3', 'Accumulate the optical depth through a stratified atmosphere for the direct transmitted component.'),
      proposed('12.1', 'Attenuate a supplied background beam through a modeled interstellar dust column.'),
      proposed('19.3', 'Compare slant and vertical optical depths through an atmospheric profile.'),
      proposed('28.2', 'Inspect how a modeled obscuring column changes direct nuclear light along different sightlines.'),
    ]),
  design('spacetime-cone', 'Light cone and worldlines',
    'Draw events and worldlines on equally scaled space and light-travel-distance axes and classify their separations.',
    'A declared inertial or local orthonormal frame, events (x, ct) in common length units and a metric convention.',
    'The 45-degree light-ray construction applies in these local coordinates. Curved-spacetime geodesics require a metric and integration.', [
      proposed('4.2', 'Compare the coordinates of the same events in two inertial frames.'),
      proposed('4.3', 'Separate timelike, spacelike and null intervals using the light cone.'),
      proposed('17.2', 'Draw a local frame’s cone at an event on a supplied geodesic.'),
    ]),
  design('rotation-profile', 'Ring-linked rotation curve',
    'Select an annulus in a disk and read its circular speed against physical radius. A separate layer can show a predicted curve.',
    'Radial bins, rotation speeds with units, center, disk plane, reference frame and uncertainties or model provenance.',
    'The velocity deprojection and dynamical interpretation depend on the system. One Kepler law cannot describe every rotation curve.', [
      proposed('18.2', 'Compare a disk’s speed profile with a model using the central mass.'),
      proposed('21.3', 'Relate ring orbital speeds to radii around a giant planet.'),
      proposed('24.3', 'Link stellar or gas tracers to the inferred Milky Way rotation curve.'),
      proposed('25.2', 'Compare a nearby spiral galaxy’s measured rotation curve with a chosen mass model.'),
    ]),
  design('density-contrast-slice', 'Comoving density-contrast slice',
    'Follow a co-registered slice across simulation snapshots and color (ρ − mean ρ)/mean ρ on one dimensionless scale.',
    'Comoving coordinates, density field, component, mean-density definition, scale factor, slice thickness and smoothing length.',
    'A density slice represents the model mass field. An image of emitted or lensed light needs a forward calculation.', [
      proposed('26.2', 'Follow a forming galaxy’s environment in matched snapshots of the same comoving region.'),
      proposed('27.3', 'Locate forming clusters in a fixed-depth slice of a simulated mass field.'),
      proposed('30.2', 'Track the growth of structure using the same smoothing and contrast scale at each epoch.'),
    ]),
  design('energy-ladder', 'Atomic levels and transition energy',
    'Draw quantized energy levels on a vertical scale. Mark a selected transition with its energy difference and photon wavelength.',
    'Species and ionization state, identified levels with energies, transition IDs, and vacuum or air wavelength convention.',
    'Line strength and line shape require populations, transition probabilities and broadening inputs.', [
      proposed('3.5', 'Relate a specified energy difference to one emitted or absorbed photon.'),
      proposed('5.1', 'Connect identified transitions to laboratory spectral-line wavelengths.'),
      proposed('5.3', 'Compare energy levels in a hydrogenic model.'),
      proposed('8.1', 'Identify the stellar absorption-line transition before adding population and atmosphere calculations.'),
    ]),
];

function freeze(data) {
  if (data && typeof data === 'object' && !Object.isFrozen(data)) {
    for (const child of Object.values(data)) freeze(child);
    Object.freeze(data);
  }
  return data;
}

export const assetTemplates = freeze(catalog.map(({ uses, ...template }) => template));
export const topicAssetUses = freeze(catalog.flatMap(asset => asset.uses.map(use => ({
  ...use, assetId: asset.id, evidence: use.evidence ? [use.evidence] : asset.source,
}))));

const topics = new Map([...coverage.parts, ...coverage.chapters, ...coverage.sections].map(topic => [topic.id, topic]));
const assetById = new Map(assetTemplates.map(asset => [asset.id, asset]));
const mappings = new Map();
for (const use of topicAssetUses) {
  let topic = topics.get(use.topicId);
  if (!topic || topic.level !== 'section') throw new Error('Unknown atlas section: ' + use.topicId);
  while (topic) {
    if (!mappings.has(topic.id)) mappings.set(topic.id, new Map());
    const group = mappings.get(topic.id);
    if (!group.has(use.assetId)) group.set(use.assetId, { assetId: use.assetId, status: 'proposed', uses: [] });
    const entry = group.get(use.assetId);
    entry.uses.push(use);
    if (use.status === 'demonstrated') entry.status = 'demonstrated';
    topic = topics.get(topic.parentId);
  }
}
const entries = new Map([...mappings].map(([id, group]) => [id, freeze([...group.values()])]));
const empty = Object.freeze([]);

/** One entry per asset, including each specific supporting section mapping. */
export function assetsForTopic(id) {
  return entries.get(id) ?? empty;
}

export const reuseMethod = freeze({
  meaning: 'An edge counts distinct visual assets with a specific use in both topics. A parent topic inherits the documented uses of its children.',
  evidence: 'Demonstrated means a cited project recipe exercises the stated teaching use. Proposed uses and unbuilt specifications describe editorial plans. Reference coverage is calculated separately.',
  overview: 'By default the overview shows up to three links per topic. It pairs uncovered topics first, then fills spare slots. Within a pass, demonstrated matches precede authored templates, then larger shared-asset counts. Catalog order breaks ties.',
  scope: 'The crosswalk is selective. An empty mapping means no specific asset use has been documented here yet. Generic cameras, labels, axes and page counts do not create links.',
});

function sharedEdge(source, target, lookup) {
  const evidence = [];
  const rightAssets = lookup(target);
  for (const left of lookup(source)) {
    const right = rightAssets.find(item => item.assetId === left.assetId);
    if (!right) continue;
    const demonstrated = left.status === 'demonstrated' && right.status === 'demonstrated';
    evidence.push({ assetId: left.assetId, status: demonstrated ? 'demonstrated' : 'proposed',
      implementationStatus: assetById.get(left.assetId).implementationStatus, sourceUses: left.uses, targetUses: right.uses });
  }
  if (!evidence.length) return null;
  const demonstratedCount = evidence.filter(item => item.status === 'demonstrated').length;
  const authoredCount = evidence.filter(item => item.implementationStatus === 'authored').length;
  const status = demonstratedCount === 0 ? 'proposed' : demonstratedCount === evidence.length ? 'demonstrated' : 'mixed';
  return { source, target, assetIds: evidence.map(item => item.assetId), weight: evidence.length,
    status, demonstratedCount, authoredCount, evidence };
}

/**
 * Build links only between the supplied nodes at one hierarchy level.
 * allEdges retains every supported pair for selection and inspection.
 */
export function createReuseGraphBuilder(topicList, lookup) {
  const order = new Map(topicList.map((topic, index) => [topic.id, index]));
  const levels = new Map(topicList.map(topic => [topic.id, topic.level]));
  return function buildGraph(visibleTopics, { maxDegree = 3 } = {}) {
    if (!Number.isSafeInteger(maxDegree) || maxDegree < 0) throw new RangeError('maxDegree must be a nonnegative integer.');
    const nodes = [...visibleTopics].sort((a, b) => order.get(a.id) - order.get(b.id));
    const ids = new Set(nodes.map(node => node.id));
    if (ids.size !== nodes.length || nodes.some(node => !levels.has(node.id) || levels.get(node.id) !== nodes[0].level)) {
      throw new Error('Choose distinct atlas topics from a single hierarchy level.');
    }
    const allEdges = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const edge = sharedEdge(nodes[i].id, nodes[j].id, lookup);
        if (edge) allEdges.push(edge);
      }
    }
    allEdges.sort((a, b) => b.demonstratedCount - a.demonstratedCount || b.authoredCount - a.authoredCount ||
      b.weight - a.weight || order.get(a.source) - order.get(b.source) || order.get(a.target) - order.get(b.target));
    const degree = new Map(nodes.map(node => [node.id, 0]));
    const selected = new Set();
    for (const minimumUncovered of [2, 1, 0]) {
      for (const edge of allEdges) {
        const left = degree.get(edge.source), right = degree.get(edge.target);
        if (selected.has(edge) || left >= maxDegree || right >= maxDegree) continue;
        if (Number(left === 0) + Number(right === 0) < minimumUncovered) continue;
        selected.add(edge);
        degree.set(edge.source, left + 1);
        degree.set(edge.target, right + 1);
      }
    }
    const edges = allEdges.filter(edge => selected.has(edge));
    return { nodes, edges, allEdges, policy: { ...reuseMethod, maxDegree, shown: edges.length,
      total: allEdges.length, omitted: allEdges.length - edges.length } };
  };
}

export const buildReuseGraph = createReuseGraphBuilder([...topics.values()], assetsForTopic);
