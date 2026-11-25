// Goal Planner page: goals in, ordered steps out. Methods in training steps can be swapped for
// another method of the same skill; the whole plan (time, costs, money to make) recalculates.

import { loadItems, loadBosses, loadQuests, loadMethods, loadTraining, loadFile } from '../core/data.js';
import { loadSlayer as slayerStore } from '../core/slayer-store.js';
import { plan, stageOptions } from '../core/planner.js';
import { SKILLS } from '../core/xp.js';
import { gpPerXp } from '../core/training.js';
import { loadAccount, hasAccount, freshAccount } from '../core/account.js';
import { describe } from '../core/requirements.js';

console.log('Planner: starting');
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'osrsplanner:plan';
const gpShort = n => { const a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e9 ? s + (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? s + Math.round(a / 1e3) + 'K' : s + Math.round(a); };
const hrs = h => h >= 100 ? `${Math.round(h).toLocaleString('en-GB')} h` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(h * 60)} min`;
const wiki = t => `https://oldschool.runescape.wiki/w/${encodeURI(t.replace(/ /g, '_'))}`;

let D = null, ACCOUNT = null;
let state = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } })() || { goals: [], intensity: 'balanced', swaps: [] };
state.setups ||= {};
state.gpChoices ||= {}; delete state.gpChoice;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
const hideWild = () => { try { return localStorage.getItem('osrsplanner:hide-wild') === '1'; } catch { return false; } };

function goalLabel(g) {
  if (g.type === 'level') return `${g.level} ${g.skill}`;
  if (g.type === 'maxcape') return 'Max cape (all 99s)';
  if (g.type === 'quest') return D.quests[g.id]?.name || g.id;
  if (g.type === 'kc') return `${g.n} ${D.bossName(g.bossId)} kills`;
  if (g.type === 'milestone') { const b = D.bosses.find(x => x.id === g.bossId); return b?.milestone?.label || b?.name; }
  if (g.type === 'gp') return `${gpShort(g.amount)} GP`;
}

function renderGoalForm() {
  const t = $('goal-type').value;
  const f = $('goal-fields');
  if (t === 'level') f.innerHTML = `<select id="g-skill">${SKILLS.map(s => `<option>${s}</option>`).join('')}</select><input type="number" id="g-level" min="2" max="99" value="99" aria-label="Level">`;
  else if (t === 'quest') f.innerHTML = `<input list="quest-names" id="g-quest" placeholder="Type a quest name" style="width:280px">`;
  else if (t === 'kc') f.innerHTML = `<select id="g-boss">${D.bosses.filter(b => b.category !== 'misc').sort((a, b) => a.name.localeCompare(b.name)).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select><input type="number" id="g-n" min="1" value="50" aria-label="Kills">`;
  else if (t === 'milestone') f.innerHTML = `<select id="g-milestone">${D.bosses.filter(b => b.milestone).map(b => `<option value="${b.id}">${esc(b.milestone.label)} (${esc(b.name)})</option>`).join('')}</select>`;
  else if (t === 'gp') f.innerHTML = `<input type="text" inputmode="numeric" id="g-gp" placeholder="e.g. 100,000,000" style="width:180px">`;
  else f.innerHTML = '';
}

function addGoal() {
  const t = $('goal-type').value;
  let g = null;
  if (t === 'level') g = { type: 'level', skill: $('g-skill').value, level: Math.max(2, Math.min(99, parseInt($('g-level').value) || 99)) };
  else if (t === 'maxcape') g = { type: 'maxcape' };
  else if (t === 'quest') {
    const name = $('g-quest').value.trim().toLowerCase();
    const id = Object.keys(D.quests).find(k => D.quests[k].name.toLowerCase() === name);
    if (!id) { $('g-quest').setCustomValidity('Pick a quest from the list'); $('g-quest').reportValidity(); return; }
    g = { type: 'quest', id };
  } else if (t === 'kc') g = { type: 'kc', bossId: $('g-boss').value, n: Math.max(1, parseInt($('g-n').value) || 1) };
  else if (t === 'milestone') g = { type: 'milestone', bossId: $('g-milestone').value };
  else if (t === 'gp') { const n = Number(($('g-gp').value || '').replace(/[, ]/g, '')); if (!(n > 0)) return; g = { type: 'gp', amount: n }; }
  state.goals.push(g); save(); render();
}

