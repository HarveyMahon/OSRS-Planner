// Slayer model: expected Slayer XP, GP and points per hour for a Slayer master, given the account, the
// task list choices (do / skip / block, extend, method per task) and settings.
//
// Data: data/slayer.json, built from KodakKid3's OSRS Slayer Spreadsheets (task rates, methods, weights,
// lengths) and the OSRS Wiki (task requirements, masters' points and block costs).
//
// One assignment is a weighted draw over the master's tasks the account can get (blocked tasks and tasks
// it hasn't the requirements for are never drawn). A task you do takes its kills / kills per hour plus
// travel; a task you skip only costs the time to get a new one and 30 points.

import { levelForXp } from './xp.js';
import { combatLevel } from './requirements.js';

const lvl = (acc, s) => levelForXp(acc.xp?.[s] || 0);
const quest = (acc, q) => acc.quests?.[q] === 'complete';

/** Settings with defaults. */
export function slayerSettings(s = {}) {
  return { master: 'auto', goal: 'xp', intensity: null, bracelet: 'none', blockSlots: 6,
           unlocks: {}, diaries: {}, cannon: true, overrides: {}, ...s };
}

/** Can the account get tasks from this master? Returns a reason string when not. */
export function masterLocked(m, acc) {
  const slayer = lvl(acc, 'Slayer');
  if (slayer < (m.slayer || 1)) return `needs ${m.slayer} Slayer`;
  if (combatLevel(acc.xp || {}) < (m.combat || 0) && slayer < 99) return `needs combat level ${m.combat}`;
  const q = (m.quests || []).find(q => !quest(acc, q));
  if (q) return `needs a quest (${q.replace(/_/g, ' ')})`;
  return null;
}

/** Why the account can't be given this task (null if it can). Unlock purchases count as bought unless turned off. */
export function taskLocked(t, acc, settings) {
  const r = t.requires || {};
  if (r.slayer && lvl(acc, 'Slayer') < r.slayer) return `${r.slayer} Slayer`;
  if (r.combat && combatLevel(acc.xp || {}) < r.combat) return `combat ${r.combat}`;
  for (const [s, l] of Object.entries(r.skills || {})) if (lvl(acc, s) < l) return `${l} ${s}`;
  for (const any of r.quests || []) if (!any.some(q => quest(acc, q))) return 'a quest';
  if (r.unlock && settings.unlocks?.[r.unlock] === false) return `the ${r.unlock} unlock`;
  return null;
}

