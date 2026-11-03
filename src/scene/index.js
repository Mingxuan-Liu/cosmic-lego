import { Project, validateProject } from '../core/index.js';
import { copyData, freezeData } from '../core/data.js';
import { unit, descriptorOf } from '../dataflow/index.js';
import { sceneExtensions } from './definitions.js';
import { sceneAuthor } from './author.js';
import { bindingExtensions, bindAuthor } from './bindings.js';
import { resolveAssets } from './assets.js';
import { diagnostic, insist, issue, sameIdentity, sceneLimits } from './contracts.js';

export { sceneExtensions, bindingExtensions, sceneAuthor };
export { SCENE_LIMITS } from './contracts.js';
export function registerSceneExtensions(registry) {
  for (const extension of [...sceneExtensions, ...bindingExtensions]) registry.register(extension);
  return registry;
}

export function createSceneLayer(binding, { limits: inputLimits = {} } = {}) {
  const limits = sceneLimits(inputLimits);
  const manifests = new Map(binding.visuals.map(record => [record.manifest.id, record.manifest]));
  const isBinding = node => manifests.get(node.type)?.artifact.format === 'cosmic.scene.binding.v1';
  const isNode = node => manifests.get(node.type)?.artifact.format === 'cosmic.scene.node.v1';
  function sceneErrors(graph) {
    const errors = [], nodes = new Map(graph.nodes.map(node => [node.id, node])), properties = new Set();
    if (graph.nodes.length > limits.maxNodes) errors.push(diagnostic('SCENE_BUDGET', 'Scene project exceeds the node limit.'));
    for (const node of graph.nodes) {
      if (isNode(node)) {
        const parent = node.references['asset.parent'];
        if (parent && !['scene.root', 'scene.group'].includes(nodes.get(parent)?.type)) errors.push(diagnostic('SCENE_PARENT', 'Scene parents must be groups.', node.id));
        if (node.type === 'scene.label' && node.data.parameters.text.length > limits.maxTextChars) errors.push(diagnostic('LABEL_BUDGET', 'Label exceeds the character limit.', node.id));
      }
      if (isBinding(node)) {
        if (node.data.parameters.sourceId !== node.references['input.source'] || node.data.parameters.port !== node.data.inputs.source?.port) errors.push(diagnostic('BINDING_SOURCE', 'Binding metadata must match its actual scientific reference and port.', node.id));
        const property = node.type.slice('scene.bind-'.length), targetId = node.references['asset.target'];
        const kind = nodes.get(targetId)?.type.replace('scene.', '');
        const allowed = property === 'position' ? ['mesh', 'points', 'polyline', 'vectors', 'label', 'group', 'root'] : property === 'vectors' ? ['vectors'] : ['points'];
        if (!allowed.includes(kind)) errors.push(diagnostic('BINDING_TARGET', `Cannot map ${property} onto ${kind}.`, node.id));
        // Both scalar-field and positions own the same point-position array.
        const channels = property === 'scalar-field' ? ['positions', 'colors'] : [property];
        for (const channel of channels) {
          const key = JSON.stringify([targetId, channel]);
          if (properties.has(key)) errors.push(diagnostic('BINDING_CONFLICT', `Two bindings write ${targetId}.${channel}.`, node.id));
          properties.add(key);
        }
      }
    }
    return errors;
  }
  const validators = Object.freeze({ structure: Object.freeze([...binding.validators.structure, sceneErrors]) });
  return Object.freeze({
    limits, validators,
    author(draft) {
      const author = sceneAuthor(draft, binding);
      return Object.freeze({ ...author,
        bind: (target, source, options) => bindAuthor(draft, binding, target, source, options),
        duplicate(source, options) {
          const id = draft.idOf(source), old = draft.snapshot();
          const duplicate = author.duplicate(source, options);
          for (const node of old.nodes.filter(node => isBinding(node) && node.references['asset.target'] === id)) {
            binding.author(draft).instantiate(node.type, { parameters: node.data.parameters,
              inputs: { source: { node: node.references['input.source'], port: node.data.inputs.source.port } }, assets: { target: duplicate } });
          }
          return duplicate;
        },
      });
    },
    sources(project) {
      const graph = project.snapshot(), unique = new Map();
      for (const node of graph.nodes.filter(node => manifests.has(node.type))) {
        for (const [slot, declaration] of Object.entries(node.data.inputs)) {
          const source = { nodeId: node.references[`input.${slot}`], port: declaration.port };
          unique.set(JSON.stringify([source.nodeId, source.port]), source);
        }
      }
      return [...unique.values()];
    },
    async compile(project, { results = [], time = { value: 0, unit: 's' }, capabilities } = {}) {
      insist(project instanceof Project, 'PROJECT_REQUIRED', 'Compile an accepted F01 Project.');
      const identity = project.token, graph = project.snapshot();
      const snapshot = { valid: false, identity, time: null, nodes: [], assets: [], bindings: [], diagnostics: [] };
      try {
        results = copyData(results); time = copyData(time);
        if (capabilities !== undefined) capabilities = copyData(capabilities);
        insist(Array.isArray(results) && results.length <= limits.maxNodes, 'RESULT_BUDGET', 'Supply a bounded list of scientific snapshots.');
        const timeUnit = unit(time.unit);
        insist(Number.isFinite(time.value) && Number.isFinite(time.value * timeUnit.scale) && JSON.stringify(timeUnit.dimensions) === JSON.stringify(unit('s').dimensions), 'INVALID_TIME', 'Scene snapshots need a finite physical time.');
        snapshot.time = { value: time.value, unit: timeUnit };
        const validated = validateProject(graph, validators);
        if (!validated.valid) { snapshot.diagnostics = validated.errors; return snapshot; }
        for (const node of graph.nodes) {
          const artifact = manifests.get(node.type)?.artifact;
          insist(!artifact || artifact.kind !== 'view' || isNode(node) || isBinding(node), 'RENDER_CAPABILITY', `No scene adapter consumes ${artifact?.format}.`, node.id);
        }
        snapshot.assets = await resolveAssets(project, binding, graph, limits, { results, time });
        const produced = [];
        for (const node of graph.nodes.filter(node => isNode(node) || isBinding(node))) {
          const artifact = binding.produce(project, node.id, { time, results });
          if (!artifact.valid) {
            const error = artifact.diagnostics.find(item => item.severity !== 'warning') ?? artifact.diagnostics[0];
            insist(false, error.code, error.message, error.path);
          }
          snapshot.diagnostics.push(...artifact.diagnostics);
          produced.push(artifact.artifact.data);
        }
        snapshot.nodes = produced.filter(node => node.kind !== 'binding');
        const nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
        for (const mapped of produced.filter(node => node.kind === 'binding')) {
          const target = nodes.get(mapped.target), graphNode = graph.nodes.find(node => node.id === mapped.id);
          insist(target, 'BINDING_TARGET', 'A binding target was not produced.');
          if (mapped.property === 'position') target.position = mapped.positions[0];
          else if (mapped.property === 'vectors') { target.origins = mapped.positions; target.directions = mapped.vectors; target.objectIds = mapped.objectIds; }
          else { target.positions = mapped.positions; target.objectIds = mapped.objectIds; if (mapped.property === 'scalar-field') target.colors = mapped.colors; }
          const source = results.find(result => result.producer.nodeId === graphNode.references['input.source'] && result.producer.port === graphNode.data.inputs.source.port);
          snapshot.bindings.push({ id: mapped.id, target: mapped.target, property: mapped.property,
            source: { nodeId: source.producer.nodeId, port: source.producer.port, implementation: source.producer.implementation, ...descriptorOf(source.value) },
            mapping: copyData(graphNode.data.parameters), sampling: copyData(source.metadata.sampling), warnings: copyData(source.value.metadata.warnings), approximation: copyData(source.value.metadata.approximation),
            colorMeaning: mapped.property === 'scalar-field' ? { quantity: source.value.meaning, unit: unit(graphNode.data.parameters.displayUnit), range: graphNode.data.parameters.colorRange, palette: graphNode.data.parameters.palette, clipped: mapped.clipped } : null });
          if (mapped.clipped) snapshot.diagnostics.push(diagnostic('COLOR_CLIPPED', `${mapped.clipped} scalar samples are clamped to the authored color range.`, mapped.id, 'warning'));
        }
        let instances = 0;
        const required = new Set();
        for (const node of snapshot.nodes) {
          if (node.kind === 'points' || node.kind === 'vectors') {
            const positions = node.kind === 'points' ? node.positions : node.origins;
            insist(node.objectIds.length === positions.length && new Set(node.objectIds).size === positions.length &&
              (!node.colors.length || node.colors.length === positions.length) && (node.kind !== 'vectors' || node.directions.length === positions.length),
            'SCENE_PARAMETER', 'Mapped instance positions, colors, directions and identities must have compatible row counts.', node.id);
          }
          required.add(node.kind);
          if (node.kind === 'camera') required.add(node.projection);
          instances += node.kind === 'points' ? node.positions.length : node.kind === 'vectors' ? node.origins.length : 1;
        }
        if (snapshot.assets.some(asset => asset.kind === 'texture')) required.add('textures');
        if (capabilities !== undefined) {
          const advertised = Array.isArray(capabilities) ? capabilities : [...(capabilities.nodes ?? []), ...(capabilities.projections ?? []), ...(capabilities.textures ? ['textures'] : [])];
          for (const capability of required) insist(advertised.includes(capability), 'RENDER_CAPABILITY', `Renderer does not support ${capability}.`);
        }
        insist(instances <= limits.maxInstances, 'INSTANCE_BUDGET', 'Scene exceeds the instance budget.');
        insist(sameIdentity(identity, project.token), 'STALE_RESULT', 'Project changed during scene compilation.');
        snapshot.valid = true;
      } catch (error) {
        snapshot.nodes = []; snapshot.assets = []; snapshot.bindings = [];
        snapshot.diagnostics.push(issue(error));
      }
      return freezeData(copyData(snapshot));
    },
  });
}
