#!/usr/bin/env python3
"""
Import quest requirements from the OSRS Wiki into data/quests.json.

    python scripts/import_quests.py            fetch (if not cached) and parse
    python scripts/import_quests.py --refetch  ignore the cache

Gentle on the Wiki: lists Category:Quests and Category:Miniquests (1 request each), then
fetches page wikitext 50 pages per request (about 4-5). Everything is cached in scripts/cache/
so parsing can be fixed and re-run offline.

From each quest's {{Quest details}} "requirements" it takes:
  * skill levels ({{SCP|Skill|N}}), marked boostable when the line says so
  * quest points ({{SCP|Quest|N}}) and combat level ({{SCP|Combat|N}})
  * prerequisite quests: links to other pages in the quest lists
and quest points awarded from {{Quest rewards}} (qp =).
Existing hand-curated fields in data/quests.json (e.g. milestones) are kept.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

print("Quest import started...", flush=True)

HERE = Path(__file__).parent
ROOT = HERE.parent
CACHE = HERE / "cache"
API = "https://oldschool.runescape.wiki/api.php"
USER_AGENT = "OSRS Planner - quest import (github.com/HarveyMahon/OSRS-Planner; Discord: Adamolf#7451)"
SKILLS = ["Attack", "Hitpoints", "Mining", "Strength", "Agility", "Smithing", "Defence", "Herblore",
          "Fishing", "Ranged", "Thieving", "Cooking", "Prayer", "Crafting", "Firemaking", "Magic",
          "Fletching", "Woodcutting", "Runecraft", "Slayer", "Farming", "Construction", "Hunter", "Sailing"]
requests_made = 0


def api(params):
    global requests_made
    if requests_made:
        time.sleep(1)
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    requests_made += 1
    print(f"  request {requests_made}: {params.get('list') or params.get('prop')} {params.get('cmtitle', '')}", flush=True)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=60) as r:
        return json.load(r)


def members(category):
    out, cont = [], {}
    while True:
        d = api({"action": "query", "list": "categorymembers", "cmtitle": category, "cmnamespace": 0, "cmlimit": 500, **cont})
        out += [m["title"] for m in d["query"]["categorymembers"]]
        if "continue" not in d:
            return out
        cont = {"cmcontinue": d["continue"]["cmcontinue"], "continue": d["continue"]["continue"]}


def fetch_pages(titles):
    pages = {}
    for i in range(0, len(titles), 50):
        d = api({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main", "redirects": 1,
                 "titles": "|".join(titles[i:i + 50])})
        for p in d["query"]["pages"]:
            if p.get("revisions"):
                pages[p["title"]] = p["revisions"][0]["slots"]["main"]["content"]
    return pages


def cached(name, fetch, refetch):
    path = CACHE / name
    if path.exists() and not refetch:
        return json.loads(path.read_text(encoding="utf-8"))
    data = fetch()
    CACHE.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return data


def template_param(text, template, param):
    """Value of |param= in the first {{template ...}} call, brace-aware."""
    m = re.search(r"\{\{\s*" + re.escape(template) + r"\b", text, re.I)
    if not m:
        return None
    i, depth, buf, parts = m.end(), 1, "", []
    while i < len(text) and depth:
        two = text[i:i + 2]
        if two in ("{{", "[["):
            depth += 1; buf += two; i += 2; continue
        if two in ("}}", "]]"):
            depth -= 1
            if depth == 0:
                break
            buf += two; i += 2; continue
        if text[i] == "|" and depth == 1:
            parts.append(buf); buf = ""; i += 1; continue
        buf += text[i]; i += 1
    parts.append(buf)
    for p in parts:
        if "=" in p and p.split("=", 1)[0].strip().lower() == param:
            return p.split("=", 1)[1].strip()
    return None


slug = lambda s: re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def parse(text, quest_names):
    req = template_param(text, "Quest details", "requirements") or ""
    skills, quests, qp, combat = {}, [], None, None
    notes, alternatives = [], []
    for line in req.split("\n"):
        scps = re.findall(r"\{\{\s*SCP\s*\|([^}]*)\}\}", line)
        if re.search(r"\bsum\b|combined", line, re.I) and len(scps) > 1:
            notes.append(re.sub(r"\{\{[^}]*\}\}|\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", lambda m: m.group(1) or "", line).strip(" *"))
            scps = []            # e.g. Warriors' Guild: Attack + Strength >= 130 (can't be represented)
        elif len(scps) > 1 and re.search(r"\}\}\s*,?\s*or\s*\{\{|\bOR\b", line):
            alt = []
            for args in scps:
                a = [x.strip() for x in args.split("|")]
                m = re.match(r"(\d+)", a[1]) if len(a) > 1 else None
                sk = next((x for x in SKILLS if x.lower() == a[0].lower()), None)
                if m and sk:
                    alt.append({"skill": sk, "level": int(m.group(1))})
            if alt:
                alternatives.append({"any": alt})
            scps = []
        for args in scps:
            a = [x.strip() for x in args.split("|")]
            m = re.match(r"(\d+)", a[1]) if len(a) > 1 else None
            if not m:
                continue
            n, name = int(m.group(1)), a[0].lower()
            if name in ("quest", "quests", "quest points"):
                qp = max(qp or 0, n)
            elif name == "combat":
                combat = max(combat or 0, n)
            else:
                sk = next((s for s in SKILLS if s.lower() == name), None)
                if sk:
                    boost = bool(re.search(r"\{\{\s*boostable\s*\|\s*yes", line, re.I))
                    if sk not in skills or n > skills[sk]["level"]:
                        skills[sk] = {"level": n, "boostable": boost}
        for link in re.findall(r"\[\[([^\]|#]+)", line):
            t = link.strip()
            if t in quest_names and t not in quests:
                quests.append(t)
    rewards_qp = template_param(text, "Quest rewards", "qp")
    m = re.match(r"\s*(\d+)", rewards_qp or "")
    return skills, quests, qp, combat, int(m.group(1)) if m else None, alternatives, notes


def main():
    refetch = "--refetch" in sys.argv
    quests = cached("quest_titles.json", lambda: {"quests": members("Category:Quests"), "miniquests": members("Category:Miniquests")}, refetch)
    titles = sorted(set(quests["quests"]) | set(quests["miniquests"]))
    pages = cached("quest_pages.json", lambda: fetch_pages(titles), refetch)
    names = {t for t in titles if "/Quick guide" not in t and t not in ("Quest points", "Miniquests", "Quests")}
    path = ROOT / "data/quests.json"
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"meta": {}, "quests": {}}
    # Rebuilt from the Wiki's quest lists each run; hand-curated fields (milestones) are kept
    doc = {"meta": old.get("meta", {}), "quests": {}}
    by_name = {}
    parsed, no_details = 0, []
    for t in titles:
        text = pages.get(t)
        if not text or not re.search(r"\{\{\s*Infobox (Quest|Miniquest)", text, re.I):
            continue                     # list pages, quick guides etc. in the categories
        skills, prereqs, qp, combat, reward_qp, alternatives, notes = parse(text, names - {t})
        if not re.search(r"\{\{\s*Quest details", text, re.I):
            no_details.append(t)
        qid = slug(t)
        q = doc["quests"].setdefault(qid, {k: v for k, v in old["quests"].get(qid, {}).items() if k in ("milestones",)})
        q["name"] = t
        q["miniquest"] = t in quests["miniquests"] and t not in quests["quests"]
        reqs = [{"skill": s, "level": v["level"], **({"boostable": True} if v["boostable"] else {})} for s, v in skills.items()]
        reqs += alternatives
        reqs += [{"quest": slug(p)} for p in prereqs]
        if qp: reqs.append({"questPoints": qp})
        if combat: reqs.append({"combatLevel": combat})
        q["requires"] = {"all": reqs} if reqs else None
        if reward_qp is not None:
            q["questPoints"] = reward_qp
        length = re.sub(r"<[^>]+>|\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", lambda m: m.group(1) or "", template_param(text, "Quest details", "length") or "").strip()
        if length:
            q["length"] = length.split("\n")[0][:40]
        if notes:
            q["requirementNotes"] = notes
        parsed += 1
    doc["quests"] = dict(sorted(doc["quests"].items(), key=lambda kv: kv[1]["name"]))
    doc["meta"]["description"] = ("Quests and miniquests with their requirements (skills, prerequisite quests, quest points, "
                                  "combat level) and quest points awarded, from the Wiki's Quest details. Imported by "
                                  "scripts/import_quests.py; milestones are curated by hand.")
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Done. {requests_made} Wiki requests. {parsed} quests parsed ({len(no_details)} without a Quest details box).")
    if no_details:
        print("No Quest details:", ", ".join(no_details[:30]))


if __name__ == "__main__":
    main()
