// Directed teaching links: an idea in "from" helps answer the question in "to".
// These are editorial paths through this particular roadmap. Adding a page, a
// runnable study or a shared visual does not create a learning dependency.
import { roadmap } from './roadmap.mjs';

const openstax = section => 'https://openstax.org/books/astronomy-2e/pages/' + section;
const binaries = openstax('18-2-measuring-stellar-masses');
const solarInterior = openstax('16-3-the-solar-interior-theory');
const spectra = openstax('17-4-using-spectra-to-measure-stellar-radius-composition-and-motion');
const distances = openstax('19-4-the-h-r-diagram-and-cosmic-distances');
const background = openstax('29-4-the-cosmic-microwave-background');

// One row per teaching step, with its actual concept rather than merely a shared
// word or a fact that two objects belong to the same scientific field.
export const learningLinks = [
  ['star-trails', 'seasons', 'The center of a star trail locates Earth’s spin axis. Its tilt helps explain why daylight changes over a year.'],
  ['lunar-phases', 'eclipses', 'The phases identify the two alignments at which the Moon can cast or enter a shadow.'],
  ['eclipses', 'eclipsing-binaries', 'The changing area hidden during an eclipse explains the repeating dips of an eclipsing star pair.'],
  ['eclipses', 'planetary-transits', 'A transit uses the same line-of-sight alignment as a solar eclipse, with a smaller silhouette.'],
  ['orbital-free-fall', 'elliptical-orbits', 'A continuing inward acceleration bends the path of a freely falling planet into an orbit.'],
  ['orbital-free-fall', 'orbital-periods', 'Balancing gravity with the acceleration needed to turn an orbit relates orbital size to period.'],
  ['orbital-free-fall', 'bound-clusters', 'Comparing the speed of a falling body with escape speed helps explain how a cluster holds its stars.'],
  ['orbital-free-fall', 'galactic-orbits', 'A star falling through a galaxy’s gravitational field continually changes direction.'],
  ['orbital-free-fall', 'tides', 'Two nearby points fall toward a distant mass at slightly different accelerations, stretching the body between them.'],
  ['orbital-free-fall', 'collapsing-clouds', 'Gas can fall toward a cloud’s center when its own gravity overcomes internal support.'],
  ['orbital-free-fall', 'accretion-disks', 'Orbiting gas must transfer angular momentum before gravity can carry it much closer to the center.'],
  ['orbital-periods', 'retrograde-motion', 'The different periods of Earth and Mars explain why Earth periodically overtakes Mars.'],
  ['orbital-periods', 'stellar-masses', 'The measured size and period of a binary orbit constrain the mass attracting the stars.', binaries],
  ['orbital-periods', 'asteroid-gaps', 'An orbital period ratio tells us which asteroids receive repeated gravitational tugs at the same orbital phase.'],
  ['orbital-periods', 'planetary-rings', 'Ring particles at different distances have different orbital periods and speeds.'],
  ['orbital-periods', 'tidal-locking', 'Compare a moon’s spin period to its orbital period to understand why the same face remains visible.'],
  ['elliptical-orbits', 'tidal-heating', 'Changing distance along an eccentric orbit changes the tidal distortion each time the moon goes around.'],
  ['elliptical-orbits', 'planetary-architectures', 'Orbital shape and orientation let us compare the arrangement of planets in different systems.'],
  ['orbital-periods', 'planet-migration', 'An exchange of angular momentum moves a planet onto an orbit with a different radius and period.'],
  ['bound-clusters', 'escaping-air', 'The escape-speed comparison that distinguishes bound and escaping stars also applies to fast particles in a planetary atmosphere.'],
  ['bound-clusters', 'elliptical-galaxies', 'A distribution of stellar speeds can support a round system against its collective gravity.'],
  ['bound-clusters', 'galaxy-clusters', 'The motions of galaxies relative to one another help measure the mass needed to bind a cluster.'],
  ['photons', 'spectral-fingerprints', 'Absorbing or emitting one photon can move an atom between two allowed energy levels.'],
  ['photons', 'resolving-stars', 'The wave behavior of light sets a diffraction limit even when a telescope collects many photons.'],
  ['photons', 'photon-escape', 'Repeated absorption and scattering change the path a photon takes on its way out of a star.', solarInterior],
  ['spectral-fingerprints', 'broad-lines', 'Knowing the wavelength of a single atomic transition lets us recognize when its profile has been spread out.', spectra],
  ['spectral-fingerprints', 'absorption-lines', 'Atoms remove photons at characteristic wavelengths, leaving a signature in the escaping spectrum.'],
  ['spectral-fingerprints', 'doppler-pairs', 'Known line wavelengths give us a reference for the alternating redshifts and blueshifts of orbiting stars.', binaries],
  ['spectral-fingerprints', 'auroras', 'Different atmospheric atoms and molecules release photons with different colors after they are excited.'],
  ['spectral-fingerprints', 'cosmic-redshift', 'Matching a pattern of lines to laboratory wavelengths reveals that the whole spectrum has shifted.'],
  ['thermal-colors', 'multiwavelength-sky', 'Material at different temperatures can glow most strongly in very different observing bands.'],
  ['thermal-colors', 'main-sequence', 'Surface temperature supplies one of the coordinates that separates stars on a luminosity–temperature diagram.'],
  ['thermal-colors', 'limb-darkening', 'Cooler layers of the Sun emit less visible light than the hotter layers seen nearer the disk center.'],
  ['thermal-colors', 'snow-lines', 'Estimating the temperature of a disk helps locate where a volatile can condense onto grains.'],
  ['thermal-colors', 'greenhouse-warming', 'A cool planet emits at longer wavelengths than its hotter star, so different parts of the spectrum enter its heat budget.'],
  ['thermal-colors', 'cosmic-afterglow', 'The thermal spectrum of the microwave background tells us the temperature of the relic radiation.', background],
  ['resolving-stars', 'linked-dishes', 'The connection between aperture and resolving power motivates combining signals across a long baseline.'],
  ['resolving-stars', 'central-black-hole', 'Separating stars on a crowded sky lets astronomers follow individual orbits near the Galactic center.'],
  ['linked-dishes', 'galactic-jets', 'Long radio baselines resolve compact structures near the base of a jet.'],
  ['multiwavelength-sky', 'dark-nebulae', 'Comparing visible and infrared views shows how a dark patch can hide stars behind a dusty cloud.'],
  ['multiwavelength-sky', 'x-ray-binaries', 'Very hot accreting gas can stand out in X-rays even when the companion dominates visible light.'],
  ['sky-surveys', 'stellar-parallax', 'Repeated measurements of the same field let us separate a star’s annual apparent shift from its long-term motion.'],
  ['stellar-parallax', 'standard-candles', 'Nearby stars with geometric distances can calibrate the luminosities used on more distant distance-ladder rungs.', distances],
  ['fading-light', 'standard-candles', 'The inverse-square relation turns a known luminosity and a measured flux into a distance.', distances],
  ['fading-light', 'main-sequence', 'Correcting measured brightness for distance gives the luminosity used to place a star on a stellar diagram.', distances],
  ['standard-candles', 'accelerating-expansion', 'Distances inferred from calibrated supernova brightnesses reveal the expansion history when paired with redshifts.'],
  ['moving-clocks', 'light-cones', 'Observers who disagree about elapsed time still agree on the light rays bounding an event’s causal reach.'],
  ['light-cones', 'gravitational-lenses', 'Following the locally allowed directions of light through curved spacetime gives the paths of lensed images.'],
  ['gravitational-lenses', 'galaxy-clusters', 'The bending of background light measures how mass is distributed across a foreground cluster.'],
  ['light-cones', 'event-horizons', 'Tracing where future-directed light can travel distinguishes an event horizon from an ordinary material surface.'],
  ['light-cones', 'cosmic-inflation', 'The reach of light signals sets the horizon problem that inflation was proposed to explain.'],
  ['dark-nebulae', 'dusty-nuclei', 'A foreground column of dust can obscure the light of a central engine along some directions.'],
  ['dark-nebulae', 'galactic-band', 'Dust along the Galactic disk explains why dark lanes interrupt its bright band.'],
  ['stellar-balance', 'collapsing-clouds', 'Comparing pressure support with gravity lets us ask when a cloud can no longer maintain equilibrium.'],
  ['stellar-balance', 'stellar-waves', 'A small displacement from equilibrium lets pressure and gravity act as restoring forces for oscillations.'],
  ['stellar-balance', 'core-collapse', 'Collapse begins when pressure can no longer support a massive stellar core against gravity.'],
  ['stellar-balance', 'white-dwarfs', 'Balancing gravity against the pressure of degenerate electrons explains how a white dwarf can remain stable.'],
  ['stellar-balance', 'planet-layers', 'The increasing pressure needed to support material at depth also matters when modeling a planet’s interior.'],
  ['collapsing-clouds', 'protostars', 'As one region contracts, gravitational energy heats the growing central object.'],
  ['protostars', 'dust-to-planets', 'Rotating material around a forming star supplies the disk in which solid particles can grow.'],
  ['hydrogen-fusion', 'solar-neutrinos', 'The reactions that convert hydrogen into helium in the Sun produce neutrinos as well as energy.'],
  ['hydrogen-fusion', 'main-sequence', 'Sustained core hydrogen burning is what main-sequence stars have in common.'],
  ['hydrogen-fusion', 'element-forges', 'Combining light nuclei introduces the same nuclear bookkeeping needed to follow later stages of element production.'],
  ['hydrogen-fusion', 'first-nuclei', 'The idea that nuclei fuse only under suitable conditions helps explain the brief window for early nucleosynthesis.'],
  ['hydrogen-fusion', 'novae', 'Hydrogen fusion can run away in the compressed layer accreted on a white dwarf.'],
  ['stellar-convection', 'sunspots', 'Suppressing convection cuts the local supply of heat to the visible surface of the Sun.'],
  ['stellar-convection', 'giant-planet-weather', 'Heat carried by buoyant gas can help drive motions in giant-planet atmospheres.'],
  ['photon-escape', 'limb-darkening', 'The depth from which light can escape changes with the angle of the sightline across the stellar disk.'],
  ['photon-escape', 'absorption-lines', 'When opacity rises in a line, the light that reaches us can come from a cooler layer higher in the atmosphere.'],
  ['absorption-lines', 'quasar-backlights', 'A recognizable pattern of absorption lines identifies gas in front of a bright quasar.'],
  ['sunspots', 'solar-flares', 'Concentrated fields in active regions help locate places where magnetic energy can build up and be released.'],
  ['solar-wind', 'auroras', 'The solar wind can transfer energy to Earth’s magnetosphere and power particle precipitation.'],
  ['solar-wind', 'comet-tails', 'The flowing solar plasma helps sweep a comet’s ionized material into its ion tail.'],
  ['main-sequence', 'red-giants', 'The end of core hydrogen burning marks the departure from the main sequence toward the giant branch.'],
  ['main-sequence', 'cluster-turnoff', 'The masses that still lie on a cluster’s main sequence tell us which stars have had time to evolve away.'],
  ['red-giants', 'white-dwarfs', 'After a low-mass giant loses its envelope, its dense exposed core becomes a white dwarf.'],
  ['element-forges', 'core-collapse', 'A massive star’s sequence of nuclear fuels explains why the growth of an iron core ends a major source of support.'],
  ['stellar-masses', 'central-black-hole', 'The same dynamical weighing principle used for binaries measures the mass inside the innermost stellar orbits.'],
  ['eclipsing-binaries', 'planetary-transits', 'Reading a light curve as changing projected overlap carries over from stellar eclipses to planetary transits.'],
  ['doppler-pairs', 'stellar-wobble', 'The alternating line shift of a binary becomes a way to detect a companion even when only the star is visible.', spectra],
  ['doppler-pairs', 'stellar-masses', 'Radial velocity curves provide orbital speeds for determining stellar masses in spectroscopic binaries.', binaries],
  ['mass-transfer', 'accretion-disks', 'Gas crossing from one binary companion toward another usually carries angular momentum and can form a disk.'],
  ['mass-transfer', 'novae', 'Transfer from a companion supplies the surface fuel for the outburst.'],
  ['mass-transfer', 'white-dwarf-explosions', 'Adding mass from a companion is one route to igniting a white dwarf in a Type Ia explosion.'],
  ['stellar-waves', 'cepheid-pulses', 'A Cepheid’s changing size and brightness trace a large-scale radial oscillation.'],
  ['stellar-waves', 'starquakes', 'Distinct oscillation frequencies probe the layers through which waves propagate.'],
  ['cepheid-pulses', 'standard-candles', 'Measuring a Cepheid’s pulsation period helps infer its luminosity from a calibrated relation.', distances],
  ['white-dwarf-explosions', 'accelerating-expansion', 'The brightness histories of Type Ia explosions let observers standardize their luminosities across galaxies.'],
  ['core-collapse', 'neutron-stars', 'The collapse of a massive stellar core can leave a compact neutron-rich remnant.'],
  ['core-collapse', 'gamma-ray-bursts', 'Collapse of some rapidly rotating massive stars can power a jet and a long gamma-ray burst.'],
  ['core-collapse', 'cosmic-rays', 'Shocks expanding from a stellar explosion are candidate accelerators of energetic particles.'],
  ['white-dwarfs', 'cooling-dwarfs', 'A white dwarf with no sustained core fusion shines by losing stored heat.'],
  ['white-dwarfs', 'white-dwarf-explosions', 'Understanding degenerate stellar matter helps explain how thermonuclear burning can disrupt a white dwarf.'],
  ['white-dwarfs', 'novae', 'The compact white dwarf supplies the strong gravity that compresses an accreted hydrogen layer.'],
  ['neutron-stars', 'pulsars', 'A rotating magnetized neutron star can sweep a radiation beam across Earth once each rotation.'],
  ['neutron-stars', 'gamma-ray-bursts', 'Merging neutron stars can help launch the relativistic outflows associated with short bursts.'],
  ['accretion-disks', 'x-ray-binaries', 'Infall through a disk releases energy near a compact binary companion and can heat matter to X-ray temperatures.'],
  ['accretion-disks', 'quasars', 'The release of orbital binding energy through accretion can power a luminous galactic nucleus.'],
  ['accretion-disks', 'galactic-jets', 'An accretion flow supplies magnetic fields and matter near the launching region of a jet.'],
  ['planet-layers', 'giant-planet-weather', 'Energy flowing up from a giant planet’s warm interior can help power storms in its outer layers.'],
  ['greenhouse-warming', 'martian-rivers', 'Atmospheric warming changes the surface conditions under which liquid water could persist on early Mars.'],
  ['tides', 'tidal-locking', 'A lagging tidal distortion exerts a torque that can change a moon’s spin until it matches its orbit.'],
  ['tides', 'tidal-heating', 'Repeated tidal deformation can dissipate mechanical energy inside a moon.'],
  ['tides', 'tidal-tails', 'The same variation of gravitational acceleration across a body can draw long tails out of a passing galaxy.'],
  ['icy-outskirts', 'comet-tails', 'Icy bodies can begin releasing gas and dust as their orbits carry them close to the Sun.'],
  ['comet-tails', 'meteor-showers', 'Dust released by a comet can remain near its orbit as a stream that Earth later crosses.'],
  ['dust-to-planets', 'meteorites', 'Primitive meteorites preserve solids from the early process of building planetary bodies.'],
  ['meteorites', 'impact-craters', 'A solid body that reaches a surface at high speed transfers energy that can excavate a crater.'],
  ['snow-lines', 'dust-to-planets', 'Condensation of ices changes the supply of solid material available for building planets.'],
  ['dust-to-planets', 'planet-migration', 'Growing planets can exchange angular momentum with the disk in which they formed.'],
  ['planetary-transits', 'planetary-architectures', 'Transit surveys reveal orbital periods but preferentially detect systems aligned with our sightline.'],
  ['stellar-wobble', 'planetary-architectures', 'Radial velocity measurements supply a complementary sample with different mass and period sensitivities.'],
  ['galactic-orbits', 'dark-matter', 'Comparing orbital speeds with the gravity expected from visible matter reveals the missing mass in rotation curves.'],
  ['galactic-orbits', 'spiral-arms', 'Comparing the motion of disk stars with the arm pattern explains how stars can enter and leave an arm.'],
  ['galactic-disks', 'galactic-band', 'Viewing a stellar disk from within gives a long path through its stars along one band of the sky.'],
  ['galactic-disks', 'spiral-arms', 'A rotating stellar and gaseous disk provides the setting for spiral patterns.'],
  ['galactic-disks', 'tidal-tails', 'The stars and gas displaced from a galactic disk supply material for a tidal tail.'],
  ['tidal-tails', 'galaxy-mergers', 'Tidal debris records how the encounter redistributes material while two galaxies approach a merger.'],
  ['galaxy-mergers', 'galaxy-assembly', 'Combining smaller systems is one route by which a galaxy acquires stars and dark matter.'],
  ['quasars', 'dusty-nuclei', 'An intrinsically bright central source can look very different when intervening dust hides our view.'],
  ['quasars', 'quasar-backlights', 'A distant luminous nucleus supplies the background light that reveals the gas it crossed.'],
  ['cosmic-redshift', 'accelerating-expansion', 'Redshift gives the expansion factor to compare with the distance inferred from supernova brightness.'],
  ['cosmic-redshift', 'cosmic-afterglow', 'Expansion stretches the wavelength of the relic radiation into the microwave band.', background],
  ['cosmic-redshift', 'cosmic-geometry', 'A source’s redshift specifies the expansion factor used to relate its observed angle to its physical size.'],
  ['cosmic-afterglow', 'cosmic-inflation', 'The similar temperatures of widely separated sky regions motivate the question of earlier causal contact.'],
  ['cosmic-afterglow', 'sound-horizon', 'The microwave background records acoustic oscillations in the plasma before light began to travel freely.'],
  ['dark-matter', 'galaxy-clusters', 'Dark matter contributes much of the gravitational field that binds a galaxy cluster.'],
  ['dark-matter', 'cosmic-filaments', 'Dark matter can amplify initial density differences gravitationally, helping build filaments and voids.'],
  ['cosmic-filaments', 'galaxy-assembly', 'Filaments guide material into the dense regions where galaxies grow.'],
  ...roadmap.phenomena.filter(n => n.kind === 'technique').flatMap(n => [
    ...n.prerequisites.map(({ id, reason }) => [id, n.id, reason, n.source.url]),
    ...n.applications.map(({ id, reason }) => [n.id, id, reason, n.source.url]),
  ]),
].map(([from, to, reason, source]) => Object.freeze({ from, to, reason, ...(source && { source }) }));
Object.freeze(learningLinks);

