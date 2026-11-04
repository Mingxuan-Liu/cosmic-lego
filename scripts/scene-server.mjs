import http from 'node:http';
import { readFile, realpath, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRuntime } from '../src/runtime/index.js';
import { Project } from '../src/core/index.js';
import { createCommandGateway } from '../src/gateway/index.js';
import { createAgentSession } from '../src/agent-session/index.js';
import { createCodexAdapter } from '../src/agent-session/codex.js';
import { buildExample, registryModule } from '../examples/scene-and-assets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const same = (a, b) => a && b && ['projectId', 'generation', 'revision'].every(key => a[key] === b[key]);
const error = (code, message) => Object.assign(new Error(message), { code });
function keys(data, fields) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !fields.includes(key))) throw error('REQUEST', 'Unsupported request fields.');
}
async function body(request, maximum = 65536) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw error('REQUEST_BUDGET', `Request exceeds ${maximum / 1024} KiB.`);
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
  catch { throw error('REQUEST', 'Expected a UTF-8 JSON request.'); }
}

const canonical = input => JSON.stringify(input, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const legacyKey = input => `legacy-${createHash('sha256').update(canonical(input)).digest('hex')}`;
function gatewayStatus(outcome) {
  if (outcome.ok) return 200;
  if (outcome.error?.category === 'unauthorized') return 403;
  if (outcome.error?.category === 'resource-exhausted') return 429;
  if (['stale-state', 'cancelled'].includes(outcome.error?.category)) return 409;
  const code = outcome.error?.code ?? '';
  if (/STALE|IDEMPOTENCY|CANCELLED|REVOKED/.test(code)) return 409;
  if (/AUTHORITY|AUTHORIZATION|PERMISSION|SESSION|TURN/.test(code)) return 403;
  if (/BUDGET|LIMIT/.test(code)) return 429;
  return 400;
}

// Compatibility syntax only: every mutation is executed by the same gateway.
// Translation produces stable data so a retry has exactly the same fingerprint.
function legacyRequest(context, input, workspace) {
  const base = ['identity', 'idempotencyKey', 'action'];
  const idempotencyKey = input.idempotencyKey ?? legacyKey(input);
  if (['undo', 'redo'].includes(input.action)) {
    keys(input, base);
    return { command: `history.${input.action}`, expected: input.identity, idempotencyKey };
  }
  const actions = {
    'overlay.create': ['kind', 'options', 'source', 'binding'],
    'overlay.bind': ['id', 'source', 'options'],
    'overlay.duplicate': ['id', 'options'],
    'overlay.update': ['id', 'parameters'],
    'overlay.remove': ['id'],
  };
  let command, args;
  if (Object.hasOwn(actions, input.action)) {
    if (!workspace) throw error('EDIT', 'Overlay edits require workspace mode.');
    keys(input, [...base, ...actions[input.action]]);
    command = input.action;
  } else keys(input, [...base, 'id', 'value']);
  if (command === 'overlay.create') {
    if (!['inspector', 'plot', 'provenance', 'conversation'].includes(input.kind)) throw error('EDIT', 'Choose an installed overlay kind.');
    keys(input.options ?? {}, ['id', 'title', 'x', 'y', 'width', 'height', 'folded', 'hidden', 'component']);
    if (input.source !== undefined && (input.kind !== 'plot' || typeof input.source !== 'string')) throw error('EDIT', 'Only a plot can bind a scientific source ID.');
    if (input.binding !== undefined && input.source === undefined) throw error('EDIT', 'Binding options require a scientific source.');
    keys(input.binding ?? {}, ['id', 'port', 'component']);
    args = { kind: input.kind, options: input.options ?? {}, ...(input.source === undefined ? {} : { source: input.source, binding: input.binding ?? {} }) };
  } else if (command === 'overlay.bind') {
    if (typeof input.source !== 'string') throw error('EDIT', 'A scientific source ID is required.');
    keys(input.options ?? {}, ['id', 'port', 'component']);
    args = { target: input.id, source: input.source, options: input.options ?? {} };
  } else if (command === 'overlay.duplicate') {
    keys(input.options ?? {}, ['id', 'title', 'x', 'y', 'width', 'height', 'folded', 'hidden', 'component']);
    args = { id: input.id, options: input.options ?? {} };
  } else if (command === 'overlay.update') {
    keys(input.parameters, ['title', 'x', 'y', 'width', 'height', 'folded', 'hidden', 'component']);
    args = { id: input.id, parameters: input.parameters };
  } else if (command === 'overlay.remove') args = { id: input.id };
  else if (input.action === 'duplicate') { command = 'scene.duplicate'; args = { id: input.id }; }
  else if (input.action === 'remove') {
    // Preserve this old fixture control's drawable-only scope. On a retry with
    // an old token, the gateway first resolves idempotency or rejects staleness.
    if (same(input.identity, context.project.token)) {
      const node = context.project.snapshot().nodes.find(node => node.id === input.id);
      if (node && !['scene.mesh', 'scene.points', 'scene.polyline', 'scene.vectors', 'scene.label'].includes(node.type)) throw error('EDIT', 'Choose a drawable instance to remove.');
    }
    command = 'remove'; args = { id: input.id, cascade: true };
  } else if (input.action === 'marker-scale') {
    if (!Number.isFinite(input.value) || input.value < 0.03 || input.value > 0.3) throw error('EDIT', 'Marker radius must be between 0.03 and 0.3 display units.');
    command = 'update:scene.geometry'; args = { id: 'shared-sphere', parameters: { radius: input.value } };
  } else if (input.action === 'projection') {
    if (!['perspective', 'orthographic'].includes(input.value)) throw error('EDIT', 'Choose a supported projection.');
    command = 'update:scene.camera'; args = { id: input.id ?? 'camera', parameters: { projection: input.value } };
  } else throw error('EDIT', 'Unsupported scene edit.');
  return { command: 'transaction.commit', expected: input.identity, idempotencyKey, args: { operations: [{ command, args }] } };
}

// The local user endpoint owns a host-issued authority; it does not mint agent
// sessions/turns from HTTP labels. Loopback guards are not an OS sandbox.
export async function startSceneServer({ workspace = false, port = workspace ? 4326 : 4325, host = '127.0.0.1',
  codexExecutable, agentWorkspace, agentAdapters = [], projectDirectory, composition, staticAliases = {}, studies = {} } = {}) {
  if (typeof workspace !== 'boolean' || host !== '127.0.0.1' || !Number.isInteger(port) || port < 0 || port > 65535) throw error('SERVER_CONFIG', 'Use a loopback host, boolean workspace mode and valid port.');
  const setup = composition ?? (workspace ? await import('../examples/workspace.mjs') : { buildExample, registryModule });
  const context = await setup.buildExample(), runtime = createRuntime({ registryModule: setup.registryModule });
  if (!workspace) context.project = Project.from(context.project.snapshot(), { validators: context.layer.validators });
  if (projectDirectory !== undefined && (!workspace || typeof projectDirectory !== 'string' || !path.isAbsolute(projectDirectory))) throw error('SERVER_CONFIG', 'Choose an absolute project directory in workspace mode.');
  const directory = projectDirectory ?? path.join(root, '.local/projects');
  let portable, player, handleTimelineRequest;
  const studyPlayers = new Map();
  const gateway = createCommandGateway({ ...context, runtime, getPlaybackDefaults: () => portable?.playback ?? {} });
  const prefix = workspace ? '/api/workspace' : '/api/scene';
  if (!Array.isArray(agentAdapters)) throw error('SERVER_CONFIG', 'Agent adapters are trusted host declarations.');
  if ((codexExecutable !== undefined || agentWorkspace !== undefined || agentAdapters.length) && !workspace) throw error('SERVER_CONFIG', 'Agent sessions require workspace mode.');
  if (agentWorkspace !== undefined && codexExecutable === undefined) throw error('SERVER_CONFIG', 'An authoring workspace requires an explicitly configured Codex executable.');
  const adapters = [...agentAdapters];
  if (codexExecutable !== undefined) {
    if (typeof codexExecutable !== 'string' || !path.isAbsolute(codexExecutable)) throw error('SERVER_CONFIG', 'Configure an absolute Codex executable path at host startup.');
    const authoringWorkspace = agentWorkspace ?? await mkdtemp(path.join(tmpdir(), 'cosmic-lego-authoring-'));
    if (!path.isAbsolute(authoringWorkspace)) throw error('SERVER_CONFIG', 'Use an absolute separate authoring workspace.');
    const resolvedWorkspace = await realpath(authoringWorkspace);
    if (resolvedWorkspace === root || resolvedWorkspace.startsWith(root + path.sep) || root.startsWith(resolvedWorkspace + path.sep) || resolvedWorkspace === path.parse(root).root) throw error('SERVER_CONFIG', 'The agent authoring workspace must be separate from the live repository.');
    adapters.push({ id: 'codex', label: 'Codex · local app-server',
      create: options => createCodexAdapter({ ...options, executable: codexExecutable, workspace: resolvedWorkspace, protectedRoots: [directory] }) });
  }
  let evaluation = 0, lastChange = null, lastDiagnostics = [], observedIdentity = context.project.token;
  const agentSession = createAgentSession({ gateway, adapters, getProjectContext: () => ({ diagnostics: lastDiagnostics }) });
  function recordChange(command, summary) {
    if (same(observedIdentity, context.project.token)) return;
    observedIdentity = context.project.token; ++evaluation;
    lastChange = { identity: context.project.token, command, summary: summary ?? 'Project updated.' };
  }
  const unsubscribeAgent = agentSession.subscribe((_snapshot, event) => {
    if (event?.type === 'change') recordChange(event.command, event.summary);
  });
  if (workspace) {
    const [{ createPortableStore }, { createPortableWorkspace }] = await Promise.all([import('../src/portable/store.js'), import('../src/portable/workspace.js')]);
    const timelineHttp = await import('./timeline-http.mjs');
    handleTimelineRequest = timelineHttp.handleTimelineRequest;
    player = timelineHttp.createTimelineService({ ...context, registryModule: setup.registryModule, getSource: () => portable.timelineSource() });
    // These read-only studies use trusted recipes and their own timeline evaluators.
    // The editing workspace may contain a completely different project.
    for (const [slug, buildManifest] of Object.entries(studies)) {
      const source = { key: slug, manifest: buildManifest };
      studyPlayers.set(slug, timelineHttp.createTimelineService({ ...context, registryModule: setup.registryModule, getSource: () => source }));
    }
    const store = await createPortableStore({ directory });
    let source = context.source ?? null;
    if (!composition) {
      const [entryText, sceneText] = await Promise.all(['workspace.mjs', 'scene-and-assets.mjs'].map(file => readFile(path.join(root, 'examples', file), 'utf8')));
      source = { path: 'examples/workspace.mjs', language: 'javascript', text: entryText, producedGraph: context.project.snapshot(),
        files: [{ path: 'examples/scene-and-assets.mjs', language: 'javascript', text: sceneText }] };
    }
    portable = createPortableWorkspace({ context, registryModule: setup.registryModule, gateway, agentSession, store,
      dataSources: context.dataSources ?? setup.dataSources, source, timeline: context.timeline, playback: context.playback,
      onLoad() { ++evaluation; observedIdentity = context.project.token; lastChange = null; lastDiagnostics = []; } });
  }
  const state = () => ({ graph: context.project.snapshot(), identity: context.project.token,
    discovery: context.registry.discover(), sources: context.layer.sources(context.project), history: context.project.history,
    lastChange, ...(workspace ? { outputs: context.binding.flow.describe(context.project.snapshot()).outputs, portable: portable.status() } : {}) });
  async function dispatch(input) {
    const requestedIdentity = context.project.token;
    const outcome = await gateway.dispatch(input, gateway.localAuthority);
    if (outcome.ok) {
      recordChange(input.command, outcome.summary);
      if (outcome.summary && !outcome.replayed) portable?.recordReceipt(outcome);
    }
    if (input.command === 'render' && same(requestedIdentity, context.project.token)) lastDiagnostics = (outcome.ok ? outcome.result.snapshot.diagnostics : outcome.error.diagnostics ?? [])
      .slice(0, 32).map(item => ({ code: String(item.code ?? 'DIAGNOSTIC').slice(0, 128), message: String(item.message ?? '').slice(0, 1000),
        ...(typeof item.path === 'string' ? { path: item.path.slice(0, 256) } : {}), ...(typeof item.severity === 'string' ? { severity: item.severity.slice(0, 32) } : {}) }));
    return outcome;
  }
  // Keep interactive viewers on the one bounded worker. A fast slider can
  // replace its pending sample without taking a second turn ahead of other tabs.
  const waitingViews = new Map();
  let servingView = false, closing = false;
  async function drainViews() {
    if (servingView) return;
    servingView = true;
    try {
      while (waitingViews.size) {
        const [id, task] = waitingViews.entries().next().value;
        waitingViews.delete(id);
        try { task.resolve(await task.run()); } catch (e) { task.reject(e); }
      }
    } finally { servingView = false; }
  }
  function scheduleView(id, run) {
    if (!id) return run(); // Compatibility clients use latest-request-wins.
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw error('REQUEST', 'Use a valid browser view ID.');
    if (closing) throw error('SUPERSEDED', 'The workspace is closing.');
    const previous = waitingViews.get(id);
    if (previous) previous.reject(error('SUPERSEDED', 'A newer sample from this view is queued.'));
    else if (waitingViews.size >= 16) throw error('VIEW_BUSY', 'The local workspace has 16 waiting views. Retry shortly.');
    return new Promise((resolve, reject) => {
      waitingViews.set(id, { run, resolve, reject });
      void drainViews();
    });
  }
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); };
    const isGatewayRoute = request.url?.split('?')[0].startsWith('/api/gateway');
    const isAgentRoute = request.url?.split('?')[0].startsWith('/api/agent/');
    const isProjectRoute = request.url?.split('?')[0].startsWith('/api/projects/');
    const transportFailure = (status, code, message, category = 'malformed-input') => send(status, isGatewayRoute || isAgentRoute || isProjectRoute ? {
      ok: false, command: null, error: { code, category, message,
        diagnostics: [{ code, path: '$', message, severity: 'error' }], affectedIds: [], paths: ['$'], repairs: [] },
      context: { identity: context.project.token },
    } : { code, message });
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== expectedHost) return transportFailure(403, 'HOST', 'Use this server’s loopback address.', 'unauthorized');
      if (request.headers.origin && request.headers.origin !== `http://${expectedHost}`) return transportFailure(403, 'ORIGIN', 'Cross-origin requests are not supported.', 'unauthorized');
      const url = new URL(request.url, `http://${expectedHost}`);
      const studyRoute = /^\/studies\/([a-z0-9-]+)\/(|api\/timeline(?:\/frame)?)$/.exec(url.pathname);
      if (studyRoute && studyPlayers.has(studyRoute[1])) {
        const playerUrl = new URL(url);
        playerUrl.pathname = studyRoute[2] ? '/' + studyRoute[2] : '/timeline/';
        if (await handleTimelineRequest(request, response, playerUrl, studyPlayers.get(studyRoute[1]))) return;
      }
      if (workspace && await handleTimelineRequest(request, response, url, player)) return;
      if (isProjectRoute) {
        if (!portable) return transportFailure(404, 'NOT_FOUND', 'Project files belong to workspace mode.');
        if (url.search) throw error('PROJECT_REQUEST', 'Project routes do not accept query parameters.');
        const action = url.pathname.slice('/api/projects/'.length);
        if (request.method === 'GET' && action === 'state') return send(200, { ok: true, result: portable.status() });
        if (request.method === 'GET' && action === 'list') return send(200, { ok: true, result: await portable.list() });
        const fields = { save: ['expected', 'name', 'expectedVersion', 'time', 'playback', 'timeline', 'includeTranscript'],
          open: ['expected', 'name', 'expectedVersion'], import: ['expected', 'document'], export: ['expected', 'time', 'playback', 'timeline', 'includeTranscript'] };
        if (!Object.hasOwn(fields, action)) return transportFailure(404, 'NOT_FOUND', 'Unknown project file action.');
        if (request.method !== 'POST') return transportFailure(405, 'METHOD', 'Use POST for project file actions.');
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') return transportFailure(415, 'CONTENT_TYPE', 'Use application/json.');
        const input = await body(request, action === 'import' ? 16 * 1024 * 1024 + 65536 : 65536);
        keys(input, fields[action]);
        if (action === 'import' && (!input.document || typeof input.document !== 'object' || Array.isArray(input.document))) throw error('PROJECT_REQUEST', 'Import a JSON project document.');
        return send(200, { ok: true, result: await portable.action(action, input) });
      }
      if (isAgentRoute) {
        if (!workspace) return transportFailure(404, 'NOT_FOUND', 'Agent sessions require workspace mode.');
        if (request.method === 'GET' && url.pathname === '/api/agent/state') {
          if (url.search) throw error('REQUEST', 'State does not accept query parameters.');
          await agentSession.synchronize(); return send(200, { ok: true, result: agentSession.snapshot() });
        }
        if (request.method === 'GET' && url.pathname === '/api/agent/events') {
          if ([...url.searchParams.keys()].some(key => key !== 'after') || url.searchParams.getAll('after').length > 1) throw error('REQUEST', 'Use one event cursor.');
          const raw = url.searchParams.get('after') ?? '0', after = Number(raw);
          if (!/^\d+$/.test(raw) || !Number.isSafeInteger(after)) throw error('REQUEST', 'Use a nonnegative integer event cursor.');
          await agentSession.synchronize(); return send(200, { ok: true, result: await agentSession.events(after) });
        }
        const methods = new Map([['connect', 'connect'], ['submit', 'submit'], ['stop', 'stop'], ['reply', 'reply'], ['disconnect', 'disconnect']]);
        const action = url.pathname.slice('/api/agent/'.length), method = methods.get(action);
        if (!method || request.method !== 'POST') return transportFailure(method ? 405 : 404, method ? 'METHOD' : 'NOT_FOUND', 'Unsupported agent route.');
        if (url.search) throw error('REQUEST', 'Agent actions do not accept query parameters.');
        if (!request.headers['content-type']?.startsWith('application/json')) return transportFailure(415, 'CONTENT_TYPE', 'Use application/json.');
        const input = await body(request);
        const fields = { connect: ['agentId', 'permissionPolicy'], submit: ['sessionId', 'text', 'context', 'clientRequestId'],
          stop: ['sessionId', 'turnId', 'clientRequestId'], reply: ['requestId', 'answer'], disconnect: [] };
        keys(input, fields[action]);
        if ((action === 'submit' || action === 'stop') && (typeof input.sessionId !== 'string' || !input.sessionId)) throw error('REQUEST', 'Include the session ID observed by this client.');
        if (action === 'submit' && (typeof input.clientRequestId !== 'string' || !input.clientRequestId)) throw error('REQUEST', 'Include a stable client request ID for this submission.');
        if (action === 'stop' && !input.turnId && !input.clientRequestId) throw error('REQUEST', 'Stop requires the observed turn ID or pending client request ID.');
        return send(200, { ok: true, result: await agentSession[method](input) });
      }
      if (request.method === 'GET' && url.pathname === '/api/gateway/state') return send(200, { identity: context.project.token, history: context.project.history, lastChange });
      if (request.method === 'GET' && url.pathname === '/api/gateway/discovery') {
        const outcome = await dispatch({ command: 'discover' }); return send(gatewayStatus(outcome), outcome);
      }
      if (request.method === 'POST' && url.pathname === '/api/gateway') {
        if (!request.headers['content-type']?.startsWith('application/json')) return transportFailure(415, 'CONTENT_TYPE', 'Use application/json.');
        const input = await body(request);
        if (input?.command === 'render') ++evaluation;
        const outcome = await dispatch(input);
        return send(gatewayStatus(outcome), outcome);
      }
      if (request.method === 'GET' && url.pathname === `${prefix}/state`) return send(200, state());
      if (request.method === 'POST' && [`${prefix}/evaluate`, `${prefix}/edit`].includes(url.pathname)) {
        if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { code: 'CONTENT_TYPE', message: 'Use application/json.' });
        const input = await body(request);
        if (url.pathname.endsWith('/evaluate')) {
          keys(input, ['identity', 'time', 'capabilities']);
          const render = async () => {
            if (response.destroyed || closing) throw error('SUPERSEDED', 'This viewer closed.');
            const sequence = ++evaluation;
            const outcome = await dispatch({ command: 'render', expected: input.identity, args: {
              ...(input.time === undefined ? {} : { time: input.time }), ...(input.capabilities === undefined ? {} : { capabilities: input.capabilities }) } });
            if (!outcome.ok) return send(gatewayStatus(outcome), { ...outcome.error, identity: context.project.token, gateway: outcome });
            if (sequence !== evaluation || !same(input.identity, context.project.token)) return send(409, { code: 'STALE_RESULT', message: 'A newer request or edit superseded this snapshot.' });
            return send(200, { identity: outcome.identity, time: outcome.result.snapshot.time, ...outcome.result });
          };
          try { return await scheduleView(workspace && request.headers['x-workspace-view'], render); }
          catch (e) {
            if (e.code === 'SUPERSEDED' || e.code === 'VIEW_BUSY') return send(e.code === 'VIEW_BUSY' ? 429 : 409, { code: e.code, message: e.message });
            throw e;
          }
        }
        const outcome = await dispatch(legacyRequest(context, input, workspace));
        if (!outcome.ok) return send(gatewayStatus(outcome), { ...outcome.error, identity: context.project.token, gateway: outcome });
        const createdId = ['overlay.create', 'overlay.duplicate', 'duplicate'].includes(input.action) ? outcome.result?.operations?.[0]?.result?.id : undefined;
        return send(200, { graph: context.project.snapshot(), identity: context.project.token,
          history: context.project.history, summary: outcome.summary, lastChange, replayed: outcome.replayed ?? false, gateway: outcome,
          ...(createdId ? { createdId } : {}) });
      }
      if (request.method !== 'GET') return transportFailure(405, 'METHOD', 'Method not supported.');
      const aliases = {
        '/': workspace ? 'demo/workspace/index.html' : 'demo/scene/index.html', '/scene/': 'demo/scene/index.html',
        '/scene/app.js': 'demo/scene/app.js', '/scene/style.css': 'demo/scene/style.css',
        '/vendor/three/three.module.js': 'node_modules/three/build/three.module.js',
        '/vendor/three/three.core.js': 'node_modules/three/build/three.core.js',
        '/vendor/three/OrbitControls.js': 'node_modules/three/examples/jsm/controls/OrbitControls.js',
        '/assets/branding/cosmic-lego-galaxy.png': 'assets/branding/cosmic-lego-galaxy.png',
        '/src/scene/three-adapter.js': 'src/scene/three-adapter.js',
        ...(workspace ? {
          '/workspace/': 'demo/workspace/index.html', '/workspace/app.js': 'demo/workspace/app.js', '/workspace/style.css': 'demo/workspace/style.css',
          '/src/workspace/browser.js': 'src/workspace/browser.js', '/src/workspace/session.js': 'src/workspace/session.js',
          '/src/workspace/project-files.js': 'src/workspace/project-files.js',
        } : {}),
        ...staticAliases,
      };
      if (!Object.hasOwn(aliases, url.pathname)) return transportFailure(404, 'NOT_FOUND', 'Unknown local resource.');
      const file = await realpath(path.join(root, aliases[url.pathname]));
      if (!file.startsWith(root + path.sep)) throw error('PATH', 'Resource is outside the application directory.');
      const content = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
      response.end(content);
    } catch (failure) {
      const status = failure.code === 'ENOENT' ? 404 : 400;
      if (isGatewayRoute || isAgentRoute || isProjectRoute) return transportFailure(/BUDGET|LIMIT/.test(failure.code ?? '') ? 429 : /STALE|BUSY|CANCEL|TURN|SESSION|CONFLICT/.test(failure.code ?? '') ? 409 : status,
        failure.code ?? 'REQUEST', failure.message, failure.code === 'REQUEST_BUDGET' ? 'resource-exhausted' : 'malformed-input');
      send(status, { code: failure.code ?? 'SCENE_SERVER', message: failure.message, diagnostics: failure.validation?.errors ?? [] });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, url: `http://${host}:${server.address().port}`, workspace, get project() { return context.project; }, context, gateway, agentSession, portable,
    async close() { closing = true; ++evaluation; portable?.dispose(); await Promise.all([player?.close(), ...[...studyPlayers.values()].map(study => study.close())]); unsubscribeAgent(); await agentSession.dispose(); await runtime.dispose(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}
export function parseSceneFlags(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && !Object.hasOwn(options, 'workspace')) options.workspace = true;
    else if (args[i] === '--port' && !Object.hasOwn(options, 'port') && args[i + 1] !== undefined) options.port = Number(args[++i]);
    else if (args[i] === '--codex' && !Object.hasOwn(options, 'codexExecutable') && args[i + 1] !== undefined) options.codexExecutable = args[++i];
    else if (args[i] === '--agent-workspace' && !Object.hasOwn(options, 'agentWorkspace') && args[i + 1] !== undefined) options.agentWorkspace = args[++i];
    else if (args[i] === '--project-dir' && !Object.hasOwn(options, 'projectDirectory') && args[i + 1] !== undefined) options.projectDirectory = args[++i];
    else throw error('CLI', 'Usage: scene-server.mjs [--workspace] [--port number] [--project-dir /absolute/directory] [--codex /absolute/executable] [--agent-workspace /separate/directory]');
  }
  return options;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseSceneFlags(process.argv.slice(2));
  const app = await startSceneServer(options);
  console.log(`Cosmic Lego ${options.workspace ? 'workspace' : 'scene laboratory'}: ${app.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
