"""Resolve quest names (as written in guides, links or by hand) to the Wiki's quest titles.

Uses the cached quest list from scripts/import_quests.py. A name matches a title when they're
equal ignoring case, a leading "The" and punctuation, or the title is the name plus a subtitle
("Desert Treasure II" -> "Desert Treasure II - The Fallen Empire").
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
_norm = lambda s: re.sub(r"[^a-z0-9]+", " ", re.sub(r"^the\s+", "", s.strip().lower())).strip()
slug = lambda s: re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")

_titles = None


def titles():
    global _titles
    if _titles is None:
        p = HERE / "cache/quest_titles.json"
        d = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"quests": [], "miniquests": []}
        _titles = sorted({t for t in d["quests"] + d["miniquests"] if "/Quick guide" not in t})
    return _titles


def resolve(name):
    """The Wiki quest title for `name`, or None if it isn't a quest."""
    n = _norm(name)
    if not n:
        return None
    for t in titles():
        if _norm(t) == n:
            return t
    for t in titles():
        nt = _norm(t)
        if nt.startswith(n + " ") and re.match(re.escape(name.strip()) + r"\s*[-:]", t.strip(), re.I) or \
           (nt.startswith(n + " ") and " - " in t and _norm(t.split(" - ")[0]) == n):
            return t
    return None


def quest_id(name):
    t = resolve(name)
    return slug(t) if t else None
