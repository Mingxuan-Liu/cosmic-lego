# Scene and assets

F05 adds a domain-independent presentation graph and a working Three.js browser
adapter. Scientific components still belong to the [composition kernel](composition-kernel.md),
[dataflow](scientific-dataflow.md), [registry](extension-registry.md), and
[computation runtime](computation-runtime.md). A scene consumes their results;
rendering and camera navigation do not advance a model or calculate an observable.

The complete runnable recipe is [scene-and-assets.mjs](../examples/scene-and-assets.mjs).
Its trusted [composition root](../examples/fixtures/scene-registry.js) installs
generic moving-point, field, and presentation fixtures. No astronomy package is
loaded. These fixtures demonstrate software contracts, not validated astrophysics.

## Run the example and browser stage

From the repository root, with Node.js 20 or later and pnpm available:

```sh
pnpm install --frozen-lockfile --ignore-scripts
node examples/scene-and-assets.mjs
node scripts/scene-server.mjs --port 4325
```

Open `http://127.0.0.1:4325`. The dependencies are served locally, including
**three 0.187.0**, pinned in `package.json` and `pnpm-lock.yaml`. The browser needs
WebGL2. There is no CDN or account requirement after dependency installation.
On the original workstation, `bash scripts/node.sh` can replace `node`; the
launcher also finds the bundled Node runtime. Stop the server with Ctrl+C.
The implementation was exercised with bundled Node 24.22.1 and pnpm 11.25.0.

The CLI example checks scientific values before and after a visual duplication,
shared assets, duplicated bindings, and project JSON reopening. Tests run with:

```sh
node --test
# Original-workstation launcher:
bash scripts/node.sh --test
```

The loopback server now routes state evaluation and edits through the
[F07 command gateway](command-gateway.md). Existing narrow edit endpoints are
compatibility translations into that authority. It accepts data and checked
commands, with no source execution, module paths, or uploaded factories.
F06 supplies the [planetarium workspace](planetarium-shell.md).

## Author through ordinary project handles

Register `sceneExtensions` and `bindingExtensions` with
`registerSceneExtensions(registry)` before creating the immutable registry
binding. The host must advertise `scene.data`. Then create a scene layer and use
its validators for the project:

```js
import { Project } from './src/core/index.js';
import { createSceneLayer } from './src/scene/index.js';
import { createRegistry } from './examples/fixtures/scene-registry.js';

const registry = createRegistry(); // Trusted host setup; includes scene extensions.
const binding = registry.bind();
const layer = createSceneLayer(binding);
const project = new Project({ validators: layer.validators });
const draft = project.begin();
const science = binding.author(draft);
const scene = layer.author(draft);

const moving = science.instantiate('fixture.moving-point', {
  id: 'moving', parameters: { r0: [0, 0, 0], v: [1, 0, 0] },
});
const geometry = scene.geometry({ id: 'marker-shape', radius: 0.1 });
const material = scene.material({ id: 'marker-paint', color: '#f2c063' });
const group = scene.group({ id: 'markers' });
const marker = scene.mesh({ id: 'marker', parent: group, geometry, material });
scene.bind(marker, moving, {
  property: 'position', port: 'position', unit: 'm', frame: 'lab',
  displayUnit: 'm', displayFrame: 'lab', scale: 1,
});
scene.camera({ id: 'camera', position: [6, 4, 8], target: [0, 0, 0] });
draft.accept();
```

All returned objects are F01 draft handles. There is one accepted graph, one
transaction route, and the usual validation, ownership, Undo, and identity rules.
Use new draft handles for later edits. The renderer's internal Three objects are
not project handles and must not become another authoring authority.

The scene author supports these methods:

| Method | Meaning |
| --- | --- |
| `root({id?})` | Create or retrieve a root group; the implicit ID is `scene-root`. |
| `group(options)`, `camera(options)` | Create a transform group or presentation camera. |
| `geometry(options)`, `material(options)`, `texture(options)` | Create reusable asset handles. |
| `mesh(options)`, `points(options)`, `polyline(options)`, `vectors(options)`, `label(options)` | Create drawable instances. |
| `bind(target, source, options)` | Create an explicit scientific-output mapping. Select the source port through `options.port`. |
| `duplicate(handleOrId, {id?, parent?})` | Copy one scene instance or asset. Instances retain asset references; the layer also copies bindings targeting that instance. It does not recursively copy group children. |
| `update(handleOrId, parameters)` | Merge presentation parameters with the existing parameter object. Asset references are not parameter fields. |
| `reparent(handleOrId, groupOrRoot)` | Change a nonroot instance's parent through graph references. |
| `remove(handleOrId, {cascade?})` | Apply normal F01 removal rules. Referenced assets need dependent removal or an explicit cascade. |

