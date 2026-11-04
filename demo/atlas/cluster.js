import { bindOrbitControls, createFlatCamera, createOrbitCamera, homeDistance } from './orbit.js'

const origin = { x: 0, y: 0, z: 0 }
const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

// Faint, unlabelled stars surround the camera. Only the colored topics are selectable.
function makeSky() {
  let seed = 241103
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  return Array.from({length: 5200}, (_, i) => {
    const angle = random() * 2 * Math.PI
    const y = i % 3 ? 2*random()-1 : (random()+random()+random()-1.5)*0.29
    const ring = Math.sqrt(1-y*y), distance = 10 + random()*55
    const x = Math.sin(angle)*ring, z = Math.cos(angle)*ring
    return { x: distance*(0.94*x-0.34*y), y: distance*(0.34*x+0.94*y), z: distance*z,
      size: 0.7 + 0.85*random(), alpha: 0.17 + 0.49*random() }
  })
}

// An inclined equator and meridians give a frame of reference as the camera orbits.
function makeGuides() {
  const guides = []
  for (const plane of [0,1,2]) {
    const points = []
    for (let i = 0; i <= 92; i++) {
      const a = 2*Math.PI*i/92, c = Math.cos(a), s = Math.sin(a)
      const [x,y,z] = [[c,0,s],[c,s,0],[0,c,s]][plane]
      const u = x*Math.cos(0.46)-z*Math.sin(0.46), v = x*Math.sin(0.46)+z*Math.cos(0.46)
      points.push({ x: u, y: y*Math.cos(0.34)-v*Math.sin(0.34), z: y*Math.sin(0.34)+v*Math.cos(0.34) })
    }
    guides.push(points)
  }
  return guides
}

// Prefer the open side of the star. A selected name or the center callout can
// reach a little farther when all of its immediate neighbors are occupied.
function placeCaption(n, w, h, width, height, occupied, priority = false) {
  if (w > width-6 || h > height-6) return null
  const offsets = priority ? [0,18,40,70] : [0,16,32]
  for (const extra of offsets) {
    const gap = n.r+6+extra, diagonal = gap*Math.SQRT1_2
    const side = n.px >= width/2 ? 1 : -1
    const sideX = (direction, distance) => direction > 0 ? distance : -distance-w
    const candidates = [
      [sideX(side,gap),-h/2], [sideX(-side,gap),-h/2],
      [-w/2,-gap-h], [-w/2,gap],
      [sideX(side,diagonal),-diagonal-h], [sideX(-side,diagonal),-diagonal-h],
      [sideX(side,diagonal),diagonal], [sideX(-side,diagonal),diagonal]
    ]
    for (const [dx,dy] of candidates) {
      const box = { x: Math.max(3,Math.min(width-w-3,n.px+dx)),
        y: Math.max(3,Math.min(height-h-3,n.py+dy)), w,h }
      if (!occupied.some(other => intersects(box,other))) return box
    }
  }
  return null
}

function drawLeader(ctx, n, box, minimumLength) {
  const x = Math.max(box.x,Math.min(box.x+box.w,n.px))
  const y = Math.max(box.y,Math.min(box.y+box.h,n.py))
  const dx = x-n.px, dy = y-n.py, length = Math.hypot(dx,dy)
  if (length <= n.r+minimumLength) return
  const start = (n.r+2)/length
  ctx.strokeStyle = '#b6a779a8'
  ctx.lineWidth = 0.85
  ctx.beginPath()
  ctx.moveTo(n.px+dx*start,n.py+dy*start)
  ctx.lineTo(x,y)
  ctx.stroke()
}

function markMassCenter(ctx, n, width, height, occupied) {
  const kicker = width >= 600 ? 'FOUNDATIONAL IDEA' : ''
  ctx.font = '9px ui-monospace, monospace'
  const kickerWidth = ctx.measureText(kicker).width
  ctx.font = '13px system-ui, sans-serif'
  const w = Math.ceil(Math.max(kickerWidth,ctx.measureText(n.label).width))+14, h = kicker ? 37 : 24
  const box = placeCaption(n,w,h,width,height,occupied,true)
  if (!box) return null
  drawLeader(ctx,n,box,3)
  ctx.fillStyle = '#0b0c0bec'
  ctx.fillRect(box.x,box.y,w,h)
  if (kicker) {
    ctx.fillStyle = '#c6b588'
    ctx.font = '9px ui-monospace, monospace'
    ctx.fillText(kicker,box.x+7,box.y+13)
  }
  ctx.font = '13px system-ui, sans-serif'
  ctx.fillStyle = '#e8e4d7'
  ctx.fillText(n.label,box.x+7,box.y+h-8)
  ctx.fillStyle = '#a499716b'
  ctx.fillRect(box.x,box.y+h-1,w,1)
  return { ...box, id: n.id }
}

