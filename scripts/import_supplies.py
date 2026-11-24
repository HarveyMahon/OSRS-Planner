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


# Guides whose titles don't name the boss (title after "Money making guide/")
EXTRA_TITLES = {
    "sol_heredit": ["Completing the Fortis Colosseum (Wave 12)"],
    "dagannoth_rex": ["Killing Dagannoth Kings (Rex only)"],
}
# Fetched for their requirements only (see apply_requirements.py)
FETCH_ONLY = ["Killing Dagannoth Kings (Solo tribrid)"]


def match_guides(bosses, titles):
    """Guide pages whose title mentions the boss, e.g. 'Killing Vorkath (Toxic blowpipe)'.
    A title is given to the boss with the longest matching name, so 'Phosani's Nightmare'
    guides don't also count for 'The Nightmare'."""
    names = {b["id"]: {norm(b["name"]), norm(re.sub(r"^the\s+", "", b["name"], flags=re.I))} for b in bosses}
    out = {}
    for t in titles:
        tt = norm(t[len(PREFIX):])
        best = max(((len(n), bid) for bid, ns in names.items() for n in ns if re.search(rf"\b{re.escape(n)}\b", tt)), default=None)
        if best:
            out.setdefault(best[1], []).append(t)
    for bid, extra in EXTRA_TITLES.items():
        if bid in names:
            out.setdefault(bid, []).extend(PREFIX + t for t in extra if PREFIX + t in titles)
    return {k: sorted(set(v)) for k, v in out.items()}


# ---------- Parsing: the Wiki's {{Mmgtable}} template ----------
# isperkill = y   -> InputN/OutputN quantities are per kill (unit), except inputs with
#                    InputNisph = y, which are per hour
# kph             -> the guide's kills per hour
# InputNvalue     -> GP value per unit for inputs that aren't GE items (e.g. {{Cheap food}})

def template_params(text):
    """Top-level |name = value pairs of the {{Mmgtable ...}} call, nesting-aware."""
    start = re.search(r"\{\{\s*Mmgtable\b", text, re.I)
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
            params[k.strip()] = re.sub(r"<!--.*?-->", "", v, flags=re.S).strip()
    return params


def safe_arith(expr):
    """Evaluate + - * / ( ) and numbers only, as used in {{#expr:...}}."""
    import ast
    expr = expr.replace("^", "**")
    tree = ast.parse(expr, mode="eval")
    ok = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Add, ast.Sub, ast.Mult,
          ast.Div, ast.Pow, ast.USub, ast.UAdd, ast.Mod)
    for node in ast.walk(tree):
        if not isinstance(node, ok) or (isinstance(node, ast.Constant) and not isinstance(node.value, (int, float))):
            raise ValueError(expr)
    return float(eval(compile(tree, "expr", "eval"), {"__builtins__": {}}))


# Set by main(): item name -> GE price, for {{GEP|Item|qty}} in values
PRICE_OF = lambda name: None


def _gep(m):
    args = [a.strip() for a in m.group(1).split("|")]
    price = PRICE_OF(args[0])
    if price is None:
        raise ValueError(args[0])
    qty = 1
    if len(args) > 1 and re.fullmatch(r"[\d.\s+\-*/()]+", args[1]):   # e.g. 2 or 1/100
        qty = safe_arith(args[1])
    return f"({price * qty})"


def number(v, variables=None):
    v = strip_vardefines(re.sub(r"<!--.*?-->|<[^>]+>", "", v or "", flags=re.S)).replace(",", "").strip()
    try:
        v = re.sub(r"\{\{\s*GEP\s*\|([^{}]*)\}\}", _gep, v)
    except ValueError:
        return None
    for name, val in (variables or {}).items():     # {{#var:name}} defined on the page
        v = re.sub(r"\{\{\s*#var\s*:\s*" + re.escape(name) + r"\s*\}\}", f"({val})", v)
    m = re.fullmatch(r"\{\{\s*#expr\s*:(.*)\}\}", v, re.S)
    try:
        if m:
            return safe_arith(m.group(1))
        if re.fullmatch(r"[\d\s.+\-*/()]+", v):    # plain arithmetic such as "1 / 600"
            return safe_arith(v)
        return None
    except Exception:
        return None


def _vardefines(text):
    """(start, end, name, value) for each {{#vardefine:name|value}}, brace-matched."""
    out, i = [], 0
    while True:
        m = re.compile(r"\{\{\s*#vardefine\s*:").search(text, i)
        if not m:
            return out
        j, depth = m.end(), 1
        while j < len(text) and depth:
            if text.startswith("{{", j): depth += 1; j += 2
            elif text.startswith("}}", j): depth -= 1; j += 2
            else: j += 1
        body = text[m.end():j - 2]
        d, k = 0, 0
        while k < len(body):                    # split name|value at the first top-level |
            if body.startswith("{{", k): d += 1; k += 2; continue
            if body.startswith("}}", k): d -= 1; k += 2; continue
            if body[k] == "|" and d == 0: break
            k += 1
        out.append((m.start(), j, body[:k].strip(), body[k + 1:]))
        i = j


