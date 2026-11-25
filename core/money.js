// GP per hour for a boss setup: (loot per unit - supplies per unit) x units per hour.
// A unit is a kill, raid, run, casket... whatever the boss's `unit` says.
//
// Setup  { id, label, unitsPerHr, unitsPerTrip, requires, gear, supplies, flatCostPerUnit?,
//          raid?: { teamSize, raidLevel, mode, points }   raid settings this setup assumes
//          team?: { size }   team size for bosses with team-scaled loot (Nex, Hueycoatl...)
//          delve?: n         deepest delve per run (Doom of Mokhaiotl)
//          lootShare?: 0-1  share of the modelled loot you actually get, for bosses whose loot
//                           scales with contribution (e.g. Zalcano); default 1 }
// Supply { item, qty, per: 'unit' | 'trip' }   or a fixed-value line (spell casts, weapon charges):
//        { item: 'gp:<name>', label, gp, qty, per }  costing gp x qty
// Override (the user's changes, stored as a diff so untouched lines follow the defaults):
//   { unitsPerHr?, unitsPerTrip?, qty: {itemKey: n}, removed: [itemKey], added: [Supply] }

import { defaultRun } from './loot.js';

/**
 * Is a kill rate from core/rates.js good enough to list the boss as a money maker? Your kill rate stands in for
 * the guide's combat level requirements, but it only measures damage: survival and Defence aren't modelled.
 * So a boss you'd kill at under half the guide's rate isn't offered (you're well short of what it expects).
 */
export const MIN_VIABLE_FACTOR = 0.5;
export const viableRate = r => !!r && r.kph > 0 && r.factor >= MIN_VIABLE_FACTOR;

export function applyOverride(setup, o) {
  if (!o) return setup;
  const removed = new Set(o.removed || []);
  const supplies = setup.supplies
    .filter(s => !removed.has(s.item))
    .concat(o.added || [])
    .map(s => (o.qty && o.qty[s.item] != null ? { ...s, qty: o.qty[s.item] } : s));
  return {
    ...setup,
    unitsPerHr: o.unitsPerHr ?? setup.unitsPerHr,
    unitsPerTrip: o.unitsPerTrip ?? setup.unitsPerTrip,
    supplies,
    customised: true,
  };
}

/**
 * Supply cost per unit. Trip supplies are spread over unitsPerTrip.
 * Returns { perUnit, source: 'items' | 'flat' | 'none', missing: [itemKey] }
 *   missing: supplies with no price data (cost is understated until they're added)
 */
export function supplyCost(setup, items) {
  if (!setup.supplies.length) {
    return setup.flatCostPerUnit != null
      ? { perUnit: setup.flatCostPerUnit, source: 'flat', missing: [] }
      : { perUnit: 0, source: 'none', missing: [] };
  }
  const missing = [];
  let perUnit = 0;
  for (const s of setup.supplies) {
    const it = s.gp != null ? { price: s.gp } : items[s.item];
    if (!it) { missing.push(s.item); continue; }
    if (s.per === 'trip') {
      if (!setup.unitsPerTrip) { missing.push(s.item); continue; }
      perUnit += it.price * s.qty / setup.unitsPerTrip;
    } else {
      perUnit += it.price * s.qty;
    }
  }
  return { perUnit, source: 'items', missing };
}

// The boss with this setup's raid/team settings in place of the pet calculator's defaults
function withSettings(boss, setup) {
  if (setup.team?.size != null && boss.teamOption) boss = { ...boss, teamOption: { ...boss.teamOption, default: setup.team.size } };
  if (setup.delve != null && boss.delveOption) boss = { ...boss, delveOption: { ...boss.delveOption, defaultDelve: setup.delve } };
  const raid = setup.raid;
  if (!raid || !boss.raidOption) return boss;
  const R = { ...boss.raidOption };
  if (raid.teamSize != null) R.defaultTeamSize = raid.teamSize;
  if (raid.raidLevel != null) R.defaultRaidLevel = raid.raidLevel;
  if (raid.mode != null) R.defaultMode = raid.mode;
  if (raid.points != null) R.defaultPoints = { base: raid.points, perRaidLevel: 0 };
  return { ...boss, raidOption: R };
}

export const setupOf = (boss, id) => boss.setups.find(s => s.id === (id ?? boss.defaultSetup)) || boss.setups[0];

