// The user's Slayer tab settings, kept in this browser (see core/slayer.js for what they mean).
const KEY = 'osrsplanner:slayer';
export function loadSlayer() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
export function saveSlayer(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; } }
