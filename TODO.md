# Backlog

Ideas parked for later. Nothing here is being worked on right now.

## Planner
- **Slayer v1.5**: Turael skipping and Konar point boosting; the Slayer cape's effect; superiors; "train Slayer with Ranged until level xx" when a goal needs Slayer and combat levels together. (v1 is live: the Slayer tab, the model in core/slayer.js and Slayer steps in the planner.)
- **Slayer data gaps**: the low masters (Turael, Mazchna, Vannaka) have little rate data in KodakKid3's sheet, so below Chaeldar the planner falls back to the generic Slayer estimate. Some GP figures in the sheet were dropped as broken (bronze and iron dragons).
- **Requirements filter**: done as "your kill rates" (DPS calculator); see DPS_PROGRESS.md. Money makers in the planner use rates for current stats.

## Money Makers
- **Budget kill rates and supplies**: Budget setups use the High level rates and supplies, so they show the same GP/hr. Needs real budget figures.
- **Budget gear rule**: the planner's kill steps now show the fastest gear you can afford (Best Setup); the strategy-table setups still use the stopgap rule.

## DPS calculator (v2)
- Special attacks; overloads and smelling salts (where they work); Defence/Hitpoints for survival; whole-content targets refined (raid rotations, Inferno and Colosseum waves); a check against the Wiki DPS calculator's numbers.

## Site
- Optional redirect from the old Pet Hunt Profit Calculator site to this one.

## Review round 2 (pages) — decisions for review (25 Nov)

- **Bosses on Money Makers / planner**: offered only when your kill rate is at least half the guide's. Your kill
  rate replaces the Attack, Strength, Ranged and Magic requirements, but the setup's Defence and Hitpoints
  requirements still apply (survival isn't modelled). Prayer requirements count only up to 43 (protection
  prayers): what higher Prayer adds (Piety, Rigour, Augury) is already in the kill rate. (17:45, Harvey: requiring
  70-85 Prayer blocked every good boss while the plan was paying for Prayer training.) A boss with no kill rate
  (no Wiki gear list) keeps all its requirements.
- **Slayer kill speed**: the rate sheets assume strong gear and stats. Slayer task times are now scaled by your
  kill speed: the middle of your boss kill-rate factors against the Wiki's high-level setups, capped at 100%
  (a mid account comes out about 63%: Nieve 36K Slayer XP/hr instead of ~64K). The Slayer tab uses the kill
  rates saved by Money Makers or the planner, and says so; without them it shows the sheets' speed and says how
  to scale it. Combat XP per task is unchanged (it's 4 per damage, so it's right in total; only the hours grow).
- Hand corrections to Wiki data live in data/corrections.json (LMS, Wintertodt, Zalcano requirements;
  Barrows/Bryophyta not Wilderness; flower seed input cost).
- **Planner, combat XP from Slayer (16:55, Harvey)**: melee XP from Slayer tasks now fills the plan's needs first
  and then levels Attack, Strength and Defence together (lowest first) instead of all going into Strength, so
  later money makers see the higher stats. Money makers later in a plan are judged at the plan's levels: bosses
  you can't do well today stay candidates, and the best few by today's rate and by the guide's rate are
  re-worked at the levels reached (e.g. 99 Slayer on a 70s account now brings Corp into the money list).
- **Planner money steps build on each other (16:55, Harvey)**: a big GP goal is made in stages. Each time the
  cash stack reaches the next gear tier (10M, 25M, 50M, 100M, 250M, 500M, 1B, 2.5B, 5B, 10B) the money makers
  are worked out again with the gear that cash buys (kill rates and boss kill steps use the plan's cash at that
  point, not today's). Consecutive stages at the same money maker show as one step at its average rate. Gear
  bought keeps its value, so it isn't taken off the total. More cash never makes a kill rate slower.
- **Mage Arena II capes (18:00, Harvey)**: the imbued Saradomin, Guthix and Zamorak capes are untradeable, so they
  were only used if they were in your bank. They're now counted as free to get once you have 75 Magic (Wiki:
  first imbue in Mage Arena II, then 250K from Perdu), shown with a "Mage Arena II" tag instead of a price. The
  Imbued ancient cape (needs Pete Kayer's ancient fabric) and the imbued max capes still need to be owned.
  Other untradeables you earn (Fire/Infernal cape, Barrows gloves, Avernic defender, Void...) still need to be
  owned; the same list in core/gear.js can take them, with their requirements.
