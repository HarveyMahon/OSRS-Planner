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
- **Armour sets** (13:50, from the Wiki): Inquisitor's 0.5% / 1% / 1% plus 1% for the full set with crush (the
  mace's boost was removed in July 2026); Virtus +3% magic damage per piece with Ancient spells; Verac's (25% of
  hits ignore Defence: always hit for 1 to max+1); Karil's and Ahrim's with the Amulet of the damned (25% chance
  of a second hit at half damage / +30% damage); Dharok's (damage x(1 + missing HP x max HP / 10000), at the "Low HP
  for Dharok's" you enter on Best Setup or the DPS page; it's saved with your account so kill rates use it too); Blood Moon with the
  dual macuahuitl (two hitsplats, the second only if the first hit; 33% / 55.11% chance the next attack is a tick
  sooner); Blue Moon with its spear (20% of Ice spell casts, 50% of Grasp casts, add a free melee hit); Obligator
  (best of 2-4 damage rolls, +20% / +40% on large monsters; Smash is 3 ticks with no passive); Twinflame staff (bolt,
  blast, wave hit again for 40%). Best Setup tries each set with its weapon as one move.
- Eclipse atlatl (13:20): max hit from your boosted Strength level and melee strength bonus with ranged prayers,
  plus melee Salve/Slayer helm bonuses (Wiki); with the full Eclipse Moon set, 20% of hits burn for 10 (unless
  the boss is immune to burns). Its spec (consumes burns) isn't modelled.
- Soulreaper axe (at 5 stacks), Confliction gauntlets, Tumeken's shadow x4 in ToA. Tests for the engine.

