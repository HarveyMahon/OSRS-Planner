// Shared data layer. Every tab loads game data through here, never by fetching files itself.
//
// Items are keyed by OSRS item ID as a string ("4151"), or "x-<name>" for items with no
// Grand Exchange ID. Everything else (bosses, methods, quests) refers to items by that key.

const BASE = new URL('../data/', import.meta.url);
const cache = new Map();

async function loadJson(file) {
  if (!cache.has(file)) {
    cache.set(file, fetch(new URL(file, BASE), { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(file);
}

// Items with derived prices (e.g. Tokkul = Uncut onyx / 260,000) are priced from other items.
function applyDerived(items) {
  for (const it of Object.values(items)) {
    const f = it.derivedFrom;
    if (!f) continue;
    if (f.terms) {
      if (f.terms.every(t => items[t.item])) it.price = Math.max(0, f.terms.reduce((s, t) => s + items[t.item].price * t.factor, 0));
    } else if (items[f.item]) {
      it.price = items[f.item].price / f.divisor;
    }
  }
}

export async function loadItems() {
  const d = structuredClone(await loadJson('items.json'));
  applyDerived(d.items);
  const byName = new Map();
  for (const [key, it] of Object.entries(d.items)) {
    it.key = key;
    for (const n of [it.name, ...(it.aliases || [])]) byName.set(n.toLowerCase(), it);
  }
  return {
    meta: d.meta,
    items: d.items,
    get: key => d.items[key],
    byName: name => byName.get(String(name).toLowerCase()),
    price: key => d.items[key]?.price ?? 0,
  };
}

// Hand corrections (data/corrections.json) on top of the built data
const corrections = () => loadJson('corrections.json').catch(() => ({}));
export function applyCorrections(doc, fix, kind) {
  for (const x of doc[kind] || []) {
    const c = fix?.[kind]?.[x.id];
    if (!c) continue;
    if (kind === 'methods') Object.assign(x, c);
    else for (const s of x.setups || []) s.requires = s.requires ? { all: [s.requires, c.requires] } : c.requires;
  }
  return doc;
}

export async function loadBosses() {
  const [d, manual, items, tiers, fix] = await Promise.all([loadJson('bosses.json'), loadJson('setup-gear.json').catch(() => null),
    loadJson('items.json'), loadJson('gear-tiers.json').catch(() => null), corrections()]);
  const out = applyCorrections(applySetupGear(structuredClone(d), manual), fix, 'bosses');
  for (const b of out.bosses) for (const s of b.setups || []) if (!s.gearSource && s.gear) s.gear = cleanGuideGear(s.gear, items.items, tiers);
  return out;
}

// Gear lists taken from money-making guides mix in consumables and list upgrades side by side
// (Fire cape and Infernal cape). Drop the consumables (they're supplies) and merge items from the same
// upgrade group into one entry that either item covers, cheapest first.
const EQUAL = { 'x-infernal-cape': 'x-fire-cape', 'x-dizana-s-quiver': 'x-ava-s-assembler' };
const CONSUMABLE = /\b(rune|runes|dart|darts|bolts|bolts \(e\)|arrows?|javelin|knife)$|^(shark|monkfish|anglerfish|cooked karambwan|manta ray|blighted manta ray|chocolate bomb|lobster|swordfish)$/i;
export function cleanGuideGear(gear, items, tiers) {
  const name = k => items[k]?.name || '';
  const groupOf = k => (tiers?.groups || []).findIndex(g => g.tiers.some(t => t.some(n => n.toLowerCase() === name(k).toLowerCase())));
  const out = [], byGroup = new Map();
  for (const g of gear) {
    const keys = [].concat(g).filter(k => !CONSUMABLE.test(name(k).replace(/\s*\(e\)$/, '')));
    if (!keys.length) continue;
    const grp = keys.length === 1 ? groupOf(keys[0]) : -1;
    if (grp >= 0 && byGroup.has(grp)) { byGroup.get(grp).push(keys[0]); continue; }
    const entry = [...keys];
    if (grp >= 0) byGroup.set(grp, entry);
    out.push(entry);
  }
  // earned items the user treats as equal to their easier versions
  for (const e of out) for (const [k, eq] of Object.entries(EQUAL)) if (e.includes(k) && !e.includes(eq) && items[eq]) e.push(eq);
  return out.map(e => e.length === 1 ? e[0] : [...e].sort((a, b) => (items[a]?.price || 0) - (items[b]?.price || 0)));
}

// Hand-checked gear (data/setup-gear.json) over the generated setups: replaces gear, drops listed supplies
export function applySetupGear(d, manual) {
  for (const [bossId, setups] of Object.entries(manual?.setups || {})) {
    const boss = d.bosses.find(b => b.id === bossId);
    for (const [setupId, m] of Object.entries(setups)) {
      let s = boss?.setups?.find(x => x.id === setupId);
      if (!s && m.copyOf) {                       // a new setup made from another (e.g. Budget from High level)
        const from = boss?.setups?.find(x => x.id === m.copyOf);
        if (from) { s = { ...structuredClone(from), id: setupId, label: m.label || setupId }; boss.setups.push(s); }
      }
      if (!s) continue;
      if (m.label) s.label = m.label;
      if (m.gear) { s.gear = m.gear; s.gearSource = m.source; }
      if (m.noGear) s.noGear = true;
      if (m.set) Object.assign(s, m.set);          // hand-set rates (unitsPerHr, lootShare, ...)
      if (m.dropSupplies) s.supplies = (s.supplies || []).filter(x => !m.dropSupplies.includes(x.item));
    }
  }
  for (const [bossId, flags] of Object.entries(manual?.bosses || {})) Object.assign(d.bosses.find(b => b.id === bossId) || {}, flags);
  return d;
}

export async function loadMethods() {
  const [d, fix] = await Promise.all([loadJson('methods.json'), corrections()]);
  return applyCorrections(structuredClone(d), fix, 'methods');
}

export async function loadTraining() {
  return structuredClone(await loadJson('training.json'));
}

export async function loadQuests() {
  return structuredClone(await loadJson('quests.json'));
}

// Raw access for tab-specific files (e.g. the pet calculator's skilling-pets.json)
export async function loadFile(file) {
  return structuredClone(await loadJson(file));
}

// Value of a list of {item, qty} at current prices
export const valueOf = (items, list) => list.reduce((s, x) => s + items.price(x.item) * x.qty, 0);
