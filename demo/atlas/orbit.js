// Camera coordinates are in cluster radii. The atlas occupies the unit sphere.
export const homeDistance = 3.2
const near = 0.05
const maxPitch = Math.PI / 2 - 0.015
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function createOrbitCamera() {
  let width = 1, height = 1, focalX = 1, focalY = 1
  let yaw, pitch, zoom, distance, sinYaw, cosYaw, sinPitch, cosPitch
  let target = { x: 0, y: 0, z: 0 }
  function orient(y, p) {
    yaw = Math.atan2(Math.sin(y), Math.cos(y))
    pitch = clamp(p, -maxPitch, maxPitch)
    sinYaw = Math.sin(yaw)
    cosYaw = Math.cos(yaw)
    sinPitch = Math.sin(pitch)
    cosPitch = Math.cos(pitch)
  }
  function fit() {
    orient(0, 0)
    zoom = 1
    distance = homeDistance
    target = { x: 0, y: 0, z: 0 }
  }
  function resize(w, h) {
    width = Math.max(1, w)
    height = Math.max(1, h)
    // The projected unit sphere fills an ellipse with semiaxes f / sqrt(d² − 1).
    // Fit the atlas to each viewport dimension while preserving perspective depth.
    const fit = Math.sqrt(homeDistance ** 2 - 1)
    focalX = 0.46 * width * fit
    focalY = 0.45 * height * fit
  }
  function view(point) {
    const x = point.x - target.x, y = point.y - target.y, z = point.z - target.z
    const xz = sinYaw * x + cosYaw * z
    return { right: cosYaw * x - sinYaw * z, up: cosPitch * y - sinPitch * xz,
      depth: distance - (cosPitch * xz + sinPitch * y) }
  }
  function projectView({ right, up, depth }) {
    return { px: width / 2 + right * focalX / depth, py: height / 2 - up * focalY / depth,
      depth, scale: Math.min(focalX, focalY) / depth }
  }
  function project(point) {
    const v = view(point)
    return v.depth >= near ? projectView(v) : null
  }
  function projectSegment(start, end) {
    let a = view(start), b = view(end)
    if (a.depth < near && b.depth < near) return null
    if (a.depth < near || b.depth < near) {
      const t = (near - a.depth) / (b.depth - a.depth)
      const clipped = { right: a.right + (b.right - a.right) * t, up: a.up + (b.up - a.up) * t, depth: near }
      if (a.depth < near) a = clipped
      else b = clipped
    }
    return { a: projectView(a), b: projectView(b) }
  }
  // Translate the orbit target on the camera's own right/up plane.
  function shiftTarget(right, up) {
    target.x += right * cosYaw - up * sinPitch * sinYaw
    target.y += up * cosPitch
    target.z -= right * sinYaw + up * sinPitch * cosYaw
  }
  function pan(dx, dy) {
    shiftTarget(-dx * distance / focalX, dy * distance / focalY)
  }
  function scale(factor, x = width / 2, y = height / 2) {
    if (!Number.isFinite(factor) || factor <= 0) return
    const previous = distance
    zoom = clamp(zoom * factor, 0.55, 6)
    distance = homeDistance / zoom
    // Hold the point under the cursor on the target plane while dollying.
    const delta = previous - distance
    shiftTarget((x - width / 2) * delta / focalX, (height / 2 - y) * delta / focalY)
  }
  fit()
  resize(1, 1)
  return {
    resize, project, projectSegment, pan, scale, fit,
    orbit(dYaw, dPitch) { orient(yaw + dYaw, pitch + dPitch) },
    centerOn({ x, y, z }) { target = { x, y, z } },
    get yaw() { return yaw }, get pitch() { return pitch }, get zoom() { return zoom },
    get distance() { return distance }, get target() { return { ...target } }
  }
}

// The flat overview uses the full window, mapping unit-radius circles to ellipses.
// It keeps a world-space target so resizing or switching views preserves the pan.
export function createFlatCamera() {
  let width = 1, height = 1, extentX = 1, extentY = 1
  let zoom = 1, targetX = 0, targetY = 0
  function resize(w,h) {
    width = Math.max(1,w)
    height = Math.max(1,h)
    extentX = Math.max(1,width*0.44-8)
    extentY = Math.max(1,height*0.44-8)
  }
  function project(point) {
    const {x,y} = point.flat ?? point
    return { px: width/2+(x-targetX)*extentX*zoom, py: height/2-(y-targetY)*extentY*zoom,
      scale: Math.min(extentX,extentY)*zoom, depth: homeDistance }
  }
  return {
    resize,project,
    projectSegment(a,b) { return { a: project(a), b: project(b) } },
    centerOn(point) {
      const {x,y} = point.flat ?? point
      targetX = x
      targetY = y
    },
    pan(dx,dy) { targetX -= dx/(extentX*zoom); targetY += dy/(extentY*zoom) },
    scale(factor,x=width/2,y=height/2) {
      if (!Number.isFinite(factor) || factor <= 0) return
      const old = zoom
      zoom = clamp(zoom*factor,0.55,6)
      targetX += (x-width/2)/extentX*(1/old-1/zoom)
      targetY -= (y-height/2)/extentY*(1/old-1/zoom)
    },
    fit() { targetX = targetY = 0; zoom = 1 },
    get zoom() { return zoom }
  }
}

