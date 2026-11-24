#!/usr/bin/env python3
"""
Build data/training.json: how to train each skill.

Hand-written (the Wiki has no structured training data). Each skill has TRACKS:
  * fastest  - XP/hr is the only thing considered (cost and effort ignored)
  * balanced - 1-2 sensible middle options (XP, cost and effort weighed)
  * afk      - intensity is the only thing considered (least attention)
Each track is a list of STAGES by level, so every level is covered. A stage has an XP/hr
estimate and, where it consumes or produces items, the items PER ACTION with the XP per action,
so costs are priced live and exact per XP.

XP/hr figures are ESTIMATES (typical rates for a reasonably efficient player) for review.
Run: python scripts/build_training.py  (offline; resolves item names against items.json and
the cached Wiki item mapping, adding any missing items at the latest cached prices)
"""
import json
import re
from pathlib import Path

print("Build training started...", flush=True)
HERE = Path(__file__).parent
import sys
sys.path.insert(0, str(HERE))
from quest_names import resolve as resolve_quest
ROOT = HERE.parent


def S(frm, name, xp, each=None, inp=None, out=None, req=None, quest=None, wild=False, f2p=False, note=None, recurring=None, cost=None):
    """One stage: from level `frm`, `xp` XP/hr; items per action (`each` XP per action);
    `cost` = a fixed GP cost per hour on top (e.g. paying essence runners)."""
    return {"from": frm, "name": name, "xpPerHr": xp, "xpEach": each, "inputs": inp or {}, "outputs": out or {}, "costPerHr": cost,
            "req": req or [], "quests": quest or [], "wilderness": wild, "f2p": f2p, "note": note, "recurring": recurring}


def T(kind, label, intensity, stages, note=None):
    return {"kind": kind, "label": label, "intensity": intensity, "stages": stages, "note": note}


EST = "Estimate: the Wiki gives no rate for this."

MELEE = [
    T("fastest", "Fastest", 4, [
        S(1, "Quests (Waterfall, Witch's House), then crabs", 20000, note=EST),
        S(55, "Sulphur nagua (Neypotzli)", 75000, quest=["Perilous Moons"], req=[{"skill": "Prayer", "level": 43}]),
        S(65, "Sulphur nagua", 100000, quest=["Perilous Moons"], req=[{"skill": "Prayer", "level": 43}], note="Between the Wiki's 75K (60) and 130K (75)."),
        S(75, "Maniacal monkeys with Hallowfell", 200000, quest=["Monkey Madness II"], note="200K+ with good stacking; up to 300K."),
    ]),
    T("balanced", "Balanced", 3, [
        S(1, "Quests, then crabs", 20000, note=EST),
        S(30, "Gemstone Crab", 35000, quest=["Children of the Sun"], note=EST),
        S(55, "Sulphur nagua", 75000, quest=["Perilous Moons"], req=[{"skill": "Prayer", "level": 43}]),
        S(70, "Sulphur nagua", 115000, quest=["Perilous Moons"], req=[{"skill": "Prayer", "level": 43}]),
    ]),
    T("afk", "AFK", 1, [
        S(1, "Rock / Sand crabs", 15000, note=EST),
        S(30, "Gemstone Crab (very low intensity)", 30000, quest=["Children of the Sun"], note=EST),
        S(60, "Nightmare Zone (one input every 20 minutes)", 70000, note=EST + " The Wiki calls it the most AFK melee method."),
    ]),
]


def melee(skill):
    return [{**t, "stages": [dict(s) for s in t["stages"]]} for t in MELEE]


