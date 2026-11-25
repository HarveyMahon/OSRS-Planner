// Special attacks: how much faster a kill goes with a spec weapon switch.
//
// Two kinds of plan, from the special attack numbers on the OSRS Wiki:
//  * Defence drains (Dragon warhammer, Elder maul, Bandos godsword, Arclight, Emberlight): spend the
//    starting 100% energy at the start of the fight, then kill with the main setup at the lowered Defence.
//  * Damage specs (claws, godswords, Voidwaker, blowpipe, Zaryte crossbow, fang, daggers, halberds): spend the
//    energy as it comes (100% at the start, then 10% every 30 seconds, twice as fast with a Lightbearer).
// Each spec takes the place of a normal attack for the spec weapon's attack time.

import { calc, bestCalc, attackStyles, styleKind, TICK, THRALL_DPS } from './dps.js';

// cost: energy %; type: the attack type used; acc / dmg: multipliers (dmg applied in order, each rounded down)
export const SPECS = {
  'Dragon warhammer': { cost: 50, type: 'crush', dmg: [1.5], drain: { pct: 0.30 } },
  'Elder maul': { cost: 50, type: 'crush', acc: 1.25, drain: { pct: 0.35 } },
  'Bandos godsword': { cost: 50, type: 'slash', acc: 2, dmg: [1.1, 1.1], drain: { damage: true } },
  'Arclight': { cost: 50, type: 'stab', drain: { base: 0.05, demon: 0.10 } },
  'Emberlight': { cost: 50, type: 'stab', drain: { base: 0.05, demon: 0.10 } },
  'Dragon claws': { cost: 50, type: 'slash', claws: true },
  'Armadyl godsword': { cost: 50, type: 'slash', acc: 2, dmg: [1.1, 1.25] },
  'Voidwaker': { cost: 50, type: 'slash', voidwaker: true },
  'Toxic blowpipe': { cost: 50, type: 'ranged', acc: 2, dmg: [1.5] },
  'Blazing blowpipe': { cost: 50, type: 'ranged', acc: 2, dmg: [1.5] },
  'Zaryte crossbow': { cost: 75, type: 'ranged', acc: 2, bolt: true },
  "Osmumten's fang": { cost: 25, type: 'stab', acc: 1.5, fang: true },
  'Dragon dagger': { cost: 25, type: 'slash', acc: 1.15, dmg: [1.15], hits: 2 },
  'Abyssal dagger': { cost: 25, type: 'slash', acc: 1.25, dmg: [0.85], hits: 2, second: 'onHit' },
  'Crystal halberd': { cost: 30, type: 'slash', dmg: [1.1], hits: 2, large: true },
  'Dragon halberd': { cost: 30, type: 'slash', dmg: [1.1], hits: 2, large: true },
};
const canonName = n => String(n || '').replace(/\s*\((or|l|cr|p\+\+|p\+|p|kp)\)$/i, '');
export const specOf = w => w ? SPECS[canonName(w.name)] || null : null;

const REGEN_PER_SEC = 10 / 30;

/** Expected damage of one special attack (and the time it takes), or null if it can't be used. */
function specHit(player, lo, monster, sp, opts) {
  const w = lo.weapon;
  const kindOf = sp.type === 'ranged' ? 'ranged' : sp.type === 'magic' ? 'magic' : 'melee';
  const styles = attackStyles(w).filter(s => styleKind(s.type) === kindOf);
  if (!styles.length) return null;
  const style = kindOf === 'melee' ? { name: 'Special attack', type: sp.type, stance: styles.find(s => s.stance === 'aggressive') ? 'aggressive' : styles[0].stance }
    : styles.find(s => s.stance === 'rapid') || styles[0];
  const r = calc(player, lo, monster, style, null, { ...opts, spec: { acc: sp.acc, dmg: sp.dmg, fang: sp.fang, voidwaker: sp.voidwaker } });
  if (!r.maxHit && !sp.bolt) return null;
  const p = r.accuracy, M = r.maxHit;
  let dmg;
  if (sp.claws) {          // the four hits depend on which roll lands first (Wiki: 4-2-1-1, 0-4-2-2, 0-0-3-3, 0-0-0-5)
    const q = 1 - p;
    dmg = p * 1.5 * M + q * p * 1.25 * M + q * q * p * M + q ** 3 * p * 0.75 * M + q ** 4 * 4 / 3;
  } else if (sp.bolt) {    // Zaryte crossbow: a hit always triggers the bolt effect
    const a = lo.ammo?.name || '';
    if (/^Ruby/.test(a)) dmg = p * Math.min(110, Math.trunc(monster.hp / 2 * 22 / 100));
    else if (/^Diamond/.test(a)) dmg = p * (Math.trunc(M * 126 / 100) / 2);
    else if (/^Onyx/.test(a)) dmg = p * (Math.trunc(M * 132 / 100) / 2);
    else dmg = r.perAttack;
  } else if (sp.hits === 2) {
    if (sp.large && monster.size < 2) dmg = r.perAttack;
    else if (sp.second === 'onHit') dmg = r.perAttack + p * r.perAttack;
    else dmg = 2 * r.perAttack;
  } else dmg = r.perAttack;
  return { dmg, p, maxHit: M, secs: r.speed * TICK, avgOnHit: p ? r.perAttack / p : 0 };
}

/**
 * Seconds to kill a monster with the main loadout and a spec weapon (specLo = the loadout with it in hand).
 * Returns { seconds, specs, plan: 'drain'|'damage', defence } or null when the spec doesn't help.
 */
export function withSpec(player, mainLo, specLo, monster, opts = {}) {
  const sp = specOf(specLo.weapon);
  if (!sp) return null;
  const thrall = player.thrall ? THRALL_DPS : 0;
  const mainDps = m => { const r = bestCalc(player, mainLo, m, opts); return r.dps + thrall; };
  const base = mainDps(monster);
  if (base <= 0) return null;
  const plain = monster.hp / base;
  const light = /^Lightbearer/.test(mainLo.ring?.name || '') ? 2 : 1;

  if (sp.drain) {
    let m = { ...monster }, done = 0, t = 0;
    const n = Math.floor(100 / sp.cost);
    for (let i = 0; i < n; i++) {
      const h = specHit(player, specLo, m, sp, opts);
      if (!h) return null;
      let cut = 0;
      if (sp.drain.pct) cut = m.def * sp.drain.pct;
      else if (sp.drain.damage) cut = h.avgOnHit;
      else if (sp.drain.base) cut = monster.def * (m.attributes.includes('demon') ? sp.drain.demon : sp.drain.base);
      m = { ...m, def: Math.max(0, m.def - h.p * cut) };
      done += h.dmg; t += h.secs;
    }
    const d = mainDps(m);
    const secs = t + Math.max(0, monster.hp - done - thrall * t) / d;
    return secs < plain ? { seconds: secs, specs: n, plan: 'drain', defence: Math.round(m.def) } : null;
  }

  const h = specHit(player, specLo, monster, sp, opts);
  if (!h || h.dmg <= base * h.secs) return null;    // no better than a normal attack
  let T = plain, n = 0;
  for (let i = 0; i < 6; i++) {
    n = Math.floor((100 + T * REGEN_PER_SEC * light) / sp.cost);
    n = Math.min(n, Math.ceil(monster.hp / Math.max(h.dmg, 1)));
    T = n * h.secs + Math.max(0, monster.hp - n * h.dmg - thrall * n * h.secs) / base;
  }
  return T < plain ? { seconds: T, specs: n, plan: 'damage' } : null;
}
