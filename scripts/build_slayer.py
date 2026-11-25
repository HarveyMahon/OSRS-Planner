"""Build data/slayer.json from the fetched sources (scripts/cache/slayer, see fetch_slayer_sources.py).

  * Task rates and methods: KodakKid3's OSRS Slayer Spreadsheets v3.8.2 ("Mob Data" tab): per task variant
    (location / method) the Slayer XP per kill, GP per kill, kills per hour, travel time and kills per trip.
  * Task weights, amounts and the sheet's example Do/Skip/Block lists: the sheet's per-master tabs and
    "Task Lengths" tab.
  * Task requirements (Slayer level, combat level, quests, unlocks): the Wiki's "Slayer task" list.
  * Masters' own requirements, points and block costs: the Wiki's "Slayer Master" page (typed in below).
"""
import csv, json, os, re
print("Slayer build started...", flush=True)
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(HERE, "cache", "slayer")
ROOT = os.path.dirname(HERE)
rows = lambda f: list(csv.reader(open(os.path.join(SRC, f), encoding="utf-8")))
num = lambda s: float(s.replace(",", "").replace("%", "")) if re.match(r"^-?[\d,.]+%?$", (s or "").strip()) else None
def norm(n):
    n = n.lower().replace("abberant", "aberrant").replace("'", "")
    n = re.sub(r"[^a-z ]", "", n).strip()
    n = re.sub(r"(ies)$", "y", n); n = re.sub(r"(s)$", "", n)
    return n.replace(" ", "")
quests = json.load(open(os.path.join(ROOT, "data", "quests.json")))["quests"]
qbyname = {re.sub(r"[^a-z0-9]", "", q["name"].lower()): k for k, q in quests.items()}

# ---- masters (Wiki: Slayer Master) ----
STREAK = [10, 50, 100, 250, 1000]
MASTERS = {
 "turael":   dict(name="Turael", combat=0, slayer=1, quests=[], points=0, bonus=[0]*5, block=40, sheet="Turael/Spria"),
 "mazchna":  dict(name="Mazchna", combat=20, slayer=1, quests=["priest_in_peril"], points=6, bonus=[30,90,150,210,300], block=50, sheet="Mazchna"),
 "vannaka":  dict(name="Vannaka", combat=40, slayer=1, quests=[], points=8, bonus=[40,120,200,280,400], block=60, sheet="Vannaka"),
 "chaeldar": dict(name="Chaeldar", combat=70, slayer=1, quests=["lost_city"], points=10, bonus=[50,150,250,350,500], block=70, sheet="Chaeldar"),
 "konar":    dict(name="Konar quo Maten", combat=75, slayer=1, quests=[], points=18, bonus=[90,270,450,630,900], block=80, sheet="Konar",
                  diary={"key": "kourendElite", "label": "Elite Kourend & Kebos diary", "points": 20, "bonus": [100,300,500,700,1000]}, gpColumn="konar",
                  note="Assigns a location as well as a monster; her tasks drop brimstone keys."),
 "nieve":    dict(name="Nieve", combat=85, slayer=1, quests=[], points=12, bonus=[60,180,300,420,600], block=90, sheet="Nieve",
                  diary={"key": "westernElite", "label": "Elite Western Provinces diary", "points": 15, "bonus": [75,225,375,525,750]}),
 "duradel":  dict(name="Duradel", combat=100, slayer=50, quests=["shilo_village"], points=15, bonus=[75,225,375,525,750], block=100, sheet="Duradel"),
 "krystilia":dict(name="Krystilia", combat=0, slayer=1, quests=[], points=25, bonus=[125,375,625,875,1250], block=100, sheet="Krystilia", wilderness=True,
                  gpColumn="krystilia", note="All tasks are in the Wilderness; her tasks drop Larran's keys."),
}
for k, m in MASTERS.items():
    m["quests"] = [q for q in m["quests"] if q in quests] or m["quests"]