function segmentHtml(step, seg) {
  const opts = stageOptions(D.training, step.skill, seg.fromLevel);
  const cur = seg.stage.swapRef || opts.find(o => o.stage.name === seg.stage.name)?.ref || opts.find(o => o.name === seg.stage.name.replace(/\s*\([^)]*\)\s*$/, ''))?.ref || '';
  const cost = seg.gp > 0 ? `<span class="cost">${gpShort(seg.gp)}</span>` : seg.gp < 0 ? `<span class="gain">+${gpShort(-seg.gp)}</span>` : '';
  const ctx = { quests: D.quests, items: D.items };
  return `<li class="seg${seg.stage.swapped ? ' swapped' : ''}">
    <span class="lv">${seg.fromLevel}–${seg.toLevel}</span>
    <select data-swap="${step.skill}|${seg.fromLevel}|${seg.toLevel}" aria-label="Method for ${step.skill} ${seg.fromLevel}-${seg.toLevel}">
      ${opts.map(o => `<option value="${o.ref}"${o.ref === cur ? ' selected' : ''}>${esc(o.name)} · ${Math.round(o.stage.xpPerHr / 1000)}K/hr${o.stage.wilderness ? ' · Wilderness' : ''}${o.track.kind !== step.track.kind ? ` (${o.track.label})` : ''}</option>`).join('')}
    </select>
    <span class="meta">${seg.hours != null ? hrs(seg.hours) : 'recurring'} ${cost}${seg.stage.xpEach || seg.stage.costPerHr ? ` · ${gpPerXp(seg.stage, D.items).toFixed(1)} gp/XP` : ''}</span>
    ${seg.stage.swapped ? `<button type="button" class="reset" data-unswap="${esc(seg.stage.swapRef)}|${step.skill}|${seg.fromLevel}" title="Back to the suggested method">↺ Back to suggested</button>` : ''}
    ${seg.stage.requires ? `<div class="note">Needs ${esc(describe(seg.stage.requires, ctx))}</div>` : ''}
    ${seg.stage.note ? `<div class="note">${esc(seg.stage.note)}</div>` : ''}
  </li>`;
}

