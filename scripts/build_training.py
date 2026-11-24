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
ROOT = HERE.parent


def S(frm, name, xp, each=None, inp=None, out=None, req=None, quest=None, wild=False, f2p=False, note=None, recurring=None):
    """One stage: from level `frm`, `xp` XP/hr; items per action (`each` XP per action)."""
    return {"from": frm, "name": name, "xpPerHr": xp, "xpEach": each, "inputs": inp or {}, "outputs": out or {},
            "req": req or [], "quests": quest or [], "wilderness": wild, "f2p": f2p, "note": note, "recurring": recurring}


def T(kind, label, intensity, stages, note=None):
    return {"kind": kind, "label": label, "intensity": intensity, "stages": stages, "note": note}


MELEE = [
    T("fastest", "Fastest", 4, [
        S(1, "Quests, then Rock/Sand crabs", 15000),
        S(30, "Sand crabs (Hosidius)", 30000),
        S(60, "Nightmare Zone (rock cake, absorptions)", 65000, quest=["Nightmare Zone requires 5 quests"]),
        S(80, "Sulphur nagua (Neypotzli)", 95000, quest=["Perilous Moons"], req=[{"skill": "Herblore", "level": 38}]),
    ]),
    T("balanced", "Slayer-style combat", 3, [
        S(1, "Hill giants / Moss giants", 15000),
        S(40, "Ammonite crabs (Fossil Island)", 35000, quest=["Bone Voyage"]),
        S(70, "Nightmare Zone (absorptions)", 60000),
    ]),
    T("afk", "AFK", 1, [
        S(1, "Rock crabs / Sand crabs (re-aggro every 10 minutes)", 12000),
        S(40, "Ammonite crabs", 30000, quest=["Bone Voyage"]),
        S(60, "Nightmare Zone (absorptions, very AFK)", 55000),
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
        T("fastest", "Fastest", 5, [
            S(1, "Darts / knives at Sand crabs", 20000),
            S(45, "Cannon at Ogres / Nightmare Zone", 60000),
            S(65, "Chinning (grey chinchompas) in the Monkey Madness II tunnels", 250000, each=None,
              quest=["Monkey Madness II"], note="Costs grey chinchompas: roughly 1,000 an hour."),
        ]),
        T("balanced", "Balanced", 3, [
            S(1, "Sand crabs", 18000),
            S(40, "Ammonite crabs", 40000, quest=["Bone Voyage"]),
            S(70, "Nightmare Zone (blowpipe or crossbow)", 75000),
        ]),
        T("afk", "AFK", 1, [S(1, "Sand crabs", 15000), S(40, "Ammonite crabs", 35000, quest=["Bone Voyage"])]),
    ],
    "Magic": [
        T("fastest", "Fastest", 5, [
            S(1, "Strike/Bolt spells at crabs", 15000),
            S(45, "Camelot Teleport", 90000, each=55.5, inp={"Law rune": 1, "Air rune": 5}),
            S(70, "Ice Burst on Slayer tasks (catacombs)", 140000, note="Rune costs vary by task."),
            S(94, "Ice Barrage on Slayer tasks", 220000),
        ]),
        T("balanced", "High Alchemy", 2, [
            S(1, "Strike/Bolt spells", 12000),
            S(55, "High Level Alchemy (fire staff)", 78000, each=65, inp={"Nature rune": 1},
              note="Profit or loss depends on the items you alch; only the nature rune is counted."),
        ]),
        T("afk", "AFK (splashing)", 1, [S(1, "Splashing (-65 magic bonus)", 13000, note="Needs a combat level that lets you splash safely.")]),
    ],
    "Prayer": [
        T("fastest", "Fastest", 3, [
            S(1, "Gilded altar: big bones", 100000, each=52.5, inp={"Big bones": 1}),
            S(20, "Gilded altar: dragon bones", 480000, each=252, inp={"Dragon bones": 1}),
            S(70, "Gilded altar: superior dragon bones", 1000000, each=525, inp={"Superior dragon bones": 1}),
        ]),
        T("balanced", "Chaos altar (cheaper per XP)", 3, [
            S(1, "Chaos altar: dragon bones (50% chance to keep each bone)", 400000, each=252, inp={"Dragon bones": 0.5}, wild=True),
        ], note="Level 38 Wilderness: bring only what you can lose."),
        T("afk", "Lowest effort", 2, [
            S(1, "Gilded altar: big bones", 100000, each=52.5, inp={"Big bones": 1}),
        ], note="Prayer has no truly AFK method; the altar is the least demanding."),
    ],
    "Runecraft": [
        T("fastest", "Fastest", 5, [
            S(1, "Air / Mind runes", 8000, f2p=True),
            S(23, "Lava runes", 60000, each=10.5, inp={"Pure essence": 1, "Earth rune": 1}, out={"Lava rune": 1}),
            S(82, "Lava runes (higher levels)", 90000, each=10.5, inp={"Pure essence": 1, "Earth rune": 1}, out={"Lava rune": 1}),
        ]),
        T("balanced", "Guardians of the Rift", 3, [
            S(1, "Air / Mind runes", 8000),
            S(27, "Guardians of the Rift", 45000, quest=["Temple of the Eye"]),
            S(77, "Guardians of the Rift (higher levels)", 60000, quest=["Temple of the Eye"]),
        ]),
        T("afk", "Lowest effort", 2, [
            S(1, "Air runes", 6000, f2p=True),
            S(27, "Guardians of the Rift", 40000, quest=["Temple of the Eye"]),
            S(77, "True blood runes (Arceuus)", 38000, out={"Blood rune": 1}, each=24.4,
              note="No essence to buy: you mine dense essence."),
        ]),
    ],
    "Construction": [
        T("fastest", "Fastest", 4, [
            S(1, "Crude wooden chairs", 30000, each=58, inp={"Plank": 2}),
            S(33, "Oak larders (with a demon butler)", 250000, each=480, inp={"Oak plank": 8}),
            S(52, "Mahogany tables (with a demon butler)", 650000, each=840, inp={"Mahogany plank": 6}),
        ]),
        T("balanced", "Oak larders", 3, [
            S(1, "Crude wooden chairs", 30000, each=58, inp={"Plank": 2}),
            S(33, "Oak larders", 200000, each=480, inp={"Oak plank": 8}),
        ]),
        T("afk", "Mahogany Homes", 2, [S(1, "Mahogany Homes contracts", 80000, note="Plank costs vary with the contract tier.")]),
    ],
    "Agility": [
        T("fastest", "Fastest", 4, [
            S(1, "Gnome Stronghold course", 8000),
            S(10, "Draynor rooftop", 9000), S(30, "Varrock rooftop", 13000), S(40, "Canifis rooftop", 19000),
            S(52, "Hallowed Sepulchre", 55000, quest=["Sins of the Father"]),
            S(80, "Hallowed Sepulchre (higher floors)", 85000, quest=["Sins of the Father"]),
        ]),
        T("balanced", "Rooftops (marks of grace)", 3, [
            S(1, "Gnome Stronghold course", 8000), S(10, "Draynor rooftop", 9000), S(20, "Al Kharid rooftop", 10000),
            S(30, "Varrock rooftop", 13000), S(40, "Canifis rooftop", 19000), S(50, "Falador rooftop", 27000),
            S(60, "Seers' Village rooftop (with Kandarin diary)", 45000), S(70, "Pollnivneach rooftop", 52000),
            S(80, "Rellekka rooftop", 55000), S(90, "Ardougne rooftop", 62000),
        ]),
        T("afk", "Lowest effort", 2, [
            S(1, "Gnome Stronghold course", 8000), S(10, "Draynor rooftop", 9000), S(40, "Canifis rooftop", 19000),
            S(50, "Colossal Wyrm course (basic)", 30000),
        ], note="Agility is never AFK; these need the least attention per lap."),
    ],
    "Herblore": [
        T("fastest", "Potions", 2, [
            S(3, "Attack potions", 60000, each=25, inp={"Guam potion (unf)": 1, "Eye of newt": 1}, out={"Attack potion(3)": 1}),
            S(26, "Energy potions", 160000, each=67.5, inp={"Harralander potion (unf)": 1, "Chocolate dust": 1}, out={"Energy potion(3)": 1}),
            S(38, "Prayer potions", 210000, each=87.5, inp={"Ranarr potion (unf)": 1, "Snape grass": 1}, out={"Prayer potion(3)": 1}),
            S(52, "Super energy", 280000, each=117.5, inp={"Avantoe potion (unf)": 1, "Mort myre fungus": 1}, out={"Super energy(3)": 1}),
            S(63, "Super restores", 340000, each=142.5, inp={"Snapdragon potion (unf)": 1, "Red spiders' eggs": 1}, out={"Super restore(3)": 1}),
            S(72, "Ranging potions", 390000, each=162.5, inp={"Dwarf weed potion (unf)": 1, "Wine of zamorak": 1}, out={"Ranging potion(3)": 1}),
            S(81, "Saradomin brews", 430000, each=180, inp={"Toadflax potion (unf)": 1, "Crushed nest": 1}, out={"Saradomin brew(3)": 1}),
        ], note="Herblore is buy, mix, sell: the same potions are fastest and least effort."),
        T("balanced", "Cheaper potions", 2, [
            S(3, "Attack potions", 60000, each=25, inp={"Guam potion (unf)": 1, "Eye of newt": 1}, out={"Attack potion(3)": 1}),
            S(38, "Prayer potions", 210000, each=87.5, inp={"Ranarr potion (unf)": 1, "Snape grass": 1}, out={"Prayer potion(3)": 1}),
            S(66, "Super defence", 360000, each=150, inp={"Cadantine potion (unf)": 1, "White berries": 1}, out={"Super defence(3)": 1}),
        ]),
        T("afk", "AFK", 1, [
            S(3, "Attack potions", 60000, each=25, inp={"Guam potion (unf)": 1, "Eye of newt": 1}, out={"Attack potion(3)": 1}),
            S(38, "Prayer potions", 210000, each=87.5, inp={"Ranarr potion (unf)": 1, "Snape grass": 1}, out={"Prayer potion(3)": 1}),
        ]),
    ],
    "Thieving": [
        T("fastest", "Fastest", 5, [
            S(1, "Men / women", 8000, f2p=True), S(5, "Cake stalls", 16000), S(25, "Fruit stalls (Hosidius)", 40000),
            S(45, "Blackjacking (Pollnivneach)", 150000, quest=["The Feud"]),
            S(55, "Ardougne knights", 200000),
        ]),
        T("balanced", "Pyramid Plunder", 3, [
            S(1, "Men / women", 8000), S(25, "Fruit stalls", 40000),
            S(21, "Pyramid Plunder", 60000, quest=["Icthlarin's Little Helper"]),
            S(71, "Pyramid Plunder (higher rooms)", 200000, quest=["Icthlarin's Little Helper"]),
        ]),
        T("afk", "AFK", 1, [S(1, "Men / women", 8000), S(5, "Cake stalls", 16000), S(25, "Fruit stalls (Hosidius)", 40000)]),
    ],
    "Crafting": [
        T("fastest", "Fastest", 3, [
            S(1, "Cutting opals / gems", 30000, each=15, inp={"Uncut opal": 1}, out={"Opal": 1}),
            S(20, "Cutting sapphires", 130000, each=50, inp={"Uncut sapphire": 1}, out={"Sapphire": 1}),
            S(54, "Air battlestaves", 300000, each=137.5, inp={"Battlestaff": 1, "Air orb": 1}, out={"Air battlestaff": 1}),
            S(63, "Green d'hide bodies", 340000, each=186, inp={"Green dragon leather": 3}, out={"Green d'hide body": 1}),
        ]),
        T("balanced", "Gem cutting", 2, [
            S(1, "Cutting opals", 30000, each=15, inp={"Uncut opal": 1}, out={"Opal": 1}),
            S(20, "Cutting sapphires", 130000, each=50, inp={"Uncut sapphire": 1}, out={"Sapphire": 1}),
            S(27, "Cutting emeralds", 170000, each=67.5, inp={"Uncut emerald": 1}, out={"Emerald": 1}),
            S(34, "Cutting rubies", 210000, each=85, inp={"Uncut ruby": 1}, out={"Ruby": 1}),
            S(43, "Cutting diamonds", 260000, each=107.5, inp={"Uncut diamond": 1}, out={"Diamond": 1}),
        ]),
        T("afk", "Glassblowing", 1, [
            S(1, "Beer glasses", 30000, each=17.5, inp={"Molten glass": 1}, out={"Beer glass": 1}),
            S(46, "Unpowered orbs", 90000, each=52.5, inp={"Molten glass": 1}, out={"Unpowered orb": 1}),
            S(87, "Light orbs", 110000, each=70, inp={"Molten glass": 1}, out={"Light orb": 1}),
        ]),
    ],
    "Fletching": [
        T("fastest", "Fastest (darts)", 5, [
            S(1, "Arrow shafts", 10000, each=5, inp={"Logs": 1}, out={"Arrow shaft": 15}),
            S(37, "Steel darts", 450000, each=7.5, inp={"Steel dart tip": 1, "Feather": 1}, out={"Steel dart": 1}, quest=["The Tourist Trap"]),
            S(52, "Mithril darts", 700000, each=11.2, inp={"Mithril dart tip": 1, "Feather": 1}, out={"Mithril dart": 1}, quest=["The Tourist Trap"]),
            S(67, "Adamant darts", 900000, each=15, inp={"Adamant dart tip": 1, "Feather": 1}, out={"Adamant dart": 1}, quest=["The Tourist Trap"]),
            S(81, "Rune darts", 1100000, each=18.8, inp={"Rune dart tip": 1, "Feather": 1}, out={"Rune dart": 1}, quest=["The Tourist Trap"]),
        ]),
        T("balanced", "Stringing bows", 2, [
            S(1, "Arrow shafts", 10000, each=5, inp={"Logs": 1}, out={"Arrow shaft": 15}),
            S(55, "Stringing maple longbows", 130000, each=58.3, inp={"Maple longbow (u)": 1, "Bow string": 1}, out={"Maple longbow": 1}),
            S(70, "Stringing yew longbows", 170000, each=75, inp={"Yew longbow (u)": 1, "Bow string": 1}, out={"Yew longbow": 1}),
            S(85, "Stringing magic longbows", 200000, each=91.5, inp={"Magic longbow (u)": 1, "Bow string": 1}, out={"Magic longbow": 1}),
        ]),
        T("afk", "Cutting bows", 1, [
            S(1, "Arrow shafts", 10000, each=5, inp={"Logs": 1}, out={"Arrow shaft": 15}),
            S(55, "Cutting maple longbows (u)", 85000, each=58.3, inp={"Maple logs": 1}, out={"Maple longbow (u)": 1}),
            S(70, "Cutting yew longbows (u)", 110000, each=75, inp={"Yew logs": 1}, out={"Yew longbow (u)": 1}),
        ]),
    ],
    "Slayer": [
        T("fastest", "Bursting tasks", 4, [
            S(1, "Turael / Vannaka tasks", 8000), S(50, "Chaeldar / Nieve tasks", 25000),
            S(70, "Nieve / Duradel tasks, bursting where possible", 60000, req=[{"skill": "Magic", "level": 70}]),
        ]),
        T("balanced", "Standard tasks", 3, [S(1, "Turael / Vannaka tasks", 8000), S(50, "Nieve / Duradel tasks", 35000)]),
        T("afk", "AFK tasks (Konar, cannon)", 2, [S(1, "Turael / Vannaka tasks", 7000), S(50, "Konar tasks, cannon where allowed", 25000)]),
    ],
    "Hunter": [
        T("fastest", "Fastest", 4, [
            S(1, "Bird snaring", 5000), S(9, "Copper longtails / tropical wagtails", 15000),
            S(46, "Hunter Guild rumours", 50000, quest=["Children of the Sun"]),
            S(63, "Red chinchompas", 110000, out={"Red chinchompa": 1}, each=265),
            S(73, "Black chinchompas", 150000, out={"Black chinchompa": 1}, each=315, wild=True),
        ]),
        T("balanced", "Hunter rumours", 3, [
            S(1, "Bird snaring", 5000), S(9, "Copper longtails", 15000),
            S(46, "Hunter Guild rumours", 50000, quest=["Children of the Sun"]),
        ]),
        T("afk", "Lowest effort", 2, [
            S(1, "Bird snaring", 5000), S(9, "Copper longtails", 15000),
            S(80, "Herbiboar (Fossil Island)", 50000, quest=["Bone Voyage"]),
        ]),
    ],
    "Mining": [
        T("fastest", "Fastest", 5, [
            S(1, "Copper / tin", 8000, f2p=True), S(15, "Iron (3-tick)", 50000),
            S(45, "Granite (3-tick, Desert)", 90000, quest=["The Tourist Trap"]),
        ]),
        T("balanced", "Motherlode Mine", 2, [
            S(1, "Copper / tin", 8000), S(30, "Motherlode Mine", 30000), S(72, "Motherlode Mine (upper level)", 40000),
        ]),
        T("afk", "AFK", 1, [S(1, "Copper / tin", 8000), S(30, "Motherlode Mine", 28000), S(92, "Amethyst", 22000)]),
    ],
    "Smithing": [
        T("fastest", "Blast Furnace gold", 4, [
            S(1, "Bronze daggers", 18000, each=12.5, inp={"Bronze bar": 1}, out={"Bronze dagger": 1}),
            S(33, "Iron platebodies", 37000, each=125, inp={"Iron bar": 5}, out={"Iron platebody": 1}),
            S(40, "Blast Furnace: gold bars (goldsmith gauntlets)", 300000, each=56.2, inp={"Gold ore": 1}, out={"Gold bar": 1}, quest=["Family Crest"]),
        ]),
        T("balanced", "Giants' Foundry", 3, [
            S(1, "Bronze daggers", 18000, each=12.5, inp={"Bronze bar": 1}, out={"Bronze dagger": 1}),
            S(15, "Giants' Foundry", 60000, note="Bar costs depend on the alloy you use."),
            S(70, "Giants' Foundry (mithril/adamant)", 120000),
        ]),
        T("afk", "Platebodies at an anvil", 1, [
            S(1, "Bronze daggers", 18000, each=12.5, inp={"Bronze bar": 1}, out={"Bronze dagger": 1}),
            S(48, "Steel platebodies", 56000, each=187.5, inp={"Steel bar": 5}, out={"Steel platebody": 1}),
            S(68, "Mithril platebodies", 75000, each=250, inp={"Mithril bar": 5}, out={"Mithril platebody": 1}),
            S(88, "Adamant platebodies", 94000, each=312.5, inp={"Adamantite bar": 5}, out={"Adamant platebody": 1}),
        ]),
    ],
    "Fishing": [
        T("fastest", "Fastest", 5, [
            S(1, "Shrimps", 8000, f2p=True), S(20, "Fly fishing trout / salmon", 40000),
            S(58, "Barbarian fishing (3-tick)", 85000, req=[{"skill": "Agility", "level": 15}, {"skill": "Strength", "level": 15}]),
        ]),
        T("balanced", "Tempoross", 2, [S(1, "Shrimps", 8000), S(20, "Fly fishing", 35000), S(35, "Tempoross", 45000)]),
        T("afk", "AFK", 1, [
            S(1, "Shrimps", 8000), S(20, "Fly fishing (AFK)", 30000),
            S(58, "Barbarian fishing", 45000, req=[{"skill": "Agility", "level": 15}, {"skill": "Strength", "level": 15}]),
        ]),
    ],
    "Cooking": [
        T("fastest", "Fastest (wines)", 3, [
            S(1, "Shrimps", 20000, each=30, inp={"Raw shrimps": 1}, out={"Shrimps": 1}, f2p=True),
            S(35, "Jugs of wine", 450000, each=200, inp={"Grapes": 1, "Jug of water": 1}, out={"Jug of wine": 1}),
        ]),
        T("balanced", "Cooking fish for food", 2, [
            S(1, "Shrimps", 20000, each=30, inp={"Raw shrimps": 1}, out={"Shrimps": 1}),
            S(40, "Lobsters", 150000, each=120, inp={"Raw lobster": 1}, out={"Lobster": 1}),
            S(80, "Sharks", 260000, each=210, inp={"Raw shark": 1}, out={"Shark": 1}),
        ]),
        T("afk", "Lowest effort", 1, [
            S(1, "Shrimps", 20000, each=30, inp={"Raw shrimps": 1}, out={"Shrimps": 1}),
            S(40, "Lobsters (Hosidius range)", 140000, each=120, inp={"Raw lobster": 1}, out={"Lobster": 1}),
        ]),
    ],
    "Firemaking": [
        T("fastest", "Burning logs", 3, [
            S(1, "Logs", 30000, each=40, inp={"Logs": 1}, f2p=True), S(15, "Oak logs", 45000, each=60, inp={"Oak logs": 1}),
            S(30, "Willow logs", 65000, each=90, inp={"Willow logs": 1}), S(45, "Maple logs", 100000, each=135, inp={"Maple logs": 1}),
            S(60, "Yew logs", 150000, each=202.5, inp={"Yew logs": 1}), S(75, "Magic logs", 230000, each=303.8, inp={"Magic logs": 1}),
        ]),
        T("balanced", "Wintertodt", 2, [
            S(1, "Logs / oak logs", 35000, each=60, inp={"Oak logs": 1}),
            S(50, "Wintertodt (supply crates as loot)", 180000), S(85, "Wintertodt (higher levels)", 280000),
        ]),
        T("afk", "Wintertodt", 1, [S(1, "Logs / oak logs", 30000, each=60, inp={"Oak logs": 1}), S(50, "Wintertodt (low effort)", 140000)]),
    ],
    "Woodcutting": [
        T("fastest", "Fastest", 5, [
            S(1, "Trees / oaks", 8000, f2p=True), S(30, "Willows", 35000),
            S(35, "Teaks (2-tick)", 75000), S(70, "Teaks (2-tick, higher levels)", 110000),
        ]),
        T("balanced", "Forestry teaks", 2, [S(1, "Trees / oaks", 8000), S(30, "Willows", 30000), S(35, "Teaks with Forestry events", 55000)]),
        T("afk", "AFK", 1, [S(1, "Trees / oaks", 7000), S(30, "Willows", 28000), S(60, "Yews", 30000), S(90, "Redwoods", 65000)]),
    ],
    "Farming": [
        T("fastest", "Tithe Farm", 4, [S(1, "Allotments / early trees", 5000), S(34, "Tithe Farm", 45000), S(74, "Tithe Farm (logavano)", 80000)]),
        T("balanced", "Tree runs", 2, [
            S(1, "Allotments / herbs (until 15)", 5000),
            S(15, "Oak tree runs", 600000, each=467.3, inp={"Oak sapling": 1}, recurring={"minutesPerRun": 8, "hoursToGrow": 3.5, "perRun": 5}),
            S(30, "Willow tree runs", 1500000, each=1456.5, inp={"Willow sapling": 1}, recurring={"minutesPerRun": 8, "hoursToGrow": 4.7, "perRun": 5}),
            S(45, "Maple tree runs", 2000000, each=3403.4, inp={"Maple sapling": 1}, recurring={"minutesPerRun": 8, "hoursToGrow": 5.3, "perRun": 5}),
            S(60, "Yew tree runs", 2500000, each=7069.9, inp={"Yew sapling": 1}, recurring={"minutesPerRun": 8, "hoursToGrow": 6.7, "perRun": 5}),
            S(75, "Magic tree runs", 3000000, each=13768.3, inp={"Magic sapling": 1}, recurring={"minutesPerRun": 8, "hoursToGrow": 8, "perRun": 5}),
        ], note="XP/hr is per hour of active time; each run is limited by growth time."),
        T("afk", "Tree runs", 1, [
            S(1, "Allotments / herbs (until 15)", 5000),
            S(15, "Oak tree runs", 600000, each=467.3, inp={"Oak sapling": 1}, recurring={"minutesPerRun": 8, "hoursToGrow": 3.5, "perRun": 5}),
            S(60, "Yew tree runs", 2500000, each=7069.9, inp={"Yew sapling": 1}, recurring={"minutesPerRun": 8, "hoursToGrow": 6.7, "perRun": 5}),
        ]),
    ],
    "Sailing": [],   # released after the data was written; to be filled in
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
                reqs = list(s["req"]) + [{"quest": slug(q), "_name": q} for q in s["quests"] if not q.startswith("Nightmare Zone")]
                if reqs: st["requires"] = {"all": reqs}
                st.pop("req", None); st.pop("quests", None)
                if (s["inputs"] or s["outputs"]) and not s["xpEach"]:
                    raise SystemExit(f"{skill} / {s['name']}: items per action need xpEach")
                stages.append(st)
            out[skill].append({"id": f"{slug(skill)}_{t['kind']}_{slug(t['label'])}", "kind": t["kind"], "label": t["label"],
                               "intensity": t["intensity"], **({"note": t["note"]} if t["note"] else {}), "stages": stages})
    # quests referenced by training go into quests.json too
    qp = ROOT / "data/quests.json"
    qdoc = json.loads(qp.read_text(encoding="utf-8"))
    for tracks in out.values():
        for t in tracks:
            for s in t["stages"]:
                for r in s.get("requires", {}).get("all", []):
                    if "quest" in r:
                        qdoc["quests"].setdefault(r["quest"], {"name": r.pop("_name")})
                        r.pop("_name", None)
    qdoc["quests"] = dict(sorted(qdoc["quests"].items(), key=lambda kv: kv[1]["name"]))
    qp.write_text(json.dumps(qdoc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
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
