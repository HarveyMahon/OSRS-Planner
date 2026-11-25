"""Fetch the lead text of every equipment page on the OSRS Wiki and pull out the levels needed to wear it
("requires a Ranged level of 85 to wield", "requires 70 Attack and 70 Defence to wear", {{SCP|Defence|70}}...).
Writes scripts/cache/dps/requirements_raw.json: {page: {"text": lead sentences with 'wield/wear/equip', "reqs": {Skill: level}}}.
Run by the "Fetch gear requirements" workflow.
"""
import json, os, re, time, urllib.parse, urllib.request
print("Gear requirements fetch started...", flush=True)
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "cache", "dps")
API = "https://oldschool.runescape.wiki/api.php"
UA = "OSRS Planner - DPS data import (github.com/HarveyMahon/OSRS-Planner; Discord: Adamolf#7451)"
SKILLS = ["Attack", "Strength", "Defence", "Ranged", "Magic", "Prayer", "Hitpoints", "Slayer", "Agility", "Herblore", "Thieving",
          "Crafting", "Fletching", "Mining", "Smithing", "Fishing", "Cooking", "Firemaking", "Woodcutting", "Runecraft", "Hunter",
          "Construction", "Farming", "Sailing"]
SK = "|".join(SKILLS)
def get(p):
    with urllib.request.urlopen(urllib.request.Request(API + "?" + urllib.parse.urlencode(p), headers={"User-Agent": UA}), timeout=120) as r:
        return json.loads(r.read().decode())
pages = sorted({r["page_name"] for r in json.load(open(os.path.join(OUT, "equipment_raw.json"))) if r.get("page_name")})
print(len(pages), "pages", flush=True)
PATS = [
    re.compile(r"\{\{SCP\|(" + SK + r")\|(\d+)"),
    re.compile(r"\[\[(" + SK + r")\]\] level of (\d+)", re.I),
    re.compile(r"(\d+) \[\[(" + SK + r")\]\]", re.I),
    re.compile(r"level (\d+) (?:in )?\[\[(" + SK + r")\]\]", re.I),
    re.compile(r"level[- ](\d+) (" + SK + r")\b"),
    re.compile(r"(\d+) (" + SK + r")\b"),
]
def reqs_of(text):
    out = {}
    lead = text.split("\n==", 1)[0]
    lead = re.sub(r"\{\{Infobox[\s\S]*?\n\}\}", "", lead)
    sents = [s for s in re.split(r"(?<=[.!?])\s+|\n", lead) if re.search(r"\b(wield|wear|equip)", s, re.I) and re.search(r"requir|need", s, re.I)]
    for s in sents:
        for p in PATS:
            for m in p.finditer(s):
                a, b = m.groups()
                lvl, sk = (int(a), b) if a.isdigit() else (int(b), a)
                sk = sk[:1].upper() + sk[1:].lower()
                if 1 < lvl <= 99 and sk in SKILLS: out[sk] = max(out.get(sk, 0), lvl)
    return out, sents
res = {}
for i in range(0, len(pages), 50):
    batch = pages[i:i + 50]
    d = get({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main", "titles": "|".join(batch), "format": "json", "formatversion": 2, "redirects": 1})
    for pg in d.get("query", {}).get("pages", []):
        try: text = pg["revisions"][0]["slots"]["main"]["content"]
        except (KeyError, IndexError): continue
        reqs, sents = reqs_of(text)
        res[pg["title"]] = {"reqs": reqs, "text": " | ".join(sents)[:600]}
    for r in d.get("query", {}).get("redirects", []):
        if r["to"] in res: res[r["from"]] = res[r["to"]]
    print(f"  {min(i + 50, len(pages))}/{len(pages)}", flush=True); time.sleep(1)
json.dump(res, open(os.path.join(OUT, "requirements_raw.json"), "w"), indent=0, ensure_ascii=False)
print("Done:", sum(1 for v in res.values() if v["reqs"]), "pages with requirements")
