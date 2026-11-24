// Money Makers: bosses (with setups) and other Wiki-guide methods ranked by GP per hour.
// With an account saved (My Account), only methods it meets are listed, using each boss's best
// setup the account can do. Requirements include the guides' recommended levels for now.

import { loadItems, loadBosses, loadQuests, loadMethods } from '../core/data.js';
import { bossMethod, setupOf, guideMethod } from '../core/money.js';
import { isMet, unmet, describe } from '../core/requirements.js';
import { loadAccount, hasAccount, forRequirements } from '../core/account.js';
import { getOverride, setOverride, resetOverride, withQty, withRemoved, withAdded } from '../core/overrides.js';

console.log('Money Makers: starting');
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem('osrsplanner:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('osrsplanner:' + k, v); } catch {} },
};

function gpShort(n) {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  const t = (x, d) => Number(x.toFixed(d)).toString();
  if (a >= 1e9) return sign + t(a / 1e9, 2) + 'B';
  if (a >= 1e6) return sign + t(a / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2) + 'M';
  if (a >= 1e3) return sign + t(a / 1e3, a >= 1e5 ? 0 : 1) + 'K';
  return sign + Math.round(a);
}
const gpClass = n => n < 0 ? 'cost' : Math.abs(n) >= 1e7 ? 'gp-high' : Math.abs(n) >= 1e5 ? 'gp-mid' : 'gp-low';
const gp = n => `<span class="${gpClass(n)}">${gpShort(n)}</span>`;
const num = n => (Math.round(n * 100) / 100).toLocaleString('en-GB');

let ITEMS, BOSSES, METHODS, QUESTS, ACCOUNT = null, open = null;
const CATS = { all: 'All', bosses: 'Bosses', combat: 'Combat', skilling: 'Skilling', processing: 'Processing', collecting: 'Collecting', other: 'Other' };
const catOf = m => { const c = (m.category || '').toLowerCase(); return c.startsWith('combat') ? 'combat' : CATS[c] ? c : 'other'; };
const names = () => ({ quests: QUESTS.quests, items: ITEMS.items });
const setupChoice = id => store.get('setup:' + id);
const ctx = () => ({ quests: QUESTS.quests });
const meets = s => !ACCOUNT || isMet(s.requires, ACCOUNT, ctx());
const method = (b, setupId) => bossMethod(b, ITEMS.items, { setupId, override: getOverride(b.id, setupId) });

// For each boss: the setup you picked if you meet it, else the best-paying setup you meet.
// Bosses with no setup you meet are "locked", shown (with what's missing) only on request.
function rows() {
  const bossRows = BOSSES.map(b => {
    const chosen = setupChoice(b.id) && b.setups.find(s => s.id === setupChoice(b.id));
    const ok = b.setups.filter(meets);
    let m;
    if (chosen && meets(chosen)) m = method(b, chosen.id);
    else if (ok.length) m = ok.map(s => method(b, s.id)).sort((x, y) => y.gpPerHr - x.gpPerHr)[0];
    else {
      m = method(b, setupOf(b, chosen?.id).id);
      m.locked = unmet(m.setup.requires, ACCOUNT, ctx()).map(r => describe(r, names()));
    }
    return { ...m, kind: 'boss', id: b.id, cat: 'bosses', wilderness: !!b.wilderness, wildernessNote: b.wildernessNote, members: true };
  });
  const methodRows = METHODS.map(m => {
    const r = guideMethod(m, ITEMS.items);
    if (!meets(m)) r.locked = unmet(m.requires, ACCOUNT, ctx()).map(x => describe(x, names()));
    return { ...r, kind: 'method', id: 'm:' + m.id, cat: catOf(m), wilderness: m.wilderness, wildernessNote: m.wildernessNote, members: m.members };
  });
  return [...bossRows, ...methodRows].sort((a, b) => b.gpPerHr - a.gpPerHr);
}

function filters() {
  return { cat: store.get('cat') || 'all', hideWild: $('hide-wild').checked, f2p: $('f2p').checked, showLocked: $('show-locked').checked };
}

