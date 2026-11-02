import buildClockwork from './cosmic-clockwork.mjs';

export default function build() {
  const world = buildClockwork();
  world.title('Tilt a planet. Move the observer.');
  world.get('iris-orbit').set({ inclinationDeg: 80, longitudeAscendingNodeDeg: 35 });
  const other = world.observer({ id: 'other-sightline', name: 'Another sightline', direction: [0, 0.17, 1] });
  world.transits(world.get('sun'), other, { id: 'another-measurement', name: 'Starlight from another direction' });
  world.annotate({ id: 'tilt-note', timeDays: -0.1, title: 'The camera is not the observer', text: 'Iris has its own orbital plane. Switch the physical sightline to change the transit; drag the stage camera to change only your explanatory view.', focusId: world.get('iris') });
  return world;
}
