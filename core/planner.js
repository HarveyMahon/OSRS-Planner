// Goal planner: turns goals into an ordered list of steps.
//
// Goal = { type: 'level', skill, level } | { type: 'maxcape' } | { type: 'quest', id }
//      | { type: 'kc', bossId, n } | { type: 'milestone', bossId } | { type: 'gp', amount }
//
// 1. Goals expand into requirements: a quest pulls in its prerequisite quests and levels, a
//    boss its setup's requirements, a required item (e.g. Fire cape) the boss that awards it.
// 2. Quests and boss kills are ordered so prerequisites come first; before each, exactly the
//    levels it needs are trained. Level goals (and the max cape) are trained at the end.
// 3. Training uses the track for the chosen intensity; swaps replace the method for a range of
//    levels with another method of the same skill.
// 4. Cash is tracked through the plan: when a step costs more than you have, a "make GP" step
//    goes in front of it, using the best money maker you can do at that point.
//
// Step = { kind: 'train', skill, fromXp, toXp, fromLevel, toLevel, estimate, hours, gp }
//      | { kind: 'quest', id, name } | { kind: 'kc', bossId, n, setup, hours, gp }
//      | { kind: 'gp', amount, method, hours, reason }
// gp on a step: positive = it costs that much, negative = it earns that much.

import { SKILLS, xpForLevel, levelForXp, MAX_LEVEL } from './xp.js';
import { isMet, describe, unmet, questPoints } from './requirements.js';
import { estimate, stageAt } from './training.js';
import { bossMethod, guideMethod, setupOf, gearCost, gearEntry, viableRate } from './money.js';
import { withoutCombatLevels } from './rates.js';
const RATE_AT_TOP = 8;
import { bestMaster, slayerSettings, blockSlotsFor, slayerSpeed } from './slayer.js';

const INTENSITY_ORDER = { fastest: ['fastest', 'balanced', 'afk'], balanced: ['balanced', 'fastest', 'afk'], afk: ['afk', 'balanced', 'fastest'] };
const COMBAT_HP = new Set(['Attack', 'Strength', 'Defence', 'Ranged']);

/** The track to use for a skill at an intensity (avoiding Wilderness tracks if asked). */
export function trackFor(training, skill, intensity, { hideWild = false } = {}) {
  const tracks = training.skills[skill] || [];
  const order = INTENSITY_ORDER[intensity] || INTENSITY_ORDER.balanced;
  const pick = ok => { for (const k of order) { const t = tracks.find(x => x.kind === k && ok(x)); if (t) return t; } return null; };
  return (hideWild && pick(t => !t.stages.some(s => s.wilderness))) || pick(() => true) || tracks[0] || null;
}

// Rough hours for a quest from the Wiki's length rating
const QUEST_HOURS = { 'very short': 0.25, short: 0.5, medium: 1, long: 2, 'very long': 4 };
export const questHours = q => {
  const l = (q?.length || '').toLowerCase();
  const key = Object.keys(QUEST_HOURS).sort((a, b) => b.length - a.length).find(k => l.includes(k));
  return key ? QUEST_HOURS[key] : 0.5;
};

/** Every method (stage) for a skill, across its tracks: the options a swap can choose from. */
export function stageOptions(training, skill, atLevel = 126) {
  const best = new Map();       // method name -> its stage at the highest level band <= atLevel
  for (const t of training.skills[skill] || []) {
    t.stages.forEach((s, i) => {
      if (s.from > atLevel) return;
      const key = s.name.replace(/\s*\([^)]*\)\s*$/, '');      // 'Libation bowl (blessed wine)' = 'Libation bowl'
      const cur = best.get(key);
      if (!cur || s.from > cur.stage.from) best.set(key, { ref: `${t.id}#${i}`, track: t, stage: s, name: key });
    });
  }
  return [...best.values()];
}

const stageByRef = (training, skill, ref) => {
  const [tid, i] = ref.split('#');
  const t = (training.skills[skill] || []).find(x => x.id === tid);
  return t?.stages[+i] || null;
};

/** A track with the user's swaps for this skill applied (each swap covers [fromLevel, toLevel)). */
export function applySwaps(track, swaps, training, skill) {
  const mine = (swaps || []).filter(s => s.skill === skill).sort((a, b) => a.fromLevel - b.fromLevel);
  if (!mine.length || !track) return track;
  let stages = track.stages.map(s => ({ ...s }));
  for (const sw of mine) {
    const chosen = stageByRef(training, skill, sw.ref);
    if (!chosen) continue;
    const resumeAt = [...stages].filter(s => s.from <= sw.toLevel).pop();   // what applies again after the swap
    stages = stages.filter(s => s.from < sw.fromLevel || s.from >= sw.toLevel);
    stages.push({ ...chosen, from: sw.fromLevel, swapped: true, swapRef: sw.ref });
    if (resumeAt && !stages.some(s => s.from === sw.toLevel)) stages.push({ ...resumeAt, from: sw.toLevel });
    stages.sort((a, b) => a.from - b.from);
  }
  return { ...track, stages };
}