/** Methods (variants) for a task the account can use at this intensity. */
export function methodsFor(t, data, acc, settings, intensity, master) {
  const loc = t.location ? t.location.toLowerCase().split(/[ (]/)[0] : null;     // Konar: the variant at her location
  const all = data.variants[t.key] || [];
  const atLoc = loc ? all.filter(v => v.name.toLowerCase().includes(loc)) : all;
  return (atLoc.length ? atLoc : all).filter(v => {
    if (v.wilderness && !master?.wilderness && !settings.wildernessMethods) return false;   // Wilderness Slayer Cave etc. only if allowed
    if (!v.wilderness && master?.wilderness) return false;                                   // Krystilia's tasks are all in the Wilderness
    if (v.boss && !settings.bossVariants) return false;     // killing the boss for the task (e.g. Abyssal Sire): off by default
    if (intensity === 'afk' && (v.style === 'magic' || v.cannon)) return false;
    if (v.cannon && (!settings.cannon || !quest(acc, 'dwarf_cannon'))) return false;
    for (const [s, l] of Object.entries(v.needs?.skills || {})) if (lvl(acc, s) < l) return false;
    for (const any of v.needs?.quests || []) if (!any.some(q => quest(acc, q))) return false;
    return true;
  });
}

const avg = r => r ? (r[0] + r[1]) / 2 : 0;

/** One task done with method v: kills, hours, XP and GP. */
export function taskRun(t, v, m, data, { extend, bracelet }) {
  // kills you actually make: Expeditious (25% chance a kill counts twice) shortens a task, Slaughter
  // (25% chance a kill doesn't count) lengthens it; XP comes from every kill made
  const factor = bracelet === 'expeditious' ? 0.8 : bracelet === 'slaughter' ? 4 / 3 : 1;
  const killsDone = (avg(extend && t.extended ? t.extended : t.amount) || 0) * factor;
  const trips = v.killsPerTrip ? Math.ceil(killsDone / v.killsPerTrip) : 1;
  const hours = killsDone / v.killsPerHr + trips * ((v.travel || 0) + data.meta.resupplySeconds) / 3600 + data.meta.secondsBetweenTasks / 3600;
  const gpk = m.gpColumn === 'konar' ? (v.gpPerKillKonar ?? v.gpPerKill) : m.gpColumn === 'krystilia' ? (v.gpPerKillKrystilia ?? v.gpPerKill) : v.gpPerKill;
  return { kills: killsDone, hours, xp: killsDone * v.xpPerKill, gp: killsDone * (gpk || 0), style: v.style };
}

/** Average points per completed task, counting streak bonuses (every 10th, 50th, ... task). */
export function pointsPerTask(m, data, settings) {
  const d = m.diary && settings.diaries?.[m.diary.key] ? m.diary : null;
  const base = d ? d.points : m.points, bonus = d ? d.bonus : m.bonus;
  const every = data.meta.streakEvery;
  let total = 0;
  for (let n = 1; n <= 1000; n++) {
    let p = base;
    every.forEach((e, i) => { if (n % e === 0) p = bonus[i]; });
    total += p;
  }
  return total / 1000;
}

/**
 * Rates for a master with a plan { actions: {task: 'do'|'skip'|'block'}, extends: {task: bool}, methods: {key: variantName} }.
 * Returns { xpPerHr, gpPerHr, tasksPerHr, pointsPerHr, coverage, styles, rows }.
 */
export function masterRates(m, data, acc, settings, plan, intensity) {
  const rows = [];
  let wSum = 0, xp = 0, gp = 0, hrs = 0, pDo = 0, pSkip = 0, covered = 0;
  const styles = { melee: 0, ranged: 0, magic: 0 };
  for (const t of m.tasks) {
    const locked = taskLocked(t, acc, settings);
    const action = locked ? 'locked' : (plan.actions[t.task] || 'do');
    const methods = locked ? [] : methodsFor(t, data, acc, settings, intensity, m);
    const method = methods.find(v => v.name === plan.methods[t.key + (t.location ? '@' + t.location : '')]) || methods[0];
    const run = method ? taskRun(t, method, m, data, { extend: !!plan.extends[t.task], bracelet: settings.bracelet }) : null;
    rows.push({ task: t.task, location: t.location, weight: t.weight, locked, action, methods, method, run, extended: !!plan.extends[t.task], canExtend: !!t.extended });
    if (locked || action === 'block') continue;
    wSum += t.weight;
  }
  for (const r of rows) {
    if (r.locked || r.action === 'block') continue;
    const p = r.weight / wSum;
    r.chance = p;
    if (r.action === 'do' && r.run) {
      xp += p * r.run.xp; gp += p * r.run.gp; hrs += p * r.run.hours; pDo += p; covered += p;
      styles[r.run.style] += p * r.run.xp;
    } else {
      // skipped, or no rate data for it (then it's treated as skipped, which costs points like any skip)
      hrs += p * data.meta.secondsBetweenTasks / 3600; pSkip += p;
      if (r.action === 'do') r.noData = true; else covered += p;
    }
  }
  const pts = pointsPerTask(m, data, settings);
  const sx = styles.melee + styles.ranged + styles.magic || 1;
  return {
    xpPerHr: hrs ? xp / hrs : 0, gpPerHr: hrs ? gp / hrs : 0, tasksPerHr: hrs ? pDo / hrs : 0,
    pointsPerHr: hrs ? (pDo * pts - pSkip * data.meta.skipCost) / hrs : 0, pointsPerTask: pts,
    coverage: covered, styles: { melee: styles.melee / sx, ranged: styles.ranged / sx, magic: styles.magic / sx }, rows,
  };
}

const score = (r, goal) => goal === 'gp' ? r.gpPerHr : r.xpPerHr;

/**
 * Suggested plan for a master: best method per task for the goal, extend the tasks better than average,
 * block the tasks that drag the rate down most (up to the block slots), then skip below-average tasks
 * while points still keep up.
 */
export function suggestPlan(m, data, acc, settings, intensity) {
  const goal = settings.goal;
  const plan = { actions: {}, extends: {}, methods: {} };
  const between = data.meta.secondsBetweenTasks / 3600, skipCost = data.meta.skipCost;
  const pts = pointsPerTask(m, data, settings);
  // each available task once: its best method's run, plain and extended
  const rows = [];
  for (const t of m.tasks) {
    if (taskLocked(t, acc, settings)) continue;
    const ms = methodsFor(t, data, acc, settings, intensity, m);
    const val = r => (goal === 'gp' ? r.gp : r.xp) / r.hours;
    let best = null, bestRun = null;
    for (const v of ms) { const r = taskRun(t, v, m, data, { extend: false, bracelet: settings.bracelet }); if (!best || val(r) > val(bestRun)) { best = v; bestRun = r; } }
    if (best) plan.methods[t.key + (t.location ? '@' + t.location : '')] = best.name;
    const ext = best && t.extended ? taskRun(t, best, m, data, { extend: true, bracelet: settings.bracelet }) : null;
    rows.push({ task: t.task, w: t.weight, run: bestRun, ext, val: bestRun ? val(bestRun) : 0 });
  }
  // fast rate for a set of actions (no recomputing runs)
  const rate = (actions, extendSet) => {
    let wSum = 0; for (const r of rows) if (actions[r.task] !== 'block') wSum += r.w;
    let x = 0, h = 0, pDo = 0, pSkip = 0;
    for (const r of rows) {
      const a = actions[r.task]; if (a === 'block') continue;
      const p = r.w / wSum, run = extendSet[r.task] && r.ext ? r.ext : r.run;
      if (a === 'skip' || !run) { h += p * between; pSkip += p; continue; }
      x += p * (goal === 'gp' ? run.gp : run.xp); h += p * run.hours; pDo += p;
    }
    return { v: h ? x / h : 0, points: h ? (pDo * pts - pSkip * skipCost) / h : 0 };
  };
  // extend tasks better than the overall rate
  const base = rate(plan.actions, {}).v;
  for (const r of rows) if (r.ext && r.val > base) plan.extends[r.task] = true;
  // blocks: greedily, the task whose removal helps most
  const names = [...new Set(rows.map(r => r.task))];
  for (let i = 0; i < settings.blockSlots; i++) {
    const now = rate(plan.actions, plan.extends).v; let best = null;
    for (const n of names) {
      if (plan.actions[n]) continue;
      plan.actions[n] = 'block'; const v = rate(plan.actions, plan.extends).v; delete plan.actions[n];
      if (v > now * 1.001 && (!best || v > best.v)) best = { n, v };
    }
    if (!best) break;
    plan.actions[best.n] = 'block';
  }
  // skips: worst tasks first, while it helps and points stay positive
  for (const r of [...rows].filter(r => r.run && !plan.actions[r.task]).sort((a, b) => a.val - b.val)) {
    const now = rate(plan.actions, plan.extends);
    if (r.val >= now.v) break;
    plan.actions[r.task] = 'skip';
    const after = rate(plan.actions, plan.extends);
    if (after.v <= now.v || after.points < 0) delete plan.actions[r.task];
  }
  return plan;
}

/** The plan in use for a master: the suggestion with the user's overrides on top. */
export function planFor(m, data, acc, settings, intensity) {
  const s = suggestPlan(m, data, acc, settings, intensity);
  const o = settings.overrides?.[m.id || m.name] || {};
  return { actions: { ...s.actions, ...(o.actions || {}) }, extends: { ...s.extends, ...(o.extends || {}) },
           methods: { ...s.methods, ...(o.methods || {}) }, suggested: s };
}

/** The best master for the account (by the goal), with its rates. Masters with too little rate data are left out. */
export function bestMaster(data, acc, settings, intensity, prefer) {
  let best = null;
  for (const [id, m0] of Object.entries(data.masters)) {
    const m = { id, ...m0 };
    if (masterLocked(m, acc)) continue;
    if (settings.master !== 'auto' && settings.master !== id) continue;
    if (m.wilderness && settings.master !== id) continue;           // Krystilia only when chosen
    const plan = planFor(m, data, acc, settings, intensity);
    const r = masterRates(m, data, acc, settings, plan, intensity);
    if (r.coverage < 0.6 || r.xpPerHr <= 0) continue;
    // a master within 5% of the best keeps its place if it's the one already in use (no flip-flopping)
    const sc = score(r, settings.goal) * (id === prefer ? 1.05 : 1);
    if (!best || sc > best.sc) best = { id, master: m, plan, rates: r, sc };
  }
  return best;
}