function stepHtml(s, i) {
  if (s.kind === 'train') {
    const cost = s.gp > 0 ? `<span class="cost">${gpShort(s.gp)} cost</span>` : s.gp < 0 ? `<span class="gain">${gpShort(-s.gp)} profit</span>` : '';
    return `<li class="step train${s.estimate.segments.some(g => g.stage.swapped) ? ' changed' : ''}"><div class="head"><span class="n">${i + 1}</span><b>Train ${esc(s.skill)}</b>${s.slayer?.targets?.length ? ` <span class="muted">${esc(slayerTarget(s.slayer.targets))}</span>` : ''} ${s.untilHp ? `until ${s.untilHp} Hitpoints <span class="muted">(${esc(s.skill)} ${s.fromLevel} → ${s.toLevel})</span>` : `${s.fromLevel} → ${s.toLevel}${s.towardsHp ? ` <span class="muted">(towards ${s.towardsHp} Hitpoints)</span>` : ''}`}
      <span class="right">${hrs(s.hours)}${s.realHours > s.hours * 1.5 ? ` · ${Math.ceil(s.realHours / 24)} days of growing` : ''} ${cost}</span></div>
      ${s.slayer ? slayerHtml(s) : `<ul class="segs">${s.estimate.segments.map(seg => segmentHtml(s, seg)).join('')}</ul>`}</li>`;
  }
  if (s.kind === 'quest') return `<li class="step quest"><div class="head"><span class="n">${i + 1}</span><b>Quest:</b> <a href="${wiki(s.name)}" target="_blank" rel="noopener">${esc(s.name)}</a>
      <span class="right">~${hrs(s.hours || 0)}${s.forTraining ? ' · unlocks a training method' : ''}</span></div></li>`;
  if (s.kind === 'kc') {
    const pick = s.setups.length > 1
      ? `<select data-setup="${esc(s.bossId)}" aria-label="Setup for ${esc(s.name)}">${s.setups.map(o => `<option value="${esc(o.id)}"${o.id === s.setupId ? ' selected' : ''}>${esc(o.label)} setup</option>`).join('')}</select>`
        + (s.why === 'chosen' ? ` <button type="button" class="reset" data-unsetup="${esc(s.bossId)}" title="Back to the suggested setup">↺ Back to suggested</button>` : '')
      : `<span class="muted">(${esc(s.setup)} setup)</span>`;
    const high = s.setups.find(o => o.id !== 'budget');
    const why = { affordable: 'High level: you meet its requirements and your cash stack covers its gear',
                  gear: `Budget: your cash stack doesn't cover the High level gear (${gpShort(high?.gearToBuy || 0)} to buy)`,
                  requirements: "Budget: you don't meet the High level requirements yet",
                  unknown: "Budget: the High level gear isn't in the data yet, so the planner can't tell if you can afford it" }[s.why];
    return `<li class="step kc${s.why === 'chosen' ? ' changed' : ''}"><div class="head"><span class="n">${i + 1}</span><b>Kill ${esc(s.name)}</b> × ${s.n} ${pick}
      <span class="right">${hrs(s.hours)} ${s.gp < 0 ? `<span class="gain">${gpShort(-s.gp)} profit</span>` : s.gp > 0 ? `<span class="cost">${gpShort(s.gp)} cost</span>` : ''}</span></div>${why ? `<div class="note">${why}</div>` : ''}${gearNote(s)}</li>`;
  }
  const pick = s.options?.length ? `<select data-gpmm="${esc(s.key)}" aria-label="Money maker">${s.options.map(o => `<option value="${esc(o.id)}"${o.id === s.method?.id ? ' selected' : ''}>${esc(o.name)} · ${gpShort(o.gpPerHr)}/hr${o.wilderness ? ' (Wilderness)' : ''}</option>`).join('')}</select>`
    + (state.gpChoices[s.key] ? ` <button type="button" class="reset" data-ungp="${esc(s.key)}" title="Back to the best money maker">↺ Back to suggested</button>` : '') : '';
  return `<li class="step gp${s.chosen ? ' changed' : ''}"><div class="head"><span class="n">${i + 1}</span><b>Make ${gpShort(s.amount)} GP</b> ${s.method ? `at ${pick || esc(s.method.name)}${s.method.wilderness ? ' <span class="wild">Wilderness</span>' : ''}` : '<span class="cost">no money maker available</span>'}
      <span class="right">${hrs(s.hours)}</span></div><div class="note">For ${esc(s.reason)}${s.method ? ` · ${gpShort(s.method.gpPerHr)}/hr` : ''}${s.choiceUnavailable ? ' · your chosen money maker isn\'t available yet here, so this uses the best one' : ''}</div></li>`;
}

// Gear the chosen setup still needs (not owned or in the imported bank)
function gearNote(s) {
  if (!s.gearMissing?.length) return '';
  const cost = s.setups.find(o => o.id === s.setupId)?.gearToBuy || 0;
  return `<div class="note">Gear to get${cost ? ` (${gpShort(cost)})` : ''}: ${s.gearMissing.map(esc).join(', ')}</div>`;
}

