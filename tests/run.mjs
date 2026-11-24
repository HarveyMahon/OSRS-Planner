// Unit tests for the core, plus a check that the pet calculator's adapter rebuilds exactly
// the data the original site used. Run: node tests/run.mjs [path/to/original/bosses.json]
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
console.log('tests: starting');

globalThis.fetch = async url => {
  const text = await readFile(new URL(url));
  return { ok: true, json: async () => JSON.parse(text) };
};

const { xpForLevel, levelForXp, toXp } = await import('../core/xp.js');
const { isMet, combatLevel } = await import('../core/requirements.js');
let passed = 0;
const t = (name, fn) => { fn(); passed++; };

t('xp table', () => {
  assert.equal(xpForLevel(1), 0); assert.equal(xpForLevel(2), 83);
  assert.equal(xpForLevel(92), 6_517_253); assert.equal(xpForLevel(99), 13_034_431);
  assert.equal(levelForXp(13_034_430), 98); assert.equal(levelForXp(13_034_431), 99);
  assert.equal(levelForXp(200_000_000), 99); assert.equal(levelForXp(200_000_000, { virtual: true }), 126);
});
t('manual input', () => {
  assert.equal(toXp({ value: 70, unit: 'level' }), 737_627);
  assert.equal(toXp({ value: 1234.9, unit: 'xp' }), 1234);
  assert.throws(() => toXp({ value: 'abc', unit: 'level' }));
});
t('requirements', () => {
  const acc = { xp: { Slayer: xpForLevel(93), Attack: xpForLevel(99), Strength: xpForLevel(99), Defence: xpForLevel(99), Hitpoints: xpForLevel(99), Prayer: xpForLevel(99), Ranged: xpForLevel(99), Magic: xpForLevel(99) },
                quests: { fairy_tale_ii: 'fairy_rings' }, diaries: new Set(['varrock:hard']), owned: {}, kc: { vorkath: 50 } };
  const quests = { fairy_tale_ii: { milestones: [{ id: 'started' }, { id: 'fairy_rings' }, { id: 'complete' }] } };
  assert.equal(combatLevel(acc.xp), 126);
  assert.equal(isMet({ skill: 'Slayer', level: 95, boostable: true }, acc), false);              // methods: no boosts
  assert.equal(isMet({ skill: 'Slayer', level: 95, boostable: true }, acc, { oneOff: true, boost: () => 2 }), true);
  assert.equal(isMet({ skill: 'Slayer', level: 95 }, acc, { oneOff: true, boost: () => 2 }), false);
  assert.equal(isMet({ quest: 'fairy_tale_ii', milestone: 'started' }, acc, { quests }), true);
  assert.equal(isMet({ quest: 'fairy_tale_ii', milestone: 'fairy_rings' }, acc, { quests }), true);
  assert.equal(isMet({ quest: 'fairy_tale_ii' }, acc, { quests }), false);
  assert.equal(isMet({ all: [{ diary: 'varrock', tier: 'hard' }, { any: [{ kc: 'vorkath', n: 100 }, { combatLevel: 120 }] }] }, acc), true);
});

