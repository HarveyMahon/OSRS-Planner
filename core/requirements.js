// One Requirement type, used by quests, methods, diaries and goals.
//
// Requirement =
//   | { all: Requirement[] } | { any: Requirement[] }
//   | { skill, level, boostable? }        boostable only counts for one-off checks (quests, diaries)
//   | { quest, milestone? }               milestone omitted = quest complete
//   | { diary, tier }
//   | { item, qty? }                      owned / unlocked
//   | { combatLevel }
//   | { kc: bossId, n }
//
// Account = { xp: {Skill: xp}, quests: {questId: milestoneId}, diaries: Set<'region:tier'>,
//             owned: {itemKey: qty}, kc: {bossId: n}, gp }
//
// Quests list their milestones in order; the last one is "complete".

import { levelForXp } from './xp.js';

// Rough max boost per skill for one-off checks. Refine from Wiki data later.
const DEFAULT_BOOST = 0;

export function combatLevel(xp) {
  const L = s => levelForXp(xp[s] || 0);
  const base = 0.25 * (L('Defence') + Math.max(L('Hitpoints'), 10) + Math.floor(L('Prayer') / 2));
  const melee = 0.325 * (L('Attack') + L('Strength'));
  const range = 0.325 * Math.floor(1.5 * L('Ranged'));
  const mage = 0.325 * Math.floor(1.5 * L('Magic'));
  return Math.floor(base + Math.max(melee, range, mage));
}

/**
 * Is requirement `req` met by `account`?
 * ctx.oneOff: true for quest/diary checks (boosts allowed), false for methods (never boosted).
 * ctx.quests: { questId: { milestones: [{ id }] } } for milestone ordering.
 * ctx.boost(skill): max boost for a skill (default 0).
 */
export function isMet(req, account, ctx = {}) {
  if (!req) return true;
  if (req.all) return req.all.every(r => isMet(r, account, ctx));
  if (req.any) return req.any.some(r => isMet(r, account, ctx));
  if (req.skill) {
    const level = levelForXp(account.xp?.[req.skill] || 0);
    const boost = ctx.oneOff && req.boostable ? (ctx.boost?.(req.skill) ?? DEFAULT_BOOST) : 0;
    return level + boost >= req.level;
  }
  if (req.quest) return questReached(account, req.quest, req.milestone, ctx.quests);
  if (req.diary) return account.diaries?.has?.(`${req.diary}:${req.tier}`) ?? false;
  if (req.item) return (account.owned?.[req.item] || 0) >= (req.qty || 1);
  if (req.combatLevel) return combatLevel(account.xp || {}) >= req.combatLevel;
  if (req.kc) return (account.kc?.[req.kc] || 0) >= req.n;
  throw new Error(`Unknown requirement: ${JSON.stringify(req)}`);
}

function questReached(account, questId, milestone, quests = {}) {
  const reached = account.quests?.[questId];
  if (reached == null) return false;
  const ms = quests[questId]?.milestones?.map(m => m.id) || [];
  const target = milestone ?? ms[ms.length - 1] ?? 'complete';
  if (reached === target) return true;
  const ri = ms.indexOf(reached), ti = ms.indexOf(target);
  return ri !== -1 && ti !== -1 && ri >= ti;
}
