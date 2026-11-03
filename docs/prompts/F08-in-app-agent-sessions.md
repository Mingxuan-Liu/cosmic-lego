# F08 — Implement in-app conversation with a user-owned agent

You are implementing F08 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` or its designated checkout. Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, current code, and dependency handoffs F06–F07. The required experience is Copilot-style conversation inside the immersive visualization: a learner asks for a construction or revision, the selected agent acts through validated tools, and the scene responds. An external CLI alone does not satisfy this task.

Prerequisites: F06's application and F07's command gateway integrated and tested. Reuse their scene authority, identity/revision tokens, diagnostics, undo, and turn-revocation hooks. Do not duplicate physics, validation, or project mutation logic.

Implement a provider-neutral session bridge and a local Node companion, with one functioning adapter. Choose an installed ACP-compatible runtime or native Codex app-server after checking installed-version help and current official documentation; record exact sources and tested versions. [ACP architecture](https://agentclientprotocol.com/get-started/architecture) covers application-to-agent conversation; [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture) covers tools/context. An MCP server alone is not an in-app agent session. [ACP initialization](https://agentclientprotocol.com/protocol/v1/initialization) negotiates capabilities; [ACP transports](https://agentclientprotocol.com/protocol/v1/transports) currently specifies local subprocess stdio. Recheck these evolving contracts when implementing.

Add agent selection/connection, a conversation surface within F06's interface, send/stop controls, and truthful connecting, authentication-needed, ready, working, cancelling, disconnected, and failed states. Normalize session/turn IDs, streamed public text, tool progress/results, input/permission requests, errors, and completion reasons. Show only supported capabilities. Preserve a visible transcript separately from provider-owned resumable session state; do not claim arbitrary ChatGPT-chat import or universal agent compatibility.

Attach bounded structured context: project identity/revision, selected objects, physical/presentation time, relevant views, registered capabilities, assumptions, and diagnostics. Let the agent inspect more through F07. Route mutations through that gateway; authorized reversible operations apply with visible feedback and Undo, without redundant per-edit approval. Translate genuine runtime permission requests according to explicit user settings. Preserve free-form authoring possibilities through installed blocks and public operations.

Stop must revoke the turn's write context, cancel runtime work, and prevent late events or tool results from committing. Acknowledge cooperative-cancellation limits; already committed changes remain visible. Keep credentials in the runtime's supported local authentication mechanism, never browser storage, project documents, transcripts, or logs. Launch only explicitly configured executables with structured arguments.

An external agent may have its own shell/filesystem tools; gateway validation does not magically constrain them. Avoid unrestricted writes to the live repository/project store by using a separate authoring workspace and verified runtime permission controls where supported. Document actual confinement limits. Never automatically execute source received as project data or install a runtime from an untrusted manifest.

Acceptance:
- One real connected agent receives an in-app request, inspects capabilities, creates generic objects/calculations, and updates the visible scene through F07.
- That agent creates a second independently bound plot and removes it using discovered operations, without changes to shell code.
- Deterministic mock tests cover streaming, duplicate events, failed authentication, permission replies, disconnect/reconnect, cancellation, stale contexts, and late-write rejection.
- Browser inspection verifies conversation, scene feedback, Stop, Undo, and keyboard interaction.
- Playback works with the agent disconnected. If no suitable authenticated runtime exists, report the blocked real roundtrip; mocks do not justify a Connected claim.

Preserve branding and BSD notices. No cloud hosting or new provider subscription. Deliver the adapter, UI, tests, reproducible setup instructions, and `docs/handoffs/F08.md` with verified capabilities, authentication boundaries, real versus mock evidence, and remaining blockers.
