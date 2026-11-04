# F11 readiness exercise · Pass through the timing gate

Verified locally on 2026-11-03 (America/Detroit). Three pucks cross the same gate at physical time 2 s. Their distances from its center are 1, 0 and 1 m. Adding a slower fourth puck 2 m from the center must change their mean from ⅔ m to 1 m. This prediction tests whether a structural edit propagates through the scientific collection, visible geometry and bound plot.

Open the [saved four-puck project](evidence/readiness-saved.json) through **Project → Import** in the workspace. To see the annotated sequence, open its timeline and seek to 1.5 presentation seconds. The scientific clock holds at 2 s until 2.5 presentation seconds. For the editable three-puck starting point, use the [independent recipe](../experiments/f11-author.mjs) and its [authoring notes and commands](../experiments/f11-author-notes.md).

## Passed

| Check | Evidence |
| --- | --- |
| Regression suite | All 466 repository tests passed on Node 24.22.1, with zero failures or skips. The native browser journey and cold-reopen export ran separately. |
| Astronomy absent | A new directory outside the checkout contained 80 files. Its 68 JavaScript modules had 267 audited dependency edges. The real registry listed 26 generic extensions. All 17 ESM/CommonJS probes for legacy code or absent packages failed to resolve. The suite also injected forbidden imports and a browser script into disposable copies and verified that the audit rejected them. |
| Independent construction | An author with public guides and discovery only started from an empty F01 project. Loops placed three lanes and sampled fields. Live selection, magnitude, mean, vector subtraction and a signed difference drove the readouts. The author accepted a trial plot, removed it and revised the endpoints of an inspection relationship. Two fresh builds produced the same 46-node baseline graph. |
| Native in-app edit | A click on the middle puck’s plot mark selected scene instance 1, object `puck-mid`. The authenticated Codex app-server received that selection at 2 s. A gateway transaction added just `late-puck`. The collection and stage each grew to four. The plot changed to 1 m. The chat made nine actual semantic calls over the exercise. [Requests, tool arguments, outcomes and measurements](evidence/F11-agent.json) |
| Invalid connection and stale edits | An actual native preview connected a position vector in m to an accumulator requiring a scalar rate in 1/s. It returned `KIND_MISMATCH` without changing the graph. Discovery identifies the input contract for a valid replacement. A separate stale revision and a write carrying the previous load generation both returned `STALE_TOKEN`. |
| Undo, Stop and Redo | Workspace Undo restored the complete three-puck graph and its ⅔ m readout. Stop interrupted an acknowledged third native turn before its requested write was accepted. A host probe explicitly replayed a write through that retired callback and received `TURN_REVOKED`. Redo restored the exact accepted four-puck graph. The probe is identified separately in the tool evidence. |
| Save and cold reopen | Save preserved the timeline, physical time, two field citations and command receipts without the conversation. A new process with an empty home and no provider configuration opened the named file through the Project menu. It had a new generation, empty Undo history, four objects and a 1 m readout. The file stayed byte-identical. |
| Physical clocks and replay | Forward, reverse and repeated seeks agreed with independent point equations and an integer LCG reference. The three analytic points share the requested time with both fields and the measured mean. The stepped accumulator reports its actual sample time separately. Its value, draw count and generator state agreed in the interactive results and frame metadata. |
| Frame and player delivery | A four-second sequence at 4 fps yielded 17 endpoint-inclusive 960 × 540 PNGs with matching sidecar hashes. All 17 scientific samples passed independent numerical checks. Complete scientific Values and configurations agreed exactly between the browser and export at six distinct timestamps. The verifier checked 57 inventory hashes before and after ZIP extraction. From the extracted directory, the player showed 1 m at the hold with zero off-origin browser requests. [Recorded delivery evidence](evidence/F11-delivery.json) |

The launch stages the production host, F04 worker, F05 renderer, F06 shell, F07 gateway, F08 native adapter, F09 portable reader and F10 evaluator. Node’s module parser walks static imports and re-exports. The audit also checks worker entry points, browser import maps and the two reviewed dynamic inputs, the host-supplied registry module and the trusted browser automation driver. Staging rejects ancestor dependency directories that could supply undeclared packages. This checks what the application resolves. Native process permissions and operating-system file access are separate boundaries. [Module edges and per-entry import closures](evidence/F11-boundary.json) · [Staging implementation](../scripts/readiness-workspace.mjs) · [Boundary regressions](../test/readiness-boundary.test.js)

## Numerical and visual evidence

| Presentation s | Physical s | Four-puck mean m | Seeded sample s | Draws |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 2.368033988750 | 0 | 0 |
| 1 | 1.333333333333 | 1.350925212577 | 1.25 | 5 |
| 1.5 | 2 | 1 | 2 | 8 |
| 2.5 | 2 | 1 | 2 | 8 |
| 3.25 | 3 | 1.332106781187 | 3 | 12 |
| 4 | 4 | 1.868033988750 | 4 | 16 |

