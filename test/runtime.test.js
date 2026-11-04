import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Project } from '../src/core/index.js';
import { value } from '../src/dataflow/index.js';
import { createRuntime, RUNTIME_LIMITS } from '../src/runtime/index.js';
import { createRegistry } from './fixtures/runtime-host.mjs';

const registryModule = new URL('./fixtures/runtime-host.mjs', import.meta.url);
const rateUnit = { symbol: '1/s', dimensions: { time: -1 }, scale: 1 };
const rateValue = rate => value({ kind: 'scalar', data: rate, unit: rateUnit, meaning: 'accumulation-rate' });
const time = number => ({ value: number, unit: 's' });

function setup() {
  const binding = createRegistry().bind();
  const project = new Project({ validators: binding.validators });
  const draft = project.begin();
  return { binding, project, draft, author: binding.author(draft) };
}

function deterministic({ initial = 1, rate = 2 } = {}) {
  const result = setup();
  const source = result.author.constant(rateValue(rate), { id: 'rate' });
  result.author.instantiate('fixture.accumulator', { id: 'accumulator', parameters: { initial }, inputs: { source } });
  result.draft.accept();
  return result;
}

function stochastic() {
  const result = setup();
  result.author.instantiate('fixture.seeded-accumulator', { id: 'random', parameters: { initial: 0 } });
  result.draft.accept();
  return result;
}

function valid(result, project) {
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.ok(result.value);
  assert.deepEqual(result.identity, project.token);
  assert.ok(Array.isArray(result.checkpoints));
  assert.equal(typeof result.metadata.runtime.jobId, 'string');
  assert.ok(result.metadata.runtime.elapsedMs >= 0);
  return result;
}

function invalid(result, code) {
  assert.equal(result.valid, false);
  assert.equal(result.value, null);
  assert.deepEqual(result.checkpoints, []);
  assert.ok(result.diagnostics.length > 0);
  if (code) assert.ok(result.diagnostics.some(item => item.code === code), JSON.stringify(result.diagnostics));
  return result;
}

function stateRequest(number, extra = {}) {
  return { time: time(number), mode: 'stateful', ...extra };
}

async function waitFor(predicate, timeoutMs = 3000) {
  const until = performance.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(performance.now() < until, 'Timed out waiting for the worker probe.');
    await delay(5);
  }
}

function cpuProject(startedFile) {
  const result = setup();
  result.author.instantiate('test.runtime.cpu', { id: 'cpu', parameters: { durationMs: 20000, startedFile } });
  result.draft.accept();
  return result;
}

test('analytic workers evaluate moving points directly at physical times and retain result identity', async () => {
  const { project, draft, author } = setup();
  author.instantiate('fixture.moving-point', { id: 'point', parameters: { r0: [1, -2, 3], v: [2, -1, 0.5] } });
  draft.accept();
  const runtime = createRuntime({ registryModule });
  try {
    for (const requested of [0, 2, -1, 5]) {
      const job = runtime.submit(project, 'point', { port: 'position', time: time(requested), mode: 'analytic' });
      const result = valid(await job.promise, project);
      assert.deepEqual(result.value.data, [1 + 2 * requested, -2 - requested, 3 + 0.5 * requested]);
      assert.equal(result.request.time.value, requested);
      assert.equal(result.metadata.runtime.achievedTime.value, requested);
      assert.equal(result.metadata.runtime.path, 'analytic');
      assert.equal(result.metadata.runtime.steps, 0);
      assert.deepEqual(result.checkpoints, []);
      assert.equal(job.status, 'completed');
      assert.equal(job.progress.phase, 'completed');
    }
  } finally { await runtime.dispose(); }
});