export function createCluster(canvas, { onNode, onEdge, onZoom, onRead }) {
  const ctx = canvas.getContext('2d')
  const cameras = { '2d': createFlatCamera(), '3d': createOrbitCamera() }
  const sky = makeSky(), guides = makeGuides()
  let projection = '3d', camera = cameras[projection]
  let nodes = [], edges = [], allEdges = [], selected = null, edge = null
  let matches = null, browsable = []
  const isResult = id => !matches || matches.has(id)
  let width = 0, height = 0, frame = 0
  let screen = [], segments = [], labels = [], pointed = null, pointedEdge = null, active = null
  const redraw = () => { if (!frame) frame = requestAnimationFrame(draw) }

  function backdrop() {
    ctx.fillStyle = '#060707'
    ctx.fillRect(0, 0, width, height)
    if (projection === '2d') {
      const c = camera.project(origin), corner = camera.project({x:1,y:1})
      const rx = corner.px-c.px, ry = c.py-corner.py
      // Fine dotted guides sit behind the longer dashes connecting topics.
      ctx.lineWidth = 0.8
      ctx.setLineDash([1,4])
      ctx.strokeStyle = '#b9af943b'
      for (const level of [0.35,0.65,1]) {
        ctx.beginPath()
        ctx.ellipse(c.px,c.py,rx*level,ry*level,0,0,2*Math.PI)
        ctx.stroke()
      }
      ctx.setLineDash([])
      return
    }
    ctx.fillStyle = '#e1e0d9'
    for (const star of sky) {
      const p = camera.project(star)
      if (!p || p.px < 0 || p.px >= width || p.py < 0 || p.py >= height) continue
      ctx.globalAlpha = star.alpha
      ctx.fillRect(p.px, p.py, star.size, star.size)
    }
    ctx.globalAlpha = 1
    const center = camera.project(origin)
    if (center) {
      const radius = Math.min(0.88*center.scale, Math.max(width,height)*1.2)
      const mist = ctx.createRadialGradient(center.px, center.py, 0, center.px, center.py, radius)
      mist.addColorStop(0,'rgba(205,188,154,.085)')
      mist.addColorStop(0.5,'rgba(188,178,153,.034)')
      mist.addColorStop(1,'rgba(160,153,140,0)')
      ctx.fillStyle = mist
      ctx.fillRect(0,0,width,height)
    }
    for (const points of guides) {
      for (let i=1; i<points.length; i++) {
        const projected = camera.projectSegment(points[i-1],points[i])
        if (!projected) continue
        const {a,b} = projected
        const front = (a.depth+b.depth)/2 < (center?.depth ?? 0)
        ctx.strokeStyle = front ? 'rgba(204,196,171,.19)' : 'rgba(204,196,171,.08)'
        ctx.lineWidth = front ? 0.85 : 0.65
        ctx.beginPath()
        ctx.moveTo(a.px,a.py)
        ctx.lineTo(b.px,b.py)
        ctx.stroke()
      }
    }
    if (center) {
      // Open ticks keep the mass center visible even when its topic is filtered out.
      ctx.strokeStyle = matches ? '#cbb78852' : '#cbb78891'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const [x,y] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        ctx.moveTo(center.px+x*21,center.py+y*21)
        ctx.lineTo(center.px+x*25,center.py+y*25)
      }
      ctx.stroke()
    }
  }
  function draw() {
    frame = 0
    width = canvas.clientWidth
    height = canvas.clientHeight
    if (!width || !height) return
    camera.resize(width,height)
    const dpr = Math.min(devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {
      canvas.width = Math.round(width*dpr)
      canvas.height = Math.round(height*dpr)
    }
    ctx.setTransform(dpr,0,0,dpr,0,0)
    backdrop()
    const byId = new Map(nodes.map(n => [n.id,n]))
    const focus = pointed || active || selected
    const related = new Set([focus,edge?.source,edge?.target,pointedEdge?.source,pointedEdge?.target])
    const visibleEdges = new Set(edges)
    for (const e of allEdges) {
      if (focus && (e.source === focus || e.target === focus)) {
        visibleEdges.add(e)
        related.add(e.source)
        related.add(e.target)
      }
    }
    if (edge) visibleEdges.add(edge)
    segments = []
    for (const e of visibleEdges) {
      const a = byId.get(e.source), b = byId.get(e.target)
      if (!a || !b) continue
      const line = camera.projectSegment(a,b)
      if (line) segments.push({ ...line, e })
    }
    // Farther geometry paints first, with links clipped to the visible half-space.
    segments.sort((a,b) => b.a.depth+b.b.depth-a.a.depth-a.b.depth)
    ctx.setLineDash([4,4])
    for (const {a,b,e} of segments) {
      const highlight = e === edge || e === pointedEdge || (focus && (e.source === focus || e.target === focus))
      const resultEnds = Number(isResult(e.source)) + Number(isResult(e.target))
      ctx.globalAlpha = [0.20, 0.48, 1][resultEnds]
      ctx.strokeStyle = highlight ? 'rgba(245,218,164,.84)' : focus || edge ? 'rgba(175,182,176,.18)' : 'rgba(185,193,185,.42)'
      ctx.lineWidth = highlight ? 1.45 : 0.88
      ctx.beginPath()
      ctx.moveTo(a.px,a.py)
      ctx.lineTo(b.px,b.py)
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    screen = []
    for (const n of nodes) {
      const p = camera.project(n)
      if (!p) continue
      const magnification = projection === '2d' ? camera.zoom**0.4 : (homeDistance/p.depth)**0.6
      const r = n.size * Math.max(0.65,Math.min(2.6,magnification)) * (width < 550 ? 0.86 : 1)
      if (p.px < -r*4 || p.px > width+r*4 || p.py < -r*4 || p.py > height+r*4) continue
      screen.push({ ...n, ...p, r })
    }
    // A dim foreground star should not cover a search result behind it.
    screen.sort((a,b) => Number(isResult(a.id))-Number(isResult(b.id)) || b.depth-a.depth)
    for (const n of screen) {
      const marked = n.id === selected || n.id === pointed || n.id === active || n.id === edge?.source || n.id === edge?.target
      const result = isResult(n.id)
      const mutedByFocus = (focus || edge) && !related.has(n.id)
      ctx.globalAlpha = !result ? 0.18 : mutedByFocus ? 0.53 : 1
      const halo = n.r * (projection === '2d' ? 1.9 : 2.8)
      const glow = ctx.createRadialGradient(n.px,n.py,0,n.px,n.py,halo)
      glow.addColorStop(0,n.color+'93')
      glow.addColorStop(0.38,n.color+'37')
      glow.addColorStop(1,n.color+'00')
      ctx.fillStyle = glow
      ctx.fillRect(n.px-halo,n.py-halo,2*halo,2*halo)
      if (projection === '3d' && n.percentile > 89) {
        ctx.strokeStyle = n.color+'70'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(n.px-1.8*n.r,n.py)
        ctx.lineTo(n.px+1.8*n.r,n.py)
        ctx.moveTo(n.px,n.py-1.8*n.r)
        ctx.lineTo(n.px,n.py+1.8*n.r)
        ctx.stroke()
      }
      const light = ctx.createRadialGradient(n.px-n.r*.16,n.py-n.r*.19,0,n.px,n.py,n.r)
      light.addColorStop(0,'#fff9e8')
      light.addColorStop(0.33,'#fff9e8')
      light.addColorStop(0.71,n.color)
      light.addColorStop(1,n.color+'b0')
      ctx.fillStyle = light
      ctx.beginPath()
      ctx.arc(n.px,n.py,n.r,0,2*Math.PI)
      ctx.fill()
      if (marked || (matches && result)) {
        // The ring makes an outer, small star easy to find without changing its score size.
        ctx.strokeStyle = marked ? n.color : n.color+'bb'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(n.px,n.py,n.r+4.5,0,2*Math.PI)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    const occupied = screen.map(n => ({ x: n.px - n.r - 2, y: n.py - n.r - 2, w: 2*n.r + 4, h: 2*n.r + 4 }))
    occupied.push({ x: 0, y: 0, w: 110, h: 32 }, { x: width-22, y: 0, w: 22, h: 32 })
    const important = n => n.id === focus || n.id === selected || n.id === edge?.source || n.id === edge?.target
    const order = [...screen].sort((a,b) => Number(isResult(b.id))-Number(isResult(a.id)) || Number(important(b)) - Number(important(a)) || Number(related.has(b.id)) - Number(related.has(a.id)) || b.percentile - a.percentile)
    labels = []
    const core = screen.find(n => n.radius === 0)
    const showCore = core &&
      core.px > 0 && core.px < width && core.py > 0 && core.py < height
    for (const n of order) {
      if (showCore && n === core) {
        ctx.globalAlpha = isResult(n.id) ? 1 : 0.24
        const box = markMassCenter(ctx,n,width,height,occupied)
        ctx.globalAlpha = 1
        if (box) {
          labels.push(box)
          occupied.push(box)
          continue
        }
      }
      if (n.px < 0 || n.px > width || n.py < 0 || n.py > height) continue
      const big = important(n) || (matches && isResult(n.id))
      const fontSize = width < 600 ? 12 : 13
      ctx.font = (big ? '600 ' : '') + fontSize + 'px system-ui, sans-serif'
      const rect = placeCaption(n,ctx.measureText(n.label).width+8,fontSize+6,width,height,occupied,
        important(n) || (matches?.size === 1 && isResult(n.id)))
      if (!rect) continue
      labels.push({ ...rect, id: n.id })
      occupied.push(rect)
      ctx.globalAlpha = isResult(n.id) ? 1 : 0.29
      drawLeader(ctx,n,rect,19)
      ctx.lineJoin = 'round'
      ctx.lineWidth = 3.5
      ctx.strokeStyle = '#090b0bf0'
      ctx.strokeText(n.label, rect.x+4, rect.y+fontSize+1)
      ctx.fillStyle = big ? '#fff2d7' : focus && !related.has(n.id) ? '#959b96' : '#dcdfd7'
      ctx.fillText(n.label, rect.x+4, rect.y+fontSize+1)
    }
    ctx.globalAlpha = 1
  }
  function hit(x,y) {
    let nearby = null, distance = 12
    // Test the visible face first where two stellar disks overlap in projection.
    for (let i=screen.length-1; i>=0; i--) {
      const n = screen[i]
      if (!isResult(n.id)) continue
      const d = Math.hypot(n.px-x,n.py-y)
      if (d <= n.r) return { id: n.id }
      if (d < distance) { nearby = n; distance = d }
    }
    const label = labels.find(b => isResult(b.id) && x >= b.x && x <= b.x+b.w && y >= b.y && y <= b.y+b.h)
    if (label) return { id: label.id }
    if (nearby) return { id: nearby.id }
    let best = 4, match = null
    for (const {a,b,e} of segments) {
      if (!isResult(e.source) || !isResult(e.target)) continue
      const dx = b.px-a.px, dy = b.py-a.py
      const t = Math.min(1,Math.max(0,((x-a.px)*dx+(y-a.py)*dy)/(dx*dx+dy*dy || 1)))
      const d = Math.hypot(a.px+t*dx-x,a.py+t*dy-y)
      if (d <= best) { best = d; match = e }
    }
    return { edge: match }
  }
  function clearHover() {
    if (pointed || pointedEdge || active) {
      pointed = pointedEdge = active = null
      redraw()
    }
  }
  const controls = bindOrbitControls(canvas,camera,{
    onChange() { onZoom(camera.zoom); redraw() },
    onLeave: clearHover,
    onPick(x,y) {
      if (frame) { cancelAnimationFrame(frame); draw() }
      const h = hit(x,y)
      if (h.id) onNode(h.id)
      else if (h.edge) onEdge(h.edge)
    },
    onHover(x,y) {
      const h = hit(x,y)
      if (pointed !== (h.id ?? null) || pointedEdge !== (h.edge ?? null)) {
        pointed = h.id ?? null
        pointedEdge = h.edge ?? null
        active = null
        redraw()
      }
      canvas.style.cursor = pointed || pointedEdge ? 'pointer' : 'grab'
    }
  })
  canvas.addEventListener('keydown', e => {
    if (!browsable.length || e.ctrlKey || e.altKey || e.metaKey) return
    if (e.key === 'Enter') onNode(active || (selected && isResult(selected) ? selected : browsable[0].id))
    else if (e.key.startsWith('Arrow')) {
      const step = ['ArrowLeft','ArrowUp'].includes(e.key) ? -1 : 1
      const current = browsable.findIndex(n => n.id === (active || selected))
      const index = current < 0 ? (step > 0 ? 0 : browsable.length-1) : (current+step+browsable.length)%browsable.length
      const next = browsable[index], p = camera.project(next)
      active = next.id
      pointed = pointedEdge = null
      if (!p || p.px < 22 || p.px > width-22 || p.py < 22 || p.py > height-22) camera.centerOn(next)
      onRead(next)
      redraw()
    } else return
    e.preventDefault()
  })
  new ResizeObserver(redraw).observe(canvas)
  return {
    setData(data, overview, full, matchedIds = null) {
      nodes = data; edges = overview; allEdges = full
      matches = matchedIds
      browsable = matches ? nodes.filter(n => matches.has(n.id)) : nodes
      clearHover()
      redraw()
    },
    select(nodeId, selectedEdge = null) {
      selected = nodeId; edge = selectedEdge
      clearHover()
      redraw()
    },
    setProjection(next) {
      if (projection === next) return
      if (!Object.hasOwn(cameras,next)) throw new RangeError('Unknown atlas projection')
      projection = next
      camera = cameras[next]
      camera.resize(canvas.clientWidth,canvas.clientHeight)
      controls.setCamera(camera)
    },
    orbit(yaw,pitch) {
      if (!camera.orbit) return
      camera.orbit(yaw,pitch)
      clearHover()
      redraw()
    },
    fit: controls.fit, scale: controls.scale, redraw
  }
}
