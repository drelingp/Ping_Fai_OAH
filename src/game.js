import * as THREE from 'three';
import { SHIFTS, NURSES, SURNAMES, MALE, FEMALE, PERSONALITIES, ROUTINES, NEEDS, BELL_NEEDS, WANDER_AREAS, DIFFICULTY, DEFAULT_DIFFICULTY, bellChance } from './data.js';
import { makeResident, makeNurse, makeRestraintProps, makeUrineBag, pose } from './people.js';
import { createHarm } from './harm.js';
import { createEscort } from './escort.js';
import { createTrolleys } from './trolley.js';
import { createRoutine } from './routine.js';
import { createColleague, offFloor } from './colleague.js';
import { createOdour, dirty, hygieneText } from './odour.js';
import { gesture } from './assets.js';
import { resolveCollisions } from './map.js';
import { createCase1 } from './case1.js';
import { esc, fmtTime } from './ui.js';
import { languageButtons, t, translate } from './i18n.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const BED_PRIORITY = {
  bedbound: ['bed1', 'bed6', 'bed2', 'bed5', 'bed3', 'bed4'],
  wheelchair: ['bed2', 'bed5', 'bed6', 'bed1', 'bed3', 'bed4'],
  walking: ['bed3', 'bed5', 'bed2', 'bed6', 'bed1', 'bed4'],
};
const ASSIGNABLE = ['bed1', 'bed2', 'bed3', 'bed4', 'bed5', 'bed6'];
const CHAT = [
  '"Is it morning already? The lights never change in here."',
  '"My daughter is coming on Sunday. She said Sunday."',
  '"You\'re the new one in charge? Good. Somebody should be."',
  '"Don\'t tell the others I asked, but could you sit a minute?"',
  '"They put pumpkins up. As if we\'re children."',
  '"The night nurse shouts. I keep my eyes shut and pretend."',
];

