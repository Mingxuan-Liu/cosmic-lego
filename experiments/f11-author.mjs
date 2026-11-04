// An independent public-interface authoring exercise. Run in the author's process.
import { readFile } from 'node:fs/promises';
import { createRegistry } from '../examples/fixtures/workspace-registry.js';
import { Project } from '../src/core/index.js';
import { value } from '../src/dataflow/index.js';
import { createPortableManifest } from '../src/portable/format.js';
import { createTimeline } from '../src/timeline/definition.js';
import { createWorkspaceLayer } from '../src/workspace/index.js';

const lanes = [{ name: 'low', y: -1 }, { name: 'mid', y: 0 }, { name: 'high', y: 1 }];
const positionFrame = { id: 'lab', kind: 'position' };

function makeScience(draft, binding) {
  const author = binding.author(draft);
  for (const { name, y } of lanes) {
    author.instantiate('fixture.moving-point', {
      id: 'puck-' + name, parameters: { r0: [-2, y, 0], v: [1, 0, 0] },
    });
  }
  const pucks = author.select(
    { mode: 'live', type: 'fixture.moving-point', port: 'position' }, { id: 'scan-pucks' },
  );
  const radii = author.map('magnitude', pucks, { id: 'puck-radii' });
  const mean = author.reduce('mean', radii, { id: 'mean-gate-radius' });
  const gap = author.arithmetic('subtract', { node: 'puck-high', port: 'position' },
    { node: 'puck-mid', port: 'position' }, {
      id: 'lane-gap', comparison: { meaning: 'lane-separation', reference: 'high-minus-mid' },
    });
  const limit = author.map('magnitude', gap, { id: 'reference-radius' });
  author.arithmetic('subtract', mean, limit, {
    id: 'radius-margin', comparison: { meaning: 'signed-radius-margin', reference: 'one-metre-reference' },
  });
  author.instantiate('fixture.seeded-accumulator', { id: 'timing-dither', parameters: { initial: 1.5 } });

  const samples = lanes.flatMap(({ y }) => [-2, -1, 0, 1, 2].map(x => [x, y, 0]));
  const space = values => ({ kind: 'space', unit: 'm', frame: positionFrame, values });
  author.constant(value({
    kind: 'field', unit: 's', meaning: 'nominal-arrival-time', data: samples.map(([x]) => x + 2),
    coordinates: space(samples),
  }), { id: 'arrival-field' });
  author.constant(value({
    kind: 'field', unit: 'm/s', meaning: 'nominal-scan-velocity', frame: { id: 'lab', kind: 'direction' },
    data: lanes.map(() => [1, 0, 0]), coordinates: space(lanes.map(({ y }) => [-2.75, y, 0])),
  }), { id: 'velocity-field' });
}

function makeStage(draft, layer) {
  const scene = layer.scene.author(draft);
  const paint = (id, color) => scene.material({ id, color, unlit: true });
  const railPaint = paint('rail-paint', '#50728A');
  const gatePaint = paint('gate-paint', '#4FD6CE');
  const puckPaint = paint('puck-paint', '#FF9D75');
  const samplePaint = paint('sample-paint', '#FFFFFF');
  const shape = scene.geometry({ id: 'puck-shape', primitive: 'sphere', radius: 0.13 });
  const tile = scene.geometry({
    id: 'timing-tile', primitive: 'box', width: 0.20, height: 0.12, depth: 0.025,
  });
  const pucks = scene.points({ id: 'pucks-stage', geometry: shape, material: puckPaint });
  scene.bind(pucks, 'scan-pucks', {
    id: 'puck-positions', property: 'positions', unit: 'm', frame: 'lab', displayUnit: 'm',
  });
  const tiles = scene.points({ id: 'arrival-tiles', geometry: tile, material: samplePaint });
  scene.bind(tiles, 'arrival-field', {
    id: 'arrival-colors', property: 'scalar-field', quantity: 'nominal-arrival-time',
    unit: 's', displayUnit: 's', positionUnit: 'm', frame: 'lab', colorRange: [0, 4], palette: 'blue-gold',
  });
  const arrows = scene.vectors({ id: 'velocity-glyphs', material: gatePaint, vectorScale: 0.45 });
  scene.bind(arrows, 'velocity-field', {
    id: 'nominal-arrows', property: 'vectors', quantity: 'nominal-scan-velocity',
    unit: 'm/s', displayUnit: 'm/s', positionUnit: 'm', frame: 'lab',
  });
  for (const { name, y } of lanes) {
    scene.polyline({
      id: 'rail-' + name, material: railPaint, positions: [[-2.8, y, -0.04], [2.4, y, -0.04]],
    });
  }
  scene.polyline({
    id: 'gate-line', material: gatePaint, positions: [[0, -1.45, -0.035], [0, 1.45, -0.035]],
  });
  const label = (id, text, position, size, color) => scene.label({ id, text, position, size, color });
  label('gate-caption', 'TIMING GATE', [0, 1.68, 0], 0.20, '#A8F5EC');
  label('arrival-key', 'Reference arrival   /   seconds', [0, -1.96, 0], 0.16, '#BFCCD8');
  for (const x of [-2, -1, 0, 1, 2]) {
    label('tick-' + (x + 2), String(x + 2), [x, -1.47, 0], 0.14, '#E3EAF1');
  }
  scene.camera({
    id: 'gate-camera', projection: 'orthographic', position: [0, 0, 10],
    target: [0, -0.05, 0], span: 6.2, near: 0.1, far: 100,
  });
}

