// Shared display indexing for a compiled F06 plot. No scientific resampling.
export function plotRows(view) {
  const value = view.data, component = view.component >= 0 ? view.component : 0;
  if (!value) return [];
  if (value.kind === 'scalar') return [{ x: 0, y: value.data, label: 'Value' }];
  if (value.kind === 'vector') return (view.component >= 0 ? [{ x: component, y: value.data[component], label: ['X', 'Y', 'Z'][component] ?? String(component) }]
    : value.data.map((y, x) => ({ x, y, label: ['X', 'Y', 'Z'][x] ?? String(x) })));
  return value.data.flatMap((sample, index) => {
    const x = value.kind === 'series' ? value.coordinates.values[index] : index;
    const base = { x, label: String(Number(x.toPrecision(5))), objectId: value.objectIds?.[index] ?? `${view.source.nodeId}:sample:${index}` };
    return Array.isArray(sample) && view.component === -1 ? sample.map((y, series) => ({ ...base, y, series }))
      : [{ ...base, y: Array.isArray(sample) ? sample[component] : sample, series: component }];
  });
}

// SVG paths are presentation only. Restart at every missing sample so a gap
// in a scientific series is visible even when finite samples surround it.
export function seriesPaths(rows, x, y) {
  const paths = new Map(), drawing = new Set();
  for (const row of rows) {
    const channel = row.series ?? 0;
    if (!Number.isFinite(row.y)) { drawing.delete(channel); continue; }
    const segment = (drawing.has(channel) ? 'L' : 'M') + x(row.x) + ' ' + y(row.y);
    paths.set(channel, (paths.get(channel) ?? '') + segment);
    drawing.add(channel);
  }
  return paths;
}

export function plotFraction(value, min, max) {
  if (max === min) return 0.5;
  const scale = Math.max(Math.abs(min), Math.abs(max));
  return (value / scale - min / scale) / (max / scale - min / scale);
}
