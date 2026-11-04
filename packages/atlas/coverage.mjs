// Printed page starts are bibliographic observations from the publisher's contents.
// Atlas labels and group descriptions are editorial.
const bookUrl = 'https://www.cambridge.org/highereducation/books/an-introduction-to-modern-astrophysics/140DDF8A480C3841DCCD76D66984D858';
const source = {
  title: 'An Introduction to Modern Astrophysics',
  authors: ['Bradley W. Carroll', 'Dale A. Ostlie'],
  edition: '2nd edition', publisher: 'Cambridge University Press', year: 2017,
  isbn: '9781108422161', doi: '10.1017/9781108380980', checked: '2026-11-04',
  url: bookUrl + '/contents/351D92F23E4D4016D6261254E763B10E',
  tocUrl: 'https://assets.cambridge.org/97811084/22161/toc/9781108422161_toc.pdf',
  finalChapterUrl: bookUrl + '/the-early-universe/52E25251BF651D98A12FF203FFA7ABF4',
  indexUrl: 'https://assets.cambridge.org/97811084/22161/index/9781108422161_index.pdf',
};
const method = {
  name: 'Textbook coverage', unit: 'allocated print pages',
  description: 'Each numbered section runs from its printed start to the page before the next section, chapter or part divider. The final chapter ends on page 1278.',
  ranking: 'Within each level, rank is one plus the number of longer spans. A percentile is 100 × (shorter spans + half the tied spans) / peer count.',
  caveat: 'Allocated pages measure space in this edition. A chapter-ending section can include problems and other closing material. Page share cannot establish teaching priority or research importance.',
};

// Each part opener occupies a separate page before its first numbered chapter.
const partDefinitions = [
  { label: 'Observing and measuring', number: 'I', dividerPage: 1, firstChapter: 1 },
  { label: 'Stars and their evolution', number: 'II', dividerPage: 179, firstChapter: 7 },
  { label: 'Planets and small bodies', number: 'III', dividerPage: 713, firstChapter: 19 },
  { label: 'Galaxies and cosmology', number: 'IV', dividerPage: 873, firstChapter: 24 },
];
const finalPage = 1278;

