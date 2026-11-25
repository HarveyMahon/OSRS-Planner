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

- **Your kill rates** (`core/rates.js`): for each boss setup, your time per kill = the guide's time per kill
  minus the guide's fight (guide gear + guide levels through the DPS engine) plus your fight (your best setup
  from bank + cash). Money Makers scales kills/hr by it (a "1.17×" tag, explained in the row's details, with a
  "Use my kill rates" switch), and with it on, the guides' recommended *combat* levels no longer lock a boss.
  The planner uses the same rates for money makers and kill-count steps, and each kill step shows your kill
  rate and the fastest gear you can afford ("budget gear rule"). All bosses take ~3s; cached per account, daily.
- **Levels to wear gear**: parsed from each item page's lead text (1,124 items; e.g. Twisted bow 85 Ranged,
  Masori (f) 80 Ranged + 80 Defence). The optimiser skips gear you can't wear; the DPS page outlines it.
- Soulreaper axe (at 5 stacks), Confliction gauntlets, Tumeken's shadow x4 in ToA. Tests for the engine.

## Next

1. Planner money makers use rates for your current stats (kill steps use the stats the plan has reached).
2. Spec weapons (v2).
- Done at check-in 2: overload (+) in every CoX room (+6 +16% to Attack, Strength, Ranged, Magic) and smelling
  salts in every ToA room (+11 +16%), on Best Setup, the DPS page and your kill rates.
3. Refine whole-content targets with you (raids, Inferno waves, Colosseum waves).

## Decisions taken for review

- **Ascension crossbows** fire only ascension bolts; other crossbows can't fire those. Their 2-tick rapid makes
  them score very well (13 DPS on Vorkath with a Salve (ei) for your bank).
- **Ruby bolts** use 20% of the monster's *average* HP over the kill (HP/2), capped at 100.
- **Kandarin hard diary**: ticked under Achievement diaries on My Account (added 25 Nov; until then there was no way to set it, so bolt effects were always counted at the base rate). With it, enchanted bolt effects are 10% more likely.
- **Thrall** needs A Kingdom Divided and 76 Magic (greater ghost); when it's on, only Arceuus spells or powered
  staves are used for magic.
- **Raids and multi-part content** (first stab): CoX = Tekton, Vasa, the three Vanguards, Vespula, both
  Muttadiles, Ice demon, 3 Skeletal mystics, 4 Lizardman shamans, Olm's claws and head; ToB = Maiden, Bloat,
  Nylocas Vasilias, Sotetseg, Xarpus, Verzik P2 and P3; ToA = Ba-Ba, Akkha, Kephri, Zebak, Wardens P2 and P3;
  Inferno, Fight Caves and Colosseum (check-in 1): rough counts of each wave monster across a full run plus the
  final boss (Inferno: 30 bats, 25 blobs, 20 meleers, 15 rangers, 10 magers, 4 Jads, Zuk; Fight Caves: 30 each of
  Tz-Kih / Tz-Kek / Tok-Xil, 20 Yt-MejKot, 15 Ket-Zek, Jad; Colosseum: 3 of each Fremennik, 8 shamans, 8 javelin
  colossi, 6 jaguars, 6 manticores, 4 minotaurs, 4 shockwave colossi, Sol). Estimates to refine together. Each part lists the
  styles worth using on it. Gauntlets are skipped (gear is made inside).
- **Kill time** is HP / DPS, no downtime; for comparisons only.
- **Guide player** for the kill-rate comparison: the setup's recommended levels, 90 in any combat skill it
  doesn't list, Piety/Rigour/Augury, imbued heart, no thrall. The guide's fight is capped at 80% of its time per
  kill, and your rate at 20%-200% of the guide's, so a model mismatch can't produce silly numbers.
- **Team content**: fight times are divided by the setup's team size (or the boss's default), so the same
  share of the raid is compared.
- **Combat levels no longer lock bosses** on Money Makers when your kill rate is known. Defence/Hitpoints for
  survival aren't modelled, so a low-Defence account could see e.g. Nex if its DPS is good. Easy to add back
  a minimum if you'd rather.
- **Soulreaper axe** counted at 5 stacks all the time.
- **Budget across styles**: the style used on most of the target's HP is optimised first with the full
  budget; later styles get what's left, and items already bought are free for them.
