// Case 1 — "Bed 4-2": a resident left restrained all night, care charted but never given.

const ORDER = ['handover', 'rounds', 'discovered', 'confronted', 'decided'];

export function createCase1(ctx) {
  const { s, game, ui, map, scene, esc, fmtTime, clamp, dist, spawnBell, makeRestraintProps, makeUrineBag } = ctx;
  const c = {
    stage: 'handover', evidence: {}, care: { released: false, bag: false, washed: false },
    chan: null, lee: null, props: null, bag: null, leeBellDone: false, result: null, decidedKey: null, chanDied: false, conductPenalty: 0,
  };
  const at = (st) => ORDER.indexOf(c.stage) >= ORDER.indexOf(st);
  const careCount = () => Number(c.care.released) + Number(c.care.bag) + Number(c.care.washed);
  const careDone = () => careCount() === 3;
  const ko = () => s.nurses.find((n) => n.id === 'ko');
  const yip = () => s.nurses.find((n) => n.id === 'yip');
  const strength = () => ['records', 'witness', 'colleague', 'cctv'].filter((k) => c.evidence[k]).length;
  const shiftKey = () => `${s.day}-${s.shiftIdx}`;

  const EVIDENCE = {
    obs: ['Bedside observation', 'Wrists restrained to the bed frame, skin red and indented. Catheter bag overflowing, bedding soaked, unwashed. Call bell clipped out of reach. Handover claimed 2-hourly release, bath at 05:30 and bag emptied at 06:00.'],
    denial: ["Nurse Ko's statement", 'Claims she did the 07:30 round and he was "fine". Says the records must be wrong and blames the night shift. Became guarded.'],
    records: ['Restraint & ADL charts', 'Restraint applied 21:10 (Yip). No release checks signed overnight. ADL chart blank since 14:00 yesterday. Ko signed "07:30 — care given, comfortable" at the nurse station.'],
    witness: ["Mr. Lee's account (Bed 4-5)", 'At 07:30 Nurse Ko stood at the door, wrote on the clipboard and left without touching Mr. Chan. Night nurse tied him at about nine and never came back. Lee rang six times.'],
    colleague: ['A colleague, in private', 'Ko tells night staff to "keep 4-2 quiet" so he doesn\'t ring, and signs her rounds from the station. It has been going on all week.'],
    cctv: ['Corridor CCTV (Camera 3)', 'Bedroom 4 door: Yip enters 21:08, exits 21:15. No entries overnight. Ko enters 07:31, exits 07:32 with clipboard.'],
  };

  // ---------- setup ----------
  function residents() {
    return [
      {
        name: 'Mr. Chan Kwok-wing', sex: 'M', age: 84, mobility: 'bedbound', bedId: '4-2', wellbeing: 38, case: true, story: true,
        personality: 'Proud former minibus driver; goes silent when frightened',
        routine: 'Used to listen to the horse racing on the radio every afternoon',
        needs: ['Bed-bound after stroke', 'Urinary catheter', "Wrist restraint ONLY per doctor's order — release & check every 2 h"],
        note: 'Pulls at his catheter when distressed. Restraint order is three weeks old and overdue for review.',
      },
      {
        name: 'Mr. Lee Chi-ming', sex: 'M', age: 79, mobility: 'bedbound', bedId: '4-5', wellbeing: 58, case: true, story: true,
        personality: 'Sharp-eyed and sarcastic; frightened of the night staff',
        routine: 'Pretends to be asleep when the night nurse comes in',
        needs: ['Bed-bound after hip fracture', 'Pressure-injury risk (heels)'],
        note: 'Handover keeps describing him as "ringing for no reason".',
      },
    ];
  }
  function ensureRefs() {
    if (c.chan) return;
    c.chan = s.residents.find((r) => r.name === 'Mr. Chan Kwok-wing');
    c.lee = s.residents.find((r) => r.name === 'Mr. Lee Chi-ming');
    const b = c.chan.bed;
    c.props = makeRestraintProps();
    c.props.position.set(b.x, 0, b.z + b.headDir * 0.05);
    c.bag = makeUrineBag();
    c.bag.position.set(b.x - 0.56, 0.38, b.z);
    scene.add(c.props, c.bag);
  }

  // ---------- handover (Night → AM, Day 1) ----------
  function handover() {
    ensureRefs();
    if (!(s.day === 1 && s.shiftIdx === 0 && c.stage === 'handover')) return false;
    showHandoverDoc(() => { c.stage = 'rounds'; });
    return true;
  }
  function showHandoverDoc(onClose) {
    const others = s.residents.filter((r) => r.alive && !r.case).slice(0, 4);
    const lines = ['Slept well. Obs stable.', 'Poor fluid intake — encourage fluids.', 'Bed rails up, fall risk.', 'Agitated 02:00, settled with reassurance.'];
    const alloc = s.onShift.map((n) => `<li>${esc(n.name)}: ${n.assigned.map((a) => esc(map.roomById[a].name)).join(', ')}</li>`).join('');
    ui.openPanel(`
      <div class="doc">
        <div class="doc-head"><b>Shift Handover</b><span>Night → AM shift · Day 1 · written 06:45</span></div>
        <table class="doc-table">
          <tr><th>Bed</th><th>Resident</th><th>Notes</th></tr>
          ${others.slice(0, 2).map((r, i) => `<tr><td>${esc(r.bed.id)}</td><td>${esc(r.name)}</td><td class="hand">${lines[i]}</td></tr>`).join('')}
          <tr class="hl"><td>4-2</td><td>Mr. Chan Kwok-wing</td><td class="hand">Restless early night. Wrist restraint (Dr. order) released &amp; checked 23:00 / 01:00 / 03:00 / 05:00. Bathed 05:30. Catheter bag emptied 06:00 (600 ml). Settled, comfortable.</td></tr>
          <tr><td>4-5</td><td>Mr. Lee Chi-ming</td><td class="hand">Rang call bell ×6 overnight for no reason. Reminded not to disturb staff.</td></tr>
          ${others.slice(2, 4).map((r, i) => `<tr><td>${esc(r.bed.id)}</td><td>${esc(r.name)}</td><td class="hand">${lines[i + 2]}</td></tr>`).join('')}
        </table>
        <p class="sig">— Nurse Yip Suk-han (Night)</p>
        <h4>AM allocation</h4>
        <ul>${alloc}<li>You (Shift In-Charge): Single Rooms, float, call bells</li></ul>
        <p class="doc-note">Residents: ${s.residents.filter((r) => r.alive).length}. Compare what's written with what you actually find.</p>
        <button class="opt primary" id="hand-ok">Start rounds</button>
      </div>`, { cls: 'paper', onClose });
    ui.bind('#hand-ok', () => ui.closePanel());
  }

  // ---------- per-minute ----------
  function minute() {
    if (!c.chan) return;
    if (s.day === 1 && s.shiftIdx === 0 && !c.leeBellDone && s.now >= 7 * 60 + 18 && c.lee.alive) {
      c.leeBellDone = true;
      if (!at('discovered')) spawnBell(c.lee, 'Asking for help — "not for me"', false, { caseBell: true });
    }
    if (c.chan.alive) {
      if (careDone()) c.chan.wellbeing = Math.min(100, c.chan.wellbeing + 0.05);
      else c.chan.wellbeing -= 0.12 * (1 - careCount() / 3);
    }
  }
  function onDeath(r) {
    if (r !== c.chan) return;
    c.chanDied = true;
    scene.remove(c.props, c.bag);
    s.stats.log.push('Mr. Chan Kwok-wing died restrained in Bed 4-2. The coroner will ask what was charted — and what was done.');
  }
  const emergency = () => !!c.chan?.alive && at('discovered') && !careDone() && c.chan.wellbeing < 25;

  // ---------- interactions on residents ----------
  function residentAction(r) {
    ensureRefs();
    if (r === c.chan) {
      if (!at('discovered')) return { kind: 'tap', label: 'Examine Mr. Chan (Bed 4-2)', run: examine };
      if (!c.care.released) return {
        kind: 'hold', dur: 2.0, minutes: 10, label: 'Release restraints & check circulation',
        run: () => { c.care.released = true; c.props.visible = false; scene.remove(c.props); ui.toast('His hands are cold. Circulation returns slowly. He doesn\'t let go of your sleeve.'); },
      };
      if (!c.care.bag) return {
        kind: 'hold', dur: 1.5, minutes: 5, label: 'Empty catheter bag & record output',
        run: () => { c.care.bag = true; scene.remove(c.bag); ui.toast('1,100 ml — dark, strong-smelling. Nobody has emptied this since last evening.'); },
      };
      if (!c.care.washed) {
        if (!s.linen) return {
          kind: 'tap', label: 'Wash & change Mr. Chan (needs clean linen)',
          run: () => { s.waypoint = { x: 19.6, z: 30.3, label: 'Linen trolley' }; ui.toast('Get clean linen from the trolley in the Bathroom. Waypoint set.'); },
        };
        return {
          kind: 'hold', dur: 3.0, minutes: 20, label: 'Wash Mr. Chan & change his bedding',
          run: () => { c.care.washed = true; s.linen = false; c.chan.wellbeing = Math.min(100, c.chan.wellbeing + 12); ui.toast('Clean, dry and repositioned. Sacral skin is red but intact. Mr. Lee is watching you.'); },
        };
      }
      return {
        kind: 'tap', label: 'Talk to Mr. Chan',
        run: () => ui.dialogue('Mr. Chan Kwok-wing', '"…You came back." He turns his face to the wall. "Don\'t let them tie me again. I only wanted the toilet."', [{ label: 'Close', fn: () => ui.closePanel() }]),
      };
    }
    if (r === c.lee) {
      const bell = s.bells.find((b) => b.res === c.lee && b.caseBell);
      if (bell) return {
        kind: 'tap', label: "Answer Mr. Lee's call bell",
        run: () => {
          game.resolveBell(bell, 'player');
          s.waypoint = { x: c.chan.bed.x, z: c.chan.bed.z, label: 'Bed 4-2' };
          ui.dialogue('Mr. Lee Chi-ming', '"Not for me." He jerks his chin across the aisle. "Him. Bed two. Look at him properly — don\'t just read the clipboard."', [{ label: 'Close', fn: () => ui.closePanel() }]);
        },
      };
      if (at('discovered') && !c.evidence.witness && !at('decided')) return { kind: 'tap', label: 'Ask Mr. Lee what he saw', run: askLee };
    }
    return null;
  }

  function examine() {
    ui.dialogue('Mr. Chan Kwok-wing — Bed 4-2', `
      <ul class="obs">
        <li>Both wrists strapped to the bed frame. The skin under the straps is red and indented.</li>
        <li>Restraint chart clipped to the bed: last entry <b>21:10 yesterday — "applied, Yip"</b>. No release checks.</li>
        <li>Catheter bag full and overflowing. Bedding soaked. He has not been washed.</li>
        <li>His call bell is clipped to the curtain rail — out of his reach.</li>
        <li>He whispers: <i>"Nobody came… I called and called."</i></li>
      </ul>
      <div class="mismatch"><b>Handover said:</b> released & checked 2-hourly, bathed 05:30, bag emptied 06:00. <b>None of it is true.</b></div>
      <small>Nurse Ko is assigned to Bedroom 4 this shift.</small>`, [
      {
        label: 'Record findings — then help him', cls: 'primary', fn: () => {
          c.stage = 'discovered'; c.evidence.obs = true;
          ui.closePanel();
          ui.toast('Case opened: Bed 4-2. Care steps are now available on Mr. Chan.');
        },
      },
    ]);
  }

  function askLee() {
    if (!c.care.released) {
      ui.dialogue('Mr. Lee Chi-ming', '"I don\'t want trouble. You\'ll go home at two. I\'m here tonight with <i>them</i>."<br><small>(He\'s watching what you do, not what you say.)</small>', [{ label: 'Close', fn: () => ui.closePanel() }]);
      return;
    }
    c.evidence.witness = true;
    c.lee.wellbeing = Math.min(100, c.lee.wellbeing + 5);
    ui.dialogue('Mr. Lee Chi-ming', `"You actually untied him. Nobody does that.<br>Half past seven, Nurse Ko stood in the doorway, wrote on the clipboard and left. Didn't touch him. The night one tied him up around nine and never came back. I rang six times. They wrote that I was 'ringing for no reason', didn't they?"`, [
      { label: 'Add to case file', cls: 'primary', fn: () => { ui.closePanel(); ui.toast('Evidence added: Mr. Lee\'s account.'); } },
    ]);
  }

  // ---------- nurses ----------
  function nurseTalk(n) {
    if (n.id === 'ko') { talkKo(n); return true; }
    if (s.day === 1 || at('confronted')) {
      if (n.shift === 'AM' && at('confronted') && !at('decided') && !c.evidence.colleague) {
        ui.dialogue(n.name, `"Busy morning."<br><small>Trust ${Math.round(n.trust)}</small>`, [
          { label: 'Speak privately about Bed 4-2', fn: () => privateTalk(n) },
          ...game.helpOption(n),
          { label: 'Leave', fn: () => ui.closePanel() },
        ]);
        return true;
      }
    }
    return false;
  }
  function talkKo(n) {
    if (!at('discovered')) {
      ui.dialogue(n.name, `"Morning. Yip said it was a quiet night."<br><small>Assigned: Bedroom 4, Bedroom 5</small>`, [...game.helpOption(n), { label: 'Leave', fn: () => ui.closePanel() }]);
      return;
    }
    if (c.stage === 'discovered') {
      ui.dialogue(n.name, '"Yes?"', [
        {
          label: 'Ask about Mr. Chan in Bed 4-2', fn: () => ui.dialogue(n.name, '"Bed 4-2? He\'s fine. I did my round at seven-thirty — it\'s signed."', [
            {
              label: '"He\'s been strapped down all night in his own urine. Explain."', fn: () => {
                c.stage = 'confronted'; c.evidence.denial = true;
                n.trust = clamp(n.trust - 25, 0, 100);
                s.suspicion = clamp(s.suspicion + 12, 0, 100);
                ui.dialogue(n.name, '"Then the records are wrong. Night shift writes whatever they like — talk to Yip, not me."<br>She folds her arms. "Are we done? I\'ve got eight residents to get up."<br><small>(She\'s guarded now. Staff suspicion rose.)</small>', [
                  { label: 'Leave it — for now', cls: 'primary', fn: () => { ui.closePanel(); ui.toast('Leads open: charts at the nurse station, Mr. Lee, a colleague in private, CCTV in the Ward Manager office.', 6000); } },
                ]);
              },
            },
          ]),
        },
        { label: 'Leave', fn: () => ui.closePanel() },
      ]);
      return;
    }
    const line = c.result?.option === 'supervise' ? '"Fine. I\'ll do it by the book. Happy?"' : c.result?.option === 'none' ? '"Told you it was nothing."' : '"I\'ve said what I said. Check the records if you don\'t believe me."';
    ui.dialogue(n.name, line, [...game.helpOption(n), { label: 'Leave', fn: () => ui.closePanel() }]);
  }
  function privateTalk(n) {
    const other = s.onShift.find((o) => o !== n && o.mesh.visible && dist(o.pos, n.pos) < 7);
    if (other) { ui.dialogue(n.name, `She glances toward ${esc(other.name)}. "Not here."<br><small>(Catch her alone.)</small>`, [{ label: 'Leave', fn: () => ui.closePanel() }]); return; }
    if (n.disposition === 'harmful') {
      s.suspicion = clamp(s.suspicion + 8, 0, 100);
      n.trust = clamp(n.trust - 8, 0, 100);
      ui.dialogue(n.name, '"Ko? She\'s fine. Maybe worry about your own charting."<br><small>(Word of your questions will travel. Suspicion rose.)</small>', [{ label: 'Leave', fn: () => ui.closePanel() }]);
      return;
    }
    if (n.trust < 52) {
      ui.dialogue(n.name, '"I… can\'t. I need this job."<br><small>(She doesn\'t trust you yet. Taking on some of her workload might change that.)</small>', [...game.helpOption(n), { label: 'Leave', fn: () => ui.closePanel() }]);
      return;
    }
    c.evidence.colleague = true;
    n.trust = clamp(n.trust + 5, 0, 100);
    c.ally = n;
    ui.dialogue(n.name, '"Ko tells night shift to \'keep 4-2 quiet\' so he doesn\'t ring. She signs her rounds from the station. All week. …Please don\'t say it came from me."', [
      { label: 'Add to case file', cls: 'primary', fn: () => { ui.closePanel(); ui.toast('Evidence added: a colleague\'s account.'); } },
    ]);
  }

  // ---------- nurse station & office ----------
  function records() {
    ensureRefs();
    const opts = [];
    if (s.day === 1 && s.shiftIdx === 0) opts.push({ label: 'Re-read the night handover', fn: () => showHandoverDoc(null) });
    if (at('confronted') && !c.evidence.records) opts.push({
      label: "Pull Mr. Chan's restraint & ADL charts (10 min)", cls: 'primary', fn: () => {
        game.advance(10);
        c.evidence.records = true;
        const k = ko();
        const seen = k && s.onShift.includes(k) && dist(k.pos, s.player) < 8;
        s.suspicion = clamp(s.suspicion + (seen ? 8 : 2), 0, 100);
        ui.dialogue('Charts — Bed 4-2', `
          <div class="doc inline"><table class="doc-table">
            <tr><th>Restraint chart</th><td class="hand">21:10 applied — Yip.</td></tr>
            <tr><th>Release checks</th><td>— blank —</td></tr>
            <tr><th>ADL chart</th><td>Blank since 14:00 yesterday.</td></tr>
            <tr><th>AM round log</th><td class="hand">07:30 Bed 4-2 — care given, comfortable. — Ko</td></tr>
          </table></div>${seen ? '<small>Ko watched you pull her charts.</small>' : ''}`, [{ label: 'Add to case file', cls: 'primary', fn: () => ui.closePanel() }]);
      },
    });
    const alloc = s.onShift.map((n) => `<li>${esc(n.name)}: ${n.assigned.map((a) => esc(map.roomById[a].name)).join(', ') || 'floating'}${n.arriveAt && s.now < n.arriveAt ? ' (arriving)' : ''}</li>`).join('');
    ui.dialogue('Nurse station', `<b>Allocation this shift</b><ul>${alloc || '<li>No other staff on floor</li>'}<li>You: Single Rooms, float</li></ul>`, [...opts, { label: 'Close', fn: () => ui.closePanel() }]);
  }

  function office() {
    ensureRefs();
    const opts = [];
    if (at('confronted') && !c.evidence.cctv) opts.push({
      label: 'Review corridor CCTV for Bedroom 4 (15 min)', fn: () => {
        game.advance(15);
        c.evidence.cctv = true;
        s.suspicion = clamp(s.suspicion + 5, 0, 100);
        ui.dialogue('CCTV — Camera 3 (Living Area A → Bedroom 4)', `
          <div class="doc inline cctv"><table class="doc-table">
            <tr><td>21:08</td><td>Nurse Yip enters Bedroom 4</td></tr>
            <tr><td>21:15</td><td>Nurse Yip exits</td></tr>
            <tr><td>21:15–07:31</td><td>No staff enter Bedroom 4</td></tr>
            <tr><td>07:31</td><td>Nurse Ko enters with clipboard</td></tr>
            <tr><td>07:32</td><td>Nurse Ko exits</td></tr>
          </table></div>`, [{ label: 'Add to case file', cls: 'primary', fn: () => ui.closePanel() }]);
      },
    });
    if ((at('confronted') || c.chanDied) && !at('decided') && at('discovered')) opts.push({ label: 'File a decision on the Bed 4-2 case', cls: 'primary', fn: decide });
    const text = !at('confronted') && at('discovered')
      ? 'Before you pull footage or file anything, talk to the nurse responsible. Going over her head first will look like a witch-hunt.'
      : at('decided') ? 'The Bed 4-2 case is filed.' : 'The manager is off-site. Her desk, CCTV terminal and incident forms are yours to use this shift.';
    ui.dialogue("Ward Manager's desk", text, [...opts, { label: 'Close', fn: () => ui.closePanel() }]);
  }

  function evidenceList() {
    return Object.entries(EVIDENCE).filter(([k]) => c.evidence[k]).map(([, [t, d]]) => `<li><b>${esc(t)}</b> — ${esc(d)}</li>`).join('') || '<li>Nothing recorded yet.</li>';
  }

  function decide() {
    const st = strength();
    ui.dialogue('Incident decision — Bed 4-2', `
      <p>Evidence strength: <b>${st}/4</b> independent sources (charts, witness, colleague, CCTV). Mr. Chan's care: <b>${careCount()}/3</b> steps done.</p>
      <ul class="evi">${evidenceList()}</ul>
      <label class="chk"><input type="checkbox" id="chk-review" checked> Request an urgent doctor's review of Mr. Chan's restraint order</label>
      <label class="chk"><input type="checkbox" id="chk-yip"> Also report Nurse Yip's falsified night handover</label>
      <p><small>Weigh intent, impact and context. A strong action on weak evidence can backfire.</small></p>`, [
      { label: 'Suspend Nurse Ko pending investigation & report to management', fn: () => finish('suspend') },
      { label: 'Formal incident report + supervised practice for Ko', fn: () => finish('supervise') },
      { label: 'Reassign Ko away from Bedroom 4 and keep watching', fn: () => finish('reassign') },
      { label: 'Take no action', fn: () => finish('none') },
    ]);
  }

  function finish(option) {
    const review = document.getElementById('chk-review')?.checked;
    const reportYip = document.getElementById('chk-yip')?.checked;
    const st = strength();
    const k = ko();
    let acc = 0;
    const out = [];
    if (option === 'suspend') {
      if (st >= 2) {
        acc = 70 + 8 * st;
        k.suspended = true; k.mesh.visible = false;
        s.onShift = s.onShift.filter((n) => n !== k);
        game.assignRooms();
        s.reputation += 6; s.suspicion = clamp(s.suspicion + 10, 0, 100);
        s.onShift.filter((n) => n.disposition !== 'harmful').forEach((n) => (n.trust = clamp(n.trust + 10, 0, 100)));
        out.push('Nurse Ko is suspended and escorted off the floor. Your AM roster is now a nurse short until a replacement is found. The harmful staff close ranks.');
      } else {
        acc = 30;
        s.reputation -= 3; s.suspicion = clamp(s.suspicion + 20, 0, 100);
        s.onShift.forEach((n) => (n.trust = clamp(n.trust - 10, 0, 100)));
        out.push("Premature: with almost nothing independent on paper, Ko's union rep challenges the suspension by phone and the manager overrules you. Ko stays — and now everyone knows you'll move without proof.");
      }
    } else if (option === 'supervise') {
      acc = st >= 1 ? 55 + 8 * st : 40;
      k.supervised = true;
      s.reputation += st >= 1 ? 3 : 0;
      out.push('A formal report is filed. Ko works under supervision: every round countersigned. Slower, safer — but she is still on the floor.');
    } else if (option === 'reassign') {
      acc = 35 + 5 * st;
      if (s.onShift.includes(k)) {
        const other = s.onShift.find((n) => n !== k);
        if (other) { const tmp = k.assigned; k.assigned = other.assigned; other.assigned = tmp; }
      }
      out.push('Ko is moved to other rooms. Mr. Chan is safer today; whoever she cares for next is not.');
    } else {
      acc = 10;
      s.reputation -= 6;
      out.push('No action. The charts stand as written. Mr. Lee stops looking at you.');
    }
    if (review) { acc += 10; out.push("The doctor reviews the order by phone: restraint discontinued; catheter secured differently; hourly checks instead."); }
    if (reportYip) {
      if (c.evidence.records || c.evidence.cctv) {
        acc += 5;
        const y = yip(); y.suspended = true;
        out.push('Nurse Yip is reported too. The night shift will be short-handed until cover is found.');
      } else {
        acc -= 10; s.suspicion = clamp(s.suspicion + 10, 0, 100);
        out.push("Your report on Yip has nothing to stand on yet — no charts, no footage. It's sent back.");
      }
    }
    if (!careDone() && c.chan.alive) { acc -= 15; out.push('You filed paperwork while Mr. Chan still lay in a wet bed.'); }
    if (c.chanDied) { acc -= 20; out.push('Mr. Chan did not survive the morning. The investigation will follow the home for months.'); }
    if (c.conductPenalty) out.push(`Your own misconduct undermined the investigation (accuracy −${c.conductPenalty}).`);
    acc = clamp(acc - c.conductPenalty, 0, 100);
    c.result = { option, acc };
    c.decidedKey = shiftKey();
    c.stage = 'decided';
    s.stats.caseLine = esc(out[0]);
    ui.dialogue('Outcome — Bed 4-2', out.map((x) => `<p>${esc(x)}</p>`).join('') + `<p><b>Investigation accuracy: ${acc}/100</b></p>`, [{ label: 'Close', cls: 'primary', fn: () => ui.closePanel() }]);
  }

  // ---------- case file / objective / score ----------
  function caseFile() {
    ensureRefs();
    if (!at('discovered')) {
      ui.dialogue('Case file', 'No open cases.<br><small>Trust what you see over what is written.</small>', [{ label: 'Close', fn: () => ui.closePanel() }]);
      return;
    }
    const ch = c.chan;
    const chk = (v, t) => `<li class="${v ? 'done' : ''}">${v ? '☑' : '☐'} ${t}</li>`;
    ui.dialogue('Case file — Bed 4-2', `
      <p><b>Mr. Chan Kwok-wing</b> — ${ch.alive ? `wellbeing <span class="bar"><i style="width:${clamp(ch.wellbeing, 0, 100)}%"></i></span>` : '<b>deceased</b>'}</p>
      <ul class="checks">
        ${chk(c.care.released, 'Release restraints & check circulation')}
        ${chk(c.care.bag, 'Empty catheter bag')}
        ${chk(c.care.washed, 'Wash & change bedding (needs clean linen from the Bathroom)')}
      </ul>
      <p><b>Leads</b></p>
      <ul class="checks">
        ${chk(c.evidence.denial, 'Confront Nurse Ko')}
        ${chk(c.evidence.records, 'Charts at the nurse station')}
        ${chk(c.evidence.witness, 'Mr. Lee, Bed 4-5 (watches what you do)')}
        ${chk(c.evidence.colleague, 'A colleague, in private (needs trust)')}
        ${chk(c.evidence.cctv, "CCTV at the Ward Manager's desk")}
      </ul>
      <p><b>Evidence</b></p><ul class="evi">${evidenceList()}</ul>
      ${c.result ? `<p><b>Decision:</b> ${esc(c.result.option)} · accuracy ${c.result.acc}/100</p>` : ''}`, [
      ...(ch.alive && !at('decided') ? [{ label: 'Set waypoint: Bed 4-2', fn: () => { s.waypoint = { x: ch.bed.x, z: ch.bed.z, label: 'Bed 4-2' }; ui.closePanel(); } }] : []),
      ...(s.onShift.includes(ko()) && !at('confronted') ? [{ label: 'Set waypoint: Nurse Ko', fn: () => { s.waypoint = { ref: ko(), x: 0, z: 0, label: 'Nurse Ko' }; ui.closePanel(); } }] : []),
      { label: 'Close', fn: () => ui.closePanel() },
    ]);
  }

  function objective() {
    if (!c.chan) return null;
    const care = careDone() ? '' : ` Mr. Chan needs care (${careCount()}/3).`;
    switch (c.stage) {
      case 'handover': return 'Read the handover from the night shift.';
      case 'rounds': return 'Do your first round. Compare what you see with the handover.';
      case 'discovered': return `${care.trim()} Confront Nurse Ko about the handover.`.trim();
      case 'confronted': {
        const left = [['records', 'charts'], ['witness', 'Mr. Lee'], ['colleague', 'colleague'], ['cctv', 'CCTV']].filter(([k]) => !c.evidence[k]).map(([, t]) => t);
        return `${care.trim()} Leads: ${left.join(', ') || 'all gathered'} — then file a decision at the Ward Manager's desk.`.trim();
      }
      default: return null;
    }
  }

  function shiftScore() {
    if (c.decidedKey === shiftKey()) return c.result.acc;
    if (at('discovered') && !at('decided')) s.stats.caseLine = 'Bed 4-2 is still unresolved. It carries over to your next shift.';
    return null;
  }

  function frame() {
    if (c.props && c.chan) {
      const vis = c.chan.mesh.visible;
      c.props.visible = vis && !c.care.released;
      c.bag.visible = vis && !c.care.bag;
    }
  }

  function onPlayerHarm(r) {
    ensureRefs();
    if (r !== c.chan && r !== c.lee) return;
    c.conductPenalty += 10;
    if (c.result) c.result.acc = clamp(c.result.acc - 10, 0, 100);
    s.stats.log.push('Harming a case resident undermined your investigation: accuracy −10.');
  }

  return { residents, handover, minute, onDeath, emergency, residentAction, nurseTalk, records, office, caseFile, objective, shiftScore, frame, onPlayerHarm };
}
