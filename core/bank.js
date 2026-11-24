// Bank import: the "export" from the Bank Memory RuneLite plugin (tab-separated: Item id, Item name, Item quantity).
// Items are matched to the planner's item keys by ID, then by name, treating cosmetic or charged variants
// (Infernal cape (l), Twisted ancestral robe top, Amulet of rancour (s)...) as the item they're based on.

const COINS = '995', PLATINUM = '13204';

/** Rows of { id, name, qty } from pasted text; header and junk lines are skipped. */
export function parseBank(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const cols = line.split('\t').map(c => c.trim());
    if (cols.length < 3) continue;
    const [id, name, q] = cols;
    const qty = Number(q.replace(/[, ]/g, ''));
    if (!/^\d+$/.test(id) || !Number.isFinite(qty) || qty <= 0) continue;
    rows.push({ id, name, qty });
  }
  return rows;
}

// "Infernal cape (l)" -> "infernal cape"; "Twisted ancestral robe top" -> "ancestral robe top"
export function baseName(name) {
  return String(name).toLowerCase()
    .replace(/^blessed (?=dizana)/, '')
    .replace(/^twisted (?=ancestral)/, '')
    .replace(/\s*\((l|or|s|ri|cr|bh|deadman)\)$/, m => m.includes('ri') ? ' (i)' : '')
    .replace(/\(p\+{0,2}\)$/, '')
    .replace(/[’']/g, "'").trim();
}

/**
 * Match rows to item keys. Returns { bank: {key: qty}, gp, matched, total } where gp is the coins
 * (and platinum tokens) in the bank, or null if there were none.
 */
export function resolveBank(rows, items, tiers = { groups: [] }) {
  const byName = new Map();
  for (const [k, it] of Object.entries(items)) {
    for (const n of [it.name, ...(it.aliases || [])]) if (n) {
      const b = baseName(n);
      // prefer the item whose own name is the base name, then a real ID over an x- key
      const exact = n.toLowerCase() === b, prev = byName.get(b);
      if (!prev || (exact && !prev.exact) || (exact === prev.exact && prev.key.startsWith('x-') && !k.startsWith('x-'))) byName.set(b, { key: k, exact });
    }
  }
  const bank = {};
  let gp = null, matched = 0;
  const owned = new Set();     // base names of everything in the bank, for upgrade tiers
  for (const r of rows) {
    if (r.id === COINS) { gp = (gp || 0) + r.qty; continue; }
    if (r.id === PLATINUM) { gp = (gp || 0) + r.qty * 1000; continue; }
    const base = baseName(r.name);
    owned.add(base);
    // by ID, and by base name too (Dragon dagger(p++) is its own item but also counts as a Dragon dagger)
    const keys = [...new Set([items[r.id] ? r.id : null, byName.get(base)?.key].filter(Boolean))];
    if (!keys.length) continue;
    for (const key of keys) bank[key] = (bank[key] || 0) + r.qty;
    matched++;
  }
  for (const k of upgradesCovered(owned, tiers)) {
    const key = byName.get(k)?.key;
    if (key) bank[key] = Math.max(bank[key] || 0, 1);
  }
  return { bank, gp, matched, total: rows.length };
}

/**
 * Base names of the items an owned set covers through upgrade tiers (data/gear-tiers.json): owning an item
 * counts as owning every item in a worse tier of the same group (one slot and combat style).
 */
export function upgradesCovered(ownedBaseNames, tiers) {
  const out = new Set();
  for (const g of tiers.groups || []) {
    const best = g.tiers.findIndex(t => t.some(n => ownedBaseNames.has(baseName(n))));
    if (best < 0) continue;
    for (const t of g.tiers.slice(best + 1)) for (const n of t) out.add(baseName(n));
  }
  return out;
}
