// Explicit trusted composition root shared by authoring and F04 workers.
import { ExtensionRegistry } from '../../src/registry/index.js';
import { registerSceneExtensions } from '../../src/scene/index.js';
import { registryExtensions } from './registry-extensions.js';
import { runtimeExtensions } from './runtime-extensions.js';

export function createRegistry() {
  const registry = new ExtensionRegistry({ capabilities: ['dataflow.sync', 'assets.data', 'views.data', 'runtime.analytic', 'runtime.stateful', 'scene.data'],
    limits: { maxArtifactEntries: 200000 } });
  for (const extension of [...registryExtensions, ...runtimeExtensions]) registry.register(extension);
  return registerSceneExtensions(registry);
}
