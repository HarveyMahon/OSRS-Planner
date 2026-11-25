// Special attacks: how much faster a kill goes with a spec weapon switch.
//
// Two kinds of plan, from the special attack numbers on the OSRS Wiki:
//  * Defence drains (Dragon warhammer, Elder maul, Bandos godsword, Arclight, Emberlight): spend the
//    starting 100% energy at the start of the fight, then kill with the main setup at the lowered Defence.
//  * Damage specs (claws, godswords, Voidwaker, blowpipe, Zaryte crossbow, fang, daggers, halberds): spend the
//    energy as it comes (100% at the start, then 10% every 30 seconds, twice as fast with a Lightbearer).
// Each spec takes the place of a normal attack for the spec weapon's attack time.

import { calc, bestCalc, attackStyles, styleKind, TICK, THRALL_DPS, fl, boosts } from './dps.js';

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
  "Zorya's tome": { cost: 50, type: 'magic', acc: 2.5, dmg: [1.6], zorya: true },   // a hit buffs the next 3 attacks the same, at 2 ticks
  'Webweaver bow': { cost: 50, type: 'ranged', acc: 2, cut: 0.6, hits: 4 },
  'Burning claws': { cost: 35, type: 'slash', burning: true },
  'Crimson kisten': { cost: 50, type: 'crush', kisten: true },
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
  'Magic shortbow (i)': { cost: 50, type: 'ranged', acc: 10 / 7, hits: 2, ammoOnly: true },
  'Magic shortbow': { cost: 55, type: 'ranged', acc: 10 / 7, hits: 2, ammoOnly: true },
  'Heavy ballista': { cost: 65, type: 'ranged', acc: 1.25, dmg: [1.25] },
  'Light ballista': { cost: 65, type: 'ranged', acc: 1.25, dmg: [1.25] },
  // added 25 Nov (later afternoon)
  'Saradomin sword': { cost: 100, type: 'slash', dmg: [1.1], onHit: 8.5 },                  // + 1-16 magic damage when it hits
  'Barrelchest anchor': { cost: 50, type: 'crush', acc: 2, dmg: [1.1], drain: { rolled: 0.1 } }, // Defence -10% of the damage rolled
  'Bone dagger': { cost: 75, type: 'stab', alwaysHit: true, once: true, drain: { damage: true } },   // can't miss a fresh target; Defence -damage, once
  'Dorgeshuun crossbow': { cost: 75, type: 'ranged', alwaysHit: true, once: true, drain: { damage: true } },
  'Sunspear': { cost: 50, type: 'stab', fixedPct: 0.7 },                                      // a hit always deals 70% of max
  'Scorching bow': { cost: 25, type: 'ranged', demonBurn: 5 },                                 // burns demons for 5, anything else for 1
  'Eclipse atlatl': { cost: 50, type: 'ranged', acc: 1.5, eclipse: true, needs: 'eclipse' },   // consumes burns: max +burn left (est. 5)
  'Blue Moon spear': { cost: 50, type: 'stab', acc: 1.24, dmg: [1.24], needs: 'blue' },        // +1.5% per tick of bind removed (est. 16)
  "Saradomin's blessed sword": { cost: 65, type: 'slash', dmg: [1.25], vsDef: 'magic' },   // rolls against Magic Defence
  'Dual macuahuitl': { cost: 25, type: 'crush', dualmac: true, needs: 'blood' },
  'Magic longbow': { cost: 35, type: 'ranged', alwaysHit: true, ammoOnly: true },
  'Magic comp bow': { cost: 35, type: 'ranged', alwaysHit: true, ammoOnly: true },
  'Seercull': { cost: 100, type: 'ranged', alwaysHit: true, ammoOnly: true },
  'Soulreaper axe': { cost: 0, type: 'slash', soulreaper: true },
};
const NEEDS = { eclipse: /^Eclipse moon/i, blue: /^Blue moon/i, blood: /^Blood moon/i };
const hasSet = (lo, re) => ['head', 'body', 'legs'].every(s => re.test(lo[s]?.name || ''));
const canonName = n => String(n || '').replace(/\s*\((or|l|cr|p\+\+|p\+|p|kp|a)\)$/i, '');
const SPECS_LC = () => SPECS_LOWER || (SPECS_LOWER = Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k.toLowerCase(), v])));
let SPECS_LOWER = null;
export const specOf = w => w ? SPECS_LC()[canonName(w.name).toLowerCase()] || null : null;

const REGEN_PER_SEC = 10 / 30;
const burnImmune = m => m.burnImmune === 'normal' || m.burnImmune === 'strong';   // normal burns (claws, Arkan blade)

