#!/usr/bin/env python3
"""
Set each setup's requirements from its Wiki money-making guide (offline, from scripts/cache/).

    python scripts/apply_requirements.py

* Skills: every {{SCP|Skill|N}} in the guide's Skill field, recommended or required (site
  owner's choice for now). "A or B" on one line becomes an either-or. {{SCP|Combat|N}} is a
  combat level. Skills with no level are ignored.
* Quests: links in the guide's Quest field, except on lines that are optional ("if you",
  "optional", "recommended"...) and links that aren't quests (items, regions, prayers, diaries,
  bosses; see NOT_QUESTS).
* Writes data/quests.json (every quest referenced) and scripts/out/requirements_review.md.
Re-running is safe: requirements are rebuilt from the guides each time.
"""
import json
import re
from pathlib import Path

print("Apply requirements started...", flush=True)

HERE = Path(__file__).parent
ROOT = HERE.parent
import importlib.util, sys
sys.argv = sys.argv[:1]
spec = importlib.util.spec_from_file_location("imp", HERE / "import_supplies.py")
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)

SKILLS = ["Attack", "Hitpoints", "Mining", "Strength", "Agility", "Smithing", "Defence", "Herblore",
          "Fishing", "Ranged", "Thieving", "Cooking", "Prayer", "Crafting", "Firemaking", "Magic",
          "Fletching", "Woodcutting", "Runecraft", "Slayer", "Farming", "Construction", "Hunter", "Sailing"]
OPTIONAL = re.compile(r"\bif you\b|optional|recommended|not required|faster|alternatively|\bor\b.*\binstead\b", re.I)
# Links in Quest fields that aren't quests
NOT_QUESTS = {"morytania", "varlamore", "wyrmscraig", "vampyrium", "waterbirth island", "dad", "piety", "royal seed pod",
              "miniquest", "ancient magicks", "elite void knight equipment", "crystal halberd",
              "easy combat achievements", "western_provinces_diary", "hard kandarin diary"}

# Bosses whose only guide covers more than them: take its requirements, not its rate or supplies
REQUIREMENTS_FROM = {
    "dagannoth_prime": "Money making guide/Killing Dagannoth Kings (Solo tribrid)",
    "dagannoth_supreme": "Money making guide/Killing Dagannoth Kings (Solo tribrid)",
}

# Bosses with no Wiki guide: entered by hand (site owner asked; levels are the usual recommendations)
MANUAL = {
    "tztok_jad": {"requires": [{"skill": "Prayer", "level": 43}, {"skill": "Ranged", "level": 70}],
                  "source": "Entered by hand: protection prayers, usual Ranged recommendation"},
    "tzkal_zuk": {"requires": [{"item": "x-fire-cape"}, {"skill": "Ranged", "level": 90}, {"skill": "Defence", "level": 75},
                               {"skill": "Hitpoints", "level": 90}, {"skill": "Prayer", "level": 77}],
                  "source": "Entered by hand: Fire cape to enter; usual recommended levels"},
}

slug = lambda s: re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def skill_reqs(field):
    reqs = []
    for line in field.split("\n"):
        found = []
        for args in re.findall(r"\{\{\s*SCP\s*\|([^}]*)\}\}", line):
            a = [x.strip() for x in args.split("|")]
            m = re.match(r"(\d+)", a[1]) if len(a) > 1 else None
            if not m:
                continue
            lvl = int(m.group(1))
            if a[0].lower() == "combat":
                found.append({"combatLevel": lvl})
            elif a[0].title() in SKILLS or a[0] in SKILLS:
                found.append({"skill": a[0] if a[0] in SKILLS else a[0].title(), "level": lvl})
        if len(found) > 1 and re.search(r"\}\}\s*or\s*\{\{", line, re.I):
            reqs.append({"any": found})
        else:
            reqs += found
    # The same skill listed twice (e.g. Prayer 43 and Prayer 70): keep the higher level
    best = {}
    for r in reqs:
        k = r.get("skill") or ("combat" if "combatLevel" in r else None)
        if k is None:
            continue
        lvl = r.get("level", r.get("combatLevel"))
        if k not in best or lvl > best[k].get("level", best[k].get("combatLevel")):
            best[k] = r
    return [r for r in reqs if "any" in r or best.get(r.get("skill") or "combat") is r]