test('deterministic state agrees between fresh, sequential, analytic and explicit checkpoint runs', async t => {
  const { project } = deterministic();
  const runtime = createRuntime({ registryModule });
  const freshRuntime = createRuntime({ registryModule });
  try {
    const first = valid(await runtime.submit(project, 'accumulator', stateRequest(1)).promise, project);
    assert.equal(first.value.data, 3);
    assert.equal(first.metadata.runtime.steps, 4);
    const sequential = valid(await runtime.submit(project, 'accumulator', stateRequest(2)).promise, project);
    const fresh = valid(await freshRuntime.submit(project, 'accumulator', stateRequest(2)).promise, project);
    const analytic = valid(await freshRuntime.submit(project, 'accumulator', { time: time(2), mode: 'analytic' }).promise, project);
    const resumed = valid(await freshRuntime.submit(project, 'accumulator', stateRequest(2, { checkpoints: first.checkpoints })).promise, project);
    for (const result of [sequential, fresh, analytic, resumed]) assert.equal(result.value.data, 5);
    assert.equal(sequential.metadata.runtime.components[0].strategy, 'checkpoint');
    assert.equal(resumed.metadata.runtime.components[0].strategy, 'checkpoint');
    assert.equal(fresh.metadata.runtime.steps, 8);
    const checkpoint = resumed.checkpoints[0];
    assert.deepEqual(checkpoint.identity, project.token);
    assert.equal(checkpoint.nodeId, 'accumulator');
    assert.equal(checkpoint.time.value, 2);
    assert.equal(checkpoint.random, null);
    assert.match(checkpoint.inputIdentity, /^sha256:/);
    assert.equal(checkpoint.settings.step, 0.25);
    assert.equal(checkpoint.implementation.build, 'runtime-fixture-1');
    t.diagnostic(JSON.stringify({ checkpointBytes: Buffer.byteLength(JSON.stringify(first.checkpoints)),
      firstSteps: first.metadata.runtime.steps, resumedSteps: resumed.metadata.runtime.steps, freshSteps: fresh.metadata.runtime.steps }));
  } finally { await Promise.all([runtime.dispose(), freshRuntime.dispose()]); }
});

test('seeded resumes retain generator identity, current state and draw count rather than only a seed', async () => {
  const { project } = stochastic();
  const runtime = createRuntime({ registryModule }), fresh = createRuntime({ registryModule });
  try {
    const first = valid(await runtime.submit(project, 'random', stateRequest(1)).promise, project);
    assert.equal(first.checkpoints[0].random.algorithm, 'lcg32');
    assert.deepEqual(first.checkpoints[0].random.state, { value: 2726892157, draws: 4 });
    const sequential = valid(await runtime.submit(project, 'random', stateRequest(2)).promise, project);
    const direct = valid(await fresh.submit(project, 'random', stateRequest(2)).promise, project);
    const resumed = valid(await fresh.submit(project, 'random', stateRequest(2, { checkpoints: first.checkpoints })).promise, project);
    for (const result of [sequential, direct, resumed]) {
      assert.equal(result.value.data, -0.7182601829990745);
      assert.deepEqual(result.checkpoints[0].random.state, { value: 2355140353, draws: 8 });
    }
    const incomplete = structuredClone(first.checkpoints);
    incomplete[0].random = { algorithm: 'lcg32', state: { seed: 12345 } };
    incomplete[0].payload.random = incomplete[0].random;
    invalid(await fresh.submit(project, 'random', stateRequest(2, { checkpoints: incomplete })).promise);
  } finally { await Promise.all([runtime.dispose(), fresh.dispose()]); }
});

test('backward seeks reset and replay forward instead of reversing stored evolution', async () => {
  const { project } = deterministic();
  const runtime = createRuntime({ registryModule });
  try {
    valid(await runtime.submit(project, 'accumulator', stateRequest(2)).promise, project);
    const earlier = valid(await runtime.submit(project, 'accumulator', stateRequest(0.5)).promise, project);
    assert.equal(earlier.value.data, 2);
    assert.equal(earlier.metadata.runtime.components[0].strategy, 'reset-replay');
    assert.equal(earlier.checkpoints[0].payload.state.steps, 2);
    assert.equal(earlier.checkpoints[0].time.value, 0.5);
    invalid(await runtime.submit(project, 'accumulator', stateRequest(-0.1)).promise, 'TIME_RANGE');
  } finally { await runtime.dispose(); }
});

test('off-lattice requests retain requested and achieved times with explicit approximation metadata', async () => {
  const { project } = stochastic();
  const runtime = createRuntime({ registryModule });
  try {
    const result = valid(await runtime.submit(project, 'random', stateRequest(0.6)).promise, project);
    assert.equal(result.request.time.value, 0.6);
    assert.equal(result.metadata.runtime.requestedTime.value, 0.6);
    assert.equal(result.metadata.runtime.achievedTime.value, 0.5);
    assert.equal(result.value.time.value, 0.5);
    assert.equal(result.value.data, -0.9630494660232216);
    assert.equal(result.metadata.sampling.policy, 'at-or-before');
    assert.ok(result.diagnostics.some(item => item.code === 'TIME_APPROXIMATION'));
    assert.ok(result.diagnostics.some(item => item.code === 'SOFTWARE_FIXTURE'));
    assert.ok(result.metadata.approximation.length > 0);
  } finally { await runtime.dispose(); }
});

