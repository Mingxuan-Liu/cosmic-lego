import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { buildExample } from '../examples/workspace.mjs';
import { createPortableManifest, createVisualizationManifest, portableOptions } from '../src/portable/format.js';
import { createCommandGateway } from '../src/gateway/index.js';
import { fingerprint } from '../src/runtime/contracts.js';
import { createTimeline } from '../src/timeline/definition.js';
import { exportFrames, makeFrameSchedule, packagePlayer } from '../src/timeline/export.js';

const schedule = { start: 0, end: 1, fps: 2, width: 800, height: 600 };
const jsonAt = async file => JSON.parse(await readFile(file, 'utf8'));
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const context = buildExample();
  const author = createTimeline({ id: 'seek', title: 'Offline capture fixture', duration: 1 });
  author.track({ id: 'clock', kind: 'physical-time', keys: [{ at: 0, value: 0 }, { at: 1, value: 2 }] });
  author.track({ id: 'caption', kind: 'annotation', keys: [{ at: 0, value: 'Original' }, { at: 0.5, value: 'Comparison' }] });
  const manifest = createPortableManifest({ ...context, timeline: author.snapshot(), source: { path: 'recipe.mjs', language: 'javascript',
    text: 'throw new Error("Embedded recipe must remain inert")', producedGraph: context.project.snapshot() } });
  return { context, manifest };
}
async function temporary(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cosmic-timeline-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
async function localArchive() {
  const { context, manifest } = fixture(), gateway = createCommandGateway(context);
  const accepted = await gateway.dispatch({ command: 'overlay.update', expected: context.project.token, idempotencyKey: 'local-title',
    args: { id: 'positions-plot', parameters: { title: 'Exported readout' } } }, gateway.localAuthority);
  assert.equal(accepted.ok, true);
  const archive = createPortableManifest({ ...context, ...portableOptions(manifest), includeTranscript: true,
    transcript: [{ role: 'user', id: 'local-message-id', turnId: 'local-turn-id', text: 'A conversation for the local save.' }],
    includeReceipts: true, receipts: [{ ...accepted, turnId: 'local-turn-id', callId: 'local-call-id' }] });
  return { context, archive };
}
function assertVisualization(delivered, archive) {
  const { integrity, sharing, ...construction } = delivered;
  const { integrity: originalIntegrity, sharing: originalSharing, ...originalConstruction } = archive;
  assert.deepEqual(construction, originalConstruction);
  assert.equal(integrity.graphHash, originalIntegrity.graphHash); assert.notEqual(integrity.sha256, originalIntegrity.sha256);
  assert.deepEqual(sharing, { transcriptIncluded: false, transcript: [], receiptsIncluded: true,
    receipts: originalSharing.receipts.map(({ command, identity, summary }) => ({ command, identity, summary })) });
  assert.doesNotMatch(JSON.stringify(delivered), /local-turn-id|local-call-id|local-message-id|A conversation for the local save/);
}
test('frame schedules use index-based timestamps, exact grid endpoints, explicit dimensions and bounded work', () => {
  assert.deepEqual(makeFrameSchedule(schedule).times, [0, 0.5, 1]);
  assert.deepEqual(makeFrameSchedule({ ...schedule, start: 0.1, end: 0.3, fps: 10 }).times, [0.1, 0.2, 0.3]);
  assert.deepEqual(makeFrameSchedule({ ...schedule, start: 0.3, end: 0.3 }).times, [0.3]);
  assert.deepEqual(makeFrameSchedule({ ...schedule, end: 0.99 }).times, [0, 0.5]);
  assert.throws(() => makeFrameSchedule({ ...schedule, width: 5001, height: 5001 }), { code: 'FRAME_DIMENSIONS' });
  assert.throws(() => makeFrameSchedule({ ...schedule, fps: -1 }), { code: 'FRAME_SCHEDULE' });
  assert.throws(() => makeFrameSchedule({ ...schedule, fps: 100, end: 100 }), { code: 'FRAME_BUDGET' });
});
test('an aborted export and an invalid schedule preserve a truthful prefix and never overwrite another delivery', async t => {
  const dir = await temporary(t), { manifest } = fixture();
  const directory = path.join(dir, 'aborted'), invalid = path.join(dir, 'invalid');
  await assert.rejects(exportFrames({ manifest, directory, schedule, signal: AbortSignal.abort() }), { code: 'EXPORT_INTERRUPTED' });
  assert.deepEqual((await jsonAt(path.join(directory, 'progress.json'))).completedFrames, 0);
  assert.equal((await jsonAt(path.join(directory, 'progress.json'))).status, 'interrupted');
  await assert.rejects(exportFrames({ manifest, directory, schedule }), { code: 'DELIVERY_EXISTS' });
  await assert.rejects(exportFrames({ manifest, directory: invalid, schedule: { ...schedule, end: 2 } }), { code: 'FRAME_SCHEDULE' });
  const failed = await jsonAt(path.join(invalid, 'progress.json'));
  assert.equal(failed.status, 'failed'); assert.equal(failed.completedFrames, 0);
});
test('visualization sharing validates local consent records and hashes before projecting them out', async t => {
  const { context, archive } = await localArchive(), dir = await temporary(t);
  const published = createVisualizationManifest(archive, context);
  assertVisualization(published, archive); assert.equal(archive.sharing.transcript.length, 1);
  assert.equal(createVisualizationManifest(published, context).integrity.sha256, published.integrity.sha256);
  const damaged = structuredClone(archive);
  damaged.sharing.transcript[0].text = 'Changed after the save';
  await assert.rejects(packagePlayer({ manifest: damaged, directory: path.join(dir, 'bad-player') }), { code: 'PORTABLE_INTEGRITY' });
  await assert.rejects(exportFrames({ manifest: damaged, directory: path.join(dir, 'bad-export'), schedule }), { code: 'PORTABLE_INTEGRITY' });
  assert.deepEqual(await readdir(path.join(dir, 'bad-export')), ['progress.json']);
  const { integrity, ...body } = structuredClone(archive);
  body.sharing.transcript[0].role = 'secret';
  assert.throws(() => createVisualizationManifest({ ...body, integrity: { ...integrity, sha256: fingerprint(body) } }, context),
    { code: 'PORTABLE_TRANSCRIPT' });
});
test('a copied offline player launches from a clean directory with its own trusted code and reproduces numeric frames', async t => {
  const dir = await temporary(t), { archive } = await localArchive(), directory = path.join(dir, 'player');
  await packagePlayer({ manifest: archive, directory });
  const manifest = await jsonAt(path.join(directory, 'project.json'));
  assertVisualization(manifest, archive);
  const inventory = await jsonAt(path.join(directory, 'delivery.json'));
  assert.equal(inventory.status, 'complete'); assert.equal(inventory.snapshotId, manifest.integrity.sha256);
  for (const item of inventory.files) assert.equal(sha(await readFile(path.join(directory, item.file))), item.sha256);
  assert.ok(inventory.files.some(item => item.file === 'node_modules/three/LICENSE'));
  assert.ok(inventory.files.every(item => !item.file.startsWith('src/agent-session/') && !item.file.includes('recipe.mjs')));
  const script = `
    import {readFile} from 'node:fs/promises';
    import {startTimelineServer} from './scripts/timeline-server.mjs';
    const server = await startTimelineServer({manifest:await readFile('project.json')});
    try {
      const meta = (await (await fetch(server.url+'/api/timeline')).json()).result;
      const res = await fetch(server.url+'/api/timeline/frame',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({time:0.5,snapshotId:meta.snapshotId})});
      const outcome = await res.json(); if(!outcome.ok) throw new Error(JSON.stringify(outcome));
      const frame=outcome.result;
      const paths=['/timeline/','/timeline/app.js','/timeline/style.css','/src/workspace/plot-samples.js','/vendor/three/three.module.js','/assets/branding/cosmic-lego-galaxy.png'];
      const status=await Promise.all(paths.map(async p=>(await fetch(server.url+p)).status));
      console.log(JSON.stringify({meta,physicalTime:frame.physicalTime,caption:frame.annotations[0].text,values:frame.results.length,status}));
    } finally {await server.close();}
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script],
    { cwd: directory, env: {}, timeout: 60000 });
  const observed = JSON.parse(stdout);
  assert.equal(observed.meta.snapshotId, manifest.integrity.sha256); assert.equal(observed.physicalTime.value, 1);
  assert.equal(observed.caption, 'Comparison'); assert.ok(observed.values > 0); assert.ok(observed.status.every(n => n === 200));
});

test('real PNGs match interactive scientific frames and retain a complete prefix after cancellation',
  { skip: !process.env.COSMIC_LEGO_PLAYWRIGHT && 'Set COSMIC_LEGO_PLAYWRIGHT and optionally COSMIC_LEGO_CHROME for browser capture.' }, async t => {
    const dir = await temporary(t), { context, archive: manifest } = await localArchive(), directory = path.join(dir, 'capture');
    const mutable = structuredClone(manifest), controller = new AbortController();
    const { startTimelineServer } = await import('../scripts/timeline-server.mjs');
    const interactive = await startTimelineServer({ manifest });
    t.after(() => interactive.close());
    const expected = (await (await fetch(interactive.url + '/api/timeline/frame', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ time: 0.5 }) })).json()).result;
    await assert.rejects(exportFrames({ manifest: mutable, directory, schedule, signal: controller.signal,
      onFrame({ index }) {
        if (index === 0) {
          const draft = context.project.begin();
          context.layer.author(draft).update('positions-plot', { title: 'Concurrent edit' }); draft.accept();
          mutable.timeline.data.title = 'Replaced caller input';
        } else controller.abort();
      } }), { code: 'EXPORT_INTERRUPTED' });
    const progress = await jsonAt(path.join(directory, 'progress.json'));
    assertVisualization(await jsonAt(path.join(directory, 'project.json')), manifest);
    assert.equal(progress.status, 'interrupted'); assert.equal(progress.completedFrames, 2);
    assert.deepEqual((await readdir(path.join(directory, 'frames'))).sort(), ['frame-000000.json', 'frame-000000.png', 'frame-000001.json', 'frame-000001.png']);
    const frame = await jsonAt(path.join(directory, 'frames/frame-000001.json')), png = await readFile(path.join(directory, frame.image));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), schedule.width); assert.equal(png.readUInt32BE(20), schedule.height); assert.equal(sha(png), frame.imageHash);
    assert.equal(frame.presentationTime, expected.presentationTime); assert.deepEqual(frame.physicalTime, expected.physicalTime);
    assert.deepEqual(frame.identity, manifest.savedFrom); assert.notDeepEqual(context.project.token, manifest.savedFrom);
    assert.deepEqual(frame.configuration, expected.configuration);
    assert.deepEqual(frame.results.map(item => item.value), expected.results.map(item => item.value));
    assert.deepEqual(frame.annotations, expected.annotations); assert.equal(frame.renderer.name, 'three');
  });