const { applyOverride, supplyCost, bossMethod } = await import('../core/money.js');
const { withQty, withRemoved, withAdded } = await import('../core/overrides.js');
t('supply costs and overrides', () => {
  const items = { a: { price: 100 }, b: { price: 1000 }, tele: { price: 500 }, c: { price: 10 } };
  const setup = { id: 'max', unitsPerHr: 30, unitsPerTrip: 10, supplies: [
    { item: 'a', qty: 2, per: 'unit' }, { item: 'b', qty: 1, per: 'unit' }, { item: 'tele', qty: 1, per: 'trip' }] };
  assert.equal(supplyCost(setup, items).perUnit, 200 + 1000 + 50);
  let o = withQty(null, 'a', 5); o = withRemoved(o, 'b'); o = withAdded(o, { item: 'x', qty: 1, per: 'unit' });
  const s2 = applyOverride(setup, { ...o, unitsPerTrip: 5 });
  const c2 = supplyCost(s2, items);
  assert.equal(c2.perUnit, 500 + 100); assert.deepEqual(c2.missing, ['x']);
  assert.equal(setup.supplies.length, 3);                        // defaults untouched
  assert.equal(supplyCost(applyOverride(setup, withQty(withAdded(null, { item: 'c', qty: 1, per: 'trip' }), 'c', 4)), items).perUnit, 200 + 1000 + 50 + 4); // qty edits reach added lines
  assert.equal(supplyCost({ supplies: [], flatCostPerUnit: 9000 }, items).source, 'flat');
  assert.equal(supplyCost({ supplies: [{ item: 'gp:Death Charge', label: 'Death Charge', gp: 800, qty: 2, per: 'unit' }] }, items).perUnit, 1600);
  assert.equal(supplyCost({ supplies: [{ item: 'tele', qty: 1, per: 'trip' }] }, items).missing[0], 'tele');
});
t('boss method gp/hr', () => {
  const items = { d: { price: 1000 }, s: { price: 100 } };
  const boss = { id: 'b', name: 'B', unit: 'kill', petRate: 1000, drops: [{ item: 'd', qtyMin: 1, qtyMax: 3, expectedPerKill: 0.5, table: 'main' }],
    setups: [{ id: 'default', unitsPerHr: 20, unitsPerTrip: null, supplies: [{ item: 's', qty: 3, per: 'unit' }] }], defaultSetup: 'default' };
  const m = bossMethod(boss, items);
  assert.equal(m.lootPerUnit, 1000); assert.equal(m.costPerUnit, 300); assert.equal(m.gpPerHr, 14000);
  assert.equal(bossMethod(boss, items, { override: { unitsPerHr: 10 } }).gpPerHr, 7000);
  boss.setups[0].lootShare = 0.5;
  assert.equal(bossMethod(boss, items).gpPerHr, (500 - 300) * 20);
});

const original = process.argv[2];
if (original) await (async () => {  // pet adapter rebuilds the original data
  const { loadPetData } = await import('../pets/legacy-data.js');
  const got = await loadPetData();
  const want = JSON.parse(await readFile(original, 'utf8'));
  // The only intended difference: refs to an alias spelling come back as the canonical name
  const alias = { 'Wine of Zamorak': 'Wine of zamorak' };
  const norm = o => JSON.parse(JSON.stringify(o), (k, v) => typeof v === 'string' && alias[v] ? alias[v] : v);
  // Data changed on purpose since the port (field values the pet calculator now gets differently)
  // Rates and supply costs now come from setups built from the Wiki guides, so they differ on purpose
  const RATE_COST = ['defaultKph', 'kphSource', 'defaultCost', 'costSource', 'defaultCostItems'];
  const strip = (list) => list.map(b => { const c = { ...b }; RATE_COST.forEach(f => delete c[f]); return c; });
  const g = norm(strip(got.bosses)), w = norm(strip(want.bosses));
  assert.equal(g.length, w.length, 'boss count');
  for (let i = 0; i < w.length; i++) {
    try { assert.deepEqual(g[i], w[i]); }
    catch { throw new Error(`pet adapter: ${w[i].id} differs from the original data`); }
  }
  assert.deepEqual(norm(got.skillingPets), norm(want.skillingPets));
  // Items: same names, and the same fields except prices the core derives (checked separately)
  // Every original item is still there (supplies and gear have been added since)
  for (const n of Object.keys(want.items)) assert.ok(got.items[n], `missing item ${n}`);
  for (const [n, it] of Object.entries(want.items)) {
    const g = got.items[n];
    const strip = ({ price, ...r }) => r;
    assert.deepEqual(norm(strip(g)), norm(strip(it)), n);
    // prices themselves change weekly, so they aren't compared
  }
  for (const k of ['dropSource', 'dropsRetrieved']) assert.equal(got.meta[k], want.meta[k], k);
  assert.deepEqual(got.meta.tableLabels, want.meta.tableLabels);
  passed++;
})();
console.log(`tests: ${passed} passed`);
