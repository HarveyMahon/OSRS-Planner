#!/usr/bin/env python3
"""
Apply a reviewed supply import (scripts/out/supplies_review.json) to the data files.

Runs offline: uses the cached guide pages (scripts/cache/) and the latest prices saved in
logs/price_update_log.json. Run scripts/import_supplies.py first.

    python scripts/apply_supplies.py

Rules (site owner's choices):
  * High level setup: a guide titled "max efficiency", otherwise the guide with the highest
    GP/hr (our loot model, the guide's supplies and kills per hour).
  * Budget setup (major bosses only, when there is more than one guide): a guide titled
    "budget", otherwise the remaining guide whose listed gear is cheapest.
  * Teleports are excluded (done by the import). Weapon charges and spells count.
  * Bosses whose rate the site owner set by hand keep it (see KEEP_RATE); only their supplies
    come from a guide.
"""
import json
import re
import sys
from pathlib import Path

print("Apply supplies started...", flush=True)

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.argv = sys.argv[:1]
import importlib.util
spec = importlib.util.spec_from_file_location("imp", HERE / "import_supplies.py")
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)          # parsing helpers only; its main() is not run

MAJOR = {"chambers_of_xeric", "theatre_of_blood", "tombs_of_amascut", "the_fractured_archive",
         "duke_sucellus", "vardorvis", "the_leviathan", "the_whisperer", "vorkath", "zulrah",
         "alchemical_hydra", "phantom_muspah", "araxxor", "phosanis_nightmare", "nex", "yama",
         "graardor", "commander_zilyana", "kreearra", "cerberus", "venenatis"}
# Rate set by the site owner: keep it, take supplies from this guide
KEEP_RATE = {"tombs_of_amascut": "Money making guide/Tombs of Amascut (solo 450 raid level)"}
# Guides that model something other than a plain setup (Yama contracts change the loot)
SKIP_GUIDE = re.compile(r"Contract of", re.I)
SKIP_BOSS = {"zalcano"}   # not a money maker
# Where the rule picks badly: raid modes aren't gear tiers (title substrings)
FORCE = {"chambers_of_xeric": {"high": "Challenge Mode", "budget": "Normal Mode"}}


def load(p):
    return json.loads((ROOT / p).read_text(encoding="utf-8"))


