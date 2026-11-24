// Loot per unit (kill, raid, run...) from drop tables, including raids, delves, team scaling
// and loot choices. Moved here from the pet calculator so every page uses the same numbers.
// Pure functions: `items` maps whatever a drop's `item` field holds to { price, tradeable }.

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
  // Anchors give weights for some uniques (fang, Lightbearer) at set raid levels; interpolate
  // between them in steps of 5 levels. Every key except raidLevel is an item reference.
  const a = R.uniqueWeightAnchors;
  const varying = Object.keys(a[0]).filter(k => k !== 'raidLevel');
  const at = {};
  if (L <= a[0].raidLevel) varying.forEach(k => at[k] = a[0][k]);
  else if (L >= a[a.length - 1].raidLevel) varying.forEach(k => at[k] = a[a.length - 1][k]);
  else {
    const L5 = L - (L % 5);
    for (let i = 0; i < a.length - 1; i++) {
      if (a[i].raidLevel <= L5 && L5 <= a[i + 1].raidLevel) {
        const t = (L5 - a[i].raidLevel) / (a[i + 1].raidLevel - a[i].raidLevel);
        varying.forEach(k => at[k] = a[i][k] + (a[i + 1][k] - a[i][k]) * t);
        break;
      }
    }
  }
  const w = { ...R.uniqueFixedWeights, ...at };
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
function choiceRun(boss, share, conds = new Set(), items) {
  const scaled = drops => drops.map(x => {
    const y = { ...x };
    if (x.contributionScales === 'quantity') { y.qtyMin = x.qtyMin * share; y.qtyMax = x.qtyMax * share; }
    if (x.contributionScales === 'rate') y.expectedPerKill = x.expectedPerKill * share;
    return y;
  });
  const opts = boss.lootChoice.options.map(o => {
    const drops = scaled(o.drops);
    return { name: o.name, drops, ev: computeBoss({ ...boss, drops }, items, conds).evPerKill };
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

// Loot per unit with every option at its default (what the summary tables use)
function defaultRun(boss, items) {
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
  if (b.lootChoice) b = choiceRun(b, 1, none, items);
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
  const ev = computeBoss(b, items, none, (boss.defaultPerfectPercent || 0) / 100).evPerKill;
  return { petRate: b.petRate, ev, total: ev * b.petRate, unit: (b.unit || 'kill').replace(/^full Colosseum /, '') };
}

export { computeBoss, delveRun, raidRun, coxRun, toaWeights, toaRun, choiceRun, teamRun, defaultRun };
