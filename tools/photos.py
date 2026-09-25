"""Collect every product photo of each motor family from its shop page.

Uses the product pages found by tools/enrich.py (LIEN column and the sources
in catalogue/enrichissement.csv) when they are Shopify shops, and keeps up to
8 photos per family. Result: site/data/photos.json {"MARQUE|NOM": [url, ...]}

Usage: python tools/photos.py
"""
import csv, json, time
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
LOG = ROOT / "catalogue" / "enrichissement.csv"
OUT = ROOT / "site" / "data" / "photos.json"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}


def main():
    with CAT.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    ref_fam = {r["REF"]: f"{r['MARQUE']}|{r['NOM']}" for r in rows if r.get("NOM")}
    pages = {}
    for r in rows:
        if r.get("NOM") and "/products/" in r.get("LIEN", ""):
            pages.setdefault(ref_fam[r["REF"]], set()).add(r["LIEN"].split("?")[0])
    if LOG.exists():
        with LOG.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["REF"] in ref_fam and "/products/" in r["SOURCE"]:
                    pages.setdefault(ref_fam[r["REF"]], set()).add(r["SOURCE"].split("?")[0])
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    for i, (fam, urls) in enumerate(sorted(pages.items()), 1):
        if fam in data:
            continue
        photos = []
        for url in sorted(urls)[:3]:
            try:
                p = requests.get(url + ".json", headers=UA, timeout=20).json()["product"]
                for img in p.get("images", []):
                    src = img.get("src", "").split("?")[0]
                    if src and src not in photos:
                        photos.append(src)
            except Exception:
                pass
            time.sleep(0.4)
        data[fam] = photos[:8]
        if i % 25 == 0:
            OUT.write_text(json.dumps(data, separators=(",", ":")))
            print(f"{i}/{len(pages)}", flush=True)
    OUT.write_text(json.dumps(data, separators=(",", ":")))
    print(f"{sum(1 for v in data.values() if v)} familles avec photos, {sum(len(v) for v in data.values())} photos")


if __name__ == "__main__":
    main()