// Ordered [printed start, atlas topic] pairs retain direct section-number lookup.
const chapterDefinitions = [
  ['Locating objects in the sky', [
    [2, 'Ancient models of the sky'], [5, 'Putting the Sun at the center'],
    [8, 'Sky coordinates and apparent motion'], [19, 'Explaining celestial motion with physics'],
  ]],
  ['Gravity and orbital motion', [
    [23, 'Geometry of an elliptical orbit'], [29, 'Newtonian forces and orbital motion'],
    [39, 'Deriving Kepler’s orbital relations'], [50, 'Energy balance and the virial theorem'],
  ]],
  ['Reading light and distance', [
    [57, 'Distances from parallax'], [60, 'Brightness on the magnitude scale'],
    [63, 'Light as a wave'], [68, 'Thermal spectra of blackbodies'],
    [71, 'Discrete energy exchange'], [75, 'Comparing brightness through color filters'],
  ]],
  ['Measurements in moving frames', [
    [84, 'Where Galilean kinematics breaks down'], [87, 'Changing frames with a Lorentz transformation'],
    [92, 'Clocks, lengths and simultaneity'], [102, 'Energy and momentum at relativistic speeds'],
  ]],
  ['Atoms, photons and spectral lines', [
    [111, 'Discrete wavelengths in a spectrum'], [116, 'Light carried by photons'],
    [119, 'Hydrogen energy levels in the Bohr picture'], [127, 'Wave–particle behavior in quantum mechanics'],
  ]],
  ['Collecting and surveying the sky', [
    [141, 'How lenses and mirrors form images'], [154, 'Building a visible-light telescope'],
    [161, 'Radio dishes and interferometry'], [167, 'Observing beyond optical and radio bands'],
    [170, 'Sky survey archives and virtual observatories'],
  ]],
  ['Inferring masses and companions', [
    [180, 'How binaries reveal themselves'], [183, 'Weighing stars from resolved orbits'],
    [186, 'Eclipses and binary velocity curves'], [195, 'Finding planets around other stars'],
  ]],
  ['Sorting stars by their light', [
    [202, 'Why stellar absorption lines form'], [219, 'The temperature–luminosity plane (H–R diagram)'],
  ]],
  ['Light emerging from stellar gas', [
    [231, 'Quantities describing a radiation field'], [238, 'Opacity and photon escape'],
    [251, 'Radiative transfer through stellar gas'], [255, 'Solving the radiation transport equation'],
    [267, 'The shapes and widths of spectral lines'],
  ]],
  ['Stellar structure and energy', [
    [284, 'Balancing gravity with a pressure gradient'], [288, 'Equations of state for stellar material'],
    [296, 'Fusion energy and stellar nucleosynthesis'], [315, 'Heat transport and stellar thermodynamics'],
    [329, 'Constructing an interior model'], [340, 'Structure of hydrogen-burning stars'],
  ]],
  ['The Sun as a working star', [
    [349, 'Beneath the solar photosphere'], [360, 'The layered solar atmosphere'],
    [381, 'Solar activity and its magnetic cycle'],
  ]],
  ['From interstellar gas to stars', [
    [398, 'Gas and dust between stars'], [412, 'Cloud collapse and protostars'],
    [425, 'Evolution before sustained hydrogen fusion'],
  ]],
  ['Evolution beyond core hydrogen burning', [
    [446, 'Changes during hydrogen burning'], [457, 'Later burning phases and giant stars'],
    [474, 'Testing evolution with star clusters'],
  ]],
  ['Oscillating stars', [
    [483, 'Light curves of pulsating stars'], [491, 'What drives stellar oscillations'],
    [499, 'Predicting pulsation in a model star'], [503, 'Modes beyond radial expansion'],
    [509, 'Probing interiors with stellar seismology'],
  ]],
  ['Massive stars and explosive endings', [
    [518, 'Advanced burning in massive stars'], [524, 'Distinguishing supernova classes'],
    [529, 'Core collapse and explosive nucleosynthesis'], [543, 'Short-lived gamma-ray flashes'],
    [550, 'Energetic particles in cosmic rays'],
  ]],
  ['Compact stellar remnants', [
    [557, 'The faint companion of Sirius'], [559, 'Properties of white dwarf remnants'],
    [563, 'Pressure from degenerate particles'], [569, 'The limiting mass of a white dwarf'],
    [572, 'How white dwarfs lose heat'], [578, 'Matter in neutron stars'],
    [586, 'Rotating neutron stars and pulsars'],
  ]],
  ['Gravity as spacetime geometry', [
    [609, 'Foundations of relativistic gravity'], [622, 'Spacetime intervals and free-fall paths'],
    [633, 'Black holes and horizons'],
  ]],
  ['Stars exchanging mass', [
    [653, 'Effective gravity near a binary companion'], [661, 'Disks fed by accretion'],
    [668, 'Varieties of interacting binaries'], [673, 'Mass transfer onto a white dwarf'],
    [686, 'Thermonuclear Type Ia explosions'], [689, 'Binaries with a neutron star or black hole'],
  ]],
  ['Physics across the Solar System', [
    [714, 'Comparing Solar System bodies'], [719, 'Tidal distortion and differential gravity'],
    [724, 'What shapes planetary atmospheres'],
  ]],
  ['Rocky worlds and our Moon', [
    [737, 'Mercury as a rocky planet'], [740, 'The Venusian environment'],
    [745, 'Earth in planetary context'], [754, 'The lunar surface and interior'],
    [762, 'The Martian environment'],
  ]],
  ['Giant planets, moons and rings', [
    [775, 'The four outer giant planets'], [790, 'Satellites of giant planets'],
    [801, 'Particles in planetary rings'],
  ]],
  ['Smaller Solar System populations', [
    [813, 'The Pluto–Charon pair'], [816, 'Comets and the trans-Neptunian reservoir'],
    [830, 'The asteroid population'], [838, 'Meteorite samples'],
  ]],
  ['Building planetary systems', [
    [848, 'Patterns among exoplanet systems'], [857, 'Assembly and evolution of planetary systems'],
  ]],
  ['Mapping our Galaxy', [
    [874, 'Inferring stellar distributions from counts'], [881, 'The shape of the Milky Way'],
    [898, 'Stellar motions in our Galaxy'], [922, 'Inside the Galactic center'],
  ]],
  ['Galaxies as stellar systems', [
    [940, 'Classifying galaxy shapes'], [948, 'Disk galaxies and irregular systems'],
    [964, 'How spiral arms are organized'], [983, 'Structure of elliptical galaxies'],
  ]],
  ['How galaxies assemble', [
    [999, 'Encounters, tides and mergers'], [1016, 'Building galaxies over cosmic time'],
  ]],
  ['Measuring the large-scale universe', [
    [1038, 'The distance ladder beyond the Milky Way'], [1052, 'Distances and cosmic expansion'],
    [1058, 'Galaxies bound into clusters'],
  ]],
  ['Accreting galactic nuclei', [
    [1085, 'Observed signatures of active galaxies'], [1108, 'Unifying active galactic nuclei'],
    [1122, 'Jets and extended radio emission'], [1130, 'Using distant quasars as probes'],
  ]],
  ['Models and measurements of the cosmos', [
    [1144, 'Cosmic dynamics in a Newtonian picture'], [1162, 'Microwave background and primordial nucleosynthesis'],
    [1183, 'Spacetime models for cosmology'], [1199, 'Testing cosmology with observations'],
  ]],
  ['From early fluctuations to structure', [
    [1230, 'Inflation and the earliest epochs'], [1247, 'Growth of cosmic structure'],
  ]],
];

