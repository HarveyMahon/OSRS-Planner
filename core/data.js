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

export async function loadBosses() {
  return structuredClone(await loadJson('bosses.json'));
}

export async function loadMethods() {
  return structuredClone(await loadJson('methods.json'));
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