function rank(rows) {
  const scores = rows.map(row => row.score);
  for (const row of rows) {
    const below = scores.filter(score => score < row.score).length;
    const tied = scores.filter(score => score === row.score).length;
    row.rank = 1 + rows.length - below - tied;
    row.peerCount = rows.length;
    row.percentile = 100 * (below + tied / 2) / rows.length;
  }
}

export function buildFoundations(phenomena, domains, links) {
  const index = new Map(phenomena.map((n, i) => [n.id, i]));
  const domainIndex = new Map(domains.map((n, i) => [n.id, i]));
  const parent = new Map(phenomena.map(n => [n.id, n.parentId]));
  const outgoing = new Map(phenomena.map(n => [n.id, new Map()]));
  const incoming = new Map(phenomena.map(n => [n.id, new Set()]));
  const domainDistances = new Map(domains.map(n => [n.id, new Map()]));
  const domainExamples = new Map(domains.map(n => [n.id, new Map()]));
  const domainIncoming = new Map(domains.map(n => [n.id, new Set()]));
  for (const { id, parentId } of phenomena) {
    if (!domainIndex.has(parentId)) throw new Error('Unknown domain for ' + id);
  }
  for (const link of links) {
    const { from, to } = link;
    if (!index.has(from) || !index.has(to) || !link.reason?.trim()) throw new Error('Invalid learning link: '+from+' → '+to);
    if (outgoing.get(from).has(to)) throw new Error('Duplicate learning link: '+from+' → '+to);
    outgoing.get(from).set(to, link);
    incoming.get(to).add(from);
    const a = parent.get(from), b = parent.get(to);
    if (a !== b) {
      if (!domainExamples.get(a).has(b)) domainExamples.get(a).set(b, link);
      domainIncoming.get(b).add(a);
    }
  }

  function measure(distances, prerequisites, examplesById, order) {
    const sorted = [...distances].sort(([a, da], [b, db]) => da - db || order.get(a) - order.get(b));
    const score = Number(sorted.reduce((sum, [, steps]) => sum + 1 / steps, 0).toFixed(12));
    const directIds = sorted.filter(([, steps]) => steps === 1).map(([id]) => id);
    return { score, mass: 1 + score, directIds,
      reachableIds: sorted.map(([id]) => id), prerequisiteIds: [...prerequisites].sort((a,b) => order.get(a)-order.get(b)),
      examples: directIds.map(id => examplesById.get(id)) };
  }

  const scores = new Map();
  for (const { id, parentId } of phenomena) {
    const distances = new Map([[id, 0]]), queue = [id];
    for (let i = 0; i < queue.length; i++) {
      const from = queue[i], steps = distances.get(from) + 1;
      for (const to of outgoing.get(from).keys()) {
        if (to === id) throw new Error('Circular learning path at ' + id);
        if (distances.has(to)) continue;
        distances.set(to, steps);
        queue.push(to);
      }
    }
    distances.delete(id);
    scores.set(id, measure(distances, incoming.get(id), outgoing.get(id), index));
    // Minimize across *actual phenomenon paths* to each outside domain.
    // Projecting direct links onto domains first would invent paths that pass
    // between two unrelated siblings in an intermediate domain.
    const minimum = domainDistances.get(parentId);
    for (const [target, distance] of distances) {
      const group = parent.get(target);
      if (group !== parentId) minimum.set(group, Math.min(distance, minimum.get(group) ?? Infinity));
    }
  }
  for (const { id } of domains) {
    scores.set(id, measure(domainDistances.get(id), domainIncoming.get(id), domainExamples.get(id), domainIndex));
  }
  rank(phenomena.map(n => scores.get(n.id)));
  rank(domains.map(n => scores.get(n.id)));
  return scores;
}

const scores = buildFoundations(roadmap.phenomena, roadmap.domains, learningLinks);
export const foundationFor = id => scores.get(id);
