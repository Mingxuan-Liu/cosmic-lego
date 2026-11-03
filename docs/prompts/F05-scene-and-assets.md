# F05 — Implement a domain-neutral 3D scene and asset layer

You are implementing F05 for Cosmic Lego in `/Users/mingxuanliu/Documents/cosmic-lego` or its designated checkout. Read `AGENTS.md`, `README.md`, `docs/infrastructure-roadmap.md`, the current code, and handoffs F01, F02, and F04; inspect F03's registry interfaces through those dependencies. People and their agents must construct an immersive scene from reusable pieces. F06 will provide the full-stage application and floating overlays. No astronomy package is required for this layer; exoplanet migration belongs to F12.

Prerequisites: F01, F02, and F04 integrated and tested. Use their public handles, scientific results, and runtime snapshots. Do not create a renderer-owned physics engine, alternate scene authority, or separate scientific clock.

Implement a presentation scene graph with authorable handles for transforms/groups, cameras, basic geometry, materials, textures/assets, instanced points, polylines, vectors/arrows, and labels. Keep the initial primitive set modest but sufficient for the fixtures below. Supply a renderer adapter interface and one functioning browser 3D implementation with perspective/orthographic projection, depth/occlusion, camera orbit/pan/zoom, object picking, and stable selection IDs. Choose a maintained rendering library only after checking its current primary documentation and license; record the decision without declaring it the permanent project architecture.

Bind scientific outputs to visual properties through explicit transformations and mappings. Retain the source component, quantity, units, frame, coordinate conversion, scale exaggeration, and color-range meaning. Scientific frames and physical viewing models belong to computation; a presentation camera is independent. Moving a camera or changing material brightness must never alter a scientific observable. A glowing material is appearance, not an implemented emission law.

Create stable asset handles and a small resolver for locally supplied geometry, textures, materials, and generated fixture data. Track source/provenance, license, content identity, and dependencies. Distinguish reused geometry from object instances. Define disposal and bounded resource behavior when objects or projects are removed. Unknown assets or unsupported render capabilities require visible diagnostics rather than silent substitutions. Project data must not execute arbitrary shaders, factory source, or downloaded code.

Acceptance:
- Analytic moving-point collections and static scalar/vector-field fixtures render without astronomy modules or domain-name switches.
- Ordinary author code creates, groups, duplicates, binds, and removes visual instances through public handles.
- Camera motion, picking, occlusion, resizing, and selection work in actual browser inspection.
- Unit/frame transformations and color mappings remain inspectable; presentation changes preserve numerical snapshots.
- Reusing geometry avoids needless duplication; removal releases resources without breaking remaining instances.
- Scene/asset definitions round-trip as data and fail clearly for missing resources.

Keep kernel/runtime/renderer/UI free of domain imports; the composition root injects registered visual adapters. Do not build a fixed astronomy dashboard, final floating-panel shell, photorealistic scientific renderer, radiative-transfer engine, or universal asset catalogue. Preserve the exact approved logo and BSD-3-Clause notices.

Deliver code, public authoring examples, meaningful automated checks, and inspected browser states. Write `docs/handoffs/F05.md` with scene/binding/asset contracts, adapter choice, camera/selection behavior, checks, limitations, and interfaces F06, F09, and F10 must use.
