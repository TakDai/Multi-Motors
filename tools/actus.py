"""Build site/data/actus.json, the "new motors" part of the news feed.

New motors: catalogue/premiere_vue.json records the day each motor (REF) first
appeared in the catalogue. Motors not listed yet are dated today; on the first
run the dates are rebuilt from the git history of catalogue/moteurs.csv. One
news item per day lists the motors added that day (sheet import, shops,
manufacturer pages…), with the new brands. The daily reports
catalogue/nouveautes/AAAA-MM-JJ.md are merged in.
Site news: catalogue/actus_site.json (hand-written) and, on the page, the news
posted from the admin panel. The live catalogue figures are computed by the page.

Usage: python tools/actus.py
"""
import csv, datetime, io, json, re, subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
FIRST = ROOT / "catalogue" / "premiere_vue.json"
REPORTS = ROOT / "catalogue" / "nouveautes"
EVENTS = ROOT / "catalogue" / "actus_site.json"
THUMBS = ROOT / "site" / "data" / "thumbs.json"
OUT = ROOT / "site" / "data" / "actus.json"
UNNAMED = re.compile(r"KV · [\d.]+ g$")


def rows_of(text):
    return [r for r in csv.DictReader(io.StringIO(text)) if r.get("REF")]


def from_history():
    """{REF: first day seen} from the commits that changed the catalogue (as far as the clone goes)."""
    try:
        log = subprocess.run(["git", "log", "--reverse", "--format=%H %cs", "--", str(CAT.relative_to(ROOT))],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return {}
    first = {}
    for h, day in zip(log[::2], log[1::2]):
        text = subprocess.run(["git", "show", f"{h}:{CAT.relative_to(ROOT)}"], cwd=ROOT, capture_output=True, text=True).stdout
        for r in rows_of(text):
            first.setdefault(r["REF"], day)
    return first


def main():
    rows = rows_of(CAT.read_text(encoding="utf-8"))
    by_ref = {r["REF"]: r for r in rows}
    first = json.loads(FIRST.read_text()) if FIRST.exists() else from_history()
    today = datetime.date.today().isoformat()
    first = {ref: first.get(ref, today) for ref in by_ref}  # motors merged or removed since are dropped
    FIRST.write_text(json.dumps(first, ensure_ascii=False, sort_keys=True, separators=(",", ":")), encoding="utf-8")

    days = defaultdict(set)
    for ref, day in first.items():
        days[day].add(ref)
    for f in sorted(REPORTS.glob("*.md")) if REPORTS.exists() else []:
        refs = re.findall(r"^\|\s*([^|\s][^|]*?)\s*\|", f.read_text(encoding="utf-8"), re.M)
        days[f.stem] |= {r for r in refs if r in by_ref}

    thumbs = json.loads(THUMBS.read_text()) if THUMBS.exists() else {}
    brand_first = {}
    for day in sorted(days):
        for ref in days[day]:
            brand_first.setdefault(by_ref[ref]["MARQUE"].upper(), (day, by_ref[ref]["MARQUE"]))
    items = json.loads(EVENTS.read_text(encoding="utf-8")) if EVENTS.exists() else []
    # Motors present at the opening are told by the opening news itself, not as "new"
    opening = min((i["date"] for i in items if i.get("type") == "site"), default="")
    for day, refs in days.items():
        if not refs or day <= opening:
            continue
        n = len(refs)
        # Shown first: named motors with a photo, one per model
        seen, show = set(), []
        for ref in sorted(refs, key=lambda r: (UNNAMED.search(by_ref[r]["NOM"] or "") is not None or not by_ref[r]["NOM"], r not in thumbs, r)):
            fam = (by_ref[ref]["MARQUE"], by_ref[ref]["NOM"])
            if fam not in seen:
                seen.add(fam)
                show.append(ref)
        models = len({(by_ref[r]["MARQUE"], by_ref[r]["NOM"]) for r in refs if by_ref[r]["NOM"] and not UNNAMED.search(by_ref[r]["NOM"])})
        brands = sorted(name for d, name in brand_first.values() if d == day)
        items.append({"type": "moteurs", "date": day, "count": n, "models": models,
                      "title": f"{n:,} nouveau{'x' if n > 1 else ''} moteur{'s' if n > 1 else ''} au catalogue".replace(",", " "),
                      "newBrands": brands[:40], "newBrandsCount": len(brands), "refs": show[:24]})
    items.sort(key=lambda i: (i["date"], i["type"] == "site"), reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(items[:100], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(items)} actualités ; motors per day: " + ", ".join(f"{d} {len(r)}" for d, r in sorted(days.items())))


if __name__ == "__main__":
    main()
