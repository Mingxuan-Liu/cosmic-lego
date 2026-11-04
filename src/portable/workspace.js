import { copyData, fail, isId } from '../core/data.js';
import { fingerprint, seconds } from '../runtime/contracts.js';
import { createCommandGateway } from '../gateway/index.js';
import { createRuntime } from '../runtime/index.js';
import { createPortableManifest, openPortableManifest, portableGraphHash, portableOptions, serializePortableManifest } from './format.js';

const sameToken = (a, b) => a && b && a.projectId === b.projectId && a.generation === b.generation && a.revision === b.revision;
const startTime = { value: 0, unit: 's' };

// F08 accepts arbitrary bounded provider message/call IDs. Normalize any ID
// outside the portable vocabulary without losing its stable association.
const publicId = value => isId(value) ? value : fingerprint(value);

const producerPin = node => fingerprint([node.kind, node.type, node.data.extension ?? null]);
function playbackPins(playback, graph) {
  const ids = new Set([...Object.keys(playback.settings), ...playback.targets.map(target => target.nodeId)]);
  return new Map(graph.nodes.filter(node => ids.has(node.id)).map(node => [node.id, producerPin(node)]));
}
function dataSourcePins(records, graph) {
  const ids = new Set(records.map(record => record.nodeId));
  return new Map(graph.nodes.filter(node => ids.has(node.id)).map(node => [node.id, fingerprint(node)]));
}

// Use the normal gateway renderer and F04 workers in a separate runtime. A
// failed file cannot cancel a running computation in the current project.
async function verifyReplay(context, registryModule, playback, checkCurrent) {
  const runtime = createRuntime({ registryModule });
  let expired = false;
  const timer = setTimeout(() => { expired = true; void runtime.dispose(); }, 30000);
  try {
    const gateway = createCommandGateway({ ...context, runtime });
    const options = { time: playback.time, mode: playback.mode, settings: playback.settings };
    async function run(command, args) {
      checkCurrent();
      const outcome = await gateway.dispatch({ command, args, expected: context.project.token }, gateway.localAuthority);
      checkCurrent();
      if (expired) fail('PROJECT_REPLAY_LIMIT', 'Replaying this project exceeded the 30 second verification budget.');
      if (!outcome.ok) fail(outcome.error.code, `Replay at the saved time failed. ${outcome.error.message}`, { diagnostics: outcome.error.diagnostics });
      return outcome.result;
    }
    const rendered = await run('render', options);
    const samples = new Set(rendered.results.map(result => JSON.stringify([result.producer.nodeId, result.producer.port])));
    for (const { nodeId, port } of playback.targets) {
      if (!samples.has(JSON.stringify([nodeId, port]))) await run('evaluate', { ...options, id: nodeId, port });
    }
  } finally { clearTimeout(timer); await runtime.dispose(); }
}

/** Owns the file association of one active workspace. The accepted graph still
 * belongs to F01 and all authoring still goes through F07. */