Creation options put `id`, `parent`, `geometry`, `material`, and `texture` handles
beside parameter fields. Parentless instances receive the implicit root.
`scene.update` is a convenience merge; the lower-level F01 `handle.set` still
replaces supplied fields according to its own contract.

## Presentation data and local assets

Instances have `position:[x,y,z]`, `rotation:[x,y,z]` in Euler XYZ radians,
positive `scale:[x,y,z]`, and `visible`. Groups compose these display transforms.
The defaults are zero translation/rotation, unit scale, and visible. They are
display coordinates, not a scientific reference frame or a physical length law.

| Instance | Additional parameters or references |
| --- | --- |
| Camera | `projection:'perspective'|'orthographic'`, `target`, `fov` in degrees, `near`, `far`, `span`. |
| Mesh | `geometry`, `material`. |
| Points | `geometry`, `material`, `positions:[[x,y,z]]`, `objectIds`, optional `colors:[[r,g,b]]` in `[0,1]`. |
| Polyline | `material`, `positions`; consecutive positions form one line. Empty/one-point lines have no visible segment. |
| Vectors | `material`, matching `origins` and `directions`, `objectIds`, optional RGB `colors`, positive `vectorScale`. |
| Label | Plain `text`, six-digit hexadecimal `color`, and `size` in display units. |

Empty `objectIds` generate stable instance IDs from the node ID and row index;
explicit IDs must be distinct and match row counts. Scientific collections keep
their source object IDs; field samples use source ID plus sample index. Reordering
raw rows while relying on generated IDs changes their meaning, so supply stable
IDs when rows identify persistent objects. Empty color arrays use material color.

Geometry primitives are `sphere`, `box`, `plane`, and `triangles`. Parameters
include `radius`, `width`, `height`, `depth`, `segments`, `positions`, and `indices`.
Sphere defaults are radius `0.1` and 16 segments. Triangle geometry requires
complete indexed triangles or nonindexed position triples; `indices:[]` means
nonindexed. Sphere/box/plane primitives provide texture coordinates. Raw triangles
have no UV schema in F05, so applying a texture to them fails explicitly.

Materials contain `color`, `opacity` in `[0,1]`, and `unlit`; supplying a texture
handle selects the textured-material extension. Default material color is
`#e9e5f5`, opacity is 1, and `unlit` is true. Lit materials use a fixed presentation
light rig. Material appearance is not an emission, illumination, or transfer model.

Textures contain `width`, `height`, flat RGBA byte `pixels`, and `colorSpace:'srgb'`.
There are exactly `width × height × 4` bytes. F05 authoring permits at most 32×32
pixels per texture. Data is supplied locally; there is no image-URL loader,
arbitrary shader field, downloaded code, or executable factory in project data.
Labels use canvas text and a sprite texture, never HTML interpretation.

Asset authoring accepts `source` and `license`. Produced asset data retains
`provenance:{source,license}`. The resolver emits:

```text
{ id, kind: 'geometry'|'material'|'texture', contentId,
  data, dependencies: [assetId, ...], provenance }
```

`contentId` is a SHA-256 identity of canonical content and dependency identities.
Material texture references are resolved by content identity. Provenance stays
attached to each asset record but does not prevent identical content from sharing
a renderer resource. An asset handle and a mesh instance are different things:
many instances can reuse one geometry and material.

## Bind scientific results explicitly

Bindings declare their input port contract and mapping. They cannot infer units,
frames, normalization, missing values, or the physical meaning of an arbitrary
array. Current binding input contracts require `normalization:null`.

| `property` | Input | Display output |
| --- | --- | --- |
| `position` | One position vector of shape `[3]`, with source identity as reference | Target instance translation. |
| `positions` | Position collection of shape `[n,3]` | A points node's positions and source IDs. |
| `scalar-field` | Scalar field of shape `[n]` with spatial coordinates | Point positions and colors. |
| `vectors` | Direction-vector field of shape `[n,3]` with spatial coordinates | Arrow origins and directions. |

`position` can target a group, mesh, points, polyline, vectors, or label; cameras
are independent. The remaining collection/field mappings target their matching
points or vectors node. Conflicting bindings that write the same target property
are rejected. A scalar-field mapping owns both positions and colors.

