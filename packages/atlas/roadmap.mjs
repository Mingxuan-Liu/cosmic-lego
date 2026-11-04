// The learner-facing taxonomy is editorial. Section numbers are crosswalk keys into
// the separately maintained print ledger. Each key can support several phenomena.
import { coverage } from './coverage.mjs';

const families = [
  { id: 'part-1', label: 'Sky & light' },
  { id: 'part-2', label: 'Stars & remnants' },
  { id: 'part-3', label: 'Planetary systems' },
  { id: 'part-4', label: 'Galaxies & universe' },
];

function topic(id, label, question, insight, refs, assets = '', aliases = '') {
  return { id, label, question, insight, refs: refs.split(' '),
    assetIds: assets ? assets.split(' ') : [], keywords: aliases ? aliases.split('|') : [] };
}

function domain(part, id, label, question, children) {
  return { partId: 'part-' + part, id, label, question, children };
}

const catalog = [
  domain(1, 'sky-cycles', 'The changing sky', 'Which motions can you read from the sky without a telescope?', [
    topic('star-trails', 'Star trails', 'Why do stars draw arcs in a long exposure?',
      'As Earth turns, stars appear to circle the celestial poles, tracing longer arcs farther from each pole.', '1.1 1.3', '', 'night sky|Earth rotation'),
    topic('seasons', 'Seasons', 'Why does the midday Sun rise higher in summer?',
      'Earth’s tilted axis changes the angle of sunlight and the length of daylight over the course of its orbit.', '1.3', '', 'solstice|equinox|axial tilt'),
    topic('lunar-phases', 'Moon phases', 'Why does the Moon change from a crescent to a full disk?',
      'Half of the Moon usually faces sunlight. As it orbits Earth, we see different fractions of that illuminated half.', '1.2 20.4', '', 'lunar cycle|crescent'),
    topic('eclipses', 'Eclipses', 'Why is there no eclipse at most new or full Moons?',
      'The Moon’s orbit is tilted. Only near a crossing of Earth’s orbital plane can the three bodies align closely enough for one world to enter the other’s shadow.', '1.3 7.3 20.4', 'sky-silhouettes', 'solar eclipse|lunar eclipse|orbital nodes'),
    topic('retrograde-motion', 'Wandering planets', 'Why does Mars sometimes appear to reverse direction?',
      'When Earth overtakes Mars, our changing sightline makes Mars trace a temporary backward path against the distant stars.', '1.1 1.2 1.4', '', 'retrograde motion|heliocentrism'),
  ]),
  domain(1, 'orbits', 'Orbits & gravity', 'How can a falling body keep missing the object it falls toward?', [
    topic('orbital-free-fall', 'Orbital free fall', 'What keeps an orbiting moon from falling straight down?',
      'Gravity continually turns the moon’s velocity as it moves sideways, bending its path around the planet.', '1.4 2.2'),
    topic('elliptical-orbits', 'Elliptical orbits', 'Where on its orbit does a planet move fastest?',
      'In a bound two-body orbit, the planet sweeps out equal areas in equal times and moves fastest near its closest approach.', '2.1 2.3 20.1', 'kepler-state', 'Kepler|eccentricity|perihelion'),
    topic('orbital-periods', 'Orbital periods', 'Why do the outer planets take so long to circle the Sun?',
      'Around the same star, a wider orbit has both a longer path and a lower characteristic orbital speed.', '2.3 21.1', 'kepler-state', 'Kepler laws|year'),
    topic('bound-clusters', 'Bound star clusters', 'What keeps a swarm of moving stars together?',
      'A cluster stays bound when its stars move slowly enough for their collective gravity to hold them.', '2.4 13.3', 'position-catalog', 'virial theorem|escape speed'),
  ]),
  domain(1, 'light', 'Light & color', 'What can starlight tell us before we make an image?', [
    topic('thermal-colors', 'Star colors', 'Why do hot stars look bluer?',
      'Hotter surfaces radiate across a broad range of wavelengths, with the peak of their thermal emission at a shorter wavelength.', '3.4 3.6', 'spectrum-passband', 'blackbody|color index|temperature'),
    topic('spectral-fingerprints', 'Atomic fingerprints', 'How can a set of dark or bright lines identify an element?',
      'An atom absorbs or emits photons at particular energies set by the differences between its allowed energy levels.', '3.5 5.1 5.3', 'spectral-line-profile energy-ladder', 'spectral lines|hydrogen|Balmer'),
    topic('photons', 'Counting photons', 'How can light form interference patterns yet arrive in individual counts?',
      'Waves describe the pattern of possible detections, while a detector registers light in individual quanta called photons.', '3.3 5.2 5.4', '', 'wave-particle duality|interference'),
    topic('broad-lines', 'Blurred spectral lines', 'Why does one spectral line occupy a range of wavelengths?',
      'Atoms moving at different speeds shift their light by different amounts, broadening the combined line even before other effects enter.', '9.5', 'spectral-line-profile', 'Doppler broadening|spectroscopy'),
  ]),
  domain(1, 'telescopes', 'Telescope views', 'How does changing the instrument change what the sky reveals?', [
    topic('resolving-stars', 'Resolving stars', 'When do two nearby stars blur into one?',
      'Even a perfect circular aperture spreads a point of light into a diffraction pattern whose width depends on wavelength and aperture diameter.', '6.1 6.2', '', 'resolution|diffraction|optics'),
    topic('linked-dishes', 'Linked dishes', 'How do separated radio dishes distinguish fine detail?',
      'Comparing the arriving waves across different dish separations measures different scales of structure on the sky.', '6.3', '', 'radio interferometry|baseline'),
    topic('multiwavelength-sky', 'Invisible skies', 'Why can a familiar object look different in infrared or X-rays?',
      'Dust, warm surfaces and extremely hot gas emit and transmit different wavelengths, so each observing band reveals different material.', '6.4 3.6', 'spectrum-passband', 'multiwavelength|infrared|ultraviolet|X-ray'),
    topic('sky-surveys', 'Sky surveys', 'How can repeated pictures reveal a changing sky?',
      'Matching the same sources across repeated observations can reveal motion or a change in brightness.', '6.5', 'position-catalog parallax-baseline', 'catalogs|astrometry'),
  ]),
  domain(1, 'distances', 'Cosmic distances', 'How do astronomers find distances without visiting their targets?', [
    topic('stellar-parallax', 'Stellar parallax', 'Why does a nearby star shift against a distant background over a year?',
      'Viewing the star from opposite sides of Earth’s orbit gives two sightlines, and a larger angular shift indicates a smaller distance.', '3.1 1.3', 'parallax-baseline', 'distance ladder|parsec'),
    topic('fading-light', 'Fading light', 'How quickly does a star grow fainter with distance?',
      'For a transparent path and an isotropic source, doubling the distance spreads the same emitted power over four times the area.', '3.2', '', 'magnitude|inverse square|flux'),
    topic('standard-candles', 'Standard candles', 'How can a familiar brightness pattern give a galaxy’s distance?',
      'A calibrated luminosity lets us turn the observed flux into a distance after allowing for effects such as intervening dust.', '14.1 18.5 27.1', 'relative-light-curve', 'Cepheid|Type Ia|distance ladder'),
  ]),
  domain(1, 'spacetime', 'Space & time', 'What happens to clocks and light rays in fast motion or strong gravity?', [
    topic('moving-clocks', 'Slowing clocks', 'Why can moving observers measure different elapsed times?',
      'Elapsed time along a moving clock’s path can differ from the time between the same events in another inertial frame.', '4.1 4.2 4.3', 'spacetime-cone', 'special relativity|time dilation'),
    topic('light-cones', 'Light cones', 'Which events could send a light signal to you in time?',
      'At each event the allowed light directions form a cone that separates events a causal signal can reach from those it cannot.', '4.2 4.3 17.2', 'spacetime-cone', 'causality|worldline'),
    topic('gravitational-lenses', 'Gravitational lenses', 'How can one distant source appear in several places?',
      'Mass curves spacetime, allowing light from one source to follow different paths to the observer.', '17.1 17.2 28.4', '', 'lensing|Einstein ring|bent starlight'),
  ]),

  domain(2, 'star-birth', 'Star birth', 'How does a cold cloud become a shining star?', [
    topic('dark-nebulae', 'Dark nebulae', 'Why do some clouds look like holes in the sky?',
      'Dust in a foreground cloud absorbs and scatters background starlight, especially at shorter visible wavelengths.', '12.1 9.2', 'opacity-sightline', 'interstellar medium|extinction'),
    topic('collapsing-clouds', 'Collapsing clouds', 'When does a patch of gas start falling inward?',
      'A dense region can contract when self-gravity overcomes support from gas pressure and other internal motions or fields.', '12.2 2.4', 'velocity-arrows', 'Jeans mass|star formation'),
    topic('protostars', 'Protostars', 'How does a young star shine before steady hydrogen fusion?',
      'Infall and contraction release gravitational energy that can emerge as radiation while the protostar grows and heats.', '12.2 12.3', 'hr-diagram', 'pre-main-sequence|T Tauri'),
  ]),
  domain(2, 'stellar-interiors', 'Inside stars', 'What keeps a star hot and stops it from collapsing?', [
    topic('stellar-balance', 'Pressure support', 'How can layers inside a star hold up the layers above?',
      'Pressure increases inward, creating an outward force that can balance the inward pull of gravity in each layer.', '10.1 10.2 10.5', 'radial-shells', 'hydrostatic equilibrium|equation of state'),
    topic('hydrogen-fusion', 'Hydrogen fusion', 'Where does the Sun get the energy it radiates?',
      'Its core turns hydrogen into helium, releasing some of the difference in mass as energy.', '10.3 10.6'),
    topic('stellar-convection', 'Stellar convection', 'How can rising gas carry heat toward the surface?',
      'Buoyant parcels rise through their surroundings and transfer heat, while cooler material sinks.', '10.4 11.1', 'temperature-field velocity-arrows', 'heat transport|granulation'),
    topic('solar-neutrinos', 'Solar neutrinos', 'Which particles can reach us almost directly from the solar core?',
      'Neutrinos produced in fusion interact so weakly with matter that most escape the Sun without scattering.', '10.3 11.1'),
  ]),
  domain(2, 'stellar-atmospheres', 'Stellar surfaces', 'What sets the appearance of a star’s visible surface?', [
    topic('photon-escape', 'Escaping light', 'From how deep inside a star can light reach our eyes?',
      'Most light escaping toward us was last emitted or scattered in layers with roughly one optical depth left along the sightline.', '9.1 9.2 9.3', 'opacity-sightline', 'photosphere|radiative transfer'),
    topic('limb-darkening', 'Limb darkening', 'Why is the Sun dimmer at its apparent edge in visible light?',
      'Near the edge our sightline samples higher, generally cooler photospheric layers than a sightline through the center of the disk.', '9.3 9.4 11.2', 'opacity-sightline', 'solar limb|radiative transfer'),
    topic('absorption-lines', 'Absorption lines', 'Why are some wavelengths missing from a star’s spectrum?',
      'At wavelengths with strong line opacity, light can emerge from higher, cooler gas, making those wavelengths dimmer than the nearby continuum.', '8.1 9.3 5.1', 'energy-ladder spectral-line-profile', 'stellar spectra|spectral classification'),
  ]),
  domain(2, 'space-weather', 'Space weather', 'How does the Sun change the space around Earth?', [
    topic('sunspots', 'Sunspots', 'Why are sunspots darker than their surroundings?',
      'Strong magnetic fields inhibit convection in a sunspot, leaving its visible surface cooler than the neighboring photosphere.', '11.2 11.3', '', 'magnetic cycle'),
    topic('solar-flares', 'Solar flares', 'How can sunlight brighten abruptly above an active region?',
      'Rapid release of stored magnetic energy heats solar plasma and accelerates particles, producing radiation across many wavelengths.', '11.3', '', 'magnetic reconnection'),
    topic('solar-wind', 'Solar wind', 'How does material from the Sun reach interplanetary space?',
      'Hot plasma escapes from the solar corona and streams outward, carrying the Sun’s magnetic field into the Solar System.', '11.2', '', 'corona|Parker wind'),
    topic('auroras', 'Auroras', 'What makes curtains of colored light near Earth’s poles?',
      'Energetic particles guided by Earth’s magnetic field excite atoms and molecules high in the atmosphere, which then emit light.', '11.2 20.3', '', 'northern lights|southern lights'),
  ]),
  domain(2, 'stellar-lives', 'Stellar lifetimes', 'Why can two stars born together look very different today?', [
    topic('main-sequence', 'The main sequence', 'Why do most stars lie along one band on a color–luminosity plot?',
      'Among core hydrogen-burning stars of similar composition, mass strongly influences both surface temperature and luminosity.', '8.2 10.6 13.1', 'hr-diagram', 'Hertzsprung–Russell|H-R diagram|HR diagram'),
    topic('red-giants', 'Red giants', 'How can an aging star become larger and cooler at its surface?',
      'After central hydrogen runs out, changes in the core and burning shells can drive the envelope to expand and cool.', '13.1 13.2', 'hr-diagram'),
    topic('cluster-turnoff', 'Cluster turnoffs', 'How does a star cluster remember its age?',
      'In a population born together, the most massive stars still burning hydrogen in their cores reveal how long the population has evolved.', '13.3 8.2', 'hr-diagram position-catalog', 'isochrone|stellar age'),
    topic('element-forges', 'Element forges', 'Where do carbon, oxygen and many heavier nuclei come from?',
      'Successive burning stages in stars make new nuclei, and winds or explosions can return some of them to surrounding space.', '10.3 13.2 15.1 15.3', '', 'nucleosynthesis|massive stars'),
  ]),
  domain(2, 'binary-stars', 'Paired stars', 'What can two orbiting stars reveal about one another?', [
    topic('stellar-masses', 'Weighing stars', 'How can two orbiting points of light reveal their total mass?',
      'A measured orbital period and true separation scale constrain the combined mass through gravity.', '7.1 7.2 2.3', 'kepler-state', 'visual binary|binary stars'),
    topic('eclipsing-binaries', 'Eclipsing stars', 'Why do some binary stars dim twice per orbit?',
      'Viewed nearly edge-on, each star can pass in front of its companion and hide part of the more distant star’s visible surface.', '7.1 7.3', 'sky-silhouettes relative-light-curve', 'eclipsing binaries|light curves'),
    topic('doppler-pairs', 'Doppler pairs', 'Why do the spectral lines of some stars swing back and forth?',
      'Orbital motion changes the stars’ speeds along our line of sight, periodically shifting the wavelengths we measure.', '7.3', 'spectral-line-profile', 'spectroscopic binary|radial velocity'),
    topic('mass-transfer', 'Mass transfer', 'How can one star feed material to its companion?',
      'Gas near a binary star’s outer boundary can spill across the gravitational saddle between the two stars.', '18.1 18.3', '', 'Roche lobe|Lagrange point'),
  ]),
  domain(2, 'pulsating-stars', 'Pulsating stars', 'What can a star’s changing brightness tell us about its interior?', [
    topic('cepheid-pulses', 'Cepheid pulses', 'Why do Cepheids repeatedly brighten and fade?',
      'Changes in opacity trap and release heat in particular layers, sustaining a cycle of stellar expansion and contraction.', '14.1 14.2', 'relative-light-curve', 'pulsation|variable stars'),
    topic('stellar-waves', 'Stellar waves', 'How can different parts of one star oscillate in different directions?',
      'A star can support many standing-wave patterns, including modes that divide its surface into regions moving out of step.', '14.3 14.4'),
    topic('starquakes', 'Starquakes', 'How can surface ripples reveal conditions inside a star?',
      'The frequencies of global oscillations depend on the interior structure, so a measured frequency pattern can test a model of the star.', '14.5 11.1', '', 'asteroseismology|helioseismology'),
  ]),
  domain(2, 'stellar-explosions', 'Stellar explosions', 'What can make a star flare up or tear itself apart?', [
    topic('core-collapse', 'Core collapse', 'What happens when a massive star’s core loses pressure support?',
      'A rapid collapse can leave a neutron star or black hole and can help drive an explosion of the outer layers.', '15.1 15.2 15.3', 'radial-shells relative-light-curve', 'supernova|Type II'),
    topic('white-dwarf-explosions', 'Type Ia supernovae', 'How can a compact stellar remnant power a supernova?',
      'Runaway nuclear burning can disrupt a white dwarf, producing expanding ejecta whose glow evolves as radioactive nuclei decay.', '15.2 18.5', 'relative-light-curve', 'thermonuclear explosion'),
    topic('gamma-ray-bursts', 'Gamma-ray bursts', 'How can a short flash be seen across much of the observable universe?',
      'Some violent stellar deaths and compact-object mergers launch narrow, fast jets that look exceptionally bright when directed toward us.', '15.4', '', 'GRB'),
    topic('cosmic-rays', 'Cosmic rays', 'Which particles reach Earth with energies far above those of ordinary starlight?',
      'Astrophysical accelerators can boost charged particles to high energies, and magnetic fields deflect their paths as they travel.', '15.5 4.4', '', 'energetic particles'),
  ]),
  domain(2, 'compact-remnants', 'Stellar remnants', 'What remains when a star can no longer support itself by ordinary fusion?', [
    topic('white-dwarfs', 'White dwarfs', 'How can a star’s mass fit into a body roughly the size of Earth?',
      'A white dwarf is supported mainly by the pressure of tightly packed electrons, which sets a limit on the mass it can hold.', '16.1 16.2 16.3 16.4', 'radial-shells', 'Sirius B|Chandrasekhar limit|degeneracy pressure'),
    topic('cooling-dwarfs', 'Cooling embers', 'Why does an isolated white dwarf fade over time?',
      'With little new energy from fusion, a white dwarf gradually radiates its stored heat and moves to lower luminosity.', '16.5', 'hr-diagram', 'white dwarf cooling'),
    topic('neutron-stars', 'Neutron stars', 'What becomes of matter squeezed beyond white-dwarf densities?',
      'A massive collapsing core can form a compact remnant supported by dense nuclear matter, much of it in the form of neutrons.', '16.6'),
    topic('pulsars', 'Pulsars', 'Why do some neutron stars appear to flash like lighthouses?',
      'As a magnetized neutron star rotates, a beam of radiation can sweep across our sightline at regular intervals.', '16.7'),
  ]),
  domain(2, 'black-holes-accretion', 'Black holes & disks', 'How can gas reveal the presence of a dark compact object?', [
    topic('event-horizons', 'Event horizons', 'Where is the boundary from which light can no longer escape?',
      'A black hole’s event horizon separates events that can send signals to distant observers from those that cannot.', '17.2 17.3', 'spacetime-cone', 'black hole|Schwarzschild radius'),
    topic('accretion-disks', 'Accretion disks', 'Why does infalling gas often form a bright disk?',
      'Gas with angular momentum orbits as it spirals inward, and stresses in the disk can convert orbital energy into heat.', '18.2', 'rotation-profile velocity-arrows', 'accretion'),
    topic('novae', 'Nova outbursts', 'How can a white dwarf flare repeatedly without being destroyed?',
      'Hydrogen gathered from a companion can ignite in a thin surface layer, ejecting material while the underlying white dwarf survives.', '18.4', '', 'classical novae'),
    topic('x-ray-binaries', 'X-ray binaries', 'Why are some binaries much brighter in X-rays than in visible light?',
      'Gas accreting onto a neutron star or black hole can get hot enough to radiate strongly in X-rays.', '18.2 18.6', 'velocity-arrows', 'compact binary'),
  ]),

  domain(3, 'rocky-worlds', 'Rocky worlds', 'What can a rocky surface reveal about a planet’s history?', [
    topic('impact-craters', 'Impact craters', 'Why do some planetary surfaces preserve many more craters than others?',
      'Impacts build up craters over time, while erosion, volcanism and other resurfacing processes can erase them.', '20.1 20.4 20.5', '', 'Mercury|Moon|Mars'),
    topic('planet-layers', 'Planet layers', 'How did Earth acquire a metal core beneath a rocky mantle?',
      'When a young planet is hot enough for material to move, denser constituents can sink inward and lighter material can rise.', '19.1 20.3', 'radial-shells', 'differentiation|mantle'),
    topic('martian-rivers', 'Martian rivers', 'What do old channels on Mars tell us about its past?',
      'Valleys and sediments preserve evidence of flowing liquid water under conditions that differed from much of the surface today.', '20.5', '', 'Mars|water'),
  ]),
  domain(3, 'planet-climates', 'Planet climates', 'Why do neighboring planets have such different surfaces and skies?', [
    topic('greenhouse-warming', 'Greenhouse warming', 'Why is the surface of Venus so much hotter than its cloud tops?',
      'A thick atmosphere absorbs outgoing infrared radiation, so the surface can be much warmer than the level that radiates heat to space.', '19.3 20.2 20.3', 'opacity-sightline temperature-field', 'Venus|Earth|greenhouse effect'),
    topic('escaping-air', 'Escaping air', 'Why can a small world lose the gas wrapped around it?',
      'A planet’s gravity, upper-atmosphere temperature and exposure to radiation all affect how readily gas escapes.', '19.3 20.5', 'temperature-field', 'atmospheric escape|Mars'),
    topic('giant-planet-weather', 'Giant storms', 'Why do giant planets have bands of clouds and long-lived storms?',
      'Rapid rotation and heat flow organize giant-planet atmospheres into jets and vortices that move their clouds.', '19.3 21.1', 'temperature-field', 'Jupiter|Saturn|gas giant|ice giant'),
  ]),
  domain(3, 'moons-rings', 'Moons & rings', 'How does a planet sculpt the material orbiting it?', [
    topic('tides', 'Tides', 'How can the Moon stretch Earth from a distance?',
      'The Moon’s gravity differs slightly across Earth, producing a tide-raising force that can deform both rock and water.', '19.2 20.3', '', 'tidal force'),
    topic('tidal-locking', 'Locked moons', 'Why do we usually see the same side of the Moon?',
      'Tidal torques have brought the Moon’s rotation period close to its orbital period, keeping nearly the same hemisphere facing Earth.', '19.2 20.4 22.1', '', 'synchronous rotation|Pluto|Charon'),
    topic('tidal-heating', 'Tidal heating', 'What powers volcanoes on Io so far from the Sun?',
      'An eccentric orbit changes the tidal distortion of Io, and repeated flexing dissipates orbital energy as internal heat.', '19.2 21.2', '', 'Io|Europa|tidal flexing'),
    topic('planetary-rings', 'Planetary rings', 'Why does a ring orbit as many particles rather than turn like a solid wheel?',
      'Ring particles travel on their own orbits, with inner particles generally circling faster than their outer neighbors.', '21.3', 'rotation-profile', 'Saturn|ring gaps'),
  ]),
  domain(3, 'small-bodies', 'Small bodies', 'What do icy and rocky leftovers tell us about the young Solar System?', [
    topic('comet-tails', 'Comet tails', 'Why can a comet’s tail point away from the Sun as the comet travels outward?',
      'Sunlight and the solar wind act on escaping dust and gas, so the tails respond to the Sun as well as to the comet’s motion.', '22.2 11.2', '', 'comet|dust tail|ion tail'),
    topic('asteroid-gaps', 'Asteroid gaps', 'Why are some orbits in the asteroid belt nearly empty?',
      'Repeated gravitational tugs from Jupiter can build up at particular period ratios and drive asteroids away from those orbits.', '22.3 2.3', 'kepler-state', 'Kirkwood gaps|resonance'),
    topic('meteor-showers', 'Meteor showers', 'Why do many shooting stars seem to come from one point on some nights?',
      'When Earth crosses a stream of debris, particles enter the atmosphere on nearly parallel paths. Perspective makes their bright trails appear to radiate from the same patch of sky.', '19.1 22.4', '', 'shooting stars|radiant|Perseids'),
    topic('meteorites', 'Meteorites', 'How can a rock in the laboratory record the birth of the Solar System?',
      'Some meteorites preserve minerals that formed early, and radioactive clocks can date the formation of those minerals.', '22.4', '', 'chondrites|radiometric ages'),
    topic('icy-outskirts', 'Icy outskirts', 'What lies beyond the giant planets?',
      'Distant reservoirs contain small icy bodies, including trans-Neptunian objects, some of which can be scattered onto comet-like orbits.', '22.1 22.2', '', 'Kuiper belt|Oort cloud|Pluto'),
  ]),
  domain(3, 'planet-birth', 'Planet birth', 'How can a disk of gas and dust grow worlds of different sizes?', [
    topic('dust-to-planets', 'Dust to planets', 'How can orbiting grains become planetary building blocks?',
      'Solids can concentrate and grow into bodies whose gravity attracts additional material in a young circumstellar disk.', '19.1 23.2', '', 'planetesimals|protoplanetary disk'),
    topic('snow-lines', 'Snow lines', 'Why does a cold part of a young disk have more solid material available?',
      'Beyond the condensation front of a volatile substance, that substance can freeze onto grains and add to the local inventory of solids.', '23.2', '', 'frost line|condensation'),
    topic('planet-migration', 'Migrating planets', 'Can a planet end up far from the orbit where it formed?',
      'Gravitational interactions with a disk or other bodies can change a planet’s angular momentum and shift its orbit.', '23.1 23.2', '', 'planetary migration|hot Jupiters'),
  ]),
  domain(3, 'exoplanets', 'Exoplanets', 'How can you discover a planet you cannot see beside its star?', [
    topic('planetary-transits', 'Planetary transits', 'How much starlight disappears when two planets cross the same star?',
      'For a uniformly bright star, the light lost is proportional to the area of the combined shadows. Two overlapping shadows cover some of that area only once.', '7.4 23.1', 'sky-silhouettes relative-light-curve kepler-state', 'extrasolar planets|transit photometry|overlapping shadows'),
    topic('stellar-wobble', 'Stellar wobble', 'How does an unseen planet leave a rhythm in its star’s spectrum?',
      'Star and planet orbit their common center of mass, and the star’s motion toward and away from us shifts its spectral lines.', '7.3 7.4', 'spectral-line-profile', 'Doppler planets|radial velocity'),
    topic('planetary-architectures', 'Planet families', 'How different can the orbits in one planetary system be?',
      'Planetary systems can contain a wide range of orbital sizes and shapes, and each discovery method favors particular configurations.', '7.4 23.1', 'kepler-state', 'orbital architecture|multiplanet systems'),
  ]),

  domain(4, 'milky-way', 'The Milky Way', 'How can we map a galaxy from a point inside its disk?', [
    topic('galactic-band', 'The Milky Way band', 'Why does our Galaxy form a band across the night sky?',
      'Looking along the Galactic disk sends our sightline through many more stars and dust clouds than looking away from the disk.', '24.1 24.2 12.1', 'position-catalog opacity-sightline', 'star counts|galactic disk'),
    topic('galactic-orbits', 'Galactic orbits', 'Do all stars travel around the Milky Way in the same way?',
      'Disk stars tend to share the Galaxy’s rotation, while many halo stars follow more eccentric or inclined orbits.', '24.3', 'rotation-profile velocity-arrows', 'galactic rotation|stellar kinematics'),
    topic('central-black-hole', 'The Galactic center', 'What do the fastest stars near our Galactic center orbit?',
      'Their measured orbits require a large mass within a tiny region, providing evidence for the central black hole Sagittarius A*.', '24.4 17.3 7.2', '', 'Sagittarius A*|Sgr A*|black hole'),
  ]),
  domain(4, 'galaxy-shapes', 'Galaxy shapes', 'How do stars moving under gravity make disks, spirals and spheroids?', [
    topic('galactic-disks', 'Galactic disks', 'Why do some galaxies look like thin pancakes?',
      'Gas can lose random motion as it cools while keeping net angular momentum, allowing stars to form in a rotating disk.', '25.1 25.2', 'position-catalog velocity-arrows', 'disk galaxies|irregular galaxies'),
    topic('spiral-arms', 'Spiral arms', 'Do the same stars always stay inside a bright spiral arm?',
      'An arm is a pattern of enhanced density and star formation whose motion can differ from that of the individual stars.', '25.3 25.2', 'position-catalog', 'density waves'),
    topic('elliptical-galaxies', 'Elliptical galaxies', 'How can a galaxy hold its shape without a thin rotating disk?',
      'Stars moving on many differently oriented orbits can support a smooth, rounded distribution in the galaxy’s gravity.', '25.4 2.4', '', 'spheroids|velocity dispersion'),
  ]),
  domain(4, 'galaxy-encounters', 'Galaxy encounters', 'What changes when galaxies pass close enough to pull on one another?', [
    topic('tidal-tails', 'Tidal tails', 'How can a passing galaxy draw long streams of stars out of a disk?',
      'Differences in the companion’s gravity across the disk can pull outer material into extended tails.', '26.1 19.2', '', 'tidal interactions|stellar streams'),
    topic('galaxy-mergers', 'Galaxy mergers', 'How can two galaxies merge while most of their stars avoid collisions?',
      'Their collective gravitational fields exchange energy and reshape stellar orbits even when individual stars pass far apart.', '26.1 26.2', 'density-contrast-slice', 'galactic collisions'),
    topic('galaxy-assembly', 'Growing galaxies', 'Where does a growing galaxy get new material?',
      'A galaxy can gain gas and dark matter from its surroundings and acquire stars and gas by merging with other galaxies.', '26.2 30.2', 'density-contrast-slice', 'galaxy formation|hierarchical assembly'),
  ]),
  domain(4, 'active-galaxies', 'Active galaxies', 'How can the center of a galaxy outshine billions of stars?', [
    topic('quasars', 'Quasars', 'How can a tiny galactic nucleus radiate so much power?',
      'Matter falling toward a supermassive black hole can release a large fraction of its binding energy as radiation.', '28.1 28.2 18.2', 'relative-light-curve', 'active galactic nucleus|AGN'),
    topic('dusty-nuclei', 'Hidden nuclei', 'Why can two similar active galaxies look very different?',
      'Dust and gas near an active nucleus obscure some viewing directions while allowing a clearer view from others.', '28.2 9.2', 'opacity-sightline', 'obscuring torus|AGN unification'),
    topic('galactic-jets', 'Galactic jets', 'How can a galaxy send out narrow beams of plasma almost as fast as light?',
      'Magnetic fields around an accreting black hole can channel and accelerate outflows far beyond the bright central region.', '28.3 4.4', '', 'radio lobes|relativistic jets'),
    topic('quasar-backlights', 'Quasar backlights', 'How can a distant quasar reveal nearly invisible gas in front of it?',
      'Gas along the sightline absorbs specific wavelengths from the quasar spectrum, leaving a record of intervening material.', '28.4 5.1', 'spectral-line-profile', 'absorption systems|intergalactic medium'),
  ]),
  domain(4, 'expanding-universe', 'Cosmic expansion', 'What can a galaxy’s distance and redshift tell us about the universe?', [
    topic('cosmic-redshift', 'Cosmic redshift', 'Why does distant galaxy light arrive at longer wavelengths?',
      'As the universe expands during the light’s journey, the wavelength measured by observers moving with the expansion increases.', '27.2 29.1 29.3', '', 'Hubble law|recession|scale factor'),
    topic('accelerating-expansion', 'Accelerating expansion', 'How do distant supernovae help reveal a change in the expansion rate?',
      'The relation between their redshifts and calibrated brightnesses traces how cosmic expansion has evolved over time.', '18.5 27.1 29.4', '', 'dark energy|cosmological constant'),
    topic('cosmic-geometry', 'Cosmic geometry', 'How does the curvature of space affect the apparent sizes of distant objects?',
      'The geometry and expansion history of the universe determine how a known physical size translates into an angle on the sky.', '29.3 29.4', '', 'curvature|angular diameter distance'),
  ]),
  domain(4, 'early-universe', 'The early universe', 'Which traces of the hot young universe are still visible?', [
    topic('cosmic-afterglow', 'Cosmic afterglow', 'Why do microwaves reach Earth from almost every direction?',
      'When the early universe cooled enough for neutral atoms to form, light could travel freely. Expansion stretched that light into the microwave band.', '29.2 3.4', 'spectrum-passband', 'cosmic microwave background|CMB|recombination'),
    topic('first-nuclei', 'The first nuclei', 'Why did the young universe make abundant helium but very little carbon?',
      'Conditions allowed light nuclei to fuse for a short interval before expansion and cooling halted most early nuclear reactions.', '29.2', '', 'Big Bang nucleosynthesis|primordial helium|BBN'),
    topic('cosmic-inflation', 'Cosmic inflation', 'What might explain similarities between widely separated regions of the sky?',
      'Inflation proposes an early period of accelerated expansion that stretched a small connected region to much larger scales.', '30.1', '', 'inflationary cosmology'),
  ]),
  domain(4, 'cosmic-structure', 'The cosmic web', 'How did an almost smooth universe develop clusters, filaments and voids?', [
    topic('dark-matter', 'Dark matter', 'Why do stars far from a galaxy’s center often orbit faster than the visible matter predicts?',
      'Rotation speeds imply more gravitating mass than the observed stars and gas can supply, providing evidence for extended dark matter halos.', '24.3 25.2 27.3', 'rotation-profile velocity-arrows', 'missing mass|rotation curves'),
    topic('galaxy-clusters', 'Galaxy clusters', 'What holds hundreds of galaxies and a huge reservoir of hot gas together?',
      'Gravity from the cluster’s total mass, including dark matter, binds galaxies and confines an atmosphere of hot gas.', '27.3 2.4', 'position-catalog density-contrast-slice', 'intracluster medium|ICM'),
    topic('cosmic-filaments', 'Filaments & voids', 'How do galaxies come to trace a web of crowded and nearly empty regions?',
      'Gravity amplifies early density variations, drawing mass into sheets, filaments and knots while surrounding regions empty out.', '26.2 30.2', 'density-contrast-slice', 'large-scale structure|density fluctuations'),
    topic('sound-horizon', 'Ancient sound waves', 'Why is there a preferred separation between some pairs of galaxies?',
      'Sound waves in the early hot plasma left a characteristic scale in the matter distribution that survives in galaxy clustering.', '30.2 29.2', '', 'baryon acoustic oscillations|BAO|sound horizon'),
  ]),
];