// A Slayer step: the master for each range (from the Slayer tab's settings), its own training style,
// expected points and the combat XP the tasks give along the way
// "on Defence until 75, then Strength": the attack style to use for the combat XP the tasks give
function slayerTarget(ts) {
  const parts = ts.map(t => t.defensive ? `${t.skill} on a defensive style` : t.rest ? t.skill : t.filled ? `${t.skill} until ${t.level}` : t.skill);
  return '· train ' + parts.join(', then ');
}
function slayerHtml(s) {
  const inten = s.slayer.intensity;
  const segs = s.estimate.segments.map(g => `<li class="seg"><span class="lv">${g.fromLevel}–${g.toLevel}</span>
      <span>${esc(g.stage.name)} · ${Math.round(g.stage.xpPerHr / 1000)}K XP/hr${g.stage.pointsPerHr != null ? ` · ${g.stage.pointsPerHr >= 0 ? '+' : ''}${Math.round(g.stage.pointsPerHr)} points/hr` : ''}</span>
      <span class="meta">${hrs(g.hours)}</span></li>`).join('');
  const xp = Object.entries(s.slayer.combatXp).map(([k, v]) => `${gpShort(v)} ${k}`).join(', ');
  return `<div class="row slayer-opts"><label class="muted">Style for this step <select data-slayer-intensity aria-label="Slayer training style">
      ${['fastest', 'balanced', 'afk'].map(k => `<option value="${k}"${k === inten ? ' selected' : ''}>${{ fastest: 'Fastest', balanced: 'Balanced', afk: 'AFK' }[k]}</option>`).join('')}</select></label>
      ${state.slayerIntensity ? '<button type="button" class="reset" data-unslayer title="Back to the plan\'s training style">↺ Back to suggested</button>' : ''}
      <a href="../slayer/">Blocks, skips and methods on the Slayer tab</a></div>
    <ul class="segs">${segs}</ul>
    ${xp ? `<div class="note">The tasks also give about ${xp} XP, with your attack style set as in the heading. The rest of the plan counts it.</div>` : ''}`;
}

