"""Fetch the raw sources for the Slayer tab into scripts/cache/slayer/ (no parsing here).

  * KodakKid3's OSRS Slayer Spreadsheets (v3.8.2): one CSV per tab, via Google Sheets' public CSV export.
  * The OSRS Wiki pages of each Slayer master (wikitext), for task weights, amounts and requirements.

Run by hand or by the "Fetch Slayer sources" workflow: python scripts/fetch_slayer_sources.py
About 20 requests in total, one at a time.
"""
import json, os, time, urllib.parse, urllib.request

print("Slayer source fetch started...", flush=True)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "cache", "slayer")
os.makedirs(OUT, exist_ok=True)
UA = "OSRS Planner - slayer import (github.com/HarveyMahon/OSRS-Planner; Discord: Adamolf#7451)"
SHEET = "1KR92OY-sK6I8wAAuFLt2TgLq-xadG7yA6Bzgb5YnVQM"
TABS = ["Configurations", "Mob Data", "Task Lengths", "Duradel", "Nieve", "Konar", "Krystilia", "Chaeldar", "Vannaka", "Mazchna", "Turael/Spria"]
MASTERS = ["Duradel", "Nieve", "Konar quo Maten", "Krystilia", "Chaeldar", "Vannaka", "Mazchna", "Turael", "Spria", "Mortimer", "Slayer task", "Slayer Master"]

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")

def slug(s): return "".join(c if c.isalnum() else "_" for c in s).strip("_").lower()

for tab in TABS:
    url = f"https://docs.google.com/spreadsheets/d/{SHEET}/gviz/tq?tqx=out:csv&sheet={urllib.parse.quote(tab)}"
    text = get(url)
    open(os.path.join(OUT, f"sheet_{slug(tab)}.csv"), "w", encoding="utf-8").write(text)
    print(f"  sheet {tab}: {len(text):,} chars", flush=True)
    time.sleep(1)

for page in MASTERS:
    url = "https://oldschool.runescape.wiki/api.php?" + urllib.parse.urlencode(
        {"action": "parse", "page": page, "prop": "wikitext", "format": "json", "redirects": 1})
    data = json.loads(get(url))
    text = data.get("parse", {}).get("wikitext", {}).get("*", "")
    open(os.path.join(OUT, f"wiki_{slug(page)}.txt"), "w", encoding="utf-8").write(text)
    print(f"  wiki {page}: {len(text):,} chars", flush=True)
    time.sleep(1)
print("Done.")