Mapping options retain `unit`, `quantity`, source `frame`, `displayUnit`,
`displayFrame`, rigid `rotation` matrix, `translation`, `translationUnit`, and
positive display `scale`. `positionUnit` specifies the display unit for field
locations. The shared F02 helpers check dimension compatibility and rigid frame
transforms. Positions receive translation; direction vectors receive rotation.

The mapping first transforms the declared scientific frame, then converts the
quantity to `displayUnit`, then multiplies displayed components by `scale`.
Field coordinates are converted separately to `positionUnit`; their displayed
positions also receive `scale`. For a vector field, `scale` affects both displayed
origins and directions. Use the vectors node's `vectorScale` to exaggerate arrow
length alone. Marker radius and node transforms provide additional explicit
presentation changes. None writes back into the source Value.

Scalar fields use `colorRange:[low,high]` in `displayUnit`, with `high > low`.
Available palettes are `blue-gold` and `grayscale`. Out-of-range values clamp to the
range and retain a `COLOR_CLIPPED` warning/count. Null samples fail with
`MISSING_DATA`; they do not become invented zeros.

The declared palette is the mapping's RGB output. Three instance colors multiply
the material color, and lit materials add presentation lighting. Use a **white,
unlit material** when the displayed colors must match the original scientific
palette. Appearance changes do not modify the quantity, color range, or numeric
snapshot. Transparency uses ordinary depth-tested rendering and sorting; complex
overlapping transparent geometry is not a radiative-transfer calculation.

## Compile current runtime results

`layer.sources(project)` lists distinct required `{nodeId,port}` scientific
outputs. Evaluate them with the same physical time and accepted project token.
The example evaluates sequentially because F04's runtime replaces its prior job
when another is submitted:

```js
const time = { value: 2, unit: 's' };
const results = [];
for (const source of layer.sources(project)) {
  const result = await runtime.submit(project, source.nodeId, {
    port: source.port, time,
  }).promise;
  if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
  results.push(result);
}
const snapshot = await layer.compile(project, {
  results, time, capabilities: adapter.capabilities,
});
if (snapshot.valid) adapter.apply(snapshot);
```

The runtime is created with the trusted host registry module, as described in the
[runtime guide](computation-runtime.md). `compile` is asynchronous and returns a
detached, frozen data record:

```text
{ valid, identity: {projectId,generation,revision}, time,
  nodes, assets, bindings, diagnostics }
```

Nodes contain the mapped presentation values. Each binding record retains its
source component/port/implementation and Value descriptor, authored mapping,
sampling metadata, warnings, approximations, and scalar color meaning. Inspect
these records rather than interpreting display coordinates as the original data.

Compilation defaults to physical time `0 s`. It checks source ports, producer
implementations, project identity, current values, and achieved sample times.
Supplied results must match the scene's physical sample coordinate. If a stateful
model reports an earlier `at-or-before` result, choose a common achieved time and
evaluate every input there; the renderer does not interpolate it onto the requested
time. Missing scientific snapshots produce `RESULT_REQUIRED`. Compilation does
not silently recompute them. Token changes during compilation fail as stale.

Scientific envelopes come from the trusted host; these identity/contract checks
are not cryptographic attestation. The browser stage keeps animation/render calls
separate from requested physical coordinates and checks current identity before
showing a result.

## Three browser adapter

`createThreeAdapter({canvas,onSelect?,onCameraChange?,onDiagnostic?,limits?})` lives
in [three-adapter.js](../src/scene/three-adapter.js). The demonstration page supplies
an import map for `three` and `three/addons/controls/OrbitControls.js`, pointing to
the locally installed package. A host using another bundler can resolve those same
bare imports itself.

| Method/property | Contract |
| --- | --- |
| `capabilities` | Data describing supported nodes, projections, local textures, instancing, and picking. Pass it to scene compilation. |
| `apply(snapshot)` | Stage resources and nodes, then swap a valid scene. Returns `{valid,diagnostics}`. Failed preparation retains the previous scene. |
| `render()` | Update navigation damping and draw the latest scene. Call from the host's animation loop. |
| `resize(width,height,pixelRatio?)` | CSS dimensions; updates projection and bounded drawing-buffer size without changing physics. |
| `setCamera(id)` | Activate an authored camera; returns false and a diagnostic if missing. |
| `frameAll()` | Fit the scene bounds with the active camera; returns a success boolean. |
| `pick(xCSS,yCSS)` | Raycast canvas-local CSS coordinates; return `{nodeId,objectId?,instanceIndex?}` or null. |
| `select(selectionOrNull)` | Set the selection highlight and notify `onSelect`. |
| `getCameraState()` | Detached navigation pose/projection/target/zoom/clipping data, or null. |
| `stats()` | Active resources, reference counts, objects, instances, disposal counts, draw calls, and `rendererMemory`. |
| `dispose()` | Release controls, listeners, graph objects, shared resources, renderer, and graphics context. |

