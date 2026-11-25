// The DPS calculator's saved state: { target, part, onTask, thrall, levels: {Skill: level}, loadouts: [{ name, slots: {slot: item name}, style }] }
const KEY = 'osrsplanner:dps';
export function loadDps() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
export function saveDps(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage unavailable */ } }