SKILLS = {
    "Attack": melee("Attack"),
    "Strength": melee("Strength"),
    "Defence": melee("Defence"),
    "Hitpoints": [
        T("balanced", "Comes with combat training", 3, [S(1, "Any melee, Ranged or Magic combat (1/3 as much XP)", 20000)],
          note="Hitpoints XP is a third of the combat XP you earn; train it through another combat skill."),
    ],
    "Ranged": [
        T("fastest", "Chinning", 5, [
            S(1, "Dwarf multicannon on ogres", 40000, quest=["Dwarf Cannon"], note="Cannonball costs."),
            S(45, "Chinning maniacal monkeys (grey chinchompas)", 290000, quest=["Monkey Madness II"], note="Costs chinchompas; rates assume max gear."),
            S(55, "Chinning (red chinchompas)", 430000, quest=["Monkey Madness II"]),
            S(65, "Chinning (black chinchompas)", 690000, quest=["Monkey Madness II"]),
            S(85, "Chinning (black chinchompas)", 860000, quest=["Monkey Madness II"], note="Between the Wiki's 690K (65) and 1.03M (99)."),
        ]),
        T("balanced", "Balanced", 3, [
            S(1, "Dwarf multicannon on ogres", 40000, quest=["Dwarf Cannon"]),
            S(70, "Pest Control", 90000, note="77K (70) to 113K (99); hard games more."),
            S(80, "Venator bow on maniacal monkeys", 185000, quest=["Monkey Madness II"], note="140-230K."),
        ]),
        T("afk", "AFK", 1, [
            S(1, "Gemstone Crab (idle)", 25000, quest=["Children of the Sun"], note=EST),
            S(80, "Nightmare Zone with a venator bow", 120000, note="The Wiki gives 140-150K at 99."),
            S(95, "Nightmare Zone with a venator bow", 145000),
        ]),
    ],
    "Magic": [
        T("fastest", "Fastest", 5, [
            S(1, "Strike spells", 10000, note=EST),
            S(7, "Lvl-1 Enchant (sapphire rings)", 32000, f2p=True),
            S(27, "Lvl-2 Enchant (emerald rings)", 59200),
            S(43, "Superheat Item", 97000),
            S(62, "Ice Burst on maniacal monkeys", 310000, quest=["Desert Treasure I", "Monkey Madness II"]),
            S(94, "Ice Barrage on maniacal monkeys", 400000, quest=["Desert Treasure I", "Monkey Madness II"]),
        ]),
        T("balanced", "Alching and Lunar spells", 2, [
            S(1, "Strike spells", 10000, note=EST),
            S(7, "Lvl-1 Enchant (profitable)", 32000),
            S(55, "High Level Alchemy", 78000, each=65, inp={"Nature rune": 1}, note="Profit or loss depends on what you alch; only the nature rune is counted."),
            S(80, "String Jewellery (Lunar)", 150000, quest=["Lunar Diplomacy"]),
        ]),
        T("afk", "Splashing", 1, [
            S(1, "Splashing (input every 20 minutes)", 13000, note="The Wiki gives 6,600 to 75,750 depending on the spell."),
            S(55, "High Level Alchemy (passive)", 78000, each=65, inp={"Nature rune": 1}),
        ]),
    ],
    "Prayer": [
        T("fastest", "Gilded altar", 4, [
            S(1, "Gilded altar: dragon bones", 643000, each=252, inp={"Dragon bones": 1}, note="Needs a house with a gilded altar (75 Construction) or a friend's."),
            S(70, "Gilded altar: superior dragon bones", 1340000, each=525, inp={"Superior dragon bones": 1}),
        ]),
        T("balanced", "Chaos altar (half the bones)", 3, [
            S(1, "Chaos altar: dragon bones", 500000, each=252, inp={"Dragon bones": 0.5}, wild=True,
              note="50% chance to keep each bone. Up to 860K offering manually. Level 38 Wilderness."),
        ]),
        T("afk", "Libation bowl", 1, [
            S(1, "Gilded altar: dragon bones (until 30)", 643000, each=252, inp={"Dragon bones": 1}),
            S(30, "Libation bowl (blessed wine)", 670000, note="Very little active time. Uses bone shards (made from bones, or gathered other ways; not tradeable): their cost isn't counted."),
            S(34, "Libation bowl", 740000), S(40, "Libation bowl", 820000), S(48, "Libation bowl", 923000),
            S(62, "Libation bowl", 1050000), S(88, "Libation bowl", 1110000),
        ], note="About 20% faster with sunfire wine."),
    ],
    "Runecraft": [
        T("fastest", "Lava/aether runes with essence runners", 5, [
            S(1, "Talisman tiaras", 47000, note="Air 36K to elemental 58K."),
            S(23, "Lava runes with 4 essence runners", 280000, cost=48000000, note="Runners cost about 9-15M gp an hour each (12M used here)."),
            S(90, "Aether runes with 6 essence runners", 345000, cost=72000000),
        ]),
        T("balanced", "Solo lava runes", 4, [
            S(1, "Talisman tiaras", 47000, note="Air 36K to elemental 58K."),
            S(50, "Lava runes", 63000, each=10.5, inp={"Pure essence": 1, "Earth rune": 1}, out={"Lava rune": 1}),
            S(75, "Lava runes", 79000, each=10.5, inp={"Pure essence": 1, "Earth rune": 1}, out={"Lava rune": 1}),
            S(85, "Lava runes", 101000, each=10.5, inp={"Pure essence": 1, "Earth rune": 1}, out={"Lava rune": 1}),
        ]),
        T("balanced", "Guardians of the Rift", 3, [
            S(1, "Talisman tiaras", 47000),
            S(27, "Guardians of the Rift", 45000, quest=["Temple of the Eye"], note=EST),
            S(77, "Guardians of the Rift", 60000, quest=["Temple of the Eye"], note=EST),
        ]),
        T("afk", "Guardians of the Rift", 2, [
            S(1, "Talisman tiaras", 40000),
            S(27, "Guardians of the Rift (lower effort)", 40000, quest=["Temple of the Eye"], note=EST),
        ]),
    ],
    "Construction": [
        T("fastest", "Fastest", 5, [
            S(1, "Furniture in your house (crude chairs and up)", 30000, each=58, inp={"Plank": 2}, note=EST),
            S(33, "Oak larders", 300000, each=480, inp={"Oak plank": 8}, note="Up to 500K from 50 with a demon butler."),
            S(50, "Oak larders (demon butler)", 500000, each=480, inp={"Oak plank": 8}),
            S(52, "Mahogany tables", 900000, each=840, inp={"Mahogany plank": 6}),
            S(77, "Gnome benches", 1100000, each=840, inp={"Mahogany plank": 6}),
        ]),
        T("balanced", "Mythical capes / oak doors", 3, [
            S(1, "Furniture in your house", 30000, each=58, inp={"Plank": 2}, note=EST),
            S(33, "Oak larders", 300000, each=480, inp={"Oak plank": 8}),
            S(50, "Mounted mythical capes", 430000, each=370, inp={"Teak plank": 3}, quest=["Dragon Slayer II"]),
            S(74, "Oak dungeon doors (one key held)", 550000, each=600, inp={"Oak plank": 10}),
        ]),
        T("afk", "Mahogany Homes / shipwright", 2, [
            S(1, "Mahogany Homes (beginner)", 42500, note="Planks per hour vary by contract tier."),
            S(20, "Mahogany Homes (novice)", 87500), S(50, "Mahogany Homes (adept)", 140000), S(70, "Mahogany Homes (expert)", 197500),
            S(80, "Shipwrights' workbench: ironwood repair kits", 360000, quest=["Pandemonium"], note="Relaxed: up to 29 seconds idle per inventory."),
            S(84, "Shipwrights' workbench: rosewood hull parts", 475000, quest=["Pandemonium"]),
        ]),
    ],
    "Agility": [
        T("fastest", "Fastest", 4, [
            S(1, "Quests, then Draynor rooftop", 9500),
            S(20, "Brimhaven Agility Arena (floor spikes)", 30000, note="200 coins entry."),
            S(40, "Brimhaven Agility Arena (pillars)", 47500),
            S(52, "Wilderness Agility Course", 55000, wild=True),
            S(62, "Hallowed Sepulchre", 100000, quest=["Sins of the Father"]),
        ]),
        T("balanced", "Rooftops (marks of grace)", 3, [
            S(1, "Draynor rooftop", 9500), S(20, "Al Kharid rooftop", 11500), S(30, "Varrock rooftop", 12500),
            S(40, "Canifis rooftop", 15500), S(50, "Falador rooftop", 31500),
            S(60, "Seers' Village rooftop", 42000, note="50-56K with the hard Kandarin diary teleport."),
            S(70, "Pollnivneach rooftop", 49000, note="53-58K with the hard Desert diary."),
            S(80, "Rellekka rooftop", 51500, note="59-63K with the hard Fremennik diary."),
            S(90, "Ardougne rooftop", 68000),
        ]),
        T("afk", "Least intensive", 1, [
            S(1, "Draynor rooftop", 9500),
            S(20, "Brimhaven floor spikes (single click)", 30000, note="Very low intensity; 200 coins entry."),
            S(62, "Colossal Wyrm advanced course", 42000, note="6 clicks per lap with AFK sections."),
            S(75, "Prifddinas course", 60000, quest=["Song of the Elves"]),
            S(90, "Prifddinas course", 65000, quest=["Song of the Elves"]),
        ]),
    ],
    "Herblore": [
        T("fastest", "Fastest potions", 2, [
            S(3, "Attack potions", 62500, each=25, inp={"Guam potion (unf)": 1, "Eye of newt": 1}, out={"Attack potion(3)": 1}),
            S(12, "Strength potions", 125000, each=50, inp={"Tarromin potion (unf)": 1, "Limpwurt root": 1}, out={"Strength potion(3)": 1}),
            S(22, "Restore potions", 156250, each=62.5, inp={"Harralander potion (unf)": 1, "Red spiders' eggs": 1}, out={"Restore potion(3)": 1}),
            S(45, "Super attack", 250000, each=100, inp={"Irit potion (unf)": 1, "Eye of newt": 1}, out={"Super attack(3)": 1}),
            S(78, "Zamorak brews", 437500, each=175, inp={"Torstol potion (unf)": 1, "Jangerberries": 1}, out={"Zamorak brew(3)": 1}),
            S(85, "Ancient brews", 522500, each=190, inp={"Dwarf weed potion (unf)": 1, "Nihil dust": 1}, out={"Ancient brew(3)": 1}),
            S(89, "Armadyl brews", 563750, each=205, inp={"Umbral potion (unf)": 1, "Rainbow crab paste": 1}, out={"Armadyl brew(4)": 0.75},
              note="Output per the Wiki guide's ratio."),
        ], note="About 2,500 potions an hour. Tick manipulation can roughly double rates."),
        T("balanced", "Cheapest per XP", 2, [
            S(3, "Attack potions", 62500, each=25, inp={"Guam potion (unf)": 1, "Eye of newt": 1}, out={"Attack potion(3)": 1}),
            S(22, "Restore potions", 156250, each=62.5, inp={"Harralander potion (unf)": 1, "Red spiders' eggs": 1}, out={"Restore potion(3)": 1}),
            S(45, "Super attack", 250000, each=100, inp={"Irit potion (unf)": 1, "Eye of newt": 1}, out={"Super attack(3)": 1}),
            S(90, "Super combat potions", 324900, each=150, inp={"Torstol": 1, "Super attack(4)": 1, "Super strength(4)": 1, "Super defence(4)": 1}, out={"Super combat potion(4)": 1}),
        ], note="Herblore is the same effort whichever potion you make."),
    ],
    "Thieving": [
        T("fastest", "Fastest", 5, [
            S(1, "Quests, then men / women", 8000, note=EST),
            S(5, "Ardougne bakery stalls", 19200), S(25, "Hosidius fruit stalls", 42750),
            S(36, "Aldarin Villas chests", 45000, note="Lockpick and stamina potions."),
            S(45, "Blackjacking (brews)", 99000, quest=["The Feud"]),
            S(49, "Stealing artefacts", 150000), S(55, "Stealing artefacts", 163000), S(60, "Stealing artefacts", 174000),
            S(65, "Blackjacking (brews)", 230000, quest=["The Feud"]), S(75, "Blackjacking (brews)", 242000, quest=["The Feud"]),
            S(84, "Rogues' Castle chests", 285000, wild=True, note="High risk of player killers."),
        ]),
        T("balanced", "Knights of Ardougne", 3, [
            S(1, "Men / women", 8000, note=EST), S(5, "Ardougne bakery stalls", 19200), S(25, "Hosidius fruit stalls", 42750),
            S(55, "Knights of Ardougne", 86000), S(65, "Knights of Ardougne", 109000), S(75, "Knights of Ardougne", 141000),
            S(85, "Knights of Ardougne", 182000), S(90, "Knights of Ardougne", 209000), S(95, "Knights of Ardougne", 240000),
        ], note="Medium Ardougne diary recommended."),
        T("afk", "Least intensive", 1, [
            S(1, "Men / women", 8000, note=EST), S(5, "Ardougne bakery stalls", 19200), S(25, "Hosidius fruit stalls", 42750),
            S(50, "Varlamore valuables", 72000, quest=["Children of the Sun"]), S(60, "Varlamore valuables", 80000, quest=["Children of the Sun"]),
            S(70, "Varlamore valuables", 93000, quest=["Children of the Sun"]),
            S(78, "Dorgesh-Kaan rich chests", 190000, quest=["Death to the Dorgeshuun"], note="Fairly low effort."),
        ]),
    ],
    "Crafting": [
        T("fastest", "Fastest", 3, [
            S(1, "Leather items", 20000, note=EST),
            S(20, "Cutting sapphires", 139000, each=50, inp={"Uncut sapphire": 1}, out={"Sapphire": 1}),
            S(27, "Cutting emeralds", 187650, each=67.5, inp={"Uncut emerald": 1}, out={"Emerald": 1}),
            S(34, "Cutting rubies", 236300, each=85, inp={"Uncut ruby": 1}, out={"Ruby": 1}),
            S(43, "Cutting diamonds", 298850, each=107.5, inp={"Uncut diamond": 1}, out={"Diamond": 1}),
            S(55, "Cutting dragonstones", 382250, each=137.5, inp={"Uncut dragonstone": 1}, out={"Dragonstone": 1}),
            S(77, "Red d'hide bodies", 405000, each=234, inp={"Red dragon leather": 3}, out={"Red d'hide body": 1}),
            S(84, "Black d'hide bodies", 447000, each=258, inp={"Black dragon leather": 3}, out={"Black d'hide body": 1}),
        ]),
        T("balanced", "Cheapest per XP", 2, [
            S(1, "Leather items", 20000, note=EST),
            S(20, "Cutting sapphires", 139000, each=50, inp={"Uncut sapphire": 1}, out={"Sapphire": 1}),
            S(63, "Green d'hide bodies", 322000, each=186, inp={"Green dragon leather": 3}, out={"Green d'hide body": 1}),
        ]),
        T("afk", "Glassblowing", 1, [
            S(1, "Beer glasses", 30625, each=17.5, inp={"Molten glass": 1}, out={"Beer glass": 1}),
            S(46, "Unpowered orbs", 91875, each=52.5, inp={"Molten glass": 1}, out={"Unpowered orb": 1}),
            S(49, "Lantern lenses", 96250, each=55, inp={"Molten glass": 1}, out={"Lantern lens": 1}),
            S(87, "Empty light orbs", 122500, each=70, inp={"Molten glass": 1}, note="Empty light orbs are not on the GE; only the glass is counted."),
        ], note="Needs little attention and little capital."),
    ],
    "Fletching": [
        T("fastest", "Arrows", 5, [
            S(1, "Headless arrows", 45000, each=1, inp={"Arrow shaft": 1, "Feather": 1}, out={"Headless arrow": 1}),
            S(30, "Steel arrows", 225000, each=5, inp={"Headless arrow": 1, "Steel arrowtips": 1}, out={"Steel arrow": 1}),
            S(45, "Mithril arrows", 337500, each=7.5, inp={"Headless arrow": 1, "Mithril arrowtips": 1}, out={"Mithril arrow": 1}),
            S(60, "Adamant arrows", 450000, each=10, inp={"Headless arrow": 1, "Adamant arrowtips": 1}, out={"Adamant arrow": 1}),
            S(75, "Rune arrows", 562500, each=12.5, inp={"Headless arrow": 1, "Rune arrowtips": 1}, out={"Rune arrow": 1}),
            S(90, "Dragon arrows", 675000, each=15, inp={"Headless arrow": 1, "Dragon arrowtips": 1}, out={"Dragon arrow": 1}),
        ], note="The Wiki's rates assume 45,000 arrows an hour; mithril to rune are worked out on the same basis."),
        T("balanced", "Stringing bows", 2, [
            S(1, "Headless arrows", 45000, each=1, inp={"Arrow shaft": 1, "Feather": 1}, out={"Headless arrow": 1}),
            S(55, "Stringing maple longbows", 130000, each=58.3, inp={"Maple longbow (u)": 1, "Bow string": 1}, out={"Maple longbow": 1}, note=EST),
            S(70, "Stringing yew longbows", 170000, each=75, inp={"Yew longbow (u)": 1, "Bow string": 1}, out={"Yew longbow": 1}, note=EST),
            S(85, "Stringing magic longbows", 200000, each=91.5, inp={"Magic longbow (u)": 1, "Bow string": 1}, out={"Magic longbow": 1}, note=EST),
        ]),
        T("afk", "Darts (while doing other things)", 1, [
            S(1, "Headless arrows", 45000, each=1, inp={"Arrow shaft": 1, "Feather": 1}, out={"Headless arrow": 1}),
            S(37, "Steel darts", 150000, each=7.5, inp={"Steel dart tip": 1, "Feather": 1}, out={"Steel dart": 1}, note=EST + " Two clicks per set; doesn't interrupt movement."),
            S(52, "Mithril darts", 220000, each=11.2, inp={"Mithril dart tip": 1, "Feather": 1}, out={"Mithril dart": 1}, note=EST),
            S(67, "Adamant darts", 300000, each=15, inp={"Adamant dart tip": 1, "Feather": 1}, out={"Adamant dart": 1}, note=EST),
            S(81, "Rune darts", 370000, each=18.8, inp={"Rune dart tip": 1, "Feather": 1}, out={"Rune dart": 1}, note=EST),
        ]),
    ],
    "Slayer": [
        T("fastest", "Bursting tasks", 4, [
            S(1, "Turael / Vannaka tasks", 8000), S(50, "Chaeldar / Konar tasks", 25000),
            S(70, "Nieve / Duradel, bursting or barraging in the Catacombs", 60000, req=[{"skill": "Magic", "level": 70}]),
        ], note=EST + " The Wiki gives no Slayer XP rates."),
        T("balanced", "Standard tasks", 3, [S(1, "Turael / Vannaka tasks", 8000), S(50, "Nieve / Duradel tasks", 35000)], note=EST),
        T("afk", "Cannon tasks", 2, [S(1, "Turael / Vannaka tasks", 7000), S(50, "Cannonable tasks with ranged or melee", 25000)], note=EST),
    ],
    "Hunter": [
        T("fastest", "Fastest", 4, [
            S(1, "Natural History Quiz, quests", 5000, note=EST),
            S(9, "Feldip weasels", 13000), S(15, "Ruby harvests", 20000),
            S(21, "Red crabs", 31000, quest=["Pandemonium"]), S(39, "Embertailed jerboas", 50000, quest=["Eagles' Peak"]),
            S(43, "Spotted kebbits (falconry)", 65000), S(49, "Razor-backed kebbits", 130000),
            S(72, "Hunters' Rumours (expert)", 160000, quest=["Children of the Sun"]),
            S(91, "Hunters' Rumours (expert)", 195000, quest=["Children of the Sun"]),
        ]),
        T("balanced", "Drift nets / rumours", 3, [
            S(1, "Quiz, quests", 5000, note=EST), S(9, "Feldip weasels", 13000), S(21, "Red crabs", 31000, quest=["Pandemonium"]),
            S(44, "Drift net fishing (Hunter XP)", 60000, quest=["Bone Voyage"], req=[{"skill": "Fishing", "level": 47}], note="Also gives Fishing XP."),
            S(55, "Drift net fishing", 82000, quest=["Bone Voyage"], req=[{"skill": "Fishing", "level": 47}]),
            S(65, "Drift net fishing", 105000, quest=["Bone Voyage"], req=[{"skill": "Fishing", "level": 47}]),
            S(72, "Hunters' Rumours (expert)", 160000, quest=["Children of the Sun"]),
        ]),
        T("afk", "Bird house runs", 1, [
            S(1, "Quiz, quests", 5000, note=EST),
            S(5, "Bird houses (regular)", 20160, quest=["Bone Voyage"], note="Effective rate with a run every 50 minutes."),
            S(14, "Oak bird houses", 30240, quest=["Bone Voyage"]), S(24, "Willow bird houses", 40320, quest=["Bone Voyage"]),
            S(34, "Teak bird houses", 50400, quest=["Bone Voyage"]), S(44, "Maple bird houses", 66420, quest=["Bone Voyage"]),
            S(49, "Mahogany bird houses", 86400, quest=["Bone Voyage"]), S(59, "Yew bird houses", 110160, quest=["Bone Voyage"]),
            S(74, "Magic bird houses", 174420, quest=["Bone Voyage"]), S(89, "Redwood bird houses", 216000, quest=["Bone Voyage"]),
        ]),
    ],
    "Mining": [
        T("fastest", "Fastest", 5, [
            S(1, "Quests, then copper / tin", 8000, note=EST),
            S(15, "Iron ore", 50000), S(60, "Iron ore (Mining Guild)", 75000),
            S(65, "Granite (3-tick)", 103000), S(75, "Granite (3-tick)", 109000), S(85, "Granite (3-tick)", 114000), S(95, "Granite (3-tick)", 119000),
        ], note="3-tick granite from 45 (87K) is extremely high intensity."),
        T("balanced", "Motherlode / Volcanic Mine", 2, [
            S(1, "Copper / tin", 8000, note=EST), S(15, "Iron ore", 50000),
            S(30, "Motherlode Mine", 35000, note=EST + " About 52-62K at 90."),
            S(70, "Volcanic Mine (team)", 80000, quest=["Bone Voyage"]),
        ]),
        T("afk", "Least intensive", 1, [
            S(1, "Copper / tin", 8000, note=EST), S(30, "Motherlode Mine (low intensity)", 35000, note=EST),
            S(60, "Crashed stars (extremely low attention)", 27500),
        ]),
    ],
    "Smithing": [
        T("fastest", "Blast Furnace gold", 4, [
            S(1, "Bronze daggers", 13900, each=12.5, inp={"Bronze bar": 1}, out={"Bronze dagger": 1}),
            S(5, "Bronze scimitars", 25700, each=25, inp={"Bronze bar": 2}, out={"Bronze scimitar": 1}),
            S(9, "Bronze warhammers", 36200, each=37.5, inp={"Bronze bar": 3}, out={"Bronze warhammer": 1}),
            S(18, "Bronze platebodies", 52100, each=62.5, inp={"Bronze bar": 5}, out={"Bronze platebody": 1}),
            S(24, "Iron warhammers", 72300, each=75, inp={"Iron bar": 3}, out={"Iron warhammer": 1}),
            S(33, "Iron platebodies", 104200, each=125, inp={"Iron bar": 5}, out={"Iron platebody": 1}),
            S(40, "Blast Furnace: gold bars (goldsmith gauntlets)", 380000, each=56.2, inp={"Gold ore": 1}, out={"Gold bar": 1}, quest=["Family Crest"]),
        ]),
        T("balanced", "Giants' Foundry", 3, [
            S(1, "Bronze daggers", 13900, each=12.5, inp={"Bronze bar": 1}, out={"Bronze dagger": 1}),
            S(15, "Giants' Foundry (iron/steel)", 100000, quest=["Sleeping Giants"], note="Bar costs depend on the alloy."),
            S(30, "Giants' Foundry (iron/steel)", 133920, quest=["Sleeping Giants"]),
            S(70, "Giants' Foundry (mithril/adamant)", 198000, quest=["Sleeping Giants"]),
        ]),
        T("afk", "Cannonballs", 1, [
            S(1, "Bronze daggers", 13900, each=12.5, inp={"Bronze bar": 1}, out={"Bronze dagger": 1}),
            S(35, "Steel cannonballs (double ammo mould)", 27648, each=25.6, inp={"Steel bar": 1}, out={"Steel cannonball": 4}, quest=["Dwarf Cannon"],
              note="Needs even less attention than dart tips; profitable."),
        ]),
    ],
    "Fishing": [
        T("fastest", "Fastest", 5, [
            S(1, "Quests, then shrimps", 8000, note=EST),
            S(20, "3-tick fly fishing", 23000), S(30, "3-tick fly fishing", 45000), S(40, "3-tick fly fishing", 53000), S(50, "3-tick fly fishing", 61000),
            S(58, "3-tick Barbarian fishing", 68000, req=[{"skill": "Agility", "level": 30}, {"skill": "Strength", "level": 30}]),
            S(70, "3-tick Barbarian fishing", 90000, req=[{"skill": "Agility", "level": 30}, {"skill": "Strength", "level": 30}]),
            S(80, "3-tick Barbarian fishing", 97000, req=[{"skill": "Agility", "level": 30}, {"skill": "Strength", "level": 30}]),
            S(90, "3-tick Barbarian fishing", 103000, req=[{"skill": "Agility", "level": 30}, {"skill": "Strength", "level": 30}]),
        ]),
        T("balanced", "Tempoross", 2, [
            S(1, "Shrimps", 8000, note=EST), S(20, "Fly fishing", 13000),
            S(35, "Tempoross", 30000), S(50, "Tempoross", 46000), S(70, "Tempoross", 62000), S(90, "Tempoross", 68000),
        ]),
        T("afk", "Least intensive", 1, [
            S(1, "Shrimps", 8000, note=EST), S(20, "Fly fishing (AFK)", 13000), S(30, "Fly fishing (AFK)", 25000),
            S(40, "Fly fishing (AFK)", 30000), S(50, "Fly fishing (AFK)", 34000),
            S(62, "Monkfish (raft spot, 3-4 minutes per inventory)", 35800, quest=["Swan Song"]),
            S(80, "Monkfish", 38500, quest=["Swan Song"]), S(90, "Monkfish", 40000, quest=["Swan Song"]),
        ]),
    ],
    "Cooking": [
        T("fastest", "1-tick karambwans", 5, [
            S(1, "Fish (sardines to salmon)", 30000, note=EST),
            S(30, "1-tick karambwans", 464000, each=190, inp={"Raw karambwan": 1}, out={"Cooked karambwan": 1}, quest=["Tai Bwo Wannai Trio"]),
            S(60, "1-tick karambwans", 700000, each=190, inp={"Raw karambwan": 1}, out={"Cooked karambwan": 1}, quest=["Tai Bwo Wannai Trio"], note="Between the Wiki's 464K (30) and 950K (99)."),
            S(90, "1-tick karambwans", 900000, each=190, inp={"Raw karambwan": 1}, out={"Cooked karambwan": 1}, quest=["Tai Bwo Wannai Trio"]),
        ], note="Very click-intensive."),
        T("balanced", "Cooking fish", 2, [
            S(1, "Fish (sardines to salmon)", 30000, note=EST),
            S(30, "Tuna", 92500, each=100, inp={"Raw tuna": 1}, out={"Tuna": 1}),
            S(40, "Lobsters", 142500, each=120, inp={"Raw lobster": 1}, out={"Lobster": 1}),
            S(68, "Monkfish", 182500, each=150, inp={"Raw monkfish": 1}, out={"Monkfish": 1}),
            S(80, "Sharks", 280000, each=210, inp={"Raw shark": 1}, out={"Shark": 1}),
            S(84, "Anglerfish", 317500, each=230, inp={"Raw anglerfish": 1}, out={"Anglerfish": 1}),
        ], note="Cooking gauntlets for the best rates; sharks and anglerfish are profitable."),
        T("afk", "AFK karambwans", 1, [
            S(1, "Fish (sardines to salmon)", 30000, note=EST),
            S(30, "Karambwans (AFK)", 141000, each=190, inp={"Raw karambwan": 1}, out={"Cooked karambwan": 1}, quest=["Tai Bwo Wannai Trio"]),
            S(60, "Karambwans (AFK)", 205000, each=190, inp={"Raw karambwan": 1}, out={"Cooked karambwan": 1}, quest=["Tai Bwo Wannai Trio"]),
            S(90, "Karambwans (AFK)", 258000, each=190, inp={"Raw karambwan": 1}, out={"Cooked karambwan": 1}, quest=["Tai Bwo Wannai Trio"]),
        ]),
    ],
    "Firemaking": [
        T("fastest", "Tick-perfect burning", 4, [
            S(1, "1-tick pyre logs", 92000, quest=["Shades of Mort'ton"], note="Profitable."),
            S(30, "Willow logs", 107000, each=90, inp={"Willow logs": 1}), S(35, "Teak logs", 138000, each=105, inp={"Teak logs": 1}),
            S(45, "Maple logs", 200475, each=135, inp={"Maple logs": 1}), S(50, "Mahogany logs", 233887, each=157.5, inp={"Mahogany logs": 1}),
            S(60, "Yew logs", 300712, each=202.5, inp={"Yew logs": 1}), S(75, "Magic logs", 451143, each=303.8, inp={"Magic logs": 1}),
            S(90, "Redwood logs", 519750, each=350, inp={"Redwood logs": 1}),
        ]),
        T("balanced", "Wintertodt", 2, [
            S(1, "Forester's campfire (manual)", 39000, each=40, inp={"Logs": 1}), S(15, "Campfire: oak logs", 58500, each=60, inp={"Oak logs": 1}),
            S(30, "Campfire: willow logs", 87750, each=90, inp={"Willow logs": 1}), S(45, "Campfire: maple logs", 131625, each=135, inp={"Maple logs": 1}),
            S(50, "Wintertodt", 161000), S(60, "Wintertodt", 193000), S(70, "Wintertodt", 226000),
            S(80, "Wintertodt", 258000), S(90, "Wintertodt", 290000),
        ], note="Wintertodt is low effort and profitable."),
        T("afk", "Forester's campfire (automatic)", 1, [
            S(1, "Campfire: logs", 26600, each=40, inp={"Logs": 1}), S(15, "Campfire: oak logs", 39900, each=60, inp={"Oak logs": 1}),
            S(30, "Campfire: willow logs", 59850, each=90, inp={"Willow logs": 1}), S(45, "Campfire: maple logs", 89775, each=135, inp={"Maple logs": 1}),
            S(60, "Campfire: yew logs", 134662, each=202.5, inp={"Yew logs": 1}), S(75, "Campfire: magic logs", 202027, each=303.8, inp={"Magic logs": 1}),
            S(90, "Campfire: redwood logs", 232750, each=350, inp={"Redwood logs": 1}),
        ]),
    ],
    "Woodcutting": [
        T("fastest", "1.5-tick teaks", 5, [
            S(1, "Regular trees", 10000, note=EST), S(15, "Oak trees", 40000),
            S(35, "1.5-tick teaks (Fossil Island)", 93000, quest=["Bone Voyage"]), S(41, "1.5-tick teaks", 115000, quest=["Bone Voyage"]),
            S(50, "1.5-tick teaks", 126000, quest=["Bone Voyage"]), S(61, "1.5-tick teaks", 173000, quest=["Bone Voyage"]),
            S(71, "1.5-tick teaks", 194000, quest=["Bone Voyage"]), S(80, "1.5-tick teaks", 208000, quest=["Bone Voyage"]),
            S(90, "1.5-tick teaks", 222000, quest=["Bone Voyage"]),
        ]),
        T("balanced", "No tick manipulation", 2, [
            S(1, "Regular trees", 10000, note=EST), S(15, "Oak trees", 40000),
            S(35, "Teaks", 34000), S(41, "Teaks", 42000), S(50, "Teaks", 46000), S(61, "Teaks", 65000),
            S(65, "Sulliuscep", 82700, quest=["Bone Voyage"]), S(71, "Sulliuscep", 86300, quest=["Bone Voyage"]),
            S(77, "Bloodwood", 170000, quest=["Blood moon rises"], note="130-210K with a dragon felling axe."),
        ]),
        T("afk", "Least intensive", 1, [
            S(1, "Regular trees", 10000, note=EST), S(15, "Oak trees", 40000), S(35, "Teaks", 34000),
            S(62, "Blisterwood (sound cue when it stops)", 69000, quest=["Sins of the Father"]),
        ]),
    ],
    "Farming": [
        T("fastest", "Tithe Farm", 4, [
            S(1, "Allotments / early trees", 5000, note=EST), S(34, "Tithe Farm", 45000, note=EST), S(74, "Tithe Farm (logavano)", 80000, note=EST),
        ], note="The Wiki gives no Tithe Farm rate and says active methods suit Farming as a last 99."),
        T("balanced", "Tree runs", 2, [
            S(1, "Allotments / herbs (until 15)", 5000, note=EST),
            S(15, "Oak tree runs", 600000, each=481.3, inp={"Oak sapling": 1}, recurring={"minutesPerRun": 6, "hoursToGrow": 3.3, "perRun": 5}),
            S(30, "Willow tree runs", 1500000, each=1481.5, inp={"Willow sapling": 1}, recurring={"minutesPerRun": 6, "hoursToGrow": 4, "perRun": 5}),
            S(45, "Maple tree runs", 2000000, each=3448.4, inp={"Maple sapling": 1}, recurring={"minutesPerRun": 6, "hoursToGrow": 5.3, "perRun": 5}),
            S(60, "Yew tree runs", 2400000, each=7150.9, inp={"Yew sapling": 1}, recurring={"minutesPerRun": 6, "hoursToGrow": 6.7, "perRun": 5}),
            S(75, "Magic tree runs", 2400000, each=13913.8, inp={"Magic sapling": 1}, recurring={"minutesPerRun": 6, "hoursToGrow": 8, "perRun": 5}),
        ], note="The Wiki: around 2.4M XP per actively spent hour on full tree runs; each run waits for trees to grow."),
        T("afk", "Tree runs", 1, [
            S(1, "Allotments / herbs (until 15)", 5000, note=EST),
            S(15, "Oak tree runs", 600000, each=481.3, inp={"Oak sapling": 1}, recurring={"minutesPerRun": 6, "hoursToGrow": 3.3, "perRun": 5}),
            S(60, "Yew tree runs", 2400000, each=7150.9, inp={"Yew sapling": 1}, recurring={"minutesPerRun": 6, "hoursToGrow": 6.7, "perRun": 5}),
        ]),
    ],
    # From the Wiki's Sailing training page (Nov 2026): trials at Shark rank, mid-range salvaging rates
    "Sailing": [
        T("fastest", "Barracuda trials", 5, [
            S(1, "Courier tasks, sea charting, trimming sails", 8000, quest=["Pandemonium"], note="The Wiki gives about 10K/hr for sea charting at 22; early couriers have no listed rate."),
            S(30, "Barracuda trials: The Tempor Tantrum", 21938),
            S(55, "Barracuda trials: The Jubbly Jive", 80905),
            S(72, "Barracuda trials: The Gwenith Glide", 144543, note="184K/hr at Marlin rank; ~198K with a crystal extractor."),
        ]),
        T("balanced", "Port tasks (couriers)", 4, [
            S(1, "Courier tasks, sea charting, trimming sails", 8000, quest=["Pandemonium"]),
            S(45, "Courier tasks: Summer Shore", 20000, quest=["Troubled Tortugans"], note="Needs about 20K coins to start."),
            S(62, "Courier tasks: Rellekka", 66000),
            S(65, "Courier tasks: Rellekka and Etceteria", 99000),
            S(76, "Courier tasks: Lunar Isle", 145000, note="130-160K/hr; heavy route planning. Rates are pre-XP-boost estimates."),
        ], note="High complexity: route planning and juggling several tasks."),
        T("afk", "Shipwreck salvaging (with crew)", 1, [
            S(1, "Courier tasks, sea charting, trimming sails", 8000, quest=["Pandemonium"]),
            S(15, "Salvaging: small shipwrecks", 2400), S(26, "Salvaging: fisherman's shipwrecks", 5250),
            S(35, "Salvaging: barracuda shipwrecks", 10250), S(42, "Salvaging: barracuda shipwrecks (2 hooks, salvaging station)", 15250),
            S(53, "Salvaging: large shipwrecks", 24000), S(64, "Salvaging: pirate shipwrecks", 41000),
            S(73, "Salvaging: mercenary shipwrecks", 62500), S(80, "Salvaging: Fremennik shipwrecks", 75000),
            S(87, "Salvaging: merchant shipwrecks", 82500),
        ], note="Needs a salvaging hook and a crewmate with deckhandiness. Active play or tick manipulation gives about 2-2.5x."),
    ],
}


