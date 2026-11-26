// Training estimates from data/training.json: how long and how much to get from one XP total
// to another on a given track, stage by stage.
//
// Track = { id, kind: 'fastest'|'balanced'|'afk', label, intensity, stages: [Stage] }
// Stage = { from, name, xpPerHr, xpEach?, inputs?: [{item, qty}], outputs?: [{item, qty}], costPerHr?,
//           requires?, wilderness?, recurring?: { minutesPerRun, hoursToGrow, perRun } }
// Items are per action; an action gives xpEach XP.

import { levelForXp, xpForLevel } from './xp.js';
import { isMet } from './requirements.js';
import { listValue } from './money.js';

/** GP per XP for a stage (positive = it costs you, negative = it pays). Items are per action;
 *  costPerHr is a fixed hourly cost on top (e.g. paying essence runners). */
export function gpPerXp(stage, items) {
  let perXp = 0;
  if (stage.xpEach) perXp += (listValue(stage.inputs || [], items).value - listValue(stage.outputs || [], items).value) / stage.xpEach;
  if (stage.costPerHr) perXp += stage.costPerHr / stage.xpPerHr;
  return perXp;
}

/** The stage to use at `level`: the highest-level stage you've reached and whose requirements you meet. */
export function stageAt(track, level, account, ctx) {
  let best = null;
  for (const s of track.stages) {
    if (s.from > level) break;
    if (account && s.requires && !isMet(s.requires, account, ctx)) continue;
    best = s;
  }
  return best;
}

/**
 * Estimate training from `fromXp` to `toXp` on `track`.
 * Returns { hours, gp, realHours, segments: [{ stage, instead, fromLevel, toLevel, xp, hours, gp }], blocked, blockedBy }
 *   instead: this track's own stage there, when it's locked and another track's method stands in (opts.others)
 *   hours: hours of play; realHours: wall-clock hours (only differs for recurring stages like tree runs)
 *   blocked: a level with no stage you can use (track starts higher, or requirements unmet); blockedBy: what it needs
 */
export function estimate(track, fromXp, toXp, items, { account, ctx, others = [] } = {}) {
  const res = { hours: 0, gp: 0, realHours: 0, segments: [], blocked: null, blockedBy: null };
  const usable = s => !account || !s.requires || isMet(s.requires, account, ctx);
  // other tracks for the skill, no more intense than this one: where this track's method at a level needs a quest
  // or unlock you don't have, the best of theirs stands in (instead of stretching an earlier method to 99)
  const anyAlts = others.filter(t => t !== track && t.id !== track.id);
  const alts = anyAlts.filter(t => (t.intensity ?? 9) <= (track.intensity ?? 9));
  let xp = fromXp;
  while (xp < toXp) {
    const level = levelForXp(xp, { virtual: true });
    let stage = stageAt(track, level, account, ctx), instead = null;
    const latest = [...track.stages].filter(s => s.from <= level).pop();
    if (latest && latest !== stage && account) {           // this track's method here is locked
      const best = ts => ts.map(t => stageAt(t, level, account, ctx)).filter(Boolean).sort((a, b) => b.xpPerHr - a.xpPerHr)[0];
      // a calmer track's method; failing that, the least intense other track's (not just the fastest: the fastest
      // can be essence runners at 48M an hour standing in for an AFK method)
      const calm = best(alts);
      const near = calm ? null : anyAlts.map(t => ({ i: t.intensity ?? 9, st: stageAt(t, level, account, ctx) })).filter(x => x.st)
        .sort((a, b) => a.i - b.i || b.st.xpPerHr - a.st.xpPerHr)[0]?.st;
      const alt = calm || near;
      if (alt && (!stage || alt.xpPerHr > stage.xpPerHr)) { stage = alt; instead = latest; }
    }
    if (!stage) { res.blocked = level; res.blockedBy = latest?.requires || track.stages.find(s => s.requires)?.requires || null; break; }
    // this stage lasts until the next stage starts (that you can use, here or on a stand-in track) or the target
    const nexts = [track, ...(instead ? anyAlts : [])].map(t => t.stages.find(s => s.from > level && usable(s))).filter(Boolean)
      .concat(track.stages.filter(s => s.from > level && !usable(s)).slice(0, 1));     // a locked stage: re-check stand-ins there
    const next = nexts.sort((a, b) => a.from - b.from)[0];
    const end = Math.min(toXp, next ? xpForLevel(next.from) : Infinity);
    const gain = end - xp;
    const hours = gain / stage.xpPerHr;
    const gp = gain * gpPerXp(stage, items);
    let real = hours;
    if (stage.recurring && stage.xpEach) {
      const r = stage.recurring;
      const runs = Math.ceil(gain / (stage.xpEach * r.perRun));
      real = runs * r.hoursToGrow;
      res.hours += runs * r.minutesPerRun / 60;
    } else {
      res.hours += hours;
    }
    res.realHours += real;
    res.gp += gp;
    res.segments.push({ stage, instead, fromLevel: level, toLevel: levelForXp(end, { virtual: true }), xp: gain, hours: stage.recurring ? null : hours, gp });
    xp = end;
  }
  return res;
}
