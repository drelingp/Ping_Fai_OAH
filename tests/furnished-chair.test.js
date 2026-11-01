import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { furnishedFloor } from './helpers/floor.js';

const { map, scene } = await furnishedFloor();
const { createChairs } = await import('../src/chair.js');
const { clearSegment, localPath } = await import('../src/navigation.js');
const { resolveCollisions } = await import('../src/map.js');
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function fixture(starts) {
  const residents = starts.map((pos, i) => ({
    name: `Resident ${i}`, alive: true, chairEligible: true, wellbeing: 50,
    pos: { x: pos.x, z: pos.z }, mesh: new THREE.Group(), bed: map.beds[i],
    roomId: map.roomAt(pos.x, pos.z).id,
  }));
  const n = { name: 'Nurse', pos: { x: 15.7, z: 29.05 }, mesh: new THREE.Group(), path: [] };
  const s = {
    residents, nurses: [n], onShift: [n], player: { ...starts[0] }, now: 480,
    running: true, paused: false, ended: false,
  };
  const toasts = [];
  const chairs = createChairs({
    s, scene, map, dist, resolveCollisions, harm: { checkHealth() {} },
    ui: { toast: (message) => toasts.push(message) }, fmtTime: String,
  });
  return { s, chairs, residents, n, toasts };
}

function finishTrip(f, r) {
  for (let frames = 0; frames < 6000 && f.n.chairJob; frames++) {
    const before = { ...r.pos };
    f.chairs.advanceStaff(f.n, 0.05);
    assert.ok(dist(before, r.pos) <= 0.037501, 'no resident teleport');
    assert.ok(clearSegment(before, r.pos, 0.48, [
      ...map.colliders.filter((c) => c !== r.chair.collider), ...map.chairParkingObstacles,
    ]), 'chair must avoid furniture and already parked chairs along the whole route');
  }
  assert.equal(f.n.chairJob, null, f.toasts.join('\n'));
  assert.ok(r.chairActivity, f.toasts.join('\n'));
}

test('loaded furnished-floor staff routes reach TV and garden without chair or nurse clipping', () => {
  assert.ok(map.colliders.some((c) => Math.abs(c.minX - 12.4) < 1e-6 && Math.abs(c.minZ - 2) < 1e-6),
    'the real coffee-table collider must be present');
  for (const [start, nurseStart, destination] of [
    [{ x: 13, z: 8 }, { x: 15.7, z: 29.05 }, 'tv'],
    [{ x: 13, z: 7.4 }, { x: 13, z: 8.5 }, 'garden'],
    [{ x: 10.4, z: 22.7 }, { x: 11.4, z: 22.7 }, 'garden'],
    [{ x: 13, z: 7.4 }, { x: 15.7, z: 29.05 }, 'garden'],
  ]) {
    const r = {
      name: 'Resident', alive: true, chairEligible: true, wellbeing: 50,
      pos: { ...start }, mesh: new THREE.Group(), bed: map.beds[0],
    };
    const n = { name: 'Nurse', pos: { ...nurseStart }, mesh: new THREE.Group(), path: [] };
    const s = {
      residents: [r], nurses: [n], onShift: [n], player: { ...start }, now: 480,
      running: true, paused: false, ended: false,
    };
    const toasts = [];
    const chairs = createChairs({
      s, scene, map, dist, resolveCollisions, harm: { checkHealth() {} },
      ui: { toast: (message) => toasts.push(message) }, fmtTime: String,
    });
    assert.ok(chairs.seat(r, start));
    assert.equal(chairs.requestStaff(r, destination), true, toasts.join('\n'));
    let frames = 0;
    for (; frames < 6000 && n.chairJob; frames++) {
      const before = { ...r.pos }, nurseBefore = { ...n.pos };
      chairs.advanceStaff(n, 0.05);
      const obstacles = map.colliders.filter((c) => c !== r.chair.collider);
      assert.ok(clearSegment(before, r.pos, 0.48, [...obstacles, ...map.chairParkingObstacles]),
        `chair clipping at ${JSON.stringify(r.pos)}`);
      assert.ok(clearSegment(nurseBefore, n.pos, 0.3, [...obstacles, ...map.seats.map((seat) => seat.footprint)]),
        `nurse clipping at ${JSON.stringify(n.pos)}`);
      assert.ok(dist(before, r.pos) <= 0.037501, 'no resident teleport');
      assert.ok(dist(nurseBefore, n.pos) <= 0.08, 'no nurse teleport');
      if (n.chairJob?.phase === 'travel') assert.ok(dist(n.pos, r.pos) >= 0.64, 'nurse overlaps occupied chair');
    }
    assert.ok(frames < 6000, `route did not finish: ${JSON.stringify(r.pos)}`);
    assert.ok(r.chairActivity, `trip cancelled: ${toasts.join('\n')}`);
    assert.equal(r.roomId, destination === 'tv' ? 'livA' : 'garden');
    assert.equal(r.chair.owner, null);
    assert.ok(clearSegment(r.pos, r.pos, 0.48, map.seats.map((seat) => seat.footprint)),
      'parking must avoid rendered fixed seats, even when they are empty');
    if (destination === 'tv') assert.ok(dist(start, r.pos) > 2, 'TV test must exercise a real journey');
    chairs.minute(484);
    assert.equal(r.wellbeing, 55);
    chairs.remove(r);
  }
});

