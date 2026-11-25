// Best setup tab: the fastest gear for a boss from the account's bank and cash stack.
import { loadAccount, hasAccount } from '../core/account.js';
import { loadBosses } from '../core/data.js';
import { loadGear, loadTargets, loadMonsters, availability, accountPlayer } from '../core/gear.js';
import { bestSetup } from '../core/best-setup.js';
import { SLOTS, PRAYERS } from '../core/dps.js';
import { saveDps, loadDps } from '../core/dps-store.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const gp = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : Math.round(n).toString();
const parseGp = s => { const m = String(s).trim().toLowerCase().replace(/,/g, '').match(/^([\d.]+)\s*([kmb]?)$/); return m ? Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1)) : 0; };
const secs = s => !isFinite(s) ? '—' : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round(s % 3600 / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`;

const account = loadAccount();
const [gear, targets, monsters, { avail: baseAvail }, { bosses }] = await Promise.all([loadGear(), loadTargets(), loadMonsters(), availability(account), loadBosses()]);
const taskOnly = new Set(bosses.filter(b => b.taskOnly).map(b => b.id));
const saved = loadDps();

$('acct-note').textContent = hasAccount()
  ? `${account.bankImportedAt ? 'Using your bank import' : 'No bank imported yet: only buyable gear is used'}${(account.prayers || []).length ? '' : ' · no unlocked prayers ticked on My Account'}.`
  : 'No account set up yet, so every level counts as 1. Set your stats on My Account first.';
const ids = Object.keys(targets).filter(id => targets[id].parts.length).sort((a, b) => targets[a].name.localeCompare(targets[b].name));
$('target').innerHTML = ids.map(id => `<option value="${id}">${esc(targets[id].name)}${targets[id].whole ? ' (whole raid / content)' : ''}</option>`).join('');
$('target').value = saved.target && targets[saved.target] ? saved.target : 'vorkath';
$('budget').value = gp(account.gp || 0);
$('onTask').checked = taskOnly.has($('target').value);

let timer = null;
function schedule() { clearTimeout(timer); $('working').textContent = 'Working…'; timer = setTimeout(run, 30); }
$('target').addEventListener('change', () => { $('onTask').checked = taskOnly.has($('target').value); schedule(); });   // task-only bosses are fought on task
for (const id of ['ownOnly', 'onTask']) $(id).addEventListener('change', schedule);
$('budget').addEventListener('change', schedule);

function specHow(parts) {
  const p = parts.find(x => x.spec);
  if (!p) return '';
  return [p.spec.drains ? `${p.spec.drains} Defence drain${p.spec.drains > 1 ? 's' : ''} at the start (Defence to about ${p.spec.defence})` : '',
    p.spec.specs ? `${p.spec.specs} damage spec${p.spec.specs > 1 ? 's' : ''} whenever there's energy` : ''].filter(Boolean).join(', then ') + ` (${esc(p.name)}).`;
}

