import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// This module consumes presentation data only. No scientific evaluation or clock
// lives here; render() draws the most recently accepted scene snapshot.
export const THREE_CAPABILITIES = Object.freeze({
  renderer: 'three', version: THREE.REVISION, webgl: 2,
  nodes: Object.freeze(['group', 'camera', 'mesh', 'points', 'polyline', 'vectors', 'label']),
  geometry: Object.freeze(['sphere', 'box', 'plane', 'triangles']),
  projections: Object.freeze(['perspective', 'orthographic']),
  textures: 'local-rgba', picking: true, instancing: true,
});

const DEFAULT_LIMITS = Object.freeze({
  maxNodes: 2048, maxAssets: 1024, maxInstances: 20000,
  maxVertices: 200000, maxTexturePixels: 4194304, maxLabelChars: 256,
  maxPixelRatio: 2, maxDimension: 8192,
});
const serial = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fail = (code, message, path = '') => { throw Object.assign(new Error(message), { code, path }); };
const ensure = (condition, message, path = '') => { if (!condition) fail('INVALID_SCENE', message, path); };
const triple = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const positive = value => Number.isFinite(value) && value > 0;
const color = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const namespace = identity => serial([identity?.projectId ?? null, identity?.generation ?? null]);
const diagnostic = error => ({ code: error.code ?? 'RENDERER_ERROR', path: error.path ?? '', message: error.message });

function checkedLimits(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const [key, value] of Object.entries(limits)) {
    ensure(key in DEFAULT_LIMITS && positive(value), `Invalid renderer limit ${key}.`);
  }
  return limits;
}

function makeGeometry(data, limits) {
  let geometry;
  switch (data.primitive) {
    case 'sphere': {
      const segments = data.segments ?? 24;
      ensure(positive(data.radius ?? 1) && Number.isInteger(segments) && segments >= 3 && segments <= 128,
        'Sphere requires a positive radius and 3–128 segments.');
      geometry = new THREE.SphereGeometry(data.radius ?? 1, segments, Math.max(2, Math.floor(segments / 2)));
      break;
    }
    case 'box':
      ensure([data.width ?? 1, data.height ?? 1, data.depth ?? 1].every(positive), 'Box dimensions must be positive.');
      geometry = new THREE.BoxGeometry(data.width ?? 1, data.height ?? 1, data.depth ?? 1);
      break;
    case 'plane':
      ensure([data.width ?? 1, data.height ?? 1].every(positive), 'Plane dimensions must be positive.');
      geometry = new THREE.PlaneGeometry(data.width ?? 1, data.height ?? 1);
      break;
    case 'triangles': {
      ensure(Array.isArray(data.positions) && data.positions.length > 0 && data.positions.length <= limits.maxVertices && data.positions.every(triple),
        'Triangle geometry requires bounded finite XYZ positions.');
      if (data.indices?.length) ensure(Array.isArray(data.indices) && data.indices.length % 3 === 0 &&
        data.indices.length <= limits.maxVertices * 3 && data.indices.every(i => Number.isInteger(i) && i >= 0 && i < data.positions.length), 'Invalid triangle indices.');
      else ensure(data.positions.length % 3 === 0, 'Unindexed triangles require three vertices per face.');
      geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions.flat(), 3));
      if (data.indices?.length) geometry.setIndex(data.indices);
      geometry.computeVertexNormals();
      break;
    }
    default: fail('UNSUPPORTED_CAPABILITY', `Unsupported geometry primitive ${data.primitive}.`);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** CPU-side scene preparation used by the browser adapter and lifecycle tests.
 * Resources become live only on commit; discard leaves the previous scene intact.
 * Project/generation changes use a new cache namespace. Revisions reuse content.
 */
