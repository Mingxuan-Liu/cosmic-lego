import { Euler, Quaternion, Vector3 } from 'three';
import { Project } from '../core/index.js';
import { copyData, fail, freezeData } from '../core/data.js';
import { createCommandGateway } from '../gateway/index.js';
import { openPortableManifest } from '../portable/format.js';
import { createRuntime } from '../runtime/index.js';
import { bytes, canonical, fingerprint } from '../runtime/contracts.js';
import { compileTimelineConfigurations } from './configurations.js';
import { editTimeline, sampleTracks } from './definition.js';

const frameByteLimit = 8 * 1024 * 1024;
const present = (condition, code, message, path = '$') => { if (!condition) fail(code, message, { path }); };
const producer = node => node && canonical([node.kind, node.type, node.data.extension ?? null]);
const keyOf = (nodeId, port) => JSON.stringify([nodeId, port]);

// F05 stores parent-local positions and world-space look targets. Use the
// same XYZ quaternion convention as the Three adapter, including group scale.
function localEye(world, node, nodes) {
  const ancestry = [];
  for (let parent = nodes.get(node.parent); parent; parent = nodes.get(parent.parent)) ancestry.push(parent);
  const eye = new Vector3(...world);
  for (const parent of ancestry.reverse()) {
    const rotation = new Quaternion().setFromEuler(new Euler(...parent.rotation, 'XYZ'));
    eye.sub(new Vector3(...parent.position)).applyQuaternion(rotation.invert()).divide(new Vector3(...parent.scale));
  }
  const coordinates = eye.toArray();
  present(coordinates.every(Number.isFinite), 'TIMELINE_CAMERA', 'Camera position exceeds its parent coordinate range.', node.id);
  return coordinates;
}

/** Capture once. Playback owns every reconstructed graph and worker it uses.
 * A new seek supersedes an unfinished seek on this evaluator only. */
