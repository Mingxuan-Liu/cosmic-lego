// A technique points to the science questions it can help answer. Each source
// describes a real instrument, measurement, or numerical experiment.
const link = (id, reason) => ({ id, reason });
const read = (label, url) => ({ label, url });

const esoFringes = read('ESO · From interference fringes to an image', 'https://www.eso.org/public/teles-instr/technology/interferometry/');
const superK = read('Super-Kamiokande · Measuring solar neutrinos', 'https://doi.org/10.1103/PhysRevD.94.052010');

// These instrument diagrams connect methods and physical topics directly. Their
// sources document the measurement independently of the textbook section ledger.
export const observingDiagramUses = [
  { topicId: 'linked-dishes', assetId: 'two-beam-interference', source: esoFringes,
    rationale: 'Compare the relative phase of the same radio wave at two dishes. After correcting the arrival delay, their correlated signals sample a fringe from this baseline.' },
  { topicId: 'interferometry', assetId: 'two-beam-interference', source: esoFringes,
    rationale: 'Combine two telescope signals. Fringe contrast and phase across different baselines constrain the source’s angular structure.' },
  { topicId: 'gravitational-wave-detection', assetId: 'two-beam-interference',
    source: read('LIGO Lab · The laser interferometer', 'https://www.ligo.caltech.edu/page/ligos-ifo'),
    rationale: 'Recombine light from two paths of the detector’s own laser. A relative change in round-trip time changes the interference at the output.' },
  { topicId: 'solar-neutrinos', assetId: 'solar-recoil-angle', source: superK,
    rationale: 'An excess of forward electron recoils over background provides evidence that neutrinos arrive from the Sun.' },
  { topicId: 'neutrino-detection', assetId: 'solar-recoil-angle', source: superK,
    rationale: 'Use the recorded light pattern to reconstruct an electron’s direction and compare it with the incoming solar direction at the event time.' }
];

