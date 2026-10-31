// Keyboard + mouse for desktop, virtual stick + drag-to-look for touch.
// On-screen buttons are wired in ui.js and call the same handlers.

export function createInput(canvas, stickEl, knobEl) {
  const keys = new Set();
  const state = {
    moveX: 0, moveZ: 0, fast: false,
    yawDelta: 0, pitchDelta: 0, zoomDelta: 0,
    onInteractDown: null, onInteractUp: null, onKey: null,
    touch: matchMedia('(pointer: coarse)').matches,
  };

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (k === 'e' && !keys.has('e')) state.onInteractDown?.();
    keys.add(k);
    state.onKey?.(k, e);
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === 'e') state.onInteractUp?.();
  });
  addEventListener('blur', () => keys.clear());

  // Mouse drag / touch drag on the canvas rotates the camera
  const drags = new Map();
  let stickId = null;
  const STICK_R = 56;

  // Fixed joystick (bottom-left), shown on touch devices or narrow screens.
  const showStick = () => matchMedia('(pointer: coarse)').matches || innerWidth < 900;
  const syncStick = () => {
    state.stickVisible = showStick();
    document.body.classList.toggle('has-stick', state.stickVisible);
  };
  syncStick();
  addEventListener('resize', syncStick);

  const stickCenter = () => {
    const r = stickEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const moveStick = (e) => {
    const c = stickCenter();
    let dx = e.clientX - c.x, dy = e.clientY - c.y;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    knobEl.style.transform = `translate(${dx}px,${dy}px)`;
    state.stickX = dx / STICK_R;
    state.stickY = dy / STICK_R;
  };
  const releaseStick = () => {
    stickId = null;
    state.stickX = state.stickY = 0;
    knobEl.style.transform = 'translate(0px,0px)';
    stickEl.classList.remove('active');
  };
  stickEl.addEventListener('pointerdown', (e) => {
    if (stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    stickEl.classList.add('active');
    stickEl.setPointerCapture(e.pointerId);
    moveStick(e);
  });
  stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  const stickEnd = (e) => { if (e.pointerId === stickId) releaseStick(); };
  stickEl.addEventListener('pointerup', stickEnd);
  stickEl.addEventListener('pointercancel', stickEnd);
  stickEl.addEventListener('lostpointercapture', stickEnd);

  // Touches that start on the lower-left canvas area also drive the stick (forgiving thumb zone).
  canvas.addEventListener('pointerdown', (e) => {
    const thumbZone = state.stickVisible && e.pointerType === 'touch' && e.clientX < innerWidth * 0.4 && e.clientY > innerHeight * 0.55;
    if (thumbZone && stickId === null) {
      stickId = e.pointerId;
      stickEl.classList.add('active');
      moveStick(e);
    } else {
      drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) { moveStick(e); return; }
    const p = drags.get(e.pointerId);
    if (!p) return;
    state.yawDelta -= (e.clientX - p.x) * 0.006;
    state.pitchDelta += (e.clientY - p.y) * 0.004;
    p.x = e.clientX; p.y = e.clientY;
  });
  const end = (e) => {
    if (e.pointerId === stickId) releaseStick();
    drags.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  addEventListener('blur', () => { releaseStick(); drags.clear(); state.onInteractUp?.(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    keys.clear(); releaseStick(); drags.clear(); state.onInteractUp?.();
  });
  canvas.addEventListener('wheel', (e) => { state.zoomDelta += Math.sign(e.deltaY) * 0.8; e.preventDefault(); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  state.update = () => {
    let x = 0, z = 0;
    if (keys.has('w') || keys.has('arrowup')) z -= 1;
    if (keys.has('s') || keys.has('arrowdown')) z += 1;
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    if (state.stickX || state.stickY) { x = state.stickX; z = state.stickY; }
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    state.moveX = x; state.moveZ = z;
    state.fast = keys.has('shift') || Math.hypot(state.stickX || 0, state.stickY || 0) > 0.92;
  };
  state.isHeld = (k) => keys.has(k);
  return state;
}
