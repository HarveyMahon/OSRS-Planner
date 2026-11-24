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

globalThis.localStorage = (() => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
const { freshAccount, normalise, loadAccount, saveAccount } = await import('../core/account.js');
t('account storage', () => {
  const a = freshAccount();
  assert.equal(levelForXp(a.xp.Hitpoints), 10); assert.equal(a.xp.Attack, 0); assert.equal(Object.keys(a.xp).length, 24);
  const n = normalise({ xp: { Attack: 'x', Strength: 3e8, Hitpoints: 5 }, gp: -5, diaries: 'nope' });
  assert.equal(n.xp.Attack, 0); assert.equal(n.xp.Strength, 200_000_000); assert.equal(levelForXp(n.xp.Hitpoints), 10);
  assert.equal(n.gp, 0); assert.deepEqual(n.diaries, []);
  a.xp.Slayer = toXp({ value: 93, unit: 'level' }); a.gp = 1e6;
  assert.ok(saveAccount(a));
  const b = loadAccount(); assert.equal(levelForXp(b.xp.Slayer), 93); assert.equal(b.gp, 1e6); assert.ok(b.updatedAt);
});

const { parseBank, resolveBank } = await import('../core/bank.js');
t('bank import', () => {
  const items = { '1': { name: 'Necklace of anguish' }, '2': { name: 'Amulet of torture' }, '3': { name: 'Fire cape' },
                  '4': { name: 'Dragon dagger' }, '5': { name: 'Amulet of glory' } };
  const tiers = { groups: [{ tiers: [['Infernal cape'], ['Fire cape']] }, { tiers: [['Amulet of rancour'], ['Amulet of torture']] },
                           { tiers: [['Necklace of anguish'], ['Amulet of glory']] }] };
  const rows = parseBank('Item id\tItem name\tItem quantity\n24224\tInfernal cape (l)\t1\n29804\tAmulet of rancour (s)\t1\n5698\tDragon dagger(p++)\t2\n995\tCoins\t1,500\n13204\tPlatinum token\t3\n\nnonsense');
  assert.equal(rows.length, 5);
  const r = resolveBank(rows, items, tiers);
  assert.equal(r.gp, 4500);
  assert.ok(r.bank['3']);              // Infernal cape covers Fire cape
  assert.ok(r.bank['2']);              // rancour covers torture (same slot, same style)...
  assert.ok(!r.bank['1']);             // ...but not anguish (ranged)
  assert.equal(r.bank['4'], 2);        // poisoned dagger counts as the base dagger
});
const { cleanGuideGear } = await import('../core/data.js');
const { gearList } = await import('../core/money.js');
t('guide gear cleanup and gear list', () => {
  const items = { a: { name: 'Shark', price: 1 }, b: { name: 'Fire cape', price: 0 }, 'x-infernal-cape': { name: 'Infernal cape', price: 0 },
                  c: { name: 'Twisted bow', price: 100 }, d: { name: 'Nature rune', price: 1 }, 'x-fire-cape': { name: 'Fire cape', price: 0 } };
  const tiers = { groups: [{ tiers: [['Infernal cape'], ['Fire cape']] }] };
  const g = cleanGuideGear(['a', 'x-infernal-cape', 'c', 'd', 'b'], items, tiers);
  assert.equal(g.length, 2);                                   // food and runes gone, capes merged
  assert.ok(Array.isArray(g[0]) && g[0].includes('x-infernal-cape') && g[0].includes('b'));
  const gl = gearList({ gear: g }, items, { bank: { b: 1 } });
  assert.equal(gl.toBuy, 100); assert.equal(gl.total, 100); assert.ok(gl.lines[0].owned);
  // quantities: 200 bolts, 150 held -> 50 to buy
  const q = gearList({ gear: [{ item: 'd', qty: 200 }] }, items, { bank: { d: 150 } });
  assert.equal(q.total, 200); assert.equal(q.toBuy, 50); assert.ok(!q.lines[0].owned);
});
const { unmet, describe } = await import('../core/requirements.js');
t('unmet and describe', () => {
  const acc = { xp: { Ranged: xpForLevel(85), Prayer: xpForLevel(77) }, quests: { dragon_slayer_ii: 'complete' }, diaries: new Set() };
  const req = { all: [{ skill: 'Ranged', level: 90 }, { skill: 'Prayer', level: 70 }, { quest: 'dragon_slayer_ii' }, { quest: 'regicide' }, { any: [{ skill: 'Magic', level: 80 }, { skill: 'Ranged', level: 80 }] }] };
  const u = unmet(req, acc);
  assert.deepEqual(u.map(r => describe(r, { quests: { regicide: { name: 'Regicide' } } })), ['Ranged 90', 'Regicide']);
  assert.equal(describe({ any: [{ skill: 'Ranged', level: 80 }, { skill: 'Magic', level: 80 }] }), 'Ranged 80 or Magic 80');
});

const { guideMethod } = await import('../core/money.js');
t('guide method gp/hr', () => {
  const items = { a: { price: 10 }, b: { price: 100 } };
  const m = { id: 'x', name: 'X', inputsPerHr: [{ item: 'a', qty: 50 }, { item: 'gp:Spell', gp: 5, qty: 10 }], outputsPerHr: [{ item: 'b', qty: 20 }, { item: 'zz', qty: 1 }] };
  const r = guideMethod(m, items);
  assert.equal(r.gpPerHr, 2000 - 550); assert.deepEqual(r.missing, ['zz']);
  // buy limit: 'a' limited to 100 per 4h = 25/hr, guide uses 50/hr -> half rate
  const lim = { a: { price: 10, limit: 100, name: 'A' }, b: { price: 100 } };
  const r2 = guideMethod(m, lim);
  assert.equal(r2.scale, 0.5); assert.equal(r2.cappedBy, 'buy limit'); assert.equal(r2.gpPerHr, (2000 - 550) / 2);
  // cash: supplies 550/hr, cash 110 -> 0.2
  const r3 = guideMethod(m, items, { cash: 110 });
  assert.equal(r3.cappedBy, 'cash'); assert.ok(Math.abs(r3.scale - 0.2) < 1e-9);
  assert.equal(guideMethod(m, items, { cash: 1e9 }).scale, 1);
});

const { estimate, stageAt, gpPerXp } = await import('../core/training.js');
t('training estimates', () => {
  const items = { bone: { price: 2000 }, ore: { price: 100 }, bar: { price: 250 } };
  const track = { stages: [
    { from: 1, name: 'slow', xpPerHr: 10000 },
    { from: 20, name: 'altar', xpPerHr: 100000, xpEach: 100, inputs: [{ item: 'bone', qty: 1 }] },
    { from: 40, name: 'quest-locked', xpPerHr: 1e6, requires: { quest: 'q' } },
  ] };
  assert.equal(gpPerXp(track.stages[1], items), 20);
  assert.equal(gpPerXp({ xpEach: 50, inputs: [{ item: 'ore', qty: 1 }], outputs: [{ item: 'bar', qty: 1 }] }, items), -3);
  assert.equal(gpPerXp({ xpPerHr: 200000, costPerHr: 1e6 }, items), 5);
  // 1 -> 20 at 10k/hr, then 20 -> 30 at 100k/hr costing 20 gp/xp
  const e = estimate(track, 0, xpForLevel(30), items);
  assert.ok(Math.abs(e.hours - (xpForLevel(20) / 10000 + (xpForLevel(30) - xpForLevel(20)) / 100000)) < 1e-9);
  assert.equal(Math.round(e.gp), (xpForLevel(30) - xpForLevel(20)) * 20);
  assert.equal(e.segments.length, 2);
  // without the quest, level 40+ stays on the altar stage
  const acc = { xp: {}, quests: {}, diaries: new Set() };
  assert.equal(stageAt(track, 50, acc).name, 'altar');
  assert.equal(stageAt(track, 50).name, 'quest-locked');
  // a track that starts above your level is blocked there
  assert.equal(estimate({ stages: [{ from: 10, name: 'x', xpPerHr: 1 }] }, 0, 1000, items).blocked, 1);
  // recurring: real time from growth, play time from minutes per run
  const r = estimate({ stages: [{ from: 1, name: 'trees', xpPerHr: 1e6, xpEach: 1000, recurring: { minutesPerRun: 6, hoursToGrow: 8, perRun: 5 } }] }, 0, 10000, items);
  assert.equal(r.realHours, 2 * 8); assert.equal(r.hours, 2 * 6 / 60);
});

const { questPoints, prerequisiteQuests } = await import('../core/requirements.js');
t('quest points and prerequisites', () => {
  const quests = { a: { questPoints: 1 }, b: { questPoints: 2, requires: { all: [{ quest: 'a' }] } }, c: { questPoints: 5, requires: { all: [{ quest: 'b' }, { skill: 'Agility', level: 5 }] } } };
  const acc = { xp: {}, quests: { a: 'complete', b: 'complete', c: 'started' }, diaries: new Set() };
  assert.equal(questPoints(acc, quests), 3);
  assert.equal(isMet({ questPoints: 3 }, acc, { quests }), true);
  assert.equal(isMet({ questPoints: 4 }, acc, { quests }), false);
  assert.deepEqual([...prerequisiteQuests('c', quests)].sort(), ['a', 'b']);
});

const { plan, stageOptions } = await import('../core/planner.js');
t('planner', () => {
  const items = { bone: { price: 1000 }, loot: { price: 500000 } };
  const tr = (skill, stages, kind = 'balanced') => ({ id: `${skill}_${kind}`, kind, label: kind, intensity: 3, stages });
  const training = { skills: {
    Prayer: [tr('Prayer', [{ from: 1, name: 'Altar', xpPerHr: 100000, xpEach: 100, inputs: [{ item: 'bone', qty: 1 }] }]),
             tr('Prayer', [{ from: 1, name: 'Cheap altar', xpPerHr: 50000, xpEach: 100, inputs: [{ item: 'bone', qty: 0.5 }] }], 'afk')],
    Agility: [tr('Agility', [{ from: 1, name: 'Course', xpPerHr: 20000 }])],
  } };
  const quests = { a: { name: 'A', questPoints: 1, length: 'Short' },
                   b: { name: 'B', questPoints: 2, length: 'Long', requires: { all: [{ quest: 'a' }, { skill: 'Agility', level: 30 }] } },
                   c: { name: 'C', questPoints: 5, requires: { all: [{ questPoints: 8 }] } } };
  const bosses = [
    { id: 'jad', name: 'Jad', unit: 'kill', drops: [], setups: [{ id: 'high', label: 'High', unitsPerHr: 2, supplies: [], requires: { all: [{ skill: 'Prayer', level: 43 }] } }], defaultSetup: 'high', milestone: { reward: 'cape', kc: 1 }, moneyMaker: false },
    { id: 'zuk', name: 'Zuk', unit: 'kill', drops: [], setups: [{ id: 'high', label: 'High', unitsPerHr: 1, supplies: [], requires: { all: [{ item: 'cape' }] } }], defaultSetup: 'high', moneyMaker: false },
    { id: 'farm', name: 'Farm', unit: 'kill', drops: [{ item: 'loot', qtyMin: 1, qtyMax: 1, expectedPerKill: 1, table: 'main' }], setups: [{ id: 'high', label: 'High', unitsPerHr: 10, supplies: [] }], defaultSetup: 'high' },
  ];
  const account = { xp: { Prayer: 0, Agility: 0 }, quests: {}, owned: {}, kc: {}, diaries: [], gp: 0 };
  const d = { items, training, quests, bosses, methods: [], account };
  // quest B: quest A and Agility 30 first
  const qb = plan([{ type: 'quest', id: 'b' }], d);
  assert.deepEqual(qb.steps.map(s => s.kind + ':' + (s.skill || s.id)), ['quest:a', 'train:Agility', 'quest:b']);
  assert.equal(qb.steps[0].hours, 0.5); assert.equal(qb.steps[2].hours, 2);
  // Zuk: needs the cape -> Jad -> Prayer 43 (costs money -> make GP at the money maker first)
  const z = plan([{ type: 'kc', bossId: 'zuk', n: 1 }], d);
  assert.deepEqual(z.steps.map(s => s.kind + ':' + (s.skill || s.bossId || '')), ['gp:', 'train:Prayer', 'kc:jad', 'kc:zuk']);
  const prayerCost = z.steps[1].gp;
  assert.ok(z.steps[0].amount >= prayerCost && z.steps[0].method.name.startsWith('Farm'));
  // swapping Prayer to the cheaper altar halves the bones, so less money to make
  const opt = stageOptions(training, 'Prayer').find(o => o.stage.name === 'Cheap altar');
  const z2 = plan([{ type: 'kc', bossId: 'zuk', n: 1 }], { ...d, swaps: [{ skill: 'Prayer', fromLevel: 1, toLevel: 43, ref: opt.ref }] });
  assert.ok(Math.abs(z2.steps[1].gp - prayerCost / 2) < 1);
  assert.ok(z2.steps[0].amount < z.steps[0].amount);
  assert.ok(z2.steps[1].hours > z.steps[1].hours);
  // quest points: C needs 8 QP, so quests are added to reach it
  const qc = plan([{ type: 'quest', id: 'c' }], d);
  assert.deepEqual(qc.steps.filter(s => s.kind === 'quest').map(s => s.id).sort(), ['a', 'b', 'c']);
  assert.ok(qc.warnings.some(w => w.includes('8 quest points')));   // 1 + 2 + 5 = 8 counts C itself, so 3 before it
  // Hitpoints: trained through the content's main combat skill, 3 combat XP per HP XP
  const hpTraining = { skills: { ...training.skills, Ranged: [tr('Ranged', [{ from: 1, name: 'Crabs', xpPerHr: 30000 }])], Attack: [tr('Attack', [{ from: 1, name: 'Crabs', xpPerHr: 30000 }])] } };
  const hpBoss = { id: 'cave', name: 'Cave', unit: 'kill', drops: [], moneyMaker: false, defaultSetup: 'high',
    setups: [{ id: 'high', label: 'High', unitsPerHr: 1, supplies: [], requires: { all: [{ skill: 'Ranged', level: 10 }, { skill: 'Hitpoints', level: 20 }] } }] };
  const hp = plan([{ type: 'kc', bossId: 'cave', n: 1 }], { ...d, training: hpTraining, bosses: [...bosses, hpBoss], account: { ...account, xp: { ...account.xp, Hitpoints: xpForLevel(10), Ranged: 0, Attack: 0 } } });
  const hpStep = hp.steps.find(s => s.untilHp);
  assert.equal(hpStep.skill, 'Ranged'); assert.equal(hpStep.untilHp, 20);
  assert.ok(!hp.steps.some(s => s.kind === 'train' && s.skill === 'Hitpoints'));
  assert.ok(hp.endAccount.xp.Hitpoints >= xpForLevel(20) - 1);
  // kill-count setup: High level when requirements are met and the cash stack covers its gear
  const twoBoss = { id: 'two', name: 'Two', unit: 'kill', drops: [], moneyMaker: false, defaultSetup: 'high', setups: [
    { id: 'high', label: 'High level', unitsPerHr: 2, supplies: [], gear: ['g1'], requires: { all: [{ skill: 'Ranged', level: 1 }] } },
    { id: 'budget', label: 'Budget', unitsPerHr: 1, supplies: [], gear: [], requires: { all: [] } }] };
  const kcRun = (gp, choice) => plan([{ type: 'kc', bossId: 'two', n: 1 }], { ...d, items: { ...d.items, g1: { name: 'G', price: 1000 } },
    bosses: [...bosses, twoBoss], setupChoices: choice || {}, account: { ...account, gp } }).steps.find(x => x.kind === 'kc');
  assert.equal(kcRun(5000).setupId, 'high'); assert.equal(kcRun(5000).why, 'affordable');
  assert.equal(kcRun(10).setupId, 'budget'); assert.equal(kcRun(10).why, 'gear');
  assert.equal(kcRun(5000, { two: 'budget' }).setupId, 'budget');
  // equal alternatives: owning either covers the slot
  twoBoss.setups[0].gear = [['g1', 'g2']];
  const alt = plan([{ type: 'kc', bossId: 'two', n: 1 }], { ...d, items: { ...d.items, g1: { name: 'G', price: 1000 }, g2: { name: 'H', price: 5 } },
    bosses: [...bosses, twoBoss], account: { ...account, gp: 10, owned: { g2: 1 } } }).steps.find(x => x.kind === 'kc');
  assert.equal(alt.setupId, 'high');
  // Hitpoints split: a skill that would pass 99 stops there and the next combat skill finishes it
  const split = plan([{ type: 'kc', bossId: 'cave', n: 1 }], { ...d, training: { skills: { ...hpTraining.skills, Defence: [tr('Defence', [{ from: 1, name: 'Crabs', xpPerHr: 30000 }])] } },
    bosses: [...bosses, { ...hpBoss, setups: [{ ...hpBoss.setups[0], requires: { all: [{ skill: 'Ranged', level: 98 }, { skill: 'Defence', level: 5 }, { skill: 'Hitpoints', level: 70 }] } }] }],
    account: { ...account, xp: { ...account.xp, Hitpoints: xpForLevel(10), Ranged: xpForLevel(98), Defence: 0, Attack: 0 } } });
  const sp = split.steps.filter(s => s.untilHp || s.towardsHp);
  assert.deepEqual(sp.map(s => [s.skill, s.towardsHp ? 'to99' : 'until']), [['Ranged', 'to99'], ['Defence', 'until']]);
  assert.ok(split.endAccount.xp.Hitpoints >= xpForLevel(70));
  // max cape covers every skill with data
  const mc = plan([{ type: 'maxcape' }], d);
  assert.deepEqual(mc.steps.filter(s => s.kind === 'train').map(s => s.skill).sort(), ['Agility', 'Prayer']);
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
  // Bosses whose data was corrected on purpose since the port
  const CORRECTED = new Set(['zalcano']);   // loot shared across ~15 players (site owner, Wiki)
  const strip = (list) => list.filter(b => !CORRECTED.has(b.id)).map(b => { const c = { ...b }; RATE_COST.forEach(f => delete c[f]); return c; });
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
