#!/usr/bin/env python3
"""
Build data/methods.json from the Wiki money-making guides that aren't boss setups
(skilling, processing, collecting, low-level combat...). Offline: needs the cache from
`python scripts/import_supplies.py --all-guides`.

    python scripts/apply_methods.py

Each method keeps its inputs and outputs PER HOUR as item lists (or fixed GP values), so GP/hr
is worked out live from current prices, like the bosses. XP per hour, members-only, category,
intensity and requirements (skill levels incl. recommended, quests) come from the guide.
Methods that go into the Wilderness are flagged, with the text that says so.

A guide is skipped (listed in scripts/out/methods_review.md) when its loot can't be priced:
an output whose quantity or value uses Wiki-only formulas, or that isn't a known item.
"""
import json
import re
import sys
from pathlib import Path

print("Apply methods started...", flush=True)

HERE = Path(__file__).parent
ROOT = HERE.parent
sys.argv = sys.argv[:1]
import importlib.util
def load_module(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m
imp = load_module("import_supplies")
req = load_module("apply_requirements")

# Wilderness: the guide's Location says so, or the text names a Wilderness level or area.
# Mentions that don't mean going there are removed first (diaries, items, Ferox Enclave banking).
NOT_WILDY = re.compile(r"except (in )?the wilderness|wilderness sword|wilderness (elite |hard |medium |easy )?(diary|tasks)|"
                       r"(elite|hard|medium|easy) wilderness (diary|tasks)|ferox enclave|corsair cove resource area|"
                       r"resource area of the chasm|consider the [\w\- ]*wilderness mine", re.I)
WILDY_TEXT = re.compile(r"revenant cave|lava maze|deep wilderness|(level|lvl)\s*\d+(\s*[-\u2013]\s*\d+)?\s*wilderness|"
                        r"low[- ]level wilderness|located (deep )?in the wilderness|in the wilderness|wilderness (rune mine|agility|"
                        r"dungeon|bosses|resource area)|larran|rogues' castle|chaos temple \(wilderness\)|demonic ruins|"
                        r"lava dragon isle|mage of zamorak|fountain of rune|wilderness slayer cave|bandit camp \(wilderness\)|dark warriors.? fortress|frozen waste plateau|black salamander|wilderness volcano", re.I)
WILDERNESS_BOSSES = {"callisto", "artio", "venenatis", "spindel", "vetion", "calvarion", "scorpia",
                     "chaos_elemental", "chaos_fanatic", "crazy_archaeologist", "revenant_maledictus",
                     "king_black_dragon"}   # lair reached through the Wilderness
RECURRING = re.compile(r"recurring", re.I)


def wilderness_note(p):
    """The text that puts a guide in the Wilderness, or None."""
    clean = lambda v: NOT_WILDY.sub(" ", re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v or ""))
    loc = clean(p.get("Location", ""))
    where = clean(" ".join(p.get(f, "") for f in ("Activity", "Location", "Other", "Details", "Item")))
    m = re.search(r"wilderness", loc, re.I) or re.fullmatch(r"\s*resource area\s*", loc, re.I)
    if m:
        return " ".join(loc.split())[:160]
    m = WILDY_TEXT.search(where)
    return " ".join(where[max(0, m.start() - 60): m.end() + 60].split()) if m else None


def load(p):
    return json.loads((ROOT / p).read_text(encoding="utf-8"))