test('fixed-seat transfers use adjacent clear space without losing the assigned bed or another seat occupant', () => {
  for (const seat of [
    map.seats.find((seat) => seat.x === 13.7 && seat.z === 4),
    map.seats.find((seat) => seat.x === 14.4 && seat.z === 5.6),
    map.seats.find((seat) => seat.x === 10.4 && seat.z === 23.7),
    map.seats.find((seat) => seat.room === 'garden'),
  ]) {
    const f = fixture([seat]), r = f.residents[0], bed = r.bed;
    const neighbor = map.seats.find((other) => other !== seat && other.room === seat.room);
    const occupant = { name: 'Other resident', alive: true, pos: { x: neighbor.x, z: neighbor.z } };
    r.mode = 'seat'; r.seat = seat; seat.occupant = r; bed.occupant = r;
    neighbor.occupant = occupant;
    try {
      assert.equal(f.chairs.transfer(r), true, `${seat.room}: ${f.toasts.join('\n')}`);
      assert.ok(dist(seat, r.pos) > 0.7 && dist(seat, r.pos) <= 1.6, 'transfer stays adjacent');
      assert.ok(clearSegment(r.pos, r.pos, 0.48, map.chairParkingObstacles), 'no overlap with any fixed seat');
      assert.ok(clearSegment(seat, r.pos, 0.34, [
        ...map.colliders.filter((c) => c !== r.chair.collider),
        ...map.chairParkingObstacles.filter((c) => c !== seat.footprint),
      ]), 'assisted transfer cannot cross a table, wall, or neighboring seat');
      assert.equal(seat.occupant, null);
      assert.equal(r.seat, null);
      assert.equal(neighbor.occupant, occupant);
      assert.deepEqual(occupant.pos, { x: neighbor.x, z: neighbor.z });
      assert.equal(r.bed, bed);
      assert.equal(bed.occupant, r);
      assert.equal(r.mode, 'chair');
      assert.equal(r.chairEligible, true);
      if (seat.x === 13.7 && seat.z === 4) {
        f.s.player = { ...r.pos };
        assert.equal(f.chairs.requestStaff(r, 'tv'), true, f.toasts.join('\n'));
        finishTrip(f, r);
        assert.equal(r.roomId, 'livA');
        assert.equal(bed.occupant, r);
      }
    } finally {
      f.chairs.remove(r); seat.occupant = null; neighbor.occupant = null; bed.occupant = null;
    }
  }
});

test('a second TV outing parks separately from the first chair and occupied fixed seats', () => {
  const f = fixture([{ x: 13, z: 8 }, { x: 13, z: 8 }]);
  const [first, second] = f.residents;
  const seat = map.seats.find((seat) => seat.x === 13.7 && seat.z === 4);
  const occupant = { name: 'TV viewer', alive: true, pos: { x: seat.x, z: seat.z } };
  seat.occupant = occupant;
  try {
    assert.ok(f.chairs.seat(first, first.pos));
    assert.equal(f.chairs.requestStaff(first, 'tv'), true);
    finishTrip(f, first);
    const parked = { ...first.pos };
    f.s.player = { ...second.pos };
    assert.ok(f.chairs.seat(second, second.pos));
    f.n.pos = { x: 15.7, z: 29.05 };
    assert.equal(f.chairs.requestStaff(second, 'tv'), true, f.toasts.join('\n'));
    assert.ok(dist(f.n.chairJob.target, parked) >= 0.96, 'select another free parking spot');
    finishTrip(f, second);
    assert.equal(second.roomId, 'livA');
    assert.ok(dist(first.pos, second.pos) >= 0.96);
    assert.deepEqual(first.pos, parked);
    assert.equal(seat.occupant, occupant);
    assert.deepEqual(occupant.pos, { x: seat.x, z: seat.z });
    for (const r of [first, second]) {
      assert.ok(clearSegment(r.pos, r.pos, 0.48, map.chairParkingObstacles));
      assert.ok(map.colliders.includes(r.chair.collider));
      assert.equal(r.chair.owner, null);
    }
  } finally {
    for (const r of f.residents) f.chairs.remove(r);
    seat.occupant = null;
  }
});