export function createThreeSceneResources({ limits: options, createCanvas } = {}) {
  const limits = checkedLimits(options);
  let cache = new Map();
  let current = null;
  let disposed = false;
  let pending = false;
  const totals = { disposedGeometries: 0, disposedMaterials: 0, disposedTextures: 0, disposedInstances: 0, disposedObjects: 0 };
  function disposeEntry(entry) {
    entry.resource.dispose();
    totals[{ geometry: 'disposedGeometries', material: 'disposedMaterials', texture: 'disposedTextures' }[entry.kind]]++;
  }
  function disposeObjects(root, extra = []) {
    const objects = new Set(extra); root?.traverse(object => objects.add(object));
    for (const object of objects) {
      object.dispose(); totals.disposedObjects++;
      if (object.isInstancedMesh) totals.disposedInstances += object.count;
    }
  }
  function prepare(snapshot) {
    ensure(!disposed && !pending, 'Renderer resources are disposed or a preparation is pending.');
    ensure(snapshot && Array.isArray(snapshot.nodes) && Array.isArray(snapshot.assets), 'Scene requires node and asset arrays.');
    ensure(snapshot.nodes.length <= limits.maxNodes && snapshot.assets.length <= limits.maxAssets, 'Scene node or asset limit exceeded.');
    const scope = namespace(snapshot.identity);
    const assets = new Map();
    const keys = new Map();
    const used = new Map();
    const created = new Map();
    const root = new THREE.Group();
    const nodes = new Map();
    const cameras = new Map();
    const stagedInstances = new Set();
    let instances = 0;
    const acquire = (kind, key, fingerprint, build) => {
      let entry = cache.get(key) ?? created.get(key);
      if (entry && entry.fingerprint !== fingerprint) fail('CONTENT_ID_CONFLICT', 'One content identity describes different resource data.');
      if (!entry) {
        entry = { kind, key, fingerprint, resource: build(), refs: 0 };
        created.set(key, entry);
      }
      const use = used.get(key) ?? { entry, refs: 0 };
      use.refs++;
      used.set(key, use);
      return entry.resource;
    };
    const assetKey = (id, trail = new Set()) => {
      if (keys.has(id)) return keys.get(id);
      const asset = assets.get(id);
      if (!asset) fail('MISSING_ASSET', `Missing asset ${id}.`);
      if (trail.has(id)) fail('ASSET_CYCLE', `Asset dependency cycle at ${id}.`);
      const next = new Set([...trail, id]);
      const dependencies = [...new Set([...(asset.dependencies ?? []), ...(asset.kind === 'material' && asset.data.texture ? [asset.data.texture] : [])])];
      const key = serial([scope, asset.kind, asset.contentId, dependencies.map(dep => assetKey(dep, next)).sort()]);
      keys.set(id, key);
      return key;
    };
    const getAsset = (id, kind, variant = 'mesh') => {
      const asset = assets.get(id);
      if (!asset) fail('MISSING_ASSET', `Missing ${kind} asset ${id}.`);
      ensure(asset.kind === kind, `Asset ${id} is not ${kind}.`);
      const data = asset.data;
      const key = assetKey(id) + (kind === 'material' ? `:${variant}` : '');
      // Acquire dependencies even when a cached parent resource is reused.
      const map = kind === 'material' && data.texture ? getAsset(data.texture, 'texture') : null;
      for (const dep of asset.dependencies ?? []) if (dep !== data.texture) getAsset(dep, assets.get(dep)?.kind);
      const { provenance: _provenance, ...content } = data;
      if (kind === 'material' && content.texture) content.texture = assetKey(content.texture);
      return acquire(kind, key, serial(content), () => {
        if (kind === 'geometry') return makeGeometry(data, limits);
        if (kind === 'texture') {
          ensure(Number.isInteger(data.width) && Number.isInteger(data.height) && data.width > 0 && data.height > 0 && data.width * data.height <= limits.maxTexturePixels,
            'Texture dimensions exceed the supported pixel bound.');
          ensure(Array.isArray(data.pixels) && data.pixels.length === data.width * data.height * 4 && data.pixels.every(v => Number.isInteger(v) && v >= 0 && v <= 255), 'Texture requires local RGBA byte data.');
          if (data.colorSpace !== 'srgb') fail('UNSUPPORTED_CAPABILITY', 'Only declared sRGB color textures are supported.');
          const texture = new THREE.DataTexture(new Uint8Array(data.pixels), data.width, data.height, THREE.RGBAFormat);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          return texture;
        }
        ensure(color(data.color ?? '#ffffff') && Number.isFinite(data.opacity ?? 1) && (data.opacity ?? 1) >= 0 && (data.opacity ?? 1) <= 1, 'Invalid material color or opacity.');
        const parameters = { color: data.color ?? '#ffffff', opacity: data.opacity ?? 1,
          transparent: (data.opacity ?? 1) < 1, depthWrite: (data.opacity ?? 1) === 1, side: THREE.DoubleSide };
        if (variant === 'line') {
          if (map) fail('UNSUPPORTED_CAPABILITY', 'Polyline materials cannot use a texture.');
          return new THREE.LineBasicMaterial(parameters);
        }
        return data.unlit ? new THREE.MeshBasicMaterial({ ...parameters, map }) : new THREE.MeshStandardMaterial({ ...parameters, map, roughness: 0.72, metalness: 0 });
      });
    };
    const local = (kind, tag, data, build) => acquire(kind, serial([scope, 'generated', kind, tag, data]), serial(data), build);
    const makeInstances = (node, geometry, material, count) => {
      instances += count;
      ensure(instances <= limits.maxInstances, 'Scene instance limit exceeded.');
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      stagedInstances.add(mesh);
      mesh.userData.selectionNode = node.id;
      mesh.userData.objectIds = node.objectIds ?? [];
      return mesh;
    };
    const finishInstances = mesh => {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    };
    try {
      for (const asset of snapshot.assets) {
        ensure(asset && typeof asset.id === 'string' && !assets.has(asset.id) && typeof asset.contentId === 'string' && asset.data && typeof asset.data === 'object', 'Invalid or duplicate scene asset.');
        if (!['geometry', 'material', 'texture'].includes(asset.kind)) fail('UNSUPPORTED_CAPABILITY', `Unsupported asset kind ${asset.kind}.`);
        ensure(asset.dependencies == null || Array.isArray(asset.dependencies) && asset.dependencies.every(dep => typeof dep === 'string'), 'Invalid asset dependencies.');
        assets.set(asset.id, asset);
      }
      for (const id of assets.keys()) assetKey(id);
      for (const node of snapshot.nodes) {
        ensure(node && typeof node.id === 'string' && !nodes.has(node.id), 'Invalid or duplicate scene node.');
        const position = node.position ?? [0, 0, 0], rotation = node.rotation ?? [0, 0, 0], scale = node.scale ?? [1, 1, 1];
        ensure(triple(position) && triple(rotation) && triple(scale) && scale.every(positive), 'Node transforms require finite XYZ and positive scale.', node.id);
        let object;
        switch (node.kind) {
          case 'group': object = new THREE.Group(); break;
          case 'camera': {
            const near = node.near ?? 0.01, far = node.far ?? 10000;
            ensure(positive(near) && positive(far) && far > near && triple(node.target ?? [0, 0, 0]), 'Invalid camera clipping range or target.', node.id);
            if (node.projection === 'perspective') {
              ensure(positive(node.fov ?? 50) && (node.fov ?? 50) <= 179, 'Invalid perspective field of view.', node.id);
              object = new THREE.PerspectiveCamera(node.fov ?? 50, 1, near, far);
            } else if (node.projection === 'orthographic') {
              ensure(positive(node.span ?? 10), 'Invalid orthographic span.', node.id);
              const half = (node.span ?? 10) / 2;
              object = new THREE.OrthographicCamera(-half, half, half, -half, near, far);
              object.userData.span = node.span ?? 10;
            } else fail('UNSUPPORTED_CAPABILITY', `Unsupported projection ${node.projection}.`, node.id);
            cameras.set(node.id, object);
            object.userData.target = [...(node.target ?? [0, 0, 0])];
            break;
          }
          case 'mesh': {
            const geometry = getAsset(node.geometry, 'geometry'), material = getAsset(node.material, 'material');
            if (material.map && !geometry.attributes.uv) fail('UNSUPPORTED_CAPABILITY', 'Textured geometry requires UV coordinates; use a sphere, box or plane primitive.', node.id);
            object = new THREE.Mesh(geometry, material); break;
          }
          case 'points': {
            ensure(Array.isArray(node.positions) && node.positions.every(triple), 'Points require XYZ positions.', node.id);
            ensure(node.objectIds == null || Array.isArray(node.objectIds) && node.objectIds.length === node.positions.length, 'Point object IDs must match positions.', node.id);
            ensure(node.colors == null || Array.isArray(node.colors) && (!node.colors.length || node.colors.length === node.positions.length) && node.colors.every(c => triple(c) && c.every(v => v >= 0 && v <= 1)), 'Point colors must be RGB triples in [0,1].', node.id);
            object = makeInstances(node, getAsset(node.geometry, 'geometry'), getAsset(node.material, 'material'), node.positions.length);
            if (object.material.map && !object.geometry.attributes.uv) fail('UNSUPPORTED_CAPABILITY', 'Textured geometry requires UV coordinates; use a sphere, box or plane primitive.', node.id);
            const matrix = new THREE.Matrix4();
            node.positions.forEach((p, i) => {
              object.setMatrixAt(i, matrix.makeTranslation(...p));
              if (node.colors?.length) object.setColorAt(i, new THREE.Color().setRGB(...node.colors[i], THREE.SRGBColorSpace));
            });
            finishInstances(object);
            break;
          }
          case 'polyline': {
            ensure(Array.isArray(node.positions) && node.positions.length <= limits.maxVertices && node.positions.every(triple), 'Polyline requires bounded XYZ positions.', node.id);
            const geometry = local('geometry', 'polyline', node.positions, () => new THREE.BufferGeometry().setFromPoints(node.positions.map(p => new THREE.Vector3(...p))));
            object = new THREE.Line(geometry, getAsset(node.material, 'material', 'line'));
            break;
          }
          case 'vectors': {
            ensure(Array.isArray(node.origins) && node.origins.every(triple) && Array.isArray(node.directions) && node.directions.length === node.origins.length && node.directions.every(triple) && positive(node.vectorScale ?? 1), 'Vectors require matching XYZ origins/directions and a positive display scale.', node.id);
            ensure(node.objectIds == null || Array.isArray(node.objectIds) && node.objectIds.length === node.origins.length, 'Vector object IDs must match origins.', node.id);
            ensure(node.colors == null || Array.isArray(node.colors) && (!node.colors.length || node.colors.length === node.origins.length) && node.colors.every(c => triple(c) && c.every(v => v >= 0 && v <= 1)), 'Vector colors must be RGB triples in [0,1].', node.id);
            const material = getAsset(node.material, 'material');
            const shaftGeometry = local('geometry', 'arrow-shaft', null, () => new THREE.CylinderGeometry(1, 1, 1, 8));
            const headGeometry = local('geometry', 'arrow-head', null, () => new THREE.ConeGeometry(1, 1, 10));
            object = new THREE.Group();
            const shaft = makeInstances(node, shaftGeometry, material, node.origins.length);
            object.add(shaft);
            const head = makeInstances(node, headGeometry, material, node.origins.length);
            object.add(head);
            const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3(), origin = new THREE.Vector3(), quaternion = new THREE.Quaternion(), matrix = new THREE.Matrix4();
            node.origins.forEach((p, i) => {
              origin.fromArray(p); direction.fromArray(node.directions[i]);
              const length = direction.length() * (node.vectorScale ?? 1);
              if (length > 0) { direction.normalize(); quaternion.setFromUnitVectors(up, direction); } else { direction.copy(up); quaternion.identity(); }
              const tip = Math.min(length * 0.3, 0.3), radius = Math.min(length * 0.035, 0.035);
              matrix.compose(origin.clone().addScaledVector(direction, (length - tip) / 2), quaternion, new THREE.Vector3(radius, Math.max(0, length - tip), radius));
              shaft.setMatrixAt(i, matrix);
              matrix.compose(origin.clone().addScaledVector(direction, length - tip / 2), quaternion, new THREE.Vector3(radius * 2.8, tip, radius * 2.8));
              head.setMatrixAt(i, matrix);
              if (node.colors?.length) {
                const tint = new THREE.Color().setRGB(...node.colors[i], THREE.SRGBColorSpace);
                shaft.setColorAt(i, tint); head.setColorAt(i, tint);
              }
            });
            finishInstances(shaft); finishInstances(head);
            break;
          }
          case 'label': {
            ensure(typeof node.text === 'string' && node.text.length <= limits.maxLabelChars && color(node.color ?? '#ffffff') && positive(node.size ?? 0.3), 'Invalid label text, color or size.', node.id);
            if (!createCanvas) fail('UNSUPPORTED_CAPABILITY', 'Text labels require a local canvas implementation.', node.id);
            const label = { text: node.text, color: node.color ?? '#ffffff' };
            const texture = local('texture', 'label', label, () => {
              const canvas = createCanvas(); const context = canvas.getContext('2d');
              if (!context) fail('UNSUPPORTED_CAPABILITY', 'Canvas text rendering is unavailable.', node.id);
              context.font = '48px sans-serif';
              canvas.width = Math.min(4096, Math.max(16, Math.ceil(context.measureText(node.text).width) + 16)); canvas.height = 64;
              context.font = '48px sans-serif'; context.textBaseline = 'middle'; context.fillStyle = label.color;
              context.fillText(node.text, 8, 32, canvas.width - 16);
              const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace;
              return result;
            });
            const material = local('material', 'label', label, () => new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false }));
            object = new THREE.Group();
            const sprite = new THREE.Sprite(material);
            sprite.scale.set((node.size ?? 0.3) * texture.image.width / texture.image.height, node.size ?? 0.3, 1);
            sprite.userData.selectionNode = node.id;
            object.add(sprite);
            break;
          }
          default: fail('UNSUPPORTED_CAPABILITY', `Unsupported scene node kind ${node.kind}.`, node.id);
        }
        object.name = node.id;
        object.position.fromArray(position); object.rotation.set(...rotation, 'XYZ'); object.scale.fromArray(scale);
        object.visible = node.visible !== false;
        object.userData.selectionNode = node.id;
        object.userData.spec = structuredClone(node);
        nodes.set(node.id, object);
        root.add(object);
      }
      for (const node of snapshot.nodes) {
        if (!node.parent) continue;
        const parent = nodes.get(node.parent);
        ensure(parent && parent.userData.spec.kind === 'group', `Missing or unsupported parent ${node.parent}.`, node.id);
        const trail = new Set([node.id]); let cursor = node.parent;
        while (cursor) { ensure(!trail.has(cursor), 'Scene parent cycle.', node.id); trail.add(cursor); cursor = nodes.get(cursor)?.userData.spec.parent; }
        parent.add(nodes.get(node.id));
      }
      root.updateMatrixWorld(true);
      for (const camera of cameras.values()) camera.lookAt(new THREE.Vector3(...camera.userData.target));
      root.updateMatrixWorld(true);
      pending = true;
      let settled = false;
      const staged = { root, nodes, cameras, identity: structuredClone(snapshot.identity ?? null), instances,
        commit() {
          ensure(!settled, 'Prepared scene already settled.'); settled = true; pending = false;
          disposeObjects(current?.root);
          for (const [key, entry] of cache) if (!used.has(key)) disposeEntry(entry);
          cache = new Map([...used].map(([key, use]) => { use.entry.refs = use.refs; return [key, use.entry]; }));
          current = staged;
          return staged;
        },
        discard() {
          if (settled) return; settled = true; pending = false;
          disposeObjects(root, stagedInstances);
          for (const entry of created.values()) disposeEntry(entry);
        },
      };
      return staged;
    } catch (error) {
      disposeObjects(root, stagedInstances);
      for (const entry of created.values()) disposeEntry(entry);
      throw error;
    }
  }
  return {
    prepare,
    get current() { return current; },
    stats() {
      const entries = [...cache.values()];
      return { geometries: entries.filter(e => e.kind === 'geometry').length,
        materials: entries.filter(e => e.kind === 'material').length,
        textures: entries.filter(e => e.kind === 'texture').length,
        objects: current?.nodes.size ?? 0, instances: current?.instances ?? 0,
        resourceReferences: entries.reduce((sum, entry) => sum + entry.refs, 0), ...totals };
    },
    dispose() {
      if (disposed) return; ensure(!pending, 'Settle the prepared scene before disposal.'); disposed = true;
      disposeObjects(current?.root); for (const entry of cache.values()) disposeEntry(entry);
      cache.clear(); current = null;
    },
  };
}

