import { ROOMS } from './data.js';
import { translate, localize, onLangChange, lang, t, bindLanguageButtons, CJK_FONT } from './i18n.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export { esc };
const messageText = (message) => {
  if (!message || typeof message !== 'object') return translate(message ?? '');
  const vars = Object.fromEntries(Object.entries(message.vars ?? {}).map(([key, value]) => [key, typeof value === 'string' ? translate(value) : value]));
  return t(message.key, vars);
};

export function fmtTime(abs) {
  const m = ((Math.floor(abs) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const ROOM_FILL = {
  bedroom: '#8c8170', single: '#7b6a5e', living: '#6f6a5e', hall: '#5c6466', staff: '#56695f',
  care: '#6a7d80', therapy: '#6a6d55', outdoor: '#2f4a2a', blocked: '#222226',
};

export function createUI() {
  const ui = {
    panelOpen: false,
    mapExpanded: false,
    onInteractDown: null,
    onInteractUp: null,
    onBannerTap: null,
    onCaseFile: null,
    onPause: null,
    onResident: null,
  };
  const clock = $('#clock'), shiftEl = $('#shift'), staffEl = $('#staff'), repEl = $('#rep'), residentsEl = $('#residents');
  const objective = $('#objective'), banners = $('#banners');
  const interact = $('#btn-interact'), interactLabel = $('#interact-label');
  const hold = $('#hold'), holdBar = $('#hold-bar'), holdLabel = $('#hold-label');
  const panel = $('#panel'), panelBody = $('#panel-body');
  const toastEl = $('#toast');
  const mini = $('#minimap');
  const bigMap = $('#bigmap'), bigCanvas = $('#bigmap-canvas'), bigList = $('#bigmap-list');
  let lastHud = null, lastResidentCount = null, lastObjective = '', lastInteract = '', lastHold = [null];
  let lastRows = [], lastBells = null, lastMapState = null;

  interact.addEventListener('pointerdown', (e) => { e.preventDefault(); ui.onInteractDown?.(); });
  interact.addEventListener('pointerup', () => ui.onInteractUp?.());
  interact.addEventListener('pointerleave', () => ui.onInteractUp?.());
  $('#btn-case').addEventListener('click', () => ui.onCaseFile?.());
  $('#btn-pause').addEventListener('click', () => ui.onPause?.());
  $('#btn-resident').addEventListener('click', () => ui.onResident?.());
  ui.setResidentAvailable = (visible) => { $('#btn-resident').hidden = !visible; };
  mini.addEventListener('click', () => ui.toggleMap());
  $('#bigmap-close').addEventListener('click', () => ui.toggleMap(false));
  $('#panel-close').addEventListener('click', () => ui.closePanel());

  ui.setHud = ({ time, shift, staff, rep, susp }) => {
    lastHud = { time, shift, staff, rep, susp };
    clock.textContent = time;
    shiftEl.textContent = messageText(shift);
    staffEl.textContent = messageText(staff);
    repEl.textContent = t('hud.reputation', { rep: Math.round(rep), susp: Math.round(susp) });
  };
  ui.setResidents = (count) => {
    lastResidentCount = count;
    residentsEl.textContent = t('hud.residents', { count });
  };
  ui.setObjective = (text) => { lastObjective = text; const rendered = translate(text); if (objective.textContent !== rendered) objective.textContent = rendered; };
  const taskRows = $('#task-rows'), taskCount = $('#task-count');
  let lastTasks = '';
  taskRows.addEventListener('click', (e) => {
    const row = e.target.closest('[data-round]');
    if (row) ui.onTaskTap?.(row.dataset.round);
  });
  ui.renderTasks = (rows) => {
    lastRows = rows;
    const key = lang + JSON.stringify(rows);
    if (key === lastTasks) return;
    lastTasks = key;
    taskCount.textContent = rows.length;
    taskRows.innerHTML = rows.map((row) => `<button data-round="${esc(row.id)}"><b>${esc(row.label)}</b><span>${row.done}/${row.total}${row.unsafe ? ' · ' + row.unsafe + ' unsafe' : ''}</span><small>${esc(row.due)}</small></button>`).join('') || '<small>No active rounds. Your allocation: Single Rooms.</small>';
    localize(taskRows);
  };

  // Boxes are kept and patched in place so nothing re-animates every game minute.
  // A box blinks a few times only when it first appears or turns urgent.
  const compactQuery = matchMedia('(max-width: 700px)');
  const bannerEls = new Map(); // bell id -> { el, urgent }
  let moreEl = null;
  const blink = (el) => {
    el.classList.remove('blink');
    void el.offsetWidth; // restart the animation
    el.classList.add('blink');
  };
  banners.addEventListener('animationend', (e) => { if (e.animationName === 'bell-blink') e.target.classList.remove('blink'); });
  banners.addEventListener('click', (e) => {
    const el = e.target.closest('.banner');
    if (el) ui.onBannerTap?.(Number(el.dataset.id));
  });
  ui.renderBanners = (bells, now) => {
    lastBells = [bells, now];
    const limit = compactQuery.matches ? 2 : 3;
    const sorted = [...bells].sort((a, b) => (b.urgent - a.urgent) || (a.start - b.start)).slice(0, limit);
    const keep = new Set(sorted.map((b) => b.id));
    for (const [id, rec] of bannerEls) if (!keep.has(id)) { rec.el.remove(); bannerEls.delete(id); }
    sorted.forEach((b, i) => {
      let rec = bannerEls.get(b.id);
      const fresh = !rec;
      if (fresh) {
        const el = document.createElement('button');
        el.className = 'banner';
        el.dataset.id = b.id;
        el.innerHTML = '<span class="b-tag"></span><span class="b-main"></span><span class="b-sub"></span><span class="b-age"></span>';
        rec = { el, urgent: null, main: '', sub: '', age: '' };
        bannerEls.set(b.id, rec);
      }
      const { el } = rec;
      if (banners.children[i] !== el) banners.insertBefore(el, banners.children[i] ?? null);
      const mins = Math.floor(now - b.start);
      const main = translate(`${b.res.name}${b.res.bed?.id ? ' · Bed ' + b.res.bed.id : ''}`);
      const sub = translate(`${b.need} · ${mins} min${b.nurse ? ' · staff going' : ''}`);
      const age = t('bell.age', { count: mins }) + (b.nurse ? translate(' · staff') : '');
      el.children[0].textContent = translate(b.urgent ? 'URGENT' : 'Call bell');
      if (rec.urgent !== b.urgent) {
        el.classList.toggle('urgent', b.urgent);
        if (fresh || b.urgent) blink(el);
        rec.urgent = b.urgent;
      }
      if (rec.main !== main) el.children[1].textContent = rec.main = main;
      if (rec.sub !== sub) el.children[2].textContent = rec.sub = sub;
      if (rec.age !== age) el.children[3].textContent = rec.age = age;
    });
    const extra = bells.length - sorted.length;
    if (extra > 0) {
      if (!moreEl) { moreEl = document.createElement('div'); moreEl.className = 'banner-more'; }
      const text = t('bell.more', { count: extra });
      if (moreEl.textContent !== text) moreEl.textContent = text;
      if (banners.lastElementChild !== moreEl) banners.appendChild(moreEl);
    } else moreEl?.remove();
  };

  ui.setInteract = (label) => {
    lastInteract = label;
    interact.classList.toggle('disabled', !label);
    interactLabel.textContent = translate(label || '');
  };
  ui.setHold = (p, label) => {
    lastHold = [p, label];
    hold.classList.toggle('show', p !== null);
    if (p !== null) { holdBar.style.width = `${Math.round(p * 100)}%`; holdLabel.textContent = translate(label); }
  };

  let toastTimer = 0;
  let toastMessage = null;
  const renderToast = () => {
    if (toastMessage && typeof toastMessage === 'object') {
      toastEl.textContent = messageText(toastMessage);
    } else {
      toastEl.textContent = toastMessage ?? '';
      localize(toastEl);
    }
  };
  ui.toast = (msg, ms = 3200) => {
    toastMessage = msg;
    renderToast();
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  };

  let onCloseCb = null;
  let canClose = true;
  let refreshDialogue = null;
  let terminalPanel = false;
  ui.openPanel = (html, { onClose = null, cls = '', closable = true, terminal = false } = {}) => {
    if (terminalPanel) return null;
    terminalPanel = terminal;
    refreshDialogue = null;
    canClose = closable;
    panelBody.innerHTML = html;
    localize(panelBody);
    bindLanguageButtons(panelBody);
    panel.className = 'show ' + cls;
    $('#panel-close').style.display = closable ? '' : 'none';
    ui.panelOpen = true;
    onCloseCb = onClose;
    panelBody.scrollTop = 0;
    return panelBody;
  };
  ui.closePanel = (force = false) => {
    if (terminalPanel || !ui.panelOpen || (!canClose && !force)) return;
    panel.className = '';
    ui.panelOpen = false;
    refreshDialogue = null;
    const cb = onCloseCb;
    onCloseCb = null;
    cb?.();
  };
  // Dialogue: options = [{label, fn, cls}]
  ui.dialogue = (speaker, text, options = [], extra = '', panelOpts = {}) => {
    const content = typeof text === 'function' ? text() : text;
    const body = ui.openPanel(`
      <div class="dlg">
        <div class="dlg-speaker">${esc(speaker)}</div>
        <div class="dlg-text">${content}</div>
        ${extra}
        <div class="dlg-opts">${options.map((o, i) => `<button class="opt ${o.cls || ''}" data-i="${i}" ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</button>`).join('')}</div>
      </div>`, { cls: 'dialogue', ...panelOpts });
    if (!body) return;
    if (typeof text === 'function') refreshDialogue = () => {
      const element = body.querySelector('.dlg-text');
      element.innerHTML = text();
      localize(element);
    };
    body.querySelectorAll('.dlg-opts .opt[data-i]').forEach((b) => b.addEventListener('click', () => {
      if (terminalPanel && !panelOpts.terminal) return;
      options[Number(b.dataset.i)].fn();
    }));
  };
  ui.bind = (sel, fn) => {
    if (!terminalPanel) panelBody.querySelectorAll(sel).forEach((el) => el.addEventListener('click', () => {
      if (!terminalPanel) fn(el);
    }));
  };

  ui.toggleMap = (force) => {
    ui.mapExpanded = force ?? !ui.mapExpanded;
    bigMap.classList.toggle('show', ui.mapExpanded);
  };

  // ---------- map drawing ----------
  function drawMap(canvas, s, expanded) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const W = 46, H = 70;
    const sc = Math.min(cw / W, ch / H);
    const ox = (cw - W * sc) / 2, oy = (ch - H * sc) / 2;
    const P = (x, z) => [ox + (x + 1) * sc, oy + (z + 1) * sc];
    const pulse = 0.6;
    const bellRooms = new Map();
    for (const b of s.bells) bellRooms.set(b.res.roomId, Math.max(bellRooms.get(b.res.roomId) || 0, b.urgent ? 2 : 1));

    for (const r of ROOMS) {
      const [x, y] = P(r.x, r.z);
      g.fillStyle = ROOM_FILL[r.type] || '#555';
      g.fillRect(x, y, r.w * sc, r.d * sc);
      const bell = bellRooms.get(r.id);
      if (bell) {
        g.fillStyle = bell === 2 ? `rgba(230,40,40,${0.35 + 0.45 * pulse})` : `rgba(240,170,40,${0.25 + 0.35 * pulse})`;
        g.fillRect(x, y, r.w * sc, r.d * sc);
      }
      g.strokeStyle = 'rgba(0,0,0,.6)';
      g.lineWidth = 1;
      g.strokeRect(x, y, r.w * sc, r.d * sc);
      if (expanded && r.name) {
        g.fillStyle = 'rgba(255,255,255,.75)';
        g.font = `${Math.max(9, sc * 0.9)}px ${CJK_FONT}`;
        g.textAlign = 'center';
        g.fillText(translate(r.name.replace(' (out of service)', '').replace(' (locked)', '')), x + (r.w * sc) / 2, y + (r.d * sc) / 2 + 4, Math.max(1, r.w * sc - 4));
      }
    }
    // residents at last known location
    for (const r of s.residents) {
      if (!r.alive || !r.lastSeen) continue;
      const age = s.now - r.lastSeen.t;
      const a = Math.max(0.25, 1 - age / 120);
      const [x, y] = P(r.lastSeen.x, r.lastSeen.z);
      g.fillStyle = r.case ? `rgba(255,120,120,${a})` : `rgba(235,225,200,${a})`;
      g.beginPath(); g.arc(x, y, expanded ? 3 : 1.8, 0, Math.PI * 2); g.fill();
    }
    for (const n of s.nurses) {
      if (!n.visible) continue;
      const [x, y] = P(n.pos.x, n.pos.z);
      g.fillStyle = '#58c7e6';
      g.beginPath(); g.arc(x, y, expanded ? 3.5 : 2.2, 0, Math.PI * 2); g.fill();
    }
    if (s.waypoint) {
      const [x, y] = P(s.waypoint.x, s.waypoint.z);
      const [px, py] = P(s.player.x, s.player.z);
      g.strokeStyle = 'rgba(255,215,90,.8)';
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
      g.setLineDash([]);
      g.strokeStyle = '#ffd75a';
      g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 4 + pulse * 3, 0, Math.PI * 2); g.stroke();
    }
    const [px, py] = P(s.player.x, s.player.z);
    g.save();
    g.translate(px, py);
    g.rotate(-s.player.heading);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, 6); g.lineTo(4, -4); g.lineTo(-4, -4); g.closePath(); g.fill();
    g.restore();
  }

  let listTimer = 0;
  ui.drawMaps = (s) => {
    lastMapState = s;
    drawMap(mini, s, false);
    if (ui.mapExpanded) {
      drawMap(bigCanvas, s, true);
      if (performance.now() - listTimer > 1000) {
        listTimer = performance.now();
        const rows = s.residents.filter((r) => r.alive).sort((a, b) => (a.lastSeen?.t ?? -1e9) - (b.lastSeen?.t ?? -1e9));
        bigList.innerHTML = '<h4>Last known locations</h4>' + rows.map((r) => {
          const ls = r.lastSeen;
          const where = ls ? (ls.roomName || '—') : 'Not seen this shift';
          const when = ls ? `${fmtTime(ls.t)} (${Math.floor(s.now - ls.t)} min ago)` : '';
          return `<div class="ll ${r.case ? 'story' : ''}"><b>${esc(r.name)}</b><span>${esc(where)} ${when}</span></div>`;
        }).join('');
        localize(bigList);
      }
    }
  };

  onLangChange(() => {
    lastTasks = ''; listTimer = 0;
    if (lastHud) ui.setHud(lastHud);
    if (lastResidentCount !== null) ui.setResidents(lastResidentCount);
    ui.setObjective(lastObjective);
    ui.setInteract(lastInteract);
    ui.setHold(...lastHold);
    ui.renderTasks(lastRows);
    if (lastBells) ui.renderBanners(...lastBells);
    if (lastMapState) ui.drawMaps(lastMapState);
    renderToast();
    refreshDialogue?.();
  });
  return ui;
}
