// DPS tab: compare up to four setups against a monster and tweak them.
import { loadAccount } from '../core/account.js';
import { loadGear, loadTargets, loadMonsters, accountPlayer } from '../core/gear.js';
import { SLOTS, PRAYERS, UNLOCKABLE_PRAYERS, attackStyles, spellsFor, calc, bestCalc, styleKind, THRALL_DPS } from '../core/dps.js';
import { loadDps, saveDps } from '../core/dps-store.js';
import { meetsReqs } from '../core/best-setup.js';
import { withSpec, withSpecs, SPECS, specOf } from '../core/specs.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const secs = s => !isFinite(s) ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`;
const LEVELS = ['Attack', 'Strength', 'Defence', 'Ranged', 'Magic', 'Prayer', 'Hitpoints'];
const MAX_COLS = 4;

const account = loadAccount();
const [gear, targets, monsters] = await Promise.all([loadGear(), loadTargets(), loadMonsters()]);
const base = accountPlayer(account);
let state = loadDps();
state.levels ||= { ...base.levels };
state.prayers ||= [...base.prayers];
state.loadouts = (state.loadouts || []).slice(0, MAX_COLS);
if (!state.loadouts.length) state.loadouts = [{ name: 'Setup 1', slots: {} }, { name: 'Setup 2', slots: {} }];
if (state.heart === undefined) state.heart = base.hearts || '';
if (state.lowHp === undefined) state.lowHp = account.dharokHp ?? null;
const save = () => saveDps(state);

// item lookup by name, per slot (weapons include two-handed)
const bySlot = {};
for (const s of SLOTS) {
  const list = s === 'weapon' ? [...gear.weapon, ...gear['2h']] : gear[s];
  bySlot[s] = new Map();
  for (const it of list) if (!bySlot[s].has(it.name.toLowerCase())) bySlot[s].set(it.name.toLowerCase(), it);
}
document.body.insertAdjacentHTML('beforeend', `<datalist id="dl-spec">${[...new Set([...bySlot.weapon.values(), ...(bySlot['2h']?.values() || [])].filter(w => specOf(w)).map(w => w.name))].sort().map(n => `<option value="${esc(n)}">`).join('')}</datalist>` + SLOTS.map(s => `<datalist id="dl-${s}">${[...bySlot[s].values()].map(it => `<option value="${esc(it.name)}">`).join('')}</datalist>`).join(''));
const item = (s, name) => name ? bySlot[s].get(String(name).toLowerCase()) || null : null;
function loadoutOf(L) {
  const lo = {};
  for (const s of SLOTS) lo[s] = item(s, L.slots[s]);
  if (lo.weapon?.two) lo.shield = null;
  return lo;
}

