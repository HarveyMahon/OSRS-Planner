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
import { isMet, describe, unmet } from './requirements.js';
import { estimate } from './training.js';
import { bossMethod, guideMethod, setupOf } from './money.js';

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
  const { items, training, quests, bosses, methods, intensity = 'balanced', swaps = [], setupChoices = {}, hideWild = false } = d;
  const reqCtx = { quests };
  const sim = { xp: { ...d.account.xp }, quests: { ...(d.account.quests || {}) }, owned: { ...(d.account.owned || {}) },
                kc: { ...(d.account.kc || {}) }, diaries: new Set(d.account.diaries || []), gp: d.account.gp || 0 };
  const warnings = [];
  const steps = [];

  // ---- 1. expand goals into ordered milestones (quests, kills) with the levels each needs ----
  const milestones = [];          // { kind: 'quest'|'kc', id, n, needs: {skill: level}, setupId }
  const seen = new Set();
  const finalLevels = {};

  const bossById = id => bosses.find(b => b.id === id);
  // Gear the account still has to buy for a setup (owned items count as bought; unpriced items are skipped).
  const gearToBuy = s => (s.gear || []).reduce((t, k) => t + (sim.owned[k] ? 0 : (items[k]?.price || 0)), 0);
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
    if (!high.gear?.length) return { setup: budget, why: 'unknown' };          // can't tell if it's affordable
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
      if (sim.owned[req.item]) return;
      const giver = bosses.find(b => b.milestone?.reward === req.item);
      if (giver) return addKc(giver.id, giver.milestone.kc || 1, depth + 1);
      warnings.push(`Needs an item the planner can't plan for (${req.item}).`);
      return;
    }
    if (req.questPoints) { milestonesQP.push({ qp: req.questPoints, owner: currentQuest }); return; }
    if (req.combatLevel) { combatNeeds.push(req.combatLevel); return; }
    if (req.diary) warnings.push(`Needs the ${req.tier} ${req.diary} diary, which the planner doesn't plan yet.`);
  }
  const milestonesQP = [], combatNeeds = [];

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
    milestones.push({ kind: 'quest', id, needs });
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
    milestones.push({ kind: 'kc', id: bossId, n: Math.max(0, n - have), needs, setupId: setup.id, why });
  }

  const gpGoals = [];
  // quest points available before quest `owner` (it can't count its own, or those after it)
  const questPointsPlanned = owner => {
    const done = new Set(Object.keys(sim.quests).filter(id => sim.quests[id] === 'complete'));
    for (const m of milestones) { if (m.kind === 'quest' && m.id === owner) break; if (m.kind === 'quest') done.add(m.id); }
    return [...done].reduce((t, id) => t + (quests[id]?.questPoints || 0), 0);
  };
  const qpShortfall = () => milestonesQP.map(r => ({ ...r, have: questPointsPlanned(r.owner) })).filter(r => r.have < r.qp);
  // Not enough quest points: add quests (placed early), the ones with the fewest unmet requirements first
  function fillQuestPoints() {
    let guard = 0;
    while (qpShortfall().length && guard++ < 300) {
      const planned = new Set(milestones.filter(m => m.kind === 'quest').map(m => m.id));
      const cands = Object.entries(quests).filter(([id, q]) => !q.miniquest && q.questPoints && sim.quests[id] !== 'complete' && !planned.has(id));
      if (!cands.length) break;
      const unmet = q => (q.requires?.all || []).filter(r => !(r.quest && planned.has(r.quest)) && !isMet(r, sim, reqCtx)).length;
      cands.sort((a, b) => unmet(a[1]) - unmet(b[1]) || b[1].questPoints - a[1].questPoints);
      const before = milestones.length;
      addQuest(cands[0][0]);
      addedForQp.push(cands[0][0]);
      // move the new quest (and what it pulled in) in front of the first quest that needs the points
      const added = milestones.splice(before);
      const owners = new Set(qpShortfall().map(r => r.owner));
      const at = milestones.findIndex(m => m.kind === 'quest' && owners.has(m.id));
      milestones.splice(at === -1 ? milestones.length : at, 0, ...added);
    }
  }
  const addedForQp = [];
  for (const g of goals) {
    if (g.type === 'level') finalLevels[g.skill] = Math.max(finalLevels[g.skill] || 0, g.level);
    else if (g.type === 'maxcape') SKILLS.forEach(s => { finalLevels[s] = Math.max(finalLevels[s] || 0, MAX_LEVEL); });
    else if (g.type === 'quest') addQuest(g.id);
    else if (g.type === 'kc') addKc(g.bossId, g.n);
    else if (g.type === 'milestone') { const b = bossById(g.bossId); if (b) addKc(b.id, b.milestone?.kc || 1); }
    else if (g.type === 'gp') gpGoals.push(g.amount);
  }

  fillQuestPoints();
  for (const r of qpShortfall()) {
    warnings.push(`${quests[r.owner]?.name || 'A quest'} needs ${r.qp} quest points; this plan has ${r.have} before it.`);
  }

  // ---- money makers available at a point in the plan ----
  function bestMoneyMaker() {
    let best = null;
    for (const b of bosses) {
      if (b.category === 'misc' || b.moneyMaker === false || (hideWild && b.wilderness)) continue;
      for (const s of b.setups) {
        if (!isMet(s.requires, sim, reqCtx)) continue;
        const m = bossMethod(b, items, { setupId: s.id });
        if (m.gpPerHr > 0 && (!best || m.gpPerHr > best.gpPerHr)) best = { name: `${b.name} (${s.label})`, gpPerHr: m.gpPerHr, wilderness: !!b.wilderness };
      }
    }
    for (const m of methods) {
      if (m.recurring || (hideWild && m.wilderness) || !isMet(m.requires, sim, reqCtx)) continue;
      const r = guideMethod(m, items, { cash: Math.max(sim.gp, 1) });
      if (r.missing.length || r.gpPerHr <= 0) continue;
      if (!best || r.gpPerHr > best.gpPerHr) best = { name: m.name, gpPerHr: r.gpPerHr, wilderness: m.wilderness, cappedBy: r.cappedBy };
    }
    return best;
  }

  function makeGp(amount, reason) {
    const amt = Math.ceil(amount / 100000) * 100000;
    const mm = bestMoneyMaker();
    if (!mm) { warnings.push(`No money maker available to fund: ${reason}.`); sim.gp += amt; steps.push({ kind: 'gp', amount: amt, method: null, hours: 0, reason }); return; }
    steps.push({ kind: 'gp', amount: amt, method: mm, hours: amt / mm.gpPerHr, reason });
    sim.gp += amt;
  }

  // pay for a step, making money first if needed
  function pay(cost, reason) {
    if (cost > 0 && sim.gp < cost) makeGp(cost - sim.gp, reason);
    sim.gp -= cost;
  }

  // Hitpoints isn't trained on its own: train a combat skill until Hitpoints gets there.
  // `prefer` = the combat skill the content leans on (e.g. Ranged for the Inferno).
  function trainHitpoints(level, prefer) {
    const missing = xpForLevel(level) - (sim.xp.Hitpoints || 0);
    if (missing <= 0) return;
    const skill = prefer || [...COMBAT_HP].sort((a, b) => (sim.xp[a] || 0) - (sim.xp[b] || 0))[0];
    const toXp = Math.min(200e6, (sim.xp[skill] || 0) + missing * 3);
    train(skill, levelForXp(toXp, { virtual: true }), { toXp, untilHp: level });
  }

  function train(skill, level, { toXp: exactXp, untilHp } = {}) {
    if (skill === 'Hitpoints' && !untilHp) return trainHitpoints(level);
    const toXp = exactXp ?? xpForLevel(level);
    const fromXp = sim.xp[skill] || 0;
    if (fromXp >= toXp) return;
    const track = applySwaps(trackFor(training, skill, intensity, { hideWild }), swaps, training, skill);
    if (!track) { warnings.push(`No training data for ${skill}.`); sim.xp[skill] = toXp; return; }
    let e = estimate(track, fromXp, toXp, items, { account: sim, ctx: reqCtx });
    let used = track;
    if (e.blocked) {
      // Blocked by a quest on the method: do it first if it's a small one (no unfinished quests
      // before it, and not one we're already in the middle of); otherwise use another track.
      const stage = [...track.stages].filter(st => st.from <= e.blocked).pop() || track.stages[0];
      const qs = (stage?.requires?.all || []).filter(r => r.quest && sim.quests[r.quest] !== 'complete').map(r => r.quest);
      const small = q => !doing.has(q) && quests[q] && (quests[q].requires?.all || []).every(r => !r.quest || sim.quests[r.quest] === 'complete');
      if (qs.length && qs.every(small)) {
        qs.forEach(q => doQuestNow(q));
        e = estimate(track, fromXp, toXp, items, { account: sim, ctx: reqCtx });
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
                   track: used, estimate: e, hours: e.hours, realHours: e.realHours, gp: e.gp, untilHp };
    pay(e.gp, `${skill} ${step.fromLevel}–${level}`);
    steps.push(step);
    sim.xp[skill] = toXp;
    // melee and Ranged training also give a third as much Hitpoints XP
    if (COMBAT_HP.has(skill)) sim.xp.Hitpoints = Math.min(200e6, (sim.xp.Hitpoints || 0) + (toXp - fromXp) / 3);
  }

  // Do a quest straight away (prerequisite quests and levels first), e.g. when a training
  // method needs it. Levels it needs are trained with the usual tracks.
  const doing = new Set();
  function doQuestNow(id) {
    if (sim.quests[id] === 'complete' || !quests[id] || doing.has(id)) return;
    doing.add(id);
    for (const r of quests[id].requires?.all || []) if (r.quest) doQuestNow(r.quest);
    const needs = {};
    const walk = r => { if (!r) return; if (r.all) r.all.forEach(walk); else if (r.any) walk(r.any[0]); else if (r.skill) needs[r.skill] = Math.max(needs[r.skill] || 0, r.level); };
    walk(quests[id].requires);
    trainNeeds(needs);
    steps.push({ kind: 'quest', id, name: quests[id].name, forTraining: true, hours: questHours(quests[id]) });
    sim.quests[id] = 'complete';
    doing.delete(id);
  }

  // ---- 2. walk the milestones in order ----
  // the combat skill a piece of content leans on: its highest combat-skill requirement
  const mainCombat = needs => Object.entries(needs).filter(([s]) => COMBAT_HP.has(s)).sort((a, b) => b[1] - a[1])[0]?.[0];
  const trainNeeds = needs => {
    for (const [skill, level] of Object.entries(needs)) if (skill !== 'Hitpoints') train(skill, level);
    if (needs.Hitpoints) trainHitpoints(needs.Hitpoints, mainCombat(needs));
  };

  for (const m of milestones) {
    trainNeeds(m.needs);
    if (m.kind === 'quest') {
      if (sim.quests[m.id] === 'complete') continue;
      steps.push({ kind: 'quest', id: m.id, name: quests[m.id].name, hours: questHours(quests[m.id]) });
      sim.quests[m.id] = 'complete';
    } else if (m.n > 0) {
      const b = bossById(m.id);
      const bm = bossMethod(b, items, { setupId: m.setupId });
      const hours = bm.unitsPerHr ? m.n / bm.unitsPerHr : 0;
      const gp = -bm.profitPerUnit * m.n;
      pay(Math.max(0, bm.costPerUnit * m.n), `${b.name} kills`);
      sim.gp += bm.lootPerUnit * m.n;
      steps.push({ kind: 'kc', bossId: b.id, name: b.name, n: m.n, unit: b.unit, setup: bm.setup.label, setupId: bm.setup.id, why: m.why,
                   setups: b.setups.map(s => ({ id: s.id, label: s.label, gearToBuy: gearToBuy(s) })), hours, gp,
                   met: isMet(bm.setup.requires, sim, reqCtx) });
      sim.kc[b.id] = (sim.kc[b.id] || 0) + m.n;
      if (b.milestone?.reward) sim.owned[b.milestone.reward] = 1;
    }
  }

  // ---- 3. level goals, then GP goals ----
  for (const s of SKILLS) if (finalLevels[s] && s !== 'Hitpoints') train(s, finalLevels[s]);
  if (finalLevels.Hitpoints) trainHitpoints(finalLevels.Hitpoints);     // after combat, which gives Hitpoints XP
  for (const amount of gpGoals) makeGp(amount, `your goal of ${amount.toLocaleString('en-GB')} GP`);


  const totals = steps.reduce((t, s) => {
    t.hours += s.hours || 0;
    t.realHours += s.realHours ?? s.hours ?? 0;
    if (s.kind === 'gp') t.gpMade += s.amount;
    else if (s.gp > 0) t.gpSpent += s.gp; else if (s.gp < 0) t.gpEarned += -s.gp;
    return t;
  }, { hours: 0, realHours: 0, gpMade: 0, gpSpent: 0, gpEarned: 0 });
  totals.endGp = sim.gp;
  return { steps, totals, warnings: [...new Set(warnings)], endAccount: sim };
}
