# Agent interface v0.1

AstroCompose accepts **scene data**, never executable code in a scene. The same
validator and physics run through the UI, CLI, and local HTTP API. Provider choice
is external to this project. Keep credentials with your chosen agent client.

## Minimal authoring workflow

1. Read `AGENTS.md`, run `node scripts/agent.mjs capabilities`, and inspect
   `scene.schema.json`.
2. Read the current scene (`inspect`) or an example file. Select supported
   parameters and connections; identify any unsupported part of the request.
3. Write a candidate JSON file. Run `validate` and repair explicit errors.
4. Use `evaluate` or `sample` to inspect the predicted measurements.
5. Apply the scene through the running local API, then inspect the rendered output.

For example, give a locally capable agent this instruction:

> Read AstroCompose's AGENTS.md and capabilities. Starting from the current scene,
> add a face-on observer of the same system and a linked view. Preserve the other
> observers. Use the supported scene schema, validate the candidate, inspect its
> flux and stellar RV at a quarter orbit, and apply it with the current revision.
> Do not change the physics implementation. Explain the model's limitations.

This is a useful request because it can be fulfilled by composition alone. A request
for eccentricity, limb darkening, or mutual perturbations must be reported as
unsupported by the current domain contract. Writing a new field will not activate it.

## Command line

Run from the repository root with Node.js 20+. `bash scripts/node.sh` is an optional
runtime-discovery wrapper. All successful machine operations print JSON.

| Command | Result |
| --- | --- |
| `node scripts/agent.mjs capabilities` | Supported model, operations, assumptions and API routes |
| `node scripts/agent.mjs schema` | Complete scene JSON Schema |
| `node scripts/agent.mjs validate scene.json` | `{valid, errors, warnings}`; invalid scene exits 1 |
| `node scripts/agent.mjs evaluate scene.json --time-days 0.75` | Every view's physical state and measurements at the same time |
| `node scripts/agent.mjs sample scene.json --samples 721` | Each view sampled over one of its own periods |
| `node scripts/agent.mjs inspect` | Running demo's `{revision, scene}` |
| `node scripts/agent.mjs apply scene.json --base-revision 3` | Apply if revision 3 is still current |

`inspect` and `apply` accept `--url http://127.0.0.1:4317`; only loopback HTTP is
supported. Read `inspect` immediately before a revision-guarded edit. Omitting
`--base-revision` intentionally allows replacement of the latest scene. Malformed,
duplicate, or unknown flags are errors. Use `-` instead of a file path for stdin.

## Local HTTP

Start `node scripts/serve.mjs`. The listener binds only to `127.0.0.1`.

| Method / path | Request | Response |
| --- | --- | --- |
| `GET /api/capabilities` | — | Capabilities object |
| `GET /api/schema` | — | JSON Schema |
| `GET /api/scene` | — | `{revision, scene}` |
| `POST /api/validate` | `{scene}` | `{valid, errors, warnings}` |
| `POST /api/evaluate` | `{scene, timeDays}` | `{timeDays, views}` |
| `POST /api/sample` | `{scene, samples}` | `{views: [{id, ..., points}]}` |
| `POST /api/scene` | `{scene, baseRevision?}` | Accepted `{revision, scene}` |

POST requests use `Content-Type: application/json`; the body limit is 128 KiB.
Validation failures on evaluation or application return HTTP 422:

```json
{
  "error": "INVALID_SCENE",
  "validation": {
    "valid": false,
    "errors": [{
      "path": "$.systems[0].eccentricity",
      "code": "UNSUPPORTED_FIELD",
      "message": "This field is not supported. Do not silently introduce new physics."
    }],
    "warnings": []
  }
}
```

HTTP 409 indicates a stale revision. Read the updated scene and reconcile the edit.
Rejected requests do not replace the current scene. The browser polls revisions
once per second while visible, preserving unapplied JSON drafts.

The local launcher saves accepted scenes to ignored `.local/live-scene.json`.
`--resume` restores that configuration on launch. Current playback position is
runtime-only. This is a single-user local transport, not a multiuser service.

## What can connect today?

- Local coding agents with file/command access: CLI directly.
- Agents with same-machine HTTP tools: the endpoints above.
- Chat-only assistants: generate JSON, then the human imports/applies it.

No model-provider SDK or account is built in. We tested the file → CLI → HTTP →
browser path with an agent-authored extra observer. We have not tested every
third-party agent client. A cloud-only client cannot directly reach this loopback
server. MCP, public hosting, authentication, and remote bridges are future adapters.

## Trust boundaries

The model implements physical laws; the schema narrows the authoring surface;
domain checks reject known invalid configurations; tests check conditional
correctness; human review checks the explanation. Documentation supplies the LLM
with context, but prompt compliance is not the enforcement mechanism.

The API does not run code from scene JSON. It does not prove the proposed lesson is
true, useful, or complete. New physical couplings require model development and
validation, not a more persuasive prompt.
