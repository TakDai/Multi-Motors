"""Fold the changes approved by the moderators into catalogue/moteurs.csv.

Reads api/index.php?action=export on the live site (needs MM_SITE_URL and
MM_EXPORT_KEY) so the catalogue, the Google Sheet export and the next deploy
all carry the community corrections. Each applied change is logged in
catalogue/enrichissement.csv with the source "communauté".

Usage: MM_SITE_URL=https://… MM_EXPORT_KEY=… python tools/community_sync.py
"""
import csv, os, sys
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
LOG = ROOT / "catalogue" / "enrichissement.csv"


def main():
    site, key = os.environ.get("MM_SITE_URL", "").rstrip("/"), os.environ.get("MM_EXPORT_KEY", "")
    if not site or not key:
        print("MM_SITE_URL / MM_EXPORT_KEY absents : rien à synchroniser")
        return
    r = requests.get(f"{site}/api/index.php", params={"action": "export", "key": key}, timeout=30)
    if not r.ok:
        print(f"Export impossible ({r.status_code}) : {r.text[:200]}", file=sys.stderr)
        return
    changes = r.json()
    with CAT.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        cols, rows = list(reader.fieldnames), list(reader)
    by_ref = {row["REF"]: row for row in rows}
    applied = []
    for c in changes:
        row = by_ref.get(c["ref"])
        if row is None or c["field"] not in cols or row.get(c["field"]) == c["new_value"]:
            continue
        row[c["field"]] = c["new_value"]
        applied.append({"REF": c["ref"], "CHAMP": c["field"], "VALEUR": c["new_value"], "SOURCE": "communauté " + (c.get("source") or "")})
    if applied:
        with CAT.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
        with LOG.open("a", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=["REF", "CHAMP", "VALEUR", "SOURCE"]).writerows(applied)
    print(f"{len(applied)} corrections de la communauté appliquées")


if __name__ == "__main__":
    main()