test('an unavailable furnished destination fails explicitly without reserving staff or moving the chair', () => {
  const f = fixture([{ x: 13, z: 8 }]), r = f.residents[0];
  assert.ok(f.chairs.seat(r, r.pos));
  const barrier = { minX: 10, maxX: 16, minZ: 2, maxZ: 7.3 };
  map.colliders.push(barrier);
  const before = { ...r.pos };
  try {
    assert.equal(f.chairs.requestStaff(r, 'tv'), false);
    assert.deepEqual(r.pos, before);
    assert.equal(r.chair.owner, undefined);
    assert.equal(f.n.chairJob, undefined);
    assert.equal(r.chairActivity, undefined);
    assert.match(f.toasts.at(-1), /route.*blocked.*cancelled/i);
  } finally {
    map.colliders.splice(map.colliders.indexOf(barrier), 1);
    f.chairs.remove(r);
  }
});

test('a blocked fixed-seat transfer leaves seat and bed ownership intact rather than crossing an obstacle', () => {
  const seat = map.seats.find((seat) => seat.x === 13.7 && seat.z === 4);
  const f = fixture([seat]), r = f.residents[0];
  r.mode = 'seat'; r.seat = seat; seat.occupant = r; r.bed.occupant = r;
  const barriers = [
    { minX: seat.x - 0.8, maxX: seat.x - 0.75, minZ: seat.z - 2, maxZ: seat.z + 2 },
    { minX: seat.x + 0.75, maxX: seat.x + 0.8, minZ: seat.z - 2, maxZ: seat.z + 2 },
    { minX: seat.x - 2, maxX: seat.x + 2, minZ: seat.z - 0.8, maxZ: seat.z - 0.75 },
    { minX: seat.x - 2, maxX: seat.x + 2, minZ: seat.z + 0.75, maxZ: seat.z + 0.8 },
  ];
  map.colliders.push(...barriers);
  try {
    assert.equal(f.chairs.transfer(r), false);
    assert.equal(r.chair, undefined);
    assert.equal(r.mode, 'seat');
    assert.equal(r.seat, seat);
    assert.equal(seat.occupant, r);
    assert.equal(r.bed.occupant, r);
    assert.deepEqual(r.pos, { x: seat.x, z: seat.z });
    assert.match(f.toasts.at(-1), /not enough clear space/i);
  } finally {
    for (const barrier of barriers) map.colliders.splice(map.colliders.indexOf(barrier), 1);
    seat.occupant = null; r.bed.occupant = null;
  }
});

test('local navigation reports unreachable destinations and respects the entire chair footprint', () => {
  assert.equal(localPath(map, { x: 13.7, z: 4 }, { x: 13, z: 2.2 }, 0.48), null);
  const blocked = {
    bounds: { minX: 0, maxX: 5, minZ: 0, maxZ: 5 },
    colliders: [{ minX: 2, maxX: 3, minZ: 0, maxZ: 5 }],
  };
  assert.equal(localPath(blocked, { x: 1, z: 2 }, { x: 4, z: 2 }, 0.48), null);
  const narrow = {
    colliders: [
      { minX: 1, maxX: 2, minZ: -5, maxZ: -0.4 },
      { minX: 1, maxX: 2, minZ: 0.4, maxZ: 5 },
    ],
  };
  assert.equal(clearSegment({ x: 0, z: 0 }, { x: 3, z: 0 }, 0.3, narrow.colliders), true);
  assert.equal(clearSegment({ x: 0, z: 0 }, { x: 3, z: 0 }, 0.48, narrow.colliders), false);
});
