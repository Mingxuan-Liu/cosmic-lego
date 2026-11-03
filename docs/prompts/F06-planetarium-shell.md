# F06 — Implement the planetarium application shell

You are implementing F06 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` or its designated checkout. Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, the current code, and `docs/handoffs/F05.md`, following its prerequisite handoffs. The product is a reusable construction environment for interactive astronomy visualizations. Its shared application must run without any astronomy package. This task builds the immersive workspace, not another exoplanet dashboard.

Prerequisite: F05's real 3D adapter, camera, selection and result bindings work. Use that implementation and its generic fixtures. Do not create a separate visual simulation or select a second renderer. Coordinate interfaces and file ownership with F07 if it runs concurrently. F08 will connect a real agent later; this task owns the conversation surface and its event boundary.

Make the live scene occupy the main viewport. Users can orbit, pan, zoom, select a point/object and recover a useful framing. Selection is an ID-based application state that tools and overlays can consume; it is not inferred from labels or screenshot coordinates. Keep physical observer definitions, if supplied by an extension, separate from presentation cameras. A scene may be spatial, a field representation or a focused measurement view; the shell must not require a central star.

Implement floating overlays for an inspector, at least one linked plot, model/provenance information and a conversation composer. Each overlay can be moved, folded, hidden and restored. Provide a scene-only toggle with an always-recoverable control and keyboard route. Avoid permanent side columns or a grid that shrinks the simulation into one card. An optional pinned analysis layout may be added only after this default works. Text must remain legible against the scene, and hidden overlays must not intercept pointer events.

Expose public handles to create, bind, duplicate, rearrange and remove view/overlay instances through F03/F05's registered capabilities. The initial overlays are examples, not a fixed inventory; F07 must let agents construct additional plots and views without editing shell code. Connect inspector and plot content to real selected components and evaluated values. Precise numerical inputs are secondary editing aids. Define a conversation UI interface for messages, progress, errors, cancellation and selection context; show disconnected status honestly. Do not present scripted replies as a connected agent. Actual providers and sessions belong to F08.

Acceptance:
- Analytic points and a static field use the same shell with no astronomy imports.
- Public operations create a second independently bound plot and remove it without a UI special case; F08 later exercises this through a connected agent.
- Navigation, selection, derived plot and inspector agree on component IDs and physical time.
- Folding all overlays leaves the scene usable; restoration preserves their state.
- Moving/resizing overlays cannot strand their controls outside the viewport.
- Desktop and narrow-screen layouts, keyboard focus, reduced motion, touch/pointer gestures and text readability are inspected in a real browser.
- A hidden composer does not lose its draft; agent-related state can later be injected without replacing the layout.

Preserve the approved logo, BSD-3-Clause notices and existing model checks. Do not implement physical equations, cloud hosting, authentication or a decorative redesign of the whole website. Deliver a working local workspace, meaningful interaction checks and inspected screenshots. Write `docs/handoffs/F06.md` with component/event interfaces, overlay and focus behavior, screenshots/checks, limitations and requirements for F08–F10.
