import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrbitCamera, createFlatCamera, bindOrbitControls } from '../demo/atlas/orbit.js';

function close(a, b) {
  assert.ok(Math.abs(a - b) < 1e-8, a + ' should equal ' + b);
}
const center = { x: 0, y: 0, z: 0 };

test('atlas uses a perspective camera with a fixed orbit target and correct near/far ordering', () => {
  const camera = createOrbitCamera();
  camera.resize(900, 460);
  const front = { x: 0.4, y: 0, z: 0.8 }, back = { ...front, z: -0.8 };
  assert.ok(camera.project(front).px > camera.project(back).px);
  assert.ok(camera.project(front).depth < camera.project(back).depth);
  assert.ok(camera.project({ x: 0, y: 0.5, z: 0 }).py < 230);
  camera.orbit(Math.PI / 2, 0);
  close(camera.project(center).px, 450);
  close(camera.project(center).py, 230);
  assert.ok(camera.project(front).px < 450);
  assert.ok(camera.project(back).px > 450);
  close(camera.project(front).depth, camera.project(back).depth);

  camera.orbit(-2, 0.7);
  camera.centerOn(front);
  close(camera.project(front).px, 450);
  close(camera.project(front).py, 230);
  camera.pan(61, -12);
  close(camera.project(front).px, 511);
  close(camera.project(front).py, 218);
  camera.scale(2, 511, 218);
  close(camera.project(front).px, 511);
  close(camera.project(front).py, 218);
  camera.fit();
  close(camera.zoom, 1);
  close(camera.yaw, 0);
  close(camera.pitch, 0);
  assert.deepEqual(camera.target, center);
});

test('fit uses both viewport dimensions while keeping the whole cluster visible through any rotation', () => {
  const camera = createOrbitCamera();
  for (const [w, h] of [[1100, 400], [360, 650]]) {
    camera.resize(w, h);
    camera.fit();
    const x = camera.project({ x: 0.8, y: 0, z: 0 });
    const y = camera.project({ x: 0, y: 0.8, z: 0 });
    assert.ok(x.px > 0.83 * w && y.py < 0.17 * h, 'Use the long dimension as well as the short one.');
    camera.orbit(-0.8, 0.4);
    for (let phi = 0; phi < Math.PI; phi += 0.15) {
      for (let theta = 0; theta < Math.PI * 2; theta += 0.15) {
        const p = camera.project({ x: Math.sin(phi) * Math.cos(theta), y: Math.sin(phi) * Math.sin(theta), z: Math.cos(phi) });
        assert.ok(Math.hypot((p.px - w / 2) / (0.46 * w), (p.py - h / 2) / (0.45 * h)) <= 1 + 1e-8);
      }
    }
  }
});

test('panning and cursor zoom keep an off-center anchor after orbiting a wide or tall map', () => {
  for (const [width, height] of [[1280, 490], [366, 495]]) {
    const camera = createOrbitCamera();
    camera.resize(width, height);
    const yaw = 0.72, pitch = -0.4;
    camera.orbit(yaw, pitch);
    // A point on the rotated target plane, displaced in both camera axes.
    const right = 0.6, up = 0.35;
    const point = {
      x: right * Math.cos(yaw) - up * Math.sin(pitch) * Math.sin(yaw),
      y: up * Math.cos(pitch),
      z: -right * Math.sin(yaw) - up * Math.sin(pitch) * Math.cos(yaw),
    };
    const initial = camera.project(point);
    assert.ok(initial.px > width * 0.7 && initial.py < height * 0.4);
    camera.pan(30, -12);
    const anchor = camera.project(point);
    close(anchor.px, initial.px + 30);
    close(anchor.py, initial.py - 12);
    camera.scale(1.4, anchor.px, anchor.py);
    close(camera.project(point).px, anchor.px);
    close(camera.project(point).py, anchor.py);
  }
});

test('dollying inside the cloud clips points and crossing segments before perspective division', () => {
  const camera = createOrbitCamera();
  camera.resize(900, 460);
  camera.scale(100);
  close(camera.zoom, 6);
  const eye = camera.distance;
  const front = { x: 0.3, y: 0.2, z: eye - 0.3 }, rear = { x: -0.2, y: 0.01, z: eye + 0.3 };
  assert.equal(camera.project(rear), null);
  assert.equal(camera.project({ x: 4, y: 0, z: eye }), null);
  assert.equal(camera.projectSegment(rear, rear), null);
  const crossing = camera.projectSegment(front, rear);
  assert.deepEqual(crossing.a, camera.project(front));
  close(crossing.b.depth, 0.05);
  const along = (0.3 - 0.05) / 0.6;
  const unit = camera.project({ x: 1, y: 1, z: eye - 1 });
  close((crossing.b.px - 450) * crossing.b.depth / (unit.px - 450), front.x + (rear.x - front.x) * along);
  close((230 - crossing.b.py) * crossing.b.depth / (230 - unit.py), front.y + (rear.y - front.y) * along);
  const reverse = camera.projectSegment(rear, front);
  close(reverse.a.px, crossing.b.px);
  close(reverse.a.py, crossing.b.py);
  assert.deepEqual(reverse.b, crossing.a);
  camera.orbit(10, 100);
  assert.ok(camera.pitch < Math.PI / 2);
  camera.scale(0.0001);
  close(camera.zoom, 0.55);
});

