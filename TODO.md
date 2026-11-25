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
  rate replaces the Attack, Strength, Ranged and Magic requirements, but the setup's Defence, Hitpoints and
  Prayer requirements still apply (survival and protection/offensive prayers aren't modelled). This stops a 70s
  account being sent to Sol Heredit.
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
