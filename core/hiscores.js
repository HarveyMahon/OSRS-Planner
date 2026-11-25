// Hiscores lookup through Wise Old Man (api.wiseoldman.net), which reads the official OSRS hiscores and,
// unlike them, can be called from a web page. Returns skills as XP and boss kill counts by our boss IDs.

import { SKILLS } from './xp.js';

const API = 'https://api.wiseoldman.net/v2/players/';
// Wise Old Man's boss names where they differ from our boss IDs
const SKILL_ALIAS = { Runecraft: 'runecrafting' };
const BOSS_ALIAS = { graardor: 'general_graardor', the_nightmare: 'nightmare', corrupted_gauntlet: 'the_corrupted_gauntlet', royal_titans: 'the_royal_titans' };

/** Turn a Wise Old Man player record into { xp: {Skill: xp}, kc: {bossId: n}, name, updatedAt }. */
export function parsePlayer(p, bossIds = []) {
  const data = p?.latestSnapshot?.data;
  if (!data?.skills) throw new Error('No hiscores data for this player yet.');
  const xp = {};
  for (const s of SKILLS) {
    const v = data.skills[SKILL_ALIAS[s] || s.toLowerCase()]?.experience;
    if (Number.isFinite(v) && v >= 0) xp[s] = v;          // -1 = unranked: leave it to the user
  }
  const kc = {};
  for (const id of bossIds) {
    const v = data.bosses?.[BOSS_ALIAS[id] || id]?.kills;
    if (Number.isFinite(v) && v > 0) kc[id] = v;
  }
  return { xp, kc, name: p.displayName || p.username, updatedAt: p.latestSnapshot.createdAt || p.updatedAt };
}

/**
 * Look a player up. First asks Wise Old Man to refresh from the hiscores (this also starts tracking a player
 * it hasn't seen); if that's refused (rate limit, hiscores down), falls back to its last saved snapshot.
 */
export async function lookupPlayer(name, bossIds = [], { fetchFn = fetch } = {}) {
  const rsn = String(name || '').trim();
  if (!rsn || rsn.length > 12) throw new Error('Enter a RuneScape name (up to 12 characters).');
  const url = API + encodeURIComponent(rsn);
  let res, refreshed = true;
  try { res = await fetchFn(url, { method: 'POST' }); } catch { res = null; }
  if (!res || !res.ok) {
    refreshed = false;
    res = await fetchFn(url);
    if (res.status === 404) throw new Error(`No player called "${rsn}" on the hiscores.`);
    if (!res.ok) throw new Error(`The hiscores lookup failed (${res.status}). Try again in a minute.`);
  }
  return { ...parsePlayer(await res.json(), bossIds), refreshed };
}
