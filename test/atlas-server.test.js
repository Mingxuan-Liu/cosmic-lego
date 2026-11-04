import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startExoplanetServer } from '../apps/exoplanet.mjs';
import { startSceneServer } from '../scripts/scene-server.mjs';

test('astronomy host serves the atlas home, its module allowlist, and the separate workspace', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cosmic-atlas-'));
  const host = await startExoplanetServer({ port: 0, projectDirectory: directory });
  try {
    const root = await fetch(host.url + '/'), atlas = await fetch(host.url + '/atlas/');
    assert.equal(root.status, 200);
    assert.match(root.headers.get('content-type'), /^text\/html/);
    const home = await root.text();
    assert.match(home, /id="atlas-canvas"/);
    assert.match(home, /<html\b[^>]*data-projection="3d"/, 'Serve the 3D view before JavaScript initializes.');
    assert.equal(await atlas.text(), home);
    assert.match(await (await fetch(host.url + '/workspace/')).text(), /id="overlays"/);
    for (const file of ['app.js', 'cluster.js', 'layout.js', 'orbit.js', 'coverage.mjs', 'reuse.mjs', 'roadmap.mjs', 'roadmap-assets.mjs', 'foundations.mjs', 'techniques.mjs', 'style.css']) {
      const asset = await fetch(host.url + '/atlas/' + file);
      assert.equal(asset.status, 200, file);
      assert.match(asset.headers.get('content-type'), file.endsWith('.css') ? /^text\/css/ : /^text\/javascript/);
    }
    for (const url of ['/atlas/unknown.mjs', '/packages/atlas/coverage.mjs', '/atlas/../package.json']) {
      assert.equal((await fetch(host.url + url)).status, 404, url);
    }
  } finally {
    await host.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('generic workspace keeps its original home and serves no astronomy atlas assets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cosmic-atlas-generic-'));
  const host = await startSceneServer({ workspace: true, port: 0, projectDirectory: directory });
  try {
    assert.match(await (await fetch(host.url + '/')).text(), /id="overlays"/);
    for (const url of ['/atlas/', '/atlas/reuse.mjs', '/atlas/layout.js', '/atlas/orbit.js', '/atlas/roadmap.mjs', '/atlas/foundations.mjs', '/atlas/techniques.mjs', '/studies/planetary-transits/']) assert.equal((await fetch(host.url + url)).status, 404);
  } finally {
    await host.close(); await rm(directory, { recursive: true, force: true });
  }
});

test('the roadmap study keeps its own timeline while the workspace opens a different project', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cosmic-study-'));
  const app = await startExoplanetServer({port: 0, projectDirectory: directory});
  try {
    const url = app.url + '/studies/planetary-transits/';
    const meta = async endpoint => (await (await fetch(endpoint)).json()).result;
    const study = await meta(url + 'api/timeline');
    assert.equal(study.title, 'When shadows overlap');
    assert.match(await (await fetch(url)).text(), /id="scrub"/);
    const document = JSON.parse(await readFile(new URL('./fixtures/shared-shadow-project.json', import.meta.url)));
    await app.portable.action('import', {document, expected: app.project.token});
    const identity = app.project.token;
    assert.notEqual((await meta(app.url+'/api/timeline')).snapshotId, study.snapshotId);
    assert.deepEqual(await meta(url+'api/timeline'), study);
    const frame = await fetch(url+'api/timeline/frame', {method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({time:4,snapshotId:study.snapshotId})});
    assert.equal(frame.status, 200);
    const { result } = await frame.json();
    assert.deepEqual(result.physicalTime, {value: 0, unit: 's'});
    assert.deepEqual(app.project.token, identity);
    assert.equal((await fetch(app.url+'/studies/uninstalled/')).status,404);
  } finally {
    await app.close();
    await rm(directory, {recursive:true,force:true});
  }
});
