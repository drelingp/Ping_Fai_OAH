import { gesture } from './assets.js';
import { fmtTime } from './ui.js';

export const COLLEAGUE_ACTIONS = [
  { id: 'cover', label: 'Cover her break', positive: true },
  { id: 'praise', label: 'Praise good work', positive: true },
  { id: 'concern', label: 'Raise a concern privately', positive: true },
  { id: 'report', label: 'Report misconduct formally to the manager', positive: true },
  { id: 'shout', label: 'Shout / belittle her' },
  { id: 'dump', label: 'Dump your work on her' },
  { id: 'credit', label: 'Take credit / blame her for your mistake' },
  { id: 'falseReport', label: 'Falsely report her' },
  { id: 'exclude', label: 'Exclude her from the break' },
  { id: 'push', label: 'Push / shove her' },
];
export const offFloor = (n, now) => !!n.suspended || n.offFloorUntil > now || n.breakUntil > now || n.arriveAt > now;
export function awardPositive(s, n) {
  const bonus = Math.min(2, Math.max(0, 6 - (s.colleagueBonus ?? 0)));
  s.colleagueBonus = (s.colleagueBonus ?? 0) + bonus;
  n.trust = Math.min(100, n.trust + 6);
  s.reputation = Math.min(100, s.reputation + 2);
  return bonus;
}
export function colleagueHarm(s, n, id) {
  const penalty = id === 'push' ? 8 : 5;
  s.colleaguePenalty = (s.colleaguePenalty ?? 0) + penalty;
  n.trust = Math.max(0, n.trust - 18);
  n.refusesHelp = true;
  s.suspicion = Math.min(100, s.suspicion + 4);
  s.reputation = Math.max(0, s.reputation - 3);
  if (n.disposition === 'harmful') return { penalty, reaction: 'retaliate', staggerSeconds: 2, lostMinutes: 2 };
  if (n.disposition === 'overwhelmed') {
    n.offFloorUntil = s.now + 30;
    return { penalty, reaction: 'walkOff' };
  }
  return { penalty, reaction: 'report' };
}