// ---- controls ----
const ids = Object.keys(targets).filter(id => targets[id].parts.length).sort((a, b) => targets[a].name.localeCompare(targets[b].name));
$('target').innerHTML = ids.map(id => `<option value="${id}">${esc(targets[id].name)}</option>`).join('');
$('target').value = targets[state.target] ? state.target : 'vorkath';
function parts() {
  const t = targets[$('target').value];
  const label = p => p.monster.replace(/#(.*)$/, ' ($1)') + (p.toa ? (p.boost === 'salts' ? ', with salts' : ', no salts yet') : '') + (p.weapon ? `, with a ${p.weapon}` : '');
  $('part').innerHTML = t.parts.map((p, i) => `<option value="${i}">${esc(label(p))}</option>`).join('');
  $('part').value = String(Math.min(state.part || 0, t.parts.length - 1));
}
parts();
$('onTask').checked = !!state.onTask; $('thrall').checked = !!state.thrall; $('heart').value = state.heart || '';
$('levels').innerHTML = LEVELS.map(s => `<label>${s} <input type="number" min="1" max="99" data-level="${s}" value="${state.levels[s] ?? 1}"></label>`).join('')
  + `<label title="The Hitpoints you fight on with Dharok's: the lower, the harder it hits">Low HP (Dharok's) <input type="number" min="1" max="99" id="lowHp" value="${state.lowHp ?? ''}" placeholder="full"></label>`
  + `<button type="button" class="x" id="lv-reset">↺ From My Account</button>`;
$('prayers').innerHTML = '<span class="muted" style="font-size:13px">Prayers unlocked:</span>' + UNLOCKABLE_PRAYERS.map(p =>
  `<label><input type="checkbox" data-prayer="${p.id}"${state.prayers.includes(p.id) ? ' checked' : ''} style="width:auto"> ${esc(p.label)}</label>`).join('');

$('target').addEventListener('change', () => { state.target = $('target').value; state.part = 0; parts(); save(); render(); });
$('part').addEventListener('change', () => { state.part = Number($('part').value); save(); render(); });
for (const id of ['onTask', 'thrall']) $(id).addEventListener('change', () => { state[id] = $(id).checked; save(); render(); });
$('heart').addEventListener('change', () => { state.heart = $('heart').value; save(); render(); });
$('levels').addEventListener('change', e => {
  if (e.target.id === 'lowHp') { const v = Math.round(Number(e.target.value)); state.lowHp = v >= 1 && v <= 99 ? v : null; e.target.value = state.lowHp ?? ''; save(); render(); return; }
  const s = e.target.dataset.level; if (s) { state.levels[s] = Math.max(1, Math.min(99, Number(e.target.value) || 1)); save(); render(); } });
$('lv-reset').addEventListener('click', () => { state.levels = { ...base.levels }; state.prayers = [...base.prayers];
  document.querySelectorAll('[data-level]').forEach(i => { i.value = state.levels[i.dataset.level]; });
  document.querySelectorAll('[data-prayer]').forEach(i => { i.checked = state.prayers.includes(i.dataset.prayer); }); save(); render(); });
$('prayers').addEventListener('change', e => { const p = e.target.dataset.prayer; if (!p) return;
  const set = new Set(state.prayers); if (e.target.checked) set.add(p); else set.delete(p); state.prayers = [...set]; save(); render(); });
$('add').addEventListener('click', () => {
  if (state.loadouts.length >= MAX_COLS) return;
  const last = state.loadouts[state.loadouts.length - 1];
  state.loadouts.push({ name: `Setup ${state.loadouts.length + 1}`, slots: { ...(last?.slots || {}) } });
  save(); render();
});

function player() {
  return { ...base, levels: { ...state.levels }, prayers: new Set(state.prayers), hearts: state.heart || null,
    onTask: !!state.onTask, thrall: !!state.thrall, lowHp: state.lowHp ?? null };
}

// ---- grid ----
function render() {
  const t = targets[$('target').value], part = t.parts[Number($('part').value)] || t.parts[0];
  const m = monsters[part.monster];
  $('monster').textContent = m ? `${m.name}: ${m.hp} HP, Defence ${m.def}, Magic ${m.magic}, defence bonuses stab ${m.dstab} / slash ${m.dslash} / crush ${m.dcrush} / magic ${m.dmagic} / ranged ${m.dstandard || m.drange}`
    + `${part.boost === 'overload' ? ' · with an overload (+)' : part.boost === 'salts' ? ' · with smelling salts' : ''}${m.flatArmour ? `, flat armour ${m.flatArmour}` : ''}${m.weakness ? `, ${m.weaknessPct}% weak to ${m.weakness}` : ''}${m.attributes.length ? ` · ${m.attributes.join(', ')}` : ''}` : '';
  const P = player(), cols = state.loadouts.length;
  const ctxOpts = { toa: part.toa, boost: part.boost, noAncients: part.noAncients, meleeWeapon: part.meleeWeapon };    // ToA: Tumeken's shadow x4; CoX overloads / ToA smelling salts
  const results = state.loadouts.map(L => {
    const lo = loadoutOf(L);
    let r;
    if (L.style) {
      const [si, spell] = L.style.split('|');
      const st = attackStyles(lo.weapon)[Number(si)];
      const sp = spell ? spellsFor(P, lo.weapon).find(x => x.name === spell) : null;
      r = st ? calc(P, lo, m, st, sp, ctxOpts) : bestCalc(P, lo, m, ctxOpts);
      r.total = r.dps + (P.thrall ? THRALL_DPS : 0);
    } else r = bestCalc(P, lo, m, ctxOpts);
    return { lo, r };
  });
  const bestDps = Math.max(...results.map(x => x.r.total ?? x.r.dps));
  const g = $('grid');
  g.style.setProperty('--cols', cols);
  let h = '<div></div>' + state.loadouts.map((L, i) => `<div class="colhead"><input value="${esc(L.name)}" data-name="${i}" aria-label="Setup name">
    <button type="button" class="x" data-copy="${i}" title="Copy this setup"${cols >= MAX_COLS ? ' disabled' : ''}>⧉</button>
    <button type="button" class="x" data-del="${i}" title="Remove this setup">✕</button></div>`).join('');
  for (const s of SLOTS) {
    h += `<div class="h">${s}</div>` + state.loadouts.map((L, i) => {
      const off = s === 'shield' && results[i].lo.weapon?.two;
      const it = item(s, L.slots[s]), bad = L.slots[s] && !it;
      const low = it && !meetsReqs(it, P) ? `Needs ${Object.entries(it.req).map(([k, v]) => `${v} ${k}`).join(', ')}` : '';
      return `<input list="dl-${s}" data-slot="${s}" data-i="${i}" value="${esc(L.slots[s] || '')}"${off ? ' disabled placeholder="(two-handed)"' : ''}${bad ? ' style="border-color:var(--cost)" title="Not found"' : low ? ` style="border-color:var(--gp-low)" title="${esc(low)}"` : ''}>`;
    }).join('');
  }
  h += '<div class="h">Style</div>' + state.loadouts.map((L, i) => {
    const w = results[i].lo.weapon;
    const opts = attackStyles(w).flatMap((st, si) => st.stance === 'autocast'
      ? spellsFor(P, w).map(sp => [`${si}|${sp.name}`, `Autocast ${sp.name}`]) : [[`${si}|`, `${st.name} (${st.type}, ${st.stance})`]]);
    return `<select data-style="${i}"><option value="">Best</option>${opts.map(([v, l]) => `<option value="${esc(v)}"${L.style === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }).join('');
  const row = (label, f) => `<div class="h">${label}</div>` + results.map(x => `<div class="res">${f(x.r)}</div>`).join('');
  h += row('Using', r => r.style ? esc(`${r.style.name}${r.spell ? ' · ' + r.spell.name : ''}`) + (r.prayer ? `<div class="faint">${esc(PRAYERS[r.prayer].label)}</div>` : '') : '—');
  h += row('Max hit', r => r.maxHit ? `${r.minHit ? r.minHit + '–' : ''}${r.maxHit}${r.hits > 1 ? ` ×${r.hits}` : ''}` : '—');
  h += row('Accuracy', r => r.accuracy ? (r.accuracy * 100).toFixed(1) + '%' : '—');
  h += row('Speed', r => `${r.speed} ticks`);
  h += `<div class="h">DPS</div>` + results.map(x => { const d = x.r.total ?? x.r.dps; return `<div class="res${d === bestDps && d > 0 ? ' best' : ''}">${d.toFixed(3)}${P.thrall ? '<div class="faint">incl. thrall</div>' : ''}</div>`; }).join('');
  h += row('Kill time', r => m ? secs(m.hp / (r.total ?? r.dps)) : '—');
  h += '<div class="h">Spec weapon</div>' + state.loadouts.map((L, i) => `<input list="dl-spec" data-spec="${i}" value="${esc(L.spec || '')}" placeholder="none">`).join('');
  h += '<div class="h">Second spec</div>' + state.loadouts.map((L, i) => `<input list="dl-spec" data-spec2="${i}" value="${esc(L.spec2 || '')}" placeholder="none" title="A Defence drain and a damage spec together (drains go first)">`).join('');
  h += '<div class="h">With spec</div>' + results.map((x, i) => {
    const L = state.loadouts[i];
    const names = [L.spec, L.spec2].filter(Boolean);
    if (!names.length) return '<div class="res faint">—</div>';
    const ws = names.map(n => item('weapon', n));
    if (ws.some(w => !w || !specOf(w))) return '<div class="res faint">Not a spec weapon here yet</div>';
    const lo = w => ({ ...x.lo, weapon: w, shield: w.two ? null : x.lo.shield });
    const dw = ws.find(w => specOf(w).drain), xw = ws.find(w => !specOf(w).drain);
    if (ws.length === 2 && (!dw || !xw)) return '<div class="res faint">Pick one Defence drain and one damage spec</div>';
    const r = m && withSpecs(P, x.lo, { drainLo: dw && lo(dw), dmgLo: xw && lo(xw) }, m, ctxOpts);
    const how = r && [r.drains ? `${r.drains} drain spec${r.drains > 1 ? 's' : ''} first, Defence to ~${r.defence}` : '', r.specs ? `${r.specs} damage spec${r.specs > 1 ? 's' : ''}` : ''].filter(Boolean).join(', then ');
    return `<div class="res">${r ? `${secs(r.seconds)}<div class="faint">${how}</div>` : '<span class="faint">doesn\'t help</span>'}</div>`;
  }).join('');
  h += row('', r => (r.notes || []).map(esc).join('<br>'));
  g.innerHTML = h;
}
$('grid').addEventListener('change', e => {
  const d = e.target.dataset;
  if (d.slot) { const L = state.loadouts[Number(d.i)]; const v = e.target.value.trim(); if (v) L.slots[d.slot] = v; else delete L.slots[d.slot]; if (d.slot === 'weapon') L.style = ''; }
  else if (d.style !== undefined) state.loadouts[Number(d.style)].style = e.target.value;
  else if (d.name !== undefined) state.loadouts[Number(d.name)].name = e.target.value;
  else if (d.spec !== undefined) state.loadouts[Number(d.spec)].spec = e.target.value.trim();
  else if (d.spec2 !== undefined) state.loadouts[Number(d.spec2)].spec2 = e.target.value.trim();
  else return;
  save(); render();
});
$('grid').addEventListener('click', e => {
  const d = e.target.dataset;
  if (d.copy !== undefined && state.loadouts.length < MAX_COLS) { const L = state.loadouts[Number(d.copy)]; state.loadouts.splice(Number(d.copy) + 1, 0, { ...L, name: L.name + ' (copy)', slots: { ...L.slots } }); }
  else if (d.del !== undefined) { state.loadouts.splice(Number(d.del), 1); if (!state.loadouts.length) state.loadouts.push({ name: 'Setup 1', slots: {} }); }
  else return;
  save(); render();
});
render();
