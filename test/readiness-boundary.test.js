import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { stageReadinessWorkspace } from '../scripts/readiness-workspace.mjs';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(repo, 'scripts/readiness-workspace.mjs');
async function scratch(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'cosmic-f11-boundary-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}
const hash = data => 'sha256:' + createHash('sha256').update(data).digest('hex');
test('the isolated production tree resolves its worker, shell, optional agent and delivery dependencies without any legacy package', async t => {
  const stage = await stageReadinessWorkspace(path.join(await scratch(t), 'app'));
  const { audit } = stage, paths = stage.files.map(f => f.path);
  assert.ok(!stage.directory.startsWith(repo)); assert.equal(audit.negativeProbes.length, 21);
  assert.ok(audit.negativeProbes.some(probe => probe.specifier === './packages/exoplanet/registry.js'));
  assert.ok(audit.negativeProbes.every(probe => /NOT_FOUND|NOT_EXPORTED/.test(probe.code)));
  for (const missing of audit.absentFiles) assert.ok(!paths.includes(missing));
  const actualAuthor = paths.includes('experiments/f11-author.mjs') ? 'experiments/f11-author.mjs' : null;
  assert.equal(audit.authorRecipe, actualAuthor);
  for (const name of ['src/agent-session/codex.js', 'src/runtime/worker.js', 'demo/workspace/app.js', 'demo/timeline/app.js',
    'src/scene/three-adapter.js', 'src/timeline/export.js', 'scripts/timeline-delivery.mjs', 'scripts/timeline-server.mjs', 'src/gateway/sdk.js']) {
    assert.ok(audit.modules.includes(name), name);
  }
  assert.ok(audit.edges.some(e => e.from === 'src/runtime/index.js' && e.to === 'src/runtime/worker.js'));
  assert.ok(audit.edges.some(e => e.from === 'src/runtime/worker.js' && e.to === 'examples/fixtures/workspace-registry.js'));
  assert.ok(audit.closures.workspaceHost.modules.includes('src/agent-session/codex.js'));
  assert.ok(audit.closures.workspaceBrowser.modules.includes('node_modules/three/build/three.core.js'));
  assert.ok(audit.closures.delivery.modules.includes('src/timeline/evaluator.js'));
  assert.ok(audit.closures.kernel.modules.every(name => name.startsWith('src/core/')));
  assert.ok(audit.external.some(e => e.parameter === 'COSMIC_LEGO_PLAYWRIGHT'));
  assert.equal(audit.threeRevision, '187');
  for (const entry of stage.files) {
    assert.equal(hash(await readFile(path.join(stage.directory, entry.path))), entry.sha256);
    if (entry.path !== 'package.json') assert.equal(hash(await readFile(path.join(repo, entry.path))), entry.sha256, entry.path);
  }

  // Start the same real app from a clean process. Check an actual worker
  // calculation, HTTP browser routes, project capture and disconnected agent.
  const program = `
    import assert from 'node:assert/strict';
    import {startSceneServer} from './scripts/scene-server.mjs';
    const app=await startSceneServer({workspace:true,port:0});
    try {
      async function api(url, body) {
        const response=await fetch(app.url+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
        const data=await response.json();assert.equal(response.status,200,JSON.stringify(data.error));return data;
      }
      const state=(await api('/api/projects/state')).result;
      const command=async (command,args)=>{const r=await api('/api/gateway',{command,args,expected:state.identity});assert.equal(r.ok,true,JSON.stringify(r.error));return r.result};
      const selection=await command('evaluate',{id:'point-0',port:'position',time:{value:2,unit:'s'}});
      assert.ok(selection.valid);assert.equal(selection.value.unit.symbol,'m');
      for(const [i,component] of [-3.22,0.76,-0.68].entries())assert.ok(Math.abs(selection.value.data[i]-component)<1e-12);
      const archive=(await api('/api/projects/export',{expected:state.identity,time:{value:2,unit:'s'}})).result;
      assert.equal(archive.format,'cosmic-lego.project');
      assert.ok(archive.assets.length&&archive.dataSources.some(s=>s.nodeId==='scalar-field'));
      assert.ok(archive.requirements.some(r=>r.id==='fixture.moving-point'));
      assert.deepEqual(archive.sharing.transcript,[]);
      assert.equal(app.agentSession.snapshot().status,'disconnected');
      for(const route of ['/','/workspace/app.js','/src/workspace/browser.js','/timeline/','/timeline/app.js','/vendor/three/three.module.js','/vendor/three/three.core.js','/vendor/three/OrbitControls.js','/assets/branding/cosmic-lego-galaxy.png']){
        const response=await fetch(app.url+route);assert.equal(response.status,200,route);assert.ok((await response.arrayBuffer()).byteLength>0);
      }
      for(const route of ['/src/physics.js','/src/sdk.js','/examples/tilted-orbits.mjs']){
        const response=await fetch(app.url+route);assert.equal(response.status,404,route);
      }
      console.log(JSON.stringify({position:selection.value.data,sourceCount:archive.playback.targets.length}));
    }finally{await app.close()}
  `;
  const env = { ...process.env }; delete env.NODE_PATH; delete env.NODE_OPTIONS;
  const { stdout } = await run(process.execPath, ['--input-type=module', '--eval', program], { cwd: stage.directory, env, timeout: 60000 });
  assert.ok(JSON.parse(stdout).sourceCount >= 4);
});

test('dependency audit rejects introduced transitive legacy, disguised dynamic loads and additional HTML script entries', async t => {
  const { directory } = await stageReadinessWorkspace(path.join(await scratch(t), 'app'));
  async function rejectNew(file, content, expected) {
    const filename = path.join(directory, file), original = await readFile(filename);
    await appendFile(filename, content);
    try {
      await assert.rejects(run(process.execPath, ['--no-warnings', '--experimental-vm-modules', script, '--audit', directory]), e => expected.test(e.stderr));
    } finally { await writeFile(filename, original); }
  }
  await rejectNew('src/dataflow/values.js', '\nexport { createWorld } from "../sdk.js";\n', /Import escapes the staged inventory/);
  await rejectNew('src/core/data.js', '\nimport "../../examples/fixtures/workspace-registry.js";\n', /cannot import a fixture composition/);
  await rejectNew('src/runtime/engine.js', '\nexport const loadUnknown = x => import \/\* unreviewed \*\/ (x);\n', /Unreviewed dynamic module load/);
  await rejectNew('demo/workspace/index.html', '<script type="module" src="/src/physics.js"></script>', /Unreviewed HTML script entry/);
});

test('staging preserves existing work and rejects source checkout and ancestor package fallback', async t => {
  const base = await scratch(t), existing = path.join(base, 'existing');
  await mkdir(existing); await writeFile(path.join(existing, 'keep'), 'saved');
  await assert.rejects(stageReadinessWorkspace(existing), error => error.code === 'EEXIST');
  assert.equal(await readFile(path.join(existing, 'keep'), 'utf8'), 'saved');
  await assert.rejects(stageReadinessWorkspace(path.join(repo, '.local', 'f11-forbidden-child')), /outside the checkout/);
  await mkdir(path.join(base, 'node_modules'));
  await assert.rejects(stageReadinessWorkspace(path.join(base, 'app')), /ancestor node_modules/);
});
