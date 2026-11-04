# Workspace playback and planetarium HUD

Measured on 2026-11-04 with Node 24.22.1 and Chrome 156, a 1600 × 900 viewport, WebGL 2 and SwiftShader. The measurement counts distinct scientific samples observed in the browser while its Play control is running. Camera repaints are measured separately. Each experiment used a local companion and the existing scientific graph. [Browser benchmark](../scripts/profile-workspace-browser.mjs) · [Backend benchmark](../scripts/benchmark-workspace.mjs)

| Project | Sample window | Delivered samples before → after | Updates/s before → after | Median server wait before → after |
| --- | ---: | ---: | ---: | ---: |
| Three-planet default | 15 s | 6 → 300 | 0.40 → 19.99 | 2,032 → 43 ms |
| Saved four-planet overlap | 15 s | 5 → 215 | 0.33 → 14.32 | 2,860 → 69 ms |
| Imported four-orbit project, including its current HUD edits | 12 s | 2 → 179 | 0.17 → 14.91 | 5,391 → 60 ms |

After restarting port 4317 with the verified current working copy, a second 12 s run on that port delivered 172 samples (14.3 per second), with a median server wait of 62 ms.

The original four-planet tab spent 95.4% of the playback interval showing “Computing”. Transferring the response took about 0.3 ms, and parsing it took about 0.5 ms. Two tabs playing the same graph both delivered zero samples in 12 s, with 177 rejected reads. After the change, they delivered 85 and 83 samples in 12 s with zero conflicts. A browser opening from scratch still had to initialize WebGL and evaluate the original curves. The first scientific display took about 3 s for the default and saved overlap studies and 4.5 s for the imported project on this software renderer.

## Where the time went

- A single default frame asked for 11 scientific outputs. Each request started a new Node worker, installed the registry and validated the same graph. The workspace compiler also repeated graph and port checks while producing each visual asset. The runtime now keeps one configured worker and an execution plan for the current project revision. The compiler prepares the inputs once for a frame.
- Moving the playhead recalculated two complete, fixed 33-point light curves. These curves evaluate a declared sample grid and can be reused while their inputs and settings match. Instantaneous positions and flux still evaluate at the displayed physical time. The cache is bounded. Edits, Undo and project switches change the accepted identity, and stateful timeline frames retain independent replay.
- The gateway intentionally supersedes competing computation requests. Tabs previously used that same latest-request-wins path, repeatedly cancelling each other. Browser readers now take turns on the bounded worker. Each tab can replace its queued scrub position. Acceptance and publication still check the current project identity.
- Playback used to wait a further 120 ms after every response. Analytic playback now follows an elapsed clock with one playback sample in flight per tab, and publishes the visible time with the matching scene. The browser redraws the stage when data, selection, size or camera changes. A paused workspace produced zero WebGL draws over the observed 1.7 s idle window. Fit and orbit still trigger redraws.

On the default graph, the backend-only experiment took 1.83–1.85 s for each successive frame before the revision. Afterward the first frame took about 414 ms, then three successive frames took 23–25 ms. The checksums of the complete scientific values at 0, 60, 120 and 180 physical seconds matched the previous implementation. Differences in host load, viewport and renderer affect the timings. [Runtime lifetime and cache rules](computation-runtime.md)

## Reproduce

Start the exoplanet application on an unused port. Set the Playwright and Chrome environment variables to the installed module and browser paths for the browser benchmark. Use a fresh output label for each measurement.

```sh
bash scripts/node.sh scripts/benchmark-workspace.mjs
bash scripts/node.sh apps/exoplanet.mjs --port 0

# Substitute the printed port. This plays and pauses without editing the graph.
bash scripts/node.sh scripts/profile-workspace-browser.mjs http://127.0.0.1:PORT default 15
bash scripts/node.sh scripts/profile-workspace-browser.mjs http://127.0.0.1:PORT competing 12 --two-tabs
```

The browser benchmark writes a trace, timing summary and screenshots into the ignored local QA directory. The workspace HUD was also checked on 320–1440 px layouts. The full canvas stays the same size when either desktop rail closes. A phone opens one drawer at a time. Inspection, conversation drafts, curve selection, fold/hide/restore, scene-only mode, touch orbit and pinch were exercised in Chromium. [Workspace controls](planetarium-shell.md)