test('derived snapshots preserve warnings and reject incompatible stateful achieved times', async () => {
  const { project, draft, author } = setup();
  const a = author.instantiate('fixture.seeded-accumulator', { id: 'a' });
  const b = author.instantiate('fixture.seeded-accumulator', { id: 'b' });
  author.arithmetic('subtract', a, b, { id: 'comparison', comparison: { meaning: 'software-state-comparison', reference: null } });
  draft.accept();
  const runtime = createRuntime({ registryModule });
  try {
    const aligned = valid(await runtime.submit(project, 'comparison', { time: time(0.5) }).promise, project);
    assert.equal(aligned.value.data, 0);
    assert.ok(aligned.diagnostics.some(item => item.code === 'SOFTWARE_FIXTURE'));
    assert.ok(aligned.diagnostics.some(item => item.code === 'UNVALIDATED_COMPARISON'));
    assert.equal(aligned.checkpoints.length, 2);
    const mismatch = await runtime.submit(project, 'comparison', { time: time(0.7), settings: { a: { step: 0.25 }, b: { step: 0.2 } } }).promise;
    invalid(mismatch, 'SNAPSHOT_TIME_MISMATCH');
  } finally { await runtime.dispose(); }
});

test('explicit checkpoints can resume after reopening the same content with fresh mutation identity', async () => {
  const { binding, project } = deterministic();
  const runtime = createRuntime({ registryModule });
  try {
    const first = valid(await runtime.submit(project, 'accumulator', stateRequest(1)).promise, project);
    const saved = JSON.parse(JSON.stringify(project.snapshot()));
    const reopened = Project.from(saved, { validators: binding.validators });
    assert.notEqual(reopened.token.generation, project.token.generation);
    const resumed = valid(await runtime.submit(reopened, 'accumulator', stateRequest(2, { checkpoints: first.checkpoints })).promise, reopened);
    assert.equal(resumed.value.data, 5);
    assert.equal(resumed.metadata.runtime.components[0].strategy, 'checkpoint');
    assert.deepEqual(first.checkpoints[0].identity, project.token);
    assert.deepEqual(resumed.checkpoints[0].identity, reopened.token);
  } finally { await runtime.dispose(); }
});

test('changed transitive inputs or numerical settings invalidate explicit checkpoints', async () => {
  const { project } = deterministic();
  const runtime = createRuntime({ registryModule });
  try {
    const saved = valid(await runtime.submit(project, 'accumulator', stateRequest(1)).promise, project);
    invalid(await runtime.submit(project, 'accumulator', stateRequest(2, { settings: { accumulator: { step: 0.5 } }, checkpoints: saved.checkpoints })).promise, 'CHECKPOINT_INCOMPATIBLE');
    const withSettings = valid(await runtime.submit(project, 'accumulator', stateRequest(2, { settings: { accumulator: { step: 0.5 } } })).promise, project);
    assert.equal(withSettings.value.data, 5);
    assert.equal(withSettings.metadata.runtime.components[0].strategy, 'initialize');
    const edit = project.begin();
    edit.get('rate').set({ data: { value: rateValue(4) } });
    edit.accept();
    invalid(await runtime.submit(project, 'accumulator', stateRequest(2, { checkpoints: saved.checkpoints })).promise, 'CHECKPOINT_INCOMPATIBLE');
    const fresh = valid(await runtime.submit(project, 'accumulator', stateRequest(2)).promise, project);
    assert.equal(fresh.value.data, 9);
    assert.notEqual(fresh.metadata.runtime.inputIdentity, saved.metadata.runtime.inputIdentity);
  } finally { await runtime.dispose(); }
});

