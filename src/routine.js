import { gesture } from './assets.js';
import { esc, fmtTime } from './ui.js';
import { MEAL_SPOT, TROLLEYS } from './trolley.js';

export const TASKS = {
  vitals: { label: 'TPR / BP', trolley: 'vitals', minutes: 4, loss: 3 },
  meds: { label: 'Medicine round', trolley: 'med', minutes: 4, loss: 4 },
  turn: { label: 'Turning / repositioning', minutes: 4, loss: 5 },
  feed: { label: 'Assisted meal', minutes: 5, loss: 6 },
  pad: { label: 'Toileting / pad round', minutes: 4, loss: 5 },
};
const SCHEDULE = {
  AM: [['pad', 450], ['feed', 480, 'Breakfast'], ['turn', 480], ['meds', 540], ['vitals', 600], ['turn', 600], ['feed', 720, 'Lunch'], ['turn', 720], ['meds', 780]],
  PM: [['turn', 840], ['vitals', 870], ['turn', 960], ['feed', 1050, 'Dinner'], ['turn', 1080], ['meds', 1080], ['turn', 1200], ['pad', 1200]],
  NIGHT: [['meds', 1320], ['turn', 1320], ['turn', 1440], ['turn', 1560], ['pad', 1560], ['turn', 1680], ['turn', 1800], ['vitals', 1800]],
};
export const VARIANTS = {
  vitals: [{ id: 'invent', label: 'Chart made-up readings without measuring', cost: 6, chart: true }],
  meds: [{ id: 'omit', label: 'Omit medicine but chart it as given', cost: 8, chart: true }, { id: 'wrong', label: "Give another resident's medicine", cost: 14 }],
  turn: [{ id: 'roughTurn', label: 'Handle roughly while turning', cost: 10 }, { id: 'noTurn', label: 'Leave on pressure area and chart as turned', cost: 8, chart: true }],
  feed: [{ id: 'forceFeed', label: 'Force-feed too fast', cost: 12 }, { id: 'removeTray', label: 'Take the tray away uneaten', cost: 10 }],
  pad: [{ id: 'wetPad', label: 'Leave the resident in a wet pad', cost: 8 }, { id: 'mock', label: 'Mock the resident during toileting', cost: 7 }],
};

export function scheduleFor(shiftId, day = 1) {
  const offset = (day - 1) * 1440;
  return (SCHEDULE[shiftId] ?? []).map(([type, start, meal], i) => ({
    id: `${day}-${shiftId}-${i}`, type, start: offset + start, end: offset + start + 60,
    label: meal ? `${meal} assistance` : TASKS[type].label,
  }));
}
export const inWindow = (round, now) => now >= round.start && now < round.end;
export const allocatedToPlayer = (r) => !!r.bed?.room.startsWith('single');
export function eligible(r, type) {
  if (!r.alive || !r.bed) return false;
  if (type === 'turn') return r.mobility === 'bedbound';
  if (type === 'feed') return r.mobility === 'bedbound' || r.needs?.some((n) => /assist.*feed|feed.*assist/i.test(n));
  return true;
}
export function missedEffect(r, type, now = 0) {
  r.wellbeing = Math.max(0, r.wellbeing - TASKS[type].loss);
  if (type === 'pad') {
    r.hygiene ??= {};
    r.hygiene.body = r.hygiene.bedding = true;
  }
  if (type === 'turn') r.pressureRisk = true;
  if (type === 'feed') r.poorIntakeUntil = now + 120;
}