export const techniqueDomains = [
  {
    partId: 'observation', id: 'measuring-starlight', label: 'Measuring starlight',
    question: 'What can you learn by measuring how bright a star is, where it sits, or which colors reach you?',
    children: [
      {
        id: 'photometry', label: 'Photometry', question: 'Did a star really dim, or did the whole image get darker?',
        insight: 'Add up the light around a star, subtract the sky background, and compare it with steady stars in the same images. Repeat this across a night to reveal small changes in brightness.',
        keywords: ['differential photometry', 'aperture photometry', 'light curves', 'time domain', 'brightness'],
        assetIds: ['relative-light-curve'], source: read('NASA Exoplanet Watch · Make a light curve', 'https://science.nasa.gov/citizen-science/exoplanet-watch/how-to-contribute/how-to-analyze-your-data/'),
        applications: [link('planetary-transits', 'A dip in relative brightness measures the fraction of starlight hidden during a transit.'), link('cepheid-pulses', 'Repeated brightness measurements show the period and shape of a Cepheid’s pulsation.')],
        prerequisites: [link('photons', 'The number of photons recorded in an exposure provides a measure of the light received.')]
      },
      {
        id: 'spectroscopy', label: 'Spectroscopy', question: 'How can you measure a star’s motion without watching it cross the sky?',
        insight: 'A spectrograph spreads light by wavelength. Compare a recognizable line with its laboratory wavelength and its displacement reveals motion toward or away from you.',
        keywords: ['spectrograph', 'spectra', 'spectrum', 'Doppler spectroscopy', 'radial velocity', 'spectral lines'],
        assetIds: ['spectral-line-profile'], source: read('ESA · How Gaia measures radial velocity', 'https://www.esa.int/Science_Exploration/Space_Science/Gaia/Science_instruments'),
        applications: [link('stellar-wobble', 'A repeating shift of the star’s spectral lines can reveal its motion around a shared center of mass.'), link('doppler-pairs', 'Following two sets of spectral lines lets us measure the motions of two stars in a binary.')],
        prerequisites: [link('spectral-fingerprints', 'Recognizing the same atomic line in a laboratory spectrum gives you a wavelength to compare with the star.')]
      },
      {
        id: 'astrometry', label: 'Astrometry', question: 'How do you separate a star’s own motion from the effect of Earth’s orbit?',
        insight: 'Measure the star’s position against a reference frame over several years. A yearly shift follows the observer’s orbit, while a steady drift traces the star’s motion across the sky.',
        keywords: ['Gaia', 'parallax', 'proper motion', 'sky coordinates', 'position measurements'],
        assetIds: ['position-catalog', 'parallax-baseline'], source: read('ESA · Gaia’s astrometric instrument', 'https://www.esa.int/Science_Exploration/Space_Science/Gaia/Science_instruments'),
        assetNotes: {'position-catalog': 'Plot cataloged stars in three dimensions using measured sky directions and inferred distances.', 'parallax-baseline': 'Compare the apparent sky positions of a star from opposite sides of Earth’s orbit.'},
        applications: [link('stellar-parallax', 'The size of the fitted annual shift gives a geometric distance.'), link('bound-clusters', 'Stars at similar distances that move together across the sky are candidates for membership in the same cluster.')],
        prerequisites: []
      }
    ]
  },
  {
    partId: 'observation', id: 'sharp-imaging', label: 'Sharper images',
    question: 'How can a telescope separate two objects that blur together or differ greatly in brightness?',
    children: [
      {
        id: 'interferometry', label: 'Interferometry', question: 'How do measurements from pairs of telescopes add up to a picture?',
        insight: 'Combine waves from two telescopes and measure how strongly the bright and dark fringes contrast. Varying the separation can reveal a star’s apparent diameter. Many separations and orientations together constrain a picture of its surface.',
        keywords: ['aperture synthesis', 'radio interferometry', 'optical interferometry', 'VLBI', 'baselines', 'visibilities', 'fringes', 'Event Horizon Telescope', 'ALMA'],
        assetIds: [], source: esoFringes,
        applications: [link('linked-dishes', 'Each pair of dishes samples a different piece of the sky’s structure. Combining many pairs explains how an array resolves fine detail.'), link('accretion-disks', 'Long baselines resolve compact radio emission around a black hole and let us compare its shape with models of the orbiting gas.')],
        prerequisites: [link('photons', 'The interference of light waves makes a measurable fringe when the signals from two telescopes are combined.')]
      },
      {
        id: 'adaptive-optics', label: 'Adaptive optics', question: 'How can a telescope sharpen an image while the air above it keeps moving?',
        insight: 'Use a guide star to measure how turbulent air distorts the arriving wave of light. A mirror changes shape many times a second to correct much of the distortion before the image is recorded.',
        keywords: ['AO', 'wavefront', 'deformable mirror', 'laser guide star', 'atmospheric seeing'],
        assetIds: [], source: read('ESO · Adaptive optics', 'https://www.eso.org/public/teles-instr/technology/adaptive_optics/'),
        applications: [link('resolving-stars', 'Correcting the wavefront can separate the images of neighboring stars that atmospheric turbulence would blur together.')],
        prerequisites: []
      },
      {
        id: 'coronagraphy', label: 'Coronagraphy', question: 'How can you see a faint companion beside a much brighter star?',
        insight: 'Masks inside the telescope suppress light from the star while letting some light from nearby directions through. A planet or dusty disk can emerge from the remaining glare if it is far enough from the star in the image.',
        keywords: ['coronagraph', 'direct imaging', 'high contrast imaging', 'starlight suppression', 'exoplanet imaging'],
        assetIds: [], source: read('NASA/JPL · The Roman Coronagraph Instrument', 'https://www.jpl.nasa.gov/missions/the-roman-coronagraph-instrument/'),
        applications: [link('planetary-architectures', 'Images taken years apart can track the sky positions of widely separated planets around the same star.')],
        prerequisites: []
      }
    ]
  },
  {
    partId: 'observation', id: 'cosmic-messengers', label: 'Cosmic messengers',
    question: 'What can reach us from space besides light, and what does a detector actually record?',
    children: [
      {
        id: 'gravitational-wave-detection', label: 'Gravitational waves', question: 'How do lasers on Earth register the final orbits of two distant stars?',
        insight: 'Laser beams travel along two arms and recombine. A passing gravitational wave changes their relative travel times by a tiny amount. A rising pitch in the measured signal can reveal a compact pair spiraling together.',
        keywords: ['gravitational-wave detection', 'gravitational waves', 'GW', 'LIGO', 'Virgo', 'KAGRA', 'strain', 'chirps', 'multimessenger'],
        assetIds: [], source: read('LIGO · Gravitational waves and gamma rays from one merger', 'https://ligo.org/science-summaries/GW170817GRB/'),
        applications: [link('gamma-ray-bursts', 'Matching a merger signal to a short gamma-ray flash in time and direction showed that merging neutron stars can produce these bursts.'), link('neutron-stars', 'How rapidly the pitch climbs constrains the masses of the pair, helping identify systems consistent with two orbiting neutron stars.')],
        prerequisites: []
      },
      {
        id: 'neutrino-detection', label: 'Neutrino detection', question: 'How can an underground tank tell that a neutrino came from the Sun?',
        insight: 'Occasionally a solar neutrino knocks an electron forward in water. A fast electron makes a cone of faint light, and sensors around the tank record its pattern. Across many events, the reconstructed directions cluster toward the Sun.',
        keywords: ['neutrinos', 'neutrino astronomy', 'Super-Kamiokande', 'Cherenkov light', 'weak interactions', 'multimessenger'],
        assetIds: [], source: superK,
        applications: [link('solar-neutrinos', 'The excess of events from the Sun’s direction gives us evidence of neutrinos escaping its core.')],
        prerequisites: []
      },
      {
        id: 'air-shower-detection', label: 'Air-shower arrays', question: 'How can detectors spread over the ground measure one incoming cosmic ray?',
        insight: 'A high-energy particle strikes the air and starts a shower of secondary particles. Their arrival times at different stations reveal the incoming direction, while the pattern of signal strengths helps estimate the original energy.',
        keywords: ['cosmic ray detection', 'extensive air showers', 'air shower detection', 'Pierre Auger', 'particle astronomy'],
        assetIds: [], source: read('Pierre Auger Observatory · Reconstruct an air shower', 'https://opendata.auger.org/outreach.php'),
        applications: [link('cosmic-rays', 'Reconstructing the energies of many showers tells us how often particles of different energies strike Earth.')],
        prerequisites: []
      }
    ]
  },
  {
    partId: 'simulation', id: 'gravity-models', label: 'Modeling stars & gravity',
    question: 'How do we follow the lives of stars or the motion of enormous collections of matter?',
    children: [
      {
        id: 'n-body-simulations', label: 'N-body simulations', question: 'What happens to a cluster when every star pulls on the others?',
        insight: 'Start with masses, positions, and velocities. Use gravity to update each body’s motion in small time steps. Close encounters can redirect individual stars, and some may gain enough speed to escape.',
        keywords: ['N-body simulation', 'nbody', 'N body', 'gravitational dynamics', 'many-body', 'REBOUND', 'orbit integration'],
        assetIds: ['position-catalog', 'velocity-arrows'], source: read('REBOUND · Integrating gravitational motion', 'https://rebound.hanno-rein.de/'),
        applications: [link('bound-clusters', 'Following the stars through many encounters shows which remain bound and which escape.'), link('asteroid-gaps', 'Track many trial asteroids with a perturbing planet to see which orbital periods are gradually emptied.')],
        prerequisites: [link('orbital-free-fall', 'Each star accelerates toward the other masses, extending the idea of orbital free fall to many bodies.')]
      },
      {
        id: 'cosmological-simulations', label: 'Cosmological simulations', question: 'How can a nearly smooth early universe grow a web of filaments and voids?',
        insight: 'Seed a simulated volume with small density variations and evolve its matter under gravity as space expands. Comparing slices at successive times reveals where structures grow and where matter drains away.',
        keywords: ['cosmological simulation', 'cosmology simulations', 'cosmic structure formation', 'dark matter simulations', 'GADGET', 'comoving volume'],
        assetIds: ['density-contrast-slice'], source: read('GADGET-4 · Cosmological simulation setups', 'https://wwwmpa.mpa-garching.mpg.de/gadget4/03_simtypes/'),
        applications: [link('cosmic-filaments', 'Following the density contrast through time shows how matter accumulates in filaments and leaves underdense voids.'), link('galaxy-clusters', 'Tracking dense regions across snapshots shows how smaller halos join to form the larger halos that host galaxy clusters.')],
        prerequisites: [link('n-body-simulations', 'One way to model cosmic structure is to follow particles representing parcels of dark matter under gravity.')]
      },
      {
        id: 'stellar-evolution-models', label: 'Stellar evolution models', question: 'How can we follow a star for billions of years inside a computer?',
        insight: 'Represent a star by shells. Evolve their composition as fuel burns, calculate how energy travels, and let the structure readjust. The predicted luminosity and surface temperature trace a path as the star ages.',
        keywords: ['stellar evolution simulation', 'stellar structure', 'MESA', 'one-dimensional stellar models', 'evolutionary tracks'],
        assetIds: ['radial-shells', 'hr-diagram'], source: read('Paxton and colleagues · The MESA stellar evolution code', 'https://arxiv.org/abs/1009.1622'),
        applications: [link('red-giants', 'Following the shells after core hydrogen runs low shows how the envelope can expand and its surface cool.'), link('cluster-turnoff', 'Tracks for stars of different masses predict which stars should still be on the main sequence at a given age.')],
        prerequisites: [link('stellar-balance', 'Pressure and gravity help set the structure of each shell between stages of slow evolution.')]
      }
    ]
  },
  {
    partId: 'simulation', id: 'plasma-models', label: 'Modeling gas & plasma',
    question: 'When can you model a cloud as a fluid, and when do fields and individual charges matter?',
    children: [
      {
        id: 'hydrodynamic-simulations', label: 'Gas dynamics', question: 'What happens where two streams of gas collide inside a cloud?',
        insight: 'Model gas as a fluid with density, pressure, and velocity. Supersonic flows can compress gas in a shock. If the model includes self-gravity, some dense regions can continue collapsing long after the shock passes.',
        keywords: ['hydrodynamics', 'hydrodynamic simulation', 'gas dynamics simulation', 'fluid simulations', 'shocks', 'grid methods', 'SPH'],
        assetIds: ['velocity-arrows'], source: read('Gong and Ostriker · Simulating colliding flows in a cloud', 'https://arxiv.org/abs/1504.02140'),
        applications: [link('collapsing-clouds', 'Compare the gas flowing into dense regions with what happens later to see which regions gravity can keep together.')],
        prerequisites: []
      },
      {
        id: 'mhd-simulations', label: 'MHD simulations', question: 'How can a magnetic field help gas move inward through an orbiting disk?',
        insight: 'Magnetohydrodynamics (MHD) evolves an electrically conducting fluid together with its magnetic field. In a rotating disk the flow can stretch the field, and magnetic stresses can transfer angular momentum between neighboring regions.',
        keywords: ['MHD simulation', 'magnetohydrodynamics', 'magnetohydrodynamic simulations', 'magnetic fields', 'magnetized plasma', 'Athena++', 'magnetorotational instability', 'MRI'],
        assetIds: ['velocity-arrows', 'rotation-profile'], source: read('Stone and Gardiner · Modeling a magnetized patch of an accretion disk', 'https://arxiv.org/abs/1006.0139'),
        assetNotes: {'velocity-arrows': 'Show fluid velocity samples in the disk and compare the flow between neighboring regions.', 'rotation-profile': 'Use orbital speed versus radius to connect the model’s local shear to the rotation of the disk.'},
        applications: [link('accretion-disks', 'Measuring the transfer of angular momentum in a model disk helps explain how orbiting gas can move inward.')],
        prerequisites: [link('hydrodynamic-simulations', 'The gas already has pressure and bulk motion. MHD adds the evolving field and the forces it exerts on the flow.')]
      },
      {
        id: 'particle-in-cell', label: 'Particle-in-cell', question: 'How can a changing electromagnetic field give some particles much more energy than others?',
        insight: 'Follow representative charged particles through fields on a grid. Their moving charges supply currents that update the fields, which in turn change the particle motions. A model can then compare the energies of different particle populations.',
        keywords: ['particle in cell simulation', 'PIC simulations', 'kinetic plasma', 'magnetic reconnection', 'particle acceleration'],
        assetIds: ['velocity-arrows'], source: read('Knizhnik and colleagues · Simulating ion energization during reconnection', 'https://arxiv.org/abs/1108.5750'),
        assetNotes: {'velocity-arrows': 'Average particle velocities within individual cells to show bulk outflow separately from the spread of individual velocities.'},
        applications: [link('solar-flares', 'Tracking charged particles in a reconnecting field tests which particles can gain energy in a solar flare.')],
        prerequisites: []
      }
    ]
  },
  {
    partId: 'simulation', id: 'light-transport', label: 'Simulating light',
    question: 'If a model gives us the matter, how do we predict what a telescope would see?',
    children: [
      {
        id: 'ray-tracing', label: 'Ray tracing', question: 'Where did the light in one pixel of a black-hole image come from?',
        insight: 'Trace a ray backward from that pixel along a path allowed by the curved spacetime. The material encountered along the path supplies emission and absorption. Repeating the calculation across the image predicts the appearance of the glowing gas.',
        keywords: ['raytracing', 'relativistic ray tracing', 'geodesics', 'synthetic images', 'black hole shadow', 'radiative transfer'],
        assetIds: ['opacity-sightline'], source: read('PATOKA team · Predicting images of black hole accretion', 'https://arxiv.org/abs/2202.11721'),
        applications: [link('accretion-disks', 'Following curved light paths explains how gas behind a black hole can contribute to the visible image of its disk.')],
        prerequisites: [link('gravitational-lenses', 'The bending of light by mass explains why a ray traced from a camera pixel can pass around a black hole.')]
      },
      {
        id: 'monte-carlo-transfer', label: 'Monte Carlo light paths', question: 'How do we predict the color of a cloud where light can scatter in many directions?',
        insight: 'Launch packets of light into a model cloud. Sample where they interact and how scattering changes their direction using the material’s physical probabilities. Combining many packets estimates how much light reaches an observer at each wavelength.',
        keywords: ['Monte Carlo radiative transfer', 'MCRT', 'radiation transport', 'photon packets', 'dust scattering', 'SKIRT'],
        assetIds: ['opacity-sightline'], source: read('SKIRT · Following photon packets through matter', 'https://skirt.ugent.be/root/_user_photon_cycle.html'),
        applications: [link('dark-nebulae', 'Comparing simulated views with and without dust shows how absorption and scattering create a dark patch against background stars.'), link('dusty-nuclei', 'Viewing the model from different directions tests how intervening dust can obscure the bright center of a galaxy.')],
        prerequisites: [link('photons', 'A packet represents the energy carried by many photons, allowing their possible interactions to be sampled.')]
      }
    ]
  }
];
