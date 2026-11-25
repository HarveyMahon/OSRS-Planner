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
  shortbows and ballistas. Fixed: Dark bow and Tonalztics fire two shots on every attack. Not done: Soulreaper axe
  (its spec spends the stacks), Saradomin sword, Abyssal bludgeon, Barrelchest anchor, Sunspear,
  Dual macuahuitl, Scorching bow.

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
