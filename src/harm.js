// Fictional misconduct choices and their lasting consequences; no real medication details.
import * as THREE from 'three';
import { gesture } from './assets.js';
import { makeRestraintProps, updateRestraintProps } from './people.js';
import { translate } from './i18n.js';

const ACTIONS = [
  { id: 'restrain', label: 'Apply restraint without cause', cost: 15 },
  { id: 'rough', label: 'Handle roughly', cost: 10 },
  { id: 'shout', label: 'Shout at resident', cost: 6 },
  { id: 'silence', label: 'Silence call bell without care', cost: 8 },
  { id: 'withhold', label: 'Withhold food / fluids', cost: 0 },
  { id: 'sedate', label: 'Over-sedate without authorisation', cost: 12 },
];
const strapGeo = new THREE.BoxGeometry(0.06, 0.04, 0.14);
const strapMat = new THREE.MeshStandardMaterial({ color: 0xd8cfa6, roughness: 0.9 });

export function createHarm({ s, ui, map, clamp, dist, fmtTime, placeInBed, case1, escort = null }) {
  // The actor turns to the resident and both react, so every act is visible in the scene.
  function perform(r, actorAnim, residentAnim) {
    const p = s.player;
    if (r.pos) p.heading = Math.atan2(r.pos.x - p.x, r.pos.z - p.z);
    gesture(p.mesh, actorAnim, 1.4);
    if (residentAnim) gesture(r.mesh, residentAnim, 1.2);
  }
  const nearby = (a, b) => dist(a.pos, b.pos) < 7 ||
    map.roomAt(a.pos.x, a.pos.z)?.id === map.roomAt(b.pos.x, b.pos.z)?.id;
  const record = (text) => {
    s.stats.log.push(`${fmtTime(s.now)} — ${text}`);
  };
  function report(name) {
    s.reputation = clamp(s.reputation - 10, 0, 100);
    s.suspicion = clamp(s.suspicion + 12, 0, 100);
    s.stats.harmReports++;
    record(`${name} reported your conduct.`);
    ui.toast(`${name} reported your conduct. Reputation −10; suspicion +12.`, 5000);
  }
  function status(r) {
    return [
      r.playerRestrained && 'Restrained by you without cause',
      r.withholdUntil > s.now && 'Food / fluids withheld',
      r.sedatedUntil > s.now && 'Over-sedated; needs monitoring',
    ].filter(Boolean);
  }
  function valid(r, id) {
    if (!r.alive || !s.running || s.paused || dist(s.player, r.pos) > 2.3) return false;
    if (id === 'restrain') return !r.playerRestrained && !s.escort;
    if (id === 'silence') return s.bells.some((b) => b.res === r);
    if (id === 'withhold') return !(r.withholdUntil > s.now);
    if (id === 'sedate') return !(r.sedatedUntil > s.now) && (s.trolleys
      ? s.pushingTrolley?.kind === 'med'
      : s.medicineRound || map.inStation(s.player));
    return true;
  }
  function release(r) {
    if (!r.playerRestrained || dist(s.player, r.pos) > 2.3 || !s.running || s.paused) {
      ui.toast('Move beside the resident to release the restraint.');
      return;
    }
    r.playerRestrained = false;
    r.restraintVisual?.removeFromParent();
    r.restraintVisual = null;
    record(`You released ${r.name}'s unauthorised restraint. The conduct penalty remains.`);
    ui.toast('Restraint released. Earlier harm and score penalties are not erased.');
    ui.closePanel();
  }
  function restrainVisual(r) {
    r.restrainedAt = s.now;
    if (r.mode === 'bed' && r.bed) {
      const props = makeRestraintProps(r.bed, r.mesh);
      r.mesh.parent?.add(props);
      r.restraintVisual = props;
      return;
    }
    const inner = r.mesh.userData.anim?.inner;
    if (!inner) return;
    const g = new THREE.Group();
    for (const name of ['hand_l', 'hand_r']) {
      const bone = inner.getObjectByName(name);
      if (!bone) continue;
      const strap = new THREE.Mesh(strapGeo, strapMat);
      strap.castShadow = true;
      bone.add(strap);
      // Keep references for release without changing the rig's transforms.
      g.userData.straps ??= [];
      g.userData.straps.push(strap);
    }
    g.addEventListener('removed', () => g.userData.straps?.forEach((m) => m.removeFromParent()));
    r.mesh.add(g);
    r.restraintVisual = g;
  }
  function commit(r, action, effect, validate = () => valid(r, action.id)) {
    if (!valid(r, action.id) || !validate()) {
      ui.toast('This action is unavailable. Move beside a living resident and check their current needs.');
      return false;
    }
    r.wellbeing = clamp(r.wellbeing - action.cost, 0, 100);
    r.fearOf = 'player';
    s.stats.harm++;
    s.totalHarm++;
    if (s.totalHarm >= 3 && !s.conductInquiry) {
      s.conductInquiry = true;
      ui.toast('Repeated misconduct has triggered an inquiry into your conduct.', 6000);
      record('An inquiry into your conduct was opened.');
    }
    record(`Your conduct: ${action.label} — ${r.name}. Score −8.`);
    case1.onPlayerHarm(r);
    effect?.();
    witnesses(r);
    ui.closePanel();
    ui.toast(`Your conduct: ${action.label}. Shift score −8; resident safety worsened.`, 5000);
    return true;
  }
  function act(r, action) {
    return commit(r, action, () => performAction(r, action));
  }
  function performAction(r, action) {
    switch (action.id) {
      case 'restrain':
        // Committed here (penalty above); the restraint itself is applied at the bedside.
        if (escort?.start(r, () => { r.playerRestrained = true; restrainVisual(r); })) break;
        if (r.mode === 'wander') r.mesh.userData.mode = 'stand';
        r.playerRestrained = true;
        restrainVisual(r);
        break;
      case 'rough':
        perform(r, 'interact', 'hit');
        if (Math.random() < 0.1) {
          r.wellbeing = clamp(r.wellbeing - 15, 0, 100);
          s.stats.incidents++;
          record(`${r.name} fell after rough handling.`);
          ui.toast(`Incident: ${r.name} fell.`);
        }
        break;
      case 'shout':
        perform(r, 'talk', 'hit');
        for (const other of s.residents) if (other !== r && other.alive && dist(other.pos, r.pos) < 7) {
          other.wellbeing = clamp(other.wellbeing - 2, 0, 100);
        }
        break;
      case 'silence': {
        perform(r, 'interact', 'talk');
        const bell = s.bells.find((b) => b.res === r);
        if (bell.nurse) { bell.nurse.bell = null; bell.nurse.path = []; }
        s.bells = s.bells.filter((b) => b !== bell);
        r.silencedNeed = { need: bell.need, due: s.now + 15 };
        if (s.waypoint?.bell === bell) s.waypoint = null;
        // No credit for answering: the unmet need counts against call-bell care.
        s.stats.incidents++;
        break;
      }
      case 'withhold':
        perform(r, 'pickup', 'talk');
        r.withholdUntil = s.now + 180;
        break;
      case 'sedate':
        placeInBed(r);
        perform(r, 'interact', 'hit');
        r.sedatedUntil = s.now + 240;
        for (const bell of s.bells.filter((b) => b.res === r)) {
          if (bell.nurse) { bell.nurse.bell = null; bell.nurse.path = []; }
          r.silencedNeed = { need: bell.need, due: r.sedatedUntil };
          s.stats.incidents++;
        }
        s.bells = s.bells.filter((b) => b.res !== r);
        if (Math.random() < 0.05) {
          r.wellbeing = clamp(r.wellbeing - 35, 0, 100);
          s.stats.incidents++;
          record(`${r.name} suffered serious harm after unauthorised sedation.`);
          ui.toast(`Serious incident: ${r.name} needs monitoring.`, 5000);
        }
        break;
    }
  }
  function witnesses(r) {
    for (const n of s.onShift) {
      if (n.suspended || n.offFloorUntil > s.now || n.breakUntil > s.now || (n.arriveAt && s.now < n.arriveAt) || !nearby(n, r)) continue;
      if (n.disposition === 'harmful') {
        n.trust = clamp(n.trust + 5, 0, 100);
        n.witnessedHarm = (n.witnessedHarm ?? 0) + 1;
      }
      else {
        const chance = clamp(0.6 - Math.max(0, n.trust - 40) * 0.004, 0.2, 0.6);
        n.trust = clamp(n.trust - 12, 0, 100);
        if (Math.random() < chance) report(n.name);
      }
    }
    for (const other of s.residents) {
      if (other === r || !other.alive || other.sedatedUntil > s.now || (s.shiftIdx === 2 && other.mode === 'bed') || !nearby(other, r)) continue;
      other.fearOf = 'player';
      other.wellbeing = clamp(other.wellbeing - 2, 0, 100);
      if (Math.random() < 0.25) s.conductReports.push({ name: other.name, day: s.day, shift: s.shiftIdx });
    }
  }
  function options(r) {
    if (!r.alive || !s.running || s.paused || dist(s.player, r.pos) > 2.3) return [];
    return [
      ...(r.playerRestrained ? [{ label: 'Release your unauthorised restraint', fn: () => release(r), cls: 'primary' }] : []),
      ...ACTIONS.map((action) => ({
        label: `Harm: ${action.label}${action.id === 'sedate' ? ' (medicine round required)' : ''} (score −8)`,
        cls: 'danger',
        disabled: !valid(r, action.id),
        fn: () => {
          if (action.id !== 'restrain') { act(r, action); return; }
          ui.dialogue('Unauthorised restraint', 'This is fictional misconduct, not care. It harms the resident and costs 8 score points. Hold the button for 1.5 seconds to commit it.', [], '<button class="opt danger" id="harm-hold">Hold to apply restraint</button>');
          const button = document.getElementById('harm-hold');
          let timer = null;
          const cancel = () => { clearTimeout(timer); timer = null; button.textContent = translate('Hold to apply restraint'); };
          const begin = () => {
            if (timer !== null) return;
            button.textContent = translate('Applying restraint…');
            timer = setTimeout(() => {
              timer = null;
              if (ui.panelOpen && button.isConnected) act(r, action);
            }, 1500);
          };
          button.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            button.setPointerCapture(e.pointerId);
            begin();
          });
          button.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); } });
          button.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cancel(); } });
          for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) button.addEventListener(event, cancel);
        },
      })),
    ];
  }
  function minute(time) {
    for (const r of s.residents) {
      if (!r.alive) continue;
      if (r.playerRestrained) r.wellbeing -= 2 / 60;
      if (r.withholdUntil >= time) r.wellbeing -= 4 / 60;
    }
  }
  function nextShift() {
    for (const reportEntry of s.conductReports) {
      if (reportEntry.day !== s.day || reportEntry.shift !== s.shiftIdx) report(`A visitor, after hearing ${reportEntry.name}`);
    }
    s.conductReports = s.conductReports.filter((x) => x.day === s.day && x.shift === s.shiftIdx);
  }
  function remove(r) {
    r.restraintVisual?.removeFromParent();
    r.restraintVisual = null;
  }
  function frame() {
    for (const r of s.residents) if (r.playerRestrained && r.restraintVisual) {
      r.restraintVisual.visible = r.mesh.visible;
      updateRestraintProps(r.restraintVisual, s.now - r.restrainedAt);
    }
  }
  return { options, status, minute, nextShift, remove, commit, report, frame, act, release };
}