/** A WebGL2 browser renderer. Coordinates passed to pick are canvas-local CSS pixels. */
export function createThreeAdapter({ canvas, onSelect = () => {}, onCameraChange = () => {}, onDiagnostic = () => {}, limits: options } = {}) {
  const limits = checkedLimits(options);
  ensure(canvas?.addEventListener && canvas?.getBoundingClientRect, 'A browser canvas is required.');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); }
  catch (error) { const issue = { code: 'RENDERER_UNAVAILABLE', path: '', message: `WebGL2 initialization failed: ${error.message}` }; onDiagnostic(issue); throw Object.assign(new Error(issue.message), issue); }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#101423');
  const resources = createThreeSceneResources({ limits, createCanvas: () => canvas.ownerDocument.createElement('canvas') });
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x30364f, 2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5); keyLight.position.set(4, 8, 6); scene.add(keyLight);
  const raycaster = new THREE.Raycaster(); raycaster.params.Line.threshold = 0.08;
  let activeCamera = null, cameraId = null, controls = null, selection = null;
  let width = 1, height = 1, disposed = false, down = null;
  const selectionBox = new THREE.Box3Helper(new THREE.Box3(), 0xf2c063); selectionBox.visible = false; scene.add(selectionBox);
  const emitCamera = () => onCameraChange(getCameraState());
  function projection(camera) {
    if (camera.isPerspectiveCamera) camera.aspect = width / height;
    else { const half = camera.userData.span / 2; camera.left = -half * width / height; camera.right = half * width / height; camera.top = half; camera.bottom = -half; }
    camera.updateProjectionMatrix();
  }
  function getCameraState() {
    if (!activeCamera) return null;
    return { id: cameraId, projection: activeCamera.isPerspectiveCamera ? 'perspective' : 'orthographic',
      position: activeCamera.position.toArray(), target: controls.target.toArray(), zoom: activeCamera.zoom,
      near: activeCamera.near, far: activeCamera.far,
      ...(activeCamera.isPerspectiveCamera ? { fov: activeCamera.fov } : { span: activeCamera.userData.span }) };
  }
  function setCamera(id) {
    const authored = resources.current?.cameras.get(id);
    if (!authored) { const issue = { code: 'MISSING_CAMERA', path: id, message: `Camera ${id} is unavailable.` }; onDiagnostic(issue); return false; }
    controls?.dispose();
    activeCamera?.dispose();
    // OrbitControls expects an unparented camera. Flatten the authored world pose
    // into the adapter's navigation camera; hierarchy remains declarative data.
    activeCamera = authored.clone(); authored.updateWorldMatrix(true, false);
    activeCamera.position.setFromMatrixPosition(authored.matrixWorld);
    activeCamera.scale.set(1, 1, 1);
    activeCamera.lookAt(new THREE.Vector3(...authored.userData.target));
    cameraId = id; projection(activeCamera);
    controls = new OrbitControls(activeCamera, canvas); controls.enableDamping = true;
    controls.target.fromArray(authored.userData.target); controls.addEventListener('change', emitCamera); controls.update(); emitCamera();
    return true;
  }
  function refreshSelection() {
    selectionBox.visible = false;
    const object = selection && resources.current?.nodes.get(selection.nodeId);
    if (!object) return;
    const box = selectionBox.box.makeEmpty();
    if (selection.instanceIndex != null) {
      object.traverse(child => {
        if (!child.isInstancedMesh || selection.instanceIndex >= child.count) return;
        child.geometry.computeBoundingBox();
        const matrix = new THREE.Matrix4(); child.getMatrixAt(selection.instanceIndex, matrix); matrix.premultiply(child.matrixWorld);
        box.union(child.geometry.boundingBox.clone().applyMatrix4(matrix));
      });
    } else box.setFromObject(object);
    selectionBox.visible = !box.isEmpty();
  }
  function select(next) {
    const object = next && resources.current?.nodes.get(next.nodeId);
    selection = object ? structuredClone(next) : null;
    if (selection?.objectId != null) {
      const index = object.userData.spec.objectIds?.indexOf(selection.objectId) ?? -1;
      if (index < 0) selection = null; else selection.instanceIndex = index;
    } else if (selection?.instanceIndex != null && (!Number.isInteger(selection.instanceIndex) || selection.instanceIndex < 0 || selection.instanceIndex >= (object.userData.spec.positions?.length ?? object.userData.spec.origins?.length ?? 0))) selection = null;
    refreshSelection(); onSelect(selection && structuredClone(selection)); return selection && structuredClone(selection);
  }
  function pick(xCSS, yCSS) {
    if (!activeCamera || disposed) return null;
    const rect = canvas.getBoundingClientRect();
    if (!positive(rect.width) || !positive(rect.height)) return null;
    resources.current?.root.updateMatrixWorld(true); activeCamera.updateMatrixWorld(true);
    raycaster.setFromCamera(new THREE.Vector2(xCSS / rect.width * 2 - 1, -yCSS / rect.height * 2 + 1), activeCamera);
    const hits = raycaster.intersectObject(resources.current?.root ?? new THREE.Group(), true);
    for (const hit of hits) {
      let visible = true, ancestor = hit.object;
      while (ancestor) { if (!ancestor.visible) visible = false; ancestor = ancestor.parent; }
      const nodeId = hit.object.userData.selectionNode;
      if (!visible || !nodeId || hit.object.material?.opacity === 0) continue;
      const result = { nodeId };
      if (hit.instanceId != null) {
        result.instanceIndex = hit.instanceId;
        const objectId = hit.object.userData.objectIds?.[hit.instanceId];
        if (objectId != null) result.objectId = objectId;
      }
      return result;
    }
    return null;
  }
  const pointerDown = event => { if (event.button === 0) down = { x: event.clientX, y: event.clientY }; };
  const pointerUp = event => {
    if (event.button === 0 && down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4) {
      const rect = canvas.getBoundingClientRect(); select(pick(event.clientX - rect.left, event.clientY - rect.top));
    }
    down = null;
  };
  const contextLost = event => { event.preventDefault(); onDiagnostic({ code: 'RENDER_CONTEXT_LOST', path: '', message: 'The graphics context was lost. Recreate the renderer to resume.' }); };
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('webglcontextlost', contextLost);
  return {
    capabilities: THREE_CAPABILITIES,
    apply(snapshot) {
      if (disposed) return { valid: false, diagnostics: [{ code: 'RENDERER_DISPOSED', path: '', message: 'Renderer is disposed.' }] };
      let staged;
      try {
        if (snapshot?.valid === false) fail('INVALID_SCENE', 'A failed scene compilation cannot be displayed.');
        staged = resources.prepare(snapshot);
        if (!staged.cameras.size) fail('MISSING_CAMERA', 'The scene requires a presentation camera.');
        const prior = resources.current, oldCamera = getCameraState();
        const keepCamera = prior && namespace(prior.identity) === namespace(staged.identity) && oldCamera &&
          serial(prior.nodes.get(oldCamera.id)?.userData.spec) === serial(staged.nodes.get(oldCamera.id)?.userData.spec) &&
          prior.cameras.get(oldCamera.id)?.matrixWorld.equals(staged.cameras.get(oldCamera.id)?.matrixWorld);
        scene.remove(prior?.root); staged.commit(); scene.add(staged.root);
        setCamera(staged.cameras.has(cameraId) ? cameraId : staged.cameras.keys().next().value);
        if (keepCamera) {
          activeCamera.position.fromArray(oldCamera.position); activeCamera.zoom = oldCamera.zoom;
          if (oldCamera.span != null) activeCamera.userData.span = oldCamera.span;
          controls.target.fromArray(oldCamera.target); projection(activeCamera); controls.update();
        }
        if (selection) select(prior && namespace(prior.identity) === namespace(staged.identity) ? selection : null);
        else refreshSelection();
        return { valid: true, diagnostics: [] };
      } catch (error) {
        staged?.discard(); const issue = diagnostic(error); onDiagnostic(issue); return { valid: false, diagnostics: [issue] };
      }
    },
    render() { if (!disposed && activeCamera) { controls.update(); refreshSelection(); renderer.render(scene, activeCamera); } },
    resize(nextWidth, nextHeight, pixelRatio = globalThis.devicePixelRatio ?? 1) {
      ensure(positive(nextWidth) && positive(nextHeight) && positive(pixelRatio), 'Renderer dimensions and pixel ratio must be positive.');
      width = Math.min(limits.maxDimension, nextWidth); height = Math.min(limits.maxDimension, nextHeight);
      renderer.setPixelRatio(Math.min(limits.maxPixelRatio, pixelRatio, limits.maxDimension / width, limits.maxDimension / height));
      renderer.setSize(width, height, false);
      if (activeCamera) projection(activeCamera);
    },
    setCamera,
    frameAll() {
      if (!activeCamera || !resources.current) return false;
      const bounds = new THREE.Box3().setFromObject(resources.current.root);
      if (bounds.isEmpty()) return false;
      const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 0.1), direction = activeCamera.position.clone().sub(controls.target).normalize();
      if (direction.lengthSq() === 0) direction.set(1, 0.7, 1).normalize();
      if (activeCamera.isPerspectiveCamera) {
        const angle = Math.atan(Math.tan(THREE.MathUtils.degToRad(activeCamera.fov / 2)) * Math.min(1, width / height));
        activeCamera.position.copy(center).addScaledVector(direction, radius * 1.2 / Math.sin(angle));
      } else {
        activeCamera.userData.span = 2.4 * radius / Math.min(1, width / height); activeCamera.zoom = 1;
        activeCamera.position.copy(center).addScaledVector(direction, radius * 3);
      }
      controls.target.copy(center); projection(activeCamera); controls.update(); emitCamera(); return true;
    },
    pick, select, getCameraState,
    stats() { return { ...resources.stats(), rendererMemory: { ...renderer.info.memory }, drawCalls: renderer.info.render.calls }; },
    dispose() {
      if (disposed) return; disposed = true; controls?.dispose(); activeCamera?.dispose();
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('webglcontextlost', contextLost);
      resources.dispose(); selectionBox.geometry.dispose(); selectionBox.material.dispose(); renderer.dispose(); renderer.forceContextLoss();
      scene.clear(); activeCamera = null;
    },
  };
}
