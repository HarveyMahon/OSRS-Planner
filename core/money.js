// GP per hour for a boss setup: (loot per unit - supplies per unit) x units per hour.
// A unit is a kill, raid, run, casket... whatever the boss's `unit` says.
//
// Setup  { id, label, unitsPerHr, unitsPerTrip, requires, gear, supplies, flatCostPerUnit?,
//          raid?: { teamSize, raidLevel, mode, points }   raid settings this setup assumes
//          lootShare?: 0-1  share of the modelled loot you actually get, for bosses whose loot
//                           scales with contribution (e.g. Zalcano); default 1 }
// Supply { item, qty, per: 'unit' | 'trip' }
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
    const it = items[s.item];
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

// The boss with this setup's raid settings in place of the pet calculator's defaults
function withRaidSettings(boss, raid) {
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
  const loot = defaultRun(withRaidSettings(boss, setup.raid), items).ev * (setup.lootShare ?? 1);
  const cost = supplyCost(setup, items);
  const unitsPerHr = setup.unitsPerHr || 0;
  return {
    bossId: boss.id, name: boss.name, unit: boss.unit, setup,
    lootPerUnit: loot, costPerUnit: cost.perUnit, costSource: cost.source, missing: cost.missing,
    profitPerUnit: loot - cost.perUnit, unitsPerHr,
    gpPerHr: (loot - cost.perUnit) * unitsPerHr,
  };
}
