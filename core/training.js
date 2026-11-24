// Training estimates from data/training.json: how long and how much to get from one XP total
// to another on a given track, stage by stage.
//
// Track = { id, kind: 'fastest'|'balanced'|'afk', label, intensity, stages: [Stage] }
// Stage = { from, name, xpPerHr, xpEach?, inputs?: [{item, qty}], outputs?: [{item, qty}],
//           requires?, wilderness?, recurring?: { minutesPerRun, hoursToGrow, perRun } }
// Items are per action; an action gives xpEach XP.

import { levelForXp, xpForLevel } from './xp.js';
import { isMet } from './requirements.js';
import { listValue } from './money.js';

/** GP per XP for a stage (positive = it costs you, negative = it pays). */
export function gpPerXp(stage, items) {
  if (!stage.xpEach) return 0;
  const cost = listValue(stage.inputs || [], items).value - listValue(stage.outputs || [], items).value;
  return cost / stage.xpEach;
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
 * Returns { hours, gp, realHours, segments: [{ stage, fromLevel, toLevel, xp, hours, gp }], blocked }
 *   hours: hours of play; realHours: wall-clock hours (only differs for recurring stages like tree runs)
 *   blocked: a level with no stage you can use (track starts higher, or requirements unmet)
 */
export function estimate(track, fromXp, toXp, items, { account, ctx } = {}) {
  const res = { hours: 0, gp: 0, realHours: 0, segments: [], blocked: null };
  let xp = fromXp;
  while (xp < toXp) {
    const level = levelForXp(xp, { virtual: true });
    const stage = stageAt(track, level, account, ctx);
    if (!stage) { res.blocked = level; break; }
    // this stage lasts until the next stage starts (that you can use) or the target
    const next = track.stages.find(s => s.from > level && (!account || !s.requires || isMet(s.requires, account, ctx)));
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
    res.segments.push({ stage, fromLevel: level, toLevel: levelForXp(end, { virtual: true }), xp: gain, hours: stage.recurring ? null : hours, gp });
    xp = end;
  }
  return res;
}