function render() {
  document.querySelectorAll('#intensity button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.i === state.intensity)));
  $('goals').innerHTML = state.goals.length ? state.goals.map((g, i) => `<span class="chip">${esc(goalLabel(g))}<button type="button" data-remove="${i}" aria-label="Remove">×</button></span>`).join('')
    : '<span class="muted">No goals yet: add one above.</span>';
  const nSetups = Object.keys(state.setups).length;
  const changes = [state.swaps.length && `${state.swaps.length} method swap${state.swaps.length > 1 ? 's' : ''}`, nSetups && `${nSetups} setup choice${nSetups > 1 ? 's' : ''}`, Object.keys(state.gpChoices).length && `${Object.keys(state.gpChoices).length} money maker choice${Object.keys(state.gpChoices).length > 1 ? 's' : ''}`, state.slayerIntensity && 'the Slayer style'].filter(Boolean);
  $('swaps-note').innerHTML = changes.length ? `Your changes: ${changes.join(', ')}. <button type="button" class="reset" id="clear-swaps">↺ Reset all changes</button>` : '';
  if (!state.goals.length) { $('summary').innerHTML = ''; $('steps').innerHTML = ''; $('warnings').innerHTML = ''; document.documentElement.dataset.ready = '1'; return; }
  const r = plan(state.goals, { items: D.items, training: D.training, quests: D.quests, bosses: D.bosses, methods: D.methods,
                                 account: ACCOUNT, intensity: state.intensity, swaps: state.swaps, setupChoices: state.setups, gpChoices: state.gpChoices, hideWild: hideWild(),
                                 slayer: D.slayerData && { data: D.slayerData, settings: slayerStore(), intensity: state.slayerIntensity } });
  const t = r.totals;
  $('summary').innerHTML = `<div><span class="lbl">Time</span>${hrs(t.hours)}${t.realHours > t.hours * 1.2 ? ` <span class="muted">(${Math.ceil(t.realHours / 24)} days including growing)</span>` : ''}</div>
    <div><span class="lbl">Money to make</span>${gpShort(t.gpMade)}</div>
    <div><span class="lbl">Spent on training</span><span class="cost">${gpShort(t.gpSpent)}</span></div>
    <div><span class="lbl">Earned along the way</span><span class="gain">${gpShort(t.gpEarned)}</span></div>
    <div><span class="lbl">Steps</span>${r.steps.length}</div>`;
  $('warnings').innerHTML = r.errors.map(w => `<li class="error">${esc(w)}</li>`).join('') + r.warnings.map(w => `<li>${esc(w)}</li>`).join('');
  $('steps').innerHTML = r.steps.map(stepHtml).join('') || (r.errors.length ? '' : '<li class="muted">Nothing to do: you already meet these goals.</li>');
  document.documentElement.dataset.ready = '1';
}

async function init() {
  const [items, { bosses }, { quests }, { methods }, training, slayerData] = await Promise.all([loadItems(), loadBosses(), loadQuests(), loadMethods(), loadTraining(), loadFile('slayer.json').catch(() => null)]);
  D = { items: items.items, bosses, quests, methods, training, slayerData, bossName: id => bosses.find(b => b.id === id)?.name || id };
  ACCOUNT = hasAccount() ? loadAccount() : freshAccount();
  $('acct-note').innerHTML = hasAccount() ? 'Planning from your stats, quests and cash on <a href="../account/">My Account</a>.'
    : 'Planning from a brand-new account. <a href="../account/">Enter your stats</a> to plan from where you are.';
  $('quest-names').innerHTML = Object.values(quests).map(q => `<option value="${esc(q.name)}">`).join('');
  $('goal-type').addEventListener('change', renderGoalForm);
  renderGoalForm();
  $('add-goal').addEventListener('click', addGoal);
  $('goals').addEventListener('click', e => { if (e.target.dataset.remove != null) { state.goals.splice(+e.target.dataset.remove, 1); save(); render(); } });
  $('intensity').addEventListener('click', e => { if (e.target.dataset.i) { state.intensity = e.target.dataset.i; save(); render(); } });
  $('steps').addEventListener('change', e => {
    if (e.target.dataset?.slayerIntensity !== undefined) { state.slayerIntensity = e.target.value; save(); render(); return; }
    if (e.target.dataset?.gpmm !== undefined) { state.gpChoices[e.target.dataset.gpmm] = e.target.value; save(); render(); return; }
    const b = e.target.dataset?.setup; if (!b) return;
    state.setups[b] = e.target.value; save(); render();
  });
  $('steps').addEventListener('click', e => {
    if (e.target.dataset?.unslayer !== undefined) { delete state.slayerIntensity; save(); render(); return; }
    if (e.target.dataset?.ungp !== undefined) { delete state.gpChoices[e.target.dataset.ungp]; save(); render(); return; }
    const b = e.target.dataset?.unsetup; if (!b) return;
    delete state.setups[b]; save(); render();
  });
  $('swaps-note').addEventListener('click', e => { if (e.target.id === 'clear-swaps') { state.swaps = []; state.setups = {}; state.gpChoices = {}; delete state.slayerIntensity; save(); render(); } });
  $('steps').addEventListener('change', e => {
    const k = e.target.dataset.swap;
    if (!k) return;
    const [skill, from, to] = k.split('|');
    state.swaps = state.swaps.filter(s => !(s.skill === skill && s.fromLevel === +from));
    state.swaps.push({ skill, fromLevel: +from, toLevel: +to, ref: e.target.value });
    save(); render();
  });
  $('steps').addEventListener('click', e => {
    const k = e.target.dataset.unswap;
    if (!k) return;
    const [ref, skill, from] = k.split('|');
    state.swaps = state.swaps.filter(s => !(s.skill === skill && s.fromLevel === +from && s.ref === ref));
    save(); render();
  });
  render();
}

init().catch(err => { $('steps').innerHTML = `<li class="error">Couldn't load the app's data (${esc(err.message)}).</li>`; console.error(err); });
