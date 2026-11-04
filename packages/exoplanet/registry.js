// Optional trusted composition root used by the worker, host and exported player.
import { ExtensionRegistry } from '../../src/registry/index.js';
import { registerSceneExtensions } from '../../src/scene/index.js';
import { registerWorkspaceExtensions } from '../../src/workspace/index.js';
import { registerExoplanetExtensions } from './models.js';
import { registerExoplanetVisuals } from './visuals.js';

export function createRegistry() {
  const registry = new ExtensionRegistry({
    capabilities: ['dataflow.sync', 'assets.data', 'views.data', 'scene.data', 'workspace.data'],
    limits: { maxArtifactEntries: 200000 },
  });
  registerSceneExtensions(registry);
  registerWorkspaceExtensions(registry);
  registerExoplanetExtensions(registry);
  return registerExoplanetVisuals(registry);
}
