import { ROOMS } from './data.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export { esc };

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
  const clock = $('#clock'), shiftEl = $('#shift'), staffEl = $('#staff'), repEl = $('#rep');
  const objective = $('#objective'), banners = $('#banners');
  const interact = $('#btn-interact'), interactLabel = $('#interact-label');
  const hold = $('#hold'), holdBar = $('#hold-bar'), holdLabel = $('#hold-label');
  const panel = $('#panel'), panelBody = $('#panel-body');
  const toastEl = $('#toast');
  const mini = $('#minimap');
  const bigMap = $('#bigmap'), bigCanvas = $('#bigmap-canvas'), bigList = $('#bigmap-list');

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
    clock.textContent = time;
    shiftEl.textContent = shift;
    staffEl.textContent = staff;
    repEl.textContent = `Reputation ${Math.round(rep)} · Staff suspicion ${Math.round(susp)}`;
  };
  ui.setObjective = (t) => { if (objective.textContent !== t) objective.textContent = t; };

  ui.renderBanners = (bells, now) => {
    const sorted = [...bells].sort((a, b) => (b.urgent - a.urgent) || (a.start - b.start)).slice(0, 3);
    const key = sorted.map((b) => `${b.id}:${b.urgent}:${Math.floor((now - b.start) / 1)}:${b.nurse ? 1 : 0}`).join('|') + bells.length;
    if (banners.dataset.key === key) return;
    banners.dataset.key = key;
    banners.innerHTML = sorted.map((b) => `
      <button class="banner ${b.urgent ? 'urgent' : ''}" data-id="${b.id}">
        <span class="b-tag">${b.urgent ? 'URGENT' : 'Call bell'}</span>
        <span class="b-main">${esc(b.res.name)} · ${esc(b.res.bed?.id ? 'Bed ' + b.res.bed.id : '')}</span>
        <span class="b-sub">${esc(b.need)} · ${Math.floor(now - b.start)} min${b.nurse ? ' · staff going' : ''}</span>
      </button>`).join('') + (bells.length > 3 ? `<div class="banner-more">+${bells.length - 3} more call bells</div>` : '');
    banners.querySelectorAll('.banner').forEach((el) => el.addEventListener('click', () => ui.onBannerTap?.(Number(el.dataset.id))));
  };

  ui.setInteract = (label) => {
    interact.classList.toggle('disabled', !label);
    interactLabel.textContent = label || '';
  };
  ui.setHold = (p, label) => {
    hold.classList.toggle('show', p !== null);
    if (p !== null) { holdBar.style.width = `${Math.round(p * 100)}%`; holdLabel.textContent = label; }
  };

  let toastTimer = 0;
  ui.toast = (msg, ms = 3200) => {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  };

  let onCloseCb = null;
  let canClose = true;
  ui.openPanel = (html, { onClose = null, cls = '', closable = true } = {}) => {
    canClose = closable;
    panelBody.innerHTML = html;
    panel.className = 'show ' + cls;
    $('#panel-close').style.display = closable ? '' : 'none';
    ui.panelOpen = true;
    onCloseCb = onClose;
    panelBody.scrollTop = 0;
    return panelBody;
  };
  ui.closePanel = (force = false) => {
    if (!ui.panelOpen || (!canClose && !force)) return;
    panel.className = '';
    ui.panelOpen = false;
    const cb = onCloseCb;
    onCloseCb = null;
    cb?.();
  };
  // Dialogue: options = [{label, fn, cls}]
  ui.dialogue = (speaker, text, options = [], extra = '', panelOpts = {}) => {
    const body = ui.openPanel(`
      <div class="dlg">
        <div class="dlg-speaker">${esc(speaker)}</div>
        <div class="dlg-text">${text}</div>
        ${extra}
        <div class="dlg-opts">${options.map((o, i) => `<button class="opt ${o.cls || ''}" data-i="${i}" ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</button>`).join('')}</div>
      </div>`, { cls: 'dialogue', ...panelOpts });
    body.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => options[Number(b.dataset.i)].fn()));
  };
  ui.bind = (sel, fn) => panelBody.querySelectorAll(sel).forEach((el) => el.addEventListener('click', () => fn(el)));

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
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
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
        g.font = `${Math.max(9, sc * 0.9)}px system-ui`;
        g.textAlign = 'center';
        g.fillText(r.name.replace(' (out of service)', '').replace(' (locked)', ''), x + (r.w * sc) / 2, y + (r.d * sc) / 2 + 4);
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
      }
    }
  };

  return ui;
}
