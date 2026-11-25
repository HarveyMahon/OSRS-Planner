// Best setup: the fastest-killing gear from what the player owns plus what their cash can buy.
//
// For each combat style (melee, ranged, magic) it picks a weapon and then improves one slot at a time
// (keeping the total spent within the budget) until nothing helps, and tries whole sets (Void, Obsidian,
// Crystal, Inquisitor) as one move. A target is one monster or several parts (raids, multi-form bosses):
// each part is killed with the best style allowed on it, and every style has one loadout.

import { SLOTS, bestCalc, styleKind, attackStyles, ammoFits, THRALL_DPS, immuneTo } from './dps.js';
import { specOf, withSpecs, REGEN_PER_SEC } from './specs.js';

const KINDS = ['melee', 'ranged', 'magic'];
const MAX_PER_SLOT = 12, TOP_WEAPONS = 3;
const STAT_KEYS = { melee: ['astab', 'aslash', 'acrush', 'str'], ranged: ['arange', 'rstr'], magic: ['amagic', 'mdmg'] };
// Items kept whatever their stats, for their effects
const SPECIAL = /^(Eclipse [Mm]oon|Blood [Mm]oon|Blue [Mm]oon|Virtus|Verac's|Dharok's|Karil's|Ahrim's|Amulet of the [Dd]amned|Void|Elite void|Obsidian|Crystal (helm|body|legs)|Inquisitor's|Slayer helmet|Black mask|.* slayer helmet|Salve amulet|Berserker necklace|Dizana's|Blessed Dizana's|Tome of)/;

const weaponKinds = w => [...new Set(attackStyles(w).map(s => styleKind(s.type)))];
export const meetsReqs = (item, player, reqs) => {
  const r = item.req || reqs?.[item.name];
  return !r || Object.entries(r).every(([s, l]) => (player.levels[s] ?? 99) >= l);
};

/**
 * Candidate items per slot for one style: usable (levels), available (owned or buyable), relevant, not dominated.
 * avail(item) -> { owned: bool, price: number|null } (price null = can't be bought)
 */
export function candidates(gear, kind, player, avail, reqs, budget, maxPerSlot = MAX_PER_SLOT) {
  const keys = STAT_KEYS[kind];
  const out = {};
  for (const slot of SLOTS) {
    if (slot === 'ammo' && kind !== 'ranged') { out[slot] = []; continue; }
    const tables = slot === 'weapon' ? [...(gear.weapon || []), ...(gear['2h'] || [])] : (gear[slot] || []);
    let list = [];
    for (const it of tables) {
      const a = avail(it);
      const cost = a.owned ? 0 : a.price;
      if (cost == null || cost > budget) continue;
      if (!meetsReqs(it, player, reqs)) continue;
      if (slot === 'weapon' && !weaponKinds(it).includes(kind)) continue;
      const special = SPECIAL.test(it.name);
      const score = keys.map(k => it.b?.[k] || 0);
      if (slot !== 'weapon' && slot !== 'ammo' && !special && score.every(v => v <= 0)) continue;
      list.push({ it, cost, score, special });
    }
    if (slot !== 'weapon' && slot !== 'ammo') {
      // drop items another item beats on every stat at no more cost
      list = list.filter(a => a.special || !list.some(b => b !== a && !b.special && b.cost <= a.cost
        && b.score.every((v, i) => v >= a.score[i]) && (b.cost < a.cost || b.score.some((v, i) => v > a.score[i]))));
    }
    if (slot !== 'weapon' && slot !== 'ammo' && list.length > maxPerSlot) {
      const val = c => c.score.reduce((a, b) => a + b, 0) + (c.cost === 0 ? 5 : 0);
      const spec = list.filter(c => c.special), rest = list.filter(c => !c.special).sort((a, b) => val(b) - val(a));
      list = [...spec, ...rest.slice(0, maxPerSlot)];
    }
    out[slot] = list;
  }
  return out;
}

function cost(lo, costOf) { let c = 0; for (const s of SLOTS) if (lo[s]) c += costOf(lo[s]); return c; }

// Parts that need a particular weapon (CoX Guardians: a pickaxe) swap it in for that part
let WEAPONS = new Map();
const forPart = (lo, p) => { const w = p.weapon && WEAPONS.get(p.weapon); return w ? { ...lo, weapon: w, shield: w.two ? null : lo.shield } : lo; };

/** A target with its random rooms weighted: by their chance (default), or only the rooms given. */
export function layoutTarget(target, rooms = null) {
  if (!target.rooms) return target;
  const chance = Object.fromEntries(target.rooms.map(r => [r.id, rooms ? (rooms.includes(r.id) ? 1 : 0) : r.chance]));
  return { ...target, parts: target.parts.map(p => p.room ? { ...p, weight: p.weight * (chance[p.room] ?? 1) } : p).filter(p => p.weight > 0) };
}

/** Total seconds to clear the parts this loadout is used on (Infinity if it can't damage one). */
function partsTime(player, lo, parts, monsters) {
  let t = 0;
  for (const p of parts) {
    const m = monsters[p.monster];
    const r = bestCalc(player, forPart(lo, p), m, { styles: p.styles, toa: p.toa, boost: p.boost, noAncients: p.noAncients, meleeWeapon: p.meleeWeapon });
    const d = r.dps + (player.thrall ? THRALL_DPS : 0);
    if (d <= 0) return Infinity;
    t += p.weight * m.hp / d;
  }
  return t;
}

/** The best loadout for one style over some parts. Returns { loadout, time, cost } or null. */
export function optimiseKind(kind, player, gear, parts, monsters, avail, { reqs, budget = 0, fast = false } = {}) {
  const cand = candidates(gear, kind, player, avail, reqs, budget, fast ? 6 : MAX_PER_SLOT);
  const costOf = it => { const a = avail(it); return a.owned ? 0 : (a.price ?? Infinity); };
  const kParts = parts.map(p => ({ ...p, styles: [kind] }));
  const memo = new Map();             // the same loadout comes up again and again while improving
  const time = lo => {
    const key = SLOTS.map(sl => lo[sl] ? lo[sl].id + (lo[sl].name.length) : '').join(',');
    let t = memo.get(key);
    if (t === undefined) { t = partsTime(player, lo, kParts, monsters); memo.set(key, t); }
    return t;
  };

  // starting armour: best summed stat per slot among what's affordable for free (owned), else cheapest best
  const base = {};
  for (const s of SLOTS) {
    if (s === 'weapon') continue;
    const owned = cand[s].filter(c => c.cost === 0);
    const pick = (owned.length ? owned : []).sort((a, b) => b.score.reduce((x, y) => x + y, 0) - a.score.reduce((x, y) => x + y, 0))[0];
    base[s] = pick?.it || null;
  }

  // weapons: score each with the starting armour and its strongest ammo, then give the best few their best ammo
  const fitting = w => cand.ammo.filter(c => ammoFits(w, c.it));
  const ammoFor = lo => {
    let best = lo.ammo, bt = time(lo);
    for (const c of fitting(lo.weapon)) {
      if (cost({ ...lo, ammo: c.it }, costOf) > budget) continue;
      const t = time({ ...lo, ammo: c.it });
      if (t < bt) { bt = t; best = c.it; }
    }
    return best;
  };
  // many-part targets: shortlist weapons on the biggest part first (scoring every weapon on every part is slow)
  let weaponCands = cand.weapon;
  if (kParts.length > 3) {
    const big = kParts.reduce((a, p) => (p.weight * monsters[p.monster].hp > a.weight * monsters[a.monster].hp ? p : a));
    const quick = c => { const lo = { ...base, weapon: c.it, shield: c.it.two ? null : base.shield, ammo: fitting(c.it).sort((a, b) => (b.it.b?.rstr || 0) - (a.it.b?.rstr || 0))[0]?.it || null };
      return partsTime(player, lo, [big], monsters); };
    weaponCands = cand.weapon.map(c => ({ c, t: quick(c) })).filter(x => x.t < Infinity).sort((a, b) => a.t - b.t).slice(0, 15).map(x => x.c);
  }
  const scored = [];
  for (const c of weaponCands) {
    const lo = { ...base, weapon: c.it, shield: c.it.two ? null : base.shield, ammo: null };
    if (cost(lo, costOf) > budget) { lo.shield = null; if (cost(lo, costOf) > budget) continue; }
    const fits = fitting(c.it).filter(a => cost({ ...lo, ammo: a.it }, costOf) <= budget).sort((a, b) => (b.it.b?.rstr || 0) - (a.it.b?.rstr || 0));
    lo.ammo = fits[0]?.it || null;
    const t = time(lo);
    if (t < Infinity) scored.push({ lo, t });
  }
  scored.sort((a, b) => a.t - b.t);
  for (const x of scored.slice(0, 8)) if (x.lo.ammo) { x.lo.ammo = ammoFor(x.lo); x.t = time(x.lo); }
  scored.sort((a, b) => a.t - b.t);
  let best = null;
  for (const { lo: start } of scored.slice(0, fast ? 2 : TOP_WEAPONS)) {
    const lo = improve(start, cand, time, costOf, budget, fast ? 2 : 3);
    const t = time(lo);
    if (!best || t < best.time) best = { loadout: lo, time: t, cost: cost(lo, costOf) };
  }
  return best;
}

// One slot at a time, then whole sets, until nothing improves.
function improve(start, cand, time, costOf, budget, passes = 3) {
  let lo = { ...start }, cur = time(lo);
  for (let pass = 0; pass < passes; pass++) {
    let changed = false;
    for (const s of SLOTS) {
      if (s === 'weapon' || (s === 'shield' && lo.weapon?.two)) continue;
      for (const c of [{ it: null }, ...(s === 'ammo' ? cand.ammo.filter(c => ammoFits(lo.weapon, c.it)) : cand[s])]) {
        if (c.it === lo[s]) continue;
        const next = { ...lo, [s]: c.it };
        if (cost(next, costOf) > budget) continue;
        const t = time(next);
        if (t < cur - 1e-9 || (Math.abs(t - cur) < 1e-9 && costOf(c.it || {}) < costOf(lo[s] || {}))) { lo = next; cur = t; changed = true; }
      }
    }
    for (const set of SETS) {
      const pieces = {};
      for (const [s, re] of Object.entries(set)) {
        const opts = cand[s].filter(c => re.test(c.it.name)).sort((a, b) => a.cost - b.cost);
        if (!opts.length) { pieces.missing = true; break; }
        pieces[s] = opts[0].it;
      }
      if (pieces.missing) continue;
      const next = { ...lo, ...pieces };
      if (pieces.weapon?.two) next.shield = null;
      if (pieces.weapon && next.weapon?.category === 'Crossbow' && !ammoFits(next.weapon, next.ammo)) {
        next.ammo = cand.ammo.filter(c => ammoFits(next.weapon, c.it)).sort((a, b) => (b.it.b?.rstr || 0) - (a.it.b?.rstr || 0))[0]?.it || null;
      }
      if (cost(next, costOf) > budget) continue;
      const t = time(next);
      if (t < cur - 1e-9) { lo = next; cur = t; changed = true; }
    }
    if (!changed) break;
  }
  return lo;
}

const SETS = [
  { head: /^Void melee helm/, body: /^Elite void top/, legs: /^Elite void robe/, hands: /^Void knight gloves/ },
  { head: /^Void ranger helm/, body: /^Elite void top/, legs: /^Elite void robe/, hands: /^Void knight gloves/ },
  { head: /^Void mage helm/, body: /^Elite void top/, legs: /^Elite void robe/, hands: /^Void knight gloves/ },
  { head: /^Void melee helm/, body: /^Void knight top/, legs: /^Void knight robe/, hands: /^Void knight gloves/ },
  { head: /^Void ranger helm/, body: /^Void knight top/, legs: /^Void knight robe/, hands: /^Void knight gloves/ },
  { head: /^Obsidian helmet/, body: /^Obsidian platebody/, legs: /^Obsidian platelegs/ },
  { head: /^Crystal helm/, body: /^Crystal body/, legs: /^Crystal legs/ },
  { head: /^Inquisitor's great helm/, body: /^Inquisitor's hauberk/, legs: /^Inquisitor's plateskirt/ },
  { head: /^Eclipse moon helm/i, body: /^Eclipse moon chestplate/i, legs: /^Eclipse moon tassets/i },
  { head: /^Blood moon helm/i, body: /^Blood moon chestplate/i, legs: /^Blood moon tassets/i },
  { head: /^Blue moon helm/i, body: /^Blue moon chestplate/i, legs: /^Blue moon tassets/i },
  { head: /^Virtus mask/, body: /^Virtus robe top/, legs: /^Virtus robe bottom/ },
  // sets that work with their own weapon
  { head: /^Eclipse moon helm/i, body: /^Eclipse moon chestplate/i, legs: /^Eclipse moon tassets/i, weapon: /^Eclipse atlatl/ },
  { head: /^Blood moon helm/i, body: /^Blood moon chestplate/i, legs: /^Blood moon tassets/i, weapon: /^Dual macuahuitl/ },
  { head: /^Blue moon helm/i, body: /^Blue moon chestplate/i, legs: /^Blue moon tassets/i, weapon: /^Blue Moon spear/i },
  { head: /^Verac's helm/, body: /^Verac's brassard/, legs: /^Verac's plateskirt/, weapon: /^Verac's flail/ },
  { head: /^Dharok's helm/, body: /^Dharok's platebody/, legs: /^Dharok's platelegs/, weapon: /^Dharok's greataxe/ },
  { head: /^Karil's coif/, body: /^Karil's leathertop/, legs: /^Karil's leatherskirt/, neck: /^Amulet of the [Dd]amned/, weapon: /^Karil's crossbow/ },
  { head: /^Ahrim's hood/, body: /^Ahrim's robetop/, legs: /^Ahrim's robeskirt/, neck: /^Amulet of the [Dd]amned/, weapon: /^Ahrim's staff/ },
  { head: /^Obsidian helmet/, body: /^Obsidian platebody/, legs: /^Obsidian platelegs/, weapon: /^(Toktz-xil-ak|Tzhaar-ket-em|Tzhaar-ket-om|Toktz-xil-ek)/ },
  { head: /^Verac's helm/, body: /^Verac's brassard/, legs: /^Verac's plateskirt/ },
  { head: /^Karil's coif/, body: /^Karil's leathertop/, legs: /^Karil's leatherskirt/, neck: /^Amulet of the [Dd]amned/ },
  { head: /^Ahrim's hood/, body: /^Ahrim's robetop/, legs: /^Ahrim's robeskirt/, neck: /^Amulet of the [Dd]amned/ },
];

/**
 * The best setup for a target (one or more parts). Styles are optimised in order of how much of the
 * target they're allowed on; each later style gets the budget the earlier ones left.
 * Returns { kinds: {melee|ranged|magic: {loadout, time, cost}}, time, cost, thrall, perPart: [...] }.
 */
// opts.cycle: seconds per kill including downtime (kill rates). Spec energy then comes from what regenerates over
// one kill cycle (a bar can't be full at the start of every kill); without it, a fight starts with a full bar.
// Raids and other whole content always start with a full bar, shared across the whole run.
export function bestSetup(player, gear, target, monsters, avail, { reqs, budget = 0, fast = false, cycle = null } = {}) {
  WEAPONS = new Map([...(gear.weapon || []), ...(gear['2h'] || [])].map(w => [w.name, w]));
  target = layoutTarget(target, target.chosenRooms || null);
  const parts = target.parts.filter(p => monsters[p.monster]);
  if (!parts.length) return null;
  // a style only works on the parts it can damage at all (Dusk: melee only; Dawn: no melee bar a halberd)
  const canHit = (p, k) => (!p.styles || p.styles.includes(k)) && !immuneTo(monsters[p.monster], k, k === 'melee' ? { category: 'Polearm' } : null);
  const order = KINDS.map(k => ({ k, hp: parts.filter(p => canHit(p, k)).reduce((s, p) => s + p.weight * monsters[p.monster].hp, 0) }))
    .filter(x => x.hp > 0).sort((a, b) => b.hp - a.hp);
  // A thrall adds the same DPS to every setup, so it doesn't change the best melee or ranged gear; it only
  // changes magic (Arceuus spells instead of standard and Ancient ones). Optimise magic both ways.
  const variants = player.thrallOk ? [false, true] : [false];
  const memo = new Map();
  let best = null;
  for (const thrall of variants) {
    const pl = { ...player, thrall };
    const kinds = {};
    let left = budget;
    const bought = new Set();
    for (const { k } of order) {
      const kParts = parts.filter(p => canHit(p, k));
      const av = it => bought.has(it) ? { owned: true, price: 0 } : avail(it);
      const key = k === 'magic' ? `${k}:${thrall}:${left}` : `${k}:${left}`;
      let r = memo.get(key);
      if (r === undefined) { r = optimiseKind(k, { ...pl, thrall: k === 'magic' ? thrall : false }, gear, kParts, monsters, av, { reqs, budget: left, fast }); memo.set(key, r); }
      if (!r) continue;
      kinds[k] = r;
      for (const s of SLOTS) { const it = r.loadout[s]; if (it && !avail(it).owned && !bought.has(it)) { bought.add(it); left -= avail(it).price || 0; } }
    }
    // Each style was optimised against every part it can hit, but in the end it only gets the parts it's
    // fastest on (Zulrah: magic only on the forms ranged is worse at). Re-optimise each style for the parts
    // it actually wins, and also try its owned-only gear, keeping a swap whenever the whole target gets
    // faster within budget. (This also makes sure spending money never leaves you slower than not.)
    const buyCost = ks => { const set = new Set(); for (const r of Object.values(ks)) for (const s of SLOTS) { const it = r.loadout[s]; if (it && !avail(it).owned) set.add(it); } return [...set].reduce((c, it) => c + (avail(it).price || 0), 0); };
    const quick = ks => { let tot = 0; const won = {}; for (const p of parts) { const m = monsters[p.monster]; let bd = 0, bk = null;
      for (const [k, r] of Object.entries(ks)) { if (p.styles && !p.styles.includes(k)) continue;
        const d = bestCalc(pl, forPart(r.loadout, p), m, { styles: [k], toa: p.toa, boost: p.boost, noAncients: p.noAncients, meleeWeapon: p.meleeWeapon }).dps + (thrall ? THRALL_DPS : 0);
        if (d > bd) { bd = d; bk = k; } }
      tot += bd > 0 ? p.weight * m.hp / bd : Infinity; if (bk) (won[bk] ||= []).push(p); } return { tot, won }; };
    if (Object.keys(kinds).length) {
      let cur = quick(kinds);
      for (let round = 0; round < (fast ? 1 : 2); round++) {
        let changed = false;
        for (const k of Object.keys(kinds)) {
          const plk = { ...pl, thrall: k === 'magic' ? thrall : false };
          const kParts = parts.filter(p => canHit(p, k));
          const others = Object.fromEntries(Object.entries(kinds).filter(([x]) => x !== k));
          const room = budget - buyCost(others);
          const alts = [];
          if (budget > 0 && kinds[k].cost > 0) { const key = `own:${k}:${thrall}`; let o = memo.get(key); if (o === undefined) { o = optimiseKind(k, plk, gear, kParts, monsters, avail, { reqs, budget: 0, fast }); memo.set(key, o); } if (o) alts.push(o); }
          const won = cur.won[k];
          if (won && won.length < kParts.length) { const o = optimiseKind(k, plk, gear, won, monsters, avail, { reqs, budget: Math.max(0, room), fast }); if (o) alts.push({ ...o, time: partsTime(plk, o.loadout, kParts.map(p => ({ ...p, styles: [k] })), monsters) }); }
          for (const o of alts) {
            if (o.loadout === kinds[k].loadout) continue;
            const next = { ...kinds, [k]: o };
            if (buyCost(next) > budget) continue;
            const q = quick(next);
            if (q.tot < cur.tot - 1e-9) { kinds[k] = o; cur = q; changed = true; }
          }
        }
        if (!changed) break;
      }
    }
    // each part with its fastest style; then again preferring each style in turn, because a style that's a
    // little slower on its own can come out ahead once its spec weapons are counted
    const allKinds = { ...kinds };
    const assemble = prefer => {
      let total = 0;
      const perPart = parts.map(p => {
        const m = monsters[p.monster];
        let pick = null;
        for (const [k, r] of Object.entries(allKinds)) {
          if (p.styles && !p.styles.includes(k)) continue;
          const c = bestCalc(pl, forPart(r.loadout, p), m, { styles: [k], toa: p.toa, boost: p.boost, noAncients: p.noAncients, meleeWeapon: p.meleeWeapon });
          const d = c.dps + (thrall ? THRALL_DPS : 0);
          if (d <= 0) continue;
          const better = !pick || (prefer ? (k === prefer && pick.kind !== prefer) || ((k === prefer) === (pick.kind === prefer) && d > pick.dps) : d > pick.dps);
          if (better) pick = { kind: k, dps: d, calc: c };
        }
        const secs = pick ? p.weight * m.hp / pick.dps : Infinity;
        total += secs;
        return { ...p, name: m.name, ...pick, seconds: secs, usesWeapon: p.weapon && WEAPONS.get(p.weapon) ? p.weapon : null };
      });
      const used = new Set(perPart.map(p => p.kind).filter(Boolean));
      const ks = Object.fromEntries(Object.entries(allKinds).filter(([k]) => used.has(k)));
      const buy = new Set();
      for (const r of Object.values(ks)) for (const s of SLOTS) { const it = r.loadout[s]; if (it && !avail(it).owned) buy.add(it); }
      const res = { kinds: ks, time: total, cost: [...buy].reduce((c, it) => c + (avail(it).price || 0), 0), thrall, perPart };
      addSpec(res, pl, gear, monsters, avail, buy, { reqs, budget, fast, cycle: target.whole ? null : cycle });
      return res;
    };
    const kindsList = Object.keys(allKinds);
    const tryEach = kindsList.length > 1 && (!fast || parts.length <= 3);       // (skipped for many-part targets in quick mode)
    for (const prefer of [null, ...(tryEach ? kindsList : [])]) {
      const res = assemble(prefer);
      if (!best || res.time < best.time) best = res;
    }
  }
  return best;
}

// Special attacks: the Defence-drain weapon and/or damage spec weapon that save the most time over the whole
// target (used in every part where they help, each part starting with full energy). Owned, or bought from
// what's left of the budget when that saves at least 5% of the time.
function addSpec(res, player, gear, monsters, avail, buy, { reqs, budget, fast, cycle }) {
  const left = budget - res.cost;
  const priceOf = w => avail(w).owned ? 0 : avail(w).price;
  const cands = [...(gear.weapon || []), ...(gear['2h'] || [])].filter(w => specOf(w) && !buy.has(w)
    && meetsReqs(w, player, reqs) && (avail(w).owned || (avail(w).price != null && avail(w).price <= left)));
  const byName = new Map();                       // one version of each weapon (the cheapest)
  for (const w of cands) { const k = specOf(w); const cur = byName.get(k); if (!cur || priceOf(w) < priceOf(cur)) byName.set(k, w); }
  const weapons = [...byName.values()];
  const drains = [null, ...weapons.filter(w => specOf(w).drain)], damages = [null, ...weapons.filter(w => !specOf(w).drain)];
  const kindOf = w => specOf(w).type === 'ranged' ? 'ranged' : 'melee';
  // One energy pool for the whole fight or run: a full bar (for repeated kills, cycle: what regenerates over the
  // downtime of one kill cycle) plus 10% per 30s (x2 with a Lightbearer) over the fight, spent on the parts that
  // save the most time per energy point; many copies of a monster share it.
  const light = Object.values(res.kinds).some(k => /^Lightbearer/.test(k.loadout.ring?.name || '')) ? 2 : 1;
  const regen = REGEN_PER_SEC * light;
  let best = null;
  const evalPair = (dw, xw) => {
    const cost = (dw ? priceOf(dw) : 0) + (xw ? priceOf(xw) : 0);
    if (cost > left) return null;
    // each copy of a part on its own: starting with a bar (or the cycle's energy), with its own regeneration
    const start = cycle ? Math.min(100, Math.max(0, cycle - res.time) * regen) : 100;
    const opts = res.perPart.map(p => {
      const ok = w => w && p.kind && !p.weapon && (!p.styles || p.styles.includes(kindOf(w)));   // e.g. no melee spec on a ranged-only part
      const d = ok(dw) ? dw : null, x = ok(xw) ? xw : null;
      if (!d && !x) return null;
      const main = res.kinds[p.kind].loadout;
      const loFor = w => { const b = res.kinds[kindOf(w)]?.loadout || main; return { ...b, weapon: w, shield: w.two ? null : b.shield }; };
      const r = withSpecs(player, main, { drainLo: d && loFor(d), dmgLo: x && loFor(x) }, monsters[p.monster], { styles: [p.kind], toa: p.toa, boost: p.boost, noAncients: p.noAncients, meleeWeapon: p.meleeWeapon, energy: start });
      if (!r) return null;
      const save = p.seconds / p.weight - r.seconds;
      return save > 0 ? { r, save, rate: r.used ? save / r.used : Infinity } : null;
    });
    const order = opts.map((o, i) => o ? i : -1).filter(i => i >= 0).sort((a, b) => opts[b].rate - opts[a].rate);
    // the pool is the starting energy plus regeneration over the whole (spec-shortened) fight: a few rounds
    let total = res.time, copies = [];
    for (let round = 0; round < 3; round++) {
      let pool = start + total * regen;
      copies = new Array(res.perPart.length).fill(0);
      for (const i of order) {
        const o = opts[i], w = res.perPart[i].weight;
        const c = o.r.used ? Math.max(0, Math.min(w, pool / o.r.used)) : w;
        copies[i] = c; pool -= c * o.r.used;
      }
      total = res.perPart.reduce((sum, p, i) => sum + p.seconds - (opts[i] ? copies[i] * opts[i].save : 0), 0);
    }
    const parts = res.perPart.map((p, i) => {
      const o = opts[i], c = copies[i];
      if (!o || c <= 0) return { ...p };
      return { ...p, seconds: p.seconds - c * o.save, spec: { ...o.r, copies: c, of: p.weight } };
    });
    return { dw, xw, total, parts, cost };
  };
  const consider = c => {
    if (!c) return;
    const need = c.cost ? Math.max(0.5, res.time * 0.05) : 0.5;
    if (c.total < res.time - need && (!best || c.total < best.total - 1e-6 || (Math.abs(c.total - best.total) < 1e-6 && c.cost < best.cost))) best = c;
  };
  if (fast) {
    // quicker: each weapon alone, then the best drain weapon with the best damage weapon
    const singles = weapons.map(w => specOf(w).drain ? evalPair(w, null) : evalPair(null, w)).filter(Boolean);
    singles.forEach(consider);
    const bd = singles.filter(c => c.dw).sort((a, b) => a.total - b.total)[0], bx = singles.filter(c => c.xw).sort((a, b) => a.total - b.total)[0];
    if (bd && bx) consider(evalPair(bd.dw, bx.xw));
  } else {
    for (const dw of drains) for (const xw of damages) if (dw || xw) consider(evalPair(dw, xw));
  }
  if (!best) return;
  const info = w => w && { item: w, owned: avail(w).owned, price: priceOf(w) };
  // drop a weapon that ended up unused
  const usedD = best.parts.some(p => p.spec?.drains), usedX = best.parts.some(p => p.spec?.specs);
  res.spec = { drain: usedD ? info(best.dw) : null, damage: usedX ? info(best.xw) : null, saved: res.time - best.total };
  res.spec.item = (res.spec.drain || res.spec.damage).item;                     // the main one, for older callers
  res.time = best.total;
  res.perPart = best.parts;
  res.cost += (usedD && best.dw ? priceOf(best.dw) : 0) + (usedX && best.xw ? priceOf(best.xw) : 0);
}
