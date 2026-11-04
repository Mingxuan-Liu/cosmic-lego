# Cosmic Lego architecture

The default astronomy application installs the exoplanet package into the same construction graph, worker, renderer and floating workspace used by the generic demonstrations. The timing gate exercises that foundation with astronomy absent. Current execution evidence belongs in the implementation record. [Getting started](getting-started.md) · [Verification](demo-status.md)

## Implemented generic foundation

F01 lives in `src/core/`; see [the public guide](composition-kernel.md) and
[the handoff](handoffs/F01.md). It has no model, renderer, provider, or fixture
imports. The composition root supplies trusted validation functions. Generic
graph data, explicit references and computational dependencies are separate from
the exoplanet scene contract. F02 evaluates calculation definitions in the separate
`src/dataflow/` layer; F05 supplies rendering in `src/scene/` without coupling it
to the kernel or scientific evaluator.

F02 supplies scientific value/port contracts, coordinate-aware arithmetic,
fixed/live selection, field selection, mapping/reduction and a bounded synchronous
evaluator. The composition root injects trusted model and adapter functions; neither
shared layer imports the software fixtures or a domain package. Model ports and
actual outputs both receive validation. A shared result envelope retains full
project/load/revision identity, implementation identity, time, coordinates and
diagnostics. See [the dataflow guide](scientific-dataflow.md) and
[F02 handoff](handoffs/F02.md). F03 now supplies manifests, discovery, exact
version/build pins, parameter schemas and contract tests through `src/registry/`.
Registry bindings capture installed trusted implementations without introducing
imports from shared layers into domain code. Assets/views return validated data
artifacts. Review declarations and executed reference-case evidence remain distinct;
see [the registry guide](extension-registry.md) and [F03 handoff](handoffs/F03.md).
F04 adds analytic/stateful scheduling in `src/runtime/` using the same registry,
scientific Values and graph. A trusted composition-root file constructs the
registry inside each worker; project data cannot select that file. Model-owned
steps, extraction and checkpoint callbacks run with bounded work and disposable
worker isolation. Cancellation and deadlines terminate worker JavaScript, while
identity checks prevent late results from replacing current data. Backward seeks
restore compatible checkpoints or reset/replay forward. See [the runtime guide](computation-runtime.md)
and [F04 handoff](handoffs/F04.md).

F05 uses the same accepted graph for scene handles, asset references, and explicit
scientific-output bindings. `src/scene/` compiles supplied F04 snapshots at a
common physical time, checking identity, port, implementation and sampling context.
It preserves unit/frame transformations, display exaggeration, color ranges,
source provenance and diagnostics. Missing results fail rather than triggering
scientific evaluation during rendering. Local assets retain content hashes and
dependency identities; the Three.js adapter shares and disposes renderer resources.
Three.js 0.187.0 is pinned for this implementation, with its MIT notice retained;
the data/adapter boundary keeps that choice replaceable.

The browser stage supports navigation, projection changes and stable picking.
Its loopback host runs the F04 Node workers; there is no browser scientific-worker
backend. Camera navigation and material appearance remain presentation state.
The [scene guide](scene-and-assets.md), [public recipe](../examples/scene-and-assets.mjs)
and [F05 handoff](handoffs/F05.md) describe the contracts and evidence.

F06 adds `src/workspace/` and `demo/workspace/`: four registered overlay factories,
F01 plot-source relationships, a floating-window manager, and a provider-neutral
conversation UI state boundary. The workspace compiler consumes the same current
F04 results and returns a scene plus overlays. Plots retain source IDs, units,
sampling and physical time; they do not invent time-series history. Layout edits,
duplication, removal and Undo use accepted graph transactions. Selection and
transient camera/session state remain distinct from science. The existing local
server's `--workspace` mode hosts this shell without a second evaluator or renderer.
See [the workspace guide](planetarium-shell.md) and [F06 handoff](handoffs/F06.md).
Its composer connects only when the F08 companion has an explicitly configured runtime.

F07 adds `src/gateway/`, one data-only dispatch boundary shared by the handle SDK,
JSON CLI, loopback HTTP and host-issued turn tools. Registered schemas generate
create/update commands; transactions reuse F01 acceptance with F02–F06 validators.
Complete expected identities prevent stale writes. A bounded memory cache binds
successful retry keys to request content and authority context. Host-issued turns
can be revoked independently of scientific validation; current identity and job
epochs guard asynchronous publication. Existing demo edit routes translate into
this gateway, and the browser refreshes external edits with summaries and Undo.
See [the gateway guide](command-gateway.md) and [F07 handoff](handoffs/F07.md).

