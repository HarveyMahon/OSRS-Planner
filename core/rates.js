// Your kill rates: each boss setup's kills/hr scaled by how fast YOU kill it compared with the Wiki guide.
//
// The guide's time per kill (3600 / its kills per hour) = fighting + everything else (banking, walking,
// phases). Fighting is the guide's gear and the guide's recommended levels through the DPS calculator; the rest
// stays the same for you. Your fighting time comes from your best setup (your bank plus your cash stack).
//   your time per kill = (guide time - guide fight) + your fight;   your kills/hr = 3600 / that.
// Results are cached per account (levels, prayers, quests, bank, cash) in this browser.

import { loadGear, loadTargets, loadMonsters, availability, accountPlayer, idsOf } from './gear.js';
import { bestSetup } from './best-setup.js';
import { levelForXp, xpForLevel } from './xp.js';

const KEY = 'osrsplanner:rates';
const VERSION = 33;
const COMBAT = ['Attack', 'Strength', 'Defence', 'Ranged', 'Magic', 'Hitpoints', 'Prayer'];
const GUIDE_DEFAULT_LEVEL = 90;          // combat levels a guide doesn't list
const MAX_FIGHT_SHARE = 0.8;             // the guide's fight is at most this share of its time per kill
const MAX_FACTOR = 2, MIN_FACTOR = 0.2;  // how far your kill rate can move from the guide's

function skillReqs(req, out = {}) {
  if (!req) return out;
  if (req.all) req.all.forEach(r => skillReqs(r, out));
  if (req.any) { const s = req.any.find(r => r.skill); if (s) skillReqs(s, out); }
  if (req.skill) out[req.skill] = Math.max(out[req.skill] || 0, req.level);
  return out;
}

/** Requirements without the combat-skill levels (which your kill rate now stands in for). */
export function withoutCombatLevels(req) {
  if (!req) return req;
  if (req.all) return { all: req.all.map(withoutCombatLevels).filter(Boolean) };
  if (req.any) { const any = req.any.map(withoutCombatLevels); return any.some(r => r == null) ? null : { any }; }
  if (req.skill && COMBAT.includes(req.skill)) return null;
  return req;
}

/** The player a guide assumes: its recommended levels, 90 in the combat skills it doesn't list, the usual prayers. */
export function guidePlayer(setup) {
  const lv = skillReqs(setup.requires);
  const levels = Object.fromEntries(COMBAT.map(s => [s, Math.max(lv[s] || 0, GUIDE_DEFAULT_LEVEL)]));
  return { levels, prayers: new Set(['piety', 'rigour', 'augury']), quests: new Set(['desert_treasure_i']),
    diaries: new Set(['kandarin:hard']), hearts: 'imbued', onTask: false, thrall: false, thrallOk: false };
}

const fingerprint = (account, gp) => JSON.stringify([VERSION, new Date().toISOString().slice(0, 10), COMBAT.map(s => levelForXp(account.xp?.[s] || 0)), account.prayers || [], account.dharokHp ?? null,
  Object.keys(account.quests || {}).sort(), account.diaries || [], account.bankImportedAt || '', Object.keys(account.owned || {}).length, gp]);

// Seconds per kill including downtime, from the fastest guide rate: spec energy for repeated kills is what
// regenerates over one of these (whole raids still start each run with a full bar).
const killCycle = b => { const k = Math.max(0, ...b.setups.map(s => s.unitsPerHr || 0)); return k ? 3600 / k : null; };
const teamSize = (s, b) => s.team?.size || s.raid?.teamSize || b.raidOption?.defaultTeamSize || b.teamOption?.default || 1;

/**
 * Rates for every boss with DPS data: { bossId: { best, fight, setups: { setupId: { guideFight, kph, factor } } } }.
 * onProgress(done, total) is called as bosses finish; work yields to the page between bosses.
 */