- **Special attacks** (`core/specs.js`, check-in 2): Defence drains (Dragon warhammer 30%, Elder maul 35%,
  Bandos godsword by damage, Arclight/Emberlight 5%, 10% on demons) spend the starting 100% energy at the start,
  then the main setup kills at the lowered Defence. Damage specs (Dragon claws by the Wiki's 4-2-1-1 cases,
  Armadyl godsword, Voidwaker, blowpipes, Zaryte crossbow with ruby/diamond/onyx bolts, Osmumten's fang, dragon
  and abyssal daggers, halberds) are used whenever there's energy (10% every 30s, twice with a Lightbearer).
  Best Setup picks a Defence-drain weapon and/or a damage spec weapon (owned, or bought from what's left of the
  budget if it saves at least 5%). Drains are used only as many times as help (each costs its own energy, e.g.
  50%), never below the boss's **Defence floor** (`data/defence-floors.json`: Verzik and Vardorvis can't be
  drained; Sotetseg 100, Nightmare/Phosani 120, Akkha 70, Ba-Ba 60, Kephri 60, Zebak 50, Wardens P3 120, Nex 250,
  Araxxor 90, Hueycoatl 120, Yama 145; checked against the Wiki at 13:40, except Akkha 70 and Phosani 120 which
  the pages read don't state); the energy left goes on damage specs. Vardorvis: his Defence falls from 215 to
  145 with his health (Wiki), so he's counted at 180 and drains don't apply (data/dps-monster-overrides.json). The DPS page has a "Spec weapon"
  row per setup; kill rates include specs.
  Added 13:15: Tonalztics of Ralos (Defence -1/8 of the boss's Magic per hit, second shot at the lowered
  Defence), Accursed sceptre (-15% Defence), Dark bow, Eldritch and Volatile nightmare staffs, Eye of Ayak,
  Zorya's tome, Webweaver bow, Burning claws (with its burns: each of the 3 hitsplats can burn for 10, 15/30/45%
  depending on which roll hit, unless the boss is immune to burns), Crimson kisten (four accuracy rolls, 70-110%
  up to 130-170% of max hit by how many land; the Wiki lists no burn for it), Zamorak and Ancient godswords (bleed counted),
  Dragon longsword / mace / sword / scimitar, Granite hammer, Arkan blade, Dragon knife, Rosewood blowpipe, Magic
  shortbows and ballistas. Fixed: Dark bow and Tonalztics fire two shots on every attack.
  Added 14:00: Saradomin sword (+1-16 magic on a hit), Barrelchest anchor (Defence -10% of damage), Bone dagger and
  Dorgeshuun crossbow (can't miss a fresh target; one Defence drain by the damage), Sunspear (70% of max), Scorching
  bow (5 burn on demons), Eclipse atlatl (+50% accuracy, burns consumed: est. +5 max), Blue Moon spear (est. 16 ticks of
  bind removed: +24%), Saradomin's blessed sword, Dual macuahuitl (needs the Blood Moon set), Magic longbow / comp
  bow / Seercull (always hit), Soulreaper axe (a cycle of 5 attacks building stacks then Behead, against holding 5
  stacks). Not done: Abyssal bludgeon (depends on how much Prayer you've used), Dawnbringer (Verzik P1 isn't modelled).

- **Checked against the Wiki's setups** (14:25): optimiser with no bank but every untradeable owned, at 10B,
  500M, 100M and 20M, against each boss's "High level" Wiki setup. Fixes from it: items only usable in Leagues,
  Grid Master, Deadman, LMS, Barbarian Assault, Wilderness Wars, PvP/Emir's arenas, Castle Wars or discontinued
  events are now left out (305 items, using the Wiki's categories; they were winning every slot); a style that's
  slower alone but faster with its specs is now tried too (Corp went magic at 10B, 274s, instead of melee with
  Elder maul + kisten, 242s). Nex can be meleed (Harvey: Obligator and Inquisitor's should be best there).
  Zulrah: hits over 50 are rerolled to 45-50 (her mechanic), so big max hits count as 47.5 on average; she can
  only be meleed with a halberd, for attacks and specs (so a Crystal halberd spec, not Dragon claws).
  Fixed 14:10: Zorya's tome (a "Powered Book") was treated as a melee weapon; it now attacks with magic (max hit
  Magic/3 - 10, 3 ticks, +15% magic damage), and its spec buffs the next 3 attacks too (+150% accuracy, +60% damage,
  2 ticks each) when it hits. It's now the spec Best Setup picks at Zulrah from 500M up.

- **Self-tests, part 1** (14:25): every boss against its Wiki setup (10B and 500M, untradeables owned).
  Within about 5% of the guide: Vorkath, Zulrah, the DT2 bosses, Muspah, Cerberus, Hydra, Kraken, GGs, ToB,
  ToA, Nightmare, Phosani, Yama, Sol, Skotizo, Huey, Araxxor. Faster than the guide mostly where the Wiki
  gear is a tank, budget or one-weapon setup (Graardor, Kril, KQ, the DKs, Mole, Nex 60% with Obligator).
  Fixed from it: **Wilderness weapons** (Ursine/Viggora's, Webweaver/Craw's, Accursed/Thammaron's) now get
  their +50% accuracy and damage at the Wilderness bosses (Artio, Callisto, Calvar'ion, Vet'ion, Spindel,
  Venenatis, Scorpia, Chaos Elemental); they were being treated as plain weapons, so the optimiser never
  picked them and the Wiki's own setups looked half as fast as they are. King Black Dragon isn't counted as
  Wilderness (not sure his lair is). **CoX Ice Demon** can be hit with any style (it was magic only, which
  left the guide's gear unable to finish the raid).
- **Sweeps** (14:25): budget 0 to 5B, levels 70 to 99, extra prayers, Kandarin hard, and owning what it would
  buy, on 10 targets: more never made a setup slower except twice (Zulrah 0 -> 10M got 3s slower; ToA at
  200M 1s). Cause: each style was optimised for every part it *can* hit, then only used where it's fastest
  (at Zulrah magic only does two forms). Now each style is re-optimised for the parts it wins and its
  owned-only gear is tried too, keeping whatever makes the whole target faster within budget. Zulrah at 10M
  is now 63.7s (was 69.6). Costs ~4s more on the first kill-rate run (now ~14s with your bank, then cached).
- **Kill-rate outliers** (14:30): with your bank, no boss hits the 0.2x/2x clamp; the budget setups at Vorkath
  and Nex come closest (1.9x, expected for a high account). Zuk, Jad, Zalcano and the Fractured Archive have no
  Wiki gear list, so they keep the guide's rate. Maggot King comes out 0.95x (guide gear you don't own).
- **Awkward accounts** (14:35): Best Setup on all 56 targets and the DPS page with all 54 spec weapons on 3
  targets, for no account, a fresh account, all 40s with 0 GP, all 99s with 10B and no prayers, all 70s with
  50M: no script errors or broken numbers (all 56 targets worked out in under 25s in total per account). A fresh or 0-GP account with no bank used to show
  a blank "—" result; it now says nothing usable was found and what to do (import the bank, raise the budget).
- **Phone width** (390px): the DPS page made the whole page scroll sideways (the long Monster list); fixed. The
  setup columns and the parts tables scroll inside their own boxes, as intended.
- **Engine against the Wiki's own DPS calculator** (14:45): the Wiki calculator's code is open source
  (weirdgloop/osrs-dps-calc), so I ran it on 268 setups the optimiser picks (every boss, 10B, 50M and the
  Wiki's gear, max levels) with the same style, spell, prayer and potions, and compared. 252 now agree within 1%
  (was 168 at the first run, though most of that gap was my test harness). Fixed in ours:
  - **Style immunities**: flying monsters (Kree'arra, Dawn, the flying Archive Guardian) can only be meleed with a
    halberd; Vespula, the Kraken, Zuk, Jal-MejJak and the Leviathan can't be meleed; Tekton and Dusk can't be hit
    with ranged, Dusk not with magic. (Best Setup had a scythe on Kree'arra and Dawn.) GGs now use ranged on Dawn.
  - **Corporeal Beast**: only corpbane weapons skip the halving (spears, halberds, Osmumten's fang, King's barrage,
    Thunder khopesh, Wiki's list); the Zamorakian hasta isn't one. Corp at 10B is now fang + specs, 213s.
  - **Sanguinesti staff**: 1 in 5 hits deal 8 extra damage (was missing).
  - **Seers ring (i)** and other half-percent magic damage items were read as 0%.
  - **Demonbane**: Ocellus and Xarth take 80%, Dreadnoth 25% (as the calculator has them).
  - **Float rounding**: 45 x 1.4 is 62.999... in JavaScript, so some max hits came out 1 low (Obligator at
    Cerberus 62 not 63). All the floors in the engine now ignore that error.
  - **Wilderness weapons** boost before Inquisitor's, as the calculator does; Fremennik warband members always take
    a max hit from the right style (the calculator's rule).
  Still different, on purpose or out of my hands: Vardorvis (we use his average Defence, 180, not 215, +8%);
  the full Inquisitor's set (+1% since
  the July change, not in the calculator yet); Doom (the calculator's phase setting).
- **Special attacks against the Wiki calculator** (15:15): every spec weapon in a max loadout of its style on
  Vorkath, Graardor, Cerberus and K'ril: 162 of 188 agree within 2% (was 39). Fixed:
  - **Torva platebody, platelegs and full helm** were read from the Wiki's "(unobtainable item)" pages (no stats)
    when looked up by name (the DPS page does that): those pages are now skipped.
  - **Seeking dragon arrows** counted as the lowest arrow tier, so they "fitted" magic shortbows and longbows.
  - **Abyssal dagger**: the second hit always lands when the first does (was rolled again).
  - **Halberds**: the second hit on a big monster rolls at 3/4 accuracy (was the same as the first).
  - **Saradomin's blessed sword** rolls against Magic Defence. **Webweaver bow**: each hit is max -60% (rounded
    the game's way). **Sunspear**: 70% of max +1. **Zaryte crossbow**: the bolt effect needs enchanted bolts.
  - **Magic shortbow/longbow, comp bow, Seercull**: the spec's max hit comes from Ranged + 10 and the arrow only.
  - **Burning claws**: the Wiki's exact damage split and burn odds. **Scorching bow** burns non-demons for 1.
  - **Keris partisan of amascut** has better stats inside ToA only (both versions were in the list as one item).
  On purpose: Zorya's tome (ours counts the 3 buffed attacks after it), Ancient godsword (ours counts its delayed 25
  damage when the spec hits; it isn't a bleed, Harvey 15:15), Bone dagger and Dorgeshuun crossbow (can't miss a fresh target), Soulreaper (worked out as a cycle).
- **15:20 (Harvey's answers)**: the Silvthrill ballista is quest-only, so it's left out of the gear lists. King
  Black Dragon stays non-Wilderness (confirmed). **Osmumten's fang inside ToA** now rolls accuracy twice outright
  (1 - miss chance squared), as the Wiki calculator does; outside it keeps the higher of two attack rolls.
  Already in: Tumeken's shadow x4 magic accuracy and damage inside ToA (x3 outside), the Twisted bow's 350 magic
  cap in CoX (every CoX part is marked Xerician).
- **Spec energy (adversarial round 1, 15:45)**: specs were getting a full bar for every copy of a monster (each
  Ket-Zek in the Fight Caves, every CoX shaman) and at the start of every kill. Now one energy pool per fight or
  run: a full bar plus 10% per 30s (x2 with a Lightbearer) over the fight, spent on the parts that save the most
  time per energy point, and one copy can't use more than a bar plus its own regeneration. Fight Caves (Harvey's
  bank): specs now save 8s of a 15-minute run, not 4m25s. **Decision for review:** kill rates (Money Makers,
  planner) give each kill only the energy that regenerates over one kill cycle (3600 / the guide's best kills
  per hour, which includes downtime), with no top-ups from a pool between kills. Whole raids and wave runs
  start each run with a full bar. Best Setup's single-boss number is still "a kill started with a full bar"
  and says so on the card.
- **Budget search (adversarial round 1)**: the optimiser filled slots head first and bought the best head it
  could (Oathplate helm, 67M of a 100M budget) before anything else. Now it also builds each setup by the best
  time saved per GP across all slots, then spends what's left, and keeps whichever is faster. A style that ends
  up used on no part (Kree'arra: the halberd melee set) no longer holds budget the used style could spend.
  Mid account (80s, 100M, no bank): Vardorvis 154s -> 128s, Duke 133s -> 102s, Zulrah 96s -> 90s, Graardor 77s
  -> 65s, Kree'arra 142s (1.4M spent) -> 120s. Kill-rate run with your bank ~18s (was ~14s); sweeps still monotonic.
- **Round 1 smaller fixes**: Best Setup reads "10 mil" and "1e9", and flags an amount it can't read (red field and
  a note) instead of silently using 0; the Special attacks card totals drains and specs over every part; ToA
  rows say "with smelling salts" / "no salts yet"; the CoX Guardians row names the pickaxe (not in the cost);
  DPS/Time headers say which is without and with specs; "Open in DPS calculator" opens the biggest part that
  style is used on; the DPS page's Monster list has readable names and no longer widens the page on phones;
  the Fight Caves target is named "TzHaar Fight Cave (all waves and Jad)"; Nex has a note that her phases
  aren't modelled; a page icon (no more favicon 404s); Money Makers says which cash stack its kill rates use;
  the gear notes say defence isn't counted and the cheaper of equal pieces is kept.

## Next

1. Done 14:30: planner money makers use your kill rate at the levels the plan has reached (the best 8 bosses
   are re-worked at each step, levels rounded down to 5s; the rest use today's rates). Kill steps already did.
2. Special attacks: first version done (below). More spec weapons and a better energy model to follow.
- Done at check-in 2: overload (+) in every CoX room (+6 +16% to Attack, Strength, Ranged, Magic) and smelling
  salts in ToA from the third room on (+11 +16%): the first two rooms are Ba-Ba then Kephri or Zebak then
  Kephri, so Kephri has none and Ba-Ba and Zebak each have them half the time, on Best Setup, the DPS page and your kill rates.
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
  Refined from the Wiki strategy pages (25 Nov, 12:30): **The Fractured Archive** is now the whole raid
  (Archive Guardian flying = ranged/magic, grounded = anything; Ezekiel or Bork; Moia or Dreadnoth; the Dagon'hai
  (magic) or Xarth, each half the time; Ocellus P1, P2, P3 = magic), with its Defence floors. 13:50: the Archive
  Guardian is immune to Ancient Magicks; the Smorks (650 HP, drainable to 0) count with Bork. **ToB**: Nylocas
  Vasilias is a third each melee/ranged/magic (it changes form). **ToA**: Ba-Ba melee, Kephri anything (mostly
  melee), Zebak and Akkha ranged/magic, Akkha's final stand (20% more HP, protecting from magic and ranged: melee), Wardens P2 ranged on the Warden (it prays melee and magic; the core
  isn't modelled), P3 anything with the last 20% enraged (my estimate; they share 880 HP, which was counted twice).
  **CoX** (12:55) is now the full layout: Tekton, Vasa, the 3 Vanguards, Vespula (her abyssal portal), both
  Muttadiles, 2 Guardians (with a Dragon pickaxe: they only take pickaxe damage), 3 Skeletal Mystics, 4 Lizardman
  Shamans, the Ice Demon puzzle, and Olm (3 phases of both claws, then the head). Rooms are random, so by default
  each combat room counts at 75% (6 of 8 in a raid) and the Ice Demon at 50%: my estimate. On Best Setup you can
  tick your own rotation instead; your kill rates use the average layout.
  Inferno, Fight Caves and Colosseum (14:05): from the Wiki's wave lists. Fight Caves: 48 Tz-Kih, 40 Tz-Kek
  (+80 small from splits), 36 Tok-Xil, 34 Yt-MejKot, 33 Ket-Zek, Jad. Inferno: 210 nibblers, 48 bats, 40 blobs
  (+120 small), 36 meleers, 34 rangers, 33 magers, 5 Jads, 4 healers, Zuk (Zuk-phase spawns and Jad healers left
  out). Colosseum: waves 1-11 main spawns (11 Fremennik trios, 6 shamans, 13 javelin colossi, 11 manticores,
  3 shockwave colossi), Sol; reinforcements (only after 40s on a wave) left out. Each part lists the
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
- **Spec energy in raids and multi-part content**: every room or part starts with full energy (the time
  between rooms usually refills it; true for every raid but CoX, kept for CoX too as it's hard to model). Xarpus
  is now melee or ranged (melee is best). A melee spec isn't used on a part that only allows ranged.
- **Budget across styles**: the style used on most of the target's HP is optimised first with the full
  budget; later styles get what's left, and items already bought are free for them.
