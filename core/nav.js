// Site-wide navigation. Each page includes:
//   <script type="module" src="<root>/core/nav.js" data-active="planner"></script>
// The planner and money makers are the main features; the pet calculator is a side tool.

const ROOT = new URL('../', import.meta.url);
const PAGES = [
  { id: 'planner', label: 'Goal Planner', path: 'planner/' },
  { id: 'money', label: 'Money Makers', path: 'money/' },
  { id: 'pets', label: 'Pet Hunting', path: 'pets/', side: true },
];

const active = document.currentScript?.dataset.active
  ?? document.querySelector('script[src$="core/nav.js"]')?.dataset.active;

const nav = document.createElement('nav');
nav.className = 'site-nav';
nav.setAttribute('aria-label', 'Site');
nav.innerHTML = `<div class="site-nav-inner">
  <a class="brand" href="${new URL('./', ROOT)}">OSRS Planner</a>
  <ul>${PAGES.map(p => `<li${p.side ? ' class="side"' : ''}><a class="link" href="${new URL(p.path, ROOT)}"${p.id === active ? ' aria-current="page"' : ''}>${p.label}</a></li>`).join('')}</ul>
</div>`;
document.body.prepend(nav);
