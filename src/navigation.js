// Bounded local routing against the furnished floor, not room-centre waypoints.
export function clearSegment(from, to, radius, colliders) {
  for (const c of colliders) {
    let lo = 0, hi = 1;
    for (const [axis, min, max] of [['x', c.minX - radius, c.maxX + radius], ['z', c.minZ - radius, c.maxZ + radius]]) {
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < 1e-9) {
        if (from[axis] <= min || from[axis] >= max) { hi = -1; break; }
      } else {
        const a = (min - from[axis]) / delta, b = (max - from[axis]) / delta;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
    }
    if (hi >= lo && hi >= 0 && lo <= 1) return false;
  }
  return true;
}

export function localPath(map, from, to, radius, ignore = null) {
  const colliders = map.colliders.filter((c) => c !== ignore);
  if (clearSegment(from, to, radius, colliders)) return [{ ...to }];
  if (!clearSegment(from, from, radius, colliders) || !clearSegment(to, to, radius, colliders)) return null;
  const cell = 0.25;
  const bounds = map.bounds ?? {
    minX: Math.min(from.x, to.x) - 8, maxX: Math.max(from.x, to.x) + 8,
    minZ: Math.min(from.z, to.z) - 8, maxZ: Math.max(from.z, to.z) + 8,
  };
  const w = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
  const h = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1;
  if (w * h > 100000) return null;
  const point = (id) => ({ x: bounds.minX + id % w * cell, z: bounds.minZ + Math.floor(id / w) * cell });
  const blocked = new Uint8Array(w * h);
  for (const c of colliders) {
    const x0 = Math.max(0, Math.ceil((c.minX - radius - bounds.minX) / cell));
    const x1 = Math.min(w - 1, Math.floor((c.maxX + radius - bounds.minX) / cell));
    const z0 = Math.max(0, Math.ceil((c.minZ - radius - bounds.minZ) / cell));
    const z1 = Math.min(h - 1, Math.floor((c.maxZ + radius - bounds.minZ) / cell));
    if (x1 < x0 || z1 < z0) continue;
    for (let z = z0; z <= z1; z++) blocked.fill(1, z * w + x0, z * w + x1 + 1);
  }
  const attach = (p) => {
    const x = Math.round((p.x - bounds.minX) / cell), z = Math.round((p.z - bounds.minZ) / cell);
    const candidates = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, nz = z + dz, id = nz * w + nx;
      if (nx < 0 || nx >= w || nz < 0 || nz >= h || blocked[id]) continue;
      const q = point(id);
      if (clearSegment(p, q, radius, colliders)) candidates.push({ id, d: Math.hypot(q.x - p.x, q.z - p.z) });
    }
    return candidates.sort((a, b) => a.d - b.d)[0]?.id;
  };
  const start = attach(from), end = attach(to);
  if (start === undefined || end === undefined) return null;
  const cost = new Float64Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const heap = [];
  const heuristic = (id) => Math.hypot(id % w - end % w, Math.floor(id / w) - Math.floor(end / w));
  function push(id, f) {
    let i = heap.length;
    heap.push({ id, f });
    while (i && heap[(i - 1) >> 1].f > f) {
      heap[i] = heap[(i - 1) >> 1]; i = (i - 1) >> 1;
    }
    heap[i] = { id, f };
  }
  function pop() {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++;
        if (heap[child].f >= last.f) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first.id;
  }
  cost[start] = 0; push(start, heuristic(start));
  let visits = 0;
  while (heap.length && visits++ < w * h * 2) {
    const id = pop();
    if (closed[id]) continue;
    if (id === end) {
      const raw = [{ ...to }];
      for (let n = end; n !== -1; n = prev[n]) raw.unshift(point(n));
      const route = [];
      let p = from, i = 0;
      while (i < raw.length) {
        let next = i;
        while (next + 1 < raw.length && clearSegment(p, raw[next + 1], radius, colliders)) next++;
        route.push(raw[next]); p = raw[next]; i = next + 1;
      }
      return route;
    }
    closed[id] = 1;
    const x = id % w, z = Math.floor(id / w);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = x + dx, nz = z + dz, next = nz * w + nx;
      if (nx < 0 || nx >= w || nz < 0 || nz >= h || blocked[next] || closed[next]) continue;
      if (dx && dz && (blocked[z * w + nx] || blocked[nz * w + x])) continue;
      const g = cost[id] + Math.hypot(dx, dz);
      if (g >= cost[next] || !clearSegment(point(id), point(next), radius, colliders)) continue;
      cost[next] = g; prev[next] = id; push(next, g + heuristic(next));
    }
  }
  return null;
}