export function bindOrbitControls(canvas, camera, { onChange, onPick, onHover, onLeave }) {
  const pointers = new Map()
  let dragged = false
  const local = event => {
    const rect = canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const span = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  function fit() {
    camera.fit()
    onLeave()
    onChange()
  }
  function scale(factor, x, y) {
    camera.scale(factor, x, y)
    onLeave()
    onChange()
  }
  canvas.addEventListener('wheel', event => {
    event.preventDefault()
    const { x, y } = local(event)
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1
    scale(Math.exp(-clamp(event.deltaY * unit, -180, 180) * 0.002), x, y)
  }, { passive: false })
  canvas.addEventListener('contextmenu', e => e.preventDefault())
  canvas.addEventListener('pointerdown', event => {
    if (event.button < 0 || event.button > 2 || pointers.size >= 2) return
    const p = local(event)
    if (!pointers.size) dragged = false
    pointers.set(event.pointerId, { p, start: p, pan: event.shiftKey || event.button !== 0 })
    if (pointers.size === 2) dragged = true
    canvas.setPointerCapture(event.pointerId)
    canvas.focus({ preventScroll: true })
  })
  canvas.addEventListener('pointermove', event => {
    const p = local(event), current = pointers.get(event.pointerId)
    if (!current) {
      if (!pointers.size && event.pointerType !== 'touch') onHover(p.x, p.y)
      return
    }
    const last = current.p
    current.p = p
    if (!dragged && span(p, current.start) < 4) return
    const previous = dragged ? last : current.start
    dragged = true
    const dx = p.x - previous.x, dy = p.y - previous.y
    if (pointers.size === 2) {
      const other = [...pointers.values()].find(pointer => pointer !== current).p
      const initialSpan = span(previous, other), newSpan = span(p, other)
      if (initialSpan > 2 && newSpan > 2) {
        camera.scale(newSpan / initialSpan, (previous.x + other.x) / 2, (previous.y + other.y) / 2)
      }
      camera.pan(dx / 2, dy / 2)
    } else if (current.pan || event.shiftKey || !camera.orbit) {
      camera.pan(dx, dy)
    } else {
      const sensitivity = Math.PI / Math.max(160, Math.min(canvas.clientWidth, canvas.clientHeight))
      camera.orbit(-dx * sensitivity, dy * sensitivity)
    }
    canvas.style.cursor = 'grabbing'
    onLeave()
    onChange()
  })
  function release(event, cancelled) {
    const current = pointers.get(event.pointerId)
    if (!current) return
    pointers.delete(event.pointerId)
    if (cancelled) dragged = true
    if (!pointers.size) canvas.style.cursor = 'grab'
    if (!cancelled && !dragged && !current.pan && !event.shiftKey) {
      const p = local(event)
      if (span(p, current.start) < 4) onPick(p.x, p.y)
    }
  }
  canvas.addEventListener('pointerup', event => release(event, false))
  canvas.addEventListener('pointercancel', event => release(event, true))
  canvas.addEventListener('lostpointercapture', event => release(event, true))
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('blur', () => {
    pointers.clear()
    canvas.style.cursor = 'grab'
    onLeave()
  })
  canvas.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'home') fit()
    else if (['+', '=', '-', '_'].includes(key)) scale(['-', '_'].includes(key) ? 1 / 1.25 : 1.25)
    else if (['w', 'a', 's', 'd'].includes(key)) {
      const horizontal = Number(key === 'd') - Number(key === 'a')
      const vertical = Number(key === 'w') - Number(key === 's')
      if (event.shiftKey || !camera.orbit) camera.pan(horizontal * 32, -vertical * 32)
      else camera.orbit(horizontal * Math.PI / 12, vertical * Math.PI / 12)
      onLeave()
      onChange()
    } else return
    event.preventDefault()
  })
  return {
    fit, scale,
    setCamera(next) {
      pointers.clear()
      dragged = false
      canvas.style.cursor = 'grab'
      camera = next
      onLeave()
      onChange()
    }
  }
}