function run() {
  const t = targets[$('target').value];
  const budget = $('ownOnly').checked ? 0 : parseGp($('budget').value);
  const player = accountPlayer(account, { onTask: $('onTask').checked });
  const avail = $('ownOnly').checked ? it => { const a = baseAvail(it); return a.owned ? a : { owned: false, price: null }; } : baseAvail;
  const t0 = performance.now();
  const r = bestSetup(player, gear, t, monsters, avail, { budget });
  $('working').textContent = `Worked out in ${((performance.now() - t0) / 1000).toFixed(1)}s`;
  if (!r) { $('summary').innerHTML = ''; $('cards').innerHTML = '<p class="muted">No data for this target.</p>'; return; }
  const kills = isFinite(r.time) ? 3600 / r.time : 0;
  $('summary').innerHTML = `<div><span>Time per kill (fighting only)</span><b>${secs(r.time)}</b></div>
    <div><span>Kills per hour, fighting only</span><b>${kills.toFixed(1)}</b></div>
    <div><span>Gear to buy</span><b>${gp(r.cost)}</b></div>
    <div><span>Thrall</span><b>${r.thrall ? 'Yes' : 'No'}</b></div>`;
  $('cards').innerHTML = Object.entries(r.kinds).map(([k, v]) => {
    const pray = r.perPart.find(p => p.kind === k)?.calc?.prayer;
    return `<div class="card"><h3>${k}${pray ? ` <span class="faint">· ${esc(PRAYERS[pray]?.label)}</span>` : ''}</h3><table>${SLOTS.map(s => {
      const it = v.loadout[s];
      if (!it) return '';
      const a = avail(it);
      return `<tr><td class="slot">${s}</td><td>${esc(it.name)}</td><td class="num">${a.owned ? '<span class="tag own">owned</span>' : `<span class="tag buy">${gp(a.price || 0)}</span>`}</td></tr>`;
    }).join('')}</table><p style="margin:8px 0 0"><button type="button" class="btn small" data-open="${k}">Open in DPS calculator</button></p></div>`;
  }).join('') + (r.spec ? `<div class="card"><h3>Special attacks</h3><table>${[['Defence drain', r.spec.drain], ['Damage', r.spec.damage]].filter(([, x]) => x).map(([label, x]) =>
    `<tr><td class="slot">${label}</td><td>${esc(x.item.name)}</td><td class="num">${x.owned ? '<span class="tag own">owned</span>' : `<span class="tag buy">${gp(x.price)}</span>`}</td></tr>`).join('')}</table>
    <p class="faint" style="margin:8px 0 0">Saves about ${secs(r.spec.saved)} a kill. ${specHow(r.perPart)}</p></div>` : '');
  $('parts').innerHTML = r.perPart.map(p => `<tr><td>${esc(p.name)}${p.monster.includes('#') ? ` <span class="faint">${esc(p.monster.split('#')[1])}</span>` : ''}${p.weight !== 1 ? ` <span class="faint">×${+p.weight.toFixed(2)}</span>` : ''}</td>
    <td>${p.kind || '—'}</td><td>${esc(p.calc?.style?.name || '')}${p.calc?.spell ? ` · ${esc(p.calc.spell.name)}` : ''}</td>
    <td class="num">${p.calc ? (p.calc.minHit ? `${p.calc.minHit}–` : '') + p.calc.maxHit + (p.calc.hits > 1 ? ` ×${p.calc.hits}` : '') : ''}</td>
    <td class="num">${p.calc ? (p.calc.accuracy * 100).toFixed(1) + '%' : ''}</td><td class="num">${p.dps ? p.dps.toFixed(2) : '—'}</td><td class="num">${secs(p.seconds)}${p.spec ? ` <span class="tag" title="${[p.spec.drains ? `${p.spec.drains} drain(s), Defence to ~${p.spec.defence}` : '', p.spec.specs ? `${p.spec.specs} damage spec(s)` : ''].filter(Boolean).join(', ')}">spec</span>` : ''}</td></tr>`).join('');
  $('notes').innerHTML = [t.whole ? 'Whole content is a first estimate: the main monsters of each room, each killed with the best style allowed on it. Real runs depend on the team and mechanics.' : '',
    t.note || '', 'Untradeable items you don\'t own (e.g. Infernal cape, Avernic defender) can\'t be bought, so they only appear if they\'re in your bank.'].filter(Boolean).map(esc).join(' ');
  $('cards').onclick = e => {
    const k = e.target.dataset?.open;
    if (!k) return;
    const lo = r.kinds[k].loadout;
    saveDps({ ...loadDps(), target: $('target').value, part: 0, onTask: $('onTask').checked, thrall: r.thrall,
      loadouts: [{ name: `Best ${k}`, spec: (r.spec?.drain || r.spec?.damage)?.item.name || '', slots: Object.fromEntries(SLOTS.filter(s => lo[s]).map(s => [s, lo[s].name])) }, ...(loadDps().loadouts || []).slice(0, 3)] });
    location.href = '../dps/';
  };
  saveDps({ ...loadDps(), target: $('target').value });
}
run();
