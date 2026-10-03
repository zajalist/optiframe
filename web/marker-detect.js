// Conservative detector for the four 6 mm black, white-centred squares on
// calibration-sheet.svg. Returns native-image pixel coordinates in sheet order.
export function detectSheetMarkers(imageData) {
  const { width, height, data } = imageData ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 80 || height < 80 || !data || data.length < width * height * 4) return null;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 1100));
  const w = Math.ceil(width / step), h = Math.ceil(height / step);
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (Math.min(height - 1, y * step) * width + Math.min(width - 1, x * step)) * 4;
    const value = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    dark[y * w + x] = value < 110 ? 1 : 0;
  }

  // The printed grid touches marker squares in phone photographs. Remove
  // one-pixel grid strokes before connected-component search so a marker is
  // not absorbed into the whole sheet border.
  const eroded = new Uint8Array(dark.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let filled = 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      filled &= dark[(y + dy) * w + x + dx];
    eroded[y * w + x] = filled;
  }
  dark.set(eroded);
  const queue = new Int32Array(w * h), candidates = [];
  const maxSide = Math.max(12, Math.min(w, h) * 0.14);
  for (let seed = 0; seed < dark.length; seed++) {
    if (dark[seed] !== 1) continue;
    let head = 0, tail = 1, minX = w, minY = h, maxX = 0, maxY = 0, count = 0;
    queue[0] = seed; dark[seed] = 2;
    while (head < tail) {
      const at = queue[head++], x = at % w, y = (at / w) | 0;
      count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const next = ny * w + nx;
        if (dark[next] === 1) { dark[next] = 2; queue[tail++] = next; }
      }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const fill = count / (bw * bh), side = (bw + bh) / 2;
    if (side < 4 || side > maxSide || bw / bh < 0.65 || bw / bh > 1.55 || fill < 0.42) continue;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    // The centre is a printed white dot. A solid dark shape fails here.
    let centreBright = 0;
    const nativeX = (cx + 0.5) * step, nativeY = (cy + 0.5) * step;
    const sample = (x, y) => {
      const px = Math.max(0, Math.min(width - 1, Math.round(x)));
      const py = Math.max(0, Math.min(height - 1, Math.round(y)));
      const i = (py * width + px) * 4;
      return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    };
    const centreRadius = Math.max(1, Math.min(side * step * 0.12, 3));
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      centreBright = Math.max(centreBright, sample(nativeX + ox * centreRadius, nativeY + oy * centreRadius));
    }
    if (centreBright < 125) continue;
    let ringDark = 0;
    const radius = Math.max(1.5, side * step * 0.23);
    for (let n = 0; n < 8; n++) {
      const angle = n * Math.PI / 4;
      if (sample(nativeX + radius * Math.cos(angle), nativeY + radius * Math.sin(angle)) < 125) ringDark++;
    }
    if (ringDark < 5) continue;
    candidates.push({ x: cx, y: cy, side, fill, ringDark });
  }
  if (candidates.length < 4) return null;
  // Components other than markers are common in lens photographs. Require a
  // coherent four-corner layout, matching marker sizes and the 100:70 sheet.
  const pool = candidates.sort((a, b) => b.ringDark - a.ringDark || b.side - a.side).slice(0, 28);
  let best = null, bestScore = Infinity;
  for (let a = 0; a < pool.length - 3; a++) for (let b = a + 1; b < pool.length - 2; b++)
    for (let c = b + 1; c < pool.length - 1; c++) for (let d = c + 1; d < pool.length; d++) {
      const quad = [pool[a], pool[b], pool[c], pool[d]];
      const sizes = quad.map(p => p.side), minSize = Math.min(...sizes), maxSize = Math.max(...sizes);
      if (maxSize / minSize > 1.9) continue;
      const mx = quad.reduce((s, p) => s + p.x, 0) / 4, my = quad.reduce((s, p) => s + p.y, 0) / 4;
      quad.sort((p, q) => Math.atan2(p.y - my, p.x - mx) - Math.atan2(q.y - my, q.x - mx));
      const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const turns = quad.map((p, i) => cross(p, quad[(i + 1) % 4], quad[(i + 2) % 4]));
      if (turns.some(t => t <= 0)) continue;
      const len = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
      const edges = quad.map((p, i) => len(p, quad[(i + 1) % 4]));
      const long = Math.max(...edges), short = Math.min(...edges);
      if (short < maxSize * 7 || long / short > 2.2) continue;
      const opposite = Math.max(edges[0] / edges[2], edges[2] / edges[0], edges[1] / edges[3], edges[3] / edges[1]);
      if (opposite > 1.55) continue;
      const aspect = (edges[0] + edges[2]) / (edges[1] + edges[3]);
      // Rotate cyclically to put the two long horizontal sheet sides at 0/2.
      if (aspect < 1) { quad.push(quad.shift()); edges.push(edges.shift()); }
      const ratio = (edges[0] + edges[2]) / (edges[1] + edges[3]);
      if (ratio < 1.18 || ratio > 1.85) continue;
      const meanSize = sizes.reduce((s, n) => s + n, 0) / 4;
      const widthInMarkers = (edges[0] + edges[2]) / (2 * meanSize);
      const heightInMarkers = (edges[1] + edges[3]) / (2 * meanSize);
      if (widthInMarkers < 9 || widthInMarkers > 27 || heightInMarkers < 6 || heightInMarkers > 20) continue;
      const score = Math.abs(Math.log(ratio / (100 / 70))) * 2 + Math.log(opposite) + Math.log(maxSize / minSize) + quad.reduce((s, p) => s + (8 - p.ringDark) * 0.03, 0);
      if (score < bestScore) { best = quad.slice(); bestScore = score; }
    }
  if (!best || bestScore > 0.75) return null;
  // Cyclic order is clockwise; choose the visually upper of the two long
  // sides. This assumes the sheet is not photographed upside-down.
  if ((best[0].y + best[1].y) > (best[2].y + best[3].y)) best = [best[2], best[3], best[0], best[1]];
  if (best[0].x > best[1].x) best = [best[1], best[0], best[3], best[2]];
  return best.map(p => [Math.round((p.x + 0.5) * step), Math.round((p.y + 0.5) * step)]);
}
