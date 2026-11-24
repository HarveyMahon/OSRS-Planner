# OSRS Planner

A static web app for planning Old School RuneScape account goals: what to train, what to kill and
how to fund it, priced from the [OSRS Wiki real-time prices API](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices).

| Page | Status |
|---|---|
| **Goal Planner** (`planner/`) | In development. Ordered plans of XP, kill count, GP and quest steps. |
| **Money Makers** (`money/`) | Next. Methods ranked by live GP/hr after supplies, filtered to your account. |
| Pet Hunting (`pets/`) | Side tool, ported from [Pet-Hunt-Profit-Calculator](https://github.com/HarveyMahon/Pet-Hunt-Profit-Calculator). |

## Layout

```
core/      shared code: data loading, XP/levels, requirements, nav, theme
data/      items.json (keyed by item ID), bosses.json, skilling-pets.json (pet tool only)
planner/  money/  pets/     one folder per page
scripts/   update_prices.py (weekly, 2 Wiki requests), check_page.js (headless check)
tests/     node tests/run.mjs
logs/      last price update's full log
```

Everything refers to items by **key**: the OSRS item ID as a string (`"4151"`), or `x-<name>` for
items with no Grand Exchange ID. Pages load data only through `core/data.js`.
`pets/legacy-data.js` rebuilds the old name-keyed shape for the ported pet calculator; new
features should not use it.

## Running locally

No build step. Serve the folder and open it, e.g. `python -m http.server` then http://localhost:8000.

## Prices

`.github/workflows/update-prices.yml` runs every Monday: `scripts/update_prices.py` makes two
requests (`/mapping`, `/latest`), sanity-checks the result, and the new prices are committed only
if `tests/run.mjs` and `scripts/check_page.js` pass.
