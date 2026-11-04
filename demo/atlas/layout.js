import { homeDistance } from './orbit.js'

// Build both whole-level maps before filtering, so a topic keeps its position and size.
export function locateStars(nodes) {
  const sorted = [...nodes].sort((a, b) => b.percentile - a.percentile || (a.order ?? a.startPage ?? 0) - (b.order ?? b.startPage ?? 0) || a.id.localeCompare(b.id))
  if (!sorted.length) return []
  const highest = sorted[0].percentile, lowest = sorted.at(-1).percentile
  // Tied leaders need distinguishable places on a common inner shell.
  const peak = highest === sorted[1]?.percentile ? 100 : highest
  const stars = sorted.map(n => {
    const score = highest === lowest ? 0.5 : (n.percentile - lowest) / (highest - lowest)
    // Allocate equal shell volume per rank interval, giving inner topics room for their labels.
    const radius = highest === lowest ? Number(sorted.length > 1) : Math.cbrt((peak - n.percentile) / (peak - lowest))
    return { ...n, radius, size: 2 * 9 ** score }
  })

  // Start categories in angular sectors. Adjusting directions later balances the
  // mass without moving any star off its assigned circle or spherical shell.
  const sectors = new Map()
  let start = -0.9 * Math.PI
  for (const part of [...new Set(stars.map(s => s.partId))].sort()) {
    const count = stars.filter(s => s.partId === part).length
    const width = 2 * Math.PI * count / stars.length
    sectors.set(part, { start, width, steps: Math.max(48, count * 2) })
    start += width
  }

  const volume = place(stars, sectors, true), plane = place(stars, sectors, false)
  return stars.map((star, i) => ({ ...star, ...volume[i], flat: plane[i] }))
}

function place(stars, sectors, withDepth) {
  const points = [], projected = []
  for (const [i, star] of stars.entries()) {
    const sector = sectors.get(star.partId)
    // Vary depth independently of part, rank and initial viewing direction.
    const height = withDepth ? 0.68 * (2 * ((0.27 + i * 0.618033988749895) % 1) - 1) : 0
    const z = star.radius * height
    const ring = star.radius * Math.sqrt(1 - height**2)
    // Stars far apart in depth can still hide one another at the opening angle.
    const depthScale = 1 / (1 - z / homeDistance)
    let best = -Infinity, winner
    for (let j = 0; j < sector.steps; j++) {
      const fraction = (j + 0.5) / sector.steps
      const angle = sector.start + fraction * sector.width
      const x = ring * Math.cos(angle), y = ring * Math.sin(angle)
      const px = x * depthScale, py = y * depthScale
      let separation = 4
      for (const other of projected) {
        separation = Math.min(separation, (px - other.x)**2 + (py - other.y)**2)
      }
      const quality = separation - 0.006 * Math.abs(fraction - 0.5)
      if (quality > best) {
        best = quality
        winner = { x, y, z }
      }
    }
    points.push(winner)
    projected.push({ x: winner.x * depthScale, y: winner.y * depthScale })
  }

  const rawMasses = stars.map(s => s.mass ?? s.pages)
  // Scaling leaves the weighted centroid unchanged even for very small masses.
  const largest = Math.max(...rawMasses)
  const masses = largest ? rawMasses.map(m => m/largest) : stars.map(() => 1)
  const total = masses.reduce((a,b) => a+b,0)
  for (let pass = 0; pass < 192; pass++) {
    let x = 0, y = 0, z = 0
    for (const [i, p] of points.entries()) {
      const mass = masses[i]
      x += mass * p.x
      y += mass * p.y
      z += mass * p.z
    }
    x /= total
    y /= total
    z /= total
    if (Math.hypot(x, y, z) < 1e-13) break
    for (const [i, p] of points.entries()) {
      if (stars[i].radius === 0) continue
      const dx = p.x - x, dy = p.y - y, dz = p.z - z
      const length = Math.hypot(dx, dy, dz)
      if (!length) continue
      const scale = stars[i].radius / length
      p.x = dx * scale
      p.y = dy * scale
      p.z = dz * scale
    }
  }
  return points
}