export function createRoutine({ s, ui, dist, trolleys, harm, nurseGoto, bedSide }) {
  const write = (round, entry, actor, status, detail, time = s.now) => {
    const rec = { time, due: round.start, task: round.label, actor, status, detail };
    entry.r.careRecords ??= [];
    entry.r.careRecords.push(rec);
    if (entry.r.careRecords.length > 48) entry.r.careRecords.shift();
    s.stats.log.push(`${fmtTime(time)} — ${entry.r.name}: ${round.label}, ${detail} (${actor}).`);
  };
  function startShift() {
    s.rounds = scheduleFor(['AM', 'PM', 'NIGHT'][s.shiftIdx], s.day).map((round) => ({
      ...round, entries: s.residents.filter((r) => eligible(r, round.type)).map((r) => ({ r, status: 'pending', nurse: null })),
    }));
    s.routineFocus = null;
    s.stats.routine = { done: 0, npcDone: 0, missed: 0, falseCharted: 0, harmed: 0 };
  }
  function due(r) {
    const matches = s.rounds?.filter((round) => inWindow(round, s.now))
      .flatMap((round) => round.entries.filter((entry) => entry.r === r && entry.status === 'pending').map((entry) => ({ round, entry }))) ?? [];
    if (s.routineFocus?.r === r) matches.sort((a, b) => Number(b.round.id === s.routineFocus.roundId) - Number(a.round.id === s.routineFocus.roundId));
    return matches;
  }
  function ready(r, round) {
    const kind = TASKS[round.type].trolley;
    return (!kind || trolleys.nearby(kind, r)) && (round.type !== 'feed' || s.mealTray);
  }
  function canDo(r, round, entry) {
    return s.running && !s.paused && !s.escort && r.alive && dist(s.player, r.pos) <= 2.3 &&
      inWindow(round, s.now) && entry.status === 'pending' && ready(r, round);
  }
  function freeNurse(entry) {
    if (entry.nurse?.routineJob?.entry === entry) {
      entry.nurse.routineJob = null; entry.nurse.path = []; entry.nurse.wait = 2;
    }
    entry.nurse = null;
  }
  function complete(r, round, entry, actor = 'You') {
    if (entry.status !== 'pending' || !r.alive || !inWindow(round, s.now)) return false;
    if (actor === 'You' && !canDo(r, round, entry)) return false;
    entry.status = 'done';
    freeNurse(entry);
    r.wellbeing = Math.min(100, r.wellbeing + 4);
    if (round.type === 'pad') { r.hygiene ??= {}; r.hygiene.body = r.hygiene.bedding = false; }
    if (round.type === 'turn') { r.pressureRisk = false; r.lastTurn = s.now; }
    if (round.type === 'feed') {
      r.poorIntakeUntil = 0;
      if (actor === 'You') trolleys.consumeTray();
    }
    if (actor === 'You') {
      s.stats.routine.done++;
      gesture(s.player.mesh, round.type === 'feed' ? 'pickup' : 'interact', 1.5);
      ui.toast(`${round.label} completed for ${r.name}.`);
    } else s.stats.routine.npcDone++;
    gesture(r.mesh, 'talk', 1.2);
    write(round, entry, actor, 'done', 'care seen at bedside');
    if (s.waypoint?.routine === round.id && s.waypoint.ref === r) waypoint(round.id);
    return true;
  }
  function harmful(r, round, entry, variant) {
    return harm.commit(r, { ...variant, id: `routine-${variant.id}` }, () => {
      entry.status = variant.chart ? 'false-charted' : 'harmed';
      freeNurse(entry);
      s.stats.routine[variant.chart ? 'falseCharted' : 'harmed']++;
      if (round.type === 'turn') r.pressureRisk = true;
      if (variant.id === 'wetPad') { r.hygiene ??= {}; r.hygiene.body = r.hygiene.bedding = true; }
      if (round.type === 'feed') { r.withholdUntil = s.now + 120; trolleys.consumeTray(); }
      if (variant.id === 'wrong') r.medicationConcernUntil = s.now + 240;
      if (variant.id === 'omit') r.missedMedicineUntil = s.now + 120;
      gesture(s.player.mesh, ['roughTurn', 'forceFeed'].includes(variant.id) ? 'push' : variant.id === 'mock' ? 'talk' : 'interact', 1.6);
      gesture(r.mesh, 'hit', 1.4);
      write(round, entry, 'You', entry.status, variant.label);
    }, () => canDo(r, round, entry) && VARIANTS[round.type].includes(variant));
  }
  function options(r) {
    return due(r).flatMap(({ round, entry }) => [
      {
        label: `Care: ${round.label} — due ${fmtTime(round.start)} (hold E)`, cls: 'primary',
        fn: () => { s.routineFocus = { r, roundId: round.id }; ui.closePanel(); },
      },
      ...VARIANTS[round.type].map((variant) => ({
        label: `Harm: ${variant.label} (score −8)`, cls: 'danger', disabled: !canDo(r, round, entry),
        fn: () => harmful(r, round, entry, variant),
      })),
    ]);
  }
  function interaction(r) {
    const matches = due(r);
    const job = s.routineFocus?.r === r ? matches[0] : matches.find(({ round }) => ready(r, round)) ?? matches[0];
    if (!job) return null;
    const { round, entry } = job;
    if (!ready(r, round)) {
      const kind = TASKS[round.type].trolley;
      const supply = kind ? s.trolleys.find((t) => t.kind === kind) : MEAL_SPOT;
      return { kind: 'tap', label: `${round.label}: ${kind ? TROLLEYS[kind].label + ' needed nearby' : 'pick up a meal tray'}`,
        run: () => { s.waypoint = { ...(supply?.pos ?? supply), label: kind ? TROLLEYS[kind].label : MEAL_SPOT.label }; ui.toast('Get the required supply, then return to this resident.'); } };
    }
    return {
      kind: 'hold', dur: 1.8, minutes: TASKS[round.type].minutes, beforeTime: true,
      label: `${round.label}: ${r.name}`, run: () => complete(r, round, entry),
    };
  }
  function minute(time) {
    for (const round of s.rounds ?? []) {
      for (const entry of round.entries) if (entry.nurse && (entry.nurse.suspended || !s.onShift.includes(entry.nurse))) freeNurse(entry);
      if (!round.announced && time >= round.start) {
        round.announced = true;
        if (round.entries.some((entry) => allocatedToPlayer(entry.r))) ui.toast(`${round.label} starts — due ${fmtTime(round.start)}–${fmtTime(round.end)}. Open Tasks.`);
      }
      if (round.closed || time < round.end) continue;
      round.closed = true;
      for (const entry of round.entries) if (entry.status === 'pending' && entry.r.alive) {
        entry.status = 'missed'; freeNurse(entry);
        missedEffect(entry.r, round.type, time);
        s.stats.routine.missed++;
        write(round, entry, 'Uncompleted', 'missed', round.type === 'turn' ? 'missed; pressure-area risk' : 'window closed without care', time);
      }
    }
  }
  function npcNext(n) {
    if (n.routineJob || n.bell || n.escort || n.suspended || n.offFloorUntil > s.now || n.breakUntil > s.now) return false;
    const job = s.rounds.filter((round) => inWindow(round, s.now)).flatMap((round) => round.entries
      .filter((entry) => entry.status === 'pending' && !entry.nurse && entry.r.alive && n.assigned.includes(entry.r.bed.room))
      .map((entry) => ({ round, entry })))[0];
    if (!job) return false;
    const { round, entry } = job;
    if (n.disposition === 'harmful' && !n.supervised && dist(n.pos, entry.r.pos) > 2.3 && Math.random() < 0.65) {
      entry.status = 'false-charted';
      missedEffect(entry.r, round.type, s.now);
      s.stats.routine.falseCharted++;
      n.falseCharts = (n.falseCharts ?? 0) + 1;
      write(round, entry, n.name, 'false-charted', `charted ${fmtTime(round.start)} by ${n.name} — not seen at bedside`);
      gesture(n.mesh, 'interact', 1);
      n.wait = 2;
      return true;
    }
    entry.nurse = n; n.routineJob = { ...job, remaining: 1.5 };
    nurseGoto(n, entry.r.mode === 'bed' ? bedSide(entry.r.bed) : entry.r.pos);
    return true;
  }
  function npcUpdate(n, dt) {
    const job = n.routineJob;
    if (!job) return false;
    if (!job.entry.r.alive || job.entry.status !== 'pending' || !inWindow(job.round, s.now)) { freeNurse(job.entry); return false; }
    if (dist(n.pos, job.entry.r.pos) > 2.3) { nurseGoto(n, job.entry.r.mode === 'bed' ? bedSide(job.entry.r.bed) : job.entry.r.pos); return true; }
    gesture(n.mesh, 'interact', 1.3);
    gesture(job.entry.r.mesh, 'talk', 1.2);
    job.remaining -= dt;
    if (job.remaining <= 0) complete(job.entry.r, job.round, job.entry, n.name);
    return true;
  }
  function waypoint(id) {
    const round = s.rounds.find((r) => r.id === id);
    const next = round?.entries.find((entry) => allocatedToPlayer(entry.r) && entry.r.alive && entry.status === 'pending');
    if (next) {
      s.routineFocus = { r: next.r, roundId: id };
      s.waypoint = { ref: next.r, x: next.r.pos.x, z: next.r.pos.z, label: round.label, routine: id };
    } else if (s.waypoint?.routine === id) s.waypoint = null;
  }
  function rows() {
    return s.rounds.filter((round) => inWindow(round, s.now)).map((round) => {
      const entries = round.entries.filter((entry) => allocatedToPlayer(entry.r) && entry.r.alive);
      return { id: round.id, label: round.label, due: `${fmtTime(round.start)}–${fmtTime(round.end)}`,
        done: entries.filter((e) => e.status === 'done').length, total: entries.length,
        unsafe: entries.filter((e) => ['harmed', 'false-charted'].includes(e.status)).length };
    }).filter((row) => row.total);
  }
  function notes(r) {
    const lines = [
      r.pressureRisk && 'Pressure-area risk: missed or unsafe turning',
      r.medicationConcernUntil > s.now && 'Medication mismatch: monitoring needed',
      r.missedMedicineUntil > s.now && 'Medicine omitted: care review needed',
      r.withholdUntil > s.now && 'Poor intake: support needed',
      r.poorIntakeUntil > s.now && 'Missed assisted meal: poor intake',
    ].filter(Boolean);
    for (const rec of (r.careRecords ?? []).slice(-4)) {
      lines.push(`${fmtTime(rec.due)} ${rec.task} — ${rec.status}: ${rec.detail} (${rec.actor})`);
      if (rec.status === 'false-charted') {
        const nurse = s.nurses.find((n) => n.name === rec.actor);
        if (nurse) nurse.evidenceFound = true;
      }
    }
    return lines;
  }
  function records() {
    const entries = s.residents.flatMap((r) => (r.careRecords ?? []).map((rec) => ({ r, rec }))).sort((a, b) => b.rec.time - a.rec.time).slice(0, 100);
    for (const { rec } of entries) if (rec.status === 'false-charted') {
      const n = s.nurses.find((n) => n.name === rec.actor);
      if (n) n.evidenceFound = true;
    }
    ui.dialogue('Routine-care records', `<small>Bedside care is distinct from charting. Single Rooms are your allocation; other rooms are optional.</small><ul>${entries.map(({ r, rec }) =>
      `<li>${esc(r.name)} · ${fmtTime(rec.due)} ${esc(rec.task)}: ${esc(rec.status)} — ${esc(rec.detail)} (${esc(rec.actor)})</li>`).join('') || '<li>No entries yet.</li>'}</ul>`,
    [{ label: 'Close', fn: () => ui.closePanel() }]);
  }
  return { startShift, due, complete, harmful, options, interaction, minute, npcNext, npcUpdate, rows, waypoint, notes, records };
}