// Search aliases have no effect on coverage or page allocations.
const sectionKeywords = {
  '1.2': ['heliocentrism', 'Copernicus'], '1.3': ['celestial sphere', 'right ascension', 'declination'],
  '2.1': ['ellipse', 'eccentricity', 'semimajor axis'], '2.3': ['Kepler laws'],
  '3.2': ['apparent magnitude', 'distance modulus'], '3.4': ['blackbody', 'Planck spectrum', 'Wien', 'Stefan–Boltzmann'],
  '3.6': ['color index'], '4.2': ['Lorentz transformation'], '4.3': ['special relativity', 'time dilation'],
  '5.3': ['Bohr model', 'Balmer series'], '6.4': ['infrared', 'ultraviolet', 'X-ray', 'gamma-ray'],
  '7.3': ['spectroscopic binary', 'radial velocity'], '7.4': ['exoplanet', 'planet detection'],
  '8.1': ['spectral classification', 'absorption spectrum'], '8.2': ['Hertzsprung–Russell', 'HR diagram', 'H-R diagram'],
  '9.4': ['radiative transfer', 'Eddington approximation'], '9.5': ['Doppler broadening', 'line profile'],
  '10.1': ['hydrostatic equilibrium'], '10.2': ['equation of state', 'EOS'],
  '10.3': ['proton–proton chain', 'CNO cycle', 'triple alpha'], '10.6': ['main sequence'],
  '11.1': ['helioseismology'], '11.2': ['solar corona', 'photosphere', 'chromosphere'],
  '11.3': ['sunspots', 'solar cycle', 'coronal mass ejection'],
  '12.2': ['star formation', 'Jeans mass', 'Jeans length'], '13.2': ['post-main-sequence evolution', 's-process'],
  '14.1': ['Cepheid variables'], '14.5': ['helioseismology', 'asteroseismology'],
  '15.3': ['supernova', 'r-process'], '15.4': ['gamma-ray burst', 'GRB'],
  '16.3': ['degeneracy pressure'], '16.4': ['Chandrasekhar limit'],
  '17.1': ['general relativity', 'gravitational redshift'], '17.2': ['geodesic', 'Schwarzschild metric'],
  '17.3': ['event horizon', 'Schwarzschild radius'], '18.1': ['Roche lobes'],
  '18.2': ['accretion disk'], '18.5': ['Type Ia supernova'], '18.6': ['X-ray binary'],
  '19.2': ['tidal force', 'Roche limit'], '22.2': ['Kuiper belt'], '22.3': ['Kirkwood gaps'],
  '23.1': ['extrasolar planets'], '24.3': ['galactic rotation curve'], '24.4': ['Sagittarius A*', 'Sgr A*'],
  '25.1': ['Hubble sequence'], '25.2': ['rotation curves', 'Tully–Fisher'], '25.3': ['spiral density waves'],
  '27.1': ['Cepheid distance scale', 'Tully–Fisher'], '27.2': ['Hubble law', 'Hubble flow'],
  '28.2': ['AGN', 'active galactic nucleus'], '28.4': ['gravitational lensing', 'quasar'],
  '29.2': ['cosmic microwave background', 'CMB', 'Big Bang nucleosynthesis', 'BBN'],
  '29.3': ['Friedmann equation', 'dark energy'], '30.1': ['cosmic inflation'], '30.2': ['density fluctuations', 'acoustic oscillations'],
};

