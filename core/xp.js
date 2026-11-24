// Skill XP <-> level. Accounts always store XP; a level typed in by hand becomes the
// minimum XP for that level.

export const SKILLS = [
  'Attack', 'Hitpoints', 'Mining', 'Strength', 'Agility', 'Smithing', 'Defence', 'Herblore',
  'Fishing', 'Ranged', 'Thieving', 'Cooking', 'Prayer', 'Crafting', 'Firemaking', 'Magic',
  'Fletching', 'Woodcutting', 'Runecraft', 'Slayer', 'Farming', 'Construction', 'Hunter', 'Sailing',
];
export const MAX_LEVEL = 99;
export const MAX_XP = 200_000_000;

// XP_TABLE[level] = minimum XP for that level (index 1..126; virtual levels included)
export const XP_TABLE = (() => {
  const t = [0, 0];
  let points = 0;
  for (let lvl = 1; lvl < 126; lvl++) {
    points += Math.floor(lvl + 300 * 2 ** (lvl / 7));
    t.push(Math.floor(points / 4));
  }
  return t;
})();

export const xpForLevel = level => XP_TABLE[Math.max(1, Math.min(126, Math.floor(level)))];

export function levelForXp(xp, { virtual = false } = {}) {
  const cap = virtual ? 126 : MAX_LEVEL;
  let lvl = 1;
  while (lvl < cap && XP_TABLE[lvl + 1] <= xp) lvl++;
  return lvl;
}

// Manual input: { value, unit: 'level' | 'xp' } -> XP
export function toXp({ value, unit }) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) throw new Error(`Not a valid ${unit}: ${value}`);
  return unit === 'level' ? xpForLevel(Math.min(v, MAX_LEVEL)) : Math.min(Math.floor(v), MAX_XP);
}
