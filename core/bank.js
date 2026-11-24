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
    .replace(/[’']/g, "'").trim();
}

// Owning the item on the left counts as owning the ones on the right (an upgrade that replaces them in a setup)
const COUNTS_AS = {
  'infernal cape': ['fire cape'],
  'avernic treads (max)': ['avernic treads', 'primordial boots', 'pegasian boots', 'eternal boots'],
  'amulet of rancour': ['amulet of torture'],
  'ring of suffering (i)': ['ring of suffering'],
  'saturated heart': ['imbued heart'],
  'dragon dagger(p++)': ['dragon dagger'], 'dragon dagger(p+)': ['dragon dagger'], 'dragon dagger(p)': ['dragon dagger'],
  'twisted slayer helmet (i)': ['slayer helmet (i)'], 'black slayer helmet (i)': ['slayer helmet (i)'],
};

/**
 * Match rows to item keys. Returns { bank: {key: qty}, gp, matched, total } where gp is the coins
 * (and platinum tokens) in the bank, or null if there were none.
 */
export function resolveBank(rows, items) {
  const byName = new Map();
  for (const [k, it] of Object.entries(items)) {
    for (const n of [it.name, ...(it.aliases || [])]) if (n) {
      const b = baseName(n);
      if (!byName.has(b) || !k.startsWith('x-')) byName.set(b, k);   // prefer a real ID over an x- key
    }
  }
  const bank = {};
  let gp = null, matched = 0;
  for (const r of rows) {
    if (r.id === COINS) { gp = (gp || 0) + r.qty; continue; }
    if (r.id === PLATINUM) { gp = (gp || 0) + r.qty * 1000; continue; }
    const base = baseName(r.name);
    const key = items[r.id] ? r.id : byName.get(base);
    for (const k of (COUNTS_AS[base] || []).map(n => byName.get(n)).filter(Boolean)) bank[k] = Math.max(bank[k] || 0, 1);
    if (!key) continue;
    bank[key] = (bank[key] || 0) + r.qty;
    matched++;
  }
  return { bank, gp, matched, total: rows.length };
}