// A demonstrated asset use can predate the standalone experience. The eccentric-orbit
// recipe exercises both speed variations and period changes, while the transit recipe
// constructs one synthetic multiplanet architecture without modeling a population.
const demonstratedByPhenomenon = {
  'elliptical-orbits': ['kepler-state'],
  'orbital-periods': ['kepler-state'],
  'planetary-architectures': ['kepler-state'],
  'planetary-transits': ['sky-silhouettes', 'relative-light-curve', 'kepler-state'],
};
const transitStudy = { label: 'Watch the transit study', href: '/studies/planetary-transits/' };

function rank(rows) {
  for (const row of rows) {
    const shorter = rows.filter(peer => peer.pages < row.pages).length;
    const tied = rows.filter(peer => peer.pages === row.pages).length;
    row.peerCount = rows.length;
    row.rank = 1 + rows.length - shorter - tied;
    row.percentile = 100 * (shorter + tied / 2) / rows.length;
  }
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function buildRoadmap() {
  const sections = new Map(coverage.sections.map(s => [s.number, s]));
  const counts = new Map(coverage.sections.map(s => [s.number, 0]));
  for (const group of catalog) for (const child of group.children) {
    for (const ref of child.refs) {
      if (!counts.has(ref)) throw new Error('Unknown roadmap reference ' + ref);
      counts.set(ref, counts.get(ref) + 1);
    }
  }
  // Store contributions in a common integer unit so mathematically equal
  // fractions remain exact ties regardless of how many sections were added.
  let unitsPerPage = 1;
  for (const [ref, count] of counts) {
    if (!count) throw new Error('Unmapped roadmap reference ' + ref);
    unitsPerPage *= count / gcd(unitsPerPage, count);
  }
  const domains = [], phenomena = [];
  for (const group of catalog) {
    const children = [];
    const domainUnits = new Map();
    for (const child of group.children) {
      const allocations = child.refs.map(ref => {
        const section = sections.get(ref);
        const share = counts.get(ref);
        const units = section.pages * (unitsPerPage / share);
        domainUnits.set(section.id, (domainUnits.get(section.id) ?? 0) + units);
        return { sectionId: section.id, units, pages: units / unitsPerPage, share };
      });
      const units = allocations.reduce((n, a) => n + a.units, 0);
      const launch = child.id === 'planetary-transits' ? transitStudy : null;
      const node = { id: child.id, parentId: group.id, partId: group.partId, level: 'phenomenon',
        order: phenomena.length, label: child.label, question: child.question, insight: child.insight,
        keywords: child.keywords, sectionIds: allocations.map(a => a.sectionId), allocations,
        pages: units / unitsPerPage, assetIds: child.assetIds,
        demonstratedAssetIds: demonstratedByPhenomenon[child.id] ?? [], availability: launch ? 'available' : 'planned', launch };
      children.push(node);
      phenomena.push(node);
    }
    const collect = key => [...new Set(children.flatMap(child => child[key]))];
    const launch = children.find(child => child.launch)?.launch ?? null;
    const allocations = [...domainUnits].map(([sectionId, units]) => ({ sectionId, units, pages: units / unitsPerPage }));
    const units = [...domainUnits.values()].reduce((sum, v) => sum + v, 0);
    domains.push({ id: group.id, parentId: group.partId, partId: group.partId, level: 'domain',
      order: domains.length, label: group.label, question: group.question, keywords: [],
      sectionIds: [...domainUnits.keys()], allocations, pages: units / unitsPerPage,
      assetIds: collect('assetIds'), demonstratedAssetIds: collect('demonstratedAssetIds'),
      availability: launch ? 'available' : 'planned', launch });
  }
  rank(domains);
  rank(phenomena);
  return { families, domains, phenomena, totals: { families: families.length, domains: domains.length,
    phenomena: phenomena.length, sections: coverage.sections.length, pages: coverage.totals.pages },
    method: { unit: 'allocated reference pages', unitsPerPage,
      allocation: 'Each reference section divides its pages equally among the mapped phenomena. A domain receives the sum of its phenomena’s shares.',
      ranking: 'Percentile = 100 × (number with smaller allocations + half the number tied) / number of peers. Domains and phenomena are ranked separately.' } };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const roadmap = freeze(buildRoadmap());
