// Goal Planner worker: works out plans off the page's main thread, so the page stays responsive and can show a
// progress bar. It loads the data itself, keeps the kill-rate context (and its cache) between plans, and posts
// progress while it works.
import { loadItems, loadBosses, loadQuests, loadMethods, loadTraining, loadFile } from '../core/data.js';
import { plan } from '../core/planner.js';
import { rateContext, GP_TIERS } from '../core/rates.js';

let D = null, RATE_AT = null;
const post = m => self.postMessage(m);

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      const [items, { bosses }, { quests }, { methods }, training, slayerData] = await Promise.all([
        loadItems(), loadBosses(), loadQuests(), loadMethods(), loadTraining(), loadFile('slayer.json').catch(() => null)]);
      D = { items: items.items, bosses, quests, methods, training, slayerData };
      RATE_AT = await rateContext(m.account, items.items);
      // what each boss could give once your combat is trained (the planner's optimistic figure: 99s, every quest,
      // the most cash), worked out once here, a boss at a time, with progress
      const xp = m.account.xp || {};
      const maxed = { ...xp, ...Object.fromEntries(['Attack', 'Strength', 'Defence', 'Ranged', 'Magic', 'Hitpoints', 'Prayer'].map(k => [k, Math.max(xp[k] || 0, 13034431)])) };
      const allQ = Object.fromEntries(Object.keys(quests || {}).map(q => [q, 'complete']));
      for (let i = 0; i < bosses.length; i++) {
        post({ type: 'warm', done: i, total: bosses.length });
        for (const s of bosses[i].setups || []) RATE_AT(bosses[i], s, maxed, GP_TIERS[GP_TIERS.length - 1], { quests: allQ, prayers: m.account.prayers || [] });
      }
      post({ type: 'ready' });
    } else if (m.type === 'plan') {
      const r = plan(m.goals, { items: D.items, training: D.training, quests: D.quests, bosses: D.bosses, methods: D.methods, ...m.opts,
        rateAt: RATE_AT, slayer: D.slayerData && { data: D.slayerData, ...m.slayer },
        onProgress: (done, total) => post({ type: 'progress', id: m.id, done, total }) });
      post({ type: 'result', id: m.id, r });
    }
  } catch (err) {
    post({ type: 'error', id: m.id, message: String(err?.message || err) });
  }
};
