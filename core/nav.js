// Site-wide navigation. Each page includes:
//   <script type="module" src="<root>/core/nav.js" data-active="planner"></script>
// The planner and money makers are the main features; the pet calculator is a side tool.

const ROOT = new URL('../', import.meta.url);
const PAGES = [
  { id: 'planner', label: 'Goal Planner', path: 'planner/' },
  { id: 'money', label: 'Money Makers', path: 'money/' },
  { id: 'training', label: 'Training', path: 'training/' },
  { id: 'pets', label: 'Pet Hunting', path: 'pets/', side: true },
  { id: 'gear', label: 'Best Setup', path: 'gear/', right: true },
  { id: 'dps', label: 'DPS', path: 'dps/' },
  { id: 'slayer', label: 'Slayer', path: 'slayer/' },
  { id: 'account', label: 'My Account', path: 'account/' },
];

const active = document.currentScript?.dataset.active
  ?? document.querySelector('script[src$="core/nav.js"]')?.dataset.active;

const nav = document.createElement('nav');
nav.className = 'site-nav';
nav.setAttribute('aria-label', 'Site');
nav.innerHTML = `<div class="site-nav-inner">
  <a class="brand" href="${new URL('./', ROOT)}">OSRS Planner</a>
  <ul>${PAGES.map(p => `<li${p.side ? ' class="side"' : p.right ? ' class="right"' : ''}><a class="link" href="${new URL(p.path, ROOT)}"${p.id === active ? ' aria-current="page"' : ''}>${p.label}</a></li>`).join('')}</ul>
</div>`;
document.body.prepend(nav);

// Site-wide footer: data credits
const footer = document.createElement('footer');
footer.className = 'site-footer';
footer.innerHTML = `Data from the <a href="https://oldschool.runescape.wiki/" target="_blank" rel="noopener">Old School RuneScape Wiki</a> and its prices API.
  Slayer rates from <a href="https://docs.google.com/spreadsheets/d/1KR92OY-sK6I8wAAuFLt2TgLq-xadG7yA6Bzgb5YnVQM" target="_blank" rel="noopener">KodakKid3's OSRS Slayer Spreadsheets</a>.
  Hiscores via <a href="https://wiseoldman.net/" target="_blank" rel="noopener">Wise Old Man</a>.`;
document.body.append(footer);