/** Expected damage of one special attack (and the time it takes), or null if it can't be used. */
export function specHit(player, lo, monster, sp, opts) {
  const w = lo.weapon;
  const kindOf = sp.type === 'ranged' ? 'ranged' : sp.type === 'magic' ? 'magic' : 'melee';
  const styles = attackStyles(w).filter(s => styleKind(s.type) === kindOf);
  if (!styles.length) return null;
  const style = kindOf === 'melee' ? { name: 'Special attack', type: sp.type, stance: styles.find(s => s.stance === 'aggressive') ? 'aggressive' : styles[0].stance }
    : kindOf === 'magic' ? (styles.find(s => s.stance === 'accurate') || styles[0]) : styles.find(s => s.stance === 'rapid') || styles[0];
  if (sp.needs && !hasSet(lo, NEEDS[sp.needs])) return null;
  if (opts.meleeWeapon && kindOf === 'melee' && !new RegExp(opts.meleeWeapon, 'i').test(w?.name || '')) return null;   // e.g. Zulrah: halberds only                  // the spec needs its armour set
  const r = calc(player, lo, monster, style, null, { ...opts, spec: { acc: sp.acc, dmg: sp.dmg, fang: sp.fang, voidwaker: sp.voidwaker, staffMax: sp.staffMax, alwaysHit: sp.alwaysHit, cut: sp.cut, vsDef: sp.vsDef } });
  if (!r.maxHit && !sp.bolt) return null;
  const p = r.accuracy;
  let M = r.maxHit;
  // Magic short/longbow, comp bow and Seercull specs: max hit from Ranged level + boost + 10 and the arrow alone (other gear ignored)
  if (sp.ammoOnly) { const B = boosts(player); M = Math.trunc(((player.levels.Ranged + B.Ranged + 10) * ((lo.ammo?.b?.rstr || 0) + 64) + 320) / 640); }
  const mean = (M * (M + 1) / 2 + 1) / (M + 1);        // a landed hit: 0 to max, 0 counted as 1
  let dmg;
  const secs = (sp.speed || r.speed) * TICK;
  if (sp.claws) {          // the four hits depend on which roll lands first (Wiki: 4-2-1-1, 0-4-2-2, 0-0-3-3, 0-0-0-5)
    const q = 1 - p;
    dmg = p * 1.5 * M + q * p * 1.25 * M + q * q * p * M + q ** 3 * p * 0.75 * M + q ** 4 * 4 / 3;
  } else if (sp.bolt) {    // Zaryte crossbow: a hit always triggers the bolt effect
    const a = lo.ammo?.name || '';
    if (/^Ruby.*\(e\)/.test(a)) dmg = p * Math.min(110, Math.trunc(monster.hp / 2 * 22 / 100));
    else if (/^Diamond.*\(e\)/.test(a)) dmg = p * (Math.trunc(M * 126 / 100) / 2);
    else if (/^Onyx.*\(e\)/.test(a)) dmg = p * (Math.trunc(M * 132 / 100) / 2);
    else dmg = r.perAttack;
  } else if (sp.burning) {    // Burning claws (as the Wiki calculator): roll k that lands sets the damage range; 3 hitsplats,
    // each burns for 10 with a 15/30/45% chance by which roll landed (one point lost when the first two both burn)
    const q = 1 - p; dmg = q ** 3 * 1.2;
    for (let k = 0; k < 3; k++) {
      const low = Math.trunc(M * (3 - k) / 4), high = M + low, ch = q ** k * p / (high - low + 1);
      for (let d = low; d <= high; d++) dmg += ch * (k === 0 ? Math.trunc(d / 2) + 2 * Math.trunc(d / 4) : k === 1 ? 2 * Math.trunc(d / 2) : d);
      const c = 0.15 * (k + 1);
      if (!burnImmune(monster)) dmg += q ** k * p * (30 * c - c * c);
    }
  } else if (sp.kisten) {     // Crimson kisten: four accuracy rolls in one hit; i successes = 50+20i% to 90+20i% of max
    let e = 0;
    for (let i = 1; i <= 4; i++) e += [1, 4, 6, 4, 1][i] * p ** i * (1 - p) ** (4 - i) * M * (70 + 20 * i) / 100;
    dmg = e;
  } else if (sp.darkbow) {    // two arrows, x1.5 with dragon arrows (x1.3 otherwise), min 8 (5), each at most 48
    const dragon = /^Dragon arrow/.test(lo.ammo?.name || '');
    const lo2 = Math.min(48, dragon ? 8 : 5), hi = Math.min(48, fl(M * (dragon ? 1.5 : 1.3)));
    dmg = 2 * (p * (lo2 + hi) / 2 + (1 - p) * lo2);
  } else if (sp.tonal) {      // two shots; the second at the lowered Defence when the first hits
    const m2 = { ...monster, def: Math.max(monster.defFloor ?? 0, monster.def - Math.trunc(monster.magic / 8)) };
    const r2 = calc(player, lo, m2, style, null, { ...opts, spec: { acc: sp.acc } });
    dmg = r.perAttack + p * r2.perAttack + (1 - p) * r.perAttack;
  } else if (sp.zorya) {      // Zorya's flow: if it hits, the next 3 tome attacks get +150% accuracy, +60% damage, 2 ticks each
    dmg = r.perAttack + p * 3 * r.perAttack;
    return { dmg, p, maxHit: M, secs: secs + p * 3 * 2 * TICK, avgOnHit: p ? r.perAttack / p : 0 };
  } else if (sp.ammoOnly) {
    dmg = (sp.hits || 1) * (sp.alwaysHit ? 1 : p) * mean;
  } else if (sp.fixedPct) {   // Sunspear: a hit deals 70% of max, +1
    dmg = p * (Math.trunc(M * sp.fixedPct) + 1);
  } else if (sp.eclipse) {
    dmg = r.perAttack + p * 3.75;
  } else if (sp.dualmac) {    // both hitsplats roll accuracy on their own, each +25%, max +25% before the split
    const r2 = calc(player, lo, monster, style, null, { ...opts, spec: { acc: 1.25, dmg: [1.25] } });
    const m1 = fl(r2.maxHit / 2), m2 = r2.maxHit - m1;
    dmg = r2.accuracy * (m1 / 2 + 0.5) + r2.accuracy * (m2 / 2 + 0.5);
  } else if (sp.hits) {
    if (sp.large && monster.size < 2) dmg = r.perAttack;
    else if (sp.large) {      // halberds: the second hit on a big monster rolls at 3/4 of the attack roll
      const r2 = calc(player, lo, monster, style, null, { ...opts, spec: { acc: (sp.acc || 1) * 0.75, dmg: sp.dmg } });
      dmg = r.perAttack + r2.perAttack;
    }
    else if (sp.second === 'onHit') dmg = 2 * r.perAttack;   // Abyssal dagger: the second hit always lands when the first does
    else dmg = sp.hits * r.perAttack;
  } else dmg = r.perAttack;
  if (sp.flat) dmg += sp.flat;                  // Granite hammer: +5 to every hit
  if (sp.onHit) dmg += p * sp.onHit;
  if (sp.demonBurn && !burnImmune(monster)) dmg += monster.attributes.includes('demon') ? sp.demonBurn : 1;
  if (sp.bleed) dmg += p * sp.bleed;            // Ancient godsword: 25 more after a delay if it hits
  if (sp.burn && !burnImmune(monster)) dmg += p * sp.burn;   // Arkan blade: a 10 damage burn
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
  if (ds?.soulreaper) {        // Soulreaper axe: Behead uses up the 5 stacks (and their Strength); it costs no energy
    if (!/^Soulreaper axe/.test(mainLo.weapon?.name || '')) return null;
    const st = attackStyles(mainLo.weapon).filter(x => styleKind(x.type) === 'melee');
    let cyc = 0, best = null;
    for (const style of st) {
      let dmg = 0;
      for (let k = 0; k < 5; k++) dmg += calc(player, mainLo, monster, style, null, { ...opts, soulStacks: k }).perAttack;
      const sp = calc(player, mainLo, monster, style, null, { ...opts, soulStacks: 0, spec: { acc: 1.6, dmg: [1.3], minPct: 0.3 } });
      dmg += sp.perAttack;
      const d = dmg / (6 * sp.speed * TICK);
      if (!best || d > best) best = d;
    }
    cyc = best + thrall;
    return cyc > base ? { seconds: monster.hp / cyc, drains: 0, specs: Math.round(monster.hp / cyc / (6 * (mainLo.weapon.speed || 5) * TICK)), defence: monster.def } : null;
  }
  if ((dr && !dr.drain) || (ds && ds.drain)) return null;
  let best = null;
  const maxDrains = dr ? (dr.once ? 1 : fl(100 / dr.cost)) : 0;
  let m = { ...monster }, done = 0, t = 0;
  for (let k = 0; k <= maxDrains; k++) {
    if (k > 0) {                                   // one more drain spec
      if (m.def <= floor) break;
      const h = specHit(player, drainLo, m, dr, opts);
      if (!h) break;
      let cut = dr.drain.pct ? Math.trunc(m.def * dr.drain.pct) : dr.drain.damage ? h.avgOnHit
        : dr.drain.magicEighth ? Math.trunc(monster.magic / 8)
        : dr.drain.rolled ? h.avgOnHit * dr.drain.rolled
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
          n = fl((left + (T - t) * REGEN_PER_SEC * light) / ds.cost);
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
