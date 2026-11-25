// Best setup: the fastest-killing gear from what the player owns plus what their cash can buy.
//
// For each combat style (melee, ranged, magic) it picks a weapon and then improves one slot at a time
// (keeping the total spent within the budget) until nothing helps, and tries whole sets (Void, Obsidian,
// Crystal, Inquisitor) as one move. A target is one monster or several parts (raids, multi-form bosses):
// each part is killed with the best style allowed on it, and every style has one loadout.

import { SLOTS, bestCalc, styleKind, attackStyles, THRALL_DPS } from './dps.js';

const KINDS = ['melee', 'ranged', 'magic'];
const STAT_KEYS = { melee: ['astab', 'aslash', 'acrush', 'str'], ranged: ['arange', 'rstr'], magic: ['amagic', 'mdmg'] };
// Items kept whatever their stats, for their effects
const SPECIAL = /^(Void|Elite void|Obsidian|Crystal (helm|body|legs)|Inquisitor's|Slayer helmet|Black mask|.* slayer helmet|Salve amulet|Berserker necklace|Dizana's|Blessed Dizana's|Tome of)/;

const weaponKinds = w => [...new Set(attackStyles(w).map(s => styleKind(s.type)))];
const meetsReqs = (item, player, reqs) => {
  const r = reqs?.[item.name];
  return !r || Object.entries(r).every(([s, l]) => (player.levels[s] ?? 99) >= l);
};

/**
 * Candidate items per slot for one style: usable (levels), available (owned or buyable), relevant, not dominated.
 * avail(item) -> { owned: bool, price: number|null } (price null = can't be bought)
 */
export function candidates(gear, kind, player, avail, reqs, budget) {
  const keys = STAT_KEYS[kind];
  const out = {};
  for (const slot of SLOTS) {
    const tables = slot === 'weapon' ? [...(gear.weapon || []), ...(gear['2h'] || []).map(x => ({ ...x, two: true }))] : (gear[slot] || []);
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
    out[slot] = list;
  }
  return out;
}

function cost(lo, costOf) { let c = 0; for (const s of SLOTS) if (lo[s]) c += costOf(lo[s]); return c; }

/** Total seconds to clear the parts this loadout is used on (Infinity if it can't damage one). */
function partsTime(player, lo, parts, monsters) {
  let t = 0;
  for (const p of parts) {
    const m = monsters[p.monster];
    const r = bestCalc(player, lo, m, { styles: p.styles, toa: p.toa });
    const d = r.dps + (player.thrall ? THRALL_DPS : 0);
    if (d <= 0) return Infinity;
    t += p.weight * m.hp / d;
  }
  return t;
}

/** The best loadout for one style over some parts. Returns { loadout, time, cost } or null. */
export function optimiseKind(kind, player, gear, parts, monsters, avail, { reqs, budget = 0 } = {}) {
  const cand = candidates(gear, kind, player, avail, reqs, budget);
  const costOf = it => { const a = avail(it); return a.owned ? 0 : (a.price ?? Infinity); };
  const kParts = parts.map(p => ({ ...p, styles: [kind] }));
  const time = lo => partsTime(player, lo, kParts, monsters);

  // starting armour: best summed stat per slot among what's affordable for free (owned), else cheapest best
  const base = {};
  for (const s of SLOTS) {
    if (s === 'weapon') continue;
    const owned = cand[s].filter(c => c.cost === 0);
    const pick = (owned.length ? owned : []).sort((a, b) => b.score.reduce((x, y) => x + y, 0) - a.score.reduce((x, y) => x + y, 0))[0];
    base[s] = pick?.it || null;
  }

  // weapons: score each with the starting armour (and its best ammo), keep the best few
  const ammoFor = lo => {
    let best = lo.ammo, bt = time(lo);
    for (const c of cand.ammo) {
      if (cost({ ...lo, ammo: c.it }, costOf) > budget) continue;
      const t = time({ ...lo, ammo: c.it });
      if (t < bt) { bt = t; best = c.it; }
    }
    return best;
  };
  const scored = [];
  for (const c of cand.weapon) {
    const lo = { ...base, weapon: c.it, shield: c.it.two ? null : base.shield };
    if (cost(lo, costOf) > budget) { lo.shield = null; if (cost(lo, costOf) > budget) continue; }
    lo.ammo = ammoFor(lo);
    const t = time(lo);
    if (t < Infinity) scored.push({ lo, t });
  }
  scored.sort((a, b) => a.t - b.t);
  let best = null;
  for (const { lo: start } of scored.slice(0, 4)) {
    const lo = improve(start, cand, time, costOf, budget);
    const t = time(lo);
    if (!best || t < best.time) best = { loadout: lo, time: t, cost: cost(lo, costOf) };
  }
  return best;
}

// One slot at a time, then whole sets, until nothing improves.
function improve(start, cand, time, costOf, budget) {
  let lo = { ...start }, cur = time(lo);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const s of SLOTS) {
      if (s === 'weapon' || (s === 'shield' && lo.weapon?.two)) continue;
      for (const c of [{ it: null }, ...cand[s]]) {
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
];

/**
 * The best setup for a target (one or more parts). Styles are optimised in order of how much of the
 * target they're allowed on; each later style gets the budget the earlier ones left.
 * Returns { kinds: {melee|ranged|magic: {loadout, time, cost}}, time, cost, thrall, perPart: [...] }.
 */
export function bestSetup(player, gear, target, monsters, avail, { reqs, budget = 0 } = {}) {
  const parts = target.parts.filter(p => monsters[p.monster]);
  if (!parts.length) return null;
  const variants = player.thrallOk ? [false, true] : [false];
  let best = null;
  for (const thrall of variants) {
    const pl = { ...player, thrall };
    const order = KINDS.map(k => ({ k, hp: parts.filter(p => !p.styles || p.styles.includes(k)).reduce((s, p) => s + p.weight * monsters[p.monster].hp, 0) }))
      .filter(x => x.hp > 0).sort((a, b) => b.hp - a.hp);
    const kinds = {};
    let left = budget;
    const bought = new Set();
    for (const { k } of order) {
      const kParts = parts.filter(p => !p.styles || p.styles.includes(k));
      // items already bought for another style are free here
      const av = it => bought.has(it) ? { owned: true, price: 0 } : avail(it);
      const r = optimiseKind(k, pl, gear, kParts, monsters, av, { reqs, budget: left });
      if (!r) continue;
      kinds[k] = r;
      for (const s of SLOTS) { const it = r.loadout[s]; if (it && !avail(it).owned && !bought.has(it)) { bought.add(it); left -= avail(it).price || 0; } }
    }
    // each part with its fastest style
    let total = 0;
    const perPart = parts.map(p => {
      const m = monsters[p.monster];
      let pick = null;
      for (const [k, r] of Object.entries(kinds)) {
        if (p.styles && !p.styles.includes(k)) continue;
        const c = bestCalc(pl, r.loadout, m, { styles: [k], toa: p.toa });
        const d = c.dps + (thrall ? THRALL_DPS : 0);
        if (d > 0 && (!pick || d > pick.dps)) pick = { kind: k, dps: d, calc: c };
      }
      const secs = pick ? p.weight * m.hp / pick.dps : Infinity;
      total += secs;
      return { ...p, name: m.name, ...pick, seconds: secs };
    });
    const used = new Set(perPart.map(p => p.kind).filter(Boolean));
    for (const k of Object.keys(kinds)) if (!used.has(k)) delete kinds[k];
    const res = { kinds, time: total, cost: budget - left, thrall, perPart };
    if (!best || res.time < best.time) best = res;
  }
  return best;
}
