// Slayer tab: choose a master and customise the task list. Settings are saved for the Goal Planner.
import { loadFile, loadQuests } from '../core/data.js';
import { loadAccount, hasAccount, forRequirements } from '../core/account.js';
import { slayerSettings, masterLocked, masterRates, planFor, bestMaster, blockSlotsFor } from '../core/slayer.js';
import { questPoints } from '../core/requirements.js';
import { loadSlayer, saveSlayer } from '../core/slayer-store.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const k = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : Math.round(n).toString();
const hm = h => h >= 1 ? `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m` : `${Math.round(h * 60)}m`;

let DATA, raw = loadSlayer();
const ACCOUNT = forRequirements(loadAccount());
const S = () => slayerSettings(raw);
const save = () => { saveSlayer(raw); render(); };

function current() {
  const s = S(), inten = s.intensity || 'fastest';
  if (s.master !== 'auto') {
    const m = { id: s.master, ...DATA.masters[s.master] };
    const plan = planFor(m, DATA, ACCOUNT, s, inten);
    return { id: s.master, master: m, plan, rates: masterRates(m, DATA, ACCOUNT, s, plan, inten), inten };
  }
  const b = bestMaster(DATA, ACCOUNT, s, inten);
  return b && { ...b, inten };
}

function render() {
  const s = S();
  $('master').innerHTML = `<option value="auto">Best for my account</option>` + Object.entries(DATA.masters).map(([id, m]) => {
    const why = masterLocked({ id, ...m }, ACCOUNT);
    return `<option value="${id}"${s.master === id ? ' selected' : ''}>${esc(m.name)}${why ? ` (${why})` : ''}</option>`;
  }).join('');
  if (s.master === 'auto') $('master').value = 'auto';
  for (const [el, v] of [['goal', s.goal], ['intensity', s.intensity || 'fastest']])
    document.querySelectorAll(`#${el} button`).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  $('bracelet').value = s.bracelet; $('blocks').value = s.blockSlots ?? ACCOUNT.blockSlots ?? 0; $('blocks').title = s.blockSlots == null ? 'From your quest points (one slot per 50)' : '';
  $('kourendElite').checked = !!s.diaries.kourendElite; $('westernElite').checked = !!s.diaries.westernElite;
  for (const id of ['cannon', 'wildernessMethods', 'bossVariants']) $(id).checked = !!s[id];
  const unlockNames = [...new Set(Object.values(DATA.masters).flatMap(m => m.tasks.map(t => t.requires?.unlock).filter(Boolean)))].sort();
  $('unlocks').innerHTML = unlockNames.map(u => `<label><input type="checkbox" data-unlock="${esc(u)}"${s.unlocks[u] === true ? ' checked' : ''}> ${esc(u)}</label>`).join('');

  const c = current();
  if (!c) { $('summary').innerHTML = '<p class="muted">No master with rate data is available for this account yet (the rates start around Chaeldar and up).</p>'; $('rows').innerHTML = ''; done(); return; }
  const r = c.rates, o = s.overrides[c.id] || {};
  $('summary').innerHTML = `<div><span>Master</span><b style="font-family:var(--sans)">${esc(c.master.name)}</b></div>
    <div><span>Slayer XP/hr</span><b>${k(r.xpPerHr)}</b></div><div><span>GP/hr</span><b>${k(r.gpPerHr)}</b></div>
    <div><span>Tasks/hr</span><b>${r.tasksPerHr.toFixed(1)}</b></div>
    <div><span>Expected points/hr</span><b>${r.pointsPerHr >= 0 ? '+' : ''}${Math.round(r.pointsPerHr)}</b></div>
    <div><span>Points per task</span><b>${r.pointsPerTask.toFixed(1)}</b></div>`;
  const n = ['actions', 'extends', 'methods'].reduce((t, x) => t + Object.keys(o[x] || {}).length, 0);
  $('changes').innerHTML = n ? `You've changed ${n} thing${n > 1 ? 's' : ''} on ${esc(c.master.name)}'s list. <button type="button" class="reset" id="use-suggested">↺ Back to suggested</button>`
    : `Showing the suggested list for ${esc(c.master.name)}: the blocks, skips and extends that give the best ${s.goal === 'gp' ? 'GP' : 'XP'}/hr while points keep up.`;
  const sug = c.plan.suggested;
  $('rows').innerHTML = r.rows.sort((a, b) => b.weight - a.weight).map(row => {
    const key = row.task + (row.location ? ` (${row.location})` : '');
    const mkey = (DATA.masters[c.id].tasks.find(t => t.task === row.task && t.location === row.location)?.key || '') + (row.location ? '@' + row.location : '');
    const changed = o.actions?.[row.task] !== undefined || o.extends?.[row.task] !== undefined || o.methods?.[mkey] !== undefined;
    if (row.locked) return `<tr class="locked"><td>${esc(key)}</td><td class="num">–</td><td colspan="7">Needs ${esc(row.locked)}</td></tr>`;
    const sa = sug.actions[row.task] || 'do';
    const act = `<select data-action="${esc(row.task)}">${['do', 'skip', 'block'].map(a => `<option value="${a}"${a === row.action ? ' selected' : ''}>${{ do: 'Do', skip: 'Skip', block: 'Block' }[a]}${a === sa ? ' (suggested)' : ''}</option>`).join('')}</select>`;
    const ext = row.canExtend ? `<input type="checkbox" data-extend="${esc(row.task)}"${row.extended ? ' checked' : ''}>` : '<span class="faint">–</span>';
    const noData = row.noData ? ' <span class="tag" title="No rate data: counted as skipped">no data</span>' : '';
    const meth = row.methods.length ? `<select data-method="${esc(mkey)}">${(row.method ? '' : '<option selected disabled>Choose a method</option>') + row.methods.map(v => `<option value="${esc(v.name)}"${v === row.method ? ' selected' : ''}>${esc(v.name)}${v.boss ? ' (boss)' : ''}</option>`).join('')}</select>` : '<span class="faint">no rate data yet</span>';
    const run = row.run;
    return `<tr class="${row.action}${changed ? ' changed' : ''}"><td>${esc(key)}</td><td class="num">${row.chance ? (row.chance * 100).toFixed(1) + '%' : '–'}</td>
      <td>${act}${noData}</td><td>${ext}</td><td>${meth}</td>
      <td class="num">${run ? Math.round(run.kills) : '–'}</td><td class="num">${run ? hm(run.hours) : '–'}</td>
      <td class="num">${run ? k(run.xp / run.hours) : '–'}</td><td class="num">${run ? k(run.gp / run.hours) : '–'}</td></tr>`;
  }).join('');
  done();
}
const done = () => { document.documentElement.dataset.ready = '1'; };

