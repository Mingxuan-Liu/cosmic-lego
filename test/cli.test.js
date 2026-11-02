import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const run = (...args) => spawnSync(process.execPath, ['scripts/agent.mjs', ...args], { cwd: root, encoding: 'utf8' });

test('agent CLI rejects misspelled flags and missing revision guards', () => {
  for (const args of [
    ['evaluate', 'examples/single-transit.json', '--time-day', '0.75'],
    ['apply', 'examples/single-transit.json', '--base-revision'],
    ['apply', 'examples/single-transit.json', '--base-revision', '--url', 'http://127.0.0.1:4317'],
    ['apply', 'examples/single-transit.json', '--base-revision', 'NaN'],
    ['evaluate', 'examples/single-transit.json', '--time-days', '0', '--time-days', '1'],
    ['validate']
  ]) {
    const result = run(...args); assert.equal(result.status, 1, result.stdout);
    assert.equal(JSON.parse(result.stdout).error, 'AGENT_ERROR');
  }
});

test('agent CLI uses the same validated clock and supports JSON stdin', () => {
  const result = run('evaluate', 'examples/single-transit.json', '--time-days', '0.75');
  assert.equal(result.status, 0); const data = JSON.parse(result.stdout);
  assert.equal(data.timeDays, 0.75); assert.ok(data.views[0].state.stellarRVMps < -100);
  const malformed = spawnSync(process.execPath, ['scripts/agent.mjs', 'validate', '-'], { cwd: root, encoding: 'utf8', input: '{invalid}' });
  assert.equal(malformed.status, 1); assert.equal(JSON.parse(malformed.stdout).error, 'AGENT_ERROR');
});
