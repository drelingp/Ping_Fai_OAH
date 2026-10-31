import * as THREE from 'three';

// Subtle drifting odour wisps and a steady hygiene icon over residents left soiled.
// Sprites are pooled; nothing flashes.

export const dirty = (r) => !!(r.hygiene && (r.hygiene.body || r.hygiene.bedding || r.hygiene.bag));

export function hygieneText(r) {
  const h = r.hygiene;
  if (!h) return '';
  return [h.body && 'Soiled — needs washing', h.bedding && 'Wet / soiled bedding', h.bag && 'Catheter bag full'].filter(Boolean).join(' · ');
}

function wispTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 5; i++) {
    const x = 20 + Math.random() * 24, y = 20 + Math.random() * 24, r = 14 + Math.random() * 12;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function iconTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(28,30,18,0.82)';
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#b9c76a';
  g.stroke();
  g.lineCap = 'round';
  g.lineWidth = 9;
  for (const x of [40, 64, 88]) {
    g.beginPath();
    for (let y = 98; y >= 30; y -= 2) {
      const px = x + Math.sin((y / 68) * Math.PI * 2.2) * 7;
      if (y === 98) g.moveTo(px, y); else g.lineTo(px, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createOdour(scene, { max = 56, icons = 10 } = {}) {
  const tex = wispTexture();
  const iconTex = iconTexture();
  const wisps = [];
  for (let i = 0; i < max; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, color: 0x8f9a3c, transparent: true, opacity: 0, depthWrite: false, fog: true });
    const sp = new THREE.Sprite(m);
    sp.visible = false;
    sp.renderOrder = 5;
    scene.add(sp);
    wisps.push({ sp, life: 0, age: 0, vx: 0, vz: 0, phase: 0 });
  }
  const iconMat = new THREE.SpriteMaterial({ map: iconTex, transparent: true, depthWrite: false, opacity: 0.92 });
  const iconPool = [];
  for (let i = 0; i < icons; i++) {
    const sp = new THREE.Sprite(iconMat);
    sp.scale.setScalar(0.32);
    sp.visible = false;
    sp.renderOrder = 6;
    scene.add(sp);
    iconPool.push(sp);
  }
  const emitAcc = new Map();

  function anchor(r) {
    if (r.mode === 'bed' && r.bed) return { x: r.bed.x, y: 0.85, z: r.bed.z, top: 1.55 };
    if (r.mode === 'seat') return { x: r.pos.x, y: 0.75, z: r.pos.z, top: 1.72 };
    return { x: r.pos.x, y: 0.95, z: r.pos.z, top: 2.02 };
  }

  function spawn(a) {
    const w = wisps.find((x) => x.life <= 0);
    if (!w) return;
    w.life = 2.6 + Math.random() * 1.6;
    w.age = 0;
    w.vx = (Math.random() - 0.5) * 0.12;
    w.vz = (Math.random() - 0.5) * 0.12;
    w.phase = Math.random() * 6.28;
    w.sp.position.set(a.x + (Math.random() - 0.5) * 0.7, a.y + Math.random() * 0.15, a.z + (Math.random() - 0.5) * 0.9);
    w.sp.visible = true;
  }

  function update(dt, residents, player) {
    const sources = residents
      .filter((r) => r.alive && r.mesh?.visible && dirty(r))
      .map((r) => ({ r, d: Math.hypot(r.pos.x - player.x, r.pos.z - player.z) }))
      .filter((x) => x.d < 16)
      .sort((a, b) => a.d - b.d)
      .slice(0, icons);
    iconPool.forEach((sp, i) => {
      const src = sources[i];
      sp.visible = !!src;
      if (src) {
        const a = anchor(src.r);
        sp.position.set(a.x, a.top, a.z);
      }
    });
    for (const { r } of sources) {
      const strength = Number(!!r.hygiene.body) + Number(!!r.hygiene.bedding) + Number(!!r.hygiene.bag);
      const acc = (emitAcc.get(r) ?? Math.random()) + dt * (0.8 + strength * 0.45);
      let n = Math.floor(acc);
      emitAcc.set(r, acc - n);
      const a = anchor(r);
      while (n-- > 0) spawn(a);
    }
    for (const r of emitAcc.keys()) if (!sources.some((x) => x.r === r)) emitAcc.delete(r);
    for (const w of wisps) {
      if (w.life <= 0) continue;
      w.age += dt;
      if (w.age >= w.life) { w.life = 0; w.sp.visible = false; w.sp.material.opacity = 0; continue; }
      const k = w.age / w.life;
      const p = w.sp.position;
      p.x += (w.vx + Math.sin(w.phase + w.age * 1.7) * 0.06) * dt;
      p.z += (w.vz + Math.cos(w.phase + w.age * 1.3) * 0.06) * dt;
      p.y += 0.22 * dt;
      w.sp.scale.setScalar(0.28 + k * 0.7);
      // fade in and out smoothly
      w.sp.material.opacity = 0.42 * Math.sin(Math.PI * k);
    }
  }

  return { update };
}