def strip_vardefines(v):
    for start, end, _, _ in reversed(_vardefines(v)):
        v = v[:start] + v[end:]
    return v


def page_variables(text):
    """{{#vardefine:name|value}} definitions, evaluated in order (later ones may use earlier)."""
    out = {}
    for _, _, name, val in _vardefines(text):
        n = number(val, out)
        if n is None:
            n = number("{{#expr:" + val + "}}", out)
        if n is not None:
            out[name] = n
    return out


def strip_links(v):
    return re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", v or "").strip()


def is_yes(v):
    return (v or "").strip().lower().startswith(("y", "t"))


# Teleports vary too much by account to include (site owner's call)
EXCLUDE_SUPPLY = re.compile(r"teleport|\btab(let)?\b|house tab", re.I)

# The Wiki's {{Cheap food}} stands for any cheap food; we price it as this item
CHEAP_FOOD = "Monkfish"


def parse_guide(text):
    p = template_params(text)
    var = page_variables(text)
    kph = number(p.get("kph"), var)
    per_kill = is_yes(p.get("isperkill"))
    def lines(kind):
        out = []
        for k, v in p.items():
            m = re.fullmatch(kind + r"(\d+)", k)
            if not m or not v:
                continue
            n = m.group(1)
            isph = p.get(f"{kind}{n}isph")
            per_hour = is_yes(isph) if isph is not None else not per_kill
            name, templ = strip_links(v), v.strip().startswith("{{")
            if re.fullmatch(r"\{\{\s*Cheap food\s*\}\}", v.strip(), re.I):
                name, templ = CHEAP_FOOD, False
            out.append({"name": name, "qtyRaw": number(p.get(f"{kind}{n}num", "1"), var),
                        "perHour": per_hour, "value": number(p.get(f"{kind}{n}value"), var),
                        "isTemplate": templ})
        return out
    return {"params": p, "kph": kph, "inputs": lines("Input"), "outputs": lines("Output")}


# Bosses that aren't in data/bosses.json yet, built from their guides alone
NEW_BOSSES = [{"id": "the_fractured_archive", "name": "The Fractured Archive", "unit": "raid"}]