# ---- task requirements (Wiki: Slayer task list) ----
wt = open(os.path.join(SRC, "wiki_slayer_task.txt"), encoding="utf-8").read()
lst = wt[wt.index("==List of assignments=="):]
reqs = {}
for block in lst.split("\n|-"):
    m = re.search(r"\n\|(\d+)\s*\n\|\[\[Slayer task/([^|\]]+)\|?([^\]]*)\]\]", "\n" + block.strip())
    if not m: continue
    lvl, page = int(m.group(1)), m.group(2)
    r = {"slayer": lvl}
    cb = re.search(r"\{\{SCP\|Combat\|(\d+)\}\}", block)
    if cb: r["combat"] = int(cb.group(1))
    other = [l for l in block.split("\n") if "{{SCP|Quest}}" in l]
    qs = []
    for l in other:
        alts = [qbyname.get(re.sub(r"[^a-z0-9]", "", x.lower())) for x in re.findall(r"\[\[([^\]|]+)", l)]
        alts = [a for a in alts if a]
        if alts: qs.append(alts)                      # "A or B" -> any of
    if qs: r["quests"] = qs
    un = re.search(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*unlocked", block)
    if un: r["unlock"] = un.group(1)
    for skill in ("Agility", "Magic", "Sailing", "Firemaking", "Ranged", "Strength", "Defence", "Hitpoints"):
        s = re.search(r"\{\{SCP\|%s\|(\d+)\}\}" % skill, block)
        if s: r.setdefault("skills", {})[skill] = int(s.group(1))
    reqs[norm(page)] = r

# ---- variants (sheet: Mob Data) ----
BOSSES = {norm(b["name"]) for b in json.load(open(os.path.join(ROOT, "data", "bosses.json")))["bosses"]} | {norm(x) for x in
          ("Inferno", "Fight Caves", "TzHaar-Ket-Rak", "Alchemical Hydra", "Cerberus", "Araxxor", "Kraken", "Thermonuclear smoke devil", "Grotesque Guardians", "Abyssal Sire", "Skotizo", "Vorkath", "Dagannoth Kings")}
mob = rows("sheet_mob_data.csv")
H = mob[0]; ix = {h: i for i, h in enumerate(H)}
variants = {}
for r in mob[1:]:
    task, name = r[0].strip(), r[1].strip()
    if not task or not name: continue
    kph, xpk = num(r[ix["Raw Kills/Hour"]]), num(r[ix["XP/Kill"]])
    q = num(r[ix["Data Quality"]]) or 0
    if not kph or not xpk or q == 0: continue
    low = name.lower(); note = r[ix["Notes About Data"]].strip()
    style = "magic" if "barrage" in low or "burst" in low else "ranged" if "venator" in low or "range" in low else "melee"
    v = {"name": name, "xpPerKill": xpk, "killsPerHr": kph, "gpPerKill": num(r[ix["GP/Kill"]]) or 0,
         "gpPerKillKonar": num(r[ix["GP/Kill (Konar)"]]), "gpPerKillKrystilia": num(r[ix["GP/Kill (Krystilia)"]]),
         "travel": num(r[ix["Travel Time"]]) or 0, "killsPerTrip": num(r[ix["Kills/Trip"]]), "quality": q, "style": style}
    if style == "magic": v["needs"] = {"skills": {"Magic": 70}, "quests": [["desert_treasure_i"]]}   # Ice Burst at 70, Barrage at 94
    if "cannon" in (low + " " + note.lower()): v["cannon"] = True
    if "wild" in low: v["wilderness"] = True
    # The sheet's GP for a few variants is far off (e.g. bronze and iron dragons at ~160-290K a kill, from a
    # broken price): drop GP figures that would be over 8M an hour for a normal task monster
    for col in ("gpPerKill", "gpPerKillKonar", "gpPerKillKrystilia"):
        if v.get(col) and v[col] * kph > 8e6 and not (norm(name) in BOSSES):
            v[col] = 0; v["gpDropped"] = True
    if norm(name) in BOSSES or any(norm(name).startswith(b) for b in BOSSES if len(b) > 6): v["boss"] = True   # e.g. Abyssal Sire on an abyssal demon task
    if note: v["note"] = note
    variants.setdefault(norm(task), []).append(v)

# ---- per-master task lists (sheet tabs + Task Lengths) ----
tl = rows("sheet_task_lengths.csv"); lengths = {}
for r in tl[1:]:
    for col, master in ((0, "duradel"), (5, "konar"), (11, "nieve"), (16, "krystilia")):
        name = r[col].strip()
        if not name: continue
        off = 2 if master == "konar" else 1
        mn, mx, emn, emx = (num(r[col + off + i]) for i in range(4))
        key = (master, name, r[col + 1].strip() if master == "konar" else "")
        lengths[key] = {"amount": [mn, mx], **({"extended": [emn, emx]} if emn else {})}
out_masters = {}
for mid, m in MASTERS.items():
    tab = rows("sheet_" + re.sub(r"[^a-z0-9]+", "_", m["sheet"].lower()).strip("_") + ".csv")
    hd = tab[0]; c = {h: i for i, h in enumerate(hd)}
    tasks = []
    for r in tab[1:]:
        name = r[0].strip()
        if not name or re.search(r"weight|ratio|total|per hour|percentage", name, re.I): continue
        w = num(r[c["Weight"]]) if "Weight" in c else None
        if not w: continue                         # weight 0 = the sheet's "Like a Boss" boss list
        loc = r[c["Location"]].strip() if "Location" in c else ""
        action = (r[c.get("Action", c.get("Do/Skip/Block", 3))] or "").strip().lower()
        ext = r[c.get("Extend", c.get("Extension", 4))].strip().upper() == "TRUE"
        t = {"task": name, "key": norm(name), "weight": w}
        if loc: t["location"] = loc
        ln = lengths.get((mid, name, loc))
        if ln: t.update(ln)
        elif "Min" in c and num(r[c["Min"]]) is not None:
            t["amount"] = [num(r[c["Min"]]), num(r[c["Max"]])]
            if num(r[c["eMin"]]): t["extended"] = [num(r[c["eMin"]]), num(r[c["eMax"]])]
        elif "Avg Task Length" in c and num(r[c["Avg Task Length"]]):
            a = num(r[c["Avg Task Length"]]); t["amount"] = [a, a]
        if "Variant" in c and r[c["Variant"]].strip(): t["sheetVariant"] = r[c["Variant"]].strip()
        t["sheet"] = {"action": action if action in ("do", "skip", "block", "locked") else "do", "extend": ext}
        rq = reqs.get(norm(name)) or reqs.get(norm(name + "s"))
        if rq: t["requires"] = rq
        tasks.append(t)
    out_masters[mid] = {k: v for k, v in m.items() if k != "sheet"} | {"tasks": tasks}
    print(f"  {m['name']}: {len(tasks)} tasks, {sum(1 for t in tasks if t['key'] in variants)} with rate data, "
          f"{sum(1 for t in tasks if 'requires' in t)} with requirements", flush=True)

data = {"meta": {
    "source": "Task rates, methods, weights and lengths: KodakKid3's OSRS Slayer Spreadsheets v3.8.2 (https://docs.google.com/spreadsheets/d/1KR92OY-sK6I8wAAuFLt2TgLq-xadG7yA6Bzgb5YnVQM). Requirements and masters: OSRS Wiki (Slayer task, Slayer Master).",
    "credit": "KodakKid3", "streakEvery": STREAK, "secondsBetweenTasks": 80, "resupplySeconds": 25, "skipCost": 30},
    "masters": out_masters, "variants": variants}
json.dump(data, open(os.path.join(ROOT, "data", "slayer.json"), "w"), indent=1, ensure_ascii=False)
print(f"Wrote data/slayer.json: {len(out_masters)} masters, {len(variants)} tasks with rates.")
