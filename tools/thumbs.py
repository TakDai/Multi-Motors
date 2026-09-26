"""Download a small thumbnail of every motor photo (IMG column) into site/assets/motors/.

The site then shows the photo from our own server instead of hot-linking the
shop (links break, some shops block it). site/data/thumbs.json maps REF -> file.

Usage: python tools/thumbs.py
"""
import csv, hashlib, io, json, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "assets" / "motors"
MAP = ROOT / "site" / "data" / "thumbs.json"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}


def name_for(url):
    return hashlib.sha1(url.encode()).hexdigest()[:16] + ".webp"


def fetch(url):
    dest = OUT / name_for(url)
    if dest.exists():
        return url, dest.name
    try:
        r = requests.get(url, headers=UA, timeout=20)
        r.raise_for_status()
        im = Image.open(io.BytesIO(r.content))
        im = im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB")
        im.thumbnail((360, 360))
        im.save(dest, "WEBP", quality=80, method=6)
        return url, dest.name
    except Exception as e:
        print(f"  échec {url[:80]}: {e}", file=sys.stderr)
        return url, None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    MAP.parent.mkdir(parents=True, exist_ok=True)
    with (ROOT / "catalogue" / "moteurs.csv").open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("IMG", "").startswith("http")]
    urls = sorted({r["IMG"] for r in rows})
    with ThreadPoolExecutor(8) as ex:
        done = dict(ex.map(fetch, urls))
    mapping = {r["REF"]: "assets/motors/" + done[r["IMG"]] for r in rows if done.get(r["IMG"])}
    MAP.write_text(json.dumps(mapping, separators=(",", ":")), encoding="utf-8")
    print(f"{sum(1 for v in done.values() if v)}/{len(urls)} photos, {len(mapping)} moteurs illustrés")


if __name__ == "__main__":
    main()
