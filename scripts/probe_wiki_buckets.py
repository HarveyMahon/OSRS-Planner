"""One-off probe: list the Wiki's Bucket tables (to find where equipment requirements live)."""
import json, os, urllib.parse, urllib.request
print("Probe started...", flush=True)
API = "https://oldschool.runescape.wiki/api.php"
UA = "OSRS Planner - data probe (github.com/HarveyMahon/OSRS-Planner; Discord: Adamolf#7451)"
def get(p):
    with urllib.request.urlopen(urllib.request.Request(API + "?" + urllib.parse.urlencode(p), headers={"User-Agent": UA}), timeout=60) as r:
        return json.loads(r.read().decode())
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "dps"); os.makedirs(OUT, exist_ok=True)
ns = get({"action": "query", "meta": "siteinfo", "siprop": "namespaces", "format": "json"})["query"]["namespaces"]
bucket_ns = [k for k, v in ns.items() if v.get("*", "").lower() == "bucket"]
res = {"namespaces": {k: v.get("*") for k, v in ns.items()}, "buckets": []}
for b in bucket_ns:
    d = get({"action": "query", "list": "allpages", "apnamespace": b, "aplimit": 500, "format": "json"})
    res["buckets"] += [p["title"] for p in d["query"]["allpages"]]
for t in res["buckets"]:
    if "requir" in t.lower() or "bonus" in t.lower() or "item" in t.lower():
        try:
            d = get({"action": "parse", "page": t, "prop": "wikitext", "format": "json"})
            res.setdefault("schemas", {})[t] = d.get("parse", {}).get("wikitext", {}).get("*", "")[:3000]
        except Exception as e: res.setdefault("schemas", {})[t] = str(e)
d = get({"action": "parse", "page": "Twisted bow", "prop": "wikitext", "format": "json"})
res["twisted_bow_wikitext"] = d["parse"]["wikitext"]["*"][:6000]
json.dump(res, open(os.path.join(OUT, "probe.json"), "w"), indent=1)
print(len(res["buckets"]), "buckets")