function gestureHarness() {
  const canvas = new EventTarget();
  Object.assign(canvas, { clientWidth: 800, clientHeight: 400, style: {}, focus() {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 10, top: 20 }) });
  const camera = createOrbitCamera();
  camera.resize(800, 400);
  const picks = [];
  let changes = 0;
  const controls = bindOrbitControls(canvas, camera, { onChange: () => changes++, onPick: (...p) => picks.push(p), onHover() {}, onLeave() {} });
  const send = (type, args = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, pointerType: 'mouse', button: 0, clientX: 410, clientY: 220, ...args
    });
    canvas.dispatchEvent(e);
    return e;
  };
  return { camera, controls, picks, send, changes: () => changes };
}

test('drag and modifier-pan do not select; tap selects in canvas coordinates; arrows remain available for browsing', () => {
  const { camera, picks, send, changes } = gestureHarness();
  send('pointerdown');
  send('pointermove', { clientX: 411 });
  send('pointerup', { clientX: 411 });
  assert.deepEqual(picks, [[401, 200]]);
  assert.equal(changes(), 0);
  send('pointerdown'); send('pointermove', { clientX: 510 }); send('pointerup', { clientX: 510 });
  assert.ok(camera.yaw < 0);
  assert.deepEqual(camera.target, center);
  const yaw = camera.yaw;
  send('pointerdown', { shiftKey: true }); send('pointermove', { clientY: 320 }); send('pointerup', { clientY: 320 });
  close(camera.yaw, yaw);
  assert.notDeepEqual(camera.target, center);
  assert.equal(picks.length, 1);
  assert.equal(send('keydown', { key: 'ArrowRight' }).defaultPrevented, false);
  assert.equal(send('keydown', { key: 'Enter' }).defaultPrevented, false);
  assert.equal(send('keydown', { key: 'w' }).defaultPrevented, true);
  assert.ok(camera.pitch > 0);
  send('keydown', { key: 'Home' });
  close(camera.pitch, 0);
  assert.deepEqual(camera.target, center);
});

test('two-finger pan and pinch preserve the same world anchor through both moves and never synthesize selection', () => {
  const { camera, picks, send } = gestureHarness();
  function touch(type, id, x, y) {
    send(type, { pointerType: 'touch', pointerId: id, clientX: x + 10, clientY: y + 20 });
  }
  const anchor = { x: 0, y: 50 / camera.project(center).scale, z: 0 };
  touch('pointerdown', 1, 300, 150); touch('pointerdown', 2, 500, 150);
  touch('pointermove', 1, 240, 165); touch('pointermove', 2, 650, 185);
  close(camera.zoom, Math.hypot(410, 20) / 200);
  close(camera.project(anchor).px, 445);
  close(camera.project(anchor).py, 175);
  touch('pointerup', 2, 650, 185);
  const yaw = camera.yaw;
  touch('pointermove', 1, 250, 165);
  assert.ok(camera.yaw < yaw);
  touch('pointercancel', 1, 250, 165);
  assert.equal(picks.length, 0);
  touch('pointerdown', 1, 210, 90); touch('pointerup', 1, 210, 90);
  assert.deepEqual(picks, [[210, 90]]);
});


test('flat overview ignores depth, pans and zooms around the cursor with an independent camera', () => {
  const {camera: orbit, controls, picks, send} = gestureHarness();
  const flat = createFlatCamera();
  flat.resize(800,400);
  const star = {x:0.3,y:-0.4,z:0,flat:{x:-0.5,y:0.7,z:0}};
  const initial = flat.project(star);
  const bounds = flat.project({x:1,y:1});
  assert.ok(bounds.px > 700 && bounds.py < 60);
  assert.deepEqual(flat.project({...star,z:4}), initial);
  controls.setCamera(flat);
  send('pointerdown'); send('pointermove',{clientX:450,clientY:250}); send('pointerup',{clientX:450,clientY:250});
  const panned = flat.project(star);
  close(panned.px,initial.px+40);
  close(panned.py,initial.py+30);
  assert.equal(picks.length,0);
  controls.scale(2,panned.px,panned.py);
  close(flat.project(star).px,panned.px);
  close(flat.project(star).py,panned.py);
  send('keydown',{key:'w'});
  const shifted = flat.project(star);
  close(shifted.py,panned.py-32);
  controls.setCamera(orbit);
  send('keydown',{key:'d'});
  assert.ok(orbit.yaw > 0);
  assert.equal(orbit.zoom,1);
  assert.deepEqual(flat.project(star),shifted);
  controls.setCamera(flat);
  send('keydown',{key:'Home'});
  assert.deepEqual(flat.project(star),initial);
  assert.ok(orbit.yaw > 0);
});