function render() {
  const f = filters();
  document.querySelectorAll('#cats button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.cat === f.cat)));
  const inView = rows().filter(r => (f.cat === 'all' || r.cat === f.cat) && !(f.hideWild && r.wilderness) && !(f.f2p && r.members));
  const list = inView.filter(r => !r.locked || f.showLocked);
  $('filter-note').innerHTML = ACCOUNT
    ? `Showing what your account can do: <b>${inView.filter(r => !r.locked).length}</b> of ${inView.length} methods. Levels include the Wiki guides' recommended levels. <a href="../account/">Edit your stats</a>`
    : `Showing all ${inView.length} methods. <a href="../account/">Enter your stats</a> to see only what you can do.`;
  $('locked-toggle').hidden = !ACCOUNT;
  $('table').tBodies[0].innerHTML = list.map((r, i) => r.kind === 'method' ? methodRow(r, i) : bossRow(r, i)).join('');
}

const wildTag = r => r.wilderness ? ` <span class="tag wild" title="${esc(r.wildernessNote || 'Wilderness')}">Wilderness</span>` : '';
const needs = r => r.locked ? `<div class="needs">Needs ${esc(r.locked.join(', '))}</div>` : '';

function methodRow(r, i) {
  const m = r.method;
  const tags = wildTag(r) + (m.members ? '' : ' <span class="tag">F2P</span>') + (m.recurring ? ' <span class="tag" title="Done every so often (e.g. farming runs): GP/hr is for the time spent">recurring</span>' : '');
  const row = `<tr data-id="${r.id}" class="${open === r.id ? 'open' : ''}${r.locked ? ' locked' : ''}">
    <td class="rank">${i + 1}</td>
    <td class="name"><button type="button" class="link" data-open="${r.id}">${esc(m.name)}</button>${tags}${needs(r)}</td>
    <td class="muted">${esc(m.category || 'Other')}</td>
    <td class="num">${m.actionsPerHr ? `${num(m.actionsPerHr)} <span class="unit">${esc(m.actionName || 'actions')}</span>` : '<span class="unit">–</span>'}</td>
    <td class="num">${gp(r.lootPerHr)} <span class="unit">/hr</span></td>
    <td class="num"><span class="cost">${gpShort(r.costPerHr)}</span> <span class="unit">/hr</span>${r.missing.length ? ' <span class="tag warn" title="Some items have no price yet">incomplete</span>' : ''}</td>
    <td class="num strong">${gp(r.gpPerHr)}</td>
  </tr>`;
  return open === r.id ? row + `<tr class="editor-row"><td colspan="7">${methodDetail(r)}</td></tr>` : row;
}

function methodDetail(r) {
  const m = r.method;
  const line = x => { const it = x.gp != null ? { name: x.label, price: x.gp } : ITEMS.items[x.item];
    return `<li>${num(x.qty)} × ${esc(it ? it.name : x.item)} <span class="unit">${it ? gpShort(it.price * x.qty) : 'no price'}</span></li>`; };
  const xp = Object.entries(m.xpPerHr || {}).map(([k, v]) => `${k} ${Math.round(v).toLocaleString('en-GB')}`).join(', ');
  return `<div class="editor">
    <p class="src">Requires: ${m.requires ? esc(describe(m.requires, names())) : 'nothing listed'}.${xp ? ` XP per hour: ${esc(xp)}.` : ''}
      <a href="https://oldschool.runescape.wiki/w/${encodeURI(m.guide.replace(/ /g, '_'))}" target="_blank" rel="noopener">Wiki guide</a></p>
    ${m.wilderness ? `<p class="src wildnote">Wilderness: “${esc(m.wildernessNote)}”</p>` : ''}
    <div class="cols"><div><h3>Per hour you use</h3><ul>${m.inputsPerHr.map(line).join('') || '<li>Nothing</li>'}</ul></div>
    <div><h3>Per hour you get</h3><ul>${m.outputsPerHr.map(line).join('')}</ul></div></div>
  </div>`;
}

function bossRow(r, i) {
  {
    const b = BOSSES.find(x => x.id === r.bossId);
    const costNote = r.costSource === 'flat' ? ' <span class="tag" title="Flat GP figure from before supplies were item lists">flat</span>'
      : r.missing.length ? ' <span class="tag warn" title="Some supplies have no price yet">incomplete</span>' : '';
    const setupCell = b.setups.length > 1
      ? `<select data-setup="${b.id}" aria-label="Setup for ${esc(b.name)}">${b.setups.map(s => `<option value="${s.id}"${s.id === r.setup.id ? ' selected' : ''}>${esc(s.label)}${meets(s) ? '' : ' (locked)'}</option>`).join('')}</select>`
      : esc(r.setup.label);
    const row = `<tr data-id="${b.id}" class="${open === b.id ? 'open' : ''}${r.locked ? ' locked' : ''}">
      <td class="rank">${i + 1}</td>
      <td class="name"><button type="button" class="link" data-open="${b.id}">${esc(b.name)}</button>${wildTag(r)}${r.setup.customised ? ' <span class="tag mine" title="You have changed this setup">edited</span>' : ''}${needs(r)}</td>
      <td>${setupCell}</td>
      <td class="num">${num(r.unitsPerHr)} <span class="unit">${esc(b.unit)}s</span></td>
      <td class="num">${gp(r.lootPerUnit)}</td>
      <td class="num"><span class="cost">${gpShort(r.costPerUnit)}</span>${costNote}</td>
      <td class="num strong">${gp(r.gpPerHr)}</td>
    </tr>`;
    return open === b.id ? row + `<tr class="editor-row"><td colspan="7">${editor(b, r)}</td></tr>` : row;
  }
}

function editor(b, r) {
  const s = r.setup, def = setupOf(b, s.id);
  const lines = s.supplies.map(x => {
    const it = x.gp != null ? { name: x.label, price: x.gp } : ITEMS.items[x.item];
    return `<tr><td>${esc(it ? it.name : x.item)}${x.gp != null ? ' <span class="tag" title="Fixed value from the Wiki guide">value</span>' : ''}${it ? '' : ' <span class="tag warn">no price</span>'}</td>
      <td><input type="number" min="0" step="any" value="${x.qty}" data-qty="${esc(x.item)}" aria-label="Quantity"></td>
      <td>per ${x.per === 'trip' ? 'trip' : esc(b.unit)}</td>
      <td class="num">${it ? gpShort(it.price * x.qty) : '–'}</td>
      <td><button type="button" class="btn small" data-remove="${esc(x.item)}">Remove</button></td></tr>`;
  }).join('');
  return `<div class="editor">
    <div class="fields">
      <label>${esc(b.unit)}s per hour <input type="number" min="0" step="any" id="ed-uph" value="${s.unitsPerHr ?? ''}" placeholder="${def.unitsPerHr ?? ''}"></label>
      <label>${esc(b.unit)}s per trip <input type="number" min="0" step="any" id="ed-upt" value="${s.unitsPerTrip ?? ''}" placeholder="for per-trip supplies"></label>
    </div>
    <p class="src">Requires: ${def.requires ? esc(describe(def.requires, { quests: QUESTS.quests, items: ITEMS.items })) : 'nothing listed'}.</p>
    <p class="src">Rate: ${esc(def.unitsPerHrSource || 'n/a')}. Cost: ${esc(def.costSource || 'n/a')}.${def.guide ? ` <a href="https://oldschool.runescape.wiki/w/${encodeURI(def.guide.replace(/ /g, '_'))}" target="_blank" rel="noopener">Wiki guide</a>` : ''}</p>
    ${s.supplies.length ? `<table class="supplies"><thead><tr><th>Supply</th><th>Qty</th><th></th><th class="num">Cost</th><th></th></tr></thead><tbody>${lines}</tbody></table>`
      : `<p class="src">No item list yet${s.flatCostPerUnit != null ? `: using a flat ${Math.round(s.flatCostPerUnit).toLocaleString('en-GB')} gp per ${esc(b.unit)}` : ''}. Adding a supply replaces the flat figure.</p>`}
    <div class="add">
      <input list="item-names" id="ed-add" placeholder="Add a supply: type an item name">
      <input type="number" min="0" step="any" id="ed-add-qty" value="1" aria-label="Quantity">
      <select id="ed-add-per"><option value="unit">per ${esc(b.unit)}</option><option value="trip">per trip</option></select>
      <button type="button" class="btn small" id="ed-add-btn">Add</button>
      <button type="button" class="btn small ghost" id="ed-reset">Reset to default</button>
    </div>
  </div>`;
}

function editOverride(fn) {
  const b = BOSSES.find(x => x.id === open), setupId = setupOf(b, setupChoice(b.id)).id;
  setOverride(b.id, setupId, fn(getOverride(b.id, setupId) || {}));
  render();
}

async function init() {
  [ITEMS, { bosses: BOSSES }, QUESTS, { methods: METHODS }] = await Promise.all([loadItems(), loadBosses(), loadQuests(), loadMethods()]);
  $('cats').innerHTML = Object.entries(CATS).map(([k, v]) => `<button type="button" data-cat="${k}">${v}</button>`).join('');
  $('cats').addEventListener('click', e => { if (e.target.dataset.cat) { store.set('cat', e.target.dataset.cat); render(); } });
  for (const id of ['hide-wild', 'f2p']) {
    $(id).checked = store.get(id) === '1';
    $(id).addEventListener('change', () => { store.set(id, $(id).checked ? '1' : '0'); render(); });
  }
  if (hasAccount()) ACCOUNT = forRequirements(loadAccount());
  $('show-locked').checked = store.get('showLocked') === '1';
  $('show-locked').addEventListener('change', () => { store.set('showLocked', $('show-locked').checked ? '1' : '0'); render(); });
  // Minigames and other activities (category "misc") belong to the pet calculator only
  // and bosses marked moneyMaker: false (e.g. Zalcano: team loot split by contribution)
  BOSSES = BOSSES.filter(b => b.category !== 'misc' && b.moneyMaker !== false);
  $('prices').textContent = `Prices as of ${ITEMS.meta.pricesUpdated}.`;
  $('item-names').innerHTML = Object.values(ITEMS.items).filter(i => i.tradeable).map(i => `<option value="${esc(i.name)}">`).join('');

  const tbody = $('table').tBodies[0];
  tbody.addEventListener('click', e => {
    const t = e.target;
    if (t.dataset.open) { open = open === t.dataset.open ? null : t.dataset.open; render(); }
    else if (t.dataset.remove) editOverride(o => withRemoved(o, t.dataset.remove));
    else if (t.id === 'ed-reset') { const b = BOSSES.find(x => x.id === open); resetOverride(b.id, setupOf(b, setupChoice(b.id)).id); render(); }
    else if (t.id === 'ed-add-btn') {
      const it = ITEMS.byName($('ed-add').value.trim());
      if (!it) { $('ed-add').setCustomValidity('Pick an item from the list'); $('ed-add').reportValidity(); return; }
      editOverride(o => withAdded(o, { item: it.key, qty: parseFloat($('ed-add-qty').value) || 1, per: $('ed-add-per').value }));
    }
  });
  tbody.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.setup) { store.set('setup:' + t.dataset.setup, t.value); render(); }
    else if (t.dataset.qty) editOverride(o => withQty(o, t.dataset.qty, Math.max(0, parseFloat(t.value) || 0)));
    else if (t.id === 'ed-uph') editOverride(o => ({ ...o, unitsPerHr: t.value === '' ? undefined : Math.max(0, parseFloat(t.value) || 0) }));
    else if (t.id === 'ed-upt') editOverride(o => ({ ...o, unitsPerTrip: t.value === '' ? undefined : Math.max(0, parseFloat(t.value) || 0) }));
  });
  tbody.addEventListener('input', e => { if (e.target.id === 'ed-add') e.target.setCustomValidity(''); });
  render();
  document.documentElement.dataset.ready = '1';
}

init().catch(err => {
  $('table').insertAdjacentHTML('beforebegin', `<div class="error">Couldn't load the app's data files (${esc(err.message)}).</div>`);
});
