// Money Makers: boss methods ranked by GP per hour after supplies.
// v0: bosses only, every method shown (account filtering comes with requirements data).

import { loadItems, loadBosses } from '../core/data.js';
import { bossMethod, setupOf } from '../core/money.js';
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

let ITEMS, BOSSES, open = null;
const setupChoice = id => store.get('setup:' + id);

function rows() {
  return BOSSES.map(b => {
    const setupId = setupOf(b, setupChoice(b.id)).id;
    return bossMethod(b, ITEMS.items, { setupId, override: getOverride(b.id, setupId) });
  }).sort((a, b) => b.gpPerHr - a.gpPerHr);
}

function render() {
  const list = rows();
  $('table').tBodies[0].innerHTML = list.map((r, i) => {
    const b = BOSSES.find(x => x.id === r.bossId);
    const costNote = r.costSource === 'flat' ? ' <span class="tag" title="Flat GP figure from before supplies were item lists">flat</span>'
      : r.missing.length ? ' <span class="tag warn" title="Some supplies have no price yet">incomplete</span>' : '';
    const setupCell = b.setups.length > 1
      ? `<select data-setup="${b.id}" aria-label="Setup for ${esc(b.name)}">${b.setups.map(s => `<option value="${s.id}"${s.id === r.setup.id ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</select>`
      : esc(r.setup.label);
    const row = `<tr data-id="${b.id}" class="${open === b.id ? 'open' : ''}">
      <td class="rank">${i + 1}</td>
      <td class="name"><button type="button" class="link" data-open="${b.id}">${esc(b.name)}</button>${r.setup.customised ? ' <span class="tag mine" title="You have changed this setup">edited</span>' : ''}</td>
      <td>${setupCell}</td>
      <td class="num">${num(r.unitsPerHr)} <span class="unit">${esc(b.unit)}s</span></td>
      <td class="num">${gp(r.lootPerUnit)}</td>
      <td class="num"><span class="cost">${gpShort(r.costPerUnit)}</span>${costNote}</td>
      <td class="num strong">${gp(r.gpPerHr)}</td>
    </tr>`;
    return open === b.id ? row + `<tr class="editor-row"><td colspan="7">${editor(b, r)}</td></tr>` : row;
  }).join('');
}

function editor(b, r) {
  const s = r.setup, def = setupOf(b, s.id);
  const lines = s.supplies.map(x => {
    const it = ITEMS.items[x.item];
    return `<tr><td>${esc(it ? it.name : x.item)}${it ? '' : ' <span class="tag warn">no price</span>'}</td>
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
    <p class="src">Rate: ${esc(def.unitsPerHrSource || 'n/a')}. Cost: ${esc(def.costSource || 'n/a')}.</p>
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
  [ITEMS, { bosses: BOSSES }] = await Promise.all([loadItems(), loadBosses()]);
  // Minigames and other activities (category "misc") belong to the pet calculator only
  BOSSES = BOSSES.filter(b => b.category !== 'misc');
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
