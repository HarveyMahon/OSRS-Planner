// Best setup tab: the fastest gear for a boss from the account's bank and cash stack.
import { loadAccount, hasAccount, saveAccount } from '../core/account.js';
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

// Raids with random rooms (CoX): tick your rotation, or leave all unticked for the average layout
function renderRooms() {
  const t = targets[$('target').value];
  $('rooms').hidden = !t.rooms;
  if (!t.rooms) return;
  const chosen = (loadDps().rooms || {})[$('target').value] || [];
  $('rooms').innerHTML = `<span class="muted" style="font-size:14px">Your rotation:</span>` + t.rooms.map(r =>
    `<label><input type="checkbox" data-room="${r.id}"${chosen.includes(r.id) ? ' checked' : ''}> ${esc(r.name)}</label>`).join('')
    + `<span class="faint">${chosen.length ? 'Only the ticked rooms count.' : 'None ticked: the average layout (each room by its chance of being in a raid).'}</span>`;
}
$('rooms').addEventListener('change', e => {
  if (!e.target.dataset.room) return;
  const st = loadDps(), all = st.rooms || {};
  all[$('target').value] = [...$('rooms').querySelectorAll('[data-room]:checked')].map(i => i.dataset.room);
  saveDps({ ...st, rooms: all });
  renderRooms(); schedule();
});
renderRooms();
$('target').addEventListener('change', renderRooms);

let timer = null;
function schedule() { clearTimeout(timer); $('working').textContent = 'Working…'; timer = setTimeout(run, 30); }
$('target').addEventListener('change', () => { $('onTask').checked = taskOnly.has($('target').value); schedule(); });   // task-only bosses are fought on task
for (const id of ['ownOnly', 'onTask']) $(id).addEventListener('change', schedule);
$('budget').addEventListener('change', schedule);
// Dharok's: the HP you'd fight on (saved with your account, so kill rates use it too)
$('lowHp').value = account.dharokHp ?? '';
$('lowHp').addEventListener('change', () => {
  const v = Math.round(Number($('lowHp').value));
  account.dharokHp = v >= 1 && v <= 99 ? v : null;
  $('lowHp').value = account.dharokHp ?? '';
  saveAccount({ ...loadAccount(), dharokHp: account.dharokHp });
  schedule();
});

function specHow(parts) {
  // totals over the whole target: every part with specs, each counted for the copies the energy reached
  const used = parts.filter(x => x.spec);
  if (!used.length) return '';
  const sum = k => used.reduce((n, x) => n + (x.spec[k] || 0) * (x.spec.copies ?? 1), 0);
  const d = Math.round(sum('drains') * 10) / 10, n = Math.round(sum('specs') * 10) / 10;
  const where = [...new Set(used.map(x => esc(x.name)))].join(', ');
  return [d ? `${d} Defence drain${d === 1 ? '' : 's'}` : '', n ? `${n} damage spec${n === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') + ` in all, on ${where}.`;
}

function run() {
  const base = targets[$('target').value], chosen = (loadDps().rooms || {})[$('target').value];
  const t = base.rooms && chosen?.length ? { ...base, chosenRooms: chosen } : base;
  const budget = $('ownOnly').checked ? 0 : parseGp($('budget').value);
  const player = accountPlayer(account, { onTask: $('onTask').checked });
  const avail = $('ownOnly').checked ? it => { const a = baseAvail(it); return a.owned ? a : { owned: false, price: null }; } : baseAvail;
  const t0 = performance.now();
  const r = bestSetup(player, gear, t, monsters, avail, { budget });
  $('working').textContent = `Worked out in ${((performance.now() - t0) / 1000).toFixed(1)}s`;
  if (!r) { $('summary').innerHTML = ''; $('cards').innerHTML = '<p class="muted">No data for this target.</p>'; return; }
  const kills = isFinite(r.time) ? 3600 / r.time : 0;
  const stuck = r.perPart.filter(p => !p.dps).map(p => esc(p.name) + (p.monster.includes('#') ? ` (${esc(p.monster.split('#')[1])})` : ''));
  const why = !isFinite(r.time) ? `<p class="muted" style="margin:0 0 12px">${Object.keys(r.kinds).length ? `Nothing you own or can afford can damage ${[...new Set(stuck)].join(', ')}` : 'No weapon you own or can afford is usable here'}${budget ? '' : ': with no budget only gear in your bank counts'}. Import your bank on My Account${$('ownOnly').checked ? ', untick "Only gear I own"' : ''} or raise the budget.</p>` : '';
  $('summary').innerHTML = `<div><span>Time per kill (fighting only)</span><b>${secs(r.time)}</b></div>
    <div><span>Kills per hour, fighting only</span><b>${kills.toFixed(1)}</b></div>
    <div><span>Gear to buy</span><b>${gp(r.cost)}</b></div>
    <div><span>Thrall</span><b>${r.thrall ? 'Yes' : 'No'}</b></div>`;
  $('cards').innerHTML = why + Object.entries(r.kinds).map(([k, v]) => {
    const pray = r.perPart.find(p => p.kind === k)?.calc?.prayer;
    return `<div class="card"><h3>${k}${pray ? ` <span class="faint">· ${esc(PRAYERS[pray]?.label)}</span>` : ''}</h3><table>${SLOTS.map(s => {
      const it = v.loadout[s];
      if (!it) return '';
      const a = avail(it);
      return `<tr><td class="slot">${s}</td><td>${esc(it.name)}</td><td class="num">${a.owned ? '<span class="tag own">owned</span>' : `<span class="tag buy">${gp(a.price || 0)}</span>`}</td></tr>`;
    }).join('')}</table><p style="margin:8px 0 0"><button type="button" class="btn small" data-open="${k}">Open in DPS calculator</button></p></div>`;
  }).join('') + (r.spec ? `<div class="card"><h3>Special attacks</h3><table>${[['Defence drain', r.spec.drain], ['Damage', r.spec.damage]].filter(([, x]) => x).map(([label, x]) =>
    `<tr><td class="slot">${label}</td><td>${esc(x.item.name)}</td><td class="num">${x.owned ? '<span class="tag own">owned</span>' : `<span class="tag buy">${gp(x.price)}</span>`}</td></tr>`).join('')}</table>
    <p class="faint" style="margin:8px 0 0">Saves about ${secs(r.spec.saved)} ${t.whole ? 'a run' : 'on a kill started with a full bar'}. ${specHow(r.perPart)} One energy pool: a full bar plus 10% every 30 seconds over the ${t.whole ? 'whole run' : 'fight'}.</p></div>` : '');
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
