// Trusted composition root: generic software fixtures and reusable scene/views.
// Projects and HTTP requests never select or execute a registry module.
import { ExtensionRegistry } from '../../src/registry/index.js';
import { registerSceneExtensions } from '../../src/scene/index.js';
import { registerWorkspaceExtensions } from '../../src/workspace/index.js';
import { registryExtensions } from './registry-extensions.js';
import { runtimeExtensions } from './runtime-extensions.js';

export function createRegistry() {
  const registry = new ExtensionRegistry({ capabilities: [
    'dataflow.sync', 'assets.data', 'views.data', 'runtime.analytic', 'runtime.stateful', 'scene.data', 'workspace.data',
  ], limits: { maxArtifactEntries: 200000 } });
  for (const extension of [...registryExtensions, ...runtimeExtensions]) registry.register(extension);
  registerSceneExtensions(registry);
  return registerWorkspaceExtensions(registry);
}
