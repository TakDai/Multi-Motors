"""Build site/data/actus.json, the "new motors" part of the news feed.

Sources: the daily reports catalogue/nouveautes/AAAA-MM-JJ.md (REF column)
and catalogue/actus_site.json (hand-written site events). Site news posted
from the admin panel come from the API and are merged by the page.

Usage: python tools/actus.py
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "catalogue" / "nouveautes"
EVENTS = ROOT / "catalogue" / "actus_site.json"
OUT = ROOT / "site" / "data" / "actus.json"


def main():
    items = json.loads(EVENTS.read_text(encoding="utf-8")) if EVENTS.exists() else []
    for f in sorted(REPORTS.glob("*.md")) if REPORTS.exists() else []:
        refs = re.findall(r"^\|\s*([^|\s][^|]*?)\s*\|", f.read_text(encoding="utf-8"), re.M)
        refs = [r for r in refs if r not in ("REF",) and not set(r) <= {"-"}]
        if refs:
            n = len(refs)
            items.append({"type": "moteurs", "date": f.stem, "title": f"{n} nouveau{'x' if n > 1 else ''} moteur{'s' if n > 1 else ''} au catalogue", "refs": refs})
    items.sort(key=lambda i: i["date"], reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(items[:100], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(items)} actualités")


if __name__ == "__main__":
    main()