export function createColleague({ s, ui, dist, report, advance, evidenceFor = () => false, routine }) {
  function reset() {
    s.colleagueBonus = 0; s.colleaguePenalty = 0; s.colleagueCooldown = 0; s.staggerUntil = 0;
    s.stats.colleagueActs = 0;
    for (const n of s.nurses) {
      n.refusesHelp = false; n.colleagueUntil = 0; n.offFloorUntil = 0; n.breakUntil = 0; n.departingUntil = 0; n.gossipAt = null;
    }
  }
  const available = (n) => s.running && !s.paused && !s.escort && !offFloor(n, s.now) && s.onShift.includes(n) &&
    dist(s.player, n.pos) <= 2.3 && !(n.colleagueUntil > s.now) && !(s.colleagueCooldown > s.now);
  const log = (text) => s.stats.log.push(`${fmtTime(s.now)} — Colleague conduct: ${text}`);
  function rewardHelp(n) {
    const bonus = awardPositive(s, n);
    log(`helped ${n.name} with bedside care; score +${bonus}.`);
  }
  function reserveHelp(n) {
    if (!available(n) || n.refusesHelp) return false;
    n.colleagueUntil = s.now + 20; s.colleagueCooldown = s.now + 5;
    return true;
  }
  function act(n, id) {
    const action = COLLEAGUE_ACTIONS.find((a) => a.id === id);
    if (!action || !available(n)) { ui.toast('This colleague is unavailable or needs space. Try again after the cooldown.'); return false; }
    if (action.positive && n.refusesHelp) { ui.toast('She refuses your help for the rest of this shift.'); return false; }
    if (id === 'concern' && s.onShift.some((other) => other !== n && !offFloor(other, s.now) && dist(other.pos, n.pos) < 5)) {
      ui.toast('Find a private moment away from other staff.'); return false;
    }
    n.colleagueUntil = s.now + 20; s.colleagueCooldown = s.now + 5;
    s.stats.colleagueActs++;
    s.player.heading = Math.atan2(n.pos.x - s.player.x, n.pos.z - s.player.z);
    gesture(s.player.mesh, id === 'push' ? 'push' : 'talk', 1.5);
    ui.closePanel();
    if (action.positive) {
      if (id === 'report' && !(n.disposition === 'harmful' && (n.evidenceFound || evidenceFor(n)))) {
        n.trust = Math.max(0, n.trust - 12); s.reputation = Math.max(0, s.reputation - 5); s.suspicion = Math.min(100, s.suspicion + 10);
        log(`unsupported report against ${n.name}; manager requested evidence, staff backlash. No bonus.`);
        ui.toast('No supporting evidence: the manager returns the report. Reputation −5; suspicion +10.');
        return true;
      }
      const bonus = awardPositive(s, n);
      gesture(n.mesh, 'talk', 1.4);
      if (id === 'cover') {
        n.breakUntil = s.now + 15;
        n.path = []; n.bell = null;
        for (const b of s.bells) if (b.nurse === n) b.nurse = null;
        if (n.routineJob) { n.routineJob.entry.nurse = null; n.routineJob = null; }
        const r = s.residents.find((r) => r.alive && n.assigned.includes(r.bed?.room) && routine.due(r).length);
        if (r) s.waypoint = { ref: r, x: r.pos.x, z: r.pos.z, label: 'Break cover: bedside care' };
      }
      if (id === 'report') { n.supervised = true; n.investigationPending = true; n.suspensionRisk = true; }
      log(`${action.label} — ${n.name}; score +${bonus}${id === 'report' ? '; investigation opened, supervised practice and suspension risk' : ''}.`);
      ui.toast(`${action.label}: trust and reputation improve. Score +${bonus}${id === 'report' ? '; manager investigation opened' : ''}.`);
      return true;
    }
    const outcome = colleagueHarm(s, n, id);
    n.gossipAt = s.now + 10;
    gesture(n.mesh, 'hit', 1.2);
    if (outcome.reaction === 'retaliate') {
      gesture(n.mesh, 'push', 1.6); gesture(s.player.mesh, 'hit', 2);
      s.staggerUntil = performance.now() + outcome.staggerSeconds * 1000;
      s.reputation = Math.max(0, s.reputation - 3);
      advance(outcome.lostMinutes);
    } else if (outcome.reaction === 'walkOff') {
      gesture(n.mesh, 'talk', 1.5); n.path = []; n.mesh.visible = false;
      n.departingUntil = performance.now() + 1600;
      n.mesh.rotation.y = s.player.heading;
      for (const b of s.bells) if (b.nurse === n) b.nurse = null;
      n.bell = null;
      if (n.routineJob) { n.routineJob.entry.nurse = null; n.routineJob = null; }
    } else report(n.name);
    for (const witness of s.onShift) if (witness !== n && !offFloor(witness, s.now) && dist(witness.pos, n.pos) < 7 && Math.random() < 0.6) report(witness.name);
    log(`${action.label} — ${n.name}; score −${outcome.penalty}; ${outcome.reaction}. Refuses help this shift.`);
    const reaction = { retaliate: 'She shoves and shouts back. You stagger and lose two minutes.', walkOff: 'She cries and leaves the floor for 30 minutes. You are short-staffed.', report: 'She reports you to the manager.' }[outcome.reaction];
    ui.toast(`${reaction} Score −${outcome.penalty}. She refuses help and will gossip.`, 5500);
    return true;
  }
  function options(n) {
    return COLLEAGUE_ACTIONS.map((action) => ({
      label: `${action.positive ? 'Colleague' : 'Harm'}: ${action.label} (${action.positive ? 'bonus +2, cap +6' : `score −${action.id === 'push' ? 8 : 5}`})`,
      cls: action.positive ? '' : 'danger', disabled: !available(n) || (action.positive && n.refusesHelp),
      fn: () => act(n, action.id),
    }));
  }
  function minute(time) {
    for (const n of s.nurses) if (n.gossipAt !== null && n.gossipAt !== undefined && time >= n.gossipAt) {
      n.gossipAt = null; s.suspicion = Math.min(100, s.suspicion + 4);
      log(`${n.name} told the team about your conduct; suspicion +4.`);
    }
  }
  return { reset, options, act, available, rewardHelp, reserveHelp, minute };
}
