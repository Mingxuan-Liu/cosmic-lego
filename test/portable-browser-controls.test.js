import test from 'node:test';
import assert from 'node:assert/strict';
import { readProjectFile, setProjectTime } from '../src/workspace/project-files.js';

test('browser import reads bounded UTF-8 data without executing authored text', async () => {
  const data = { text: '中文工作区 · globalThis.__portableTest = true' };
  assert.deepEqual(await readProjectFile(new Blob([JSON.stringify(data)])), data);
  await assert.rejects(readProjectFile(new Blob([Uint8Array.of(34, 255, 34)])), /UTF-8 JSON/);
  await assert.rejects(readProjectFile(new Blob(['{"unfinished":'])), /UTF-8 JSON/);
  await assert.rejects(readProjectFile({ size: 16 * 1024 * 1024 + 1, arrayBuffer() { throw new Error('Unexpected oversized read'); } }), /16 MiB/);
});

test('restored playheads permit negative, off-grid and beyond-fixture samples', () => {
  const slider = {};
  for (const seconds of [0, 2.125, -1.125, 12.12345678901234]) {
    setProjectTime(slider, seconds);
    assert.equal(Number(slider.value), seconds);
    assert.ok(Number(slider.min) <= seconds && Number(slider.max) >= seconds);
  }
  setProjectTime(slider, 1);
  assert.deepEqual(slider, { min: '0', max: '8', step: '0.25', value: '1' });
  assert.throws(() => setProjectTime(slider, Infinity), /finite/);
});
