"""Build the DPS calculator's data from scripts/cache/dps (see fetch_dps_sources.py).

  data/gear/<slot>.json  one table per slot: head, cape, neck, ammo, weapon (one-handed), 2h (two-handed),
                         body, shield, legs, hands, feet, ring. Each item: id, name, bonuses, and for weapons
                         speed and category (which decides the attack styles).
  data/dps-monsters.json the combat stats of the monsters in data/dps-targets.json (bosses and the parts of
                         raids and other multi-part content).

Data: the OSRS Wiki (Infobox Bonuses / Infobox Monster, via its Bucket API).
"""
import json, os, re
print("DPS build started...", flush=True)
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, "cache", "dps")
raw = json.load(open(os.path.join(SRC, "equipment_raw.json")))

def n(v):
    try: return int(v)
    except (TypeError, ValueError):
        try: return float(v)
        except (TypeError, ValueError): return 0

SKIP = re.compile(r"\(deadman|\(beta|\(Last Man Standing|\(bh\)|\(wrapped\)|\(broken\)|\(Leagues|Emir's Arena|\(nz\)|\(PvP\)|^Castle wars (bolts|arrow)|^Corrupted |\((basic|attuned|perfected)\)|^Echo |^Zaryte bow|^Crystal bow \d+/10|^Crystal bow full|^Training |^Signed oak", re.I)
tables = {}
seen = {}
alt_ids = {}
page_of = {}
for r in raw:
    slot = r.get("infobox_bonuses.equipment_slot")
    if not slot: continue
    name = r.get("item_name") or r.get("page_name")
    sub = r.get("page_name_sub") or name
    ids = r.get("item_id") or []
    ids = ids if isinstance(ids, list) else [ids]
    if not ids or SKIP.search(sub) or SKIP.search(name): continue
    ids = [int(i) for i in ids if str(i).isdigit()]
    if not ids: continue
    ver = sub.split("#", 1)[1] if "#" in sub else ""
    if re.search(r"^(Uncharged|Empty|Inactive|Broken|Locked \+ Uncharged|Nightmare Zone|Locked)$", ver) or re.search(r"\((uncharged|empty|inactive|broken)\)$", name, re.I):
        alt_ids.setdefault(r.get("page_name"), []).extend(ids)   # counts as owning / buying the charged item
        continue
    g = lambda f: n(r.get("infobox_bonuses." + f))
    it = {"id": ids[0], "name": name}
    if ids[1:]: it["ids"] = ids[1:]
    b = {"astab": g("stab_attack_bonus"), "aslash": g("slash_attack_bonus"), "acrush": g("crush_attack_bonus"),
         "amagic": g("magic_attack_bonus"), "arange": g("range_attack_bonus"),
         "str": g("strength_bonus"), "rstr": g("ranged_strength_bonus"), "mdmg": g("magic_damage_bonus"), "prayer": g("prayer_bonus"),
         "dstab": g("stab_defence_bonus"), "dslash": g("slash_defence_bonus"), "dcrush": g("crush_defence_bonus"),
         "dmagic": g("magic_defence_bonus"), "drange": g("range_defence_bonus")}
    it["b"] = {k: v for k, v in b.items() if v}
    if slot in ("weapon", "2h"):
        it["speed"] = n(r.get("infobox_bonuses.weapon_attack_speed")) or 4
        cat = (r.get("infobox_bonuses.combat_style") or "Unarmed").strip()
        it["category"] = cat[:1].upper() + cat[1:].lower() if cat.islower() else cat
    key = (slot, name, json.dumps(it["b"], sort_keys=True), it.get("speed"), it.get("category"))
    if key in seen:   # same item, another version or id (e.g. ornament kits, Soul Wars imbue): keep one, note the ids
        seen[key].setdefault("ids", []).extend([it["id"]] + it.get("ids", [])); continue
    seen[key] = it
    page_of[id(it)] = r.get("page_name")
    tables.setdefault(slot, []).append(it)

for items in tables.values():
    for it in items:
        alt = [i for i in alt_ids.get(page_of[id(it)], []) if i != it["id"] and i not in it.get("ids", [])]
        if alt: it["alt"] = sorted(set(alt))       # uncharged / empty versions: owned or bought, then charged
