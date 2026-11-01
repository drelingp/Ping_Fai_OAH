// Unauthorised restraint as a two-person escort: the player and one free nurse walk the resident
// back to their own bed, where the restraint is applied. Short-staffed, the player goes alone and
// the resident is more likely to resist (non-graphic: a push or swat that briefly stops the escort).

const SPEED = 0.75;
const HELPER_TIMEOUT = 50;

export function createEscort({ s, map, ui, dist, rnd, bedSide, placeInBed, nurseGoto, resolveCollisions, gesture, pose, wanderAreas = [] }) {
  const free = (p, rad) => !map.colliders.some((c) => p.x > c.minX - rad && p.x < c.maxX + rad && p.z > c.minZ - rad && p.z < c.maxZ + rad);

  function availableHelper(near) {
    return s.onShift
      .filter((n) => (!n.arriveAt || s.now >= n.arriveAt) && !n.bell && !n.routineJob && !n.escort && !n.suspended && !n.refusesHelp && !(n.offFloorUntil > s.now) && !(n.breakUntil > s.now))
      .map((n) => ({ n, d: dist(n.pos, near) }))
      .filter((x) => x.d < 40)
      .sort((a, b) => a.d - b.d)[0]?.n ?? null;
  }

  function recruit(e) {
    const n = availableHelper(e.r.pos);
    if (!n) return false;
    n.escort = true;
    n.wait = 0;
    e.helper = n;
    e.solo = false;
    e.gatherT = 0;
    e.phase = 'gather';
    nurseGoto(n, { x: e.r.pos.x, z: e.r.pos.z });
    return true;
  }

  function start(r, onArrive) {
    if (s.escort || !r.alive || !r.bed) return false;
    const e = { r, onArrive, helper: null, solo: true, phase: 'gather', gatherT: 0, path: [], pause: 0, resist: 0, trail: [], stuck: 0, fromMode: r.mode, accT: 0 };
    s.escort = e;
    if (r.seat) { r.seat.occupant = null; r.seat = null; }
    if (r.mode !== 'bed') {
      r.mode = 'escort';
      pose(r.mesh, 'stand');
      r.mesh.position.set(r.pos.x, 0, r.pos.z);
    }
    if (recruit(e)) ui.toast(`${e.helper.name} comes over to help you take ${r.name} back to bed.`, 4500);
    else {
      ui.toast('No nurse is free — you escort the resident alone. They are more likely to resist.', 4500);
      beginWalk(e);
    }
    return true;
  }

  function beginWalk(e) {
    const r = e.r;
    e.phase = 'walk';
    if (e.helper) e.helper.path = [];
    if (r.mode === 'bed') { arrive(e); return; }
    e.path = map.path(r.pos, bedSide(r.bed));
    e.trail = [{ x: r.pos.x, z: r.pos.z }];
  }

  function release(e) {
    if (e.helper) { e.helper.escort = false; e.helper.path = []; e.helper.wait = rnd(3, 6); }
    s.escort = null;
  }

  function arrive(e) {
    const r = e.r;
    placeInBed(r);
    gesture(s.player.mesh, 'interact', 1.6);
    if (e.helper) gesture(e.helper.mesh, 'interact', 1.6);
    gesture(r.mesh, 'hit', 1.2);
    e.onArrive?.(r);
    ui.toast(`${r.name} is strapped to Bed ${r.bed.id}. This is harm, not care.`, 4500);
    release(e);
  }

  function cancel(reason = 'abandon') {
    const e = s.escort;
    if (!e) return;
    const r = e.r;
    release(e);
    if (!r.alive) return;
    if (r.mode === 'escort') {
      const room = map.roomAt(r.pos.x, r.pos.z);
      if (room && wanderAreas.includes(room.id) && r.mobility === 'walking') {
        r.mode = 'wander'; r.area = room.id; r.roomId = room.id; r.target = null;
      } else placeInBed(r);
    }
    if (reason === 'abandon') ui.toast('You let go. The restraint was not applied, but the conduct penalty stands.', 4500);
  }

  // Walk a party member to a formation point, falling back to the breadcrumb trail in tight spots.
  function place(member, side, back, e, dirX, dirZ) {
    const r = e.r;
    const px = -dirZ, pz = dirX;
    let p = { x: r.pos.x + px * side * 0.5 - dirX * back, z: r.pos.z + pz * side * 0.5 - dirZ * back };
    if (!free(p, 0.28)) {
      const idx = Math.max(0, e.trail.length - 1 - Math.round((back + 0.6) / 0.15));
      p = { ...e.trail[idx] };
    }
    resolveCollisions(p, 0.28, map.colliders);
    member.x = p.x; member.z = p.z;
    return p;
  }

  function resistEvent(e) {
    const r = e.r;
    e.resist++;
    const target = e.helper && Math.random() < 0.6 ? e.helper : null;
    gesture(r.mesh, 'push', 1.0);
    if (target) gesture(target.mesh, 'hit', 0.9); else gesture(s.player.mesh, 'hit', 0.9);
    e.phase = 'paused';
    e.pause = rnd(2, 3);
    const who = target ? target.name : 'you';
    ui.toast(`${r.name} pushes ${who} away in fear — the escort stops for a moment.`, 3500);
    if (!e.helper) {
      const before = e.helper;
      if (recruit(e) && !before) ui.toast(`You call for backup. ${e.helper.name} is on the way.`, 3500);
    }
  }

  function update(dt) {
    const e = s.escort;
    if (!e || dt <= 0) return;
    const r = e.r;
    if (!r.alive || !s.running) { cancel('silent'); return; }
    if (e.phase === 'gather') {
      e.gatherT += dt;
      const h = e.helper;
      if (!h || e.gatherT > HELPER_TIMEOUT) {
        if (h) { h.escort = false; h.path = []; e.helper = null; e.solo = true; ui.toast('Your colleague did not come — you go on alone.', 3500); }
        beginWalk(e);
        return;
      }
      if (dist(h.pos, r.pos) < 1.4) {
        h.path = [];
        beginWalk(e);
      }
      return;
    }
    if (e.phase === 'paused') {
      e.pause -= dt;
      if (e.pause <= 0) e.phase = e.helper && dist(e.helper.pos, r.pos) > 1.6 ? 'gather' : 'walk';
      if (e.phase === 'gather') e.gatherT = 0;
      return;
    }
    // walking toward the bedside
    e.accT += dt;
    while (e.accT >= 1) {
      e.accT -= 1;
      const chance = e.solo ? 0.09 : 0.035;
      if (e.resist < 3 && Math.random() < chance) { resistEvent(e); return; }
    }
    if (!e.path.length) {
      if (dist(r.pos, bedSide(r.bed)) < 0.45) { arrive(e); return; }
      e.path = [bedSide(r.bed)];
    }
    const t = e.path[0];
    const dx = t.x - r.pos.x, dz = t.z - r.pos.z, d = Math.hypot(dx, dz);
    const step = SPEED * dt;
    const bx = r.pos.x, bz = r.pos.z;
    if (d <= Math.max(step, 0.12)) { r.pos.x = t.x; r.pos.z = t.z; e.path.shift(); }
    else { r.pos.x += (dx / d) * step; r.pos.z += (dz / d) * step; }
    resolveCollisions(r.pos, 0.25, map.colliders);
    const moved = Math.hypot(r.pos.x - bx, r.pos.z - bz);
    e.stuck = moved < step * 0.25 ? e.stuck + dt : 0;
    if (e.stuck > 1.5) { r.pos.x = t.x; r.pos.z = t.z; e.path.shift(); e.stuck = 0; }
    const last = e.trail[e.trail.length - 1];
    if (Math.hypot(r.pos.x - last.x, r.pos.z - last.z) > 0.15) { e.trail.push({ x: r.pos.x, z: r.pos.z }); if (e.trail.length > 40) e.trail.shift(); }
    const dirX = d > 1e-4 ? dx / d : 0, dirZ = d > 1e-4 ? dz / d : 1;
    const heading = Math.atan2(dirX, dirZ);
    r.mesh.position.set(r.pos.x, 0, r.pos.z);
    r.mesh.rotation.y = heading;
    r.roomId = map.roomAt(r.pos.x, r.pos.z)?.id ?? r.roomId;
    place(s.player, -1, 0.15, e, dirX, dirZ);
    s.player.heading = heading;
    if (e.helper) {
      const h = e.helper;
      place(h.pos, 1, 0.15, e, dirX, dirZ);
      h.mesh.position.set(h.pos.x, 0, h.pos.z);
      h.mesh.rotation.y = heading;
    }
  }

  const active = () => s.escort;
  return { start, update, cancel, active };
}