function makeControls(draft, layer) {
  const views = layer.author(draft);
  function bindPlot(overlay, source, options) {
    views.bind(overlay, source, { ...options, id: 'source-' + overlay.id });
  }
  const mean = views.plot({
    id: 'gate-radius-report', title: 'Mean distance from gate center · m',
    x: 16, y: 82, width: 278, height: 170,
  });
  bindPlot(mean, 'mean-gate-radius');
  const positions = views.plot({
    id: 'lane-readout', title: 'Puck x · select a sample',
    component: 0, x: 16, y: 264, width: 278, height: 180,
  });
  bindPlot(positions, 'scan-pucks', { component: 0 });
  views.inspector({
    id: 'probe-inspector', title: 'Selected sample', x: 16, y: 456, width: 278, height: 200, folded: true,
  });
  views.conversation({
    id: 'bench-chat', title: 'Bench conversation', x: 1030, y: 82, width: 320, height: 310,
  });
  const margin = views.plot({
    id: 'margin-report', title: 'Mean radius minus 1 m', x: 16, y: 460, width: 278, height: 170, hidden: true,
  });
  bindPlot(margin, 'radius-margin');
}

function makeSequence() {
  const timeline = createTimeline({ id: 'gate-pass', title: 'Pass through the timing gate', duration: 4 });
  timeline.track({ id: 'gate-clock', kind: 'physical-time', keys: [
    { at: 0, value: 0 }, { at: 1.5, value: 2 }, { at: 2.5, value: 2 }, { at: 4, value: 4 },
  ] });
  timeline.track({ id: 'gate-instructions', kind: 'annotation', keys: [
    { at: 0, value: 'Follow the coral pucks. Each colored tile marks a nominal arrival time.' },
    { at: 1.5, value: 'Clock held at 2 s. Read the mean distance from the center of the gate.' },
    { at: 2.5, value: 'The clock resumes. Compare the pucks with the reference arrival scale.' },
  ] });
  timeline.track({ id: 'read-mean', kind: 'emphasis', target: 'gate-radius-report', keys: [
    { at: 0, value: false }, { at: 1.5, value: true }, { at: 2.5, value: false },
  ] });
  return timeline.snapshot();
}

export async function buildReadinessManifest() {
  const registry = createRegistry();
  const binding = registry.bind();
  const layer = createWorkspaceLayer(binding);
  const project = new Project({ id: 'gate-bench', title: 'Timing gate · three scan lanes', validators: layer.validators });
  const draft = project.begin();
  makeScience(draft, binding);
  makeStage(draft, layer);
  makeControls(draft, layer);
  // This relationship is a human inspection cue. Timing comes from the point models.
  draft.connect('bench.inspection-pair', 'puck-low', 'puck-mid', { id: 'inspection-pair' });
  draft.accept();

  // Revise the comparison to the two outer rails. Retire a trial view in an accepted edit.
  const trial = project.begin();
  const trialViews = layer.author(trial);
  const scratch = trialViews.plot({ id: 'trial-meter', title: 'Trial single puck reading', hidden: true });
  trialViews.bind(scratch, 'puck-mid', { port: 'position', component: 0 });
  trial.accept();
  const revision = project.begin();
  revision.get('inspection-pair').set({ references: { source: 'puck-low', target: 'puck-high' } });
  layer.author(revision).remove('trial-meter');
  revision.accept();

  const playback = {
    time: { value: 2, unit: 's' }, mode: 'auto',
    settings: { 'timing-dither': { seed: 20261103, step: 0.25, tolerance: 1e-12 } },
    targets: ['mean-gate-radius', 'radius-margin', 'timing-dither'].map(nodeId => ({ nodeId, port: 'value' })),
  };
  return createPortableManifest({
    registry, binding, layer, project, timeline: makeSequence(), playback,
    dataSources: [
      { nodeId: 'arrival-field', source: 'Original synthetic grid: T = (x + 2 m)/(1 m/s); experiments/f11-author.mjs', license: 'BSD-3-Clause' },
      { nodeId: 'velocity-field', source: 'Original synthetic reference velocity: (1, 0, 0) m/s; experiments/f11-author.mjs', license: 'BSD-3-Clause' },
    ],
    source: {
      path: 'experiments/f11-author.mjs', language: 'javascript',
      text: await readFile(new URL(import.meta.url), 'utf8'), producedGraph: project.snapshot(),
    },
  });
}
