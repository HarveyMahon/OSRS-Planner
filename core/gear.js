// The DPS calculator's gear: the per-slot tables (data/gear/<slot>.json), their prices, and which items
// an account owns (from its bank import, by item ID, and items ticked or matched by the planner).

import { loadFile, loadItems } from './data.js';
import { levelForXp } from './xp.js';
import { playerFromAccount } from './dps.js';

export const TABLES = ['head', 'cape', 'neck', 'ammo', 'weapon', '2h', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'];
export const AMMO_QTY = 200;
const IMBUED_HEART = '20724', SATURATED_HEART = '27641';

let gearPromise = null;
/** { slot: [items] } for every table; two-handed weapons have two: true. */
export function loadGear() {
  if (!gearPromise) gearPromise = Promise.all(TABLES.map(t => loadFile(`gear/${t}.json`).then(d => [t, d.items.map(x => ({ ...x, slot: t, ...(t === '2h' ? { two: true } : {}) }))])))
    .then(Object.fromEntries);
  return gearPromise;
}
export async function loadGearPrices() { return (await loadFile('gear-prices.json').catch(() => ({ prices: {} }))).prices; }
export async function loadTargets() { return (await loadFile('dps-targets.json')).targets; }
export async function loadMonsters() { return (await loadFile('dps-monsters.json')).monsters; }

export const idsOf = it => [it.id, ...(it.ids || []), ...(it.alt || [])].map(String);

/**
 * avail(item) -> { owned, price } for an account: owned if any of the item's IDs is in the bank import
 * (or the planner's owned / bank item keys), price = the cheapest tradeable version, null if untradeable.
 */
// Untradeables you earn rather than buy (Wiki): only counted when you meet what it takes
const EARNABLE = [
  { re: /^Imbued (Saradomin|Guthix|Zamorak) cape$/, req: { Magic: 75 }, how: 'Mage Arena II' },   // first imbue in Mage Arena II, then 250K from Perdu
];

export async function availability(account) {
  const [prices, items] = await Promise.all([loadGearPrices(), loadItems()]);
  const owned = new Set(Object.keys(account.bankIds || {}));
  for (const k of [...Object.keys(account.owned || {}), ...Object.keys(account.bank || {})]) {
    const it = items.get(k);
    if (it?.id) owned.add(String(it.id)); else if (/^\d+$/.test(k)) owned.add(k);
  }
  const memo = new Map();
  const avail = it => {
    if (!it) return { owned: true, price: 0 };
    let r = memo.get(it);
    if (!r) {
      const ids = idsOf(it);
      const ps = ids.map(i => prices[i]).filter(p => typeof p === 'number');
      // ammo is bought in a stack (200, as the planner's setups count it)
      r = { owned: ids.some(i => owned.has(i)), price: ps.length ? Math.min(...ps) * (it.slot === 'ammo' ? AMMO_QTY : 1) : null };
      // untradeables you can earn and don't have yet: free to get once you meet the requirement
      const e = !r.owned && r.price == null && EARNABLE.find(x => x.re.test(it.name));
      if (e && Object.entries(e.req).every(([sk, l]) => levelForXp(account.xp?.[sk] || 0) >= l)) r = { owned: false, price: 0, earn: e.how };
      memo.set(it, r);
    }
    return r;
  };
  return { avail, owned };
}

/** The DPS player for an account (levels, prayers, quests, diaries, heart from the bank). */
export function accountPlayer(account, opts = {}) {
  const bank = account.bankIds || {};
  const hearts = bank[SATURATED_HEART] ? 'saturated' : bank[IMBUED_HEART] ? 'imbued' : null;
  return playerFromAccount(account, (a, s) => levelForXp(a.xp?.[s] || 0), { hearts, ...opts });
}
