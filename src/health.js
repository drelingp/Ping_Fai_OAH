import { fmtTime } from './ui.js';

const protectedResidents = new WeakSet();

// Lethal damage is irreversible even within a batch of minute effects.
export function protectHealth(r) {
  if (protectedResidents.has(r)) return r;
  let hp = Math.max(0, Math.min(100, r.wellbeing));
  Object.defineProperty(r, 'wellbeing', {
    enumerable: true,
    get: () => hp,
    set(value) {
      if (!r.alive || hp <= 0) { hp = 0; return; }
      hp = Math.max(0, Math.min(100, value));
    },
  });
  protectedResidents.add(r);
  return r;
}

export function createDeathResolver({ s, ui, removeResident, onDeath, onGameOver }) {
  function resolve() {
    for (const r of s.residents) {
      protectHealth(r);
      if (!r.alive || r.wellbeing > 0) continue;
      r.wellbeing = 0;
      s.stats.deaths++;
      s.reputation -= 12;
      s.stats.log.push(`${fmtTime(s.now)} — ${r.name} died. It may have been preventable.`);
      ui.toast(`${r.name} has died.`, 5000);
      removeResident(r);
      onDeath(r);
    }
    if (!s.ended && !s.residents.some((r) => r.alive)) onGameOver();
  }
  return { resolve };
}
