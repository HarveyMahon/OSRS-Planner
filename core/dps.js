// DPS engine: a player's damage per second against a monster, from the formulas on the OSRS Wiki
// (Damage per second/Melee, /Ranged, /Magic, Maximum magic hit) and the item and monster effects they list.
//
// player = { levels: {Attack, Strength, Defence, Ranged, Magic, Prayer, Hitpoints},
//            prayers: Set of unlocked prayer ids (piety, chivalry, zeal, rigour, deadeye, augury, mystic_vigour),
//            quests: Set of completed quest ids, diaries: Set of 'region:tier', hearts: 'saturated'|'imbued'|null,
//            onTask: bool, thrall: bool (on the Arceuus spellbook with a greater thrall up) }
// loadout = { head, cape, neck, ammo, weapon, body, shield, legs, hands, feet, ring } of items from data/gear
//            (a two-handed weapon has two: true and leaves the shield empty).
// monster = an entry of data/dps-monsters.json (hp, def, magic, dstab..., dlight/dstandard/dheavy, flatArmour,
//            weakness, weaknessPct, attributes, size, amagic).

export const SLOTS = ['head', 'cape', 'neck', 'ammo', 'weapon', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'];
export const TICK = 0.6;
export const THRALL_DPS = 0.625;          // a greater thrall: 0-3 every 4 ticks, always hits, ignores armour

// ---------- prayers ----------
// acc/str multipliers; mdmg in tenths of a percent. Unlock = needs ticking on My Account (scrolls, Knight Waves...).
export const PRAYERS = {
  incredible: { style: 'melee', level: 34, acc: 1.15, str: 1.15, label: 'Incredible Reflexes + Ultimate Strength' },
  chivalry: { style: 'melee', level: 60, acc: 1.15, str: 1.18, unlock: true, needs: { Defence: 65 }, label: 'Chivalry' },
  piety: { style: 'melee', level: 70, acc: 1.20, str: 1.23, unlock: true, needs: { Defence: 70 }, label: 'Piety' },
  zeal: { style: 'melee', level: 84, acc: 1.25, str: 1.28, unlock: true, needs: { Attack: 75, Strength: 75 }, label: 'Zeal (Horn of Bran)' },
  eagle_eye: { style: 'ranged', level: 44, acc: 1.15, str: 1.15, label: 'Eagle Eye' },
  deadeye: { style: 'ranged', level: 62, acc: 1.18, str: 1.18, unlock: true, label: 'Deadeye' },
  rigour: { style: 'ranged', level: 74, acc: 1.20, str: 1.23, unlock: true, needs: { Defence: 70 }, label: 'Rigour' },
  mystic_might: { style: 'magic', level: 45, acc: 1.15, mdmg: 20, label: 'Mystic Might' },
  mystic_vigour: { style: 'magic', level: 63, acc: 1.18, mdmg: 30, unlock: true, label: 'Mystic Vigour' },
  augury: { style: 'magic', level: 77, acc: 1.25, mdmg: 40, unlock: true, needs: { Defence: 70 }, label: 'Augury' },
};
export const UNLOCKABLE_PRAYERS = Object.entries(PRAYERS).filter(([, p]) => p.unlock).map(([id, p]) => ({ id, label: p.label }));

/** The strongest prayer the player can use for a style (by its damage, then accuracy), or null. */
export function bestPrayer(player, style) {
  const lvl = player.levels.Prayer || 1;
  let best = null;
  for (const [id, p] of Object.entries(PRAYERS)) {
    if (p.style !== style || lvl < p.level || (p.unlock && !player.prayers?.has(id))) continue;
    if (p.needs && Object.entries(p.needs).some(([s, l]) => (player.levels[s] ?? 99) < l)) continue;
    if (!best || (p.str || p.mdmg || 0) * 10 + p.acc > (best.str || best.mdmg || 0) * 10 + best.acc) best = { id, ...p };
  }
  return best;
}

// ---------- potions (divine versions are the same) ----------
// In-content potions (opts.boost): overload (+) in the Chambers of Xeric, smelling salts in the Tombs of Amascut
const CONTENT_BOOSTS = { overload: [6, 16], salts: [11, 16] };
export function boosts(player, content = null) {
  const L = player.levels;
  if (CONTENT_BOOSTS[content]) {
    const [flat, pct] = CONTENT_BOOSTS[content], f = l => Math.floor(l * pct / 100) + flat;
    return { Attack: f(L.Attack), Strength: f(L.Strength), Ranged: f(L.Ranged), Magic: f(L.Magic) };
  }
  const melee = l => Math.floor(l * 0.15) + 5;                   // super combat
  const magic = player.hearts === 'saturated' ? Math.floor(L.Magic * 0.1) + 4
    : player.hearts === 'imbued' ? Math.floor(L.Magic * 0.1) + 1 : 0;
  return { Attack: melee(L.Attack), Strength: melee(L.Strength), Ranged: Math.floor(L.Ranged * 0.1) + 4,
    Magic: Math.max(magic, 4) };                                  // magic potion +4 when there's no heart
}

// ---------- names ----------
const canon = n => String(n || '').replace(/\s*\((or|l|cr|deadman|nz|bh|t|g)\)$/i, '').replace(/^Blessed (?=Dizana)/, '');
const has = (lo, slot, re) => !!lo[slot] && (typeof re === 'string' ? canon(lo[slot].name) === re : re.test(lo[slot].name));
const isNamed = (it, names) => !!it && names.includes(canon(it.name));

// ---------- weapon styles ----------
const ST = (name, type, stance) => ({ name, type, stance });
const MELEE = {
  'Slash Sword': [ST('Chop', 'slash', 'accurate'), ST('Slash', 'slash', 'aggressive'), ST('Lunge', 'stab', 'controlled'), ST('Block', 'slash', 'defensive')],
  'Stab Sword': [ST('Stab', 'stab', 'accurate'), ST('Lunge', 'stab', 'aggressive'), ST('Slash', 'slash', 'aggressive'), ST('Block', 'stab', 'defensive')],
  '2h Sword': [ST('Chop', 'slash', 'accurate'), ST('Slash', 'slash', 'aggressive'), ST('Smash', 'crush', 'aggressive'), ST('Block', 'slash', 'defensive')],
  'Axe': [ST('Chop', 'slash', 'accurate'), ST('Hack', 'slash', 'aggressive'), ST('Smash', 'crush', 'aggressive'), ST('Block', 'slash', 'defensive')],
  'Blunt': [ST('Pound', 'crush', 'accurate'), ST('Pummel', 'crush', 'aggressive'), ST('Block', 'crush', 'defensive')],
  'Bludgeon': [ST('Pound', 'crush', 'aggressive'), ST('Pummel', 'crush', 'aggressive'), ST('Smash', 'crush', 'aggressive')],
  'Claw': [ST('Chop', 'slash', 'accurate'), ST('Slash', 'slash', 'aggressive'), ST('Lunge', 'stab', 'controlled'), ST('Block', 'slash', 'defensive')],
  'Polearm': [ST('Jab', 'stab', 'controlled'), ST('Swipe', 'slash', 'aggressive'), ST('Fend', 'stab', 'defensive')],
  'Scythe': [ST('Reap', 'slash', 'accurate'), ST('Chop', 'slash', 'aggressive'), ST('Jab', 'crush', 'aggressive'), ST('Block', 'slash', 'defensive')],
  'Spear': [ST('Lunge', 'stab', 'controlled'), ST('Swipe', 'slash', 'controlled'), ST('Pound', 'crush', 'controlled'), ST('Block', 'stab', 'defensive')],
  'Spiked': [ST('Pound', 'crush', 'accurate'), ST('Pummel', 'crush', 'aggressive'), ST('Spike', 'stab', 'controlled'), ST('Block', 'crush', 'defensive')],
  'Whip': [ST('Flick', 'slash', 'accurate'), ST('Lash', 'slash', 'controlled'), ST('Deflect', 'slash', 'defensive')],
  'Partisan': [ST('Stab', 'stab', 'accurate'), ST('Lunge', 'stab', 'aggressive'), ST('Pound', 'crush', 'aggressive'), ST('Block', 'stab', 'defensive')],
  'Pickaxe': [ST('Spike', 'stab', 'accurate'), ST('Impale', 'stab', 'aggressive'), ST('Smash', 'crush', 'aggressive'), ST('Block', 'stab', 'defensive')],
  'Unarmed': [ST('Punch', 'crush', 'accurate'), ST('Kick', 'crush', 'aggressive'), ST('Block', 'crush', 'defensive')],
  'Bladed Staff': [ST('Jab', 'stab', 'accurate'), ST('Swipe', 'slash', 'aggressive'), ST('Fend', 'crush', 'defensive')],
  'Staff': [ST('Bash', 'crush', 'accurate'), ST('Pound', 'crush', 'aggressive'), ST('Focus', 'crush', 'defensive')],
  'Polestaff': [ST('Bash', 'crush', 'accurate'), ST('Pound', 'crush', 'aggressive'), ST('Block', 'crush', 'defensive')],
  'Flail': [ST('Pound', 'crush', 'accurate'), ST('Pummel', 'crush', 'aggressive'), ST('Block', 'crush', 'defensive')],
  'Banner': [ST('Lunge', 'stab', 'accurate'), ST('Swipe', 'slash', 'aggressive'), ST('Pound', 'crush', 'controlled'), ST('Block', 'stab', 'defensive')],
};
const RANGED_CATS = ['Bow', 'Crossbow', 'Thrown', 'Chinchompas'];
const AUTOCAST_CATS = ['Staff', 'Bladed Staff', 'Polestaff'];

export function attackStyles(weapon) {
  const cat = weapon?.category || 'Unarmed';
  if (RANGED_CATS.includes(cat)) return [ST('Accurate', 'ranged', 'accurate'), ST('Rapid', 'ranged', 'rapid')];
  if (cat === 'Powered Staff' || cat === 'Powered Wand') return [ST('Accurate', 'magic', 'accurate')];
  const melee = MELEE[cat] || [ST('Accurate', 'stab', 'accurate'), ST('Aggressive', 'slash', 'aggressive'), ST('Aggressive', 'crush', 'aggressive')];
  const styles = melee.filter(s => s.stance !== 'defensive');
  if (AUTOCAST_CATS.includes(cat)) styles.push(ST('Autocast', 'magic', 'autocast'));
  return styles;
}
export const styleKind = type => type === 'ranged' ? 'ranged' : type === 'magic' ? 'magic' : 'melee';

// ---------- spells ----------
// [name, level, base max, element, book]
const SPELLS = [
  ['Wind Strike', 1, 2, 'air', 'standard'], ['Fire Strike', 13, 8, 'fire', 'standard'],
  ['Wind Bolt', 17, 12, 'air', 'standard'], ['Water Bolt', 23, 12, 'water', 'standard'], ['Earth Bolt', 29, 12, 'earth', 'standard'], ['Fire Bolt', 35, 12, 'fire', 'standard'],
  ['Wind Blast', 41, 16, 'air', 'standard'], ['Water Blast', 47, 16, 'water', 'standard'], ['Earth Blast', 53, 16, 'earth', 'standard'], ['Fire Blast', 59, 16, 'fire', 'standard'],
  ['Wind Wave', 62, 20, 'air', 'standard'], ['Water Wave', 65, 20, 'water', 'standard'], ['Earth Wave', 70, 20, 'earth', 'standard'], ['Fire Wave', 75, 20, 'fire', 'standard'],
  ['Wind Surge', 81, 24, 'air', 'standard'], ['Water Surge', 85, 24, 'water', 'standard'], ['Earth Surge', 90, 24, 'earth', 'standard'], ['Fire Surge', 95, 24, 'fire', 'standard'],
  ['Ice Rush', 58, 16, null, 'ancient'], ['Ice Burst', 70, 22, null, 'ancient'], ['Blood Blitz', 80, 25, null, 'ancient'], ['Ice Blitz', 82, 26, null, 'ancient'],
  ['Blood Barrage', 92, 29, null, 'ancient'], ['Ice Barrage', 94, 30, null, 'ancient'],
  ['Ghostly Grasp', 35, 12, null, 'arceuus'], ['Skeletal Grasp', 56, 17, null, 'arceuus'], ['Undead Grasp', 79, 24, null, 'arceuus'],
  ['Inferior Demonbane', 44, 16, null, 'arceuus', true], ['Superior Demonbane', 62, 23, null, 'arceuus', true], ['Dark Demonbane', 82, 30, null, 'arceuus', true],
].map(([name, level, base, element, book, demonbane]) => ({ name, level, base, element, book, demonbane: !!demonbane }));

// Staves that can autocast Ancient Magicks (besides any "ancient" staff or sceptre)
const ANCIENT_STAVES = ['Kodai wand', 'Master wand', 'Nightmare staff', 'Harmonised nightmare staff', 'Volatile nightmare staff',
  'Eldritch nightmare staff', "Ahrim's staff", "Zuriel's staff", 'Staff of the dead', 'Toxic staff of the dead', 'Staff of light',
  'Staff of balance', 'Thammaron\'s sceptre', 'Accursed sceptre', 'Blue moon spear', 'Virtus wand'];
function canCastAncients(w) { return /ancient/i.test(w.name) || ANCIENT_STAVES.some(n => canon(w.name).toLowerCase() === n.toLowerCase()); }

/** The spells this weapon and player can autocast. */
export function spellsFor(player, weapon) {
  if (!weapon || !AUTOCAST_CATS.includes(weapon.category)) return [];
  const books = player.thrall ? ['arceuus'] : ['standard', 'arceuus'];
  if (!player.thrall && player.quests?.has('desert_treasure_i') && canCastAncients(weapon)) books.push('ancient');
  return SPELLS.filter(s => books.includes(s.book) && player.levels.Magic >= s.level);
}

// ---------- powered staves (base max from the boosted Magic level) ----------
const POWERED = {
  'Trident of the seas': m => Math.floor(m / 3) - 5, 'Trident of the seas (e)': m => Math.floor(m / 3) - 5,
  'Trident of the swamp': m => Math.floor(m / 3) - 2, 'Trident of the swamp (e)': m => Math.floor(m / 3) - 2,
  'Sanguinesti staff': m => Math.floor(m / 3), 'Holy sanguinesti staff': m => Math.floor(m / 3),
  "Tumeken's shadow": m => Math.floor(m / 3) + 1, 'Eye of Ayak': m => Math.floor(m / 3) - 6,
  'Warped sceptre': m => Math.floor((8 * m + 96) / 37), 'Accursed sceptre': m => Math.floor(m / 3) - 6,
  "Thammaron's sceptre": m => Math.floor(m / 3) - 8, "Zorya's tome": m => Math.floor(m / 3) - 10,
  'Starter staff': () => 8, 'Dawnbringer': m => Math.floor(m / 3) - 2,
};
const POWERED_LC = Object.fromEntries(Object.entries(POWERED).map(([k, f]) => [k.toLowerCase(), f]));
const poweredBase = (w, m) => { const f = POWERED_LC[canon(w.name).replace(/ \((o|full)\)/g, '').toLowerCase()]; return f ? Math.max(1, f(m)) : 0; };

// ---------- ammo ----------
const DRAGON_ARROW_BOWS = ['Twisted bow', 'Dark bow', '3rd Age bow', 'Scorching bow'];
const NO_AMMO_BOWS = /^(Crystal bow|New crystal bow|Bow of faerdhinen|Craw's bow|Webweaver bow|Venator bow|Nature's recurve|Starter bow|Cursed goblin bow)/i;
const DRAGON_BOLT_XBOWS = ['Armadyl crossbow', 'Zaryte crossbow', 'Dragon crossbow', 'Dragon hunter crossbow'];
const AMMO_TIER = [['Dragon', 6], ['Amethyst', 5], ['Rune', 4], ['Adamant', 3], ['Mithril', 2], ['Steel', 1], ['Iron', 0], ['Bronze', 0]];
const arrowTier = n => (AMMO_TIER.find(([t]) => n.startsWith(t)) || [null, 0])[1];
// Weapons that fire only their own ammo, and that ammo fires from nothing else
const OWN_AMMO = [
  [/^Karil's crossbow/, /^Bolt rack/], [/^Dorgeshuun crossbow/, /^Bone bolts/], [/^Hunters' /, /antler bolts/i],
  [/^Ascension crossbows/, /ascension bolts/i], [/ballista/i, /javelin/i], [/^(Comp )?ogre bow/i, /^(Ogre arrow|.* brutal)/i],
  [/^Eclipse atlatl/, /atlatl dart/i],
];

/** Does this ammo fire from this weapon? (Bonuses of ammo that doesn't are ignored.) */
export function ammoFits(weapon, ammo) {
  if (!weapon || !ammo) return false;
  const w = canon(weapon.name), a = ammo.name;
  for (const [wr, ar] of OWN_AMMO) {
    const own = wr.test(w), mine = ar.test(a);
    if (own || mine) return own && mine;
  }
  if (weapon.category === 'Bow') {
    if (NO_AMMO_BOWS.test(w) || !/arrow/i.test(a)) return false;
    const max = DRAGON_ARROW_BOWS.includes(w) ? 6 : /^Magic|^Seercull/.test(w) ? 5 : /^Yew/.test(w) ? 4 : /^Maple/.test(w) ? 2 : /^Willow/.test(w) ? 1 : /^(Oak|Shortbow|Longbow)/.test(w) ? 0 : 4;
    return arrowTier(a) <= max;
  }
  if (weapon.category === 'Crossbow') {
    if (!/bolts/i.test(a) || /^Kebbit|^Mith grapple/.test(a)) return false;
    if (/dragon/i.test(a)) return DRAGON_BOLT_XBOWS.includes(w);
    return true;
  }
  return false;
}
const firesAmmo = w => w && ((w.category === 'Bow' && !NO_AMMO_BOWS.test(canon(w.name))) || w.category === 'Crossbow' || /^Eclipse atlatl/.test(w.name));
const isBlowpipe = w => w && /blowpipe$/i.test(w.name);
const BLOWPIPE_DART = { name: 'Dragon dart', rstr: 35 };

// ---------- set and item checks ----------
function voidSet(lo) {
  const top = has(lo, 'body', /^(Elite )?void (knight )?top/i), robe = has(lo, 'legs', /^(Elite )?void (knight )?robe/i);
  if (!top || !robe || !has(lo, 'hands', /^Void knight gloves/i)) return null;
  const elite = has(lo, 'body', /^Elite void top/i) && has(lo, 'legs', /^Elite void robe/i);
  const helm = has(lo, 'head', /^Void melee helm/i) ? 'melee' : has(lo, 'head', /^Void ranger helm/i) ? 'ranged' : has(lo, 'head', /^Void mage helm/i) ? 'magic' : null;
  return helm && { style: helm, elite };
}
const crystalPieces = lo => (has(lo, 'head', /^Crystal helm/) ? 1 : 0) + (has(lo, 'legs', /^Crystal legs/) ? 2 : 0) + (has(lo, 'body', /^Crystal body/) ? 3 : 0);
const isCrystalBow = w => w && /^(Crystal bow|Bow of faerdhinen)/.test(w.name);
const obsidianArmour = lo => has(lo, 'head', 'Obsidian helmet') && has(lo, 'body', 'Obsidian platebody') && has(lo, 'legs', 'Obsidian platelegs');
const isTzhaar = w => w && /^(Toktz-xil-ak|Toktz-xil-ek|Tzhaar-ket-em|Tzhaar-ket-om|Toktz-mej-tal)/.test(w.name);
const slayerHelm = lo => has(lo, 'head', /(slayer helmet|black mask)/i);
const slayerHelmImbued = lo => has(lo, 'head', /(slayer helmet|black mask).*\(i\)/i);
const salve = lo => { const n = lo.neck?.name || ''; return /^Salve amulet/.test(n) ? { e: /\(e\)|\(ei\)/.test(n), i: /\(i\)|\(ei\)/.test(n) } : null; };
const isScythe = w => w && /Scythe of vitur/i.test(w.name);
const isFang = w => w && /^Osmumten's fang/.test(w.name);
const isKeris = w => w && /^Keris( partisan)?/.test(w.name);
const DEMON_VULN = { 'Duke Sucellus': 0.7, Yama: 1.2, 'Ice demon': 1.15 };
const demonbane = (m, pct) => m.attributes.includes('demon') ? pct * (DEMON_VULN[m.name] ?? 1) : 0;

// ---------- equipment totals ----------
export function totals(lo, monster, opts = {}) {
  const t = { astab: 0, aslash: 0, acrush: 0, amagic: 0, arange: 0, str: 0, rstr: 0, mdmg: 0, prayer: 0 };
  const w = lo.weapon;
  for (const s of SLOTS) {
    const it = lo[s];
    if (!it) continue;
    const ranged = s !== 'ammo' || ammoFits(w, it);
    for (const k of Object.keys(t)) {
      if (!ranged && (k === 'rstr' || k === 'arange')) continue;
      t[k] += it.b?.[k] || 0;
    }
  }
  if (isBlowpipe(w)) t.rstr += BLOWPIPE_DART.rstr;
  if (lo.cape && /^(Dizana's (max cape|quiver)|Blessed Dizana's quiver)/.test(lo.cape.name) && firesAmmo(w) && ammoFits(w, lo.ammo)) { t.arange += 10; t.rstr += 1; }
  const v = voidSet(lo);
  if (v?.style === 'magic' && v.elite) t.mdmg += 5;
  if (w && canon(w.name) === "Tumeken's shadow") { const f = opts.toa ? 4 : 3; t.amagic *= f; t.mdmg = Math.min(100, t.mdmg * f); }
  return t;
}

// ---------- hit chance ----------
function hitChance(atk, def) { return atk > def ? 1 - (def + 2) / (2 * (atk + 1)) : atk / (2 * (def + 1)); }
function fangChance(atk, def) {       // the attacker rolls twice and keeps the higher roll
  return atk > def ? 1 - (def + 2) * (2 * def + 3) / (6 * (atk + 1) ** 2) : atk * (4 * atk + 5) / (6 * (atk + 1) * (def + 1));
}
function npcDefRoll(m, type, weapon) {
  if (type === 'magic') return (m.magic + 9) * (m.dmagic + 64);
  let bonus;
  if (type === 'ranged') {
    const kind = weapon?.category === 'Thrown' ? 'dlight' : weapon?.category === 'Bow' ? 'dstandard' : 'dheavy';
    bonus = (m.dlight || m.dstandard || m.dheavy) ? m[kind] : (m.drange || 0);
  } else bonus = m['d' + type] || 0;
  return (m.def + 9) * (bonus + 64);
}

// Expected damage of one accurate hit rolled uniformly in [min, max], 0s raised to 1, less the NPC's flat armour.
function accurateMean(min, max, flat = 0) {
  if (max <= 0) return 0;
  if (!flat) { const n = max - min + 1; return ((min + max) * n / 2 + (min === 0 ? 1 : 0)) / n; }
  let s = 0;
  for (let d = min; d <= max; d++) { let x = Math.max(1, d); if (flat) x = Math.max(1, x - flat); s += x; }
  return s / (max - min + 1);
}

function tbow(current, magic, acc) {
  const factor = acc ? 10 : 14, base = acc ? 140 : 250;
  const t2 = Math.trunc((3 * magic - factor) / 100);
  const t3 = Math.trunc((Math.trunc(3 * magic / 10) - 10 * factor) ** 2 / 100);
  return Math.trunc(current * Math.max(0, Math.min(base, base + t2 - t3)) / 100);
}

// ---------- the calculation ----------
/**
 * DPS of a loadout with one attack style (and spell, when autocasting) against a monster.
 * Returns { dps, maxHit, accuracy, speed, style, spell, prayer } (dps without the thrall).
 */
export function calc(player, lo, monster, style, spell = null, opts = {}) {
  const L = player.levels, B = boosts(player, opts.boost), m = monster;
  const w = lo.weapon;
  const kind = styleKind(style.type);
  const t = totals(lo, m, opts);
  const pray = bestPrayer(player, kind) || { acc: 1, str: 1, mdmg: 0 };
  const v = voidSet(lo);
  const undead = m.attributes.includes('undead'), dragon = m.attributes.includes('dragon'), kalphite = m.attributes.includes('kalphite');
  const sal = salve(lo), onTask = !!player.onTask;
  let atk, max, min = 0, speed = (w?.speed || 4), hits = 1, notes = [];

  if (kind === 'melee') {
    let effA = Math.floor((L.Attack + B.Attack) * pray.acc) + 8 + (style.stance === 'accurate' ? 3 : style.stance === 'controlled' ? 1 : 0);
    let effS = Math.floor((L.Strength + B.Strength) * pray.str) + 8 + (style.stance === 'aggressive' ? 3 : style.stance === 'controlled' ? 1 : 0);
    // Soulreaper axe: +6% of boosted Strength per stack; counted at its full 5 stacks (it holds them through a kill)
    if (canon(w?.name) === 'Soulreaper axe') effS += Math.floor((L.Strength + B.Strength) * 30 / 100);
    if (v?.style === 'melee') { effA = Math.floor(effA * 1.1); effS = Math.floor(effS * 1.1); }
    const base = effA * (t['a' + style.type] + 64);
    atk = base;
    const baseMax = Math.floor((effS * (t.str + 64) + 320) / 640);
    max = baseMax;
    if (sal && undead) { atk = Math.floor(atk * (sal.e ? 6 / 5 : 7 / 6)); max = Math.floor(max * (sal.e ? 6 / 5 : 7 / 6)); }
    else if (slayerHelm(lo) && onTask) { atk = Math.floor(atk * 7 / 6); max = Math.floor(max * 7 / 6); }
    if (isTzhaar(w) && obsidianArmour(lo)) { atk += Math.floor(base / 10); max += Math.floor(baseMax / 10); }
    if (isTzhaar(w) && /^Berserker necklace/.test(lo.neck?.name || '')) max = Math.floor(max * 6 / 5);
    const db = /^(Arclight|Emberlight)/.test(w?.name || '') ? 0.7 : /^(Silverlight|Darklight)/.test(w?.name || '') ? 0.6 : 0;
    if (db) { const f = demonbane(m, db); atk += Math.floor(atk * f); max += Math.floor(max * f); }
    if (dragon && canon(w?.name) === 'Dragon hunter lance') { atk = Math.floor(atk * 6 / 5); max = Math.floor(max * 6 / 5); }
    if (kalphite && isKeris(w)) {
      if (/breaching/.test(w.name)) atk = Math.floor(atk * 1.33);
      max = Math.floor(max * (/amascut/.test(w.name) ? 1.15 : 1.33));
    }
    if (style.type === 'crush') {
      const inq = (has(lo, 'head', /^Inquisitor's great helm/) ? 1 : 0) + (has(lo, 'body', /^Inquisitor's hauberk/) ? 2 : 0) + (has(lo, 'legs', /^Inquisitor's plateskirt/) ? 2 : 0);
      if (inq) { atk = Math.floor(atk * (200 + inq) / 200); max = Math.floor(max * (200 + inq) / 200); }
    }
    if (isFang(w)) { const shrink = Math.trunc(max * 3 / 20); min = shrink; max -= shrink; }
    if (isScythe(w)) hits = m.size >= 3 ? 3 : m.size === 2 ? 2 : 1;
  } else if (kind === 'ranged') {
    if (style.stance === 'rapid') speed -= 1;
    const lvl = L.Ranged + B.Ranged, accBonus = style.stance === 'accurate' ? 3 : 0;
    let effA = Math.floor(lvl * pray.acc) + accBonus + 8;
    let effS = Math.floor(lvl * pray.str) + accBonus + 8;
    if (v?.style === 'ranged') { effA = Math.floor(effA * 1.1); effS = Math.floor(effS * (v.elite ? 1.125 : 1.1)); }
    atk = effA * (t.arange + 64);
    max = Math.floor((effS * (t.rstr + 64) + 320) / 640);
    if (firesAmmo(w) && !ammoFits(w, lo.ammo)) return { dps: 0, maxHit: 0, accuracy: 0, speed, style, spell, notes: ['No ammo for this weapon'] };
    if (isCrystalBow(w)) { const n = crystalPieces(lo); atk = Math.trunc(atk * (20 + n) / 20); max = Math.trunc(max * (40 + n) / 40); }
    let dhcb = dragon && canon(w?.name) === 'Dragon hunter crossbow', scorch = canon(w?.name) === 'Scorching bow' && m.attributes.includes('demon');
    if (sal && undead && sal.i) { atk = Math.floor(atk * (sal.e ? 6 / 5 : 7 / 6)); max = Math.floor(max * (sal.e ? 6 / 5 : 7 / 6)); }
    else if (slayerHelmImbued(lo) && onTask) {
      atk = Math.floor(atk * 23 / 20);
      let num = 23; if (dhcb) { num += 5; dhcb = false; }
      max = Math.floor(max * num / 20);
    }
    if (canon(w?.name) === 'Twisted bow') {
      const mag = Math.min(m.attributes.includes('xerician') ? 350 : 250, Math.max(m.magic, m.amagic || 0));
      atk = tbow(atk, mag, true); max = tbow(max, mag, false);
    }
    if (dragon && canon(w?.name) === 'Dragon hunter crossbow') { atk = Math.floor(atk * 13 / 10); if (dhcb) max = Math.floor(max * 5 / 4); }
    if (scorch) { const f = demonbane(m, 0.3); atk += Math.floor(atk * f); max += Math.floor(max * f); }
    if (canon(w?.name) === 'Tonalztics of Ralos') max -= Math.trunc(max / 4);
  } else {
    const lvl = L.Magic + B.Magic;
    let eff = Math.floor(lvl * pray.acc) + (style.stance === 'accurate' ? 2 : 0) + 9;
    if (v?.style === 'magic') eff = Math.floor(eff * 29 / 20);
    const baseRoll = eff * (t.amagic + 64);
    atk = baseRoll;
    let base;
    if (spell) { base = spell.base; speed = canon(w?.name) === 'Harmonised nightmare staff' && spell.book === 'standard' ? 4 : 5; }
    else { base = poweredBase(w, lvl); if (!base) return { dps: 0, maxHit: 0, accuracy: 0, speed, style, spell, notes: ['Not a magic weapon'] }; }
    let mdmg = t.mdmg * 10 + (pray.mdmg || 0);
    if (spell?.book === 'standard' && /^(Smoke battlestaff|Mystic smoke staff|Twinflame staff)/.test(w?.name || '')) mdmg += 100;
    let mask = false, add = 0;
    if (sal?.i && undead) { mdmg += sal.e ? 200 : 150; add = sal.e ? 20 : 15; }
    else if (slayerHelmImbued(lo) && onTask) mask = true;
    if (add) atk = Math.floor(atk * (100 + add) / 100);
    max = base + Math.floor(base * mdmg / 1000);
    if (mask) { max = Math.floor(max * 23 / 20); atk = Math.floor(atk * 23 / 20); }
    if (dragon) {
      const dh = canon(w?.name);
      if (dh === 'Dragon hunter lance') { atk = Math.floor(atk * 6 / 5); max = Math.floor(max * 6 / 5); }
      else if (dh === 'Dragon hunter wand') { atk = Math.floor(atk * 7 / 4); max = Math.floor(max * 7 / 5); }
      else if (dh === 'Dragon hunter crossbow') { atk = Math.floor(atk * 13 / 10); max = Math.floor(max * 5 / 4); }
    }
    if (spell?.demonbane) {
      if (!m.attributes.includes('demon')) return { dps: 0, maxHit: 0, accuracy: 0, speed, style, spell, notes: ['Demonbane spells only hit demons'] };
      const purging = canon(w?.name) === 'Purging staff';
      atk += Math.floor(atk * demonbane(m, purging ? 0.8 : 0.4));      // with Mark of Darkness
    }
    if (spell?.element && spell.element === m.weakness) { atk += Math.floor(baseRoll * m.weaknessPct / 100); max += Math.floor(base * m.weaknessPct / 100); }
    if (spell?.element && /^Tome of (fire|water|earth)/i.test(lo.shield?.name || '') && lo.shield.name.toLowerCase().includes(spell.element)) max = Math.floor(max * 11 / 10);
    if (spell?.demonbane) { const purging = canon(w?.name) === 'Purging staff'; max += Math.floor(Math.floor(max * (purging ? 0.5 : 0.25)) * (DEMON_VULN[m.name] ?? 1)); }
  }

  // ---- special attack modifiers (core/specs.js) ----
  const spec = opts.spec;
  if (spec) {
    if (spec.fang) { max += min; }                          // the fang's spec keeps its full max hit (min stays)
    if (spec.acc) atk = Math.floor(atk * spec.acc);
    for (const f of spec.dmg || []) max = Math.floor(max * f);
    if (spec.voidwaker) { min = Math.floor(max / 2); max += min; }
    hits = 1;
  }
  // ---- expected damage per attack ----
  const def = npcDefRoll(m, kind === 'melee' ? style.type : kind, w);
  let p = spec?.voidwaker ? 1 : isFang(w) && style.type === 'stab' ? fangChance(atk, def) : hitChance(atk, def);
  // Confliction gauntlets: after a missed magic attack with a one-handed weapon, the next rolls accuracy twice
  if (kind === 'magic' && /^Confliction gauntlets/.test(lo.hands?.name || '') && !w?.two) { const d = fangChance(atk, def); p = d / (1 + d - p); }
  const flat = m.flatArmour || 0;
  let per = 0;
  if (hits > 1) {
    const maxes = [max, Math.floor(max / 2), Math.floor(max / 4)].slice(0, hits);
    per = maxes.reduce((s, mx) => s + p * accurateMean(0, mx, flat), 0);
  } else {
    const acc = accurateMean(min, max, flat);
    per = p * acc;
    // enchanted bolts (Kandarin hard diary raises the chance by 10%)
    if (kind === 'ranged' && w?.category === 'Crossbow' && lo.ammo && !spec) {
      const k = (player.diaries?.has('kandarin:hard') ? 1.1 : 1) * (canon(w.name) === 'Ascension crossbows' ? 0.5 : 1), zcb = canon(w.name) === 'Zaryte crossbow', a = lo.ammo.name, r = L.Ranged + B.Ranged;
      if (/^Opal (dragon )?bolts \(e\)/.test(a)) per += 0.05 * k * Math.trunc(r / (zcb ? 9 : 10));
      else if (/^Pearl (dragon )?bolts \(e\)/.test(a)) { const dv = m.attributes.includes('fiery') ? 15 : 20; per += 0.06 * k * Math.trunc(r / (zcb ? dv - 2 : dv)); }
      else if (/^Dragonstone (dragon )?bolts \(e\)/.test(a) && !m.attributes.some(x => x === 'fiery' || x === 'dragon')) per += p * 0.06 * k * Math.trunc(r * 2 / (zcb ? 9 : 10));
      else if (/^Diamond (dragon |ascension )?bolts \(e\)/.test(a)) { const c = 0.1 * k, emax = Math.trunc(max * (zcb ? 126 : 115) / 100); per = (1 - c) * per + c * accurateMean(0, emax, flat); }
      else if (/^Onyx (dragon |ascension )?bolts \(e\)/.test(a) && !undead) { const c = 0.11 * k, emax = Math.trunc(max * (zcb ? 132 : 120) / 100); per = p * ((1 - c) * acc + c * accurateMean(0, emax, flat)); }
      else if (/^Ruby (dragon )?bolts \(e\)/.test(a)) {     // 20% of the monster's current HP: averaged over the kill
        const c = 0.06 * k, eff = Math.min(zcb ? 110 : 100, Math.trunc(m.hp / 2 * (zcb ? 22 : 20) / 100));
        per = (1 - c) * per + c * eff;
      }
    }
    if (kalphite && isKeris(w)) per *= 1 + 2 / 51;   // 1 in 51 hits deal triple damage
  }
  if (m.name === 'Corporeal Beast' && !(style.type === 'stab' && ['Spear', 'Polearm'].includes(w?.category)) && !(kind === 'magic')) per /= 2;
  const dps = per / (speed * TICK);
  return { dps, maxHit: max, minHit: min, hits, accuracy: p, speed, style, spell, prayer: pray.id || null, notes, perAttack: per, acc: accurateMean(min, max, flat) };
}

/** The best attack style (and spell) for a loadout against a monster: the calc result with the highest DPS. */
export function bestCalc(player, lo, monster, opts = {}) {
  const w = lo.weapon;
  let best = null;
  for (const st of attackStyles(w)) {
    if (opts.styles && !opts.styles.includes(styleKind(st.type))) continue;
    const spells = st.stance === 'autocast' ? spellsFor(player, w) : [null];
    for (const sp of spells) {
      const r = calc(player, lo, monster, st, sp, opts);
      if (!best || r.dps > best.dps) best = r;
    }
  }
  if (!best) return { dps: 0, maxHit: 0, accuracy: 0, speed: w?.speed || 4, style: null, spell: null, notes: ['No usable style'] };
  return { ...best, thrall: player.thrall ? THRALL_DPS : 0, total: best.dps + (player.thrall ? THRALL_DPS : 0) };
}

/** Seconds to kill a monster (HP / DPS, thrall included). */
export function killSeconds(r, monster) { const d = (r.total ?? r.dps); return d > 0 ? monster.hp / d : Infinity; }

/** A player from an account (see core/account.js) with the DPS options set on My Account. */
export function playerFromAccount(acc, levelOf, opts = {}) {
  const levels = {};
  for (const s of ['Attack', 'Strength', 'Defence', 'Ranged', 'Magic', 'Prayer', 'Hitpoints']) levels[s] = levelOf(acc, s);
  const quests = new Set(Object.keys(acc.quests || {}));
  const prayers = new Set(acc.prayers || []);
  const thrallOk = quests.has('a_kingdom_divided') && levels.Magic >= 76;
  return { levels, quests, prayers, diaries: new Set(acc.diaries || []), hearts: opts.hearts ?? null,
    onTask: !!opts.onTask, thrall: opts.thrall ?? false, thrallOk };
}
