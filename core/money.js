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

/** A Wiki-guide method (data/methods.json): inputs and outputs are already per hour. */
export function guideMethod(m, items) {
  const out = listValue(m.outputsPerHr, items), inp = listValue(m.inputsPerHr, items);
  return { methodId: m.id, name: m.name, method: m, lootPerHr: out.value, costPerHr: inp.value,
           gpPerHr: out.value - inp.value, missing: [...out.missing, ...inp.missing] };
}