export function createPortableWorkspace({ context, registryModule, gateway, agentSession, store, source, dataSources = [], timeline = null, playback = {}, onLoad }) {
  let options = { source, dataSources, timeline, playback: { time: startTime, settings: {}, mode: 'auto', targets: [], ...playback } };
  let name = null, version = null, savedIdentity = null, includeTranscript = false;
  let fileEpoch = 0;
  let publicMessageVersion = 0, savedMessageVersion = 0, receipts = [], busy = false, disposed = false;
  let originalHash = source ? portableGraphHash(source.producedGraph) : null;
  let measured = null, sourceStatus = 'unavailable';
  let savedPins = playbackPins(options.playback, context.project.snapshot()), playbackCache = null;
  let sourcePins = dataSourcePins(dataSources, context.project.snapshot());

  // Match preferences to the saved producer. Removing a model or reusing its
  // ID must not pass its numerical settings to a different F04 computation.
  // Keep the saved baseline so undo can restore the original preferences.
  function livePlayback() {
    const identity = context.project.token;
    if (sameToken(playbackCache?.identity, identity)) return playbackCache.value;
    const live = new Set();
    for (const node of context.project.snapshot().nodes) {
      if (savedPins.has(node.id) && savedPins.get(node.id) === producerPin(node)) live.add(node.id);
    }
    const value = { ...options.playback,
      settings: Object.fromEntries(Object.entries(options.playback.settings).filter(([id]) => live.has(id))),
      targets: options.playback.targets.filter(target => live.has(target.nodeId)) };
    playbackCache = { identity, value };
    return value;
  }

  function checkIdentity(expected) {
    if (disposed || !sameToken(expected, context.project.token)) fail('STALE_TOKEN', 'The workspace changed. Refresh the project before continuing.');
  }
  function status() {
    const identity = context.project.token;
    if (!sameToken(measured, identity)) {
      sourceStatus = originalHash === null ? 'unavailable' : portableGraphHash(context.project.snapshot()) === originalHash ? 'matches' : 'diverged';
      measured = identity;
    }
    const clock = options.timeline?.data?.tracks?.find(track => track.kind === 'physical-time');
    const times = clock?.keys.map(key => key.value) ?? [];
    const timeRange = times.length ? { min: Math.min(...times), max: Math.max(...times) } : null;
    return { identity, name, version, timeRange, dirty: !sameToken(savedIdentity, identity) || (includeTranscript && publicMessageVersion !== savedMessageVersion),
      hasTimeline: options.timeline?.version === 1, includeTranscript, sourceStatus, sourcePath: options.source?.path ?? null, cleanIdentity: savedIdentity,
      playback: { ...copyData(livePlayback()), policy: 'replay-from-initial', time: { value: seconds(options.playback.time), unit: 's' } } };
  }
  function recordReceipt({ command, identity, summary, turnId, callId }) {
    if (!summary?.after || !sameToken(identity, context.project.token) || sameToken(summary.before, summary.after)) return;
    receipts.push(copyData({ command, identity, summary, ...(turnId ? { turnId: publicId(turnId) } : {}), ...(callId ? { callId: publicId(callId) } : {}) }));
    if (receipts.length > 256) receipts.shift();
  }
  const unsubscribe = agentSession.subscribe((_state, event) => {
    if (event?.type === 'delta' || event?.type === 'message') publicMessageVersion++;
    if (event?.type === 'change') recordReceipt(event);
  });

  function currentPlayback(request) {
    if (request.playback !== undefined && request.time !== undefined) fail('PROJECT_REQUEST', 'Supply either a playback record or a physical time.');
    if (request.playback !== undefined) return request.playback;
    const outputs = context.binding.flow.describe(context.project.snapshot()).outputs;
    // Preserve surviving explicit samples as well as all current plot/scene
    // sources. Removing a producer also removes its old run preferences.
    const playback = livePlayback(), targets = new Map();
    for (const target of [...playback.targets, ...context.layer.sources(context.project)]) {
      if (Object.hasOwn(outputs[target.nodeId] ?? {}, target.port)) targets.set(JSON.stringify([target.nodeId, target.port]), target);
    }
    return { ...playback, targets: [...targets.values()], time: request.time ?? playback.time };
  }
  function checkAtStart(request) {
    checkIdentity(request.expected);
    if (request.includeTranscript !== undefined && typeof request.includeTranscript !== 'boolean') fail('PROJECT_REQUEST', 'Transcript inclusion requires an explicit boolean.');
    return context.project.token;
  }
  function makeManifest(request, withMessages) {
    const liveSourcePins = dataSourcePins(options.dataSources, context.project.snapshot());
    return createPortableManifest({ ...context, ...options, timeline: request.timeline === undefined ? options.timeline : request.timeline, playback: currentPlayback(request), includeTranscript: withMessages,
      dataSources: options.dataSources.filter(({ nodeId }) => liveSourcePins.has(nodeId) && liveSourcePins.get(nodeId) === sourcePins.get(nodeId)),
      transcript: withMessages ? agentSession.snapshot().messages.map(({ id, turnId, role, text }) => ({ id: publicId(id), turnId: publicId(turnId), role, text })) : [], includeReceipts: true,
      receipts: withMessages ? receipts : receipts.map(({ turnId, callId, ...receipt }) => receipt) });
  }
  async function capture(request, persist) {
    const accepted = checkAtStart(request);
    const { name: slot, expectedVersion } = request;
    const withMessages = request.includeTranscript === true;
    const messageVersion = publicMessageVersion;
    const guard = () => {
      checkIdentity(accepted);
      if (withMessages && messageVersion !== publicMessageVersion) fail('STALE_TRANSCRIPT', 'Public conversation changed during the save. Retry when the turn is complete.');
    };
    const manifest = makeManifest(request, withMessages);
    guard();
    await verifyReplay(context, registryModule, manifest.playback, guard);
    guard();
    if (!persist) return manifest;
    // Prepare all metadata before publication. The store rechecks both the
    // accepted token and the observed file version immediately before rename.
    const nextPlayback = copyData(manifest.playback);
    const nextPins = playbackPins(nextPlayback, manifest.graph);
    const result = await store.save(slot, serializePortableManifest(manifest), { expectedVersion, beforePublish: guard });
    name = result.name; version = result.version; savedIdentity = accepted;
    includeTranscript = withMessages; savedMessageVersion = messageVersion; options.playback = nextPlayback; options.timeline = manifest.timeline; ++fileEpoch;
    savedPins = nextPins; playbackCache = null;
    return status();
  }
  async function replace(request, fromStore) {
    const accepted = checkAtStart(request);
    const file = fromStore ? await store.read(request.name, { expectedVersion: request.expectedVersion }) : null;
    const opened = openPortableManifest(fromStore ? file.document : request.document, context);
    const nextOptions = portableOptions(opened.manifest);
    const nextPins = playbackPins(nextOptions.playback, opened.manifest.graph);
    const nextSourcePins = dataSourcePins(nextOptions.dataSources, opened.manifest.graph);
    const nextOriginal = nextOptions.source ? portableGraphHash(nextOptions.source.producedGraph) : null;
    const guard = () => checkIdentity(accepted);
    guard();
    await verifyReplay({ ...context, project: opened.project }, registryModule, opened.manifest.playback, guard);
    guard();
    // No await across this transition. Old jobs/grants lose authority before
    // another request can observe the new graph or its archived transcript.
    const disconnected = agentSession.replaceProjectTranscript(opened.manifest.sharing.transcript);
    gateway.setProject(opened.project); context.project = opened.project;
    ++fileEpoch; options = nextOptions; originalHash = nextOriginal; measured = null;
    savedPins = nextPins; playbackCache = null; sourcePins = nextSourcePins;
    name = file?.name ?? null; version = file?.version ?? null; savedIdentity = file ? opened.project.token : null;
    includeTranscript = opened.manifest.sharing.transcriptIncluded;
    publicMessageVersion = 0; savedMessageVersion = 0; receipts = copyData(opened.manifest.sharing.receipts);
    onLoad();
    await disconnected;
    return status();
  }
  async function action(kind, request) {
    if (!['save', 'export', 'open', 'import'].includes(kind)) fail('PROJECT_REQUEST', 'Unknown project file action.');
    if (busy) fail('PROJECT_BUSY', 'Another project file operation is in progress.');
    busy = true;
    try {
      if (kind === 'save' || kind === 'export') return await capture(request, kind === 'save');
      return await replace(request, kind === 'open');
    } finally { busy = false; }
  }
  return Object.freeze({ status, action, recordReceipt, list: () => store.list(),
    timelineSource() {
      if (options.timeline?.version !== 1) return null;
      const { generation, revision } = context.project.token;
      return { key: JSON.stringify([generation, revision, fileEpoch]), manifest: () => makeManifest({}, false) };
    },
    get playback() { return copyData(livePlayback()); },
    dispose() { disposed = true; unsubscribe(); } });
}
