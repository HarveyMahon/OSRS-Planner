// The user's own changes to a boss setup, kept in this browser (localStorage) as a diff.
// Keys: "osrsplanner:override:<bossId>:<setupId>". Storage can be unavailable or cleared,
// so every read and write is guarded and falls back to "no override".

const PREFIX = 'osrsplanner:override:';
const keyOf = (bossId, setupId) => `${PREFIX}${bossId}:${setupId}`;

export function getOverride(bossId, setupId) {
  try { return JSON.parse(localStorage.getItem(keyOf(bossId, setupId))) || null; } catch { return null; }
}

export function setOverride(bossId, setupId, o) {
  const empty = !o || (o.unitsPerHr == null && o.unitsPerTrip == null && !Object.keys(o.qty || {}).length
    && !(o.removed || []).length && !(o.added || []).length);
  try {
    if (empty) localStorage.removeItem(keyOf(bossId, setupId));
    else localStorage.setItem(keyOf(bossId, setupId), JSON.stringify(o));
  } catch { /* storage unavailable: the change lasts until the page closes */ }
}

export const resetOverride = (bossId, setupId) => setOverride(bossId, setupId, null);

// Small helpers that return a new override with one change applied
export const withQty = (o, item, qty) => ({ ...o, qty: { ...(o?.qty || {}), [item]: qty } });
export const withRemoved = (o, item) => ({ ...o, removed: [...new Set([...(o?.removed || []), item])],
  added: (o?.added || []).filter(s => s.item !== item) });
export const withAdded = (o, supply) => ({ ...o, added: [...(o?.added || []).filter(s => s.item !== supply.item), supply],
  removed: (o?.removed || []).filter(i => i !== supply.item) });
