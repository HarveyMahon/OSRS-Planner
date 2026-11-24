# OSRS Planner

A static web app for planning Old School RuneScape account goals: what to train, what to kill and
how to fund it, priced from the [OSRS Wiki real-time prices API](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices).

| Page | Status |
|---|---|
| **Goal Planner** (`planner/`) | Goals (levels, max cape, quests, kill counts, milestones, GP) become ordered steps with training methods (swappable within a skill), quests, kills and money-making steps (`core/planner.js`). |
| **Money Makers** (`money/`) | Bosses and ~485 other Wiki-guide methods ranked by GP/hr after supplies, filtered to your account (recommended levels included, for now); Wilderness and F2P marked. |
| Training (`training/`) | Time and cost to a target level per skill: Fastest, Balanced and AFK tracks (`data/training.json`, estimates). |
| My Account (`account/`) | Your stats (levels or XP) and cash stack, saved in this browser (`core/account.js`). |
| Pet Hunting (`pets/`) | Side tool, ported from [Pet-Hunt-Profit-Calculator](https://github.com/HarveyMahon/Pet-Hunt-Profit-Calculator). |

## Layout

```
core/      shared code: data loading, loot (incl. raids), money/GP per hour, supply overrides,
           XP/levels, requirements, nav, theme
data/      items.json (keyed by item ID), bosses.json, methods.json, quests.json,
           skilling-pets.json (pet tool only)
planner/  money/  pets/     one folder per page
scripts/   update_prices.py (weekly, 2 Wiki requests), check_page.js (headless check),
           import_supplies.py (Wiki money-making guides -> supply review, run by hand),
           apply_supplies.py (applies the review: setups, supplies, new items; offline),
           apply_requirements.py (setup requirements and data/quests.json from the guides; offline),
           apply_methods.py (data/methods.json from all other guides, Wilderness flags; offline,
           after import_supplies.py --all-guides),
           build_training.py (training tracks from the Wiki's training pages -> data/training.json),
           import_quests.py (quest and miniquest requirements from the Wiki -> data/quests.json),
           quest_names.py (resolves quest names to Wiki titles for all the scripts)
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

## Boss setups

Each boss has `setups` (up to two, e.g. budget and max), each with its own rate (`unitsPerHr`),
`requires`, `gear` and `supplies` (`per: "unit"` or `"trip"`, trips spread over `unitsPerTrip`).
`flatCostPerUnit` is the old flat GP figure, used only until a setup has an item list.
User edits are stored in the browser as a diff (`core/overrides.js`), so defaults keep updating.