/** Everything the money page shows for one boss setup. `items` is the core items object. */
export function bossMethod(boss, items, { setupId, override } = {}) {
  const setup = applyOverride(setupOf(boss, setupId), override);
  const loot = defaultRun(withSettings(boss, setup), items).ev * (setup.lootShare ?? 1);
  const cost = supplyCost(setup, items);
  const unitsPerHr = setup.unitsPerHr || 0;
  return {
    bossId: boss.id, name: boss.name, unit: boss.unit, setup,
    lootPerUnit: loot, costPerUnit: cost.perUnit, costSource: cost.source, missing: cost.missing,
    profitPerUnit: loot - cost.perUnit, unitsPerHr,
    gpPerHr: (loot - cost.perUnit) * unitsPerHr,
  };
}

// Value of an {item, qty} list where lines may be fixed-value ({ gp, qty }) instead of items.
// Returns { value, missing } (missing = item keys with no price data).
export function listValue(list, items) {
  let value = 0; const missing = [];
  for (const x of list) {
    if (x.gp != null) value += x.gp * x.qty;
    else if (items[x.item]) value += items[x.item].price * x.qty;
    else missing.push(x.item);
  }
  return { value, missing };
}

/**
 * A Wiki-guide method (data/methods.json): inputs and outputs are already per hour.
 *
 * Realistic cap: inputs you buy are limited by Grand Exchange buy limits (per 4 hours), and,
 * if `cash` is given (the cash stack on My Account; 0 means nothing to spend), by what you can afford to buy in an hour.
 * When either bites, the method runs at that fraction of the guide's rate for the hour.
 * Returns the capped figures plus { scale, cappedBy: 'buy limit' | 'cash' | null, capNote }.
 */
export function guideMethod(m, items, { cash } = {}) {
  const out = listValue(m.outputsPerHr, items), inp = listValue(m.inputsPerHr, items);
  let scale = 1, cappedBy = null, capNote = null;
  for (const x of m.inputsPerHr) {
    const lim = x.gp == null ? items[x.item]?.limit : null;
    if (lim && x.qty > lim / 4) {
      const s = (lim / 4) / x.qty;
      if (s < scale) { scale = s; cappedBy = 'buy limit'; capNote = `${items[x.item].name}: buy limit ${lim.toLocaleString('en-GB')} per 4 hours, guide uses ${Math.round(x.qty).toLocaleString('en-GB')} an hour`; }
    }
  }
  if (cash != null && cash >= 0 && inp.value * scale > cash) {
    scale = inp.value ? cash / inp.value : 0; cappedBy = 'cash';
    capNote = `Supplies cost ${Math.round(inp.value).toLocaleString('en-GB')} gp an hour; your cash stack is ${Math.round(cash).toLocaleString('en-GB')} gp`;
  }
  return { methodId: m.id, name: m.name, method: m,
           lootPerHr: out.value * scale, costPerHr: inp.value * scale, gpPerHr: (out.value - inp.value) * scale,
           uncappedGpPerHr: out.value - inp.value, scale, cappedBy, capNote,
           missing: [...out.missing, ...inp.missing] };
}

/**
 * A setup's gear with what the account already owns. Each entry is an item key or a list of keys that count
 * as equal; owning any covers it, otherwise it's priced at the first.
 * Returns { lines: [{ keys, names, price, owned }], total, toBuy }.
 */
export function gearList(setup, items, account) {
  const have = k => Math.max(account?.owned?.[k] || 0, account?.bank?.[k] || 0);
  const lines = (setup.gear || []).map(g => {
    const { keys, qty } = gearEntry(g);
    const c = gearCost(g, items, have);
    return { keys, qty, names: keys.map(k => items[k]?.name || k), price: c.full, toBuy: c.toBuy, owned: keys.reduce((t, k) => t + have(k), 0) >= qty };
  });
  return { lines, total: lines.reduce((t, l) => t + l.price, 0), toBuy: lines.reduce((t, l) => t + l.toBuy, 0) };
}

/** A gear entry: an item key, a list of equal keys, or { item: key | [keys], qty } (e.g. 200 bolts). */
export function gearEntry(g) {
  if (g && typeof g === 'object' && !Array.isArray(g)) return { keys: [].concat(g.item), qty: g.qty || 1 };
  return { keys: [].concat(g), qty: 1 };
}

/** Full price of an entry and what's left to buy, given have(key) -> quantity owned. Equal keys pool together. */
export function gearCost(g, items, have) {
  const { keys, qty } = gearEntry(g);
  const price = items[keys[0]]?.price || 0;
  const owned = keys.reduce((t, k) => t + (have(k) || 0), 0);
  return { full: price * qty, toBuy: price * Math.max(0, qty - owned) };
}