test('checkpoint project and implementation identities cannot be silently substituted', async () => {
  const { project } = deterministic();
  const runtime = createRuntime({ registryModule });
  try {
    const saved = valid(await runtime.submit(project, 'accumulator', stateRequest(1)).promise, project);
    for (const change of ['project', 'implementation']) {
      const checkpoints = structuredClone(saved.checkpoints);
      if (change === 'project') checkpoints[0].identity.projectId = 'another-creation';
      else checkpoints[0].implementation.build = 'another-build';
      invalid(await runtime.submit(project, 'accumulator', stateRequest(2, { checkpoints })).promise, 'CHECKPOINT_INCOMPATIBLE');
    }
    invalid(await runtime.submit(project, 'accumulator', stateRequest(2, { checkpoints: [...saved.checkpoints, ...saved.checkpoints] })).promise, 'CHECKPOINT_SCHEMA');
  } finally { await runtime.dispose(); }
});

test('presentation frame-rate edits leave trajectories and scientific checkpoint identity unchanged', async () => {
  const { project, draft, author } = setup();
  const source = author.constant(rateValue(2), { id: 'rate' });
  author.instantiate('fixture.accumulator', { id: 'accumulator', parameters: { initial: 1 }, inputs: { source } });
  author.instantiate('test.runtime.display', { id: 'display', parameters: { frameRate: 24 } });
  draft.accept();
  const runtime = createRuntime({ registryModule });
  try {
    const first = valid(await runtime.submit(project, 'accumulator', stateRequest(1)).promise, project);
    const edit = project.begin();
    const display = edit.get('display').value;
    edit.get('display').set({ data: { ...display.data, parameters: { ...display.data.parameters, frameRate: 60 } } });
    edit.accept();
    const result = valid(await runtime.submit(project, 'accumulator', stateRequest(2, { checkpoints: first.checkpoints })).promise, project);
    assert.equal(result.value.data, 5);
    assert.equal(result.metadata.runtime.inputIdentity, first.metadata.runtime.inputIdentity);
    assert.equal(result.metadata.runtime.components[0].strategy, 'checkpoint');
  } finally { await runtime.dispose(); }
});

test('unsupported lifecycle paths and invalid settings produce capability diagnostics', async () => {
  const { project } = stochastic();
  const runtime = createRuntime({ registryModule });
  try {
    invalid(await runtime.submit(project, 'random', { time: time(1), mode: 'analytic' }).promise, 'CAPABILITY_UNSUPPORTED');
    invalid(await runtime.submit(project, 'random', stateRequest(1, { settings: { random: { step: -1 } } })).promise, 'RUNTIME_SETTINGS');
    invalid(await runtime.submit(project, 'random', stateRequest(1, { settings: { absent: {} } })).promise, 'RUNTIME_SETTINGS');
  } finally { await runtime.dispose(); }
});

test('cancelling an entered CPU-bound callback leaves the main event loop responsive', async t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'cosmic-runtime-cancel-'));
  const marker = resolve(directory, 'entered');
  const { project } = cpuProject(marker);
  const runtime = createRuntime({ registryModule, limits: { maxWallMs: 4000 } });
  try {
    const job = runtime.submit(project, 'cpu');
    await waitFor(() => existsSync(marker));
    let mainThreadTicks = 0;
    const ticker = setInterval(() => mainThreadTicks++, 5);
    const pulse = performance.now();
    await delay(25);
    clearInterval(ticker);
    const parentTimerMs = performance.now() - pulse;
    assert.ok(parentTimerMs < 500, 'The worker must not block the caller event loop.');
    assert.ok(mainThreadTicks > 0);
    const cancelled = performance.now();
    job.cancel();
    const result = invalid(await job.promise, 'CANCELLED');
    const latency = performance.now() - cancelled;
    assert.ok(latency < 1000, `Cancellation took ${latency} ms.`);
    assert.equal(job.status, 'cancelled');
    assert.equal(result.identity.projectId, project.token.projectId);
    const termination = performance.now();
    await runtime.dispose();
    const terminationDisposeMs = performance.now() - termination;
    t.diagnostic(JSON.stringify({ mainThreadTicks, parentTimerMs, cancelSettlementMs: latency, terminationDisposeMs }));
  } finally { await runtime.dispose(); rmSync(directory, { recursive: true, force: true }); }
});

test('wall-clock deadlines terminate a CPU-bound worker with a visible diagnostic', async t => {
  const { project } = cpuProject('');
  const runtime = createRuntime({ registryModule, limits: { maxWallMs: 250 } });
  try {
    const started = performance.now();
    invalid(await runtime.submit(project, 'cpu').promise, 'TIME_BUDGET');
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 2000);
    t.diagnostic(JSON.stringify({ configuredDeadlineMs: 250, observedDeadlineMs: elapsed }));
  } finally { await runtime.dispose(); }
});

