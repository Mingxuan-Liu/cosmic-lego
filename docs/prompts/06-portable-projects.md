# Implement complete project saving and reopening

You are implementing task 06 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` (or its designated checkout). Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, and the actual current code first. The README defines the product: people and their own agents assemble reusable physical objects, relationships, calculations and interactive views. Structural freedom and ordinary author code are essential; JSON is a storage/transport format.

Prerequisites: 01 through 05 integrated. Use their actual model, calculation, view and operation contracts. Inspect their integrated APIs and any `docs/handoffs/NN.md`; those files report implementation outcomes, not authority over the README. If a required interface is missing, report the exact gap rather than recreating another task or hiding it behind stubs.

Save the complete creation rather than only its final physical graph. Read scripts/serve.mjs, src/server.js, src/sdk.js and the current download/reopen behavior. The prototype currently persists scene JSON while original source and session history reset; toScript() produces a flat reconstruction, not the author's original program.

Implement a versioned project document with graph, model/operator versions and implementation/build identities, derived calculations, views, physical conventions, numerical/sampling settings, input provenance, and original author recipe as inert text. Associate original source with the graph hash/revision it produced. Distinguish generated reconstruction code and disclose later graph/source divergence. The accepted graph is playback state; rerunning source is a separate author action. Retain attribution/license information needed for bundled assets. Build hashes detect local changes; they do not certify scientific correctness.

Use a simple local folder/manifest or documented file format. Resolve project resources portably and confine paths to the project. Imports must not execute scripts, install packages, or fetch arbitrary remote resources. Required model implementations come from an explicit trusted runtime; version mismatch and unavailable models need an actionable report. Reserve a versioned extension section for task 08's timeline without inventing its full schema now.

Keep a read-only importer for existing v0.2 scenes. Atomically save the graph, source/provenance and expected-state token together. Project identity plus revision, or an equivalent epoch, must prevent unrelated states matching after restart/replacement. Keep runtime history separate from an authored timeline. Do not bundle secrets or irrelevant machine paths.

Acceptance:

- Save/reopen after a structural edit: original loops/comments survive unchanged, their divergence from the accepted graph is visible, and IDs, calculations, bindings and numerical results survive.
- Import a current example and report any unrecoverable original source honestly.
- Missing assets, unknown model versions, malformed manifests and path escapes leave the current project intact.
- Saved assumptions and sampling warnings remain inspectable. Replace project A with B while an A result is pending; reject that result even if their numeric revisions match. Test pre-restart client tokens as well.
- Source text containing executable-looking code is displayed, never run on load.

This task provides faithful local reopening. Task 09 packages the runtime for another machine and exports frames. No cloud storage, accounts, custom compression format or claim of identical pixels across devices. Suggested seam: src/project/.

Keep this change bounded to task 06. Preserve existing numerical behavior, authoring entry points, atomic publication and camera/observer separation unless a documented migration is necessary. Reuse the current local JavaScript implementation; avoid an unrelated framework rewrite. Preserve BSD-3-Clause notices and the approved logo. No publishing, paid services, embedded LLM or model credentials.

Deliver working code, a public-interface example, meaningful acceptance checks and necessary guide updates. Run applicable existing tests; visually inspect any changed presentation. Record exact interfaces, commands/check results, assumptions, remaining limits and downstream implications in `docs/handoffs/06.md`. Do not describe mocked, unrun or planned functionality as implemented.
