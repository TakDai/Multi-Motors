#!/usr/bin/env python3
"""Remove duplicate photos from each motor family's gallery.

The same picture often comes several times: the manufacturer's photo re-hosted
by several shops, the same file in another size, or the photo our thumbnail was
made from. Each photo gets a visual fingerprint (difference hash of a 9x8 grey
version); photos whose fingerprints differ by at most MAX_DIST bits are the same
picture and only the first one is kept. The family's thumbnails
(site/data/thumbs.json) count as already shown.

Fingerprints are cached in catalogue/photos_hash.json so a photo is downloaded once.

Usage: python tools/photos_dedupe.py
"""
import csv, io, json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
PHOTOS = ROOT / "site" / "data" / "photos.json"
THUMBS = ROOT / "site" / "data" / "thumbs.json"
CACHE = ROOT / "catalogue" / "photos_hash.json"
MAX_DIST = 3
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}


def dhash(img):
    g = img.convert("L").resize((9, 8), Image.LANCZOS)
    px = list(g.tobytes())
    bits = 0
    for y in range(8):
        for x in range(8):
            bits = bits << 1 | (px[y * 9 + x] > px[y * 9 + x + 1])
    return f"{bits:016x}"


def flatten(img):
    """Transparent PNGs on white, like on the site, so they match the same photo on white."""
    img.seek(0)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        bg.alpha_composite(img)
        return bg
    return img


def fingerprint(url):
    try:
        if url.startswith("http"):
            r = requests.get(url, headers=UA, timeout=25)
            if not r.ok:
                return url, None
            img = Image.open(io.BytesIO(r.content))
        else:
            img = Image.open(ROOT / "site" / url)
        return url, dhash(flatten(img))
    except Exception:  # unreachable or not an image
        return url, None


def dist(a, b):
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def main():
    photos = json.loads(PHOTOS.read_text())
    thumbs = json.loads(THUMBS.read_text()) if THUMBS.exists() else {}
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    with CAT.open(encoding="utf-8") as f:
        fam_refs = {}
        for r in csv.DictReader(f):
            fam_refs.setdefault(f"{r['MARQUE']}|{r['NOM']}", []).append(r["REF"])

    todo = {u for k, v in photos.items() for u in (v or [])} | {thumbs[r] for k in photos for r in fam_refs.get(k, []) if r in thumbs}
    todo = [u for u in todo if u not in cache]
    with ThreadPoolExecutor(16) as ex:
        for url, h in ex.map(fingerprint, todo):
            cache[url] = h

    removed = 0
    for key, urls in photos.items():
        seen = [cache.get(thumbs[r]) for r in fam_refs.get(key, []) if r in thumbs]
        seen = [h for h in seen if h]
        kept = []
        for u in urls or []:
            h = cache.get(u)
            if h and any(dist(h, s) <= MAX_DIST for s in seen):
                removed += 1
                continue
            kept.append(u)
            if h:
                seen.append(h)
        photos[key] = kept
    PHOTOS.write_text(json.dumps(photos, ensure_ascii=False, separators=(",", ":")))
    CACHE.write_text(json.dumps(cache, separators=(",", ":")))
    print(f"{removed} photos en double retirées, {sum(len(v) for v in photos.values())} photos gardées "
          f"pour {sum(1 for v in photos.values() if v)} modèles")


if __name__ == "__main__":
    main()