test('step/work budgets and non-progressing lifecycle steps fail without valid partial output', async () => {
  const { project } = deterministic();
  for (const [limits, expected] of [[{ maxSteps: 3 }, 'STEP_BUDGET'], [{ maxWork: 1 }, 'WORK_BUDGET']]) {
    const runtime = createRuntime({ registryModule, limits });
    try { invalid(await runtime.submit(project, 'accumulator', stateRequest(2)).promise, expected); }
    finally { await runtime.dispose(); }
  }
  const setupState = setup();
  setupState.author.instantiate('test.runtime.no-progress', { id: 'stalled' });
  setupState.draft.accept();
  const runtime = createRuntime({ registryModule });
  try { invalid(await runtime.submit(setupState.project, 'stalled', stateRequest(1)).promise, 'STATE_PROGRESS'); }
  finally { await runtime.dispose(); }
});

test('state and produced-checkpoint byte budgets reject oversized lifecycle state', async () => {
  const { project, draft, author } = setup();
  author.instantiate('test.runtime.storage', { id: 'storage', parameters: { entries: 128 } });
  draft.accept();
  for (const [limits, expected] of [[{ maxStateBytes: 200 }, 'STATE_BUDGET'], [{ maxCheckpointBytes: 500 }, 'CHECKPOINT_BUDGET']]) {
    const runtime = createRuntime({ registryModule, limits });
    try { invalid(await runtime.submit(project, 'storage', stateRequest(0)).promise, expected); }
    finally { await runtime.dispose(); }
  }
});

test('snapshot-count and result-size budgets apply to complete jobs', async () => {
  const { project, draft, author } = setup();
  const a = author.instantiate('test.runtime.storage', { id: 'a' });
  const b = author.instantiate('test.runtime.storage', { id: 'b' });
  author.arithmetic('add', a, b, { id: 'sum' });
  draft.accept();
  const bounded = createRuntime({ registryModule, limits: { maxSnapshots: 1 } });
  try { invalid(await bounded.submit(project, 'sum', { time: time(0) }).promise, 'SNAPSHOT_BUDGET'); }
  finally { await bounded.dispose(); }
  const smallResult = createRuntime({ registryModule, limits: { maxResultBytes: 700 } });
  try { invalid(await smallResult.submit(project, 'a', stateRequest(0)).promise, 'RESULT_BUDGET'); }
  finally { await smallResult.dispose(); }
});

test('new jobs supersede old CPU work and the replacement still completes', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'cosmic-runtime-replace-'));
  const { project, binding } = cpuProject(resolve(directory, 'entered'));
  const edit = project.begin();
  binding.author(edit).instantiate('test.runtime.inert-text', { id: 'quick' });
  edit.accept();
  const runtime = createRuntime({ registryModule, limits: { maxWallMs: 4000 } });
  try {
    const old = runtime.submit(project, 'cpu');
    await waitFor(() => existsSync(resolve(directory, 'entered')));
    const current = runtime.submit(project, 'quick');
    invalid(await old.promise, 'SUPERSEDED');
    assert.equal(valid(await current.promise, project).value.data, 1);
    assert.notEqual(old.id, current.id);
  } finally { await runtime.dispose(); rmSync(directory, { recursive: true, force: true }); }
});

test('edits, same-content loads and project switches invalidate in-flight work', async () => {
  for (const action of ['edit', 'load', 'switch']) {
    const directory = mkdtempSync(resolve(tmpdir(), 'cosmic-runtime-stale-'));
    const marker = resolve(directory, 'entered');
    const { project, binding } = cpuProject(marker);
    const runtime = createRuntime({ registryModule, limits: { maxWallMs: 4000 } });
    try {
      const job = runtime.submit(project, 'cpu');
      const old = project.token;
      await waitFor(() => existsSync(marker));
      if (action === 'load') project.load(project.snapshot(), project.token);
      else if (action === 'switch') runtime.setProject(new Project({ validators: binding.validators }));
      else {
        const edit = project.begin();
        const node = edit.get('cpu').value;
        edit.get('cpu').set({ data: { ...node.data, parameters: { ...node.data.parameters, durationMs: 10000 } } });
        edit.accept();
      }
      const result = invalid(await job.promise, 'STALE_RESULT');
      assert.deepEqual(result.identity, old);
    } finally { await runtime.dispose(); rmSync(directory, { recursive: true, force: true }); }
  }
});

