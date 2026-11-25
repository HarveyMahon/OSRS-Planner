"""Fetch the Wiki categories of every equipment page (to leave out items that only work in minigames, Leagues,
Deadman, events and so on). Writes scripts/cache/dps/categories_raw.json: {page: [categories]}.
Run by the "Fetch gear categories" workflow.
"""
import json, os, time, urllib.parse, urllib.request
print("Gear categories fetch started...", flush=True)
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "cache", "dps")
API = "https://oldschool.runescape.wiki/api.php"
UA = "OSRS Planner - DPS data import (github.com/HarveyMahon/OSRS-Planner; Discord: Adamolf#7451)"
def get(p):
    with urllib.request.urlopen(urllib.request.Request(API + "?" + urllib.parse.urlencode(p), headers={"User-Agent": UA}), timeout=120) as r:
        return json.loads(r.read().decode())
pages = sorted({r["page_name"] for r in json.load(open(os.path.join(OUT, "equipment_raw.json"))) if r.get("page_name")})
res = {}
for i in range(0, len(pages), 50):
    batch = pages[i:i + 50]
    cont = {}
    while True:
        d = get({"action": "query", "prop": "categories", "cllimit": "max", "titles": "|".join(batch), "format": "json", "formatversion": 2, "redirects": 1, **cont})
        for pg in d.get("query", {}).get("pages", []):
            res.setdefault(pg["title"], []).extend(c["title"].replace("Category:", "") for c in pg.get("categories", []))
        for r in d.get("query", {}).get("redirects", []):
            res.setdefault(r["from"], res.get(r["to"], []))
        if "continue" not in d: break
        cont = d["continue"]
    print(f"  {min(i + 50, len(pages))}/{len(pages)}", flush=True); time.sleep(1)
json.dump(res, open(os.path.join(OUT, "categories_raw.json"), "w"), indent=0, ensure_ascii=False)
print("Done:", len(res))