def quest_reqs(field, items_by_name):
    reqs, skipped = [], []
    for line in field.split("\n"):
        links = re.findall(r"\[\[([^\]|#]+)", line)
        if not links:
            continue
        if OPTIONAL.search(line):
            skipped += [f"{l} (optional: “{line.strip()[:70]}”)" for l in links]
            continue
        for l in links:
            name = l.strip()
            if name.lower() in NOT_QUESTS or name.lower() in items_by_name:
                skipped.append(f"{name} (not a quest)")
                continue
            reqs.append({"quest": slug(name), "_name": name})
    return reqs, skipped


def main():
    pages = json.loads((HERE / "cache/guide_pages.json").read_text(encoding="utf-8"))
    items = json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))["items"]
    items_by_name = {it["name"].lower() for it in items.values()}
    doc = json.loads((ROOT / "data/bosses.json").read_text(encoding="utf-8"))
    quests_path = ROOT / "data/quests.json"
    quests_doc = json.loads(quests_path.read_text(encoding="utf-8")) if quests_path.exists() else \
        {"meta": {"description": "Quests the app knows. Milestones (partial completion steps) are curated by hand."}, "quests": {}}
    # Rebuilt from the guides each run; entries that are kept keep any hand-curated fields
    old_quests, quests_doc["quests"] = quests_doc["quests"], {}
    md = ["# Requirements review", "", "From each setup's Wiki guide. Skill levels include recommended ones (for now).", ""]
    for b in doc["bosses"]:
        if b["id"] in MANUAL:
            for s in b["setups"]:
                s["requires"] = {"all": MANUAL[b["id"]]["requires"]}
                s["requiresSource"] = MANUAL[b["id"]]["source"]
            md.append(f"**{b['name']}**: entered by hand")
            continue
        for s in b["setups"]:
            guide = s.get("guide") or REQUIREMENTS_FROM.get(b["id"])
            if not guide or guide not in pages:
                continue
            p = imp.template_params(pages[guide])
            reqs = skill_reqs(p.get("Skill", ""))
            qreqs, skipped = quest_reqs(p.get("Quest", ""), items_by_name)
            for q in qreqs:
                quests_doc["quests"].setdefault(q["quest"], old_quests.get(q["quest"]) or {"name": q["_name"]})
                q.pop("_name", None)
            # one entry per quest
            seen = set()
            qreqs = [q for q in qreqs if not (q["quest"] in seen or seen.add(q["quest"]))]
            all_reqs = reqs + qreqs
            s["requires"] = {"all": all_reqs} if all_reqs else None
            s["requiresSource"] = f"Wiki: {guide[len(imp.PREFIX):]} (recommended levels included)"
            def show(r):
                if "any" in r: return " or ".join(show(x) for x in r["any"])
                if "skill" in r: return f"{r['skill']} {r['level']}"
                if "combatLevel" in r: return f"Combat {r['combatLevel']}"
                return quests_doc["quests"][r["quest"]]["name"]
            md.append(f"**{b['name']} · {s['label']}**: " + (", ".join(show(r) for r in all_reqs) or "none"))
            md += [f"- skipped {x}" for x in skipped]
    (ROOT / "data/bosses.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    quests_doc["quests"] = dict(sorted(quests_doc["quests"].items(), key=lambda kv: kv[1]["name"]))
    quests_path.write_text(json.dumps(quests_doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (HERE / "out").mkdir(exist_ok=True)
    (HERE / "out/requirements_review.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"Done. {len(quests_doc['quests'])} quests referenced. Review: scripts/out/requirements_review.md")


if __name__ == "__main__":
    main()