Use a CSS-sized canvas, call `resize`, apply a scene with at least one camera, and
call `render` in `requestAnimationFrame`. Left drag orbits, right drag pans, and
wheel/middle drag zooms; touch gestures follow OrbitControls. A click selects
through the adapter's installed pointer listeners. Selection uses raycast depth
and stable source IDs, rather than Three's transient numeric object IDs.

Camera `target` is in world display coordinates and determines orientation.
The look-at orientation supersedes the camera node's Euler rotation. Camera
position inherits parent transforms; the adapter uses that world position and
target with unit navigation-camera scale, so a nonuniform parent scale cannot
distort projection. Other scene nodes retain their Euler rotations. `fov` controls
perspective projection; `span` is the unzoomed orthographic vertical display span.
Near/far clipping remains authored. Navigation and `frameAll` are transient view
state, not graph edits or physical observer motion.

Navigation survives accepted snapshot updates when the authored camera definition
and world transform are unchanged. Changing camera parameters or its parent
transform applies the authored pose again. Project/generation changes clear the
resource namespace and selection. Within one project, selection tracks
`objectId` across collection reorder and clears when the selected object disappears.
Scientific revision tokens still govern whether a compiled snapshot is current.

The adapter shares geometry/material/texture resources by content and dependency
identity. It builds points with `InstancedMesh`; arrows use two instanced meshes
for shafts and tips. Node replacement disposes object/instance allocations while
keeping shared content needed by the new snapshot. Removing the final user releases
the corresponding resources. A changed texture invalidates dependent material
resources. `stats().instances` therefore counts two GPU instances per arrow.
Cache resource counts exclude the fixed selection helper; `rendererMemory`
reports Three's actual allocation counters, not total GPU bytes.

## Bounds, diagnostics, and future interfaces

Default scene-layer bounds are 256 graph nodes, 128 assets, 10,000 display
instances, 4,000,000 serialized asset bytes, and 256 label characters. Schema
bounds also apply: geometry/point/vector rows at most 4,096, primitive sphere
segments 3–64, and local textures at most 32×32. Existing registry, dataflow,
artifact, and runtime budgets continue to apply.

Adapter defaults independently cap nodes at 2,048, assets at 1,024, GPU instances
at 20,000, vertices at 200,000, each texture at 4,194,304 pixels, labels at 256
characters, pixel ratio at 2, and drawing-buffer axes at 8,192 pixels. A host can
configure supported limit fields; increasing renderer limits does not bypass
project schemas or scientific budgets. These are bounded application allocations,
not a guarantee about every browser or GPU's available memory.

Diagnostics are data with a code, path, and message; compilation also includes
severity. Relevant failures include `BINDING_SOURCE`, `BINDING_TARGET`,
`BINDING_CONFLICT`, `UNIT_MISMATCH`, `FRAME_MISMATCH`, `TIME_MISMATCH`,
`STALE_RESULT`, `RESULT_REQUIRED`, `ASSET_MISSING`, and resource budgets. The
adapter reports `MISSING_ASSET`, `MISSING_CAMERA`, `CONTENT_ID_CONFLICT`,
`UNSUPPORTED_CAPABILITY`, and invalid scene data through `onDiagnostic` and failed
`apply` results. WebGL2 initialization failure throws `RENDERER_UNAVAILABLE`;
context loss is reported as `RENDER_CONTEXT_LOST`. No fallback drawing silently
replaces an unsupported asset or capability.

Three.js was selected after checking its current primary documentation and MIT
license on **2026-11-03**. It supplies the working F05 implementation, not a
permanent architecture commitment. See [third-party notices](third-party-notices.md)
for the full notice and documentation links. Browser evidence and current known
limitations belong to the [F05 handoff](handoffs/F05.md).

F06 consumes these scene snapshots and adapter callbacks. F09 preserves graph
definitions, asset provenance, bindings and explicit view state. Reopening
regenerates asset content IDs through F05. See the [project-file guide](portable-projects.md).
F10 should schedule physical
samples through F04 and render those results at its chosen presentation cadence.
F05 does not provide the final floating-panel shell, portable archive, authored
timeline/export scheduler, general asset catalogue, or physical emission renderer.
