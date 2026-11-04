import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const shared = ['core', 'dataflow', 'registry', 'scene', 'workspace'];
const imports = source => [...source.matchAll(/^\s*(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+[^'";]*?\s+from\s+)['"]([^'"]+)['"]/gm)].map(match => match[1]);

test('workspace imports stay within shared layers and the browser entry selects only renderer, window, project and session adapters', () => {
  const visited = new Set();
  function inspect(file) {
    file = realpathSync(file);
    if (visited.has(file)) return;
    visited.add(file);
    assert.ok(shared.some(layer => file.startsWith(resolve(root, 'src', layer) + sep)), `Unexpected shared dependency ${file}`);
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\bimport\s*\(/, `${file} must not dynamically select a module`);
    for (const specifier of imports(source)) {
      assert.ok(specifier.startsWith('.'), `${file} imports an unexpected package ${specifier}`);
      inspect(resolve(dirname(file), specifier));
    }
  }
  for (const name of readdirSync(resolve(root, 'src/workspace')).filter(name => name.endsWith('.js'))) inspect(resolve(root, 'src/workspace', name));
  assert.ok(visited.size > 10, 'Check transitive dependencies, not only the workspace entry points.');
  const browser = readFileSync(resolve(root, 'demo/workspace/app.js'), 'utf8');
  assert.deepEqual(imports(browser).sort(), ['/src/scene/three-adapter.js', '/src/workspace/browser.js', '/src/workspace/plot-samples.js', '/src/workspace/project-files.js', '/src/workspace/session.js']);
  assert.doesNotMatch(browser, /\bimport\s*\(/, 'The browser must not load fixture/domain implementations from stored data.');
});

test('an isolated shared-layer copy authors and compiles scalar/vector-field plots with no domain files or fixture imports', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'cosmic-workspace-boundary-'));
  try {
    writeFileSync(resolve(directory, 'package.json'), '{"type":"module"}');
    for (const layer of shared) cpSync(resolve(root, 'src', layer), resolve(directory, 'src', layer), { recursive: true });
    writeFileSync(resolve(directory, 'check.mjs'), `
      import assert from 'node:assert/strict';
      import { Project } from './src/core/index.js';
      import { value } from './src/dataflow/index.js';
      import { ExtensionRegistry } from './src/registry/index.js';
      import { registerSceneExtensions } from './src/scene/index.js';
      import { registerWorkspaceExtensions, createWorkspaceLayer } from './src/workspace/index.js';
      const registry = registerWorkspaceExtensions(registerSceneExtensions(new ExtensionRegistry({capabilities:['scene.data']})));
      const binding = registry.bind(), workspace = createWorkspaceLayer(binding);
      const project = new Project({validators:workspace.validators}), draft = project.begin();
      const science = binding.author(draft), scene = workspace.scene.author(draft), views = workspace.author(draft);
      scene.root(); scene.camera({id:'camera'});
      const scalar = science.constant(value({kind:'scalar',data:7,unit:'K',meaning:'temperature'}), {id:'scalar'});
      const field = science.constant(value({kind:'field',data:[[1,0,0],[0,-2,3]],unit:'m/s',meaning:'velocity',
        frame:{id:'lab',kind:'direction'},coordinates:{kind:'space',unit:'m',frame:{id:'lab',kind:'position'},values:[[0,0,0],[2,0,0]]}}), {id:'field'});
      const material = scene.material({id:'material'}), arrows = scene.vectors({id:'arrows',material});
      scene.bind(arrows,field,{property:'vectors',unit:'m/s',quantity:'velocity',frame:'lab'});
      views.inspector({id:'inspector'});
      views.bind(views.plot({id:'scalar-plot'}),scalar);
      views.bind(views.plot({id:'field-plot',component:2}),field);
      draft.accept();
      const time = {value:2,unit:'s'}, sources = workspace.sources(project);
      assert.equal(sources.length,2, 'Scene and plot share one field snapshot.');
      const results = sources.map(source => binding.evaluate(project,source.nodeId,{port:source.port,time}));
      for(const result of results) assert.equal(result.valid,true,JSON.stringify(result.diagnostics));
      const before = JSON.stringify(results), output = await workspace.compile(project,{results,time});
      assert.equal(output.valid,true,JSON.stringify(output.diagnostics));
      assert.deepEqual(output.identity,project.token);
      assert.equal(output.overlays.find(view=>view.id==='scalar-plot').data.data,7);
      const plot = output.overlays.find(view=>view.id==='field-plot');
      assert.deepEqual(plot.data.data,[[1,0,0],[0,-2,3]]);
      assert.equal(plot.component,2); assert.equal(plot.source.nodeId,'field');
      assert.deepEqual(output.scene.nodes.find(node=>node.id==='arrows').directions,plot.data.data);
      assert.equal(JSON.stringify(results),before, 'Compilation must not mutate scientific snapshots.');
      const restored = Project.from(JSON.parse(JSON.stringify(project.snapshot())),{validators:workspace.validators});
      assert.notEqual(restored.token.generation,project.token.generation);
      assert.equal(workspace.sources(restored).length,2);
      console.log('isolated workspace scalar and vector-field compilation passed');
    `);
    const run = spawnSync(process.execPath, ['check.mjs'], { cwd: directory, encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /isolated workspace scalar and vector-field compilation passed/);
    assert.deepEqual(readdirSync(resolve(directory, 'src')).sort(), [...shared].sort());
    assert.deepEqual(readdirSync(directory).sort(), ['check.mjs', 'package.json', 'src']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