test('host selection belongs to trusted runtime setup and project source strings stay inert', async () => {
  assert.throws(() => createRuntime({ registryModule: 'https://example.org/unknown.mjs' }));
  const { project, draft, author } = setup();
  author.instantiate('test.runtime.inert-text', { id: 'source', parameters: {
    source: 'throw new Error("Executed project text"); import("file:///unknown-runtime.mjs")',
  } });
  draft.accept();
  const runtime = createRuntime({ registryModule });
  try {
    assert.throws(() => runtime.submit(project, 'source', { registryModule: 'file:///unknown-runtime.mjs' }));
    assert.equal(valid(await runtime.submit(project, 'source').promise, project).value.data, 1);
  } finally { await runtime.dispose(); }
  assert.throws(() => runtime.submit(project, 'source'));
});

test('copied shared layers run an actual stateful worker with only a generated local composition root', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'cosmic-runtime-isolated-'));
  try {
    for (const name of ['core', 'dataflow', 'registry', 'runtime']) {
      cpSync(fileURLToPath(new URL(`../src/${name}`, import.meta.url)), resolve(directory, 'src', name), { recursive: true });
    }
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(resolve(directory, 'host.mjs'), `
      import { ExtensionRegistry } from './src/registry/index.js';
      import { value } from './src/dataflow/index.js';
      const closed = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
      export function createRegistry(){
        const registry=new ExtensionRegistry({capabilities:['runtime.stateful']});
        registry.register({manifest:{
          schemaVersion:1,apiVersion:1,id:'isolated.accumulator',version:'1.0.0',
          implementation:{id:'isolated.accumulator.implementation',version:'1.0.0',build:'isolated-1'},
          kind:'model',parameters:closed({}),dependencies:[],capabilities:['runtime.stateful'],
          ports:{inputs:{},outputs:{value:{kind:'scalar',shape:[],unit:'1',meaning:'test-total',reference:null,frame:null,normalization:null}}},
          documentation:{summary:'Independent worker-only software fixture.',links:[],examples:[{parameters:{}}]},diagnostics:[],
          science:{equations:['x_next=x+2*dt'],references:[{title:'Local fixture',locator:'host.mjs'}],
            assumptions:['Software scheduling fixture.'],applicability:[],evaluation:{mode:'stateful',sampling:['instant']},
            review:{status:'experimental',notes:'Local test only.',evidence:[]}},
          runtime:{paths:['stateful'],settings:closed({step:{type:'number',default:0.25,minimum:0.01}}),
            stateful:{initialTime:{value:0,unit:'s'},sampling:'exact',random:{algorithm:null}}}
        },implementation:{stateful:{
          initialize:()=>({state:{total:0},random:null,time:{value:0,unit:'s'}}),
          advance:({state,time,targetTime,settings})=>{
            const next=Math.min(targetTime.value,time.value+settings.step);
            return{state:{total:state.total+2*(next-time.value)},random:null,time:{value:next,unit:'s'},done:next===targetTime.value};
          },
          extract:({state,time})=>({value:value({kind:'scalar',data:state.total,unit:'1',meaning:'test-total',time})}),
          checkpoint:({state,random,time})=>({state,random,time}),
          restore:({checkpoint})=>checkpoint
        }}});
        return registry;
      }
    `);
    writeFileSync(resolve(directory, 'probe.mjs'), `
      import { Project } from './src/core/index.js';
      import { createRuntime } from './src/runtime/index.js';
      import { createRegistry } from './host.mjs';
      const binding=createRegistry().bind(),project=new Project({validators:binding.validators});
      const draft=project.begin();binding.author(draft).instantiate('isolated.accumulator',{id:'acc'});draft.accept();
      const runtime=createRuntime({registryModule:new URL('./host.mjs',import.meta.url)});
      try{
        const result=await runtime.submit(project,'acc',{time:{value:1,unit:'s'},mode:'stateful'}).promise;
        console.log(JSON.stringify({valid:result.valid,data:result.value?.data,steps:result.metadata.runtime.steps,checkpoints:result.checkpoints.length}));
      }finally{await runtime.dispose();}
    `);
    const result = spawnSync(process.execPath, ['probe.mjs'], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { valid: true, data: 2, steps: 4, checkpoints: 1 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('runtime static imports stay shared and the sole dynamic import uses explicit worker host configuration', () => {
  const sourceRoot = realpathSync(fileURLToPath(new URL('../src', import.meta.url)));
  const permitted = ['core', 'dataflow', 'registry', 'runtime'].map(name => `${resolve(sourceRoot, name)}${sep}`);
  const visited = new Set();
  function inspect(file) {
    const path = realpathSync(file);
    if (visited.has(path)) return;
    visited.add(path);
    assert.ok(permitted.some(prefix => path.startsWith(prefix)), `Runtime imports non-shared source: ${path}`);
    const source = readFileSync(path, 'utf8');
    const imports = /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    for (const match of source.matchAll(imports)) {
      const specifier = match[1] ?? match[2];
      if (specifier.startsWith('node:')) continue;
      assert.ok(specifier.startsWith('.'));
      inspect(resolve(dirname(path), specifier));
    }
    const dynamic = [...source.matchAll(/\bimport\s*\(\s*([^'"\s][^)]*)\)/g)];
    if (dynamic.length) {
      assert.equal(path, resolve(sourceRoot, 'runtime/worker.js'));
      assert.deepEqual(dynamic.map(item => item[1]), ['registryModule']);
      assert.match(source, /registryModule[^\n]*workerData/);
    }
    assert.doesNotMatch(source, /\b(?:require\s*\(|eval\s*\(|new\s+Function\s*\()/);
  }
  for (const name of ['index.js', 'worker.js', 'engine.js']) inspect(resolve(sourceRoot, 'runtime', name));
});

test('fixed-grid analytic results survive display seeks but invalidate on edit, Undo, load and project switch', async () => {
  const { binding, project } = deterministic();
  const edit = project.begin();
  binding.author(edit).sample('accumulator', { times: [0, 1, 2], unit: 's' }, { id: 'history' });
  edit.accept();
  const runtime = createRuntime({ registryModule });
  const read = async (p, t) => valid(await runtime.submit(p, 'history', { time: time(t) }).promise, p);
  try {
    const first = await read(project, 5), warm = await read(project, -10);
    assert.ok(first.metadata.work > 0);
    assert.equal(warm.metadata.work, 0);
    assert.deepEqual(warm.value, first.value);
    assert.equal(warm.request.time.value, -10);
    assert.equal(warm.metadata.runtime.achievedTime.value, -10);
    assert.notEqual(first.metadata.runtime.jobId, warm.metadata.runtime.jobId);
    const revised = project.begin();
    revised.get('rate').set({ data: { value: rateValue(5) } }); revised.accept();
    const edited = await read(project, 5);
    assert.ok(edited.metadata.work > 0);
    assert.deepEqual(edited.value.data, [1, 6, 11]);
    project.undo(project.token);
    assert.ok((await read(project, 5)).metadata.work > 0);
    project.load(project.snapshot(), project.token);
    assert.ok((await read(project, 5)).metadata.work > 0);
    const other = Project.from(project.snapshot(), { validators: binding.validators });
    assert.ok((await read(other, 5)).metadata.work > 0);
  } finally { await runtime.dispose(); }
});

test('an already-running companion can still launch the previous one-shot worker protocol', { timeout: 5000 }, async () => {
  const { project } = deterministic();
  const worker = new Worker(new URL('../src/runtime/worker.js', import.meta.url), {
    execArgv: [], workerData: { graph: project.snapshot(), identity: project.token, registryModule: registryModule.href,
      nodeId: 'accumulator', request: { port: 'value', time: time(2), mode: 'analytic', settings: {} }, cached: [], limits: RUNTIME_LIMITS },
  });
  try {
    const messages = [];
    await new Promise((resolve, reject) => {
      worker.on('message', message => messages.push(message));
      worker.once('error', reject);
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error('Worker exited with ' + code)));
    });
    const results = messages.filter(message => message.kind === 'result');
    assert.equal(results.length, 1);
    assert.equal(results[0].result.valid, true, JSON.stringify(results[0].result.diagnostics));
    assert.deepEqual(results[0].result.identity, project.token);
    assert.equal(results[0].result.value.data, 5);
  } finally { await worker.terminate(); }
});
