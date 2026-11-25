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
  'Emberlight': { cost: 50, type: 'stab', drain: { base: 0.05, demon: 0.15 } },
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
  // added 25 Nov (afternoon)
  'Tonalztics of Ralos': { cost: 50, type: 'ranged', acc: 1.5, tonal: true, drain: { magicEighth: true } },
  'Accursed sceptre': { cost: 50, type: 'magic', acc: 1.5, dmg: [1.5], drain: { pct: 0.15 } },
  'Dark bow': { cost: 55, type: 'ranged', darkbow: true },
  'Eldritch nightmare staff': { cost: 55, type: 'magic', staffMax: 44 },
  'Volatile nightmare staff': { cost: 55, type: 'magic', acc: 1.5, staffMax: 58 },
  'Eye of Ayak': { cost: 50, type: 'magic', acc: 2, dmg: [1.3], speed: 5 },
  "Zorya's tome": { cost: 50, type: 'magic', acc: 2.5, dmg: [1.6] },
  'Webweaver bow': { cost: 50, type: 'ranged', acc: 2, dmg: [0.4], hits: 4 },
  'Burning claws': { cost: 35, type: 'slash', burning: true },
  'Zamorak godsword': { cost: 50, type: 'slash', acc: 2, dmg: [1.1] },
  'Ancient godsword': { cost: 50, type: 'slash', acc: 2, dmg: [1.1], bleed: 25 },
  'Dragon longsword': { cost: 25, type: 'slash', dmg: [1.25] },
  'Dragon mace': { cost: 25, type: 'crush', acc: 1.25, dmg: [1.5] },
  'Dragon sword': { cost: 40, type: 'stab', acc: 1.25, dmg: [1.25] },
  'Dragon scimitar': { cost: 55, type: 'slash', acc: 1.25 },
  'Granite hammer': { cost: 60, type: 'crush', acc: 1.5, flat: 5 },
  'Arkan blade': { cost: 30, type: 'slash', acc: 1.5, dmg: [1.5], burn: 10 },
  'Dragon knife': { cost: 25, type: 'ranged', hits: 2 },
  'Rosewood blowpipe': { cost: 25, type: 'ranged', hits: 2 },
  'Magic shortbow (i)': { cost: 50, type: 'ranged', acc: 10 / 7, hits: 2 },
  'Magic shortbow': { cost: 55, type: 'ranged', acc: 10 / 7, hits: 2 },
  'Heavy ballista': { cost: 65, type: 'ranged', acc: 1.25, dmg: [1.25] },
  'Light ballista': { cost: 65, type: 'ranged', acc: 1.25, dmg: [1.25] },
};
const canonName = n => String(n || '').replace(/\s*\((or|l|cr|p\+\+|p\+|p|kp|a)\)$/i, '');
const SPECS_LC = () => SPECS_LOWER || (SPECS_LOWER = Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k.toLowerCase(), v])));
let SPECS_LOWER = null;
export const specOf = w => w ? SPECS_LC()[canonName(w.name).toLowerCase()] || null : null;

const REGEN_PER_SEC = 10 / 30;

/** Expected damage of one special attack (and the time it takes), or null if it can't be used. */
function specHit(player, lo, monster, sp, opts) {
  const w = lo.weapon;
  const kindOf = sp.type === 'ranged' ? 'ranged' : sp.type === 'magic' ? 'magic' : 'melee';
  const styles = attackStyles(w).filter(s => styleKind(s.type) === kindOf);
  if (!styles.length) return null;
  const style = kindOf === 'melee' ? { name: 'Special attack', type: sp.type, stance: styles.find(s => s.stance === 'aggressive') ? 'aggressive' : styles[0].stance }
    : kindOf === 'magic' ? (styles.find(s => s.stance === 'accurate') || styles[0]) : styles.find(s => s.stance === 'rapid') || styles[0];
  const r = calc(player, lo, monster, style, null, { ...opts, spec: { acc: sp.acc, dmg: sp.dmg, fang: sp.fang, voidwaker: sp.voidwaker, staffMax: sp.staffMax } });
  if (!r.maxHit && !sp.bolt) return null;
  const p = r.accuracy, M = r.maxHit;
  let dmg;
  const secs = (sp.speed || r.speed) * TICK;
  if (sp.claws) {          // the four hits depend on which roll lands first (Wiki: 4-2-1-1, 0-4-2-2, 0-0-3-3, 0-0-0-5)
    const q = 1 - p;
    dmg = p * 1.5 * M + q * p * 1.25 * M + q * q * p * M + q ** 3 * p * 0.75 * M + q ** 4 * 4 / 3;
  } else if (sp.bolt) {    // Zaryte crossbow: a hit always triggers the bolt effect
    const a = lo.ammo?.name || '';
    if (/^Ruby/.test(a)) dmg = p * Math.min(110, Math.trunc(monster.hp / 2 * 22 / 100));
    else if (/^Diamond/.test(a)) dmg = p * (Math.trunc(M * 126 / 100) / 2);
    else if (/^Onyx/.test(a)) dmg = p * (Math.trunc(M * 132 / 100) / 2);
    else dmg = r.perAttack;
  } else if (sp.burning) {    // Burning claws: three rolls (Wiki), burn damage not counted
    const q = 1 - p;
    dmg = p * 1.25 * M + q * p * M + q * q * p * 0.75 * M;
  } else if (sp.darkbow) {    // two arrows, x1.5 with dragon arrows (x1.3 otherwise), min 8 (5), each at most 48
    const dragon = /^Dragon arrow/.test(lo.ammo?.name || '');
    const lo2 = Math.min(48, dragon ? 8 : 5), hi = Math.min(48, Math.floor(M * (dragon ? 1.5 : 1.3)));
    dmg = 2 * (p * (lo2 + hi) / 2 + (1 - p) * lo2);
  } else if (sp.tonal) {      // two shots; the second at the lowered Defence when the first hits
    const m2 = { ...monster, def: Math.max(monster.defFloor ?? 0, monster.def - Math.trunc(monster.magic / 8)) };
    const r2 = calc(player, lo, m2, style, null, { ...opts, spec: { acc: sp.acc } });
    dmg = r.perAttack + p * r2.perAttack + (1 - p) * r.perAttack;
  } else if (sp.hits) {
    if (sp.large && monster.size < 2) dmg = r.perAttack;
    else if (sp.second === 'onHit') dmg = r.perAttack + p * r.perAttack;
    else dmg = sp.hits * r.perAttack;
  } else dmg = r.perAttack;
  if (sp.flat) dmg += sp.flat;                  // Granite hammer: +5 to every hit
  if (sp.bleed) dmg += p * sp.bleed;            // Ancient godsword: 25 more after a delay if it hits
  if (sp.burn) dmg += p * sp.burn;              // Arkan blade: burn
  return { dmg, p, maxHit: M, secs, avgOnHit: p ? r.perAttack / p : 0 };
}

