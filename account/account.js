// Account page: enter skills as levels or XP. Stored as XP; a level becomes the minimum XP for it.

import { SKILLS, levelForXp, toXp, MAX_LEVEL, MAX_XP } from '../core/xp.js';
import { combatLevel } from '../core/requirements.js';
import { loadAccount, saveAccount, freshAccount } from '../core/account.js';
import { loadQuests, loadItems, loadBosses, loadFile } from '../core/data.js';
import { requiredItems, prerequisiteQuests, questPoints } from '../core/requirements.js';
import { parseBank, resolveBank } from '../core/bank.js';
import { UNLOCKABLE_PRAYERS } from '../core/dps.js';
import { lookupPlayer } from '../core/hiscores.js';

console.log('Account: starting');
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('en-GB');
const UNIT_KEY = 'osrsplanner:accountUnit';

let account = loadAccount();
let unit = (() => { try { return localStorage.getItem(UNIT_KEY) || 'level'; } catch { return 'level'; } })();

function shownValue(skill) {
  const xp = account.xp[skill];
  return unit === 'level' ? levelForXp(xp) : xp;
}

function render() {
  document.querySelectorAll('#unit button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.unit === unit)));
  $('grid').innerHTML = SKILLS.map(s => `
    <label class="skill">
      <span class="name">${s}</span>
      <input type="number" inputmode="numeric" data-skill="${s}" value="${shownValue(s)}"
        min="${unit === 'level' ? (s === 'Hitpoints' ? 10 : 1) : 0}" max="${unit === 'level' ? MAX_LEVEL : MAX_XP}" step="1"
        aria-label="${s} ${unit === 'level' ? 'level' : 'XP'}">
      <span class="sub" data-sub="${s}">${sub(s)}</span>
    </label>`).join('');
  summary();
}

const sub = s => unit === 'level' ? `${fmt(account.xp[s])} xp` : `level ${levelForXp(account.xp[s])}`;

function summary() {
  const total = SKILLS.reduce((t, s) => t + levelForXp(account.xp[s]), 0);
  const totalXp = SKILLS.reduce((t, s) => t + account.xp[s], 0);
  $('summary').innerHTML = `<span><b>${total.toLocaleString('en-GB')}</b> total level</span>
    <span><b>${fmt(totalXp)}</b> total XP</span><span><b>${combatLevel(account.xp)}</b> combat</span>`;
  $('saved').textContent = account.updatedAt ? `Saved in this browser · ${new Date(account.updatedAt).toLocaleString('en-GB')}` : 'Not saved yet';
}

function commit() {
  account.updatedAt = new Date().toISOString();
  if (!saveAccount(account)) $('saved').textContent = "This browser won't save it (private mode or storage full): it lasts until you close the page.";
  else summary();
}

$('grid').addEventListener('change', e => {
  const s = e.target.dataset.skill;
  if (!s) return;
  const input = e.target;
  try {
    const next = toXp({ value: input.value === '' ? 0 : input.value, unit });
    // Typing the level it's already at keeps the exact XP (e.g. 75 with 1.3m XP stays 1.3m)
    if (!(unit === 'level' && levelForXp(account.xp[s]) === levelForXp(next))) account.xp[s] = next;
    if (s === 'Hitpoints') account.xp[s] = Math.max(account.xp[s], toXp({ value: 10, unit: 'level' }));
    input.setCustomValidity('');
  } catch {
    input.setCustomValidity(`Enter a ${unit === 'level' ? 'level from 1 to 99' : 'number of XP'}`);
    input.reportValidity();
    return;
  }
  input.value = shownValue(s);
  document.querySelector(`[data-sub="${s}"]`).textContent = sub(s);
  commit();
});

const gpText = n => n ? n.toLocaleString('en-GB') : '';
$('gp').value = gpText(account.gp);
$('gp').addEventListener('change', () => { account.gp = Math.max(0, Math.floor(Number($('gp').value.replace(/[, ]/g, '')) || 0)); $('gp').value = gpText(account.gp); commit(); });

$('unit').addEventListener('click', e => {
  const u = e.target.dataset.unit;
  if (!u || u === unit) return;
  unit = u;
  try { localStorage.setItem(UNIT_KEY, unit); } catch {}
  render();
});

$('reset').addEventListener('click', () => {
  if (!confirm('Clear all your stats on this page? This cannot be undone.')) return;
  account = freshAccount();
  commit();
  bankStatus();
  $('gp').value = '';
  render();
  renderQuests();
  renderUnlocks();
});

// Quests: tick the ones you've completed. Ticking a quest also ticks the quests it requires.
// Listed by questline (data/quest-series.json, in story order), then the rest A-Z.
let QUESTS = {}, SERIES = {};
async function renderQuests() {
  [{ quests: QUESTS }, { series: SERIES }] = await Promise.all([loadQuests(), loadFile('quest-series.json').catch(() => ({ series: {} }))]);
  const f = ($('quest-search').value || '').trim().toLowerCase();
  const done = Object.keys(account.quests).filter(id => account.quests[id] === 'complete').length;
  $('quest-summary').textContent = `${done} of ${Object.keys(QUESTS).length} done · ${questPoints(account, QUESTS)} quest points`;
  const box = id => { const q = QUESTS[id];
    return `<label class="quest"><input type="checkbox" data-quest="${id}"${account.quests[id] === 'complete' ? ' checked' : ''}> ${q.name}${q.miniquest ? ' <span class="mini">mini</span>' : ''}</label>`; };
  const shown = id => QUESTS[id] && (!f || QUESTS[id].name.toLowerCase().includes(f));
  const inSeries = new Set(Object.values(SERIES).flat());
  const groups = Object.entries(SERIES).map(([name, ids]) => [name, ids.filter(shown), true])
    .concat([[Object.keys(SERIES).length ? 'Other quests' : 'Quests', Object.keys(QUESTS).filter(id => !inSeries.has(id) && shown(id)).sort((a, b) => QUESTS[a].name.localeCompare(QUESTS[b].name)), false]])
    .filter(([, ids]) => ids.length);
  $('quests').innerHTML = groups.map(([name, ids, numbered]) => `<div class="series"><h3>${name}<button type="button" data-series-all="${ids.join(',')}">tick all</button></h3>
    <div class="grid">${ids.map(id => numbered ? `<span class="quest"><span class="n">${(SERIES[name].indexOf(id) + 1)}.</span>${box(id)}</span>` : box(id)).join('')}</div></div>`).join('')
    || '<p class="hint">No quests match.</p>';
}
function tick(ids, on) {
  for (const id of ids) {
    if (on) { account.quests[id] = 'complete'; for (const p of prerequisiteQuests(id, QUESTS)) account.quests[p] = 'complete'; }
    else delete account.quests[id];
  }
  commit(); renderQuests();
}
const visibleQuestIds = () => [...document.querySelectorAll('#quests input[data-quest]')].map(x => x.dataset.quest);
$('quests').addEventListener('change', e => { const id = e.target.dataset.quest; if (id) tick([id], e.target.checked); });
$('quests').addEventListener('click', e => { const ids = e.target.dataset?.seriesAll; if (ids) tick(ids.split(','), true); });
$('quest-all').addEventListener('click', () => tick(visibleQuestIds(), true));
$('quest-none').addEventListener('click', () => {
  const ids = visibleQuestIds();
  if (ids.length > 5 && !confirm(`Untick ${ids.length} quests?`)) return;
  tick(ids, false);
});
$('quest-search').addEventListener('input', () => renderQuests());

// Unlocks: items that requirements depend on (e.g. a Fire cape for the Inferno)
async function renderUnlocks() {
  const [items, { bosses }] = await Promise.all([loadItems(), loadBosses()]);
  const keys = requiredItems(bosses).sort((a, b) => items.get(a)?.name.localeCompare(items.get(b)?.name));
  $('unlocks').innerHTML = keys.map(k => `
    <label class="quest"><input type="checkbox" data-owned="${k}"${account.owned[k] || account.bank[k] ? ' checked' : ''}${account.bank[k] ? ' disabled' : ''}> ${items.get(k)?.name ?? k}${account.bank[k] ? ' <span class="mini">in bank</span>' : ''}</label>`).join('');
}
$('unlocks').addEventListener('change', e => {
  const k = e.target.dataset.owned;
  if (!k) return;
  if (e.target.checked) account.owned[k] = 1; else delete account.owned[k];
  commit();
});

// Prayers unlocked (for the DPS calculator)
function renderPrayers() {
  const have = new Set(account.prayers || []);
  $('prayers').innerHTML = UNLOCKABLE_PRAYERS.map(p =>
    `<label class="quest"><input type="checkbox" data-prayer="${p.id}"${have.has(p.id) ? ' checked' : ''}> ${p.label}</label>`).join('');
}
renderPrayers();
$('prayers').addEventListener('change', e => {
  const id = e.target.dataset.prayer;
  if (!id) return;
  const have = new Set(account.prayers || []);
  if (e.target.checked) have.add(id); else have.delete(id);
  account.prayers = [...have];
  commit();
});

// Achievement diaries, stored as 'region:tier'; a tier counts the ones below it too
const DIARY_REGIONS = [['ardougne', 'Ardougne'], ['desert', 'Desert'], ['falador', 'Falador'], ['fremennik', 'Fremennik'],
  ['kandarin', 'Kandarin'], ['karamja', 'Karamja'], ['kourend', 'Kourend & Kebos'], ['lumbridge', 'Lumbridge & Draynor'],
  ['morytania', 'Morytania'], ['varrock', 'Varrock'], ['western', 'Western Provinces'], ['wilderness', 'Wilderness']];
const DIARY_TIERS = ['easy', 'medium', 'hard', 'elite'];
function renderDiaries() {
  const have = new Set(account.diaries || []);
  $('diaries').innerHTML = `<thead><tr><th>Region</th>${DIARY_TIERS.map(t => `<th>${t[0].toUpperCase() + t.slice(1)}</th>`).join('')}</tr></thead><tbody>`
    + DIARY_REGIONS.map(([id, label]) => `<tr><td>${label}</td>${DIARY_TIERS.map(t =>
      `<td><input type="checkbox" style="width:auto" data-diary="${id}:${t}" aria-label="${label} ${t}"${have.has(`${id}:${t}`) ? ' checked' : ''}></td>`).join('')}</tr>`).join('') + '</tbody>';
}
renderDiaries();
$('diaries').addEventListener('change', e => {
  const key = e.target.dataset.diary;
  if (!key) return;
  const [region, tier] = key.split(':'), i = DIARY_TIERS.indexOf(tier);
  const have = new Set(account.diaries || []);
  // ticking a tier ticks the ones below; unticking one unticks the ones above
  DIARY_TIERS.forEach((t, j) => { if (e.target.checked && j <= i) have.add(`${region}:${t}`); if (!e.target.checked && j >= i) have.delete(`${region}:${t}`); });
  account.diaries = [...have];
  commit();
  renderDiaries();
});

// Bank: a pasted Bank Memory export, matched to known items; replaces the previous import
function bankStatus(extra = '') {
  const n = Object.keys(account.bank).length;
  $('bank-status').textContent = extra || (n ? `${n.toLocaleString('en-GB')} relevant items from your bank, imported ${new Date(account.bankImportedAt).toLocaleDateString('en-GB')}.` : 'No bank imported.');
}
$('bank-import').addEventListener('click', async () => {
  const rows = parseBank($('bank-text').value);
  if (!rows.length) return bankStatus("Couldn't find any items. Paste the whole export, including the tab-separated columns.");
  const [{ items }, tiers] = await Promise.all([loadItems(), loadFile('gear-tiers.json')]);
  const r = resolveBank(rows, items, tiers);
  account.bank = r.bank;
  account.bankIds = {};                       // every item by ID, for the DPS calculator's gear
  for (const row of rows) account.bankIds[row.id] = (account.bankIds[row.id] || 0) + row.qty;
  account.bankImportedAt = new Date().toISOString();
  let gpNote = '';
  if (r.gp != null) { account.gp = r.gp; $('gp').value = gpText(r.gp); gpNote = ` Cash stack set to the ${gpText(r.gp)} coins in it.`; }
  commit();
  $('bank-text').value = '';
  renderUnlocks();
  bankStatus(`Imported ${rows.length.toLocaleString('en-GB')} items; ${Object.keys(r.bank).length.toLocaleString('en-GB')} are ones the planner uses.${gpNote}`);
});
$('bank-clear').addEventListener('click', () => {
  account.bank = {}; account.bankIds = {}; account.bankImportedAt = null; commit(); renderUnlocks(); bankStatus();
});

// Hiscores: fill skills (and boss kill counts) from the OSRS hiscores via Wise Old Man
$('rsn').value = account.rsn || '';
async function lookup() {
  const btn = $('lookup'); btn.disabled = true;
  $('lookup-status').textContent = 'Looking up…';
  try {
    const { bosses } = await loadBosses();
    const r = await lookupPlayer($('rsn').value, bosses.map(b => b.id));
    account.xp = { ...account.xp, ...r.xp };
    account.kc = { ...account.kc, ...r.kc };
    account.rsn = r.name;
    commit(); render();
    const nKc = Object.keys(r.kc).length;
    $('lookup-status').textContent = `Loaded ${r.name}: ${Object.keys(r.xp).length} skills${nKc ? ` and ${nKc} boss kill counts` : ''} from the hiscores`
      + (r.refreshed ? '.' : ` (last saved ${new Date(r.updatedAt).toLocaleDateString('en-GB')}; a fresh lookup wasn't possible right now).`)
      + ' Quests and items aren\'t on the hiscores, so tick those below.';
  } catch (err) {
    $('lookup-status').textContent = err.message || 'The lookup failed.';
  } finally { btn.disabled = false; }
}
$('lookup').addEventListener('click', lookup);
$('rsn').addEventListener('keydown', e => { if (e.key === 'Enter') lookup(); });

render();
bankStatus();
renderUnlocks().catch(err => { $('unlocks').textContent = `Couldn't load unlocks (${err.message}).`; });
renderQuests().catch(err => { $('quests').textContent = `Couldn't load the quest list (${err.message}).`; })
  .finally(() => { document.documentElement.dataset.ready = '1'; });
