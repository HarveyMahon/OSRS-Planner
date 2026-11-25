// Training: time and cost from your level to a target, for each way of training a skill.

import { loadItems, loadTraining, loadQuests } from '../core/data.js';
import { estimate, gpPerXp } from '../core/training.js';
import { SKILLS, xpForLevel, levelForXp } from '../core/xp.js';
import { loadAccount, hasAccount, forRequirements } from '../core/account.js';
import { describe } from '../core/requirements.js';

console.log('Training: starting');
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = { get(k) { try { return localStorage.getItem('osrsplanner:' + k); } catch { return null; } },
                set(k, v) { try { localStorage.setItem('osrsplanner:' + k, v); } catch {} } };
const gpShort = n => { const a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e9 ? s + (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1e3 ? s + Math.round(a / 1e3) + 'K' : s + Math.round(a); };
const hrs = h => h >= 100 ? `${Math.round(h)} h` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(h * 60)} min`;
const KIND = { fastest: 'Fastest', balanced: 'Balanced', afk: 'AFK' };
const DOTS = n => '●'.repeat(n) + '○'.repeat(5 - n);

let ITEMS, TRAINING, QUESTS, ACCOUNT = null;

function render() {
  const skill = $('skill').value;
  const fromLvl = Math.max(1, Math.min(126, parseInt($('from').value) || 1));
  const toLvl = Math.max(fromLvl + 1, Math.min(126, parseInt($('to').value) || 99));
  const fromXp = ACCOUNT && store.get('trainFromAccount') !== '0' && levelForXp(ACCOUNT.xp[skill]) === fromLvl ? ACCOUNT.xp[skill] : xpForLevel(fromLvl);
  const tracks = TRAINING.skills[skill] || [];
  if (!tracks.length) { $('results').innerHTML = `<p class="muted">No training data for ${esc(skill)} yet.</p>`; return; }
  const ctx = { quests: QUESTS.quests };
  $('results').innerHTML = tracks.map(t => {
    const e = estimate(t, fromXp, xpForLevel(toLvl), ITEMS.items, { account: ACCOUNT, ctx, others: tracks });
    const cost = e.gp > 0 ? `<span class="cost">${gpShort(e.gp)} cost</span>` : e.gp < 0 ? `<span class="gain">${gpShort(-e.gp)} profit</span>` : 'no item cost';
    const time = e.blocked ? `<span class="cost">No method you can use at level ${e.blocked}${e.blockedBy ? ` (needs ${esc(describe(e.blockedBy, ctx))})` : ''}</span>`
      : `${hrs(e.hours)}${e.realHours > e.hours * 1.5 ? ` <span class="muted">(${Math.ceil(e.realHours / 24)} days of growing)</span>` : ''}`;
    const segs = e.segments.map(s => `<li><b>${s.fromLevel}–${s.toLevel}</b> ${esc(s.stage.name)}
        <span class="muted">${Math.round(s.stage.xpPerHr / 1000)}K XP/hr${s.hours != null ? ` · ${hrs(s.hours)}` : ''}${s.stage.xpEach || s.stage.costPerHr ? ` · ${gpPerXp(s.stage, ITEMS.items).toFixed(1)} gp/XP` : ''}${s.stage.wilderness ? ' · <span class="wild">Wilderness</span>' : ''}${s.stage.requires ? ` · needs ${esc(describe(s.stage.requires, ctx))}` : ''}</span>
        ${s.instead ? `<div class="note">Instead of ${esc(s.instead.name)}, which needs ${esc(describe(s.instead.requires, ctx))}.</div>` : ''}
        ${s.stage.note ? `<div class="note">${esc(s.stage.note)}</div>` : ''}</li>`).join('');
    return `<article class="card track ${t.kind}">
      <header><span class="kind">${KIND[t.kind]}</span><h2>${esc(t.label)}</h2><span class="dots" title="Intensity ${t.intensity} of 5">${DOTS(t.intensity)}</span></header>
      <div class="sum"><div><span class="lbl">Time</span>${time}</div><div><span class="lbl">Cost</span>${cost}</div></div>
      ${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}
      <ol>${segs}</ol></article>`;
  }).join('');
}

async function init() {
  [ITEMS, TRAINING, QUESTS] = await Promise.all([loadItems(), loadTraining(), loadQuests()]);
  if (hasAccount()) ACCOUNT = forRequirements(loadAccount());
  $('skill').innerHTML = SKILLS.map(s => `<option>${s}</option>`).join('');
  $('skill').value = store.get('trainSkill') || 'Prayer';
  const setFrom = () => { $('from').value = ACCOUNT ? levelForXp(ACCOUNT.xp[$('skill').value]) : (store.get('trainFrom') || 1); };
  setFrom();
  $('to').value = store.get('trainTo') || 99;
  $('skill').addEventListener('change', () => { store.set('trainSkill', $('skill').value); setFrom(); render(); });
  $('from').addEventListener('change', () => { store.set('trainFrom', $('from').value); render(); });
  $('to').addEventListener('change', () => { store.set('trainTo', $('to').value); render(); });
  $('acct-note').innerHTML = ACCOUNT ? 'Starting from your level on My Account; stages you lack requirements for are skipped.'
    : '<a href="../account/">Enter your stats</a> to start from your levels and skip stages you can\'t do yet.';
  render();
  document.documentElement.dataset.ready = '1';
}

init().catch(err => { $('results').innerHTML = `<div class="error">Couldn't load training data (${esc(err.message)}).</div>`; });
