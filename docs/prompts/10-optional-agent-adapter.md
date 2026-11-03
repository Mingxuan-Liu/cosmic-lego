# Implement optional connection to a user-owned agent

You are implementing task 10 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: 07 passed and task 05's discovery/transaction contract stable. This is optional and does not gate a new physical domain. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Add one thin protocol adapter when it provides a useful connection to an actual user-owned agent client. SDK/CLI/HTTP access already works and must remain supported. Read the agent-interface guide and task 05's schemas before choosing the adapter's exact API.

MCP over local standard input/output is the default candidate. Verify current official MCP documentation and a compatible maintained SDK at implementation time; pin the tested dependency/protocol versions. Do not assume every installed client supports the same protocol version. The official starting points are https://modelcontextprotocol.io/docs/learn/architecture and https://modelcontextprotocol.io/docs/sdk.

Expose discovery, scene inspection, transaction preview/commit, evaluation and project save/open by translating the existing public operations. Preserve one authoritative validation path, expected-revision checks, model limits, structured diagnostics and local execution boundaries. Return the scientific context an agent needs: units, assumptions, supported relationships and missing-model errors. Do not add a second physics vocabulary or claim that protocol compatibility establishes scientific correctness.

Use a bounded project location for file operations. Keep arbitrary source execution in the user's authoring process, not the adapter. Do not request or store model-provider credentials. Choose an actually available client for the smoke test; if none is configured, deliver a tested protocol harness and clearly distinguish it from a real-client test.

Acceptance:

- Discover tools through the adapter and create a structural change, derived comparison and view binding.
- Preview is non-mutating; commit against the wrong revision fails without data loss.
- Numeric results and validation diagnostics agree with SDK/CLI use.
- A malformed or unsupported operation returns actionable structured information.
- Playback and project reopening remain usable with the adapter stopped.

Deliver a runnable local adapter, exact tested client setup instructions, example interaction and recorded limitations. No remote hosting, account creation, browser-based chatbot, vendor-specific intelligence layer, or automatic support claims for untested clients. Suggested seam: scripts/mcp.mjs plus an adapter module. Keep this task separate from changes to model contracts.

Keep this change bounded to task 10. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/10.md`. Do not describe mocked, unrun or planned functionality as implemented.
