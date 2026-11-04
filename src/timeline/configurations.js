import { Project } from '../core/index.js';
import { fail, freezeData } from '../core/data.js';
import { createCommandCatalog } from '../gateway/commands.js';
import { checkPort } from '../dataflow/index.js';
import { SCENE_FORMAT } from '../scene/definitions.js';
import { WORKSPACE_FORMAT } from '../workspace/definitions.js';
import { RUNTIME_LIMITS, bytes, equal } from '../runtime/contracts.js';
import { editTimeline } from './definition.js';

// F07 operations run against isolated F01 drafts. The same compiler pins the
// graphs at save/open time and supplies accepted configurations to the player.
export function compileTimelineConfigurations({ project, registry, binding, layer, definition, playback }) {
  if (!(project instanceof Project) || !layer?.scene || !layer.validators || typeof layer.sources !== 'function') {
    fail('TIMELINE_HOST', 'Authored timelines require an accepted project and the installed scene/workspace layer.');
  }
  const timeline = editTimeline(definition).snapshot().data;
  const base = project.snapshot(), local = Project.from(base, { validators: layer.validators });
  const catalog = createCommandCatalog({ registry, binding, layer });
  const artifacts = new Map(binding.visuals.map(r => [r.manifest.id, r.manifest.artifact]));
  const models = new Map(binding.computations.map(r => [r.manifest.id, r.manifest]));
  const originals = new Map(base.nodes.map(n => [n.id, n]));
  const baseline = playback && binding.flow.describe(base).outputs;
  const selected = new Set(playback?.targets.map(source => source.nodeId));
  function validateTargets(graph) {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    for (const track of timeline.tracks) if (track.target) {
      const artifact = artifacts.get(nodes.get(track.target)?.type);
      const format = track.kind === 'emphasis' ? WORKSPACE_FORMAT : SCENE_FORMAT;
      const kinds = artifact?.schema.properties?.kind?.enum;
      if (artifact?.format !== format || (track.kind === 'camera' && kinds && !kinds.includes('camera'))) {
        fail('TIMELINE_TARGET', `Track ${track.id} needs a compatible ${track.kind} target in this configuration.`, { path: track.id });
      }
    }
    if (playback) {
      const outputs = binding.flow.describe(graph).outputs;
      const output = ({ nodeId, port }) => Object.hasOwn(outputs, nodeId) && Object.hasOwn(outputs[nodeId], port) && outputs[nodeId][port];
      for (const source of playback.targets) {
        const { nodeId, port } = source, node = nodes.get(nodeId), original = originals.get(nodeId);
        if (!output(source) || !original || original.type !== node.type || !equal(original.data.extension ?? null, node.data.extension ?? null)) {
          fail('TIMELINE_SOURCE', `Saved producer ${nodeId}.${port} is missing or replaced in this configuration.`, { path: nodeId });
        }
        const errors = checkPort(output(source), baseline[nodeId][port]);
        if (errors.length) fail('TIMELINE_SOURCE', `Saved scientific output ${nodeId}.${port} changed its contract: ${errors[0].message}`, { path: nodeId, diagnostics: errors });
      }
      if (playback.mode !== 'auto') for (const source of [...playback.targets, ...layer.sources(local)]) {
        const paths = models.get(nodes.get(source.nodeId)?.type)?.runtime.paths ?? ['analytic'];
        if (!paths.includes(playback.mode)) fail('CAPABILITY_UNSUPPORTED', `Source ${source.nodeId} cannot use the saved ${playback.mode} path.`, { path: source.nodeId });
      }
    }
  }
  // Stable sort preserves authored order among simultaneous transactions.
  const boundaries = [...timeline.boundaries].sort((a, b) => a.at - b.at);
  if (boundaries[0]?.at !== 0) validateTargets(base);
  const configurations = [];
  for (const [index, event] of boundaries.entries()) {
    const previous = new Set(local.snapshot().nodes.map(node => node.id));
    const explicit = new Set(), draft = local.begin();
    for (const operation of event.operations) {
      explicit.add(operation.args.id); explicit.add(operation.args.options?.id);
      if (operation.command === 'overlay.create') explicit.add(operation.args.binding?.id);
      const outcome = catalog.apply(draft, operation);
      for (const id of outcome.ids.filter(id => selected.has(id))) {
        try { draft.get(id); }
        catch { fail('TIMELINE_SOURCE', `Saved scientific producer ${id} cannot be removed and reused by a configuration boundary.`, { path: id }); }
      }
    }
    const graph = draft.accept();
    if (bytes(graph) > RUNTIME_LIMITS.maxGraphBytes) fail('GRAPH_BUDGET', 'A timeline configuration exceeds the physical runtime graph limit.', { path: event.id });
    for (const node of graph.nodes) if (!previous.has(node.id) && !explicit.has(node.id)) {
      fail('TIMELINE_IMPLICIT_ID', 'Every node created by a boundary must have an explicitly authored ID, including relationship nodes.', { path: event.id });
    }
    // A prefix between two events at one timestamp is validated structurally,
    // but no frame can present that intermediate prefix.
    if (boundaries[index + 1]?.at !== event.at) validateTargets(graph);
    configurations.push({ id: event.id, at: event.at, label: event.label, graph });
  }
  return freezeData(configurations);
}
