# In-app agent sessions

F08 connects the floating Conversation window to a trusted local companion.
The provider-neutral bridge owns session/turn authority; the native Codex
app-server adapter owns protocol translation. Project edits use the F07 gateway,
the existing scientific validators, and ordinary Undo. Playback needs no agent.

## Start the companion

Use an installed, trusted Codex executable with its supported local login already
configured. This feature does not install an agent or collect credentials. From
the repository root:

```sh
# Check your installed executable and authentication locally.
command -v codex
codex --version
codex login status

# Supply the absolute path reported above; no executable is selected by a page.
bash scripts/node.sh scripts/scene-server.mjs --workspace --port 4326 \
  --codex /absolute/path/to/codex
```

Open [the local workspace](http://127.0.0.1:4326/workspace/), choose **Codex · local
app-server**, and click **Connect**. Send a request with **Send** or **Ctrl/Cmd+Enter**.
The connection is ready only after actual authentication and protocol checks.
If authentication is needed, use the runtime's supported login flow in a terminal
and reconnect. Never paste an API key, token, or password into the composer.

Omitting `--codex` leaves the application disconnected with no configured agent.
To choose an existing empty authoring directory outside the repository, add
`--agent-workspace /absolute/separate/directory`. Otherwise the companion creates
a temporary directory under the operating system's temporary directory. It rejects
the live repository, its descendants and ancestors. Runtime paths and additional
adapters are trusted host configuration, never project or browser parameters.

Example requests:

- “Discover the installed blocks. Add three moving points, collect their positions,
  compute their mean distance from the origin, and show the points and a plot.”
- “Add a second plot of the individual distances. Keep the first plot unchanged.”
- “Remove only the second plot.”

Accepted changes appear in the scene, tool feedback and Undo history. **Stop**
revokes the turn before awaiting native interruption; it cancels owned runtime
jobs and rejects late writes/results. Already accepted changes remain visible.
Native interruption is cooperative and cannot undo computation already done by a
remote provider. **Disconnect** closes provider state and keeps the visible
transcript. Reconnect starts a new provider thread; the retained transcript is
not automatically replayed into it. Closing a browser tab detaches that viewer;
other viewers and the companion-owned turn continue. Reopening the page restores
the companion's public transcript, even when the provider is disconnected.
Use Stop or Disconnect to end agent work. To retain these public messages after
closing the companion, opt in to including the conversation when saving or
downloading a project. Opening it displays the archived messages with the agent
disconnected. See the [project-file guide](portable-projects.md).

## Supported adapter and permission boundary

The tested implementation uses native **Codex app-server JSONL over stdio**,
not an MCP server posing as a conversation session. Dynamic tools are an
experimental native API. It provides public text streaming, gateway tool calls,
Stop, runtime input requests, and explicit deny/ask permission handling. It does
not implement provider-thread resume or ChatGPT-chat import. Other adapters can
implement the bridge contract; compatibility is not inferred from an agent name.

The host uses structured subprocess arguments with `shell: false`. It requests
and verifies a separate working directory, read-only sandbox, native network
disabled, no project instruction sources, and disabled shell execution,
connectors, browser/computer tools, image tools, plugins, hooks and subagents.
Inherited MCP entries are explicitly disabled individually because an empty
configuration map alone merges with user configuration in the tested runtime.
The host verifies the effective configuration before creating an agent thread.
The installed build requires its code-mode dispatcher for dynamic tools, so that
dispatcher remains enabled; it is not described as disabling all native code
execution. Shell/unified execution, native network and inherited connectors
remain disabled, and the supplied construction tool is the scoped gateway.

**Connection settings → Native runtime permissions** defaults to **Deny**.
**Ask** displays genuine native requests, but this Codex adapter offers only a
denial for access outside its confined gateway session (`permissionGrants:false`).
It cannot approve native filesystem, shell, connector or network escalation.
Ordinary scene edits need no repeated permission dialog. Nonsecret input
questions can be answered in the conversation; credential requests are rejected.

Read-only mode is not a complete filesystem read boundary. This installed native
protocol does not expose restricted readable roots for its read-only policy.
The separate directory and disabled native tools prevent this adapter from
offering unrestricted repository writes; they do not establish an OS isolation
guarantee against a compromised runtime. The configured executable and locally
installed extensions must be trusted. The loopback server is a local application,
not a multi-user authenticated service.

Credentials stay in the runtime's supported authentication mechanism. The host
uses `account/read` only to determine authentication type/readiness; it does not
export account email, auth files, tokens, raw stderr or private reasoning to the
browser. Native ephemeral threads and UI transcript are separate. Application
code does not store credentials in projects, browser storage or transcripts.
User-written composer content is ordinary visible transcript content, so do not
place secrets there. Provider-managed authentication and diagnostics remain
governed by that installed runtime.

## Bridge and context contracts

`src/agent-session/index.js` exports `createAgentSession({gateway, adapters,
getProjectContext, limits})`. Each trusted adapter declaration has `id`, `label`
and `create({permissionPolicy,dynamicTools})`. An adapter implements:

```js
connect({ onEvent, onTool, onRequest }) // -> providerSessionId, capabilities
startTurn({ turnId, text, context })
cancel(turnId)
respond(requestId, answer)
disconnect()
```

The bridge exposes `snapshot`, `events(afterCursor)`, `subscribe`, `synchronize`,
`connect`, `submit`, `stop`, `reply`, `disconnect` and `dispose`. HTTP routes are
`GET /api/agent/state`, `GET /api/agent/events?after=N`, and POST actions
`connect`, `submit`, `stop`, `reply`, `disconnect`. They share the host's exact
loopback Host/Origin checks, JSON-only bounded requests and error envelopes.
HTTP submissions carry the observed `sessionId` and stable `clientRequestId`.
Stop carries that `sessionId` plus the observed `turnId` or pending
`clientRequestId`; it cannot cancel another turn after reconnect or launch a
delayed submission that was already stopped. These IDs correlate requests;
turn authority stays host-owned. Clients cannot select executable paths, provider configuration, source modules,
tokens or authority. Browser polling recovers from bounded event-log rollover
using canonical snapshots and preserves unsent drafts.

Each turn receives bounded structured data: full identity/revision token,
validated selected IDs/ports, physical time and presentation time, relevant
views, registered capability/command names, used models' assumptions, and recent
diagnostics. Supplied context must match the accepted identity. It contains no
repository source, filesystem paths, credentials or executable code. Selection
and time are turn snapshots; later UI changes do not silently rewrite them.
Further inspection uses the only exposed dynamic tool, `cosmic_command`.

Discovery is derived from the same installed F07 declarations:

```js
{ command: 'discover', args: { detail: 'summary' } }
{ command: 'discover', args: { names: ['inspect', 'transaction.commit'] } }
```

The summary omits bulky schemas/artifacts. Request exact full declarations by
name before authoring; default full discovery remains backward compatible. A
tool result too large for the session returns a structured budget error, never
truncated JSON. The gateway enforces expected identity, idempotency, installed
contracts and atomic validation. The bridge adds opaque session/turn grants,
submit/tool/event deduplication, bounded transcripts and immediate revocation on
Stop, disconnect, failure or project generation change. A revision change during
a turn requires the normal fresh-token/retry workflow, not a new connection.

Public state distinguishes disconnected, connecting, authentication-needed,
ready, working, cancelling and failed. Browser transport failure is separately
shown as companion unavailable. Public messages, compact tool outcomes, progress,
input/permission requests and completion reasons carry correlated session/turn
IDs and cursors. Raw reasoning and large tool payloads are not transcript items.

## Verification and protocol sources

Run deterministic checks with `bash scripts/node.sh --test`. The mock browser
harness needs Playwright and an installed browser. The real harness additionally
requires explicit runtime configuration and uses the existing authenticated
account; it is not part of the offline unit suite:

```sh
COSMIC_LEGO_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs \
COSMIC_LEGO_CHROME=/absolute/path/to/chrome \
bash scripts/node.sh scripts/verify-agent-ui-browser.mjs

COSMIC_LEGO_PLAYWRIGHT=/absolute/path/to/playwright/index.mjs \
COSMIC_LEGO_CHROME=/absolute/path/to/chrome \
COSMIC_LEGO_CODEX=/absolute/path/to/codex \
bash scripts/node.sh scripts/verify-agent-browser.mjs
```

The mock report and screenshots go to ignored `.local/f08-ui-qa/`; the real
evidence goes to `.local/f08-qa/`. The real harness submits
construction requests in the browser, checks visible scientific bindings,
independent plot creation/removal, Undo, keyboard Send, Stop and disconnected
playback. It never substitutes mock success for a real Connected claim.
See [the F08 handoff](handoffs/F08.md) for tested versions and actual results.

Protocol research checked **2026-11-03**, against installed `codex --version`,
`codex app-server --help`, and version-generated TypeScript/JSON schemas:

- [Codex app-server](https://learn.chatgpt.com/docs/app-server): initialization,
  threads, public events, tool calls and turn interruption.
- [Codex authentication](https://learn.chatgpt.com/docs/auth?surface=cli) and
  [approvals/security](https://learn.chatgpt.com/docs/agent-approvals-security):
  runtime authentication ownership and permissions.
- [ACP architecture](https://agentclientprotocol.com/get-started/architecture),
  [v1 initialization](https://agentclientprotocol.com/protocol/v1/initialization),
  [v1 transports](https://agentclientprotocol.com/protocol/v1/transports):
  comparison of conversation protocol and local stdio negotiation. No ACP
  compatibility is claimed for this native adapter.
- [MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture):
  tools/context protocol, distinct from this conversation lifecycle.
