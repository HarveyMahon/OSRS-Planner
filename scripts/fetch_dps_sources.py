"""Fetch the raw sources for the DPS calculator into scripts/cache/dps/ (no parsing here).

  * Equipment: every item with combat bonuses (OSRS Wiki Bucket API: infobox_item joined to infobox_bonuses).
  * Monsters: every monster's combat stats (OSRS Wiki Bucket API: infobox_monster).
  * The Wiki's DPS pages (wikitext), as the reference for the formulas.

Run by the "Fetch DPS sources" workflow: python scripts/fetch_dps_sources.py
"""
import json, os, time, urllib.parse, urllib.request

print("DPS source fetch started...", flush=True)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "cache", "dps"); os.makedirs(OUT, exist_ok=True)
API = "https://oldschool.runescape.wiki/api.php"
UA = "OSRS Planner - DPS data import (github.com/HarveyMahon/OSRS-Planner; Discord: Adamolf#7451)"

def get(params):
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))

ITEM_FIELDS = ["page_name", "page_name_sub", "item_name", "item_id", "weight", "version_anchor"] + [
    "infobox_bonuses." + f for f in ("crush_attack_bonus", "crush_defence_bonus", "equipment_slot", "magic_damage_bonus",
    "magic_attack_bonus", "magic_defence_bonus", "prayer_bonus", "range_attack_bonus", "ranged_strength_bonus",
    "range_defence_bonus", "slash_attack_bonus", "slash_defence_bonus", "stab_attack_bonus", "stab_defence_bonus",
    "strength_bonus", "weapon_attack_range", "weapon_attack_speed", "combat_style")]
MONSTER_FIELDS = ["page_name", "page_name_sub", "name", "id", "combat_level", "hitpoints", "attack_level", "strength_level",
    "defence_level", "magic_level", "ranged_level", "attack_speed", "attack_style", "max_hit", "attack_bonus", "strength_bonus",
    "magic_attack_bonus", "magic_damage_bonus", "range_attack_bonus", "range_strength_bonus", "stab_defence_bonus",
    "slash_defence_bonus", "crush_defence_bonus", "magic_defence_bonus", "range_defence_bonus", "light_range_defence_bonus",
    "standard_range_defence_bonus", "heavy_range_defence_bonus", "flat_armour", "elemental_weakness",
    "elemental_weakness_percent", "attribute", "size", "slayer_category", "slayer_experience", "burn_immune",
    "poison_resistance", "venom_resistance"]

def bucket(table, fields, extra):
    rows, offset = [], 0
    sel = ",".join(map(repr, fields))
    while True:
        q = f"bucket('{table}').select({sel}).limit(500).offset({offset}){extra}.orderBy('page_name_sub', 'asc').run()"
        data = get({"action": "bucket", "format": "json", "query": q})
        part = data.get("bucket") or []
        rows += part
        print(f"  {table}: {len(rows)} rows", flush=True)
        if len(part) < 500: break
        offset += 500; time.sleep(1)
    return rows

items = bucket("infobox_item", ITEM_FIELDS,
    ".where('infobox_bonuses.equipment_slot', '!=', bucket.Null()).where('item_id', '!=', bucket.Null())"
    ".join('infobox_bonuses', 'infobox_bonuses.page_name_sub', 'infobox_item.page_name_sub')")
json.dump(items, open(os.path.join(OUT, "equipment_raw.json"), "w"))
monsters = bucket("infobox_monster", MONSTER_FIELDS, ".where(bucket.Not('Category:Discontinued content'))")
json.dump(monsters, open(os.path.join(OUT, "monsters_raw.json"), "w"))
for page in ["Damage per second/Melee", "Damage per second/Ranged", "Damage per second/Magic", "Maximum magic hit", "Thrall"]:
    d = get({"action": "parse", "page": page, "prop": "wikitext", "format": "json", "redirects": 1})
    text = d.get("parse", {}).get("wikitext", {}).get("*", "")
    open(os.path.join(OUT, "wiki_" + "".join(c if c.isalnum() else "_" for c in page).lower() + ".txt"), "w").write(text)
    print(f"  wiki {page}: {len(text):,} chars", flush=True); time.sleep(1)
print("Done.")
