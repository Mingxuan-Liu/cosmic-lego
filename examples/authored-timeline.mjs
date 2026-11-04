// Three generic software fixtures share one scientific clock. The comparison
// changes a model configuration at a held time, without applying an impulse.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTimeline } from '../src/timeline/definition.js';
import { createPortableManifest, serializePortableManifest } from '../src/portable/format.js';
import { createPortableStore } from '../src/portable/store.js';
import { buildExample, dataSources } from './workspace.mjs';

export function authorComparison() {
  const context = buildExample(), draft = context.project.begin();
  const scientific = context.binding.author(draft), scene = context.layer.scene.author(draft), panels = context.layer.author(draft);
  scientific.instantiate('fixture.seeded-accumulator', { id: 'seeded-walk' });
  for (const id of ['positions-plot', 'inspector', 'conversation', 'provenance']) panels.update(id, { hidden: true });
  panels.update('mean-plot', { title: 'Mean distance from origin', x: 24, y: 24, width: 260, height: 120, hidden: false });
  for (const id of ['front-block', 'rear-block', 'textured-block', 'assets-label']) scene.update(id, { visible: false });
  scene.update('field-label', { text: 'Temperature 270–342 K', size: 0.26 });
  scene.update('moving-label', { text: 'Point positions · m', size: 0.26 });
  draft.accept();

  const sequence = createTimeline({ id: 'motion-study', title: 'Nine moving points', duration: 8 });
  const keys = values => values.map(([at, value]) => ({ at, value }));
  sequence.track({ id: 'clock', kind: 'physical-time', keys: keys([[0, 0], [2, 2], [3, 4], [5, 4], [8, 1]]) });
  sequence.track({ id: 'framing', kind: 'camera', target: 'camera', keys: keys([
    [0, { position: [4, 6, 10], target: [-0.5, 0.7, -0.2] }],
    [3, { position: [4, 6, 10], target: [-0.5, 0.7, -0.2] }],
    [5, { position: [2, 5, 9], target: [-0.5, 0.7, -0.2] }],
  ]) });
  sequence.track({ id: 'arrows', kind: 'visibility', target: 'field-vectors', keys: keys([[0, false], [2, true]]) });
  sequence.track({ id: 'readout', kind: 'emphasis', target: 'mean-plot', keys: keys([[0, false], [3, true], [5, false]]) });
  sequence.track({ id: 'caption', kind: 'annotation', keys: keys([
    [0, 'Nine points move with constant velocities. Gold marks show their positions.'],
    [2, 'Blue to gold spans 270–342 K. Arrows show grid velocities as the clock runs at 2×.'],
    [3, 'Hold at 4 s. Read the mean distance of the nine points from the origin.'],
    [4, 'Still at 4 s. Three points now use larger x velocities in a separate configuration.'],
    [5, 'Seek toward 1 s in configuration B. The seeded accumulator replays from its initial state.'],
  ]) });
  sequence.boundary({ id: 'comparison-b', at: 4, label: 'B · three faster points', operations: [
    { command: 'create:scene.group', args: { id: 'comparison-group', assets: { parent: 'motion-group' } } },
    { command: 'scene.reparent', args: { id: 'moving-points', parent: 'comparison-group' } },
    ...[0, 1, 2].map(i => ({ command: 'update:fixture.moving-point', args: { id: 'point-' + i, parameters: { v: [0.7 + 0.04 * i, 0.03, 0.06] } } })),
  ] });
  return { ...context, timeline: sequence.snapshot(), playback: { time: { value: 0, unit: 's' },
    settings: { 'seeded-walk': { seed: 2871, step: 0.25 } }, targets: [{ nodeId: 'seeded-walk', port: 'value' }] } };
}

export async function buildTimelineManifest() {
  const context = authorComparison();
  const authored = async name => ({ path: 'examples/' + name, language: 'javascript', text: await readFile(new URL(name, import.meta.url), 'utf8') });
  const [entry, workspace, scene] = await Promise.all(['authored-timeline.mjs', 'workspace.mjs', 'scene-and-assets.mjs'].map(authored));
  return createPortableManifest({ ...context, dataSources, source: { ...entry, producedGraph: context.project.snapshot(), files: [workspace, scene] } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--directory') throw new Error('Usage: authored-timeline.mjs --directory /path/to/new-or-unused-slot-directory');
  const manifest = await buildTimelineManifest(), directory = path.resolve(args[1]);
  await (await createPortableStore({ directory })).save('motion-study', serializePortableManifest(manifest), { expectedVersion: null });
  console.log(path.join(directory, 'motion-study.json'));
}
