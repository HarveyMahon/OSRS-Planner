# DPS calculator and best setup: progress

Working log for the "most efficient setup" build (started 25 Nov 2026, overnight). Newest first under each heading.

## Done

- **Data** (`scripts/fetch_dps_sources.py`, `scripts/build_dps.py`, workflow *Fetch DPS sources*)
  - Every item with combat bonuses from the Wiki's Bucket API, one table per slot in `data/gear/`
    (head, cape, neck, ammo, weapon = one-handed, 2h = two-handed, body, shield, legs, hands, feet, ring).
  - Charged/uncharged versions merged (the uncharged ID counts as owning or buying it); Deadman, beta, LMS,
    Castle Wars, Gauntlet (basic/attuned/perfected, Corrupted) and Leagues items dropped.
  - Monster stats for every boss and raid room in `data/dps-monsters.json`; which monsters make up each boss
    or piece of content in `data/dps-targets.json`.
  - Prices for all tradeable gear: the weekly price update now also writes `data/gear-prices.json`.
  - Levels needed to wear gear: *Fetch gear requirements* reads each item page's lead text (no structured data
    on the Wiki for this). Not wired in yet; see Next.
- **Engine** (`core/dps.js`): melee, ranged and magic accuracy, max hit and DPS per the Wiki pages, with:
  attack styles per weapon type; prayers (best unlocked, by Prayer level); potions (super combat, ranging,
  imbued/saturated heart or magic potion); Void (and elite), Inquisitor's, Obsidian + Tzhaar weapon and
  berserker necklace, Crystal armour + bow, Slayer helm / black mask on task, Salve amulets on undead,
  dragon hunter lance/crossbow/wand, demonbane (Arclight, Emberlight, Silverlight, Scorching bow, Arceuus
  demonbane spells with Mark of Darkness), Keris on kalphites, Twisted bow, Scythe (2-3 hits by size),
  Osmumten's fang (double accuracy roll, min/max), Tumeken's shadow (x3, x4 in ToA), enchanted bolts (opal,
  pearl, dragonstone, diamond, onyx, ruby; Kandarin hard diary; Ascension crossbows halve the chance),
  elemental weakness, flat armour, Corporeal Beast's halving, thralls (+0.625 on Arceuus), spellbooks
  (Ancients need Desert Treasure I), ammo that fits each weapon, blowpipe darts, Dizana's quiver.
- **Best setup optimiser** (`core/best-setup.js`): per style, candidates from the bank plus what the cash
  stack buys, a weapon pick then slot-by-slot improvement within budget, whole sets as one move; multi-part
  targets use each style where it's allowed; tries with and without a thrall.
- **Pages**: *Best Setup* (`gear/`) and *DPS* (`dps/`), in the nav before Slayer. My Account has a Prayers
  section; the bank import now also keeps every item ID (`bankIds`) for the gear.

## Next

1. Wire into Money Makers and the planner: scale each setup's kills/hr by the user's fight time vs the guide's
   (overhead per kill stays the same), and filter on that instead of the Wiki's recommended combat levels.
2. Budget gear rule: the planner's "gear to buy" from the best affordable setup.
3. Requirements to wear gear (parse check, then filter candidates).
4. Speed: cache results per account; a faster mode for scoring every boss.

## Decisions taken for review

- **Ascension crossbows** fire only ascension bolts; other crossbows can't fire those. Their 2-tick rapid makes
  them score very well (13 DPS on Vorkath with a Salve (ei) for your bank).
- **Ruby bolts** use 20% of the monster's *average* HP over the kill (HP/2), capped at 100.
- **Kandarin hard diary** is read from My Account's diaries; without it bolt specs are 10% rarer.
- **Thrall** needs A Kingdom Divided and 76 Magic (greater ghost); when it's on, only Arceuus spells or powered
  staves are used for magic.
- **Raids and multi-part content** (first stab): CoX = Tekton, Vasa, the three Vanguards, Vespula, both
  Muttadiles, Ice demon, 3 Skeletal mystics, 4 Lizardman shamans, Olm's claws and head; ToB = Maiden, Bloat,
  Nylocas Vasilias, Sotetseg, Xarpus, Verzik P2 and P3; ToA = Ba-Ba, Akkha, Kephri, Zebak, Wardens P2 and P3;
  Inferno = Zuk only (ranged); Fight Caves = Jad; Colosseum = Sol Heredit (melee). Each part lists the
  styles worth using on it. Gauntlets are skipped (gear is made inside).
- **Kill time** is HP / DPS, no downtime; for comparisons only.
- **Budget across styles**: the style used on most of the target's HP is optimised first with the full
  budget; later styles get what's left, and items already bought are free for them.
