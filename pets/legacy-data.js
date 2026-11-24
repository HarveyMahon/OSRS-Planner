// Adapter: the pet calculator was written against one bosses.json with items keyed by NAME.
// The app's shared data is keyed by item ID, so this rebuilds the old shape from core data.
// New features should use core/data.js directly, not this.

import { loadItems, loadBosses, loadFile } from '../core/data.js';
import { supplyCost } from '../core/money.js';

const REF_FIELDS = new Set(['item', 'cape', 'seed', 'splinterItem', 'rationItem', 'secateursItem', 'log', 'leaves']);
const REF_LISTS = new Set(['items']);
// Objects whose KEYS are item references (ToA unique weights); other keys (e.g. raidLevel) pass through
const REF_KEYED = new Set(['uniqueFixedWeights', 'uniqueMinRaidLevel', 'uniqueWeightAnchors']);
const rekey = (o, nameOf) => Object.fromEntries(Object.entries(o).map(([k, v]) => [nameOf(k), v]));

function toNames(o, nameOf) {
  if (Array.isArray(o)) { o.forEach(v => toNames(v, nameOf)); return; }
  if (!o || typeof o !== 'object') return;
  for (const [f, v] of Object.entries(o)) {
    if (REF_KEYED.has(f) && v && typeof v === 'object') o[f] = Array.isArray(v) ? v.map(x => rekey(x, nameOf)) : rekey(v, nameOf);
    else if (REF_FIELDS.has(f) && typeof v === 'string') o[f] = nameOf(v);
    else if (REF_LISTS.has(f) && Array.isArray(v) && v.every(x => typeof x === 'string')) o[f] = v.map(nameOf);
    else toNames(v, nameOf);
  }
}

export async function loadPetData() {
  const [items, bosses, pets] = await Promise.all([loadItems(), loadBosses(), loadFile('skilling-pets.json')]);
  const nameOf = key => items.get(key)?.name ?? key;

  // Items by name (aliases included), without the core-only fields
  const byName = {};
  for (const it of Object.values(items.items)) {
    const { key, name, aliases, ...rest } = it;
    if (rest.derivedFrom) { rest.derivedFrom = structuredClone(rest.derivedFrom); toNames(rest.derivedFrom, nameOf); }
    for (const n of [name, ...(aliases || [])]) byName[n] = rest;
  }
  // Bosses added for the money pages only (e.g. built from a guide, no pet data)
  bosses.bosses = bosses.bosses.filter(b => b.petCalc !== false);
  // The pet calculator predates setups: give it the default setup's rate and its supply cost
  // per unit as one flat figure (supplies can include fixed-value lines it can't price itself)
  for (const b of bosses.bosses) {
    const s = b.setups.find(x => x.id === b.defaultSetup) || b.setups[0];
    b.defaultKph = s.unitsPerHr; b.kphSource = s.unitsPerHrSource; b.costSource = s.costSource;
    const cost = supplyCost(s, items.items);
    if (cost.source !== 'none') b.defaultCost = cost.perUnit;
    delete b.setups; delete b.defaultSetup; delete b.moneyMaker; delete b.moneyMakerNote;
  }
  toNames(bosses.bosses, nameOf);
  toNames(pets.skillingPets, nameOf);

  return {
    meta: { ...bosses.meta, ...items.meta },
    items: byName,
    bosses: bosses.bosses,
    skillingPets: pets.skillingPets,
  };
}