The delivery oracle uses 1e−12 absolute tolerance for these metre-, second- and unit-scale values. Object IDs, counts, generator state and repeated complete Values compare exactly. From seed 20261103, eight quarter-second advances yield integer state 698001015 and accumulator value 0.910199468024075. A fresh worker resumed the saved four-puck project’s checked 2 s state, advanced eight additional steps to 4 s, and returned state 3698840831 after 16 total draws. The exported samples independently replayed from initialization. At the held time the derived mean minus the measured 1 m lane spacing changes from −⅓ m to zero. Each of 15 scalar field samples has a known lab coordinate, arrival time from 0 to 4 s and corresponding blue-to-gold color. The three arrows represent [1, 0, 0] m/s with authored display scale 0.45.

I inspected the reopened workspace and the exported start, held and end frames. At the hold three coral pucks line up on the cyan gate, the fourth is visibly two grid intervals to the left, and the gold-emphasized readout shows 1 m. At the end the fourth puck has moved one interval to the right while the other three have passed the gate. The caption, field tiles and two readouts were readable at the export resolution. The independent author also inspected a 1280 × 720 capture of the three-puck baseline. Visual inspection used sampled frames. Numeric checks covered every exported frame.

## Failures encountered and resolved

| Owner | Observation and resolution |
| --- | --- |
| Public authoring API | Anonymous plot-source IDs changed between equivalent constructions. The F06 binding API now accepts an authored relationship ID, preserves it on rebind and rejects a conflicting ID before mutation. F07 exposes it in command schemas. F10 accepts it in a bound plot configuration while rejecting implicit IDs. The author removed the lower-level workaround and recovered the identical baseline graph hash. [Workspace guide](planetarium-shell.md) |
| Diagnostic quality | The original native preview named the failing slot and returned a generic kind mismatch. F02 now reports supplied and required quantities and units. The gateway points to inspectable ports and a revised preview. A regression checks the failed connection and previews a compatible scalar producer. The native trace preserves the message seen during the session. |
| Scientific contract | The author initially subtracted a timeless 1 m constant from a time-sampled mean. A real seek returned `TIME_MISMATCH`. Replacing the constant with the measured upper-to-middle lane separation gave both operands the same sampling time. The intentional vector-to-scalar preview was a separate rejection during the native session. |
| Public documentation and author invocation | Field citations required `nodeId`, `source` and `license`. The author corrected the records and a file-URL argument to the Node file reader. The portable guide now shows a complete citation. [Portable format](portable-projects.md) |
| Acceptance harness | The first browser selector targeted a folded inspector and timed out before Connect. The completed run clicked the visible data point in the second plot. [Recorded attempt](evidence/F11-agent.json) |

The saved project embeds the exact source used for the native edit, including the original binding workaround. Its original produced-graph hash begins `5c70f450`. Its edited graph and reconstruction both begin `c5c3014c`. F09 reports the original source as `diverged` after the structural edit. The simplified current recipe still constructs the same original graph. F01 load tokens change across runs, so a newly generated portable file can have a different file digest.

**Outstanding failures** — none in the required F11 journey.

**Unexecuted** — other operating systems, renderers and agent providers, full-motion perceptual review, new domain models and classroom studies. The fixture supports a reuse claim about this construction workflow. Validation of an astronomical model still requires its own equations, validity limits and independent scientific regressions. The exercise collected no learning-outcome data.

## Reproduce

Use the checkout’s pinned Three.js. The verified machine ran macOS 27.0.1 arm64, Node.js 24.22.1, Three.js 0.187.0, Playwright 1.62.1, Chrome 156.0.8078.80 with WebGL 2 / SwiftShader, and the existing local Codex app-server 0.166.0-alpha.5.1 with model `gpt-6-astra`. For browser checks, set `COSMIC_LEGO_PLAYWRIGHT` to the installed Playwright module if it is outside Node resolution, and `COSMIC_LEGO_CHROME` to the Chrome executable when using system Chrome.

The ZIP extraction check also uses the local `zip` and `unzip` commands. Run from the repository root. The first commands use no agent. The saved evidence can be replayed on another checkout without authenticating to a provider.

```sh
bash scripts/node.sh --test
work=$(mktemp -d)
bash scripts/node.sh scripts/readiness-workspace.mjs "$work/application" > "$work/stage.json"
mkdir "$work/slots"
cp docs/evidence/readiness-saved.json "$work/slots/"
bash scripts/node.sh scripts/verify-readiness-delivery.mjs "$work/slots" readiness-saved "$work/result"
```

The result contains the complete audit, verification report, workspace screenshots, PNG sequence with per-frame scientific metadata, and offline player. To view that player, run the following in the same shell and open the printed local URL.

```sh
bash scripts/node.sh "$work/result/player/scripts/timeline-server.mjs" \
  --project "$work/result/player/project.json" --port 0
```

To reproduce the connected part, point `COSMIC_LEGO_CODEX` at an already authenticated, trusted native executable and choose a new output directory. The exercise sends the three requests preserved in the native evidence. If authentication is unavailable, record the connected step as blocked. Its results are separate from the agent-free checks.

```sh
export COSMIC_LEGO_F11_OUTPUT="$work/native"
bash scripts/node.sh scripts/verify-readiness-agent.mjs
bash scripts/node.sh scripts/verify-readiness-delivery.mjs "$work/native/slots" readiness-saved "$work/from-native"
```