F08 adds `src/agent-session/`: a provider-neutral lifecycle bridge, bounded
structured context and a native Codex app-server adapter. The local companion
launches an explicitly configured executable in a separate authoring directory,
verifies its permission controls and exposes one dynamic gateway tool. Opaque
turn grants are revoked before cooperative interruption; stale callbacks cannot
commit. The browser keeps drafts and a visible transcript distinct from provider
thread state. Public text, tools, progress and input/permission requests remain
correlated with turns. Runtime authentication never travels through browser
storage or project data. See [the session guide](in-app-agent-sessions.md) and
[F08 handoff](handoffs/F08.md) for verified capabilities and confinement limits.

F09 stores one versioned JSON manifest per project. It keeps the accepted graph,
registry requirements, source and provenance, public sharing choices and replay
settings. The workspace validates a candidate and samples the requested outputs in
an isolated runtime before it changes the active generation. A switch revokes old
turns and installs a disconnected public transcript. A named save compares both
the accepted revision and the last observed file version before atomic publication.
See the [project-file guide](portable-projects.md) and [F09 handoff](handoffs/F09.md).

F10 samples presentation tracks at requested seconds. A physical-time track
selects the F04 request. Camera, visibility, annotations and panel emphasis act
on detached presentation data. The F07 command catalogue and F01 validators
build isolated configuration graphs at labeled boundaries. F09 pins those
graphs and all required implementation builds, including ones introduced only
by later events. The interactive player and PNG exporter both request a frame
from the same evaluator and draw it through the same F05 adapter. See the
[timeline guide](authored-timelines.md) and [F10 handoff](handoffs/F10.md).

## The optional exoplanet application

`apps/exoplanet.mjs` composes the shared server with the recipe and trusted `packages/exoplanet/registry.js`. The worker receives its registry from that trusted entry point. The application registers primary, orbit, observer, projection, photometry and silhouette factories, together with the common scene and workspace factories. The generic host can still construct, save and play the independent timing gate with no astronomy installed. [Registered studies](exoplanet-authoring.md) · [Generic gate](domain-independent-readiness.md)

A fixed primary supplies GM and radius to each independent orbit. The package graph guard checks primary ownership, stellar clearance and the 1% summed-mass limit across the accepted construction. The photometer pairs selected position and radius rows by object ID before combining their foreground silhouettes. Its observable is the uncovered fraction of a uniformly bright spherical star. Individual depths are separately available for comparing a deliberately naive sum. One numerical module serves the registered models and the old `World` import path. [Model contracts](../packages/exoplanet/models.js) · [Physics and reference cases](physics.md)

The primary-facing camera and the physical observer are different objects. The projection model emits sky-plane coordinates and signed line-of-sight distance in metres. A package asset factory constructs sphere geometry from the current physical radius. Positions and radii share a display scale, and an orthographic view along the observer’s sightline shows the projected size ratios. Rotating the camera leaves the observer’s normalized flux unchanged. Current flux and either sampled curve read the same accepted scientific graph.

F12 exercised shared capabilities that also apply to other subjects. A registered graph-level check can validate cross-component constraints at acceptance. An analytic scalar can be sampled at explicit physical coordinates through F02. Series plots carry the abscissa’s actual values and unit through the workspace and player. The workspace, player and exporter take their registry and original recipe context from a trusted host composition. A packaged player carries its declared runtime modules. Astronomy selects the law, observing schedule and installed package. Scientific graph definitions remain portable data.

## Authoring and compatibility

Agents discover installed components at the F07 gateway and commit reversible graph edits with a full identity token and idempotency key. F08 connects a configured local Codex process through revocable turn permissions. The renderer, workers and offline player can run without that process. [Agent surface](agent-interface.md) · [Conversation](in-app-agent-sessions.md)

The first pair-based prototype and the subsequent v0.2 `World` experiment preceded these interfaces. The legacy SDK still constructs, evaluates and samples existing World programs. The explicit importer validates the old schema, preserves supplied source as inert text, and constructs new components, curves and presentation tracks. It reports camera, marker-scale, sample-budget and other translation limits with the archive. [Importer](exoplanet-authoring.md#import-a-v02-world)

## What the checks establish

The generic acceptance exercise covers constructing an unfamiliar graph, a real in-app structural edit, saving, reopening, and delivering a timeline. The astronomy checks additionally exercise Kepler motion, both eccentricity-hold conventions, foreground ordering, overlapping disks, matched live memberships and source-preserving migration. Numerical agreement describes the stated model. A teaching claim would require separate evidence from learners. [Independent timing gate](domain-independent-readiness.md) · [Current validation record](demo-status.md)

## Working name

**Cosmic Lego**, with repository slug **`cosmic-lego`**, emphasizes assembling
interactive astronomical visualizations from reusable physical building blocks.
This is the project owner's chosen working name. The name does not establish
trademark clearance, package availability, or ownership of a public domain.