def main():
    items_doc = json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))
    items = items_doc["items"]
    mapping = {m["name"].lower(): m for m in json.loads((HERE / "item_mapping.json").read_text(encoding="utf-8"))}
    latest = {}
    for r in json.loads((ROOT / "logs/price_update_log.json").read_text(encoding="utf-8")).get("requests", []):
        if r.get("url", "").endswith("/latest"):
            latest = r["body"]["data"]
    by_name = {}
    for k, it in items.items():
        for n in [it["name"], *it.get("aliases", [])]:
            by_name[n.lower()] = k
    unresolved, added = set(), []

    def key(name):
        k = by_name.get(name.lower())
        if k:
            return k
        m = mapping.get(name.lower())
        if not m:
            unresolved.add(name); return name
        k = str(m["id"])
        if k not in items:
            p = latest.get(k) or {}
            v = [x for x in (p.get("high"), p.get("low")) if isinstance(x, (int, float)) and x > 0]
            items[k] = {"name": m["name"], "price": round(sum(v) / len(v)) if v else 0, "tradeable": True, "id": m["id"],
                        **({"limit": m["limit"]} if m.get("limit") else {})}
            added.append(m["name"])
        by_name[name.lower()] = k
        return k

    slug = lambda s: re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    out = {}
    for skill, tracks in SKILLS.items():
        out[skill] = []
        for t in tracks:
            stages = []
            for s in sorted(t["stages"], key=lambda x: x["from"]):
                st = {k: v for k, v in s.items() if v not in (None, [], {}, False)}
                st["from"] = s["from"]
                if s["inputs"]: st["inputs"] = [{"item": key(n), "qty": q} for n, q in s["inputs"].items()]
                if s["outputs"]: st["outputs"] = [{"item": key(n), "qty": q} for n, q in s["outputs"].items()]
                reqs = list(s["req"])
                for q in s["quests"]:
                    qt = resolve_quest(q)
                    if not qt:
                        unresolved.add("quest: " + q); continue
                    reqs.append({"quest": slug(qt)})
                if reqs: st["requires"] = {"all": reqs}
                st.pop("req", None); st.pop("quests", None)
                if (s["inputs"] or s["outputs"]) and not s["xpEach"]:
                    raise SystemExit(f"{skill} / {s['name']}: items per action need xpEach")
                stages.append(st)
            out[skill].append({"id": f"{slug(skill)}_{t['kind']}_{slug(t['label'])}", "kind": t["kind"], "label": t["label"],
                               "intensity": t["intensity"], **({"note": t["note"]} if t["note"] else {}), "stages": stages})
    doc = {"meta": {"description": "How to train each skill: fastest / balanced / AFK tracks with stages by level. "
                                   "XP/hr figures are estimates; items are per action (xpEach XP per action). "
                                   "Built by scripts/build_training.py.",
                    "intensity": "1 = AFK ... 5 = full attention"},
           "skills": out}
    (ROOT / "data/training.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    items_doc["items"] = items
    (ROOT / "data/items.json").write_text(json.dumps(items_doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    n = sum(len(t) for t in out.values())
    print(f"Done. {n} tracks across {sum(1 for t in out.values() if t)} skills; added {len(added)} items.")
    if unresolved:
        print("UNRESOLVED item names:", sorted(unresolved))


if __name__ == "__main__":
    main()