function rankWithinLevel(rows) {
  const sorted = [...rows].sort((a, b) => a.pages - b.pages);
  for (let lo = 0; lo < sorted.length;) {
    let hi = lo + 1;
    while (hi < sorted.length && sorted[hi].pages === sorted[lo].pages) hi++;
    for (let i = lo; i < hi; i++) {
      sorted[i].rank = 1 + sorted.length - hi;
      sorted[i].percentile = 100 * (lo + (hi - lo) / 2) / sorted.length;
      sorted[i].peerCount = sorted.length;
    }
    lo = hi;
  }
}
function region(level, id, parentId, number, label, startPage, endPage) {
  return { id, parentId, level, number, label, keywords: level === 'section' ? sectionKeywords[number] ?? [] : [], startPage, endPage, pages: endPage - startPage + 1 };
}
function buildCoverage() {
  const parts = [], chapters = [], sections = [];
  for (const [index, definition] of partDefinitions.entries()) {
    const n = index + 1, next = partDefinitions[n];
    const endPage = next ? next.dividerPage - 1 : finalPage;
    const part = region('part', 'part-' + n, null, definition.number, definition.label, definition.dividerPage + 1, endPage);
    part.dividerPage = definition.dividerPage;
    parts.push(part);
    const lastChapter = next ? next.firstChapter - 1 : chapterDefinitions.length;
    for (let c = definition.firstChapter; c <= lastChapter; c++) {
      const [label, topics] = chapterDefinitions[c - 1];
      const end = c === lastChapter ? endPage : chapterDefinitions[c][1][0][0] - 1;
      const chapter = region('chapter', 'ch-' + c, part.id, String(c), label, topics[0][0], end);
      chapters.push(chapter);
      for (const [j, [startPage, topic]] of topics.entries()) {
        const tail = j + 1 === topics.length;
        const section = region('section', 'sec-' + c + '-' + (j + 1), chapter.id, c + '.' + (j + 1),
          topic, startPage, tail ? end : topics[j + 1][0] - 1);
        section.isChapterTail = tail;
        sections.push(section);
      }
    }
  }
  const pages = parts.reduce((sum, row) => sum + row.pages, 0);
  const nodes = new Map([...parts, ...chapters, ...sections].map(row => [row.id, row]));
  for (const level of [parts, chapters, sections]) {
    rankWithinLevel(level);
    for (const row of level) {
      row.percentOfBook = 100 * row.pages / pages;
      row.percentOfParent = 100 * row.pages / (nodes.get(row.parentId)?.pages ?? pages);
    }
  }
  const totals = { parts: parts.length, chapters: chapters.length, sections: sections.length, pages };
  return { source, method, totals, parts, chapters, sections };
}
function freeze(data) {
  if (data && typeof data === 'object') {
    for (const item of Object.values(data)) freeze(item);
    Object.freeze(data);
  }
  return data;
}
export const coverage = freeze(buildCoverage());
