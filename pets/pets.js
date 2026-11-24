// Pet Hunt Profit Calculator, ported from HarveyMahon/Pet-Hunt-Profit-Calculator.
// Side tool of OSRS Planner: data comes from the shared core via legacy-data.js.
import { loadPetData } from './legacy-data.js';
(() => {
  const $ = id => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem('pethunt:' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('pethunt:' + k, v); } catch (e) {} }
  };

  // ---------- Formatting ----------
  function gpShort(n) {
    const a = Math.abs(n), sign = n < 0 ? '-' : '';
    if (a >= 1e9) return sign + trim(a / 1e9, 2) + 'B';
    if (a >= 1e6) return sign + trim(a / 1e6, a >= 1e8 ? 0 : a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return sign + trim(a / 1e3, a >= 1e5 ? 0 : 1) + 'K';
    return sign + Math.round(a).toLocaleString('en-GB');
  }
  function trim(x, d) { return Number(x.toFixed(d)).toString(); }
  function gpClass(n) { const a = Math.abs(n); return a >= 1e7 ? 'gp-high' : a >= 1e5 ? 'gp-mid' : 'gp-low'; }
  function gp(n, full) {
    return `<span class="${gpClass(n)}" title="${Math.round(n).toLocaleString('en-GB')} gp">${full ? Math.round(n).toLocaleString('en-GB') : gpShort(n)}</span>`;
  }
  // Costs are shown in red and in parentheses, accounting style
  function costGp(c) {
    return c > 0.5 ? `<span class="cost" title="${Math.round(c).toLocaleString('en-GB')} gp cost">(${gpShort(c)})</span>` : gp(0);
  }
  const money = n => n < 0 ? costGp(-n) : gp(n);
  const int = n => Math.round(n).toLocaleString('en-GB');
  function qtyFmt(n) {
    if (n >= 100) return int(n);
    if (n >= 10) return n.toFixed(1).replace(/\.0$/, '');
    return n.toFixed(2).replace(/\.?0+$/, '') || '0';
  }
  let UNIT = 'kill';
  function rateFmt(p) {
    if (p >= 0.9999) return p > 1.0001 ? `${qtyFmt(p)} per ${UNIT}` : 'Always';
    const d = 1 / p;
    return '1/' + (d >= 100 ? int(d) : d.toFixed(1).replace(/\.0$/, ''));
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- Calculation (pure) ----------
  function computeBoss(boss, items, enabledConditions, perfectShare = 0) {
    const rows = new Map();
    for (const d of boss.drops) {
      if (d.includeByDefault === false && !enabledConditions.has(d.condition)) continue;
      const item = items[d.item] || { price: 0, tradeable: false };
      let avgQty = d.qtyAvg != null ? d.qtyAvg : (d.qtyMin + d.qtyMax) / 2;
      if (d.qtyMinPerfect != null && perfectShare > 0) {
        avgQty = avgQty * (1 - perfectShare) + ((d.qtyMinPerfect + d.qtyMaxPerfect) / 2) * perfectShare;
      }
      const qtyPerKill = avgQty * d.expectedPerKill;
      let r = rows.get(d.item);
      if (!r) {
        r = { item: d.item, price: item.price, tradeable: item.tradeable, valueNote: item.valueNote || null, tables: new Set(), dropsPerKill: 0, qtyPerKill: 0, condition: d.condition || null };
        rows.set(d.item, r);
      }
      r.tables.add(d.table);
      r.dropsPerKill += d.expectedPerKill;
      r.qtyPerKill += qtyPerKill;
    }
    const list = [...rows.values()].map(r => ({
      ...r,
      avgQty: r.qtyPerKill / r.dropsPerKill,
      valuePerKill: r.qtyPerKill * r.price,
      dropsAtRate: r.dropsPerKill * boss.petRate,
      qtyAtRate: r.qtyPerKill * boss.petRate,
    }));
    const evPerKill = list.reduce((s, r) => s + r.valuePerKill, 0);
    list.forEach(r => r.share = evPerKill ? r.valuePerKill / evPerKill : 0);
    return { rows: list, evPerKill, totalAtRate: evPerKill * boss.petRate };
  }

  // A run to delve D = tables for delves 1..min(D,8) plus the '9+' table for each delve from 9 to D
  function delveRun(boss, D) {
    const t = boss.delveTables, tables = [];
    for (let n = 1; n <= D; n++) tables.push(t[Math.min(n, 9) - 1]);
    let miss = 1;
    tables.forEach(l => { miss *= 1 - (l.petChance || 0); });
    return { ...boss, drops: tables.flatMap(l => l.drops), petRate: 1 / (1 - miss) };
  }
  // Theatre of Blood: per-player loot for one raid
  function raidRun(boss, modeKey, n, target) {
    const R = boss.raidOption, m = R.modes[modeKey];
    const mine = m.teamUniqueChance / n;
    const mult = ((target && m.targetTimeCommonMultiplier) || m.commonMultiplier) / n;
    const drops = [
      ...m.uniques.map(u => ({ item: u.item, qtyMin: 1, qtyMax: 1, expectedPerKill: mine * u.weight, table: 'Uniques' })),
      ...R.commonTable.map(c => ({ item: c.item, qtyMin: c.qtyMin * mult, qtyMax: c.qtyMax * mult,
        expectedPerKill: (1 - mine) * R.commonRolls * c.chancePerRoll, table: 'Common (3 rolls)' })),
      ...m.tertiary.map(t => ({ item: t.item, qtyMin: 1, qtyMax: 1, expectedPerKill: t.chance, table: 'Tertiary' })),
    ];
    return { ...boss, drops, petRate: m.petRate };
  }
  // Chambers of Xeric: per-player loot for one raid, driven by team points
  function coxRun(boss, modeKey, n, points, target) {
    const R = boss.raidOption, m = R.modes[modeKey];
    let T = points + (target && m.targetTimePointsPerPlayer ? m.targetTimePointsPerPlayer * n : 0);
    const mine = [];
    for (let k = 0; k < R.maxUniqueRolls; k++) {
      const chunk = Math.min(Math.max(T - R.pointsPerRoll * k, 0), R.pointsPerRoll);
      mine.push(chunk / (R.pointsPerUniquePercent * 100) / n);
    }
    const expU = mine.reduce((a, q) => a + q, 0);
    const none = mine.reduce((a, q) => a * (1 - q), 1);
    const petMiss = mine.reduce((a, q) => a * (1 - q * R.petChancePerUnique), 1);
    const share = Math.min(T / n, R.personalPointsCap) / R.personalPointsCap;
    const pCommon = none * R.commonRolls / R.commonTable.length;
    const drops = m.uniques.map(u => ({ item: u.item, qtyMin: 1, qtyMax: 1, expectedPerKill: expU * u.weight, table: 'Uniques' }));
    R.commonTable.forEach(c => {
      const q = c.maxQty > 1 ? c.maxQty * share : 1;
      if (c.seed) {
        drops.push({ item: c.item, qtyMin: q * (1 - R.herbSeedShare), qtyMax: q * (1 - R.herbSeedShare), expectedPerKill: pCommon, table: 'Common (2 rolls)' });
        drops.push({ item: c.seed, qtyMin: q * R.herbSeedShare / c.herbsPerSeed, qtyMax: q * R.herbSeedShare / c.herbsPerSeed, expectedPerKill: pCommon, table: 'Common (seeds instead of herbs)' });
      } else {
        drops.push({ item: c.item, qtyMin: q, qtyMax: q, expectedPerKill: pCommon, table: 'Common (2 rolls)' });
      }
    });
    R.tertiaryIfNoUnique.forEach(t => drops.push({ item: t.item, qtyMin: 1, qtyMax: 1, expectedPerKill: none * t.chance, table: 'Tertiary' }));
    if (target && m.targetTimeTertiary) m.targetTimeTertiary.forEach(t => drops.push({ item: t.item, qtyMin: 1, qtyMax: 1, expectedPerKill: t.chance, table: 'Tertiary (target time)' }));
    return { ...boss, drops, petRate: 1 / (1 - petMiss), coxPoints: T };
  }
  // Tombs of Amascut: per-player loot for one raid
  function toaWeights(R, L) {
    const a = R.uniqueWeightAnchors;
    let f, l;
    if (L <= a[0].raidLevel) { f = a[0]["Osmumten's fang"]; l = a[0].Lightbearer; }
    else if (L >= a[a.length - 1].raidLevel) { f = a[a.length - 1]["Osmumten's fang"]; l = a[a.length - 1].Lightbearer; }
    else {
      const L5 = L - (L % 5);
      for (let i = 0; i < a.length - 1; i++) {
        if (a[i].raidLevel <= L5 && L5 <= a[i + 1].raidLevel) {
          const t = (L5 - a[i].raidLevel) / (a[i + 1].raidLevel - a[i].raidLevel);
          f = a[i]["Osmumten's fang"] + (a[i + 1]["Osmumten's fang"] - a[i]["Osmumten's fang"]) * t;
          l = a[i].Lightbearer + (a[i + 1].Lightbearer - a[i].Lightbearer) * t;
          break;
        }
      }
    }
    const w = { ...R.uniqueFixedWeights, "Osmumten's fang": f, Lightbearer: l };
    const tot = Object.values(w).reduce((x, y) => x + y, 0);
    Object.keys(w).forEach(k => w[k] /= tot);
    return w;
  }
  function toaRun(boss, n, L, P) {
    const R = boss.raidOption;
    P = Math.min(P, R.personalPointsCap);
    const u = L <= 310 ? L : L <= 430 ? 310 + (L - 310) / 3 : 350 + (L - 430) / 6;
    const team = Math.min(R.uniqueCapTeam, P * n / (100 * (10500 - 20 * u)));
    const mine = team / n;
    const w = toaWeights(R, L);
    const mult = L < 300 ? 1 : 1.15 + 0.01 * Math.floor((L - 300) / 5);
    const pCommon = (1 - mine) * R.commonRolls / R.commonTable.length;
    const drops = Object.entries(w).map(([item, wt]) => ({ item, qtyMin: 1, qtyMax: 1, table: 'Uniques',
      expectedPerKill: mine * wt * (L >= R.uniqueMinRaidLevel[item] ? 1 : R.underLevelConversion) }));
    R.commonTable.forEach(c => {
      const q = c.fixedQty || P / c.divisor * mult;
      drops.push({ item: c.item, qtyMin: q, qtyMax: q, expectedPerKill: pCommon, table: 'Common (3 rolls)' });
    });
    const v = L <= 400 ? L : L <= 550 ? 400 + (L - 400) / 3 : 450;
    return { ...boss, drops, petRate: (100 * (350000 - 700 * v)) / P, toaUnique: mine };
  }
  // Royal Titans style: several loot tables to choose from, optional duo split
  function choiceRun(boss, share, conds = enabled) {
    const scaled = drops => drops.map(x => {
      const y = { ...x };
      if (x.contributionScales === 'quantity') { y.qtyMin = x.qtyMin * share; y.qtyMax = x.qtyMax * share; }
      if (x.contributionScales === 'rate') y.expectedPerKill = x.expectedPerKill * share;
      return y;
    });
    const opts = boss.lootChoice.options.map(o => {
      const drops = scaled(o.drops);
      return { name: o.name, drops, ev: computeBoss({ ...boss, drops }, DATA.items, conds).evPerKill };
    }).sort((a, b) => b.ev - a.ev);
    return { ...boss, drops: opts[0].drops, lootPick: opts[0], lootOthers: opts.slice(1) };
  }
  // Nex / Hueycoatl: equal damage, MVP shared evenly
  function teamRun(boss, n) {
    const t = boss.teamOption;
    let share = (1 / n) * (1 + t.mvpBonus / n);
    if (t.listedAt === 'solo') share /= 1 + t.mvpBonus;
    const x5 = t.uniqueExtraRoll;
    const extra = x5 ? Math.min(Math.max((Math.min(n, x5.playerCap) - x5.startsAbove) * x5.percentPerPlayer / 100, 0), x5.cap) : 0;
    const drops = boss.drops.map(x => {
      const y = { ...x };
      if (x.teamScaling === 'rate') y.expectedPerKill = x.expectedPerKill * share;
      else if (x.teamScaling === 'quantity') { y.qtyMin = x.qtyMin * share; y.qtyMax = x.qtyMax * share; }
      else if (x.teamScaling === 'mvpOnly') y.expectedPerKill = 1 / n;
      else if (x.teamScaling === 'uniqueShared') y.expectedPerKill = x.expectedPerKill * (1 + extra) / n;
      else if (x.teamScaling === 'quantityMvp') { y.qtyMin = x.qtyMin * (1 + t.mvpBonus / n); y.qtyMax = x.qtyMax * (1 + t.mvpBonus / n); }
      else if (x.teamScaling === 'tertiaryMvp') y.expectedPerKill = x.expectedPerKill * (1 + t.tertiaryMvpBonus / n);
      return y;
    });
    let petRate = boss.petScalesWithShare ? boss.petRate / share : boss.petRate;
    if (t.petRateByTeam) {
      petRate = n >= 5 ? t.petRateByTeam['5+'] : t.petRateByTeam[String(n)];
      if (n >= t.petMvpBonusFrom) petRate /= 1 + t.tertiaryMvpBonus / n;
    }
    return { ...boss, drops, petRate, teamShare: t.listedAt === 'perPlayer' ? null : share, teamN: n, uniqueBonus: extra };
  }
  const rateNum = r => r >= 100 ? int(r) : (Math.round(r * 10) / 10).toLocaleString('en-GB');

  // ---------- App ----------
  let DATA, current, sortKey = 'valuePerKill', sortDir = -1;
  const enabled = new Set();

  const TABLE_SHORT = { always: '100%', main: 'Main', seeds: 'Seeds', shark: 'Shark', rare: 'Rare drop table', gem: 'Gem table', tertiary: 'Tertiary', supplies: 'Supplies (cost)' };
  const COLS = [
    { key: 'item', label: 'Item', type: 'text' },
    { key: 'tables', label: 'Table', type: 'text', nosort: true },
    { key: 'dropsPerKill', label: () => `Rate per ${UNIT}` },
    { key: 'avgQty', label: 'Avg qty' },
    { key: 'price', label: 'Price each' },
    { key: 'valuePerKill', label: () => `Value per ${UNIT}` },
    { key: 'share', label: '% of total' },
    { key: 'dropsAtRate', label: 'Drops by pet rate' },
    { key: 'qtyAtRate', label: 'Qty by pet rate' },
  ];

  async function load() {
    const d = await loadPetData();
    document.documentElement.dataset.source = 'live';
    return d;
  }

  function init(data) {
    DATA = data;
    // Items priced from another item, e.g. Tokkul = Uncut onyx / 260,000
    Object.values(data.items).forEach(it => {
      const f = it.derivedFrom;
      if (!f) return;
      if (f.terms) {
        if (f.terms.every(t => data.items[t.item])) it.price = Math.max(0, f.terms.reduce((sum, t) => sum + data.items[t.item].price * t.factor, 0));
      } else if (data.items[f.item]) {
        it.price = data.items[f.item].price / f.divisor;
      }
    });
    const sel = $('boss');
    // Sort ignoring a leading "The" and punctuation (K'ril, Kree'arra)
    const sortKey = n => n.replace(/^the\s+/i, '');
    data.bosses.sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name), 'en', { sensitivity: 'base', ignorePunctuation: true }));
    sel.value = data.bosses[0].id;
    const bossList = data.bosses.filter(b => !isMisc(b));
    sel.value = bossList[0].id;
    setupCombo(() => data.bosses.filter(b => isMisc(b) === isMisc(current)));
    const saved = store.get('boss');
    if (saved && bossList.some(b => b.id === saved)) sel.value = saved;
    $('boss-input').value = (data.bosses.find(b => b.id === sel.value) || bossList[0]).name;
    $('delve').value = store.get('delve') || '8';
    const key = k => 'raid:' + current.id + ':' + k;
    $('mode').addEventListener('change', () => { store.set(key('mode'), $('mode').value); render(); });
    $('target').addEventListener('change', () => { store.set(key('target'), $('target').checked ? '1' : '0'); render(); });
    $('team').addEventListener('change', () => { clampRaidInputs(); store.set(key('team'), $('team').value); store.set(key('scale'), $('scale').value); render(); });
    $('scale').addEventListener('change', () => { clampRaidInputs(); store.set(key('scale'), $('scale').value); render(); });
    $('level').addEventListener('change', () => {
      const v = Math.round(parseFloat($('level').value));
      $('level').value = isNaN(v) ? 300 : Math.min(600, Math.max(0, v));
      store.set(key('level'), $('level').value); render();
    });
    ['quiver-gamble', 'quiver-exchange'].forEach(id => $(id).addEventListener('change', () => { store.set('quiver:' + current.id, $(id).value); render(); }));
    $('diary').addEventListener('change', () => { store.set('diary:' + current.diaryOption.key, $('diary').checked ? '1' : '0'); render(); });
    $('slayer').addEventListener('change', () => { store.set('slayer:' + current.id, $('slayer').checked ? '1' : '0'); render(); });
    $('duo').addEventListener('change', () => { store.set('duo:' + current.id, $('duo').checked ? '1' : '0'); render(); });
    $('points').addEventListener('input', () => { store.set(key('points'), $('points').value); render(); });
    $('delve').addEventListener('change', () => {
      const v = Math.round(parseFloat($('delve').value));
      $('delve').value = isNaN(v) ? 8 : Math.min(30, Math.max(6, v));
      store.set('delve', $('delve').value); render();
    });

    sel.addEventListener('change', () => { const b = data.bosses.find(x => x.id === sel.value); store.set(isMisc(b) ? 'miscboss' : 'boss', sel.value); enabled.clear(); selectBoss(); showView('calc'); });
    // Kills per hour and supply cost are remembered separately for each boss or activity
    ['kph', 'cost'].forEach(id => $(id).addEventListener('input', () => { store.set(id + ':' + current.id, $(id).value); render(); buildOverview(); }));
    $('perfect').addEventListener('input', () => { store.set('perfect:' + current.id, $('perfect').value); render(); });

    const m = data.meta;
    $('footer').innerHTML = `
      <div>Prices as of ${esc(m.pricesUpdated)} · ${esc(m.priceSource)}. Drop tables from the ${esc(m.dropSource)}, retrieved ${esc(m.dropsRetrieved)}.</div>
      <div>Averages only: your actual loot will vary widely, especially from rare uniques. Untradeable items count as 0 gp, except components marked * (valued as a share of the tradeable item they make).</div>`;
    showPricesDate(m);
    setupOverviewControls();
    setupSettingsIO();
    selectBoss();
    buildOverview();
    $('tab-overview').addEventListener('click', () => showView('overview'));
    $('tab-calc').addEventListener('click', openBossTab);
    setupSkill(data.skillingPets || []);
    $('tab-skill').addEventListener('click', () => showView('skill'));
    $('tab-misc').addEventListener('click', openMiscTab);
    const h = (location.hash || '').slice(1);
    const hp = h.startsWith('skill') ? (data.skillingPets || []).find(p => 'skill-' + p.id === h) : null;
    if (hp) { SKILL = hp; $('skill-pet').value = hp.id; renderSkill(); showView('skill'); }
    else if (h === 'skilling' && SKILL) showView('skill');
    else if (h === 'misc') openMiscTab();
    else if (h && data.bosses.some(b => b.id === h)) openBoss(h); else showView('overview');
  }

  // Searchable boss picker (combobox)
  function setupCombo(getList) {
    const input = $('boss-input'), list = $('boss-list'), hidden = $('boss');
    const norm = t => t.toLowerCase().replace(/['’]/g, '');
    let shown = [], active = -1;
    const unitMeta = b => b.delveTables ? 'runs' : b.raidOption ? 'raid' : b.unit && b.unit !== 'kill' ? b.unit : '';
    function draw(filter) {
      const q = norm(filter || '').trim();
      shown = !q ? getList().slice() : [
        ...getList().filter(b => norm(b.name).includes(q)),
        ...getList().filter(b => !norm(b.name).includes(q) && norm(b.petName || '').includes(q)),
      ];
      active = shown.length ? 0 : -1;
      const hl = name => {
        if (!q) return esc(name);
        const i = norm(name).indexOf(q);
        if (i < 0) return esc(name);
        // map index on normalised text back to the original (apostrophes removed)
        let o = 0, n = 0; while (n < i && o < name.length) { if (!/['’]/.test(name[o])) n++; o++; }
        let e = o, m = 0; while (m < q.length && e < name.length) { if (!/['’]/.test(name[e])) m++; e++; }
        return esc(name.slice(0, o)) + '<mark>' + esc(name.slice(o, e)) + '</mark>' + esc(name.slice(e));
      };
      list.innerHTML = shown.length
        ? shown.map((b, i) => `<li role="option" id="opt-${esc(b.id)}" data-id="${esc(b.id)}" aria-selected="${i === active}" class="${b.id === hidden.value ? 'current' : ''}"><span>${hl(b.name)}</span><span class="meta">${esc(b.petName || '')}${unitMeta(b) ? ' · ' + esc(unitMeta(b)) : ''}</span></li>`).join('')
        : '<li class="empty">No matches</li>';
      input.setAttribute('aria-activedescendant', active >= 0 ? 'opt-' + shown[active].id : '');
    }
    function open(filter) { draw(filter); list.hidden = false; input.setAttribute('aria-expanded', 'true'); }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
    function move(delta) {
      if (!shown.length) return;
      active = (active + delta + shown.length) % shown.length;
      list.querySelectorAll('li[role=option]').forEach((li, i) => li.setAttribute('aria-selected', i === active));
      const li = list.children[active]; if (li) li.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', 'opt-' + shown[active].id);
    }
    function choose(id) {
      const b = getList().find(x => x.id === id); if (!b) return;
      input.value = b.name; close();
      if (hidden.value !== id) { hidden.value = id; hidden.dispatchEvent(new Event('change')); }
    }
    const restore = () => { const b = getList().find(x => x.id === hidden.value); if (b) input.value = b.name; };
    input.addEventListener('focus', () => { input.select(); open(''); });
    input.addEventListener('input', () => open(input.value));
    input.addEventListener('click', () => { if (list.hidden) { input.select(); open(''); } });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); list.hidden ? open('') : move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list.hidden ? open('') : move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (!list.hidden && active >= 0) choose(shown[active].id); }
      else if (e.key === 'Escape') { close(); restore(); input.select(); }
      else if (e.key === 'Tab') { if (!list.hidden && active >= 0 && input.value.trim() && norm(input.value) !== norm((getList().find(x => x.id === hidden.value) || {}).name || '')) choose(shown[active].id); close(); }
    });
    input.addEventListener('blur', () => setTimeout(() => { close(); restore(); }, 120));
    list.addEventListener('mousedown', e => { const li = e.target.closest('li[role=option]'); if (li) { e.preventDefault(); choose(li.dataset.id); } });
    $('boss-toggle').addEventListener('mousedown', e => { e.preventDefault(); if (list.hidden) { input.focus(); } else { close(); } });
  }

  // Each boss with its default settings (no player input): used by the All bosses table
  function defaultRun(boss) {
    let b = boss;
    const none = new Set();
    if (b.delveTables) b = delveRun(b, b.delveOption.defaultDelve || 8);
    if (b.slayerOption || b.capeGamble) {
      const base = b.slayerOption && b.slayerOption.default ? 1 / b.slayerOption.petRate : 1 / b.petRate;
      const miss = (1 - base) * (b.capeGamble ? 1 - b.capeGamble.petChance : 1);
      b = { ...b, petRate: 1 / (1 - miss) };
    }
    if (b.quiverOption) {
      const Q = b.quiverOption;
      if (Q.default === 'gamble') b = { ...b, petRate: 1 / (1 - (1 - 1 / b.petRate) * (1 - Q.extraPetChance)) };
      else b = { ...b, drops: [...b.drops, { item: Q.splinterItem, qtyMin: Q.splinters, qtyMax: Q.splinters, expectedPerKill: 1, table: "Dizana's quiver exchange" }] };
    }
    if (b.teamOption) b = teamRun(b, b.teamOption.default);
    if (b.lootChoice) b = choiceRun(b, 1, none);
    if (b.raidOption) {
      const R = b.raidOption;
      if (R.type === 'toa') {
        const L = R.defaultRaidLevel;
        b = toaRun(b, R.defaultTeamSize, L, Math.min(R.personalPointsCap, R.defaultPoints.base * (1 + R.defaultPoints.perRaidLevel * L)));
      } else if (R.type === 'cox') {
        b = coxRun(b, R.defaultMode, R.defaultTeamSize, (R.defaultScale || R.defaultTeamSize) * R.defaultPointsPerScale[R.defaultMode], false);
      } else {
        b = raidRun(b, R.defaultMode, R.defaultTeamSize, false);
      }
    }
    const ev = computeBoss(b, DATA.items, none, (boss.defaultPerfectPercent || 0) / 100).evPerKill;
    return { petRate: b.petRate, ev, total: ev * b.petRate, unit: (b.unit || 'kill').replace(/^full Colosseum /, '') };
  }

  const isMisc = b => !!b && b.category === 'misc';
  // Default supply cost per unit: a fixed Wiki figure, or live-priced items (e.g. chompy arrows)
  function defaultCost(b) {
    if (b.defaultCostItems) return b.defaultCostItems.reduce((s, x) => s + ((DATA.items[x.item] || {}).price || 0) * x.qty, 0);
    return b.defaultCost != null ? b.defaultCost : null;
  }
  const nameKey = n => n.replace(/^the\s+/i, '');
  const OVS = {
    overview: { table: 'overview', first: 'Source', sort: { key: 'profit', dir: -1 }, rows: [] },
  };
  // Owned pets are stored by pet name, so a pet shared by two sources (Youngllef, Venenatis spiderling...) ticks both rows
  const petKey = r => (r.pet || r.id).toLowerCase();
  const ownedSet = () => {
    let list; try { list = JSON.parse(store.get('owned') || '[]'); } catch (e) { list = []; }
    // Older saves stored row ids: convert any that match a row to its pet name
    const rows = OVS.overview.rows, byId = new Map(rows.map(r => [r.id, petKey(r)]));
    return new Set(list.map(k => byId.get(k) || k));
  };
  const ovFilter = () => ['all', 'boss', 'skill', 'misc'].includes(store.get('ovfilter')) ? store.get('ovfilter') : 'all';
  function setupOverviewControls() {
    const seg = $('ov-filter');
    const sync = () => seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === ovFilter())));
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { store.set('ovfilter', b.dataset.filter); sync(); renderOverview('overview'); }));
    sync();
    $('hide-owned').checked = store.get('hideowned') === '1';
    $('hide-owned').addEventListener('change', () => { store.set('hideowned', $('hide-owned').checked ? '1' : '0'); renderOverview('overview'); });
  }
  // Export / import everything this page keeps in localStorage (all keys start "pethunt:")
  function setupSettingsIO() {
    const msg = t => { $('settings-msg').textContent = t; };
    $('export-settings').addEventListener('click', () => {
      const settings = {};
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('pethunt:')) settings[k.slice(8)] = localStorage.getItem(k); } }
      catch (e) { msg('Your browser is blocking saved settings, so there is nothing to export.'); return; }
      const blob = new Blob([JSON.stringify({ app: 'pet-hunt-profit-calculator', version: 1, exported: new Date().toISOString(), settings }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'pet-hunt-settings.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      msg(`Exported ${Object.keys(settings).length} settings.`);
    });
    $('import-settings').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', async () => {
      const f = $('import-file').files[0];
      $('import-file').value = '';
      if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        if (!d || d.app !== 'pet-hunt-profit-calculator' || typeof d.settings !== 'object') throw new Error('bad');
        const entries = Object.entries(d.settings).filter(([k, v]) => typeof k === 'string' && typeof v === 'string');
        const old = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('pethunt:')) old.push(k); }
        old.forEach(k => localStorage.removeItem(k));
        entries.forEach(([k, v]) => localStorage.setItem('pethunt:' + k, v));
        msg(`Imported ${entries.length} settings. Reloading…`);
        setTimeout(() => location.reload(), 700);
      } catch (e) {
        msg("That file isn't a Pet Hunt settings export.");
      }
    });
  }
  function showPricesDate(m) {
    const el = $('prices-date');
    const d = new Date((m.pricesUpdatedAt || m.pricesUpdated + 'T00:00:00Z'));
    if (isNaN(d)) { el.hidden = true; return; }
    const txt = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const age = Math.floor((Date.now() - d) / 864e5);
    const stale = age > 14;
    el.classList.toggle('stale', stale);
    el.innerHTML = stale
      ? `<b>Prices may be out of date:</b> last updated ${txt} (${age} days ago). They normally update every Monday.`
      : `Prices updated ${txt}${age === 0 ? ' (today)' : age === 1 ? ' (yesterday)' : ` (${age} days ago)`}.`;
    el.title = m.priceSource || '';
  }
  function buildOverview() {
    const all = DATA.bosses.map(b => {
      const run = defaultRun(b);
      // Time to pet: the player's own kills per hour if they've entered one, else the Wiki default
      const own = parseFloat(store.get('kph:' + b.id)) || 0;
      const kph = own > 0 ? own : b.defaultKph || 0;
      const ownCost = store.get('cost:' + b.id);
      const cpu = ownCost != null && ownCost !== '' ? (parseFloat(ownCost) || 0) : defaultCost(b);
      return { id: b.id, name: b.name, pet: b.petName || '', misc: b.category === 'misc', ...run,
        supplies: cpu == null ? null : cpu * run.petRate, costOwn: ownCost != null && ownCost !== '',
        costNote: ownCost != null && ownCost !== '' ? `Your ${ownCost} gp per ${run.unit}` : cpu == null ? 'No default supply cost yet: add your own in its breakdown' : `${Math.round(cpu).toLocaleString('en-GB')} gp per ${run.unit}: ${b.costSource || ''}`,
        hours: kph > 0 ? run.petRate / kph : null, timeUnit: 'h', timeOwn: own > 0,
        timeNote: own > 0 ? `Your ${own} per hour` : b.defaultKph ? `${+b.defaultKph.toFixed(2)} ${run.unit}s per hour: ${b.kphSource}` : 'No default rate yet: add your own in its breakdown' };
    });
    // Skilling pets at their best-ranked method (the top row on their page)
    const skill = (DATA.skillingPets || []).map(p => {
      const top = skillRun(p, DATA.items).top[0];
      if (!top) return null;
      const pos = Object.values(top.parts).filter(v => v > 0).reduce((a, v) => a + v, 0) * top.hours;
      const neg = -Object.values(top.parts).filter(v => v < 0).reduce((a, v) => a + v, 0) * top.hours;
      return { id: 'skill-' + p.id, skillId: p.id, name: `${top.name} (${p.skill})`, pet: p.name, total: pos, supplies: neg, costNote: 'Supplies used by the top method (see its page)', hours: top.hours, timeUnit: p.timeUnit === 'day' ? 'day' : 'h', timeNote: top.rateSource || '' };
    }).filter(Boolean);
    [...all, ...skill].forEach(r => { r.profit = r.total - (r.supplies || 0); r.perHour = r.hours ? r.profit / r.hours : null; r.cat = r.skillId ? 'skill' : r.misc ? 'misc' : 'boss'; });
    OVS.overview.rows = [...all, ...skill];
    renderOverview('overview');
    if (!DATA.bosses.some(isMisc)) $('tab-misc').hidden = true;
  }
  function renderOverview(which = 'overview') {
    const S = OVS[which], ovSort = S.sort;
    const cols = [{ key: 'name', label: S.first }, { key: 'pet', label: 'Pet' }, { key: 'hours', label: 'Time to pet' }, { key: 'profit', label: 'Profit by pet rate' }, { key: 'perHour', label: 'Profit per hour' }];
    const thead = $(S.table).tHead, tbody = $(S.table).tBodies[0];
    thead.innerHTML = '<tr><th scope="col" class="own"><span class="visually-hidden">Owned</span><span aria-hidden="true" title="Pets you own">✓</span></th>' + cols.map(c => {
      const active = c.key === ovSort.key;
      return `<th scope="col"${['profit', 'hours', 'perHour'].includes(c.key) ? ' style="text-align:right"' : ''}><button type="button" data-key="${c.key}"${active ? ` aria-sort="${ovSort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${c.label}<span class="arr">${active ? (ovSort.dir > 0 ? '▲' : '▼') : ''}</span></button></th>`;
    }).join('') + '</tr>';
    thead.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.key;
      if (k === ovSort.key) ovSort.dir = -ovSort.dir; else S.sort = { key: k, dir: k === 'profit' || k === 'perHour' ? -1 : 1 };  // hours sort fastest first
      renderOverview(which);
      thead.querySelector(`button[data-key="${k}"]`).focus();
    }));
    const srt = S.sort;
    const cmp = (a, b) => {
      if (srt.key === 'profit') return (a.profit - b.profit) * srt.dir;
      if (srt.key === 'perHour') {
        const rank = r => r.perHour == null ? 2 : r.timeUnit === 'day' ? 1 : 0;
        return rank(a) - rank(b) || ((a.perHour ?? 0) - (b.perHour ?? 0)) * srt.dir;
      }
      if (srt.key === 'hours') {
        // hours first (numeric), then farming runs in days, then rows with no rate
        const rank = r => r.hours == null ? 2 : r.timeUnit === 'day' ? 1 : 0;
        return rank(a) - rank(b) || ((a.hours ?? 0) - (b.hours ?? 0)) * srt.dir;
      }
      const petSort = t => t.replace(/^pet\s+/i, '');
      const x = srt.key === 'name' ? nameKey(a.name) : petSort(a.pet), y = srt.key === 'name' ? nameKey(b.name) : petSort(b.pet);
      return x.localeCompare(y, 'en', { sensitivity: 'base', ignorePunctuation: true }) * srt.dir || nameKey(a.name).localeCompare(nameKey(b.name));
    };
    const owned = ownedSet(), hideOwned = $('hide-owned').checked, filt = ovFilter();
    const shown = S.rows.filter(r => (filt === 'all' || r.cat === filt) && !(hideOwned && owned.has(petKey(r))));
    const inFilter = S.rows.filter(r => filt === 'all' || r.cat === filt);
    const petsIn = new Set(inFilter.map(petKey));
    $('owned-count').textContent = `${[...petsIn].filter(k => owned.has(k)).length} of ${petsIn.size} pets owned`;
    tbody.innerHTML = shown.length ? [...shown].sort(cmp).map(r => `
      <tr data-id="${esc(r.id)}"${owned.has(petKey(r)) ? ' class="owned"' : ''}>
        <td class="own"><input type="checkbox" data-own="${esc(petKey(r))}" aria-label="I own ${esc(r.pet)}"${owned.has(petKey(r)) ? ' checked' : ''}></td>
        <td class="item"><button type="button" class="open" data-id="${esc(r.id)}">${esc(r.name)}</button></td>
        <td class="pet">${esc(r.pet)}</td>
        <td class="num time" title="${esc(r.timeNote || '')}">${r.hours == null ? '<span class="untr">—</span>' : `${r.hours >= 100 ? int(r.hours) : r.hours.toFixed(1)}${r.timeUnit === 'day' ? ' days' : ' h'}${r.timeOwn ? '<sup>*</sup>' : ''}`}</td>
        <td class="num" title="${esc(`Loot ${Math.round(r.total).toLocaleString('en-GB')} gp, supplies ${r.supplies == null ? 'unknown' : Math.round(r.supplies).toLocaleString('en-GB') + ' gp'}. ${r.costNote || ''}`)}">${money(r.profit)}${r.costOwn ? '<sup>*</sup>' : ''}${r.supplies == null ? '<span class="untr" title="No supply cost yet"> †</span>' : ''}</td>
        <td class="num" title="${esc(r.perHour == null ? 'Needs a time to pet' : r.timeUnit === 'day' ? 'Profit per day of farming runs' : 'Profit by pet rate ÷ time to pet')}">${r.perHour == null ? '<span class="untr">—</span>' : money(r.perHour) + (r.timeUnit === 'day' ? '<span class="unit">/day</span>' : '')}</td>
      </tr>`).join('') : `<tr><td colspan="${cols.length + 1}" style="text-align:left" class="untr">No pets to show${hideOwned ? ': you own them all' : ''}.</td></tr>`;
    tbody.querySelectorAll('input[data-own]').forEach(cb => {
      cb.addEventListener('click', e => e.stopPropagation());
      cb.addEventListener('change', () => {
        const set = ownedSet();
        if (cb.checked) set.add(cb.dataset.own); else set.delete(cb.dataset.own);
        store.set('owned', JSON.stringify([...set]));
        renderOverview(which);
      });
    });
    tbody.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => {
      const id = tr.dataset.id;
      if (id.startsWith('skill-')) openSkill(id.slice(6)); else openBoss(id);
    }));
  }
  function openSkill(id) {
    const p = (DATA.skillingPets || []).find(x => x.id === id); if (!p) return;
    SKILL = p; $('skill-pet').value = id; store.set('skillpet', id); renderSkill(); showView('skill'); window.scrollTo(0, 0);
  }
  function showView(v) {
    $('overview-view').hidden = v !== 'overview';
    $('calc-view').hidden = v !== 'calc';
    $('skill-view').hidden = v !== 'skill';
    const miscCalc = v === 'calc' && isMisc(current);
    $('tab-misc').setAttribute('aria-current', miscCalc ? 'page' : 'false');
    $('tab-overview').setAttribute('aria-current', v === 'overview' ? 'page' : 'false');
    $('tab-calc').setAttribute('aria-current', v === 'calc' && !miscCalc ? 'page' : 'false');
    $('boss-label').textContent = miscCalc ? 'Miscellaneous pet' : 'Boss';
    $('boss-input').placeholder = miscCalc ? 'Type to search' : 'Type to search bosses';
    $('tab-skill').setAttribute('aria-current', v === 'skill' ? 'page' : 'false');
    const hash = v === 'calc' ? current.id : v === 'skill' && SKILL ? 'skill-' + SKILL.id : 'all';
    try { history.replaceState(null, '', '#' + hash); } catch (e) {}
  }

  // ---------- Skilling pets (modelled per training method) ----------
  let SKILL = null;
  function termsValue(terms, items) {
    return Math.max(0, terms.reduce((sum, t) => sum + ((items[t.item] || {}).price || 0) * t.factor, 0));
  }
  // Skilling success chance at an effective level (interpolated between the level 1 and 99 values; beyond 99 for invisible boosts)
  function successChance(low, high, level) {
    return Math.min(1, (1 + Math.floor(low * (99 - level) / 98 + high * (level - 1) / 98 + 0.5)) / 256);
  }
  // Generic methods: fixed rolls per hour with per-roll outputs and inputs (Mining, Fishing)
  function genericRow(pet, m, items) {
    const price = n => (items[n] || {}).price || 0;
    const petChance = m.chancePerAction || 1 / (m.baseChance - pet.levelFactor * pet.level);
    const parts = {};
    const keep = m.inventory !== 'drop';
    (m.outputs || []).forEach(o => { if (keep) parts[o.item] = (parts[o.item] || 0) + o.perAction * m.actionsPerHour * price(o.item); });
    (m.inputs || []).forEach(o => { parts[o.item] = (parts[o.item] || 0) - o.perAction * m.actionsPerHour * price(o.item); });
    const gpHr = Object.values(parts).reduce((a, b) => a + b, 0);
    const hours = 1 / (petChance * m.actionsPerHour);
    return { ...m, chopsPerHour: m.actionsPerHour, petChance, hours, gpHr, parts, total: gpHr * hours };
  }
  function skillRun(pet, items) {
    if (!pet.setup) return rankRows(pet, pet.methods.map(m => genericRow(pet, m, items)), {});
    const S = pet.setup, tick = S.tickSeconds;
    const barkValue = S.forestry ? termsValue(S.forestry.barkValueTerms, items) : 0;
    const shardValue = S.crystalShards ? termsValue(S.crystalShards.valueTerms, items) : 0;
    const ration = (items[S.rationItem] || {}).price || 0;
    const secateurs = (items[S.secateursItem] || {}).price || 0;
    const logShare = 1 - S.noLogChance;
    const rows = pet.methods.map(m => {
      const t = pet.trees[m.tree];
      const p = successChance(t.successLow, t.successHigh, pet.level + (m.levelBoost || 0));
      const rollTicks = m.rollTicks || S.rollTicks;
      // successful chops per second while chopping
      let c = rollTicks === S.rollTicks
        ? p / (rollTicks * tick) * t.despawnSeconds / (t.despawnSeconds + S.treeHopSeconds)
        : p / (rollTicks * tick) * S.twoTickEfficiency;
      if (m.inventory === 'bank') c = 1 / (1 / c + logShare * m.bankTripSeconds / S.inventoryCapacity);
      const eventMinutes = m.forestry && S.forestry ? S.forestry.eventsPerHour * S.forestry.minutesPerEvent : 0;
      const chopsPerHour = c * (60 - eventMinutes) * 60;
      const petChance = 1 / (t.baseChance - pet.levelFactor * pet.level);
      const hours = 1 / (petChance * chopsPerHour);
      const logs = chopsPerHour * logShare;
      const leafLogs = t.leaves && m.inventory === 'bank' ? logs : 0;
      const parts = {
        logs: m.inventory === 'bank' ? logs * ((items[t.log] || {}).price || 0) : 0,
        leaves: leafLogs * S.leavesPerLog * ((items[t.leaves] || {}).price || 0),
        shards: m.prifddinas && S.crystalShards ? logs * S.crystalShards.chancePerLog * shardValue : 0,
        bark: m.forestry && S.forestry ? S.forestry.barkPerHour * barkValue : 0,
        rations: -chopsPerHour * (S.rationsPerChop || 0) * ration,
        secateurs: -leafLogs * (S.secateursPerLog || 0) * secateurs,
      };
      const gpHr = Object.values(parts).reduce((a, b) => a + b, 0);
      return { ...m, treeName: t.name, success: p, chopsPerHour, petChance, hours, gpHr, parts, total: gpHr * hours };
    });
    return rankRows(pet, rows, { barkValue, shardValue });
  }
  function rankRows(pet, rows, extraInfo) {
    // Equal weight: average of the rank for hours to pet (fastest first) and for total profit (highest first).
    // Tick-manipulation methods are left out of the ranking and only listed under "Show every method".
    const hideTM = (pet.ranking || {}).excludeTickManipulation;
    const ranked = rows.filter(r => !(hideTM && r.tickManipulation));
    const extra = rows.filter(r => hideTM && r.tickManipulation).sort((a, b) => a.hours - b.hours);
    const rankBy = (key, dir) => ranked.forEach(r => r['rank_' + key] = 1 + ranked.filter(o => dir * (o[key] - r[key]) < -1e-9).length); // ties share a rank
    rankBy('hours', 1); rankBy('total', -1);
    ranked.forEach(r => r.score = (r.rank_hours + r.rank_total) / 2);
    ranked.sort((a, b) => a.score - b.score || a.hours - b.hours);
    rows.length = 0; rows.push(...ranked, ...extra);
    const top = ranked.slice(0, (pet.ranking || {}).top || 5);
    top.forEach((r, i) => r.rank = i + 1);
    return { rows, top, ...extraInfo };
  }
  function setupSkill(pets) {
    const sel = $('skill-pet');
    if (!pets.length) { $('tab-skill').hidden = true; return; }
    sel.innerHTML = pets.map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.skill)})</option>`).join('');
    const saved = store.get('skillpet');
    SKILL = pets.find(p => p.id === saved) || pets[0];
    sel.value = SKILL.id;
    sel.addEventListener('change', () => { SKILL = pets.find(p => p.id === sel.value); store.set('skillpet', SKILL.id); renderSkill(); showView('skill'); });
    $('skill-all').checked = store.get('skillall') === '1';
    $('skill-all').addEventListener('change', () => { store.set('skillall', $('skill-all').checked ? '1' : '0'); renderSkill(); });
    renderSkill();
  }
  function renderSkill() {
    const pet = SKILL, res = skillRun(pet, DATA.items), R = pet.ranking || {};
    const U = pet.timeUnit === 'day' ? ' days' : ' h';
    const hrs = h => (h >= 100 ? int(h) : h.toFixed(1)) + U;
    $('skill-source').innerHTML = `<a href="${esc(pet.wikiUrl)}" target="_blank" rel="noopener">${esc(pet.name)} on the OSRS Wiki</a>`;
    $('skill-intro').innerHTML = `Each method is modelled at level ${pet.level} ${esc(pet.skill)}, and the ${(R.top || 5)} best are chosen with <b>${esc(R.label || 'a balanced score')}</b>.${R.excludeTickManipulation ? ' Tick-manipulation methods are not ranked; tick “Show every method” to see them.' : ''} ${pet.costOnly ? 'Cost' : 'Profit'} is the total over the ${pet.timeUnit === 'day' ? 'days' : 'hours'} matching the pet's drop rate, not a guarantee of getting it by then.`;
    const best = res.top[0];
    const pool = res.rows.filter(r => !(R.excludeTickManipulation && r.tickManipulation));
    const fastest = pool.reduce((a, b) => b.hours < a.hours ? b : a);
    const richest = pool.reduce((a, b) => b.total > a.total ? b : a);
    $('skill-summary').innerHTML = `
      <div class="stat hero"><span class="k">Pet</span><span class="pet">${esc(pet.name)}</span><span class="s">${esc(pet.skill)} ${pet.level}</span></div>
      <div class="stat"><span class="k">Best balance</span><span class="v">${pet.costOnly ? costGp(-best.total) + '<span class="hint"> cost</span>' : gp(best.total)}</span><span class="s">${esc(best.name)}, ${esc(best.location)} · ${hrs(best.hours)} to pet</span></div>
      <div class="stat"><span class="k">Fastest pet${R.excludeTickManipulation ? ' (no tick manipulation)' : ''}</span><span class="v">${hrs(fastest.hours)}</span><span class="s">${esc(fastest.name)}, ${esc(fastest.location)} · ${pet.costOnly ? costGp(-fastest.total) + ' cost' : gpShort(fastest.total) + ' profit'}</span></div>
      <div class="stat"><span class="k">${pet.costOnly ? 'Cheapest by the pet rate' : 'Most profit by the pet rate'}</span><span class="v">${pet.costOnly ? costGp(-richest.total) : gp(richest.total)}</span><span class="s">${esc(richest.name)}, ${esc(richest.location)} · ${hrs(richest.hours)} to pet</span></div>`;
    const showAll = $('skill-all').checked;
    $('skill-heading').textContent = showAll ? `All ${res.rows.length} methods` : `${res.top.length} best methods`;
    const rows = showAll ? res.rows : res.top;
    const names = { logs: 'Logs', leaves: 'Leaves', shards: 'Crystal shards', bark: 'Anima bark', rations: 'Rations', secateurs: 'Secateurs' };
    const parts = r => Object.entries(r.parts).filter(([, v]) => v)
      .map(([k, v]) => `${names[k] || k}: ${Math.round(v * r.hours).toLocaleString('en-GB')}`).join('\n') || 'No profit';
    $('skill-table').tHead.innerHTML = `<tr><th scope="col">#</th><th scope="col">Method</th><th scope="col" style="text-align:right">${pet.timeUnit === 'day' ? 'Days' : 'Hours'} to pet</th><th scope="col" style="text-align:right">${pet.costOnly ? 'Cost by pet rate' : 'Profit by pet rate'}</th><th scope="col" style="text-align:right">${esc(pet.rollsLabel || 'Pet rolls/hr')}</th><th scope="col" style="text-align:right">Pet chance per roll</th></tr>`;
    $('skill-table').tBodies[0].innerHTML = rows.map(r => `
      <tr class="${r.rank ? '' : 'outside'}">
        <td class="rank">${r.rank || '–'}</td>
        <td class="method"${r.rateSource ? ` title="Rate: ${esc(r.rateSource)}"` : ''}>${esc(r.name)}${r.tickManipulation ? `<span class="badge">${esc(r.tickLabel || 'Tick manipulation')}</span>` : ''}<span class="where">${esc(r.location)} · ${r.inventory === 'drop' ? 'dropping' : 'banking'}${r.forestry ? ' · Forestry events' : ''}</span><span class="req">${esc(r.requirements || '')}${r.requirements && r.note ? ' — ' : ''}${esc(r.note || '')}</span></td>
        <td class="num">${hrs(r.hours)}</td>
        <td class="num" title="${esc(parts(r))}">${pet.costOnly ? costGp(-r.total) : gp(r.total)}</td>
        <td class="num">${r.chopsPerHour < 100 ? r.chopsPerHour.toFixed(1) : int(r.chopsPerHour)}${r.unit ? `<span class="where">${esc(r.unit)}</span>` : ''}</td>
        <td class="num">1/${int(1 / r.petChance)}</td>
      </tr>`).join('');
    $('skill-assumptions').innerHTML = (pet.assumptions || []).map(a => `<li>${esc(a)}</li>`).join('')
      + (pet.setup ? `<li>Current values: anima-infused bark ${res.barkValue.toFixed(1)} gp each; crystal shard ${int(res.shardValue)} gp each.</li>` : '')
      + `<li>Hover a ${pet.costOnly ? 'cost' : 'profit'} figure to see where it comes from.</li>`;
  }
  function openBoss(id) {
    const b = DATA.bosses.find(x => x.id === id); if (!b) return;
    $('boss').value = id; $('boss-input').value = b.name;
    store.set(isMisc(b) ? 'miscboss' : 'boss', id); enabled.clear(); selectBoss();
    showView('calc'); window.scrollTo(0, 0);
  }
  // Miscellaneous Pets tab: show the last miscellaneous breakdown (or the first one)
  function openMiscTab() {
    if (isMisc(current) && !$('calc-view').hidden) return;
    const saved = store.get('miscboss');
    const b = DATA.bosses.find(x => x.id === saved && isMisc(x)) || DATA.bosses.find(isMisc);
    if (b) openBoss(b.id);
  }
  // Boss Pets tab: return to the last boss if a miscellaneous breakdown is showing
  function openBossTab() {
    if (!isMisc(current)) return showView('calc');
    const saved = store.get('boss');
    const b = DATA.bosses.find(x => x.id === saved && !isMisc(x)) || DATA.bosses.find(x => !isMisc(x));
    openBoss(b.id);
  }

  function teamCfg(boss) {
    if (!boss) return null;
    if (boss.raidOption) return boss.raidOption;
    if (boss.teamOption) return { teamSizeMin: boss.teamOption.min, teamSizeMax: boss.teamOption.max, defaultTeamSize: boss.teamOption.default };
    return null;
  }
  function clampRaidInputs() {
    const R = teamCfg(current); if (!R) return;
    const t = Math.round(parseFloat($('team').value));
    $('team').value = isNaN(t) ? R.defaultTeamSize : Math.min(R.teamSizeMax, Math.max(R.teamSizeMin, t));
    if (R.scaleMax) {
      const sc = Math.round(parseFloat($('scale').value));
      $('scale').min = $('team').value;
      $('scale').value = isNaN(sc) ? $('team').value : Math.min(R.scaleMax, Math.max(+$('team').value, sc));
    }
  }

  function selectBoss() {
    current = DATA.bosses.find(b => b.id === $('boss').value) || DATA.bosses[0];
    $('kph').value = store.get('kph:' + current.id) || '';
    $('kph').placeholder = current.defaultKph ? `Default: ${+current.defaultKph.toFixed(2)}` : 'Optional, e.g. 30';
    { const dc = defaultCost(current); $('cost').placeholder = dc != null ? `Default: ${Math.round(dc).toLocaleString('en-GB')}` : 'Optional, e.g. 25000'; }
    $('cost').value = store.get('cost:' + current.id) || '';
    const conds = [...new Set(current.drops.filter(d => d.includeByDefault === false).map(d => d.condition))];
    $('conditions').innerHTML = conds.map((c, i) => {
      const items = current.drops.filter(d => d.condition === c).map(d => d.item);
      return `<label><input type="checkbox" id="cond-${i}" data-cond="${esc(c)}"> Include ${esc([...new Set(items)].join(', '))} (${esc(c)})</label>`;
    }).join('');
    $('conditions').querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
      cb.checked ? enabled.add(cb.dataset.cond) : enabled.delete(cb.dataset.cond); render();
    }));
    $('perfect-field').hidden = !current.perfectKillOption;
    $('delve-field').hidden = !current.delveTables;
    $('duo-extra').hidden = !current.duoOption;
    $('quiver-extra').hidden = !current.quiverOption;
    $('slayer-extra').hidden = !current.slayerOption;
    $('diary-extra').hidden = !current.diaryOption;
    if (current.diaryOption) { $('diary-label').textContent = current.diaryOption.label; $('diary').checked = store.get('diary:' + current.diaryOption.key) === '1'; }
    if (current.slayerOption) { $('slayer-label').textContent = current.slayerOption.label; const sv = store.get('slayer:' + current.id); $('slayer').checked = sv == null ? !!current.slayerOption.default : sv === '1'; }
    if (current.perfectKillOption) { const pv = store.get('perfect:' + current.id); $('perfect').value = pv != null && pv !== '' ? pv : (current.defaultPerfectPercent ?? ''); }
    if (current.quiverOption) {
      const qv = store.get('quiver:' + current.id) || current.quiverOption.default;
      $('quiver-gamble').checked = qv === 'gamble'; $('quiver-exchange').checked = qv !== 'gamble';
    }
    $('duo').checked = store.get('duo:' + current.id) === '1';
    const R = current.raidOption, isCox = !!(R && R.type === 'cox'), isToa = !!(R && R.type === 'toa');
    const TC = teamCfg(current);
    $('team-field').hidden = !TC;
    if (TC && !R) {
      $('team').max = TC.teamSizeMax;
      $('team-label').textContent = `Team size (${TC.teamSizeMin}–${TC.teamSizeMax})`;
      $('team').value = store.get('raid:' + current.id + ':team') || TC.defaultTeamSize;
      clampRaidInputs();
    }
    $('mode-field').hidden = !(R && R.modes);
    $('scale-field').hidden = !isCox;
    $('level-field').hidden = !isToa;
    $('points-field').hidden = !(isCox || isToa);
    $('points-label').textContent = isToa ? 'Points per player' : 'Team points';
    if (R) {
      const key = k => 'raid:' + current.id + ':' + k;
      if (R.modes) $('mode').innerHTML = Object.entries(R.modes).map(([k, m]) => `<option value="${esc(k)}">${esc(m.label)}</option>`).join('');
      const savedMode = store.get(key('mode'));
      if (R.modes) $('mode').value = savedMode && R.modes[savedMode] ? savedMode : R.defaultMode;
      $('level').value = store.get(key('level')) || R.defaultRaidLevel || 300;
      $('team').max = R.teamSizeMax;
      $('team-label').textContent = `Team size (${R.teamSizeMin}–${R.teamSizeMax})`;
      $('team').value = store.get(key('team')) || R.defaultTeamSize;
      $('scale').value = store.get(key('scale')) || R.defaultScale || R.defaultTeamSize;
      $('points').value = store.get(key('points')) || '';
      $('target').checked = store.get(key('target')) === '1';
      clampRaidInputs();
    }
    $('source').innerHTML = `<a href="${esc(current.wikiUrl)}" target="_blank" rel="noopener">${esc(current.name)} on the OSRS Wiki</a>`;
    render();
  }

  function render() {
    let b = current;
    let delve = null;
    if (b.delveTables) {
      const raw = Math.round(parseFloat($('delve').value));
      delve = isNaN(raw) ? 8 : Math.min(30, Math.max(6, raw));
      b = delveRun(b, delve);
    }
    if (b.diaryOption && $('diary').checked) {
      const D = b.diaryOption;
      b = { ...b, drops: b.drops.map(x => D.items.includes(x.item) ? { ...x, qtyMin: x.qtyMin * D.multiplier, qtyMax: x.qtyMax * D.multiplier } : x) };
    }
    let capeNote = '';
    if (b.slayerOption || b.capeGamble) {
      const onTask = !!(b.slayerOption && $('slayer').checked);
      const base = 1 / (onTask ? b.slayerOption.petRate : b.petRate);
      const miss = (1 - base) * (b.capeGamble ? 1 - b.capeGamble.petChance : 1);
      b = { ...b, petRate: 1 / (1 - miss) };
      capeNote = `${onTask ? ' on task' : ''}${b.capeGamble ? ', with the cape gamble' : ''}`;
    }
    let quiver = null;
    if (b.quiverOption) {
      const Q = b.quiverOption;
      quiver = $('quiver-gamble').checked ? 'gamble' : 'exchange';
      if (quiver === 'gamble') {
        b = { ...b, petRate: 1 / (1 - (1 - 1 / b.petRate) * (1 - Q.extraPetChance)) };
      } else {
        b = { ...b, drops: [...b.drops, { item: Q.splinterItem, qtyMin: Q.splinters, qtyMax: Q.splinters, expectedPerKill: 1, table: "Dizana's quiver exchange" }] };
      }
    }
    if (b.teamOption) { clampRaidInputs(); b = teamRun(b, +$('team').value); }
    let duo = false;
    if (b.lootChoice) {
      duo = !!(b.duoOption && $('duo').checked);
      b = choiceRun(b, duo ? b.duoOption.contributionShare : 1);
    }
    let raid = null;
    if (b.raidOption) {
      const R = b.raidOption;
      clampRaidInputs();
      if (R.type === 'toa') {
        const L = Math.min(600, Math.max(0, Math.round(parseFloat($('level').value)) || 0));
        const est = Math.min(R.personalPointsCap, R.defaultPoints.base * (1 + R.defaultPoints.perRaidLevel * L));
        $('points').placeholder = `Estimate: ${int(est)}`;
        const typed = parseFloat($('points').value);
        const P = isNaN(typed) || typed < 0 ? est : typed;
        raid = { label: `raid level ${L}`, team: +$('team').value, toa: true, points: Math.min(P, R.personalPointsCap), estimated: isNaN(typed) || typed < 0 };
        $('raid-extra').hidden = true;
        b = toaRun(b, raid.team, L, P);
      } else {
      const modeKey = R.modes[$('mode').value] ? $('mode').value : R.defaultMode, mode = R.modes[modeKey];
      raid = { mode: modeKey, label: mode.label, team: +$('team').value };
      const hasTarget = !!(mode.targetTimeCommonMultiplier || mode.targetTimePointsPerPlayer);
      raid.target = hasTarget && $('target').checked;
      $('raid-extra').hidden = !hasTarget;
      if (R.type === 'cox') {
        raid.scale = +$('scale').value;
        const est = raid.scale * R.defaultPointsPerScale[modeKey];
        $('points').placeholder = `Estimate: ${int(est)}`;
        const typed = parseFloat($('points').value);
        raid.points = isNaN(typed) || typed < 0 ? est : typed;
        raid.estimated = isNaN(typed) || typed < 0;
        $('target-label').textContent = 'Completed within the Challenge Mode target time (+5,000 points per player, plus colour kit and metamorphic dust chances)';
        b = coxRun(b, modeKey, raid.team, raid.points, raid.target);
      } else {
        $('target-label').textContent = 'Completed within the Hard Mode target time (+15% more common loot)';
        b = raidRun(b, modeKey, raid.team, raid.target);
      }
      }
    } else {
      $('raid-extra').hidden = true;
    }
    const unit = (b.unit || 'kill').replace(/^full Colosseum /, '');
    UNIT = unit;
    const units = unit + 's', Units = units.charAt(0).toUpperCase() + units.slice(1);
    $('kph-label').textContent = `${Units} per hour`;
    $('cost-label').textContent = `Supply cost per ${unit}`;
    const perfectPct = b.perfectKillOption ? Math.min(100, Math.max(0, parseFloat($('perfect').value) || 0)) : 0;
    const res = computeBoss(b, DATA.items, enabled, perfectPct / 100);
    const kph = parseFloat($('kph').value) || current.defaultKph || 0;
    const cost = $('cost').value !== '' ? (parseFloat($('cost').value) || 0) : (defaultCost(current) || 0);
    const netPerKill = res.evPerKill - cost;
    const hasCost = cost > 0;

    const hours = kph > 0 ? b.petRate / kph : null;
    const timeCell = hours
      ? `<div class="v">${hours >= 100 ? int(hours) : hours.toFixed(1)} h</div><div class="s">${gp(netPerKill * kph)} ${hasCost ? 'net ' : ''}GP per hour</div>`
      : `<div class="v hint">—</div><div class="s">Add ${units} per hour to see time and GP/hour</div>`;

    $('summary').innerHTML = `
      <div class="stat">
        <div class="k">Pet</div>
        <div class="pet">${esc(b.petName)}</div>
        <div class="s">Drop rate 1/${rateNum(b.petRate)}${delve ? ` per run to delve ${delve}` : ''}${quiver === 'gamble' ? ' per run, including the quiver gamble' : ''}${capeNote ? ` per completion${capeNote}` : ''}${raid ? ` ${raid.toa ? 'at' : 'in'} ${raid.label}, per player` : ''}</div>
      </div>
      <div class="stat">
        <div class="k">Loot per ${esc(unit)}</div>
        <div class="v">${money(res.evPerKill)}</div>
        <div class="s">${hasCost ? `${money(netPerKill)} after ${gp(cost)} supplies` : res.evPerKill < 0 ? `${int(-res.evPerKill)} gp cost` : `${int(res.evPerKill)} gp average`}${b.perfectKillOption ? ` · ${perfectPct}% perfect` : ''}${raid ? ` · your share in a team of ${raid.team}` : ''}${raid && raid.scale ? ` (scale ${raid.scale}, ${int(b.coxPoints)} team points${raid.estimated ? ' estimated' : ''})` : ''}${raid && raid.toa ? ` (${int(raid.points)} points each${raid.estimated ? ', estimated' : ''}; unique 1/${rateNum(1 / b.toaUnique)})` : ''}${b.teamN && !b.teamShare ? ` · team of ${b.teamN}${b.uniqueBonus ? `, +${Math.round(b.uniqueBonus * 100)}% unique rolls` : ''}` : ''}${b.teamShare ? ` · team of ${b.teamN}, your share ${(b.teamShare * 100).toFixed(1)}%${b.teamOption.listedAt === 'solo' ? ' of a solo kill' : ' incl. MVP bonus'}` : ''}${b.lootPick ? `<br>Looting ${esc(b.lootPick.name)}${duo ? ', duo share' : ''}; ${b.lootOthers.map(o => `${esc(o.name)} would give ${gp(o.ev)}`).join(', ')}` : ''}</div>
      </div>
      <div class="stat hero">
        <div class="k">${hasCost ? 'Net profit' : res.evPerKill < 0 ? 'Total cost' : 'Total loot'} at pet rate</div>
        <div class="v">${money(netPerKill * b.petRate)}</div>
        <div class="s">over ${rateNum(b.petRate)} ${esc(units)}${hasCost ? ` (${gp(res.totalAtRate)} before supplies)` : ''}</div>
      </div>
      <div class="stat">
        <div class="k">Time to pet rate</div>
        ${timeCell}
      </div>`;

    $('note').innerHTML = `${esc(Units)} at pet drop rate: <b>${rateNum(b.petRate)}</b>. This is the pet's ${delve ? `combined rate for a run to delve ${delve}` : b.coxPoints ? `rate at ${int(b.coxPoints)} team points` : quiver === 'gamble' ? 'combined rate with the quiver gamble' : capeNote ? `combined rate${capeNote}` : raid && raid.toa ? `rate at ${int(raid.points)} points` : 'listed rate'} (1/${rateNum(b.petRate)}), so the totals show what the average player loots over that many ${esc(units)}. Some players get ${esc(b.petName)} much sooner and some much later.`
      + (b.notes ? `<br><span class="assume"><b>Assumptions:</b> ${esc(b.notes)}</span>` : '');

    renderTable(res);
  }

  function renderTable(res) {
    const thead = $('drops').tHead, tbody = $('drops').tBodies[0];
    thead.innerHTML = '<tr>' + COLS.map(c0 => {
      const c = { ...c0, label: typeof c0.label === 'function' ? c0.label() : c0.label };
      if (c.nosort) return `<th scope="col"><button type="button" tabindex="-1" style="cursor:default">${c.label}</button></th>`;
      const active = c.key === sortKey;
      const aria = active ? ` aria-sort="${sortDir > 0 ? 'ascending' : 'descending'}"` : '';
      return `<th scope="col"><button type="button" data-key="${c.key}"${aria}>${c.label}<span class="arr">${active ? (sortDir > 0 ? '▲' : '▼') : ''}</span></button></th>`;
    }).join('') + '</tr>';
    thead.querySelectorAll('button[data-key]').forEach(btn => btn.addEventListener('click', () => {
      const k = btn.dataset.key;
      if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'item' ? 1 : -1; }
      renderTable(res);
      thead.querySelector(`button[data-key="${k}"]`).focus();
    }));

    const rows = [...res.rows].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (typeof x === 'string') return x.localeCompare(y) * sortDir;
      return ((x - y) || (b.valuePerKill - a.valuePerKill)) * sortDir;
    });
    const maxShare = Math.max(...rows.map(r => r.share), 0.0001);

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="item">${esc(r.item)}${r.condition ? `<span class="tag">${esc(r.condition)}</span>` : ''}${r.valueNote ? `<span class="tag">${esc(r.valueNote.replace(/^Untradeable: valued as /, 'valued as '))}</span>` : ''}</td>
        <td class="tables">${[...r.tables].map(t => TABLE_SHORT[t] || t).join(', ')}</td>
        <td class="num">${rateFmt(r.dropsPerKill)}</td>
        <td class="num">${r.avgQty < 0 ? `<span class="cost">(${qtyFmt(-r.avgQty)})</span>` : qtyFmt(r.avgQty)}</td>
        <td class="num">${r.tradeable ? gp(r.price) : r.valueNote ? `<span class="derived" title="${esc(r.valueNote)}">${gp(r.price)}<sup>*</sup></span>` : '<span class="untr">Untradeable</span>'}</td>
        <td class="num">${r.tradeable || r.valueNote ? money(r.valuePerKill) : '<span class="untr">0</span>'}</td>
        <td class="num"><span class="share">${(r.share * 100).toFixed(r.share >= 0.1 ? 0 : 1)}%<span class="bar"><b style="width:${(r.share / maxShare * 100).toFixed(1)}%"></b></span></span></td>
        <td class="num">${qtyFmt(r.dropsAtRate)}</td>
        <td class="num">${r.qtyAtRate < 0 ? `<span class="cost">(${qtyFmt(-r.qtyAtRate)})</span>` : qtyFmt(r.qtyAtRate)}</td>
      </tr>`).join('');
  }

  load().then(init).catch(err => {
    document.querySelector('.wrap').insertAdjacentHTML('afterbegin',
      `<div class="error">Couldn't load the app's data files (${esc(err.message)}).</div>`);
  });
})();
