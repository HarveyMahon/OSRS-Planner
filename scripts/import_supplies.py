#!/usr/bin/env python3
"""
Import boss supplies from the OSRS Wiki money-making guides, for review.

Writes a review file; it never changes data/bosses.json. Run on your own computer:

    python scripts/import_supplies.py            fetch (if not cached) and parse
    python scripts/import_supplies.py --refetch  ignore the cache and fetch again

Gentle on the Wiki:
  * Stage 1 lists every "Money making guide/..." page (1 request per 500 titles, about 2-3).
  * Stage 2 fetches the wikitext of the pages that match our bosses, 50 pages per request.
  * Both are cached in scripts/cache/ and reused on later runs, so the parser can be fixed
    and re-run without contacting the Wiki again.

Outputs (in scripts/out/):
  supplies_review.md    one table per boss: old flat cost vs the new item-based cost, with flags
  supplies_review.json  the proposed per-unit supply lists, keyed by boss id
  template_fields.txt   every template parameter name seen, to check the parser against
Needs only the Python standard library.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

print("Supply import started...", flush=True)

HERE = Path(__file__).parent
ROOT = HERE.parent
CACHE = HERE / "cache"
OUT = HERE / "out"
API = "https://oldschool.runescape.wiki/api.php"
USER_AGENT = "OSRS Planner - supply import (github.com/HarveyMahon/OSRS-Planner; Discord: Adamolf#7451)"
PREFIX = "Money making guide/"
FLAG_DIFF = 0.20          # flag bosses whose new cost differs from the old flat cost by more than 20%
PAUSE_SECONDS = 1.0       # between requests

requests_made = 0


def api(params):
    global requests_made
    if requests_made:
        time.sleep(PAUSE_SECONDS)
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    requests_made += 1
    print(f"  request {requests_made}: {params.get('list') or params.get('prop')}", flush=True)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def cached(name, fetch, refetch):
    path = CACHE / name
    if path.exists() and not refetch:
        return json.loads(path.read_text(encoding="utf-8"))
    data = fetch()
    CACHE.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return data


def list_guides():
    titles, cont = [], {}
    while True:
        d = api({"action": "query", "list": "allpages", "apprefix": PREFIX, "apnamespace": 0,
                 "apfilterredir": "nonredirects", "aplimit": 500, **cont})
        titles += [p["title"] for p in d["query"]["allpages"]]
        if "continue" not in d:
            return titles
        cont = {"apcontinue": d["continue"]["apcontinue"], "continue": d["continue"]["continue"]}


def fetch_pages(titles):
    pages = {}
    for i in range(0, len(titles), 50):
        d = api({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                 "titles": "|".join(titles[i:i + 50])})
        for p in d["query"]["pages"]:
            if p.get("revisions"):
                pages[p["title"]] = p["revisions"][0]["slots"]["main"]["content"]
    return pages


norm = lambda s: re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def match_guides(bosses, titles):
    """Guide pages whose title mentions the boss, e.g. 'Killing Vorkath', 'Killing Vorkath (low level)'."""
    out = {}
    for b in bosses:
        names = {norm(b["name"]), norm(re.sub(r"^the\s+", "", b["name"], flags=re.I))}
        hits = [t for t in titles if any(re.search(rf"\b{re.escape(n)}\b", norm(t[len(PREFIX):])) for n in names)]
        if hits:
            out[b["id"]] = sorted(hits)
    return out


# ---------- Parsing (written without seeing the template; check template_fields.txt) ----------

def template_params(text):
    """Top-level |name = value pairs of the first {{Money making guide ...}} call, nesting-aware."""
    start = re.search(r"\{\{\s*(Money making guide|Mmg)\b", text, re.I)
    if not start:
        return {}
    i, depth, buf, parts = start.start() + 2, 1, "", []
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
    params = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.strip()] = v.strip()
    return params


def number(v):
    v = re.sub(r"<[^>]+>|\{\{[^}]*\}\}|,", "", v or "").strip()
    m = re.match(r"^-?\d+(\.\d+)?", v)
    return float(m.group()) if m else None


def strip_links(v):
    return re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v or "").strip()


def parse_guide(text):
    p = template_params(text)
    kph = None
    for k in ("kph", "Kph", "Kills per hour", "kills"):
        if k in p and number(p[k]):
            kph = number(p[k]); break
    inputs = []
    for k, v in p.items():
        m = re.fullmatch(r"Input(\d+)", k)
        if not m or not v:
            continue
        n = m.group(1)
        qty = number(p.get(f"Input{n}num") or p.get(f"Input{n}qty") or "1")
        per_hour = (p.get(f"Input{n}isph") or "").lower() not in ("no", "false", "0")
        inputs.append({"name": strip_links(v), "qtyRaw": qty, "perHour": per_hour})
    return {"params": p, "kph": kph, "inputs": inputs}


def main():
    refetch = "--refetch" in sys.argv
    items = json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))["items"]
    bosses = json.loads((ROOT / "data/bosses.json").read_text(encoding="utf-8"))["bosses"]
    # The Wiki's name -> ID mapping, if update_prices.py has cached it, identifies supplies that
    # are real items but not in items.json yet (items.json was built from drops only)
    mp = HERE / "item_mapping.json"
    wiki_ids = {m["name"].lower(): m["id"] for m in json.loads(mp.read_text(encoding="utf-8"))} if mp.exists() else {}
    new_items = {}
    by_name = {}
    for key, it in items.items():
        for n in [it["name"], *it.get("aliases", [])]:
            by_name[n.lower()] = key

    print("Stage 1: listing money-making guides", flush=True)
    titles = cached("guide_titles.json", list_guides, refetch)
    matches = match_guides(bosses, titles)
    wanted = sorted({t for ts in matches.values() for t in ts})
    print(f"  {len(titles)} guides, {len(wanted)} match {len(matches)} of our {len(bosses)} bosses", flush=True)

    print("Stage 2: fetching matched guide pages", flush=True)
    pages = cached("guide_pages.json", lambda: fetch_pages(wanted), refetch)
    missing = [t for t in wanted if t not in pages]
    if missing and not refetch:
        print(f"  {len(missing)} matched pages not in cache; fetching them", flush=True)
        pages.update(fetch_pages(missing))
        (CACHE / "guide_pages.json").write_text(json.dumps(pages, ensure_ascii=False, indent=1), encoding="utf-8")

    print("Stage 3: parsing", flush=True)
    OUT.mkdir(exist_ok=True)
    fields = set()
    review, md = {}, ["# Supply import review", "",
                      "Per-unit costs at current prices. 'Old' is the flat cost per unit in data/bosses.json. "
                      "Nothing here is applied until it has been reviewed.", ""]
    for b in sorted(bosses, key=lambda x: x["name"]):
        guides = matches.get(b["id"], [])
        old = b.get("defaultCost")
        md.append(f"## {b['name']} ({b['unit']})")
        if not guides:
            md += ["No matching guide: supplies need entering by hand.", ""]
            continue
        review[b["id"]] = []
        for title in guides:
            g = parse_guide(pages.get(title, ""))
            fields.update(g["params"])
            kph = g["kph"] or b.get("defaultKph")
            supplies, flags, cost = [], [], 0.0
            if not g["kph"]:
                flags.append(f"no kills per hour on the guide; used ours ({b.get('defaultKph')})")
            for inp in g["inputs"]:
                key = by_name.get(inp["name"].lower())
                if inp["qtyRaw"] is None:
                    flags.append(f"couldn't read the quantity of '{inp['name']}'")
                    continue
                qty = inp["qtyRaw"] / kph if inp["perHour"] and kph else inp["qtyRaw"]
                if key is None and inp["name"].lower() in wiki_ids:
                    key = str(wiki_ids[inp["name"].lower()])
                    new_items[key] = inp["name"]
                    flags.append(f"'{inp['name']}' is not in items.json yet: cost incomplete until it is added")
                elif key is None:
                    flags.append(f"unknown item '{inp['name']}' (not in items.json or the Wiki mapping)")
                elif key in items:
                    cost += items[key]["price"] * qty
                supplies.append({"item": key or inp["name"], "name": inp["name"], "qty": round(qty, 4), "per": "unit"})
            if not g["inputs"]:
                flags.append("no inputs parsed (check template_fields.txt)")
            diff = (cost - old) / old if old else None
            if diff is not None and abs(diff) > FLAG_DIFF:
                flags.append(f"cost differs from old by {diff:+.0%}")
            review[b["id"]].append({"guide": title, "unitsPerHr": kph, "supplies": supplies,
                                    "costPerUnit": round(cost), "oldCostPerUnit": old, "flags": flags})
            md.append(f"**{title}** · {kph} per hour · new {round(cost):,} gp vs old {old if old is None else f'{old:,}'} gp per {b['unit']}")
            md += [f"- {s['qty']} × {s['name']}" for s in supplies]
            md += [f"- ⚠ {f}" for f in flags]
            md.append("")
    (OUT / "supplies_review.json").write_text(json.dumps({"newItems": new_items, "bosses": review}, indent=1, ensure_ascii=False), encoding="utf-8")
    (OUT / "supplies_review.md").write_text("\n".join(md), encoding="utf-8")
    (OUT / "template_fields.txt").write_text("\n".join(sorted(fields)), encoding="utf-8")
    flagged = sum(1 for v in review.values() for g in v if g["flags"])
    print(f"Done. {requests_made} Wiki requests. {len(review)} bosses with guides, {flagged} guide(s) flagged.")
    if not wiki_ids:
        print("Tip: run scripts/update_prices.py first to cache the Wiki item mapping; it identifies supplies missing from items.json.")
    elif new_items:
        print(f"{len(new_items)} supply items are missing from items.json (listed under newItems in the JSON).")
    print(f"Review: {OUT / 'supplies_review.md'}")


if __name__ == "__main__":
    main()