export function createGame({ scene, map, ui, input, player, env }) {
  const STATION_SPOTS = map.station.spots;
  const s = {
    day: 1, shiftIdx: 0, now: 7 * 60, shiftStart: 7 * 60, shiftEnd: 14 * 60, nextMinute: 7 * 60 + 1,
    residents: [], nurses: [], onShift: [], bells: [],
    reputation: 70, suspicion: 0, linen: false, medicineRound: false, difficulty: DEFAULT_DIFFICULTY,
    waypoint: null, paused: false, running: false,
    stats: null, relief: null, nextBellId: 1, ended: false, inquiry: false, conductReports: [], totalHarm: 0, conductInquiry: false,
    player,
  };
  const game = { state: s };
  let nextId = 1;

  // ---------- roster ----------
  function newResident(o = {}) {
    const sex = o.sex ?? (Math.random() < 0.6 ? 'F' : 'M');
    const mobility = o.mobility ?? pick(['bedbound', 'bedbound', 'wheelchair', 'walking', 'walking']);
    const surname = o.surname ?? pick(SURNAMES);
    const r = {
      id: nextId++, seed: Math.floor(Math.random() * 1e6), sex,
      name: o.name ?? `${sex === 'F' ? 'Mrs.' : 'Mr.'} ${surname} ${pick(sex === 'F' ? FEMALE : MALE)}`,
      age: o.age ?? Math.floor(rnd(68, 98)), mobility,
      personality: o.personality ?? pick(PERSONALITIES), routine: o.routine ?? pick(ROUTINES),
      needs: o.needs ?? [...NEEDS[mobility]].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2)),
      wellbeing: o.wellbeing ?? rnd(55, 88), alive: true, bed: null, seat: null, mode: 'bed', area: null,
      roomId: null, pos: { x: 0, z: 0 }, target: null, mesh: null, lastSeen: null,
      story: o.story ?? false, note: o.note ?? '', single: o.single ?? null, case: o.case ?? false, lastChat: -999,
      hygiene: { body: false, bedding: false, bag: false },
    };
    r.mesh = makeResident(r);
    r.mesh.visible = false;
    scene.add(r.mesh);
    return r;
  }
  function assignBed(r) {
    if (r.bed) return;
    const pool = r.single ? map.beds.filter((b) => b.room.startsWith('single')) : map.beds.filter((b) => !b.room.startsWith('single'));
    const order = r.single ? ['single1', 'single2'] : BED_PRIORITY[r.mobility];
    for (const room of order) {
      const b = pool.find((x) => x.room === room && !x.occupant);
      if (b) { b.occupant = r; r.bed = b; return; }
    }
  }
  function removeResident(r) {
    harm.remove(r);
    r.alive = false;
    if (r.bed) r.bed.occupant = null;
    if (r.seat) r.seat.occupant = null;
    scene.remove(r.mesh);
    s.bells = s.bells.filter((b) => b.res !== r);
  }

  function buildRoster() {
    const n = Math.floor(rnd(30, 43));
    const caseData = case1.residents();
    for (const cd of caseData) {
      const r = newResident(cd);
      const b = map.beds.find((x) => x.id === cd.bedId);
      b.occupant = r; r.bed = b;
      s.residents.push(r);
    }
    const singles = 4;
    for (let i = 0; i < singles; i++) {
      s.residents.push(newResident({
        single: i === 0 ? 'behaviour' : 'isolation', mobility: i % 2 === 0 ? 'walking' : 'bedbound',
        note: i === 0 ? 'Placed in Single Room after hitting a roommate. Doctor review due Friday; must not be locked in.' : 'Infection isolation (suspected norovirus). Gloves & gown at door.',
      }));
    }
    while (s.residents.length < n) s.residents.push(newResident());
    // A changing set of story residents each run
    const pool = s.residents.filter((r) => !r.case && !r.single);
    const storyCount = Math.floor(rnd(2, 7));
    const notes = [
      'Has started flinching when staff reach for her blanket.', 'Keeps a list of every nurse who "forgets" his insulin.',
      'Family has complained twice about unexplained bruises.', 'Hides food in her locker — says she is "saving it for later".',
      'Asks every night whether the door will be locked again.', 'Former nurse herself; watches the staff very carefully.',
    ];
    pool.sort(() => Math.random() - 0.5).slice(0, storyCount).forEach((r, i) => { r.story = true; r.note = notes[i % notes.length]; });
    const sorted = [...s.residents].sort((a, b) => ['bedbound', 'wheelchair', 'walking'].indexOf(a.mobility) - ['bedbound', 'wheelchair', 'walking'].indexOf(b.mobility));
    sorted.forEach(assignBed);
    s.residents = s.residents.filter((r) => r.bed || (scene.remove(r.mesh), false));
  }

  function dailyRosterChanges() {
    const alive = s.residents.filter((r) => r.alive);
    const out = Math.floor(rnd(0, 3));
    for (let i = 0; i < out && alive.length > 30; i++) {
      const r = pick(alive.filter((x) => !x.case && x.alive));
      if (!r) break;
      removeResident(r);
      alive.splice(alive.indexOf(r), 1);
      s.overnight.push(`${r.name} was transferred to hospital overnight.`);
    }
    const inc = Math.floor(rnd(0, 3));
    for (let i = 0; i < inc && alive.length < 42; i++) {
      const r = newResident();
      assignBed(r);
      if (!r.bed) { scene.remove(r.mesh); break; }
      s.residents.push(r); alive.push(r);
      s.overnight.push(`New admission: ${r.name}, Bed ${r.bed.id}.`);
    }
  }

  // ---------- routines (care plan first; incidents and actions can disrupt) ----------
  function freeSeat(rooms) {
    const opts = map.seats.filter((x) => !x.occupant && rooms.includes(x.room));
    return opts.length ? pick(opts) : null;
  }
  function placeInBed(r) {
    r.mode = 'bed'; r.roomId = r.bed.room;
    if (r.seat) { r.seat.occupant = null; r.seat = null; }
    pose(r.mesh, 'bed', r.bed);
    r.pos = { x: r.bed.x, z: r.bed.z };
  }
  function applyRoutine() {
    const shift = SHIFTS[s.shiftIdx].id;
    map.seats.forEach((x) => (x.occupant = null));
    for (const r of s.residents) {
      if (!r.alive) continue;
      r.seat = null;
      if (r.playerRestrained || r.sedatedUntil > s.now) { placeInBed(r); continue; }
      const night = shift === 'NIGHT';
      if (r.case || r.single || r.mobility === 'bedbound') { placeInBed(r); continue; }
      if (night && !(r.needs.includes('Night-time confusion') && Math.random() < 0.35)) { placeInBed(r); continue; }
      const wantSeat = r.mobility === 'wheelchair' || Math.random() < 0.5;
      if (wantSeat && !night) {
        const seat = freeSeat(shift === 'AM' ? ['livA', 'livB', 'livC', 'garden'] : ['livA', 'livB', 'livC']);
        if (seat) {
          seat.occupant = r; r.seat = seat; r.mode = 'seat'; r.roomId = seat.room;
          pose(r.mesh, 'seat', seat); r.pos = { x: seat.x, z: seat.z };
          continue;
        }
        if (r.mobility === 'wheelchair') { placeInBed(r); continue; }
      }
      const areas = night ? ['livB'] : WANDER_AREAS.filter((a) => shift === 'AM' || a !== 'garden');
      r.mode = 'wander'; r.area = pick(areas); r.roomId = r.area;
      r.pos = randomIn(map.roomById[r.area], 1.2);
      r.target = null;
      pose(r.mesh, 'stand');
      r.mesh.position.set(r.pos.x, 0, r.pos.z);
    }
  }
  function randomIn(room, inset) {
    for (let i = 0; i < 20; i++) {
      const p = { x: rnd(room.x + inset, room.x + room.w - inset), z: rnd(room.z + inset, room.z + room.d - inset) };
      const blocked = [...map.colliders, ...map.noWander].some((c) => p.x > c.minX - 0.4 && p.x < c.maxX + 0.4 && p.z > c.minZ - 0.4 && p.z < c.maxZ + 0.4);
      if (!blocked) return p;
    }
    return { x: room.x + room.w / 2, z: room.z + room.d / 2 };
  }

  // ---------- staff ----------
  function setupNurses() {
    for (const [i, def] of NURSES.entries()) {
      let disposition = Math.random() < 0.7 ? 'harmful' : Math.random() < 0.6 ? 'overwhelmed' : 'helpful';
      if (def.id === 'ko' || def.id === 'yip') disposition = 'harmful';
      const mesh = makeNurse(i * 5 + 1);
      mesh.visible = false;
      scene.add(mesh);
      s.nurses.push({ ...def, disposition, trust: 40, suspended: false, sick: false, mesh, pos: { x: 13, z: 29 }, path: [], wait: 0, bell: null, assigned: [], visible: false, lastHelp: -999, agency: false });
    }
    // Most nurses are harmful, but at least one AM colleague can become an ally (who, varies per run)
    const am = s.nurses.filter((n) => n.shift === 'AM' && n.id !== 'ko');
    if (am.every((n) => n.disposition === 'harmful')) pick(am).disposition = Math.random() < 0.6 ? 'overwhelmed' : 'helpful';
  }
  function assignRooms() {
    const list = s.onShift;
    list.forEach((n) => (n.assigned = []));
    if (!list.length) return;
    const shift = SHIFTS[s.shiftIdx].id;
    const rooms = [...ASSIGNABLE];
    const ko = list.find((n) => n.id === 'ko');
    if (ko && shift === 'AM') { ko.assigned.push('bed4', 'bed5'); rooms.splice(rooms.indexOf('bed4'), 1); rooms.splice(rooms.indexOf('bed5'), 1); }
    const others = list.filter((n) => n.assigned.length === 0);
    const target = others.length ? others : list;
    rooms.forEach((r, i) => target[i % target.length].assigned.push(r));
  }
  function startNurse(n, i) {
    n.mesh.visible = true;
    n.pos = { ...STATION_SPOTS[i % STATION_SPOTS.length] };
    n.mesh.position.set(n.pos.x, 0, n.pos.z);
    n.path = []; n.wait = rnd(2, 8); n.bell = null;
  }
  // Route through the nurse station's counter gap rather than through the counters.
  function nurseGoto(n, to) {
    const st = map.station;
    const fromIn = map.inStation(n.pos), toIn = map.inStation(to);
    let pts;
    if (fromIn && toIn) pts = [to];
    else {
      pts = map.path(fromIn ? st.entryOut : n.pos, toIn ? st.entryOut : to);
      if (toIn) pts.push(st.entryIn, to);
      if (fromIn) pts.unshift(st.entryIn, st.entryOut);
    }
    n.path = pts;
  }
  function nurseNextTask(n) {
    if (routine.npcNext(n)) return;
    const helpful = n.disposition !== 'harmful';
    const roll = Math.random();
    if (!n.assigned.length || (!helpful && roll < 0.55) || (helpful && roll < 0.25)) {
      nurseGoto(n, { x: pick(STATION_SPOTS).x + rnd(-0.3, 0.3), z: pick(STATION_SPOTS).z + rnd(-0.3, 0.3) });
      n.wait = helpful ? rnd(8, 18) : rnd(20, 45);
    } else if (!helpful && roll < 0.7) {
      nurseGoto(n, pick([{ x: 34, z: 35 }, { x: 29, z: 30 }, { x: 21.5, z: 41 }]));
      n.wait = rnd(15, 30);
    } else {
      const room = map.roomById[pick(n.assigned)];
      const spot = room.type === 'single' ? { x: rnd(room.x + 2, room.x + 7), z: room.z + 3.6 } : { x: rnd(room.x + 1.5, room.x + room.w - 1.5), z: room.z + room.d / 2 + rnd(-0.7, 0.7) };
      nurseGoto(n, spot);
      n.wait = helpful ? rnd(6, 14) : rnd(3, 6);
    }
  }
  function bedSide(bed) { return { x: bed.x, z: bed.z - bed.headDir * 1.6 }; }

  function updateNurse(n, dt) {
    if (offFloor(n, s.now)) {
      if (n.departingUntil > performance.now()) {
        n.pos.x += Math.sin(n.mesh.rotation.y) * 0.6 * dt;
        n.pos.z += Math.cos(n.mesh.rotation.y) * 0.6 * dt;
        resolveCollisions(n.pos, 0.3, map.colliders);
        n.mesh.position.set(n.pos.x, 0, n.pos.z);
      }
      n.mesh.visible = false;
      return;
    }
    if (n.escort && !n.path.length) return;
    if (n.path.length) {
      const t = n.path[0];
      const dx = t.x - n.pos.x, dz = t.z - n.pos.z;
      const d = Math.hypot(dx, dz);
      const step = (n.bell ? 1.6 : 1.15) * dt;
      if (d <= step) { n.pos.x = t.x; n.pos.z = t.z; n.path.shift(); }
      else { n.pos.x += (dx / d) * step; n.pos.z += (dz / d) * step; n.mesh.rotation.y = Math.atan2(dx, dz); }
      n.mesh.position.set(n.pos.x, 0, n.pos.z);
      return;
    }
    if (n.bell) {
      const r = n.bell.res;
      if (dt > 0 && !n.mesh.userData.forceAnim) {
        n.mesh.rotation.y = Math.atan2(r.bed.x - n.pos.x, r.bed.z - n.pos.z);
        gesture(n.mesh, 'interact', 1.5);
        gesture(r.mesh, 'talk', 1.2);
      }
      n.bellTimer = (n.bellTimer ?? 6) - dt;
      if (n.bellTimer <= 0) {
        const b = n.bell;
        n.bell = null; n.bellTimer = null;
        if (s.bells.includes(b)) resolveBell(b, n);
        n.wait = rnd(2, 5);
      }
      return;
    }
    if (routine.npcUpdate(n, dt)) return;
    n.wait -= dt;
    if (n.wait <= 0) nurseNextTask(n);
  }

  // ---------- call bells ----------
  function spawnBell(res, need, urgent, extra = {}) {
    if (!res?.alive || s.bells.some((b) => b.res === res)) return null;
    const b = { id: s.nextBellId++, res, need, urgent, start: s.now, nurse: null, ...extra };
    s.bells.push(b);
    if (urgent) ui.toast(`URGENT call bell — ${res.name} (Bed ${res.bed.id})`);
    return b;
  }
  function resolveBell(b, by) {
    s.bells = s.bells.filter((x) => x !== b);
    if (/toilet|wet|pad/i.test(b.need) && b.res.hygiene) { b.res.hygiene.body = false; b.res.hygiene.bedding = false; }
    b.res.wellbeing = clamp(b.res.wellbeing + (b.urgent ? 10 : 7), 0, 100);
    if (by === 'player') {
      s.stats.bellsYou++;
      const owner = s.onShift.find((n) => n.assigned.includes(b.res.bed.room));
      if (b.forNurse) { b.forNurse.trust = clamp(b.forNurse.trust + 12, 0, 100); colleague.rewardHelp(b.forNurse); ui.toast(`${b.forNurse.name} noticed you took that on. (+trust, colleague bonus)`); }
      else if (owner) owner.trust = clamp(owner.trust + 6, 0, 100);
    } else {
      s.stats.bellsStaff++;
      if (b.nurse) b.nurse = null;
    }
    if (s.waypoint?.bell === b) s.waypoint = null;
  }
  function bellMinute() {
    for (const r of s.residents) if (r.alive && r.silencedNeed && r.silencedNeed.due <= s.nextMinute && !(r.sedatedUntil > s.nextMinute)) {
      const need = r.silencedNeed.need;
      r.silencedNeed = null;
      const existing = s.bells.find((b) => b.res === r);
      if (existing) { existing.urgent = true; existing.need = `${need} (unmet after your conduct)`; }
      else spawnBell(r, `${need} (unmet after your conduct)`, true);
    }
    const shift = SHIFTS[s.shiftIdx];
    const expected = shift.staffTotal - 1;
    const present = s.onShift.filter((n) => !offFloor(n, s.now)).length;
    const factor = clamp(present / expected, 0.4, 1);
    if (Math.random() < bellChance(s.difficulty, shift.id, factor, s.bells.length)) {
      const cands = s.residents.filter((r) => r.alive && r.mode === 'bed' && !r.case && !(r.sedatedUntil > s.now) && !s.bells.some((b) => b.res === r));
      if (cands.length) {
        const bn = pick(BELL_NEEDS);
        spawnBell(pick(cands), bn.need, bn.urgent && Math.random() < 0.6);
      }
    }
    for (const b of [...s.bells]) {
      const age = s.now - b.start;
      b.res.wellbeing -= b.urgent ? 0.25 : 0.08;
      if (!b.urgent && age > 30) { b.urgent = true; b.need += ' (waited 30+ min)'; ui.toast(`Call bell escalated — ${b.res.name}`); }
      if (b.urgent && age > 75) {
        s.bells = s.bells.filter((x) => x !== b);
        if (b.nurse) { b.nurse.bell = null; b.nurse = null; }
        b.res.wellbeing -= 18;
        s.stats.incidents++;
        s.reputation -= 4;
        s.stats.log.push(`${fmtTime(s.now)} — ${b.res.name} was found on the floor after a call bell went unanswered for over an hour.`);
        ui.toast(`Incident: ${b.res.name} fell after waiting too long.`);
      }
      // NPC nurses decide whether to answer — harmful staff mostly ignore bells
      if (!b.nurse && !b.forNurse && !b.caseBell) {
        for (const n of s.onShift) {
          if (n.bell || n.escort || n.routineJob || offFloor(n, s.now)) continue;
          let p = { helpful: 0.09, overwhelmed: 0.05, harmful: 0.008 }[n.disposition];
          if (n.assigned.includes(b.res.bed.room)) p *= 2;
          if (n.supervised) p = Math.max(p, 0.04);
          if (n.disposition === 'harmful' && s.suspicion > 60) p *= 0.5;
          if (Math.random() < p) { b.nurse = n; n.bell = b; nurseGoto(n, bedSide(b.res.bed)); break; }
        }
      }
    }
  }

  // ---------- time ----------
  function minuteTick() {
    harm.minute(s.nextMinute);
    routine.minute(s.nextMinute);
    colleague.minute(s.nextMinute);
    bellMinute();
    case1.minute();
    for (const r of s.residents) {
      if (!r.alive) continue;
      // Neglect pressure in rooms covered by harmful staff
      if (r.wellbeing > 0) {
        const owner = s.onShift.find((n) => n.assigned.includes(r.roomId));
        if (owner && owner.disposition === 'harmful' && !owner.supervised) r.wellbeing -= 0.012;
        else r.wellbeing += 0.006;
        if (dist(r.pos, player) < 6) r.wellbeing += 0.01;
      }
      r.wellbeing = Math.min(100, r.wellbeing);
      if (r.mode === 'bed' && !r.case && r.hygiene && !r.hygiene.body) {
        const owner = s.onShift.find((n) => n.assigned.includes(r.bed.room));
        const neglect = r.playerRestrained || r.sedatedUntil > s.now ? 1 / 240 : owner?.disposition === 'harmful' && !owner.supervised ? 1 / 900 : 1 / 4000;
        const waiting = s.bells.find((b) => b.res === r && /toilet|wet/i.test(b.need) && s.now - b.start > 20);
        if (waiting || Math.random() < neglect) { r.hygiene.body = true; r.hygiene.bedding = true; }
      }
      if (r.hygiene && dirty(r)) r.wellbeing -= 0.01;
      if (r.wellbeing <= 0) {
        removeResident(r);
        s.stats.deaths++;
        s.reputation -= 12;
        s.stats.log.push(`${fmtTime(s.now)} — ${r.name} died. It may have been preventable.`);
        ui.toast(`${r.name} has died.`, 5000);
        case1.onDeath(r);
      }
    }
    if (s.reputation <= 0 && !s.inquiry) {
      s.inquiry = true;
      ui.toast('The Social Welfare Department has opened an inquiry into the home.', 6000);
    }
  }
  function tick(mins) {
    s.now += mins;
    while (s.now >= s.nextMinute) { minuteTick(); s.nextMinute++; }
  }
  game.advance = (mins) => tick(mins);
  game.emergency = () => s.bells.some((b) => b.urgent) || case1.emergency();

  // ---------- shift flow ----------
  function staffPrompt(done) {
    const shift = SHIFTS[s.shiftIdx];
    const expected = shift.staffTotal - 1;
    const sick = s.onShift.find((n) => n.sick);
    const short = expected - s.onShift.length;
    if (short <= 0) return done();
    const why = [sick ? `${sick.name} called in sick at ${fmtTime(s.now - 25)}.` : '', s.nurses.some((n) => n.suspended && n.shift === shift.id) ? 'A suspended nurse leaves a gap on this roster.' : ''].filter(Boolean).join(' ');
    ui.dialogue('Staffing — phone at the nurse station', () => `${esc(translate(why))}<br><br>${t('staff.shortage', { count: short, shift: translate(shift.name) })}`, [
      {
        label: 'Call an agency relief nurse (arrives in ~45 min, reputation −1)', fn: () => {
          s.reputation -= 1;
          for (let i = 0; i < short; i++) {
            const mesh = makeNurse(Math.floor(Math.random() * 16));
            scene.add(mesh);
            const n = { id: 'agency' + Math.random(), name: `Agency Nurse ${pick(['Lui', 'Kwan', 'Fok', 'Szeto'])}`, shift: shift.id, color: 0xb07f5a, disposition: Math.random() < 0.65 ? 'harmful' : 'overwhelmed', trust: 35, suspended: false, sick: false, mesh, pos: { x: 30, z: 35 }, path: [], wait: 0, bell: null, assigned: [], visible: false, lastHelp: -999, agency: true, arriveAt: s.now + 45 };
            mesh.position.set(30, 0, 35);
            s.onShift.push(n);
          }
          assignRooms();
          ui.closePanel(true); done();
        },
      },
      {
        label: 'Redistribute the workload (staff trust −4, more pressure)', fn: () => {
          s.onShift.forEach((n) => (n.trust = clamp(n.trust - 4, 0, 100)));
          ui.closePanel(true); done();
        },
      },
    ], '', { closable: false });
  }

  function startShift() {
    const shift = SHIFTS[s.shiftIdx];
    s.overnight = [];
    if (shift.id === 'AM' && s.day > 1) dailyRosterChanges();
    s.shiftStart = (s.day - 1) * 1440 + shift.start;
    s.shiftEnd = (s.day - 1) * 1440 + shift.end;
    s.now = s.shiftStart;
    s.nextMinute = s.now + 1;
    s.bells = [];
    s.waypoint = null;
    s.medicineRound = false;
    s.stats = { bellsYou: 0, bellsStaff: 0, incidents: 0, deaths: 0, harm: 0, harmReports: 0, log: [], startRep: s.reputation, caseLine: null };
    trolleys.reset();
    colleague.reset();
    routine.startShift();
    harm.nextShift();
    s.residents.forEach((r) => (r.lastSeen = null));
    applyRoutine();
    s.nurses.forEach((n) => { n.mesh.visible = false; n.sick = false; n.bell = null; n.routineJob = null; n.path = []; n.supervisedToday = false; });
    s.nurses = s.nurses.filter((n) => !n.agency || (scene.remove(n.mesh), false));
    s.onShift = s.nurses.filter((n) => n.shift === shift.id && !n.suspended);
    const firstShift = s.day === 1 && shift.id === 'AM';
    if (shift.id !== 'NIGHT' && !firstShift && s.onShift.length > 1 && Math.random() < 0.3) {
      const n = pick(s.onShift);
      n.sick = true;
    }
    s.onShift = s.onShift.filter((n) => !n.sick);
    s.onShift.forEach(startNurse);
    assignRooms();
    env.setShift(shift.id);
    player.x = 15.9; player.z = 28.25; player.heading = -Math.PI / 2;
    s.running = true;
    staffPrompt(() => showHandover());
  }

  function showHandover() {
    if (case1.handover()) return;
    const prev = SHIFTS[(s.shiftIdx + 2) % 3];
    const rows = s.residents.filter((r) => r.alive).sort(() => Math.random() - 0.5).slice(0, 6).map((r) => {
      const truthful = Math.random() < 0.45;
      const text = r.wellbeing < 45 && !truthful ? 'Comfortable. No issues.' : r.wellbeing < 45 ? 'Unsettled, poor intake. Please check early.' : pick(['Slept well.', 'Obs stable.', 'Ate 3/4 of meal.', 'Refused shower — retry.', 'Toileted 2-hourly.']);
      return `<tr><td>${esc(r.bed.id)}</td><td>${esc(r.name)}</td><td class="hand">${esc(text)}</td></tr>`;
    }).join('');
    const alloc = s.onShift.map((n) => `<li>${esc(n.name)}: ${n.assigned.map((a) => map.roomById[a].name).join(', ') || 'floating'}</li>`).join('');
    ui.openPanel(`
      <div class="doc">
        <div class="doc-head"><b>Shift Handover</b><span>${esc(prev.name)} → ${esc(SHIFTS[s.shiftIdx].name)} · Day ${s.day}</span></div>
        <table class="doc-table handover-table"><tr><th>Bed</th><th>Resident</th><th>Notes</th></tr>${rows}</table>
        ${s.overnight.length ? `<p class="hand">Overnight: ${s.overnight.map(esc).join(' ')}</p>` : ''}
        <h4>Allocation</h4><ul>${alloc || '<li>No other staff on floor.</li>'}<li>You (Shift In-Charge): Single Rooms, float, call bells</li></ul>
        <p class="doc-note">Compare what's written with what you actually find on your rounds.</p>
        <button class="opt primary" id="hand-ok">Start rounds</button>
      </div>`, { cls: 'paper' });
    ui.bind('#hand-ok', () => ui.closePanel());
  }

  function endShift() {
    escort.cancel('silent');
    trolleys.park();
    holding = null;
    s.running = false;
    ui.closePanel(true);
    ui.setHold(null);
    const alive = s.residents.filter((r) => r.alive);
    const W = alive.reduce((a, r) => a + r.wellbeing, 0) / Math.max(1, alive.length);
    const answered = s.stats.bellsYou + s.stats.bellsStaff;
    const C = clamp(100 * answered / Math.max(1, answered + s.stats.incidents * 2 + s.bells.length), 0, 100);
    const T = s.onShift.length ? s.onShift.reduce((a, n) => a + n.trust, 0) / s.onShift.length : 50;
    const inv = case1.shiftScore();
    const score = clamp(0.35 * W + 0.25 * C + 0.2 * (inv ?? C) + 0.1 * T + 0.1 * (100 - s.suspicion) - s.stats.deaths * 10 - s.stats.harm * 8 + s.colleagueBonus - s.colleaguePenalty, 0, 100);
    const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
    const notes = [];
    if (s.stats.bellsYou > s.stats.bellsStaff * 2) notes.push('You carried the floor yourself — residents were safer, but investigation time was lost.');
    if (s.suspicion > 50) notes.push('Staff are wary of you. Harmful nurses will cover for each other more.');
    if (T > 55) notes.push('Some staff are starting to trust you.');
    if (s.bells.length) notes.push(`${s.bells.length} call bell(s) still ringing at handover.`);
    const bar = (v) => `<span class="bar"><i style="width:${clamp(v, 0, 100)}%"></i></span>${Math.round(v)}`;
    ui.openPanel(`
      <div class="doc report">
        <div class="doc-head"><b>End of ${esc(SHIFTS[s.shiftIdx].name)} — Day ${s.day}</b><span>${esc(DIFFICULTY[s.difficulty]?.label ?? '')} · Grade ${grade} · ${Math.round(score)}/100</span></div>
        <table class="doc-table score">
          <tr><td>Resident wellbeing</td><td>${bar(W)}</td></tr>
          <tr><td>Call-bell care</td><td>${bar(C)} <small>(you ${s.stats.bellsYou}, staff ${s.stats.bellsStaff}, incidents ${s.stats.incidents})</small></td></tr>
          <tr><td>Investigation</td><td>${inv === null ? '<small>No case decision this shift</small>' : bar(inv)}</td></tr>
          <tr><td>Staff trust (on shift)</td><td>${bar(T)}</td></tr>
          <tr><td>Staff suspicion</td><td>${bar(s.suspicion)}</td></tr>
          <tr><td>Home reputation</td><td>${bar(s.reputation)} <small>(${s.reputation - s.stats.startRep >= 0 ? '+' : ''}${Math.round(s.reputation - s.stats.startRep)})</small></td></tr>
          <tr><td>Deaths</td><td>${s.stats.deaths}</td></tr>
          <tr><td>Routine care</td><td>${s.stats.routine.done} done by you · ${s.stats.routine.npcDone} staff done · ${s.stats.routine.missed} missed · ${s.stats.routine.falseCharted} false-charted · ${s.stats.routine.harmed} unsafe</td></tr>
          <tr><td>Colleague conduct</td><td>Bonus +${s.colleagueBonus} / 6 · penalty −${s.colleaguePenalty}</td></tr>
        </table>
        <h4>Your conduct</h4>
        <p>${s.stats.harm} harmful act(s) · score penalty −${s.stats.harm * 8} · ${s.stats.harmReports} witness report(s).
        Restraint and other ongoing effects carry into later shifts until released or expired.</p>
        ${s.stats.caseLine ? `<p><b>Case:</b> ${s.stats.caseLine}</p>` : ''}
        ${notes.length ? `<ul>${notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${s.stats.log.length ? `<h4>Incident log</h4><ul>${s.stats.log.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <p class="doc-note">There's no perfect score — every choice traded something.</p>
        <button class="opt primary" id="next-shift">Begin next shift</button>
      </div>`, { cls: 'paper', closable: false });
    ui.bind('#next-shift', () => {
      ui.closePanel(true);
      s.shiftIdx = (s.shiftIdx + 1) % 3;
      if (s.shiftIdx === 0) s.day++;
      startShift();
    });
  }

  // ---------- resident profile ----------
  function profileHtml(r) {
    const bell = s.bells.find((b) => b.res === r);
    const ls = r.lastSeen;
    return `
      <div class="profile">
        <div class="p-head"><b>${esc(r.name)}</b> <span>${r.age} · Bed ${esc(r.bed?.id ?? '—')} · ${esc(map.roomById[r.bed?.room]?.name ?? '')}</span></div>
        ${bell ? `<div class="p-bell ${bell.urgent ? 'urgent' : ''}">${bell.urgent ? 'URGENT' : 'Call bell'}: ${esc(bell.need)} — ${Math.floor(s.now - bell.start)} min. Waypoint set.</div>` : ''}
        <div class="p-row"><i>Wellbeing</i><span class="bar"><i style="width:${clamp(r.wellbeing, 0, 100)}%"></i></span></div>
        <div class="p-row"><i>Mobility</i>${esc({ bedbound: 'Bed-bound', wheelchair: 'Wheelchair', walking: 'Walks (supervised)' }[r.mobility])}</div>
        <div class="p-row"><i>Personality</i>${esc(r.personality)}</div>
        <div class="p-row"><i>Routine</i>${esc(r.routine)}</div>
        <div class="p-row"><i>Support needs</i>${esc(r.needs.join(' · '))}</div>
        ${r.note ? `<div class="p-row story"><i>Note</i>${esc(r.note)}</div>` : ''}
        ${dirty(r) ? `<div class="p-row story"><i>Hygiene</i>${esc(hygieneText(r))} — odour noticeable</div>` : ''}
        ${harm.status(r).length ? `<div class="p-row story"><i>Your conduct</i>${esc(harm.status(r).join(' · '))}</div>` : ''}
        ${routine.notes(r).length ? `<div class="p-row"><i>Care records</i>${routine.notes(r).map(esc).join('<br>')}</div>` : ''}
        <div class="p-row"><i>Last seen</i>${ls ? `${esc(ls.roomName)} at ${fmtTime(ls.t)}` : 'Not seen this shift'}</div>
      </div>`;
  }
  game.openProfile = (r, extraOpts = []) => {
    const near = r.alive && dist(player, r.pos) <= 2.3;
    const care = near ? case1.residentAction(r) : null;
    const bell = s.bells.find((b) => b.res === r);
    const careOptions = near ? [{
      label: care?.kind === 'tap' ? care.label : care ? `Care: ${care.label} (hold E at bedside)` : bell ? 'Care: answer call bell (hold E at bedside)' : 'Care: offer reassurance',
      cls: 'primary',
      fn: () => {
        ui.closePanel();
        if (care?.kind === 'tap') care.run();
        else if (!care && !bell) {
          if (s.now - r.lastChat > 30) { r.lastChat = s.now; r.wellbeing = Math.min(100, r.wellbeing + 3); }
          ui.toast(pick(CHAT));
        }
      },
    }] : [];
    ui.dialogue('Resident profile', profileHtml(r), [...extraOpts, ...careOptions, ...(near ? routine.options(r) : []), ...harm.options(r), { label: 'Close', fn: () => ui.closePanel() }]);
  };
  game.residentOptions = (r) => [...routine.options(r), ...harm.options(r)];
  ui.onResident = () => {
    if (ui.panelOpen || !s.running || s.paused || holding || s.escort) return;
    const r = s.residents.filter((r) => r.alive && dist(player, r.pos) <= 2.3).sort((a, b) => dist(player, a.pos) - dist(player, b.pos))[0];
    if (r) game.openProfile(r);
  };
  ui.onBannerTap = (id) => {
    const b = s.bells.find((x) => x.id === id);
    if (!b) return;
    s.waypoint = { x: b.res.bed.x, z: b.res.bed.z, label: b.res.name, bell: b };
    game.openProfile(b.res);
  };

  // ---------- interactions ----------
  let current = null;
  let holding = null;
  function interactables() {
    if (s.escort) return { d: 0, pos: player, kind: 'tap', label: 'Let go — abandon the escort', run: () => escort.cancel() };
    const list = [];
    for (const r of s.residents) {
      if (!r.alive || !r.mesh.visible) continue;
      const p = r.mode === 'bed' ? { x: r.bed.x, z: r.bed.z } : r.pos;
      const d = dist(player, p);
      if (d > 2.3) continue;
      const special = case1.residentAction(r);
      if (special) { list.push({ ...special, d, pos: p }); continue; }
      const bell = s.bells.find((b) => b.res === r);
      if (bell) {
        list.push({
          d: d - 0.5, pos: p, kind: 'hold', dur: bell.urgent ? 2.2 : 1.6, minutes: bell.urgent ? 12 : 8,
          label: `Answer call bell: ${bell.need.replace(' (waited 30+ min)', '')}`,
          run: () => { if (bell.nurse) { bell.nurse.bell = null; bell.nurse.path = []; } resolveBell(bell, 'player'); ui.toast(`You helped ${r.name}.`); },
        });
      } else if (dirty(r) && !r.case) {
        list.push({
          d: d - 0.3, pos: p, kind: 'hold', dur: 2.4, minutes: 15,
          label: `Wash & change ${r.name}${r.hygiene.bag ? ' (empty bag)' : ''}`,
          run: () => {
            r.hygiene.body = r.hygiene.bedding = r.hygiene.bag = false;
            r.wellbeing = Math.min(100, r.wellbeing + 5);
            ui.toast(`${r.name} is clean and dry. The smell fades.`);
          },
        });
      } else if (routine.interaction(r)) {
        list.push({ ...routine.interaction(r), d: d - 0.2, pos: p });
      } else {
        list.push({
          d, pos: p, kind: 'tap', label: `Talk to ${r.name}`,
          run: () => {
            const chat = s.now - r.lastChat > 30;
            if (chat) { r.lastChat = s.now; r.wellbeing = Math.min(100, r.wellbeing + 3); }
            game.openProfile(r);
            if (chat) ui.toast(pick(CHAT), 4000);
          },
        });
      }
    }
    for (const n of s.onShift) {
      if (!n.mesh.visible) continue;
      const d = dist(player, n.pos);
      if (d > 2.0) continue;
      list.push({ d, pos: n.pos, kind: 'tap', label: `Talk to ${n.name}`, run: () => talkNurse(n) });
    }
    const fixed = [
      { pos: map.station.records, available: map.inStation(player), label: 'Nurse station: records & handover', run: () => case1.records() },
      { pos: { x: 40, z: 40.4 }, label: "Ward Manager's desk: CCTV & reports", run: () => case1.office() },
      { pos: { x: 19.6, z: 30.3 }, label: s.linen ? 'Linen trolley (you have clean linen)' : 'Take clean linen', run: () => { s.linen = true; ui.toast('You take a set of clean sheets, towels and a gown.'); } },
    ];
    list.push(...trolleys.interactions());
    for (const f of fixed) {
      if (f.available === false) continue;
      const d = dist(player, f.pos);
      if (d < 1.6) list.push({ ...f, d, kind: 'tap' });
    }
    list.sort((a, b) => a.d - b.d);
    return list[0] ?? null;
  }

  function talkNurse(n) {
    const special = case1.nurseTalk(n);
    if (special) return;
    const lines = {
      harmful: ['"What now? I\'m on my break in five."', '"They\'re old. They complain. That\'s the job."', '"I did my round. It\'s all charted."'],
      overwhelmed: ['"Sorry — I\'ve got four people to get up and nobody to help."', '"I haven\'t sat down since seven."', '"Is it always this short-staffed here?"'],
      helpful: ['"Morning. Bed 1-3 is a bit chesty, I\'m keeping an eye."', '"Shout if you need a second pair of hands."', '"Some of the others… never mind."'],
    }[n.disposition];
    const confiding = n.disposition === 'harmful' && n.witnessedHarm >= 3 ? '<br>"You understand us now. We sign the charts from here. Nobody checks."' : '';
    ui.dialogue(n.name, `${pick(lines)}${confiding}<br><small>Assigned: ${n.assigned.map((a) => esc(map.roomById[a].name)).join(', ') || 'floating'} · Trust ${Math.round(n.trust)}</small>`, [
      ...game.helpOption(n),
      ...colleague.options(n),
      { label: 'Leave', fn: () => ui.closePanel() },
    ]);
  }
  // Trust is earned through actions: take on a task in her area
  game.helpOption = (n) => {
    if (n.refusesHelp || offFloor(n, s.now) || s.now - n.lastHelp < 30 || !colleague.available(n)) return [];
    return [{
      label: 'Offer to take one of her residents',
      fn: () => {
        if (!colleague.reserveHelp(n)) return;
        n.lastHelp = s.now;
        const cands = s.residents.filter((r) => r.alive && r.mode === 'bed' && n.assigned.includes(r.bed.room) && !r.case && !s.bells.some((b) => b.res === r));
        ui.closePanel();
        if (!cands.length) { ui.toast(`"Thanks, but I'm alright for now."`); return; }
        const r = pick(cands);
        const b = spawnBell(r, `Repositioning & pad change (asked by ${n.name})`, false, { forNurse: n });
        if (b) { s.waypoint = { x: r.bed.x, z: r.bed.z, label: r.name, bell: b }; ui.toast({ key: 'dialogue.helpBed', vars: { bed: r.bed.id, name: r.name } }); }
      },
    }];
  };

  ui.onInteractDown = input.onInteractDown = () => {
    if (ui.panelOpen || !s.running || s.paused || performance.now() < (s.staggerUntil ?? 0) || !current) return;
    if (current.kind === 'tap') current.run();
    else holding = { it: current, t: 0 };
  };
  ui.onInteractUp = input.onInteractUp = () => {
    if (holding) { holding = null; ui.setHold(null); }
  };

  // ---------- per-frame ----------
  const tmpV = new THREE.Vector3();
  game.update = (dt, camYaw, realDt = dt) => {
    if (!s.running) return;
    const scale = s.paused ? 0 : ui.panelOpen ? (game.emergency() ? 1 : 0.25) : 1;
    const sdt = dt * scale;
    tick(sdt);
    if (s.now >= s.shiftEnd) { endShift(); return; }

    if (s.escort && s.pushingTrolley) trolleys.park();
    if (performance.now() >= (s.staggerUntil ?? 0)) escort.update(sdt);
    // player movement
    if (!ui.panelOpen && !holding && !s.paused && !s.escort && performance.now() >= (s.staggerUntil ?? 0)) {
      const mx = input.moveX, mz = input.moveZ;
      if (mx || mz) {
        const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
        const wx = mx * cos + mz * sin, wz = -mx * sin + mz * cos;
        const speed = s.pushingTrolley ? 1.45 : s.mealTray ? 2.1 : input.fast ? 4.2 : 2.6;
        const steps = Math.max(1, Math.ceil(speed * dt / 0.15));
        for (let i = 0; i < steps; i++) {
          const before = { x: player.x, z: player.z, heading: player.heading };
          player.heading = Math.atan2(wx, wz);
          player.x += wx * speed * dt / steps; player.z += wz * speed * dt / steps;
          resolveCollisions(player, 0.3, map.colliders);
          if (s.pushingTrolley && !trolleys.follow()) {
            Object.assign(player, before);
            break;
          }
        }
        player.moving = true;
        if (s.pushingTrolley && !player.mesh.userData.forceAnim) gesture(player.mesh, 'push', 1);
      } else player.moving = false;
      resolveCollisions(player, 0.3, map.colliders);
    } else player.moving = false;

    // holding an action
    if (holding) {
      const tp = holding.it.pos;
      player.heading = Math.atan2(tp.x - player.x, tp.z - player.z);
      if (!player.mesh.userData.forceAnim) gesture(player.mesh, holding.it.dur >= 2 ? 'pickup' : 'interact', 1.3);
      const who = s.residents.find((r) => r.alive && (r.pos === tp || (r.bed && r.mode === 'bed' && r.bed.x === tp.x && r.bed.z === tp.z)));
      if (who && !who.mesh.userData.forceAnim) gesture(who.mesh, 'talk', 1.2);
      holding.t += realDt;
      ui.setHold(Math.min(1, holding.t / holding.it.dur), holding.it.label);
      if (dist(player, holding.it.pos) > 2.8) { holding = null; ui.setHold(null); }
      else if (holding.t >= holding.it.dur) {
        const it = holding.it;
        holding = null; ui.setHold(null);
        if (it.beforeTime) { it.run(); tick(it.minutes); }
        else { tick(it.minutes); it.run(); }
      }
    }

    // residents: only nearby ones are fully simulated
    for (const r of s.residents) {
      if (!r.alive) continue;
      const d = dist(player, r.pos);
      const near = d < 22;
      if (near && !r.mesh.visible && r.mode === 'wander') {
        r.pos = randomIn(map.roomById[r.area], 1.2);
        r.mesh.position.set(r.pos.x, 0, r.pos.z);
      }
      r.mesh.visible = near;
      if (!near) continue;
      if (r.mode === 'wander' && !r.playerRestrained && !(r.sedatedUntil > s.now)) {
        if (!r.target || dist(r.pos, r.target) < 0.2) { r.target = randomIn(map.roomById[r.area], 1.2); r.pause = rnd(2, 8); }
        if (r.pause > 0) r.pause -= sdt;
        else {
          const dx = r.target.x - r.pos.x, dz = r.target.z - r.pos.z, dd = Math.hypot(dx, dz);
          const step = 0.45 * sdt;
          r.pos.x += (dx / dd) * Math.min(step, dd); r.pos.z += (dz / dd) * Math.min(step, dd);
          resolveCollisions(r.pos, 0.25, map.colliders);
          r.mesh.position.set(r.pos.x, 0, r.pos.z);
          r.mesh.rotation.y = Math.atan2(dx, dz);
        }
      }
      const room = map.roomAt(player.x, player.z);
      if (d < 4 || (d < 11 && room && room.id === r.roomId)) {
        r.lastSeen = { x: r.pos.x, z: r.pos.z, t: s.now, roomName: map.roomById[r.roomId]?.name ?? '' };
      }
    }
    const proom = map.roomAt(player.x, player.z);
    for (const n of s.onShift) {
      updateNurse(n, sdt);
      const d = dist(player, n.pos);
      const arrived = !offFloor(n, s.now);
      n.mesh.visible = (arrived || n.departingUntil > performance.now()) && d < 26;
      const nroom = map.roomAt(n.pos.x, n.pos.z);
      n.visible = arrived && (d < 4 || (d < 12 && proom && nroom && proom.id === nroom.id));
    }
    case1.frame(dt);
    harm.frame();
    odour.update(dt, s.residents, player);

    // waypoint maintenance
    if (s.waypoint) {
      if (s.waypoint.ref) { s.waypoint.x = s.waypoint.ref.pos.x; s.waypoint.z = s.waypoint.ref.pos.z; }
      if (s.waypoint.bell && !s.bells.includes(s.waypoint.bell)) s.waypoint = null;
      else if (s.waypoint.routine && !s.rounds.some((round) => round.id === s.waypoint.routine && s.now < round.end)) s.waypoint = null;
      else if (!s.waypoint.ref && !s.waypoint.bell && dist(player, s.waypoint) < 2) s.waypoint = null;
    }

    current = holding ? holding.it : ui.panelOpen || s.paused || performance.now() < (s.staggerUntil ?? 0) ? null : interactables();
    ui.setInteract(current?.label ?? '');
    ui.setResidentAvailable(!ui.panelOpen && !holding && !s.paused && !s.escort && s.residents.some((r) => r.alive && dist(player, r.pos) <= 2.3));

    const shift = SHIFTS[s.shiftIdx];
    const present = s.onShift.filter((n) => !offFloor(n, s.now)).length + 1;
    ui.setHud({
      time: fmtTime(s.now),
      shift: { key: 'hud.shift', vars: { shift: shift.name, start: fmtTime(shift.start), end: fmtTime(shift.end), day: s.day, difficulty: DIFFICULTY[s.difficulty]?.label ?? '', slow: scale < 1 && scale > 0 ? ' · time slowed' : '' } },
      staff: { key: 'hud.staff', vars: { present, total: shift.staffTotal, relief: s.onShift.some((n) => n.arriveAt && s.now < n.arriveAt) ? ' (relief en route)' : '' } },
      rep: s.reputation, susp: s.suspicion,
    });
    ui.setObjective(case1.objective() ?? 'Keep residents safe: do rounds, answer call bells, and watch your staff.');
    ui.renderBanners(s.bells, s.now);
    ui.renderTasks(routine.rows());
    ui.drawMaps(s);
  };

  // ---------- pause / case file ----------
  ui.onPause = input.onPause = () => {
    if (!s.running) return;
    s.paused = true;
    ui.openPanel(`
      <div class="dlg">
        <div class="dlg-speaker">Paused</div>
        ${languageButtons()}
        <div class="dlg-text">
          <b>Move</b> WASD / arrows or left-thumb stick · <b>Run</b> Shift or push the stick fully<br>
          <b>Look</b> drag on the screen · <b>Zoom</b> mouse wheel<br>
          <b>Interact</b> E or the round button (hold for care tasks)<br>
          <b>Map</b> M or tap the minimap · <b>Case file</b> C · <b>Pause</b> Esc / P<br><br>
          Menus slow time to ¼ speed, except during emergencies.
        </div>
        <div class="dlg-opts"><button class="opt primary" id="resume">Resume</button><button class="opt" id="restart">Restart run</button></div>
      </div>`, { onClose: () => (s.paused = false) });
    ui.bind('#resume', () => ui.closePanel());
    ui.bind('#restart', () => location.reload());
  };
  ui.onCaseFile = () => { if (s.running) case1.caseFile(); };
  input.onKey = (k) => {
    if (k === 'escape' || k === 'p') { if (ui.mapExpanded) ui.toggleMap(false); else if (ui.panelOpen) ui.closePanel(); else ui.onPause(); }
    if (k === 'm') ui.toggleMap();
    if (k === 'c' && !ui.panelOpen) ui.onCaseFile();
  };

  // ---------- case wiring ----------
  const case1 = createCase1({ s, game, ui, map, scene, esc, fmtTime, clamp, dist, bedSide, spawnBell, makeRestraintProps, makeUrineBag, nurseGoto });
  const escort = createEscort({ s, map, ui, dist, rnd, bedSide, placeInBed, nurseGoto, resolveCollisions, gesture, pose, wanderAreas: WANDER_AREAS });
  const harm = createHarm({ s, ui, map, clamp, dist, fmtTime, placeInBed, case1, escort });
  const trolleys = createTrolleys({ s, scene, map, ui, dist, resolveCollisions });
  const routine = createRoutine({ s, ui, dist, trolleys, harm, nurseGoto, bedSide });
  const colleague = createColleague({ s, ui, dist, report: harm.report, advance: game.advance, evidenceFor: case1.evidenceFor, routine });
  const odour = createOdour(scene);
  game.escort = escort;
  game.harm = harm;
  game.routine = routine;
  game.colleague = colleague;
  game.trolleys = trolleys;
  game.case1 = case1;
  game.colleagueOptions = (n) => colleague.options(n);
  ui.onTaskTap = (id) => routine.waypoint(id);

  game.start = () => {
    setupNurses();
    buildRoster();
    startShift();
  };
  game.tmpV = tmpV;
  game.resolveBell = resolveBell;
  game.assignRooms = assignRooms;
  game.interaction = () => current;
  return game;
}
