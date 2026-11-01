import * as THREE from 'three';
import { pose } from './people.js';
import { t, translate } from './i18n.js';
import { clearSegment, localPath } from './navigation.js';

const DESTINATIONS = {
  tv: { label: 'chair.dest.tv', room: 'livA', point: { x: 13, z: 5.2 } },
  garden: { label: 'chair.dest.garden', room: 'garden', point: { x: 10, z: 60 } },
};

function makeChair() {
  const group = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x8798a0, roughness: 0.65, metalness: 0.25 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0x607d8b, roughness: 0.9 });
  const add = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  add(new THREE.BoxGeometry(0.52, 0.12, 0.52), cushion, 0, 0.52, 0);
  add(new THREE.BoxGeometry(0.52, 0.56, 0.1), cushion, 0, 0.88, -0.22);
  for (const x of [-0.29, 0.29]) {
    add(new THREE.BoxGeometry(0.04, 0.58, 0.04), frame, x, 0.49, -0.2);
    add(new THREE.BoxGeometry(0.04, 0.42, 0.04), frame, x, 0.69, 0.2);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.045, 12), frame);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x * 1.15, 0.2, 0);
    group.add(wheel);
  }
  for (const z of [-0.23, 0.23]) add(new THREE.BoxGeometry(0.58, 0.04, 0.04), frame, 0, 0.23, z);
  return group;
}