function override(kind, key, value) {
  const c = current(); if (!c) return;
  raw.overrides ||= {}; const o = raw.overrides[c.id] ||= {};
  (o[kind] ||= {})[key] = value;
  save();
}

async function init() {
  const [d, q] = await Promise.all([loadFile('slayer.json'), loadQuests().catch(() => null)]);
  DATA = d;
  ACCOUNT.blockSlots = blockSlotsFor(q ? questPoints(ACCOUNT, q.quests) : 0, ACCOUNT.diaries);
  $('acct-note').innerHTML = hasAccount() ? 'Using your stats and quests from <a href="../account/">My Account</a>.' : 'Using a brand-new account. <a href="../account/">Enter your stats</a> to see what you can do.';
  $('master').addEventListener('change', e => { raw.master = e.target.value; save(); });
  for (const id of ['goal', 'intensity']) $(id).addEventListener('click', e => { if (e.target.dataset.v) { raw[id] = e.target.dataset.v; save(); } });
  $('bracelet').addEventListener('change', e => { raw.bracelet = e.target.value; save(); });
  $('blocks').addEventListener('change', e => { raw.blockSlots = Math.max(0, Math.min(7, parseInt(e.target.value) || 0)); save(); });
  for (const id of ['kourendElite', 'westernElite']) $(id).addEventListener('change', e => { raw.diaries = { ...(raw.diaries || {}), [id]: e.target.checked }; save(); });
  for (const id of ['cannon', 'wildernessMethods', 'bossVariants']) $(id).addEventListener('change', e => { raw[id] = e.target.checked; save(); });
  $('unlocks').addEventListener('change', e => { const u = e.target.dataset.unlock; if (!u) return; raw.unlocks = { ...(raw.unlocks || {}), [u]: e.target.checked }; save(); });
  $('rows').addEventListener('change', e => {
    const d = e.target.dataset;
    if (d.action) override('actions', d.action, e.target.value);
    else if (d.extend) override('extends', d.extend, e.target.checked);
    else if (d.method) override('methods', d.method, e.target.value);
  });
  $('changes').addEventListener('click', e => { if (e.target.id !== 'use-suggested') return; const c = current(); if (c && raw.overrides) delete raw.overrides[c.id]; save(); });
  render();
}
init().catch(err => { $('summary').textContent = `Couldn't load the Slayer data (${err.message}).`; done(); });
