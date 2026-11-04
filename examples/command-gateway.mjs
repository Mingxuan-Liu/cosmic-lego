import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Project } from '../src/core/index.js';
import { createRuntime } from '../src/runtime/index.js';
import { createWorkspaceLayer } from '../src/workspace/index.js';
import { createCommandGateway } from '../src/gateway/index.js';
import { createLocalGatewayClient, requireSuccess } from '../src/gateway/sdk.js';
import { createRegistry } from './fixtures/workspace-registry.js';

// Trusted host setup. The recipe below receives only a public transport client;
// neither registry implementations nor internal author handles reach it.
export function createExampleHost() {
  const registry = createRegistry(), binding = registry.bind(), layer = createWorkspaceLayer(binding);
  const project = new Project({ id: 'discovered-construction', validators: layer.validators });
  const runtime = createRuntime({ registryModule: new URL('./fixtures/workspace-registry.js', import.meta.url) });
  const gateway = createCommandGateway({ project, registry, binding, layer, runtime });
  return { project, runtime, gateway, client: createLocalGatewayClient(gateway) };
}

/** Build from installed declarations, without importing a domain or naming a fixture type. */
export async function authorFromDiscovery(client, { prefix = 'discovered' } = {}) {
  const discovery = requireSuccess(await client.discover()).result;
  const creates = discovery.commands.filter(command => command.name.startsWith('create:') && command.extension);
  const choose = predicate => {
    const command = creates.find(predicate);
    assert.ok(command, 'The host must install the declared capability needed by this recipe.');
    return command;
  };
  const point = choose(command => Object.values(command.outputs ?? {}).some(port => port.kind === 'vector' && port.meaning === 'position') &&
    Object.keys(command.ports.inputs).length === 0);
  const [positionPort, positionDescriptor] = Object.entries(point.outputs).find(([, port]) => port.kind === 'vector' && port.meaning === 'position');
  const artifact = (format, kind) => command => command.artifact?.format === format &&
    (kind === undefined || command.artifact.schema.properties.kind.enum?.includes(kind));
  const root = choose(command => artifact('cosmic.scene.node.v1', 'group')(command) && !Object.keys(command.assets).length);
  const camera = choose(artifact('cosmic.scene.node.v1', 'camera'));
  const geometry = choose(artifact('cosmic.geometry.v1'));
  const material = choose(command => artifact('cosmic.material.v1')(command) && !Object.keys(command.assets).length);
  const markers = choose(artifact('cosmic.scene.node.v1', 'points'));
  const plot = choose(artifact('cosmic.workspace.overlay.v1', 'plot'));
  const parameters = { ...point.defaults.parameters, ...point.examples[0].parameters };
  const resolve = template => template?.$param ? parameters[template.$param] : template;
  const author = await client.begin({ idempotencyKey: `${prefix}-construction` });
  const make = (declaration, name, options = {}) => author.create(declaration.extension.id, { id: `${prefix}-${name}`, ...options });

  // Ordinary functions, arrays and loops remain available in the author's process.
  const members = Array.from({ length: 3 }, (_, i) => make(point, `point-${i}`, {
    parameters: i === 0 ? point.defaults.parameters : parameters,
  }));
  const positions = author.select({ mode: 'fixed', members: members.map(member => member.port(positionPort)) }, { id: `${prefix}-positions` });
  const magnitudes = author.map('magnitude', positions, { id: `${prefix}-magnitudes` });
  const mean = author.reduce('mean', magnitudes, { id: `${prefix}-mean` });
  const rootHandle = make(root, 'root'), geometryHandle = make(geometry, 'geometry'), materialHandle = make(material, 'material');
  // Slot names and accepted formats are declarations, not hidden component enums.
  const assetsFor = declaration => Object.fromEntries(Object.entries(declaration.assets).map(([slot, contract]) => [slot,
    contract.format === 'cosmic.geometry.v1' ? geometryHandle : contract.format === 'cosmic.material.v1' ? materialHandle : rootHandle]));
  make(camera, 'camera', { assets: assetsFor(camera) });
  const dots = make(markers, 'markers', { assets: assetsFor(markers) });
  author.bindScene(dots, positions, { id: `${prefix}-scene-binding`, property: 'positions',
    unit: resolve(positionDescriptor.unit), frame: resolve(positionDescriptor.frame.id) });
  const meanPlot = make(plot, 'plot', { parameters: { title: 'Discovered mean position magnitude' } });
  author.bindPlot(meanPlot, mean);
  return { author, ids: { mean: mean.id, markers: dots.id, points: members.map(member => member.id) },
    discoveredModel: point.extension.id, discoveredPort: positionPort };
}

export async function demonstrate() {
  const host = createExampleHost(), { client, project } = host;
  try {
    const before = project.snapshot(), token = project.token;
    const { author, ids, discoveredModel, discoveredPort } = await authorFromDiscovery(client);
    requireSuccess(await author.preview());
    assert.deepEqual(project.snapshot(), before); assert.deepEqual(project.token, token);
    const committed = requireSuccess(await author.commit());
    const replay = requireSuccess(await author.commit());
    assert.deepEqual(replay.identity, committed.identity); assert.equal(replay.replayed, true);
    assert.deepEqual(project.token, committed.identity);
    const changed = author.snapshot(); changed.args.operations[0].args.id += '-changed';
    const conflict = await client.request(changed);
    assert.equal(conflict.ok, false); assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
    const evaluated = requireSuccess(await client.evaluate({ id: ids.mean, time: { value: 2, unit: 's' } }));
    const rendered = requireSuccess(await client.render({ time: { value: 2, unit: 's' } }));
    assert.equal(rendered.result.snapshot.valid, true);
    const dots = rendered.result.snapshot.scene.nodes.find(node => node.id === ids.markers);
    const expected = dots.positions.reduce((sum, position) => sum + Math.hypot(...position), 0) / dots.positions.length;
    assert.ok(Math.abs(evaluated.result.value.data - expected) < 1e-12);
    const undone = requireSuccess(await client.undo());
    assert.equal(project.snapshot().nodes.length, 0);
    assert.ok(undone.identity.revision > committed.identity.revision);
    requireSuccess(await client.redo());
    return { discoveredModel, discoveredPort, points: ids.points.length,
      meanAtTwoSeconds: evaluated.result.value.data, previewNonMutating: true,
      exactRetryReplayed: true, changedRetryRejected: true, undoRedo: true };
  } finally { await host.runtime.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await demonstrate(), null, 2));