def main():
    pages = load("scripts/cache/guide_pages.json")
    titles = load("scripts/cache/guide_titles.json")
    items_doc, bosses_doc = load("data/items.json"), load("data/bosses.json")
    items = items_doc["items"]
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

    def key_for(name):
        k = by_name.get(name.lower())
        if k:
            return k
        i = mapping.get(name.lower())
        if i is None:
            return None
        k = str(i)
        if k in items:                      # same item under another name (e.g. renamed): alias it
            if name.lower() != items[k]["name"].lower():
                items[k].setdefault("aliases", [])
                if name not in items[k]["aliases"]:
                    items[k]["aliases"].append(name)
            by_name[name.lower()] = k
            return k
        price = latest_price(k)
        if price is None:
            return None
        items[k] = {"name": name, "price": price, "tradeable": True, "id": i}
        by_name[name.lower()] = k
        added[k] = name
        return k

    imp.PRICE_OF = lambda name: (lambda k: items[k]["price"] if k else None)(key_for(name))

    # Guides already used by bosses (setups or requirements) aren't methods
    used = {s.get("guide") for b in bosses_doc["bosses"] for s in b["setups"]}
    used |= set(req.REQUIREMENTS_FROM.values())
    # ...nor are other guides for those bosses (team sizes, contracts, raid levels we didn't use)
    boss_list = bosses_doc["bosses"] + [nb for nb in imp.NEW_BOSSES if all(b["id"] != nb["id"] for b in bosses_doc["bosses"])]
    for ts in imp.match_guides(boss_list, titles).values():
        used |= set(ts)
    quests = load("data/quests.json")
    items_by_name = {it["name"].lower() for it in items.values()}

    methods, skipped = [], []
    for title in sorted(titles):
        if title in used or title not in pages:
            continue
        text = pages[title]
        if "{{disambig" in text.lower():
            continue
        g = imp.parse_guide(text)
        p = g["params"]
        if not p:
            skipped.append((title, "no Mmgtable")); continue
        kph = g["kph"]
        per_kill = imp.is_yes(p.get("isperkill"))
        problems = []

        def per_hour(lines, what):
            out = []
            for ln in lines:
                if what == "input" and imp.EXCLUDE_SUPPLY.search(ln["name"]):
                    continue
                q = ln["qtyRaw"]
                if q is None:
                    problems.append(f"{what} '{ln['name']}': quantity uses a Wiki-only formula"); continue
                if not ln["perHour"]:
                    if not kph:
                        problems.append(f"{what} '{ln['name']}': per action but no actions per hour"); continue
                    q *= kph
                key = None if ln["isTemplate"] else key_for(ln["name"])
                if key and key in items and ln["value"] is None:
                    out.append({"item": key, "qty": round(q, 6)})
                elif ln["value"] is not None:
                    out.append({"item": "gp:" + ln["name"], "label": ln["name"], "gp": ln["value"], "qty": round(q, 6)})
                else:
                    problems.append(f"{what} '{ln['name']}': not a known item and no value given")
            return out

        inputs, outputs = per_hour(g["inputs"], "input"), per_hour(g["outputs"], "output")
        if not outputs:
            problems.append("no priced outputs")
        out_problems = [x for x in problems if x.startswith("output") or x == "no priced outputs"]
        if out_problems:
            skipped.append((title, "; ".join(out_problems[:3]))); continue

        xp = {}
        for k, v in p.items():
            m = re.fullmatch(r"Experience(\d+)", k)
            if m and v.strip():
                n = imp.number(p.get(f"Experience{m.group(1)}num"), imp.page_variables(text))
                skill = imp.strip_links(v).strip().title()
                if n is not None and skill in req.SKILLS:
                    xp[skill] = xp.get(skill, 0) + n * (kph if per_kill and kph else 1)

        reqs = req.skill_reqs(p.get("Skill", ""))
        qreqs, _ = req.quest_reqs(p.get("Quest", ""), items_by_name)
        for q in qreqs:
            quests["quests"].setdefault(q["quest"], {"name": q["_name"]})
            q.pop("_name", None)
        seen = set()
        qreqs = [q for q in qreqs if not (q["quest"] in seen or seen.add(q["quest"]))]
        all_reqs = reqs + qreqs

        wild_note = wilderness_note(p)
        category = imp.strip_links(p.get("Category", "")).strip()
        name = title[len(imp.PREFIX):]
        methods.append({
            "id": re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_"),
            "name": name,
            "guide": title,
            "category": category,
            "members": not p.get("Members", "").strip().lower().startswith("n"),
            "intensity": imp.strip_links(p.get("Intensity", "")).strip() or None,
            "recurring": bool(RECURRING.search(category)),
            "wilderness": bool(wild_note),
            "wildernessNote": wild_note,
            "actionsPerHr": kph, "actionName": p.get("kph name") or None,
            "inputsPerHr": inputs, "outputsPerHr": outputs,
            "xpPerHr": {k: round(v) for k, v in xp.items()},
            "requires": {"all": all_reqs} if all_reqs else None,
            "notes": [x for x in problems],           # unpriced inputs: cost is understated
        })

    # Bosses: the Wilderness bosses (their guides usually name the lair, not the Wilderness),
    # plus any whose guide puts them there
    for b in bosses_doc["bosses"]:
        notes = [wilderness_note(imp.template_params(pages[s["guide"]])) for s in b["setups"] if s.get("guide") in pages]
        notes = [n for n in notes if n] or (["Wilderness boss"] if b["id"] in WILDERNESS_BOSSES else [])
        b["wilderness"] = bool(notes)
        if notes:
            b["wildernessNote"] = notes[0]
        else:
            b.pop("wildernessNote", None)
    (ROOT / "data/bosses.json").write_text(json.dumps(bosses_doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    out = {"meta": {"description": "Money-making methods from the Wiki guides that aren't boss setups. "
                                   "Inputs/outputs are per hour; GP/hr is worked out from current prices. "
                                   "Built by scripts/apply_methods.py.",
                    "wilderness": "wilderness: true when the guide's activity, location or notes mention the Wilderness."},
           "methods": methods}
    (ROOT / "data/methods.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (ROOT / "data/items.json").write_text(json.dumps(items_doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    quests["quests"] = dict(sorted(quests["quests"].items(), key=lambda kv: kv[1]["name"]))
    (ROOT / "data/quests.json").write_text(json.dumps(quests, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    md = ["# Methods review", "", f"{len(methods)} methods built, {len(skipped)} guides skipped.", "",
          "## Wilderness", ""] + [f"- {m['name']}: “{m['wildernessNote']}”" for m in methods if m["wilderness"]] + \
         ["", "## Skipped", ""] + [f"- {t[len(imp.PREFIX):]}: {why}" for t, why in skipped]
    (HERE / "out").mkdir(exist_ok=True)
    (HERE / "out/methods_review.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"Done. {len(methods)} methods ({sum(m['wilderness'] for m in methods)} Wilderness), "
          f"{len(skipped)} skipped, {len(added)} items added.")


if __name__ == "__main__":
    main()
