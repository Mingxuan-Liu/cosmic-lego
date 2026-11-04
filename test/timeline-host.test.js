import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildExample } from '../examples/workspace.mjs';
import { buildTimelineManifest } from '../examples/authored-timeline.mjs';
import { createTimeline } from '../src/timeline/definition.js';
import { createPortableManifest, openPortableManifest } from '../src/portable/format.js';
import { fingerprint } from '../src/runtime/contracts.js';
import { startSceneServer } from '../scripts/scene-server.mjs';

test('portable files validate future configurations and pin builds absent from the base project', () => {
  const context = buildExample(), snapshot = context.project.snapshot(), identity = context.project.token;
  const author = createTimeline({ duration: 2, title: 'An additional producer' });
  author.boundary({ id: 'attach', at: 1, label: 'Independent stochastic run', operations: [
    { command: 'create:fixture.seeded-accumulator', args: { id: 'new-run' } },
  ] });
  const manifest = createPortableManifest({ ...context, timeline: author.snapshot() });
  assert.ok(!manifest.requirements.some(record => record.id === 'fixture.seeded-accumulator'));
  const pin = manifest.timeline.configurations[0].requirements.find(record => record.id === 'fixture.seeded-accumulator');
  assert.ok(pin.implementation.build);
  assert.deepEqual(openPortableManifest(manifest, context).manifest.timeline, manifest.timeline);
  const { integrity, ...body } = structuredClone(manifest);
  body.timeline.configurations[0].requirements.find(record => record.id === pin.id).implementation.build += '-other';
  assert.throws(() => openPortableManifest({ ...body, integrity: { ...integrity, sha256: fingerprint(body) } }, context), { code: 'TIMELINE_REQUIREMENTS' });
  author.boundary({ at: 2, id: 'broken', label: 'Missing node', operations: [{ command: 'remove', args: { id: 'missing-node' } }] });
  assert.throws(() => createPortableManifest({ ...context, timeline: author.snapshot() }), { code: 'UNKNOWN_ID' });
  assert.deepEqual(context.project.token, identity); assert.deepEqual(context.project.snapshot(), snapshot);
});

test('workspace files retain authored tracks, and exact snapshot requests expire after editing or replacing them', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cosmic-timeline-workspace-'));
  const app = await startSceneServer({ workspace: true, port: 0, projectDirectory: directory });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function request(route, input, extraHeaders = {}) {
    const response = await fetch(app.url + route, { ...(input && { method: 'POST', body: JSON.stringify(input) }), headers: { 'content-type': 'application/json', ...extraHeaders } });
    return { status: response.status, ...await response.json() };
  }
  const base = await buildTimelineManifest();
  assert.equal((await request('/api/timeline')).error.code, 'TIMELINE_MISSING');
  assert.equal((await request('/api/projects/import', { expected: app.project.token, document: base })).ok, true);
  const initial = app.project.token, history = app.project.history;
  const meta = (await request('/api/timeline')).result;
  const frame = await request('/api/timeline/frame', { time: 4, snapshotId: meta.snapshotId });
  assert.equal(frame.result.configuration.boundaries[0].id, 'comparison-b');
  assert.deepEqual(app.project.token, initial); assert.deepEqual(app.project.history, history);
  assert.equal((await request('/api/timeline/frame', { time: 1, module: './bad.js' })).error.code, 'TIMELINE_REQUEST');
  assert.equal((await request('/api/timeline/frame', { time: 1 }, { Origin: 'https://example.invalid' })).status, 403);
  const exported = (await request('/api/projects/export', { expected: initial })).result;
  assert.deepEqual(exported.timeline, base.timeline);
  const changed = { version: 1, data: { ...base.timeline.data, title: 'Retitled comparison' } };
  const saved = await request('/api/projects/save', { expected: initial, name: 'example', expectedVersion: null, timeline: changed });
  assert.equal(saved.ok, true); assert.equal(saved.result.hasTimeline, true);
  assert.equal((await request('/api/timeline/frame', { time: 4, snapshotId: meta.snapshotId })).error.code, 'STALE_TIMELINE');
  const newMeta = (await request('/api/timeline')).result; assert.equal(newMeta.title, changed.data.title);
  assert.equal((await request('/api/gateway', { command: 'update:fixture.moving-point', args: { id: 'point-8', parameters: { v: [0, 0, 0] } },
    expected: initial, idempotencyKey: 'future-playback' })).ok, true);
  assert.equal((await request('/api/timeline/frame', { time: 4, snapshotId: newMeta.snapshotId })).status, 409);
  await request('/api/projects/open', { name: 'example', expected: app.project.token, expectedVersion: saved.result.version });
  assert.notEqual(app.project.token.generation, initial.generation); assert.deepEqual(app.project.history, history);
  assert.equal((await request('/api/timeline')).result.title, changed.data.title);
  assert.equal((await request('/api/agent/state')).result.status, 'disconnected');
});