export function plan(goals, d) {
  const { items, training, quests, bosses, methods, intensity = 'balanced', swaps = [], setupChoices = {}, gpChoices = {}, hideWild = false, slayer = null, order: userOrder = null, rates = null, rateAt = null } = d;
  // Your kill rates (core/rates.js): a boss setup's kills/hr for you, standing in for its recommended combat levels
  const rateOf = (b, s) => rates?.[b.id]?.setups?.[s.id] || null;
  const methodOf = (b, setupId) => { const r = rateOf(b, setupOf(b, setupId)); return bossMethod(b, items, { setupId, override: r ? { unitsPerHr: r.kph } : undefined }); };
  const reqCtx = { quests };
  const sim = { xp: { ...d.account.xp }, quests: { ...(d.account.quests || {}) }, owned: { ...(d.account.bank || {}), ...(d.account.owned || {}) },
                kc: { ...(d.account.kc || {}) }, diaries: new Set(d.account.diaries || []), prayers: [...(d.account.prayers || [])], gp: d.account.gp || 0 };
  const warnings = [];
  const errors = [];               // contradictions in the account, e.g. a quest ticked without its levels
  const steps = [];

  // ---- 1. expand goals into ordered milestones (quests, kills) with the levels each needs ----
  const milestones = [];          // { kind: 'quest'|'kc', id, n, needs: {skill: level}, setupId }
  const seen = new Set();
  const finalLevels = {};

  const bossById = id => bosses.find(b => b.id === id);
  // Gear the account still has to buy for a setup (owned items count as bought; unpriced items are skipped).
  // a gear entry is a key or a list of equal keys (owning any covers it; otherwise priced at the first)
  const gearToBuy = s => (s.gear || []).reduce((t, g) => t + gearCost(g, items, k => sim.owned[k] || 0).toBuy, 0);
  // Setup for kill-count steps: the user's choice if they made one; otherwise High level when the account
  // already meets its requirements and the cash stack covers the gear it doesn't own; otherwise Budget.
  function kcSetup(b) {
    const chosen = b.setups.find(s => s.id === setupChoices[b.id]);
    if (chosen) return { setup: chosen, why: 'chosen' };
    const budget = b.setups.find(s => s.id === 'budget');
    const high = b.setups.find(s => s.id !== 'budget');
    if (!budget || !high) return { setup: budget || setupOf(b), why: 'only' };
    // requirements the Budget setup shares (e.g. the same quest) get planned either way, so they don't count against High
    const shared = new Set(unmet(budget.requires, sim, reqCtx).map(r => JSON.stringify(r)));
    const highMet = unmet(high.requires, sim, reqCtx).every(r => shared.has(JSON.stringify(r)));
    if (!highMet) return { setup: budget, why: 'requirements' };
    if (!high.gear?.length && !high.noGear) return { setup: budget, why: 'unknown' };          // can't tell if it's affordable
    if (gearToBuy(high) <= sim.gp) return { setup: high, why: 'affordable' };
    return { setup: budget, why: 'gear' };
  }

  function needsOf(req, needs, depth = 0) {
    if (!req || depth > 50) return;
    if (req.all) return req.all.forEach(r => needsOf(r, needs, depth + 1));
    if (req.any) {
      // the option with the least XP still to gain
      const gap = r => r.skill ? Math.max(0, xpForLevel(r.level) - (sim.xp[r.skill] || 0)) : (isMet(r, sim, reqCtx) ? 0 : 1e12);
      return needsOf([...req.any].sort((a, b) => gap(a) - gap(b))[0], needs, depth + 1);
    }
    if (req.skill) { needs[req.skill] = Math.max(needs[req.skill] || 0, req.level); return; }
    if (req.quest) return addQuest(req.quest, depth + 1);
    if (req.kc) return addKc(req.kc, req.n, depth + 1);
    if (req.item) {
      if (ownsItem(req.item)) return;
      const giver = bosses.find(b => b.milestone?.reward === req.item);
      if (giver) return addKc(giver.id, giver.milestone.kc || 1, depth + 1);
      warnings.push(`Needs an item the planner can't plan for (${req.item}).`);
      return;
    }
    if (req.questPoints) { milestonesQP.push({ qp: req.questPoints, owner: currentQuest }); return; }
    if (req.combatLevel) { combatNeeds.push(req.combatLevel); return; }
    if (req.prayer) { if (isMet(req, sim, reqCtx)) return; warnings.push(`Needs the ${req.prayer} prayer unlocked, which the planner doesn't plan for.`); return; }
    if (req.totalLevel) { if (isMet(req, sim, reqCtx)) return; warnings.push(`Needs total level ${req.totalLevel}, which the planner doesn't plan for.`); return; }
    if (req.diary) warnings.push(`Needs the ${req.tier} ${req.diary} diary, which the planner doesn't plan yet.`);
  }
  const milestonesQP = [], combatNeeds = [];
  // owning an item, or one that can only be made from it (an Infernal cape means you had a Fire cape)
  const UPGRADES = { 'x-fire-cape': ['x-infernal-cape'] };
  const ownsItem = k => !!sim.owned[k] || (UPGRADES[k] || []).some(u => sim.owned[u]);

  let currentQuest = null;
  function addQuest(id, depth = 0) {
    const key = 'q:' + id;
    if (seen.has(key) || sim.quests[id] === 'complete') return;
    seen.add(key);
    const q = quests[id];
    if (!q) { warnings.push(`Unknown quest: ${id}`); return; }
    const needs = {};
    const outer = currentQuest; currentQuest = id;
    needsOf(q.requires, needs, depth);
    currentQuest = outer;
    for (const n of q.requirementNotes || []) warnings.push(`${q.name}: also needs ${n}`);
    milestones.push({ kind: 'quest', id, needs, goal: currentGoal });
  }

  function addKc(bossId, n, depth = 0) {
    const key = 'k:' + bossId;
    const b = bossById(bossId);
    if (!b) { warnings.push(`Unknown boss: ${bossId}`); return; }
    const have = sim.kc[bossId] || 0;
    const existing = milestones.find(m => m.kind === 'kc' && m.id === bossId);
    if (existing) { existing.n = Math.max(existing.n, n); return; }
    if (seen.has(key)) return;
    seen.add(key);
    const { setup, why } = kcSetup(b);
    const needs = {};
    needsOf(setup.requires, needs, depth);
    milestones.push({ kind: 'kc', id: bossId, n: Math.max(0, n - have), needs, setupId: setup.id, why, goal: currentGoal });
  }

  const gpGoals = [];
  // A goal quest that's ticked as complete but whose skill requirements the account doesn't meet: flag it,
  // and plan the training to those levels anyway (the stats are probably out of date, or it was boosted).
  function checkDoneQuest(id) {
    const q = quests[id];
    if (!q || sim.quests[id] !== 'complete') return;
    const short = [];
    const walk = r => {
      if (!r) return;
      if (r.all) return r.all.forEach(walk);
      if (r.any) {
        if (r.any.some(x => !x.skill || (sim.xp[x.skill] || 0) >= xpForLevel(x.level))) return;
        return walk([...r.any].sort((a, b) => (xpForLevel(a.level) - (sim.xp[a.skill] || 0)) - (xpForLevel(b.level) - (sim.xp[b.skill] || 0)))[0]);
      }
      if (r.skill && (sim.xp[r.skill] || 0) < xpForLevel(r.level)) short.push(r);
    };
    walk(q.requires);
    if (!short.length) return;
    const list = short.map(r => `${r.skill} ${r.level} (you have ${levelForXp(sim.xp[r.skill] || 0)}${r.boostable ? ', boostable' : ''})`).join(', ');
    errors.push(`${q.name} is marked complete on My Account, but your stats are below its requirements: ${list}. `
      + `Check your stats or the quest tick${short.some(r => r.boostable) ? ', or you may have done it with a boost' : ''}. The plan below includes the training to reach them.`);
    for (const r of short) finalLevels[r.skill] = Math.max(finalLevels[r.skill] || 0, r.level);
  }
  // quest points available before quest `owner` (it can't count its own, or those after it)
  const questPointsPlanned = owner => {
    const done = new Set(Object.keys(sim.quests).filter(id => sim.quests[id] === 'complete'));
    for (const m of milestones) { if (m.kind === 'quest' && m.id === owner) break; if (m.kind === 'quest') done.add(m.id); }
    return [...done].reduce((t, id) => t + (quests[id]?.questPoints || 0), 0);
  };
  const qpShortfall = () => milestonesQP.map(r => ({ ...r, have: questPointsPlanned(r.owner) })).filter(r => r.have < r.qp);
  // Not enough quest points: add quests (placed early): ones you can start now, most quest points per hour first
  function fillQuestPoints() {
    let guard = 0;
    while (qpShortfall().length && guard++ < 300) {
      const planned = new Set(milestones.filter(m => m.kind === 'quest').map(m => m.id));
      const cands = Object.entries(quests).filter(([id, q]) => !q.miniquest && q.questPoints && sim.quests[id] !== 'complete' && !planned.has(id));
      if (!cands.length) break;
      const unmet = q => (q.requires?.all || []).filter(r => !(r.quest && planned.has(r.quest)) && !isMet(r, sim, reqCtx)).length;
      // quests you can start now first, then the most quest points per hour (short 2-3 QP quests before long ones)
      const qph = q => q.questPoints / questHours(q);
      cands.sort((a, b) => Math.min(1, unmet(a[1])) - Math.min(1, unmet(b[1])) || qph(b[1]) - qph(a[1]) || unmet(a[1]) - unmet(b[1]));
      const before = milestones.length;
      addQuest(cands[0][0]);
      addedForQp.push(cands[0][0]);
      // move the new quest (and what it pulled in) in front of the first quest that needs the points
      const added = milestones.splice(before);
      const owners = new Set(qpShortfall().map(r => r.owner));
      const at = milestones.findIndex(m => m.kind === 'quest' && owners.has(m.id));
      if (at !== -1) for (const m of added) m.goal = milestones[at].goal;      // part of the goal that needs the points
      milestones.splice(at === -1 ? milestones.length : at, 0, ...added);
    }
  }
  const addedForQp = [];
  let currentGoal = null;
  const goalKey = (g, i) => g.type === 'quest' ? 'q:' + g.id : g.type === 'kc' || g.type === 'milestone' ? 'k:' + g.bossId
    : g.type === 'level' ? 'lvl:' + g.skill : g.type === 'maxcape' ? 'maxcape' : 'gp:' + i;
  const gkeys = goals.map(goalKey);
  for (const [gi, g] of goals.entries()) {
    currentGoal = gkeys[gi];
    if (g.type === 'level') finalLevels[g.skill] = Math.max(finalLevels[g.skill] || 0, g.level);
    else if (g.type === 'maxcape') SKILLS.forEach(s => { finalLevels[s] = Math.max(finalLevels[s] || 0, MAX_LEVEL); });
    else if (g.type === 'quest') { checkDoneQuest(g.id); addQuest(g.id); }
    else if (g.type === 'kc') addKc(g.bossId, g.n);
    else if (g.type === 'milestone') {
      const b = bossById(g.bossId);
      if (b?.milestone?.reward && ownsItem(b.milestone.reward)) warnings.push(`You already have the ${items[b.milestone.reward]?.name || 'reward'} (it's in your bank or ticked on My Account), so that goal is done.`);
      else if (b) addKc(b.id, b.milestone?.kc || 1);
    }
    else if (g.type === 'gp') gpGoals.push(g.amount);
  }

  fillQuestPoints();
  for (const r of qpShortfall()) {
    warnings.push(`${quests[r.owner]?.name || 'A quest'} needs ${r.qp} quest points; this plan has ${r.have} before it.`);
  }

  // ---- money makers available at a point in the plan ----
  // every money maker the account can do at this point in the plan, best GP/hr first
  function moneyMakers() {
    const out = [];
    for (const b of bosses) {
      if (b.category === 'misc' || b.moneyMaker === false || b.taskOnly || (hideWild && b.wilderness)) continue;
      for (const s of b.setups) {
        const r = rateOf(b, s);
        if (r ? !(viableRate(r) && isMet(withoutCombatLevels(s.requires), sim, reqCtx)) : !isMet(s.requires, sim, reqCtx)) continue;
        const m = methodOf(b, s.id);
        if (m.gpPerHr > 0) out.push({ id: `b:${b.id}:${s.id}`, name: `${b.name} (${s.label})`, gpPerHr: m.gpPerHr, wilderness: !!b.wilderness, b, s });
      }
    }
    // the best few bosses again at the levels the plan has reached by now (working out all of them is slow)
    if (rateAt) {
      out.sort((a, b) => b.gpPerHr - a.gpPerHr);
      for (const o of out.slice(0, RATE_AT_TOP)) {
        const r = rateAt(o.b, o.s, sim.xp);
        if (r?.kph > 0) o.gpPerHr = viableRate(r) ? bossMethod(o.b, items, { setupId: o.s.id, override: { unitsPerHr: r.kph } }).gpPerHr : 0;
      }
    }
    for (let i = out.length - 1; i >= 0; i--) if (out[i].gpPerHr <= 0) out.splice(i, 1);
    for (const o of out) { delete o.b; delete o.s; }
    for (const m of methods) {
      if (m.recurring || (hideWild && m.wilderness) || !isMet(m.requires, sim, reqCtx)) continue;
      const r = guideMethod(m, items, { cash: Math.max(sim.gp, 1) });
      if (r.missing.length || r.gpPerHr <= 0) continue;
      out.push({ id: `m:${m.id}`, name: m.name, gpPerHr: r.gpPerHr, wilderness: m.wilderness, cappedBy: r.cappedBy });
    }
    return out.sort((a, b) => b.gpPerHr - a.gpPerHr);
  }

  // The money maker the user chose for this step (keyed by what it pays for) when the account can do it
  // at this point, otherwise the best one
  function makeGp(amount, reason, key = reason) {
    const amt = Math.ceil(amount / 100000) * 100000;
    const all = moneyMakers();
    const gpChoice = gpChoices[key];
    const chosen = gpChoice && all.find(m => m.id === gpChoice);
    const mm = chosen || all[0];
    if (!mm) { warnings.push(`No money maker available to fund: ${reason}.`); sim.gp += amt; steps.push({ kind: 'gp', amount: amt, method: null, hours: 0, reason, key }); return; }
    steps.push({ kind: 'gp', amount: amt, method: mm, hours: amt / mm.gpPerHr, reason, key, chosen: !!chosen,
                 choiceUnavailable: !!gpChoice && !chosen, options: all.slice(0, 25) });
    sim.gp += amt;
  }

  // pay for a step, making money first if needed
  function pay(cost, reason, key) {
    if (cost > 0 && sim.gp < cost) makeGp(cost - sim.gp, reason, key);
    sim.gp -= cost;
  }

  // Hitpoints isn't trained on its own: train a combat skill until Hitpoints gets there.
  // `prefer` = the combat skill the content leans on (e.g. Ranged for the Inferno).
  // `order` = the content's combat skills, most-required first (Ranged, then Defence, for the Inferno); after
  // those, the lowest combat skill. A skill that would pass 99 stops there and the next one takes over.
  function trainHitpoints(level, order = []) {
    const cap = xpForLevel(99);
    const rest = [...COMBAT_HP].filter(s => !order.includes(s)).sort((a, b) => (sim.xp[a] || 0) - (sim.xp[b] || 0));
    for (const skill of [...order, ...rest]) {
      const missing = xpForLevel(level) - (sim.xp.Hitpoints || 0);
      if (missing <= 0) return;
      const fromXp = sim.xp[skill] || 0;
      if (fromXp >= cap) continue;
      const wanted = fromXp + Math.ceil(missing * 3);
      if (wanted > cap) train(skill, 99, { towardsHp: level });              // "Train Ranged 90 → 99", then the next skill
      else train(skill, levelForXp(wanted, { virtual: true }), { toXp: wanted, untilHp: level });
    }
  }

  function train(skill, level, { toXp: exactXp, untilHp, towardsHp } = {}) {
    if (skill === 'Hitpoints' && !untilHp) return trainHitpoints(level);
    const toXp = exactXp ?? xpForLevel(level);
    const fromXp = sim.xp[skill] || 0;
    if (fromXp >= toXp) return;
    const track = (skill === 'Slayer' && slayerTrack(fromXp, toXp)) || applySwaps(trackFor(training, skill, intensity, { hideWild }), swaps, training, skill);
    if (!track) { warnings.push(`No training data for ${skill}.`); sim.xp[skill] = toXp; return; }
    let e = estimate(track, fromXp, toXp, items, { account: sim, ctx: reqCtx, others: training.skills[skill] || [] });
    let used = track;
    if (e.blocked) {
      // Blocked by a quest on the method: do it first if it's a small one (no unfinished quests
      // before it, and not one we're already in the middle of); otherwise use another track.
      const stage = [...track.stages].filter(st => st.from <= e.blocked).pop() || track.stages[0];
      const qs = (stage?.requires?.all || []).filter(r => r.quest && sim.quests[r.quest] !== 'complete').map(r => r.quest);
      const small = q => !doing.has(q) && quests[q] && (quests[q].requires?.all || []).every(r => !r.quest || sim.quests[r.quest] === 'complete');
      if (qs.length && qs.every(small)) {
        qs.forEach(q => doQuestNow(q));
        e = estimate(track, fromXp, toXp, items, { account: sim, ctx: reqCtx, others: training.skills[skill] || [] });
      }
      if (e.blocked) {
        for (const alt of (training.skills[skill] || []).filter(t => t !== track && t.id !== track.id)) {
          const a = applySwaps(alt, swaps, training, skill);
          const ea = estimate(a, fromXp, toXp, items, { account: sim, ctx: reqCtx });
          if (!ea.blocked) { e = ea; used = a; break; }
        }
      }
      if (e.blocked) warnings.push(`${skill}: no method you can use at level ${e.blocked}.`);
    }
    const step = { kind: 'train', skill, fromXp, toXp, fromLevel: levelForXp(fromXp, { virtual: true }), toLevel: level,
                   track: used, estimate: e, hours: e.hours, realHours: e.realHours, gp: e.gp, untilHp, towardsHp,
                   slayer: used.slayer ? slayerCredit(used, e) : undefined };
    pay(e.gp, `${skill} ${step.fromLevel}–${level}`, `train:${skill}:${level}`);
    steps.push(step);
    sim.xp[skill] = toXp;
    // melee and Ranged training also give a third as much Hitpoints XP
    if (COMBAT_HP.has(skill)) sim.xp.Hitpoints = Math.min(200e6, (sim.xp.Hitpoints || 0) + (toXp - fromXp) / 3);
    // Slayer tasks also train the combat skills they're done with
    if (step.slayer) for (const [s, x] of Object.entries(step.slayer.combatXp)) sim.xp[s] = Math.min(200e6, (sim.xp[s] || 0) + x);
  }

  // Slayer: a track whose stages are the best master's rates at each Slayer level (from the Slayer model and
  // the user's Slayer tab settings). Below the levels the model has data for, the usual Slayer track is used.
  const slayerCache = new Map();
  function slayerTrack(fromXp, toXp) {
    if (!slayer?.data) return null;
    const settings = { ...slayerSettings(slayer.settings), speed: slayerSpeed(rates) ?? 1 };   // scaled by your boss kill rates
    const inten = slayer.intensity || settings.intensity || intensity;
    const fallback = trackFor(training, 'Slayer', intensity, { hideWild });
    const stages = [];
    const from = levelForXp(fromXp), to = levelForXp(Math.max(fromXp, toXp - 1), { virtual: true });
    const levels = [from];
    for (let L = from - (from % 5) + 5; L <= to; L += 5) levels.push(L);      // re-check every 5 Slayer levels
    for (const L of levels) {
      const acc = { ...sim, xp: { ...sim.xp, Slayer: Math.max(sim.xp.Slayer || 0, xpForLevel(Math.min(L, 99))) },
                    blockSlots: blockSlotsFor(questPoints(sim, quests), sim.diaries) };
      const key = `${L}|${inten}|${['Magic', 'Strength', 'Defence', 'Ranged', 'Attack', 'Hitpoints', 'Prayer'].map(k => levelForXp(sim.xp[k] || 0)).join('.')}`;
      const prev = stages[stages.length - 1]?.slayerMaster;
      if (!slayerCache.has(key + prev)) slayerCache.set(key + prev, bestMaster(slayer.data, acc, settings, inten, prev));
      const best = slayerCache.get(key + prev);
      if (best) {
        const style = Object.entries(best.rates.styles).sort((a, b) => b[1] - a[1])[0][0];
        stages.push({ from: L, name: `${best.master.name} tasks (mostly ${style})`, xpPerHr: best.rates.xpPerHr,
                      slayerMaster: best.id, styles: best.rates.styles, pointsPerHr: best.rates.pointsPerHr, gpPerHr: best.rates.gpPerHr });
      } else {
        const fb = fallback && stageAt(fallback, L);
        if (fb) stages.push({ ...fb, from: L, fallback: true });
      }
    }
    if (!stages.length || stages.every(s => s.fallback)) return null;
    // merge neighbouring stages with the same master
    const merged = stages.filter((s, i) => i === 0 || s.name !== stages[i - 1].name || Math.abs(s.xpPerHr / stages[i - 1].xpPerHr - 1) > 0.03);
    return { id: 'slayer-model', kind: inten, label: 'Slayer tasks', stages: merged, slayer: true, intensity: inten };
  }
  // Combat XP from Slayer: about 4 XP per damage in the style used (2.5 for magic, counting spell XP), and
  // 1.33 Hitpoints XP, against 1 Slayer XP per hitpoint. Melee XP goes to the skills the plan still needs.
  function slayerCredit(track, e) {
    let melee = 0, ranged = 0, magic = 0, hp = 0;
    for (const seg of e.segments) {
      const st = seg.stage.styles; if (!st) continue;
      melee += seg.xp * st.melee * 4; ranged += seg.xp * st.ranged * 4; magic += seg.xp * st.magic * 2.5; hp += seg.xp * 1.33;
    }
    // XP the plan still needs in a skill: the highest level any goal or milestone asks for, minus what's there
    const needXp = skill => {
      let lv = finalLevels[skill] || 0;
      for (const m of milestones) lv = Math.max(lv, m.needs?.[skill] || 0);
      return Math.max(0, xpForLevel(lv) - (sim.xp[skill] || 0));
    };
    const out = {}, targets = [];
    const add = (k, v) => { if (v >= 1) out[k] = Math.round((out[k] || 0) + v); };
    // Melee: put it where the plan needs it most (the biggest shortfall first), the rest into Strength
    let left = melee;
    const short = ['Defence', 'Attack', 'Strength'].map(k => [k, needXp(k)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    for (const [k, n] of short) {
      if (left <= 0) break;
      const give = Math.min(left, n); add(k, give); left -= give;
      targets.push({ skill: k, level: levelForXp((sim.xp[k] || 0) + give), filled: give >= n });
    }
    if (left > 0) { add('Strength', left); if (!targets.some(t => t.skill === 'Strength')) targets.push({ skill: 'Strength', rest: true }); }
    // Magic: defensive autocast splits it evenly with Defence; use that while the plan needs Defence.
    // Ranged all goes to Ranged.
    if (magic > 0) {
      const d = Math.min(magic / 2, needXp('Defence') - (out.Defence || 0));
      if (d > 0) { add('Magic', magic - d); add('Defence', d); targets.push({ skill: 'Magic', defensive: true }); }
      else { add('Magic', magic); if (melee < magic) targets.push({ skill: 'Magic' }); }
    }
    add('Ranged', ranged); add('Hitpoints', hp);
    const last = e.segments.filter(s => s.stage.slayerMaster).pop()?.stage;
    return { combatXp: out, targets, master: last?.name, pointsPerHr: last?.pointsPerHr, intensity: track.intensity };
  }

  // Do a quest straight away (prerequisite quests and levels first), e.g. when a training
  // method needs it. Levels it needs are trained with the usual tracks.
  const doing = new Set();
  function doQuestNow(id, { pulledFor } = {}) {
    if (sim.quests[id] === 'complete' || !quests[id] || doing.has(id)) return;
    doing.add(id);
    for (const r of quests[id].requires?.all || []) if (r.quest) doQuestNow(r.quest, { pulledFor });
    const needs = {};
    const walk = r => { if (!r) return; if (r.all) r.all.forEach(walk); else if (r.any) walk(r.any[0]); else if (r.skill) needs[r.skill] = Math.max(needs[r.skill] || 0, r.level); };
    walk(quests[id].requires);
    trainNeeds(needs);
    steps.push({ kind: 'quest', id, name: quests[id].name, forTraining: !pulledFor, pulledFor, hours: questHours(quests[id]) });
    sim.quests[id] = 'complete';
    doing.delete(id);
  }

  // ---- 2. walk the milestones in order ----
  // the combat skill a piece of content leans on: its highest combat-skill requirement
  const combatOrder = needs => Object.entries(needs).filter(([s]) => COMBAT_HP.has(s)).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const trainNeeds = needs => {
    for (const [skill, level] of Object.entries(needs)) if (skill !== 'Hitpoints') train(skill, level);
    if (needs.Hitpoints) trainHitpoints(needs.Hitpoints, combatOrder(needs));
  };

  // Quests a requirement needs that aren't done yet (when the user has moved something above them)
  const questsIn = (r, out = []) => { if (!r) return out; if (r.all) r.all.forEach(x => questsIn(x, out)); else if (r.any) { if (!r.any.some(x => isMet(x, sim, reqCtx))) questsIn(r.any[0], out); } else if (r.quest && sim.quests[r.quest] !== 'complete') out.push(r.quest); return out; };

  function runMilestone(m) {
    if (m.kind === 'quest') {
      if (sim.quests[m.id] === 'complete') return;
      for (const q of questsIn(quests[m.id].requires)) doQuestNow(q, { pulledFor: quests[m.id].name });
      trainNeeds(m.needs);
      steps.push({ kind: 'quest', id: m.id, name: quests[m.id].name, hours: questHours(quests[m.id]) });
      sim.quests[m.id] = 'complete';
    } else if (m.n > 0) {
      const b = bossById(m.id);
      // kill steps: your kill rate at the levels the plan has reached by now, when the planner can work it out
      const atNow = rateAt?.(b, setupOf(b, m.setupId), sim.xp);
      const bm = atNow ? bossMethod(b, items, { setupId: m.setupId, override: { unitsPerHr: atNow.kph } }) : methodOf(b, m.setupId);
      for (const q of questsIn(bm.setup.requires)) doQuestNow(q, { pulledFor: b.name });
      trainNeeds(m.needs);
      const hours = bm.unitsPerHr ? m.n / bm.unitsPerHr : 0;
      const gp = -bm.profitPerUnit * m.n;
      pay(Math.max(0, bm.costPerUnit * m.n), `${b.name} kills`, `kc:${b.id}`);
      sim.gp += bm.lootPerUnit * m.n;
      steps.push({ kind: 'kc', bossId: b.id, name: b.name, n: m.n, unit: b.unit, setup: bm.setup.label, setupId: bm.setup.id, why: m.why,
                   setups: b.setups.map(s => ({ id: s.id, label: s.label, gearToBuy: gearToBuy(s) })), hours, gp,
                   gearMissing: (bm.setup.gear || []).filter(g => { const e = gearEntry(g); return e.keys.reduce((t, k) => t + (sim.owned[k] || 0), 0) < e.qty; }).map(g => { const e = gearEntry(g); return (e.qty > 1 ? `${e.qty} × ` : '') + (items[e.keys[0]]?.name || e.keys[0]); }),
                   rate: atNow || rateOf(b, setupOf(b, m.setupId)), best: rates?.[b.id] ? { buy: rates[b.id].buy, cost: rates[b.id].cost } : null,
                   met: isMet(bm.setup.requires, sim, reqCtx) });
      sim.kc[b.id] = (sim.kc[b.id] || 0) + m.n;
      if (b.milestone?.reward) sim.owned[b.milestone.reward] = 1;
    } else trainNeeds(m.needs);
  }

  // ---- 2-3. the plan's blocks: one per goal, with everything it needs (quests, kills, training, money) ----
  // Blocks are what the user can move. Default order: goals with quests or kills, in the order their first
  // milestone comes up; then level goals (Slayer first: its tasks give combat XP); then GP goals.
  const blocks = [], byKey = new Map();
  const block = key => { if (!byKey.has(key)) { const b = { key, ms: [], extra: [] }; byKey.set(key, b); blocks.push(b); } return byKey.get(key); };
  for (const m of milestones) block(m.goal || 'other').ms.push(m);
  const lvOrder = finalLevels.Slayer ? ['Slayer', ...SKILLS.filter(s => s !== 'Slayer')] : SKILLS;
  const levelGoal = sk => { const i = goals.findIndex(g => g.type === 'level' && g.skill === sk); return i >= 0 ? gkeys[i] : goals.some(g => g.type === 'maxcape') ? 'maxcape' : 'lvl:' + sk; };
  for (const sk of lvOrder) if (finalLevels[sk] && sk !== 'Hitpoints') block(levelGoal(sk)).extra.push(() => train(sk, finalLevels[sk]));
  if (finalLevels.Hitpoints) block(levelGoal('Hitpoints')).extra.push(() => trainHitpoints(finalLevels.Hitpoints));   // after combat, which gives Hitpoints XP
  goals.forEach((g, i) => { if (g.type === 'gp') block(gkeys[i]).extra.push(() => makeGp(g.amount, `your goal of ${g.amount.toLocaleString('en-GB')} GP`, `goal:${g.amount}`)); });
  for (const b of blocks) b.run = () => { b.ms.forEach(runMilestone); b.extra.forEach(f => f()); };
  // the user's order (keys from an earlier plan) first, anything new after it in the usual order
  if (userOrder?.length) {
    const pos = k => { const i = userOrder.indexOf(k); return i < 0 ? Infinity : i; };
    blocks.forEach((b, i) => { b.i = i; });
    blocks.sort((a, b) => pos(a.key) - pos(b.key) || a.i - b.i);
  }
  const blockOrder = [];
  for (const b of blocks) {
    const from = steps.length;
    b.run();
    if (steps.length > from) {
      for (let i = from; i < steps.length; i++) steps[i].block = b.key;
      steps[steps.length - 1].blockMain = true;           // the block's own step (the rest lead up to it)
      blockOrder.push(b.key);
    }
  }

  const totals = steps.reduce((t, s) => {
    t.hours += s.hours || 0;
    t.realHours += s.realHours ?? s.hours ?? 0;
    if (s.kind === 'gp') t.gpMade += s.amount;
    else if (s.gp > 0) t.gpSpent += s.gp; else if (s.gp < 0) t.gpEarned += -s.gp;
    return t;
  }, { hours: 0, realHours: 0, gpMade: 0, gpSpent: 0, gpEarned: 0 });
  totals.endGp = sim.gp;
  return { steps, totals, warnings: [...new Set(warnings)], errors, endAccount: sim, order: blockOrder };
}
