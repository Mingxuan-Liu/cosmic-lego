# Implement agent discovery and reliable construction commands

You are implementing task 05 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: 02 through 04, with their creation and mutation operations implemented. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Make the full authoring vocabulary discoverable to a user's own agent. Read src/contract.js, src/server.js, src/sdk.js, scripts/agent.mjs and docs/agent-interface.md. Existing SDK scripts, CLI access, atomic edits and optional revision checks work; extend them rather than building an embedded chatbot.

Publish machine-readable input/output schemas for supported models, operators, views and operations from the same declarations that validation uses. Include units, required reference roles, defaults, applicability limits, explicit eccentricity-edit choices, and working construction examples. Provide stable error codes with affected handles/paths and supported next actions. Distinguish malformed input, unknown capability, missing physics, invalid physical connection, unavailable result and stale revision; an error must not invent a replacement model.

Add a non-mutating transaction preview that reports proposed structural changes, validation findings and derived consequences. A subsequent commit must validate against the expected state again. Use project identity plus revision, or an equivalent epoch/token, so restart or project replacement cannot create accidental revision matches. Adapt current clients to this documented concurrency policy rather than silently losing old calls. Failed or stale edits preserve accepted state. Preserve loopback/origin safeguards and bounded request/evaluation work.

Acceptance:

- A client can discover how to add a differently inclined planet, add/rewire an observer, create the task 03 comparison and arrange task 04 views.
- Preview leaves the live world and persisted data unchanged.
- Two clients preview the same state; after one commits, the other's stale commit cannot overwrite it. A token from another project or invalidated server generation cannot authorize a new edit.
- SDK, CLI and HTTP operations agree on validation and numerical results.
- Discovery accurately reports unsupported density-to-brightness or velocity-to-spectrum connections.
- Submitted source remains inert text. Valid ordinary JavaScript author recipes retain loops/functions and structural freedom.

Update runnable examples and the agent guide, keeping the README a statement of purpose. Do not add model credentials, hosted chat, remote access, MCP, or a second validation implementation here. Task 10 is a separate optional protocol adapter.

Keep this change bounded to task 05. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/05.md`. Do not describe mocked, unrun or planned functionality as implemented.