def main():
    refetch = "--refetch" in sys.argv
    items = json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))["items"]
    bosses = json.loads((ROOT / "data/bosses.json").read_text(encoding="utf-8"))["bosses"]
    # The Wiki's name -> ID mapping, if update_prices.py has cached it, identifies supplies that
    # are real items but not in items.json yet (items.json was built from drops only)
    mp = HERE / "item_mapping.json"
    wiki_ids = {m["name"].lower(): m["id"] for m in json.loads(mp.read_text(encoding="utf-8"))} if mp.exists() else {}
    new_items = {}
    log = ROOT / "logs" / "price_update_log.json"
    latest = {}
    try:
        for r in json.loads(log.read_text(encoding="utf-8")).get("requests", []):
            if r.get("url", "").endswith("/latest") and isinstance(r.get("body"), dict):
                latest = r["body"].get("data", {})
    except Exception:
        pass

    def latest_price(key):
        p = latest.get(str(key)) if key else None
        vals = [v for v in ((p or {}).get("high"), (p or {}).get("low")) if isinstance(v, (int, float)) and v > 0]
        return round(sum(vals) / len(vals)) if vals else None

    by_name = {}
    for key, it in items.items():
        for n in [it["name"], *it.get("aliases", [])]:
            by_name[n.lower()] = key

    print("Stage 1: listing money-making guides", flush=True)
    titles = cached("guide_titles.json", list_guides, refetch)
    matches = match_guides(bosses + NEW_BOSSES, titles)
    wanted = sorted({t for ts in matches.values() for t in ts} | {PREFIX + t for t in FETCH_ONLY if PREFIX + t in titles})
    print(f"  {len(titles)} guides, {len(wanted)} match {len(matches)} of our {len(bosses)} bosses", flush=True)

    print("Stage 2: fetching matched guide pages", flush=True)
    pages = cached("guide_pages.json", lambda: fetch_pages(wanted), refetch)
    missing = [t for t in wanted if t not in pages]
    if missing and not refetch:
        print(f"  {len(missing)} matched pages not in cache; fetching them", flush=True)
        try:
            pages.update(fetch_pages(missing))
            (CACHE / "guide_pages.json").write_text(json.dumps(pages, ensure_ascii=False, indent=1), encoding="utf-8")
        except Exception as e:  # offline: carry on with what's cached
            print(f"  couldn't fetch them ({type(e).__name__}); continuing with the cache", flush=True)

    print("Stage 3: parsing", flush=True)
    OUT.mkdir(exist_ok=True)
    fields = set()
    review, md = {}, ["# Supply import review", "",
                      "Per-unit figures at current prices. 'Ours' is what data/bosses.json has now "
                      "(flat supply cost; loot from our drop-table model). Nothing here is applied until reviewed.", ""]

    global PRICE_OF
    def price_of(name):
        key = by_name.get(name.lower()) or (str(wiki_ids[name.lower()]) if name.lower() in wiki_ids else None)
        if key in items:
            return items[key]["price"]
        return latest_price(key)
    PRICE_OF = price_of

    def resolve(name):
        key = by_name.get(name.lower())
        if key is None and name.lower() in wiki_ids:
            key = str(wiki_ids[name.lower()])
            new_items[key] = name
        return key

    def priced(lines, kph, flags, what):
        out, total = [], 0.0
        for ln in lines:
            if what == "supply" and EXCLUDE_SUPPLY.search(ln["name"]):
                continue
            if ln["qtyRaw"] is None:
                flags.append(f"{what}: couldn't read the quantity of '{ln['name']}'"); continue
            qty = ln["qtyRaw"] / kph if ln["perHour"] and kph else ln["qtyRaw"]
            key = None if ln["isTemplate"] else resolve(ln["name"])
            entry = {"item": key, "name": ln["name"], "qty": round(qty, 6), "per": "unit"}
            if ln["value"] is not None and (key is None or key not in items):
                entry["gpEach"] = ln["value"]; total += ln["value"] * qty
            elif key in items:
                total += items[key]["price"] * qty
            elif key and latest_price(key) is not None:
                entry["newItemPrice"] = latest_price(key); total += latest_price(key) * qty
            elif key:
                flags.append(f"{what}: '{ln['name']}' (ID {key}) has no recent GE price")
            else:
                flags.append(f"{what}: no item or value for '{ln['name']}'")
            out.append(entry)
        return out, total

    targets = [(b, matches.get(b["id"], [])) for b in sorted(bosses, key=lambda x: x["name"])]
    for nb in NEW_BOSSES:
        targets.append(({**nb, "new": True}, match_guides([nb], titles).get(nb["id"], [])))
    for b, guides in targets:
        setup = None if b.get("new") else next((s for s in b["setups"] if s["id"] == b["defaultSetup"]), b["setups"][0])
        old_cost = setup.get("flatCostPerUnit") if setup else None
        md.append(f"## {b['name']} ({b['unit']}){' — NEW' if b.get('new') else ''}")
        guides = [t for t in guides if "{{disambig" not in pages.get(t, "").lower()]
        if not guides:
            md += ["No matching guide: entered by hand.", ""]
            continue
        review[b["id"]] = []
        for title in guides:
            g = parse_guide(pages.get(title, ""))
            fields.update(g["params"])
            flags = []
            if not g["params"]:
                flags.append("no Mmgtable on the page")
            kph = g["kph"] or (setup or {}).get("unitsPerHr")
            if not g["kph"]:
                flags.append(f"no kills per hour on the guide; used ours ({kph})")
            supplies, cost = priced(g["inputs"], kph, flags, "supply")
            loot_lines, loot = priced(g["outputs"], kph, flags, "loot")
            diff = (cost - old_cost) / old_cost if old_cost else None
            if diff is not None and abs(diff) > FLAG_DIFF:
                flags.append(f"supply cost differs from our flat cost by {diff:+.0%}")
            review[b["id"]].append({"guide": title, "unitsPerHr": kph, "supplies": supplies,
                                    "costPerUnit": round(cost), "oldCostPerUnit": old_cost,
                                    "guideLootPerUnit": round(loot), "loot": loot_lines if b.get("new") else None,
                                    "flags": flags})
            label = title[len(PREFIX):]
            md.append(f"**{label}** · {kph or 0:g} per hour · supplies {round(cost):,} gp"
                      + (f" (ours {round(old_cost):,})" if old_cost is not None else "")
                      + f" · guide loot {round(loot):,} gp per {b['unit']} · guide profit "
                      + f"{round((loot - cost) * (kph or 0)):,} gp/hr")
            md += [f"- {s['qty']:g} × {s['name']}" + (f" @ {s['gpEach']:,.0f} gp" if 'gpEach' in s else "") for s in supplies]
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