/**
 * Seconds to kill a monster with the main loadout plus a Defence-draining spec weapon and/or a damage spec
 * weapon (drainLo / dmgLo = the loadout with that weapon in hand). Drains come first, as many as help
 * (each costs its own energy, e.g. 50%), never below the monster's Defence floor; the energy left, plus what
 * regenerates during the kill, goes on damage specs.
 * Returns { seconds, drains, specs, defence } or null when no spec helps.
 */
export function withSpecs(player, mainLo, { drainLo = null, dmgLo = null }, monster, opts = {}) {
  const thrall = player.thrall ? THRALL_DPS : 0;
  const mainDps = m => bestCalc(player, mainLo, m, opts).dps + thrall;
  const base = mainDps(monster);
  if (base <= 0) return null;
  const plain = monster.hp / base;
  const light = /^Lightbearer/.test(mainLo.ring?.name || '') ? 2 : 1;
  const floor = monster.defFloor ?? 0;
  const dr = drainLo && specOf(drainLo.weapon), ds = dmgLo && specOf(dmgLo.weapon);
  if ((dr && !dr.drain) || (ds && ds.drain)) return null;
  let best = null;
  const maxDrains = dr ? Math.floor(100 / dr.cost) : 0;
  let m = { ...monster }, done = 0, t = 0;
  for (let k = 0; k <= maxDrains; k++) {
    if (k > 0) {                                   // one more drain spec
      if (m.def <= floor) break;
      const h = specHit(player, drainLo, m, dr, opts);
      if (!h) break;
      let cut = dr.drain.pct ? Math.trunc(m.def * dr.drain.pct) : dr.drain.damage ? h.avgOnHit
        : dr.drain.magicEighth ? Math.trunc(monster.magic / 8)
        : Math.trunc(monster.def * (m.attributes.includes('demon') ? dr.drain.demon : dr.drain.base)) + 1;
      m = { ...m, def: Math.max(floor, m.def - h.p * cut) };
      done += h.dmg; t += h.secs;
    }
    const d = mainDps(m);
    const hpLeft = Math.max(0, monster.hp - done - thrall * t);
    let T = t + hpLeft / d, n = 0;
    if (ds) {                                      // damage specs with the energy left and what regenerates
      const h = specHit(player, dmgLo, m, ds, opts);
      if (h && h.dmg > d * h.secs) {
        const left = 100 - k * (dr?.cost || 0);
        for (let i = 0; i < 6; i++) {
          n = Math.floor((left + (T - t) * REGEN_PER_SEC * light) / ds.cost);
          n = Math.max(0, Math.min(n, Math.ceil(hpLeft / Math.max(h.dmg, 1))));
          T = t + n * h.secs + Math.max(0, hpLeft - n * h.dmg - thrall * n * h.secs) / d;
        }
      }
    }
    if (!best || T < best.seconds) best = { seconds: T, drains: k, specs: n, defence: Math.round(m.def) };
  }
  return best && best.seconds < plain - 1e-6 && (best.drains || best.specs) ? best : null;
}

/** One spec weapon on its own (drain or damage). */
export function withSpec(player, mainLo, specLo, monster, opts = {}) {
  const sp = specOf(specLo.weapon);
  if (!sp) return null;
  const r = withSpecs(player, mainLo, sp.drain ? { drainLo: specLo } : { dmgLo: specLo }, monster, opts);
  return r && { ...r, plan: r.drains ? 'drain' : 'damage', specs: r.drains || r.specs };
}