export async function accountRates(account, bosses, items, { onProgress, budget } = {}) {
  const gp = budget ?? account.gp ?? 0;
  const fp = fingerprint(account, gp);
  try { const c = JSON.parse(localStorage.getItem(KEY)); if (c?.fp === fp) return c.rates; } catch { /* no cache */ }
  const [gear, targets, monsters, { avail }] = await Promise.all([loadGear(), loadTargets(), loadMonsters(), availability(account)]);
  const player = accountPlayer(account);
  const byId = new Map();
  for (const list of Object.values(gear)) for (const it of list) for (const i of idsOf(it)) if (!byId.has(i)) byId.set(i, it);
  const list = bosses.filter(b => targets[b.id]?.parts?.length && b.setups?.length);
  const rates = {};
  let done = 0;
  for (const b of list) {
    await new Promise(r => setTimeout(r, 0));
    const t = targets[b.id];
    const pl = b.taskOnly ? { ...player, onTask: true } : player;      // task-only bosses are always on task
    // the guide's own setups first: each has a fixed kill cycle (3600 / its kills per hour), so its spec energy
    // per kill is what regenerates over that; the fastest one also gives the downtime between kills (cycle minus
    // fight), which is the same for you: your energy per kill is what regenerates over that downtime plus your fight
    const guides = [];
    for (const s of b.setups) {
      if (!s.unitsPerHr) continue;
      const guideGear = guideItems(s, items, byId);
      if (!guideGear.size) continue;          // no gear list: can't tell how fast the guide kills
      const per = 3600 / s.unitsPerHr, n = teamSize(s, b);
      const g = bestSetup({ ...guidePlayer(s), onTask: !!b.taskOnly }, gear, t, monsters, it => guideGear.has(it) ? { owned: true, price: 0 } : { owned: false, price: null }, { budget: 0, fast: true, cycle: per });
      if (!g || !isFinite(g.time)) continue;
      guides.push({ s, per, n, guideFight: Math.min(g.time / n, per * MAX_FIGHT_SHARE) });
    }
    const fastest = guides.sort((a, c) => a.per - c.per)[0];
    const cycle = killCycle(b);
    const downtime = fastest ? fastest.per - fastest.guideFight : cycle ? cycle * (1 - MAX_FIGHT_SHARE) : null;
    const mine = bestSetup(pl, gear, t, monsters, avail, { budget: gp, fast: true, downtime, team: fastest?.n || 1 });
    const r = { fight: mine?.time ?? Infinity, cost: mine?.cost ?? 0, setups: {},
      buy: mine ? [...new Set(Object.values(mine.kinds).flatMap(k => Object.values(k.loadout)).filter(it => it && !avail(it).owned).map(it => it.name))] : [] };
    for (const { s, per, n, guideFight } of guides) {
      const myFight = r.fight / n;
      const raw = isFinite(myFight) ? 3600 / (per - guideFight + myFight) / s.unitsPerHr : 0;
      const factor = raw ? Math.max(MIN_FACTOR, Math.min(MAX_FACTOR, raw)) : 0;
      r.setups[s.id] = { guideFight, myFight, factor, kph: factor * s.unitsPerHr, capped: raw !== factor && raw > 0 };
    }
    rates[b.id] = r;
    onProgress?.(++done, list.length);
  }
  try { localStorage.setItem(KEY, JSON.stringify({ fp, rates })); } catch { /* storage full */ }
  return rates;
}

// The DPS-table items for a setup's gear list (keys or lists of equal keys), matched by item ID then name.
function guideItems(setup, items, byId) {
  const out = new Set();
  const byName = new Map();
  for (const g of setup.gear || []) {
    for (const k of [].concat(typeof g === 'object' && !Array.isArray(g) ? g.item : g)) {
      const it = items[k];
      const id = it?.id ? String(it.id) : /^\d+$/.test(k) ? k : null;
      let gi = id && byId.get(id);
      if (!gi && it?.name) {
        if (!byName.size) for (const x of byId.values()) byName.set(x.name.toLowerCase(), x);
        gi = byName.get(it.name.toLowerCase());
      }
      if (gi) out.add(gi);
    }
  }
  return out;
}

/**
 * A synchronous rate function for the planner's kill-count steps, at the levels the plan has reached:
 * rateAt(boss, setup, xp) -> { kph, factor, myFight, guideFight } or null. Loads the data up front.
 */
export async function rateContext(account, items, { budget } = {}) {
  const gp = budget ?? account.gp ?? 0;
  const [gear, targets, monsters, { avail }] = await Promise.all([loadGear(), loadTargets(), loadMonsters(), availability(account)]);
  const byId = new Map();
  for (const list of Object.values(gear)) for (const it of list) for (const i of idsOf(it)) if (!byId.has(i)) byId.set(i, it);
  const mine = new Map(), guide = new Map();
  return (b, s, xp) => {
    const t = targets[b.id];
    if (!t?.parts?.length || !s.unitsPerHr) return null;
    let g = guide.get(`${b.id}:${s.id}`);
    if (g === undefined) {
      const set = guideItems(s, items, byId);
      g = set.size ? bestSetup({ ...guidePlayer(s), onTask: !!b.taskOnly }, gear, t, monsters, it => set.has(it) ? { owned: true, price: 0 } : { owned: false, price: null }, { budget: 0, fast: true, cycle: 3600 / s.unitsPerHr })?.time ?? null : null;
      guide.set(`${b.id}:${s.id}`, g);
    }
    if (!g || !isFinite(g)) return null;
    // levels rounded down to a multiple of 5, so a long plan only works out a few states per boss
    // (your current level and 99 are kept as they are)
    const q = COMBAT.map(k => { const l = levelForXp(xp?.[k] || 0); return l >= 99 || l === levelForXp(account.xp?.[k] || 0) ? l : Math.max(1, Math.floor(l / 5) * 5); });
    const lv = q.join(',');
    const acc = { ...account, xp: { ...xp, ...Object.fromEntries(COMBAT.map((k, i) => [k, xpForLevel(q[i])])) } };
    const per = 3600 / s.unitsPerHr, n = teamSize(s, b);
    const guideFight = Math.min(g / n, per * MAX_FIGHT_SHARE);
    let f = mine.get(`${b.id}:${s.id}:${lv}`);           // (energy per kill uses this setup's downtime)
    if (f === undefined) { f = bestSetup(accountPlayer(acc, { onTask: !!b.taskOnly }), gear, t, monsters, avail, { budget: gp, fast: true, downtime: per - guideFight, team: n })?.time ?? Infinity; mine.set(`${b.id}:${s.id}:${lv}`, f); }
    const myFight = f / n;
    const raw = isFinite(myFight) ? 3600 / (per - guideFight + myFight) / s.unitsPerHr : 0;
    const factor = raw ? Math.max(MIN_FACTOR, Math.min(MAX_FACTOR, raw)) : 0;
    return { guideFight, myFight, factor, kph: factor * s.unitsPerHr, capped: raw !== factor && raw > 0 };
  };
}