export async function createTimelineEvaluator({ manifest: input, registry, binding, layer, registryModule }) {
  const runtimeModule = registryModule instanceof URL ? registryModule.href : registryModule;
  present(typeof runtimeModule === 'string', 'RUNTIME_HOST', 'Supply the trusted installed worker registry module.');
  const { manifest, project } = openPortableManifest(input, { registry, binding, layer });
  present(manifest.timeline?.version === 1, 'TIMELINE_REQUIRED', 'Choose a portable project with an authored version-1 timeline.');
  const definition = editTimeline({ version: 1, data: manifest.timeline.data }).snapshot();
  const { id, title, duration } = definition.data;
  const configurations = compileTimelineConfigurations({ project, registry, binding, layer, definition, playback: manifest.playback });
  const base = project.snapshot(), baseNodes = new Map(base.nodes.map(node => [node.id, node]));
  const stages = [{ graph: base, project, at: 0, boundaries: [] }];
  for (const { graph, ...event } of configurations) {
    stages.push({ graph, at: event.at, boundaries: [...stages.at(-1).boundaries, event] });
  }
  for (const stage of stages) {
    const nodes = new Map(stage.graph.nodes.map(node => [node.id, node]));
    stage.hash = fingerprint(stage.graph);
    // Saved settings belong to the original producer. A removed component or
    // an explicitly substituted implementation does not inherit its settings.
    stage.settings = Object.fromEntries(Object.entries(manifest.playback.settings).filter(([nodeId]) =>
      nodes.has(nodeId) && producer(nodes.get(nodeId)) === producer(baseNodes.get(nodeId))));
  }
  let disposed = false, epoch = 0, active = null, stopping = Promise.resolve();
  function stopActive() {
    if (active) { stopping = active.dispose(); active = null; }
    return stopping;
  }
  async function evaluate(seconds) {
    present(!disposed, 'TIMELINE_DISPOSED', 'This timeline evaluator is closed.');
    const tracks = sampleTracks(definition, seconds);
    const physicalTime = { value: tracks.find(t => t.kind === 'physical-time')?.value ?? seconds, unit: 's' };
    const stage = stages.findLast(s => s.at <= seconds);
    const mine = ++epoch;
    await stopActive();
    const current = () => present(!disposed && mine === epoch, disposed ? 'TIMELINE_DISPOSED' : 'SUPERSEDED', 'This timeline seek was superseded or closed.');
    current();
    stage.project ??= Project.from(stage.graph, { validators: layer.validators });
    const owner = stage.project;
    // A previous frame's off-grid checkpoint could change the integrator's
    // step partition and random draws. Start an F04 replay for each sample.
    const runtime = createRuntime({ registryModule: runtimeModule });
    active = runtime;
    let expired = false;
    const timer = setTimeout(() => { expired = true; void runtime.dispose(); }, 30000);
    try {
      const gateway = createCommandGateway({ project: owner, registry, binding, layer, runtime });
      const options = { time: physicalTime, mode: manifest.playback.mode, settings: stage.settings };
      async function run(command, args) {
        current();
        const result = await gateway.dispatch({ command, args, expected: owner.token }, gateway.localAuthority);
        current();
        present(!expired, 'TIMELINE_BUDGET', 'A presentation frame exceeded the 30 second computation deadline.');
        if (!result.ok) fail(result.error.code, result.error.message, { diagnostics: result.error.diagnostics, path: result.error.paths?.[0] ?? '$' });
        return result.result;
      }
      const rendered = await run('render', options);
      const snapshot = copyData(rendered.snapshot), results = [...rendered.results];
      const sources = new Set(results.map(result => keyOf(result.producer.nodeId, result.producer.port)));
      let resultBytes = bytes(rendered);
      for (const { nodeId, port } of manifest.playback.targets) {
        if (!sources.has(keyOf(nodeId, port))) {
          const result = await run('evaluate', { ...options, id: nodeId, port });
          resultBytes += bytes(result);
          present(resultBytes <= frameByteLimit, 'RESULT_BUDGET', 'Timeline scientific results exceed the frame byte limit.');
          results.push(result); sources.add(keyOf(nodeId, port));
        }
      }
      const nodes = new Map(snapshot.scene.nodes.map(node => [node.id, node]));
      const overlays = new Map(snapshot.overlays.map(overlay => [overlay.id, overlay]));
      for (const overlay of overlays.values()) overlay.emphasized = false;
      let cameraId = null;
      const annotations = [];
      for (const track of tracks) {
        if (track.kind === 'visibility' || track.kind === 'camera') {
          const node = nodes.get(track.target);
          present(node && (track.kind !== 'camera' || node.kind === 'camera'), 'TIMELINE_TARGET', 'Expected the authored scene target in this frame.', track.id);
          if (track.kind === 'visibility') node.visible = track.value;
          else { cameraId = node.id; node.position = localEye(track.value.position, node, nodes); node.target = [...track.value.target]; }
        } else if (track.kind === 'emphasis') {
          present(overlays.has(track.target), 'TIMELINE_TARGET', 'Expected the authored overlay in this frame.', track.id);
          overlays.get(track.target).emphasized = track.value;
        } else if (track.kind === 'annotation' && track.value) annotations.push({ id: track.id, text: track.value });
      }
      const warnings = new Map();
      for (const result of [snapshot, snapshot.scene, ...results]) {
        for (const item of [...(result.diagnostics ?? []), ...(result.value?.metadata.warnings ?? [])]) {
          if (item.severity === 'warning') warnings.set(canonical(item), item);
        }
      }
      const frame = { timeline: { id, title, duration }, identity: manifest.savedFrom, presentationTime: seconds, physicalTime,
        configuration: { graphHash: stage.hash, boundaries: stage.boundaries }, cameraId, annotations, snapshot, results, warnings: [...warnings.values()] };
      present(bytes(frame) <= frameByteLimit, 'RESULT_BUDGET', 'Compiled timeline frame exceeds 8 MiB.');
      current(); return freezeData(frame);
    } finally {
      clearTimeout(timer);
      if (active === runtime) await stopActive();
    }
  }
  return Object.freeze({ definition, evaluate, async dispose() { disposed = true; ++epoch; await stopActive(); } });
}
