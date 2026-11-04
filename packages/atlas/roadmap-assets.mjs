// Only explicitly assigned visual templates transfer from a reference section to a phenomenon.
import { roadmap } from './roadmap.mjs';
import { assetsForTopic, createReuseGraphBuilder } from './reuse.mjs';

const mappings = new Map();
function record(topic, assetId, use) {
  for (const id of [topic.id, topic.parentId]) {
    if (!mappings.has(id)) mappings.set(id, new Map());
    const group = mappings.get(id);
    if (!group.has(assetId)) group.set(assetId, { assetId, status: 'proposed', uses: [] });
    const item = group.get(assetId);
    item.uses.push(use);
    if (use.status === 'demonstrated') item.status = 'demonstrated';
  }
}
for (const topic of roadmap.phenomena) {
  for (const { assetId, rationale, source } of topic.sourcedVisuals) {
    record(topic, assetId, { topicId: topic.id, assetId, status: 'proposed', rationale, evidence: [source] });
  }
  for (const sectionId of topic.sectionIds) {
    for (const entry of assetsForTopic(sectionId)) {
      if (!topic.assetIds.includes(entry.assetId)) continue;
      for (const source of entry.uses) {
        const status = topic.demonstratedAssetIds.includes(entry.assetId) ? source.status : 'proposed';
        const use = { ...source, topicId: topic.id, sectionId, status };
        record(topic, entry.assetId, use);
      }
    }
  }
}
const entries = new Map([...mappings].map(([id, assets]) => [id, [...assets.values()]]));
export const visualsFor = id => entries.get(id) ?? [];
export const roadmapGraph = createReuseGraphBuilder([...roadmap.domains, ...roadmap.phenomena], visualsFor);

// The same diagram can pose a useful question in two different lessons.
const guides = {
  'two-beam-interference': ['Two waves meeting', 'Slide one light wave past the other. When do the peaks add, and when does a peak meet a trough? Telescope pairs compare light from the sky. In a gravitational-wave detector, the light comes from a laser on Earth.'],
  'solar-recoil-angle': ['Which way did the electrons go?', 'Compare the direction of each recoiling electron with the path from the Sun to the detector. Do more events line up with that direction than the background would predict?'],
  'kepler-state': ['Orbital paths', 'Follow a body around its orbit. Where does it travel fastest, and how does a wider orbit change the time for one trip?'],
  'sky-silhouettes': ['Shadows on the sky', 'Look along the observer’s line of sight. Where do the two disks overlap, and which object passes in front?'],
  'relative-light-curve': ['Brightness over time', 'Trace a dip or a peak in brightness. Its depth tells you how much the light changed, and its width tells you how long the change lasted.'],
  'position-catalog': ['A map of positions', 'Plot each object as a point. Where do the points gather, and where are the gaps?'],
  'velocity-arrows': ['A map of motion', 'At each point, an arrow shows which way material moves. Compare the arrow lengths to find the fastest flows.'],
  'temperature-field': ['A temperature map', 'Use the color scale to locate hotter and cooler material. How does temperature change from one region to the next?'],
  'parallax-baseline': ['Two views of a nearby star', 'Look from opposite sides of Earth’s orbit. How much does the nearby star shift against the distant sky?'],
  'spectral-line-profile': ['The shape of a spectral line', 'Find the feature’s center and compare its width with a narrow reference line. A shift and a spread tell you different things about the material.'],
  'spectrum-passband': ['Light through a filter', 'Lay the filter’s wavelength range over the spectrum. Which part of the light reaches the detector?'],
  'hr-diagram': ['A star’s brightness and temperature', 'Place stars by surface temperature and total luminosity. Which ones belong to the same sequence, and which stand apart?'],
  'radial-shells': ['A cutaway through the layers', 'Follow a path from the center to the surface. Where does density change most sharply?'],
  'opacity-sightline': ['Light passing through matter', 'Follow a beam through successive layers. Which layers remove the most light from the beam before it reaches the observer?'],
  'spacetime-cone': ['A light cone', 'Mark two events in space and time. Could a signal from the earlier event reach the later one without traveling faster than light?'],
  'rotation-profile': ['Speed versus distance from the center', 'Pick a ring in a disk, then find its speed on the rotation curve. What happens to orbital speed farther out?'],
  'density-contrast-slice': ['A slice through cosmic structure', 'Compare snapshots of the same region of the expanding universe. Where do dense knots grow, and where do voids open up?'],
  'energy-ladder': ['An atom’s energy levels', 'Pick a downward step between levels. A larger energy gap produces a higher-energy photon with a shorter wavelength.'],
};
export function diagramFor(id) {
  const [label, prompt] = guides[id];
  return { label, prompt };
}