def save(p, obj):
    (ROOT / p).write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    review = load("scripts/out/supplies_review.json")
    pages = load("scripts/cache/guide_pages.json")
    items_doc, bosses_doc = load("data/items.json"), load("data/bosses.json")
    items, bosses = items_doc["items"], bosses_doc["bosses"]
    mapping = {m["name"].lower(): m["id"] for m in load("scripts/item_mapping.json")}
    latest = {}
    for r in load("logs/price_update_log.json").get("requests", []):
        if r.get("url", "").endswith("/latest"):
            latest = r["body"]["data"]

    def latest_price(key):
        p = latest.get(str(key)) or {}
        v = [x for x in (p.get("high"), p.get("low")) if isinstance(x, (int, float)) and x > 0]
        return round(sum(v) / len(v)) if v else None

    by_name = {}
    for k, it in items.items():
        for n in [it["name"], *it.get("aliases", [])]:
            by_name[n.lower()] = k

    added = {}
    def ensure_item(key, name):
        """Add a GE item to items.json if missing. Returns True if it has a price."""
        if key in items:
            return True
        price = latest_price(key)
        if price is None:
            return False
        items[key] = {"name": name, "price": price, "tradeable": True, "id": int(key)}
        by_name[name.lower()] = key
        added[key] = name
        return True

    def key_for(name):
        k = by_name.get(name.lower())
        if k:
            return k
        i = mapping.get(name.lower())
        return str(i) if i is not None and ensure_item(str(i), name) else None

    price = lambda k: items[k]["price"] if k in items else 0

    def gear_of(title):
        """Items linked in the guide's 'Item' field, resolved to item keys."""
        p = imp.template_params(pages.get(title, ""))
        names = re.findall(r"\[\[([^|\]#]+)", p.get("Item", ""))
        keys = []
        for n in names:
            k = key_for(n.strip())
            if k and k not in keys:
                keys.append(k)
        return keys

    def supplies_of(g):
        out = []
        for s in g["supplies"]:
            if s.get("item") and (s["item"] in items or ensure_item(s["item"], s["name"])):
                out.append({"item": s["item"], "qty": s["qty"], "per": "unit"})
            elif "gpEach" in s:
                out.append({"item": "gp:" + s["name"], "label": s["name"], "gp": s["gpEach"], "qty": s["qty"], "per": "unit"})
        return out

    def team_of(title):
        t = title.lower()
        for word, n in (("solo", 1), ("duo", 2), ("trio", 3)):
            if re.search(rf"\b{word}\b", t):
                return n
        return None

    def setup_from(boss, g, sid, label):
        title = g["guide"]
        s = {"id": sid, "label": label, "unitsPerHr": g["unitsPerHr"],
             "unitsPerHrSource": f"Wiki: {title[len(imp.PREFIX):]}", "unitsPerTrip": None,
             "requires": None, "gear": gear_of(title), "supplies": supplies_of(g),
             "costSource": f"Wiki: {title[len(imp.PREFIX):]} (per {boss['unit']}, teleports excluded)",
             "guide": title}
        n = team_of(title)
        if n and boss.get("teamOption"):
            s["team"] = {"size": n}
        m = re.search(r"delve\s*\d+\s*-\s*(\d+)", title, re.I)
        if m and boss.get("delveOption"):
            s["delve"] = int(m.group(1))
        if boss.get("raidOption", {}).get("type") == "cox":
            s["raid"] = {"mode": "challenge" if "challenge" in title.lower() else "normal"}
        return s

    report = []
    # New bosses built from their guides: drops are the guide's expected loot per unit (from the
    # high level guide); other setups scale it with lootShare
    for nb in imp.NEW_BOSSES:
        gs = [g for g in review["bosses"].get(nb["id"], []) if g["unitsPerHr"]]
        if not gs or any(b["id"] == nb["id"] for b in bosses):
            continue
        def gp_hr(g): return (g["guideLootPerUnit"] - g["costPerUnit"]) * g["unitsPerHr"]
        high = max(gs, key=gp_hr)
        drops = []
        for ln in high["loot"] or []:
            if ln.get("item") and (ln["item"] in items or ensure_item(ln["item"], ln["name"])):
                drops.append({"item": ln["item"], "qtyMin": ln["qty"], "qtyMax": ln["qty"], "expectedPerKill": 1,
                              "table": "Wiki guide average"})
        setups = [setup_from(nb, high, "high", "High level")]
        rest = [g for g in gs if g is not high]
        if rest:
            budget = min(rest, key=lambda g: sum(price(k) for k in gear_of(g["guide"])))
            s2 = setup_from(nb, budget, "budget", "Budget")
            s2["lootShare"] = round(budget["guideLootPerUnit"] / high["guideLootPerUnit"], 4) if high["guideLootPerUnit"] else 1
            setups.append(s2)
        bosses.append({"id": nb["id"], "name": nb["name"], "unit": nb["unit"], "petCalc": False,
                       "wikiUrl": "https://oldschool.runescape.wiki/w/" + nb["name"].replace(" ", "_"),
                       "notes": "Loot is the Wiki money-making guide's expected loot per raid for the high level setup's "
                                "team size, not a full drop table. Not in the pet calculator yet.",
                       "drops": drops, "setups": setups, "defaultSetup": "high"})
        report.append(f"{nb['name']}: NEW; high = {high['guide'][len(imp.PREFIX):]}"
                      + (f"; budget = {budget['guide'][len(imp.PREFIX):]} (loot x{s2['lootShare']})" if rest else ""))

    for b in bosses:
        if b.get("petCalc") is False:
            continue
        if b["id"] in SKIP_BOSS:
            continue
        guides = [g for g in review["bosses"].get(b["id"], [])
                  if g["unitsPerHr"] and not SKIP_GUIDE.search(g["guide"])
                  and not any(f.startswith("no Mmgtable") for f in g["flags"])]
        if not guides:
            continue
        old_high = next((s for s in b["setups"] if s["id"] == "high"), b["setups"][0])

        if b["id"] in KEEP_RATE:
            g = next(x for x in guides if x["guide"] == KEEP_RATE[b["id"]])
            old_high.update(supplies=supplies_of(g), gear=gear_of(g["guide"]), guide=g["guide"],
                            costSource=f"Wiki: {g['guide'][len(imp.PREFIX):]} (supplies only; rate set by site owner)")
            old_high.pop("flatCostPerUnit", None)
            report.append(f"{b['name']}: kept your rate; supplies from {g['guide'][len(imp.PREFIX):]}")
            continue

        # Rank by the guide's own GP/hr (its loot and supplies at our prices)
        def gphr(g):
            return (g["guideLootPerUnit"] - g["costPerUnit"]) * g["unitsPerHr"]
        max_eff = [g for g in guides if "max efficiency" in g["guide"].lower()]
        force = FORCE.get(b["id"], {})
        pick = lambda part: next(g for g in guides if part in g["guide"])
        high = pick(force["high"]) if "high" in force else max_eff[0] if max_eff else max(guides, key=gphr)
        setups = [setup_from(b, high, "high", "High level")]
        rest = [g for g in guides if g is not high]
        budget = None
        if "budget" in force:
            budget = pick(force["budget"])
            setups.append(setup_from(b, budget, "budget", "Budget"))
        elif b["id"] in MAJOR and rest:
            named = [g for g in rest if "budget" in g["guide"].lower()]
            budget = named[0] if named else min(rest, key=lambda g: sum(price(k) for k in gear_of(g["guide"])))
            setups.append(setup_from(b, budget, "budget", "Budget"))
        b["setups"], b["defaultSetup"] = setups, "high"
        report.append(f"{b['name']}: high = {high['guide'][len(imp.PREFIX):]}"
                      + (f"; budget = {budget['guide'][len(imp.PREFIX):]}" if budget else ""))

    bosses_doc["meta"]["supplies"] = ("Setups built from the Wiki money-making guides by scripts/apply_supplies.py: "
                                      "supplies per unit, teleports excluded, weapon charges and spells included.")
    save("data/items.json", items_doc)
    save("data/bosses.json", bosses_doc)
    print("\n".join(report))
    print(f"Added {len(added)} items to items.json.")


if __name__ == "__main__":
    main()