export function createChairs({ s, scene, map, ui, dist, resolveCollisions, harm, fmtTime }) {
  const footprint = (point, radius = 0.48) => ({
    minX: point.x - radius, maxX: point.x + radius,
    minZ: point.z - radius, maxZ: point.z + radius,
  });
  const fixedSeats = (map.seats ?? []).map((seat) => ({
    seat, collider: seat.footprint ?? footprint(seat, 0.4),
  }));
  function obstacles(r, reservations = false, allSeats = true) {
    const out = map.colliders.filter((c) => c !== r.chair?.collider);
    out.push(...fixedSeats.map(({ collider }) => collider));
    if (allSeats) out.push(...(map.chairParkingObstacles ?? []));
    for (const other of s.residents) {
      if (other !== r && other.chair) out.push(footprint(other.chair.pos));
    }
    if (reservations) for (const n of new Set([...s.nurses, ...s.onShift])) {
      if (n.chairJob && n.chairJob.resident !== r) out.push(footprint(n.chairJob.target));
    }
    return out;
  }
  function nearby(point, radius) {
    const candidates = [];
    const steps = Math.ceil(radius / 0.2);
    for (let dx = -steps; dx <= steps; dx++) for (let dz = -steps; dz <= steps; dz++) {
      const p = { x: point.x + dx * 0.2, z: point.z + dz * 0.2 };
      if (dist(point, p) <= radius + 1e-6) candidates.push(p);
    }
    return candidates.sort((a, b) => dist(a, point) - dist(b, point));
  }
  function addCollider(chair) {
    Object.assign(chair.collider, {
      minX: chair.pos.x - 0.48, maxX: chair.pos.x + 0.48,
      minZ: chair.pos.z - 0.48, maxZ: chair.pos.z + 0.48,
    });
    if (!map.colliders.includes(chair.collider)) map.colliders.push(chair.collider);
  }
  function removeCollider(chair) {
    const i = map.colliders.indexOf(chair.collider);
    if (i !== -1) map.colliders.splice(i, 1);
  }
  function seat(r, point, heading = 0) {
    const blocked = obstacles(r, true);
    if (!clearSegment(point, point, 0.48, blocked)) {
      point = nearby(point, 0.6).find((p) => map.roomAt(p.x, p.z) &&
        clearSegment(p, p, 0.48, blocked) && clearSegment(point, p, 0.34, blocked));
      if (!point) { ui.toast(t('chair.error.space')); return null; }
    }
    const chair = r.chair ??= { resident: r, pos: { ...point }, heading, mesh: makeChair(), collider: {} };
    chair.pos.x = point.x; chair.pos.z = point.z; chair.heading = heading;
    chair.mesh.position.set(point.x, 0, point.z);
    chair.mesh.rotation.y = heading;
    if (!chair.mesh.parent) scene.add(chair.mesh);
    addCollider(chair);
    r.mode = 'chair'; r.roomId = map.roomAt(point.x, point.z)?.id ?? r.roomId;
    r.pos = { x: point.x, z: point.z };
    pose(r.mesh, 'seat', { x: point.x, z: point.z, f: heading });
    return chair;
  }
  function eligible(r) { return !!r?.alive && !!r.chairEligible && !!r.bed; }
  function atResident(r) {
    return eligible(r) && r.wellbeing > 0 && s.running && !s.ended && !s.paused &&
      dist(s.player, r.pos) <= 2.3;
  }
  function available(n) {
    return s.onShift.includes(n) && !n.suspended && !(n.offFloorUntil > s.now) &&
      !(n.breakUntil > s.now) && !(n.arriveAt > s.now) && !n.refusesHelp && !n.sick;
  }
  function release(n) {
    const r = n.chairJob?.resident;
    if (r?.chair) { r.chair.owner = null; addCollider(r.chair); }
    n.chairJob = null; n.path = []; n.wait = 2;
  }
  function inDestination(r, key) {
    const target = DESTINATIONS[key];
    return r.mode === 'chair' && map.roomAt(r.pos.x, r.pos.z)?.id === target.room &&
      dist(r.pos, target.point) <= 3.2;
  }
  function reward(r, key) {
    if (!atResident(r) || r.chair?.owner || !inDestination(r, key) || r.fallen || s.now - (r.lastChairActivity ?? -Infinity) < 60) {
      ui.toast(t('chair.error.destination'));
      return false;
    }
    r.wellbeing = Math.min(100, r.wellbeing + 5);
    r.lastChairActivity = s.now;
    ui.toast(t('chair.reward', { name: translate(r.name), activity: t(key === 'tv' ? 'chair.activity.tv' : 'chair.activity.garden') }));
    harm.checkHealth?.();
    return true;
  }
  function transfer(r) {
    if (!atResident(r) || r.chair || s.escort || s.pushingChair || s.pushingTrolley || s.mealTray ||
      !['bed', 'seat', 'wander'].includes(r.mode)) return false;
    let point = r.mode === 'bed'
      ? { x: r.bed.x, z: r.bed.z - r.bed.headDir * 1.55 }
      : { x: r.pos.x, z: r.pos.z };
    if (r.mode === 'seat') {
      const source = fixedSeats.find(({ seat }) => seat === r.seat ||
        dist(seat, r.pos) < 0.1);
      const blocked = obstacles(r, true);
      const transferObstacles = blocked.filter((c) => c !== source?.collider);
      point = nearby(r.pos, 1.6).find((p) =>
        map.roomAt(p.x, p.z)?.id === r.roomId &&
        clearSegment(p, p, 0.48, blocked) &&
        clearSegment(r.pos, p, 0.34, transferObstacles));
      if (!point) { ui.toast(t('chair.error.space')); return false; }
    }
    if (!map.roomAt(point.x, point.z) || map.colliders.some((c) =>
      point.x > c.minX - 0.34 && point.x < c.maxX + 0.34 && point.z > c.minZ - 0.32 && point.z < c.maxZ + 0.32)) {
      ui.toast(t('chair.error.space'));
      return false;
    }
    if (!seat(r, point, s.player.heading)) return false;
    if (r.seat) { r.seat.occupant = null; r.seat = null; }
    r.fallen = false;
    r.target = null; r.area = null; r.pause = 0;
    ui.toast(t('chair.seated', { name: translate(r.name) }));
    return true;
  }
  function returnToBed(r) {
    const bedside = { x: r.bed?.x, z: r.bed?.z - r.bed?.headDir * 1.55 };
    if (!atResident(r) || !r.chair || r.chair.owner || r.fallen ||
      dist(r.pos, bedside) > 0.65 ||
      !clearSegment(r.pos, bedside, 0.48, map.colliders.filter((c) => c !== r.chair.collider))) {
      ui.toast(t('chair.error.bedside'));
      return false;
    }
    remove(r);
    r.fallen = false;
    r.mode = 'bed'; r.roomId = r.bed.room; r.pos = { x: r.bed.x, z: r.bed.z };
    pose(r.mesh, 'bed', r.bed);
    return true;
  }
  function remove(r) {
    for (const n of new Set([...s.nurses, ...s.onShift])) if (n.chairJob?.resident === r) release(n);
    r.chairActivity = null;
    r.fallen = false;
    if (r.chair) {
      removeCollider(r.chair);
      r.chair.mesh.removeFromParent();
      r.chair = null;
    }
    if (s.pushingChair?.resident === r) s.pushingChair = null;
  }
  function followPlayer() {
    const moving = s.pushingChair;
    if (!moving) return true;
    const chair = moving.resident.chair;
    if (!chair || !moving.resident.alive) { s.pushingChair = null; return false; }
    const heading = s.player.heading || 0;
    const desired = {
      x: s.player.x + Math.sin(heading) * 0.88,
      z: s.player.z + Math.cos(heading) * 0.88,
    };
    const adjusted = { ...desired };
    const blocked = obstacles(moving.resident);
    resolveCollisions(adjusted, 0.48, blocked);
    if (!clearSegment(chair.pos, adjusted, 0.48, blocked)) return false;
    if (dist(adjusted, desired) > 0.2 || dist(adjusted, s.player) < 0.55) return false;
    chair.pos.x = adjusted.x; chair.pos.z = adjusted.z; chair.heading = heading;
    chair.mesh.position.set(adjusted.x, 0, adjusted.z); chair.mesh.rotation.y = heading;
    const r = moving.resident;
    r.pos = { ...adjusted }; r.roomId = map.roomAt(adjusted.x, adjusted.z)?.id ?? r.roomId;
    pose(r.mesh, 'seat', { x: adjusted.x, z: adjusted.z, f: heading });
    return true;
  }
  function push(r) {
    if (!atResident(r) || !r.chair || r.chair.owner || r.chairActivity || r.fallen || s.pushingChair || s.pushingTrolley || s.mealTray ||
      s.escort || !s.running || s.paused || dist(s.player, r.pos) > 1.8) return false;
    removeCollider(r.chair);
    r.chair.owner = 'player';
    s.pushingChair = { resident: r };
    s.player.heading = Math.atan2(r.pos.x - s.player.x, r.pos.z - s.player.z);
    ui.toast(t('chair.pushing', { name: translate(r.name) }));
    return true;
  }
  function park() {
    const r = s.pushingChair?.resident;
    if (!r?.chair) return;
    if (!clearSegment(r.pos, r.pos, 0.48, obstacles(r, true))) {
      ui.toast(t('chair.error.space'));
      return false;
    }
    addCollider(r.chair);
    r.chair.owner = null;
    s.pushingChair = null;
    ui.toast(t('chair.parked', { name: translate(r.name) }));
  }
  function requestStaff(r, key) {
    const target = DESTINATIONS[key];
    if (!atResident(r) || !r.chair || r.chair.owner || r.fallen || !target || r.chairActivity ||
      map.roomAt(r.pos.x, r.pos.z)?.id === 'garden' && key === 'garden' ||
      !['chair', 'bed', 'seat'].includes(r.mode)) return false;
    const nurse = s.onShift.find((n) => available(n) &&
      !n.bell && !n.escort && !n.routineJob && !n.chairJob &&
      !n.sick);
    if (!nurse) { ui.toast(t('chair.error.noNurse')); return false; }
    if (s.pushingChair || s.pushingTrolley || s.mealTray || s.escort) {
      ui.toast(t('chair.error.transport'));
      return false;
    }
    const chair = r.chair;
    const blocked = obstacles(r, true);
    const routeMap = { ...map, colliders: obstacles(r) };
    const approachObstacles = obstacles(r, false, false);
    let travel, parking;
    for (const point of nearby(target.point, 2)) {
      if (map.roomAt(point.x, point.z)?.id !== target.room ||
        !clearSegment(point, point, 0.48, blocked)) continue;
      const path = localPath(routeMap, r.pos, point, 0.48);
      if (path) { travel = path; parking = point; break; }
    }
    if (!travel) {
      ui.toast(t('chair.error.route', { destination: t(target.label) }));
      return false;
    }
    const first = travel.find((p) => dist(p, r.pos) > 0.1) ?? parking;
    const forward = Math.atan2(first.x - r.pos.x, first.z - r.pos.z);
    const candidates = Array.from({ length: 16 }, (_, i) => {
      const angle = forward + Math.PI + i * Math.PI / 8;
      return { x: r.pos.x + Math.sin(angle) * 1.15, z: r.pos.z + Math.cos(angle) * 1.15,
        priority: Math.cos(angle - forward) };
    }).sort((a, b) => a.priority - b.priority);
    let approach, approachTarget;
    const insideChair = !clearSegment(nurse.pos, nurse.pos, 0.3, [chair.collider]);
    for (const point of candidates) {
      if (!clearSegment(point, r.pos, 0.3, approachObstacles)) continue;
      const path = localPath({ ...map, colliders: [...approachObstacles, ...(insideChair ? [] : [chair.collider])] },
        nurse.pos, point, 0.3);
      if (insideChair && path && (path[0].x - nurse.pos.x) * (nurse.pos.x - r.pos.x) +
        (path[0].z - nurse.pos.z) * (nurse.pos.z - r.pos.z) < 0) continue;
      if (path) { approach = path; approachTarget = point; break; }
    }
    if (!approach || !travel) {
      ui.toast(t('chair.error.route', { destination: t(target.label) }));
      return false;
    }
    chair.owner = nurse;
    nurse.chairJob = { resident: r, destination: key, phase: 'approach', path: approach, approachTarget,
      travel, target: parking, stuck: 0, trail: [], lead: 0 };
    nurse.path = [];
    return true;
  }
  function advanceStaff(n, dt) {
    const job = n.chairJob, r = job?.resident;
    if (!job) return;
    if (!r?.alive || !r.chair || r.chair.owner !== n || r.fallen || s.ended || !available(n)) {
      release(n);
      return;
    }
    if (dt <= 0 || !s.running || s.paused) return;
    if (job.phase === 'approach' && dist(n.pos, job.approachTarget) < 0.08) {
      job.phase = 'travel';
      removeCollider(r.chair);
      job.path = job.travel;
      job.stuck = 0;
      job.trail = [{ ...r.pos }];
      job.lead = dist(n.pos, r.pos);
    }
    if (job.phase === 'travel' && !job.path.length) {
      if (!clearSegment(r.pos, r.pos, 0.48, obstacles(r, true))) {
        release(n);
        ui.toast(t('chair.error.route', { destination: t(DESTINATIONS[job.destination].label) }));
        return;
      }
      release(n); n.wait = 4;
      r.chairActivity = { key: job.destination, due: s.now + 4 };
      ui.toast(t('chair.arrived', {
        nurse: translate(n.name), name: translate(r.name), destination: t(DESTINATIONS[job.destination].label),
      }));
      return;
    }
    if (!job.path.length) return;
    const target = job.path[0];
    const pos = job.phase === 'travel' ? r.pos : n.pos;
    const dx = target.x - pos.x, dz = target.z - pos.z, d = Math.hypot(dx, dz);
    const step = 0.75 * Math.min(dt, 0.1);
    const proposed = d <= step ? { ...target } : { x: pos.x + dx / d * step, z: pos.z + dz / d * step };
    const blocked = obstacles(r, false, job.phase === 'travel');
    const radius = job.phase === 'travel' ? 0.48 : 0.3;
    if (!clearSegment(pos, proposed, radius, blocked)) Object.assign(proposed, pos);
    if (job.phase === 'travel' && job.lead > 1.5) Object.assign(proposed, pos);
    const moved = dist(proposed, pos);
    if (moved < Math.min(step, d) * 0.25 && d > 1e-5) job.stuck += dt;
    else job.stuck = 0;
    if (job.stuck > 8) {
      release(n);
      ui.toast(t('chair.error.route', { destination: t(DESTINATIONS[job.destination].label) }));
      return;
    }
    if (d <= step && moved > 0 || d < 1e-5) job.path.shift();
    if (moved > 1e-4) n.mesh.rotation.y = Math.atan2(dx, dz);
    if (job.phase === 'travel') {
      const chair = r.chair;
      chair.pos.x = proposed.x;
      chair.pos.z = proposed.z;
      chair.heading = n.mesh.rotation.y;
      chair.mesh.position.set(chair.pos.x, 0, chair.pos.z); chair.mesh.rotation.y = chair.heading;
      r.pos = { ...chair.pos }; r.roomId = map.roomAt(r.pos.x, r.pos.z)?.id ?? r.roomId;
      pose(r.mesh, 'seat', { x: r.pos.x, z: r.pos.z, f: chair.heading });
      job.trail.push({ ...r.pos });
      job.lead += moved;
      let budget = Math.min(step, Math.max(0, job.lead - 0.72));
      let blockedFollower = false;
      while (budget > 1e-6 && job.trail.length) {
        const next = job.trail[0], gap = dist(n.pos, next);
        if (gap < 1e-6) { job.trail.shift(); continue; }
        const amount = Math.min(gap, budget);
        const follower = {
          x: n.pos.x + (next.x - n.pos.x) * amount / gap,
          z: n.pos.z + (next.z - n.pos.z) * amount / gap,
        };
        if (!clearSegment(n.pos, follower, 0.3, blocked)) {
          blockedFollower = true;
          break;
        }
        Object.assign(n.pos, follower); job.lead -= amount; budget -= amount;
        if (amount === gap) job.trail.shift();
      }
      job.followerStuck = blockedFollower ? (job.followerStuck ?? 0) + dt : 0;
      if (job.followerStuck > 8) {
        release(n);
        ui.toast(t('chair.error.route', { destination: t(DESTINATIONS[job.destination].label) }));
      }
    } else {
      Object.assign(n.pos, proposed);
    }
    n.mesh.position.set(n.pos.x, 0, n.pos.z);
  }
  function minute(time) {
    for (const n of new Set([...s.nurses, ...s.onShift])) if (n.chairJob) advanceStaff(n, 0);
    for (const r of s.residents) {
      const activity = r.chairActivity;
      if (!r.alive || r.wellbeing <= 0 || r.chair?.owner || !activity || time < activity.due) continue;
      const key = activity.key;
      r.chairActivity = null;
      if (inDestination(r, key) && time - (r.lastChairActivity ?? -Infinity) >= 60) {
        r.wellbeing = Math.min(100, r.wellbeing + 5);
        r.lastChairActivity = time;
        ui.toast(t('chair.reward', {
          name: translate(r.name), activity: t(key === 'tv' ? 'chair.activity.tv' : 'chair.activity.garden'),
        }));
        harm.checkHealth?.();
      } else ui.toast(t('chair.ended', { name: translate(r.name) }));
    }
  }
  function fall(r) {
    if (!eligible(r) || !s.running || s.paused || dist(s.player, r.pos) > 2.3 ||
      r.chair?.owner || r.mode !== 'chair' || !inDestination(r, 'garden') || !r.chair) return false;
    r.chairActivity = null;
    r.fallen = true; r.mode = 'fallen';
    r.chair.pos = { ...r.pos };
    r.chair.mesh.position.set(r.pos.x, 0, r.pos.z);
    r.mesh.rotation.set(0, r.chair.heading, Math.PI / 2);
    r.mesh.position.set(r.pos.x, 0.12, r.pos.z);
    return true;
  }
  function recover(r) {
    if (!atResident(r) || r.chair?.owner || !r.fallen || !r.chair) return false;
    r.fallen = false;
    r.mode = 'chair';
    r.chair.mesh.position.set(r.pos.x, 0, r.pos.z);
    pose(r.mesh, 'seat', { x: r.pos.x, z: r.pos.z, f: r.chair.heading });
    ui.toast(t('chair.recovered', { name: translate(r.name) }));
    ui.closePanel();
    return true;
  }
  function activityInteraction(r) {
    if (!r.alive || r.chair?.owner || r.chairActivity || r.fallen || r.mode !== 'chair') return null;
    const key = Object.keys(DESTINATIONS).find((id) => inDestination(r, id));
    if (!key || s.now - (r.lastChairActivity ?? -Infinity) < 60) return null;
    return {
      kind: 'hold', dur: 2, minutes: 4, pos: r.pos,
      label: t(key === 'tv' ? 'chair.watch' : 'chair.visit', { name: translate(r.name) }),
      run: () => { reward(r, key); },
    };
  }
  function options(r) {
    if (!eligible(r) || !s.running || s.paused || dist(s.player, r.pos) > 2.3) return [];
    if (r.fallen) return [{ label: t('chair.recoverOption'), cls: 'primary', fn: () => recover(r) }];
    const out = [];
    if (!r.chair) out.push({
      label: t('chair.transfer'), cls: 'primary',
      fn: () => { transfer(r); ui.closePanel(); },
    });
    if (r.chair && s.pushingChair?.resident !== r) out.push({
      label: t('chair.pushOption'), cls: 'primary', fn: () => { push(r); ui.closePanel(); },
    });
    if (r.chair && s.pushingChair?.resident !== r && r.mode === 'chair') out.push(
      ...Object.entries(DESTINATIONS).map(([key, target]) => ({
        label: t('chair.askStaff', { destination: t(target.label) }),
        disabled: !!r.chairActivity || !!r.chair.owner,
        fn: () => {
          if (!requestStaff(r, key)) ui.toast(t('chair.error.trip'));
          else ui.closePanel();
        },
      })),
    );
    if (r.chair && !s.pushingChair) out.push({
      label: t('chair.return'), cls: 'primary', fn: () => { returnToBed(r); ui.closePanel(); },
    });
    if (r.mode === 'chair' && inDestination(r, 'garden')) out.push({
      label: t('chair.harmOption'),
      cls: 'danger',
      fn: () => harm.commit(r, {
        id: 'chair-fall', label: 'Deliberately tipped resident from chair in garden', cost: 25,
      }, () => {
        fall(r);
        s.stats.incidents++;
        s.stats.log.push(`${fmtTime(s.now)} — ${r.name} was deliberately tipped from a chair in the garden and fell.`);
      }, () => atResident(r) && r.mode === 'chair' && inDestination(r, 'garden') && !!r.chair && !r.chair.owner),
    });
    return out;
  }
  function interactions() {
    if (!s.pushingChair) return [];
    const r = s.pushingChair.resident;
    return [{
      d: 1.9, pos: s.player, kind: 'tap',
      label: t('chair.parkOption', { name: translate(r.name) }),
      run: park,
    }];
  }
  function reset() {
    if (s.pushingChair) park();
    s.pushingChair = null;
    for (const r of s.residents) {
      if (r.chair) {
        removeCollider(r.chair);
        r.chair.mesh.removeFromParent();
        r.chair = null;
      }
      r.chairActivity = null;
      r.fallen = false;
    }
    for (const n of new Set([...s.nurses, ...s.onShift])) if (n.chairJob) release(n);
  }
  return { eligible, seat, transfer, returnToBed, remove, push, park, followPlayer, advanceStaff, minute, reset, options, activityInteraction, interactions, requestStaff, fall, recover };
}
