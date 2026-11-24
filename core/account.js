// The user's account, kept in this browser. Every page reads it through here.
//
// Account = { version, xp: {Skill: xp}, quests: {questId: milestoneId}, diaries: ['region:tier'],
//             owned: {itemKey: qty}, bank: {itemKey: qty}, bankImportedAt, kc: {bossId: n}, gp, updatedAt }
// owned = ticked by hand on My Account; bank = from a pasted Bank Memory export (replaced on each import).
// v1 fills in skills (and GP); quests, diaries, items and kill counts come with requirements data.

import { SKILLS, xpForLevel, MAX_XP } from './xp.js';

const KEY = 'osrsplanner:account';
const VERSION = 1;

export function freshAccount() {
  const xp = Object.fromEntries(SKILLS.map(s => [s, 0]));
  xp.Hitpoints = xpForLevel(10);              // every account starts at 10 Hitpoints
  return { version: VERSION, xp, quests: {}, diaries: [], owned: {}, bank: {}, bankImportedAt: null, kc: {}, gp: 0, updatedAt: null };
}

// Fill gaps and clamp bad values, so pages can trust what they get back
export function normalise(a) {
  const base = freshAccount();
  if (!a || typeof a !== 'object') return base;
  const xp = { ...base.xp };
  for (const s of SKILLS) {
    const v = Number(a.xp?.[s]);
    if (Number.isFinite(v)) xp[s] = Math.max(s === 'Hitpoints' ? xpForLevel(10) : 0, Math.min(MAX_XP, Math.floor(v)));
  }
  return {
    ...base, ...a, version: VERSION, xp,
    gp: Math.max(0, Math.floor(Number(a.gp) || 0)),
    quests: a.quests && typeof a.quests === 'object' ? a.quests : {},
    diaries: Array.isArray(a.diaries) ? a.diaries : [],
    owned: a.owned && typeof a.owned === 'object' ? a.owned : {},
    bank: a.bank && typeof a.bank === 'object' ? a.bank : {},
    kc: a.kc && typeof a.kc === 'object' ? a.kc : {},
  };
}

export function loadAccount() {
  try { return normalise(JSON.parse(localStorage.getItem(KEY))); } catch { return freshAccount(); }
}

// Returns false if the browser wouldn't store it (private mode, storage full)
export function saveAccount(a) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...normalise(a), updatedAt: new Date().toISOString() })); return true; }
  catch { return false; }
}

export function hasAccount() {
  try { return localStorage.getItem(KEY) != null; } catch { return false; }
}

// For core/requirements.js, which expects diaries as a Set
export const forRequirements = a => ({ ...a, diaries: new Set(a.diaries) });
