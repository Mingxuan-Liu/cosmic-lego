// Measure the public F12 preset's scientific and workspace compilation paths.
// The companion, browser, GPU, gateway, and network are outside these timings.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildExample, registryModule } from '../packages/exoplanet/recipe.mjs';
import { createRuntime } from '../src/runtime/index.js';

const { project, layer } = buildExample();
const runtime = createRuntime({ registryModule });
const sources = layer.sources(project), frames = [];
const ms = value => Math.round(value * 10) / 10;
try {
  for (const seconds of [0, 60, 120, 180]) {
    const time = { value: seconds, unit: 's' }, started = performance.now();
    const results = [], timings = [];
    for (const { nodeId, port } of sources) {
      const before = performance.now();
      const result = await runtime.submit(project, nodeId, { time, port }).promise;
      if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
      results.push(result);
      timings.push({ nodeId, port, ms: ms(performance.now() - before) });
    }
    const evaluated = performance.now();
    const workspace = await layer.compile(project, { time, results });
    if (!workspace.valid) throw new Error(JSON.stringify(workspace.diagnostics));
    const completed = performance.now();
    const valueSha256 = createHash('sha256').update(JSON.stringify(results.map(result => result.value))).digest('hex');
    frames.push({ seconds, scienceMs: ms(evaluated - started), compileMs: ms(completed - evaluated),
      totalMs: ms(completed - started), valueSha256, sources: timings });
  }
  console.log(JSON.stringify({ preset: project.snapshot().title, node: process.version,
    nodes: project.snapshot().nodes.length, sourceCount: sources.length, frames }, null, 2));
} finally { await runtime.dispose(); }