# ---- levels needed to wear each item (parsed from the Wiki pages' lead text; see fetch_gear_requirements.py) ----
SK = "Attack|Strength|Defence|Ranged|Magic|Prayer|Hitpoints|Slayer|Agility"
REQ_PATS = [
    (re.compile(r"(\d+) \[\[(" + SK + r")\]\] and \[\[(" + SK + r")\]\]", re.I), "pair"),
    (re.compile(r"\{\{SCP\|(" + SK + r")\|(\d+)"), "sl"),
    (re.compile(r"\[\[(" + SK + r")\]\] level of (\d+)", re.I), "sl"),
    (re.compile(r"(\d+) (?:in )?\[\[(" + SK + r")\]\]", re.I), "ls"),
    (re.compile(r"(\d+) (" + SK + r")\b"), "ls"),
]
def parse_reqs(text):
    out = {}
    for pat, kind in REQ_PATS:
        for m in pat.finditer(text or ""):
            g = m.groups()
            pairs = [(g[0], g[1]), (g[0], g[2])] if kind == "pair" else [(g[1], g[0])] if kind == "sl" else [(g[0], g[1])]
            for lvl, sk in pairs:
                lvl = int(lvl); sk = sk[:1].upper() + sk[1:].lower()
                if 1 < lvl <= 99: out[sk] = max(out.get(sk, 0), lvl)
    return out
req_path = os.path.join(SRC, "requirements_raw.json")
reqs = {k.lower(): parse_reqs(v.get("text")) for k, v in json.load(open(req_path)).items()} if os.path.exists(req_path) else {}
with_req = 0
for items in tables.values():
    for it in items:
        r = reqs.get((page_of[id(it)] or "").lower())
        if r: it["req"] = r; with_req += 1
print(f"  levels to wear: {with_req} items", flush=True)
os.makedirs(os.path.join(ROOT, "data", "gear"), exist_ok=True)
for slot, items in tables.items():
    items.sort(key=lambda x: (x["name"], x.get("version", "")))
    json.dump({"meta": {"slot": slot, "source": "OSRS Wiki (Infobox Bonuses)", "count": len(items)}, "items": items},
              open(os.path.join(ROOT, "data", "gear", f"{slot}.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"  {slot}: {len(items)} items", flush=True)

# ---- monsters used by data/dps-targets.json ----
targets = json.load(open(os.path.join(ROOT, "data", "dps-targets.json")))["targets"]
wanted = {p["monster"] for t in targets.values() for p in t["parts"]}
mons = json.load(open(os.path.join(SRC, "monsters_raw.json")))
by = {}
for m in mons: by.setdefault(m.get("page_name_sub"), m)
out, missing = {}, []
for w in sorted(wanted):
    m = by.get(w)
    if not m: missing.append(w); continue
    attrs = m.get("attribute") or []
    attrs = attrs if isinstance(attrs, list) else [attrs]
    out[w] = {"name": m.get("name"), "hp": n(m.get("hitpoints")), "def": n(m.get("defence_level")), "magic": n(m.get("magic_level")),
              "size": n(m.get("size")) or 1, "attributes": [a.lower() for a in attrs if a],
              "dstab": n(m.get("stab_defence_bonus")), "dslash": n(m.get("slash_defence_bonus")), "dcrush": n(m.get("crush_defence_bonus")),
              "dmagic": n(m.get("magic_defence_bonus")), "amagic": n(m.get("magic_attack_bonus")),
              "dlight": n(m.get("light_range_defence_bonus")), "dstandard": n(m.get("standard_range_defence_bonus")), "dheavy": n(m.get("heavy_range_defence_bonus")),
              "drange": n(m.get("range_defence_bonus")),
              "flatArmour": n(m.get("flat_armour")),
              "weakness": (m.get("elemental_weakness") or "").lower() or None, "weaknessPct": n(m.get("elemental_weakness_percent"))}
floors = json.load(open(os.path.join(ROOT, "data", "defence-floors.json")))["floors"]
for key, mon in out.items():
    f = floors.get(key, floors.get(key.split("#")[0]))
    if f is not None: mon["defFloor"] = mon["def"] if f == "base" else f
for key, o in json.load(open(os.path.join(ROOT, "data", "dps-monster-overrides.json")))["monsters"].items():
    if key in out: out[key].update({k: v for k, v in o.items() if k != "why"})
json.dump({"meta": {"source": "OSRS Wiki (Infobox Monster); defFloor from data/defence-floors.json; corrections from data/dps-monster-overrides.json"}, "monsters": out}, open(os.path.join(ROOT, "data", "dps-monsters.json"), "w"), indent=1, ensure_ascii=False)
print(f"  monsters: {len(out)} ({len(missing)} missing: {missing})")
