"""Download a small thumbnail of every motor photo into site/assets/motors/.

Source: the IMG column, or else the first photo of the motor's family
(site/data/photos.json). The empty background around the motor is cut away and
the motor is centred on a white square, so every card shows it at the same size.
The site then shows the photo from our own server instead of hot-linking the
shop (links break, some shops block it). site/data/thumbs.json maps REF -> file;
thumbnails no longer used are deleted.

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


VERSION = "v2"  # bump when the processing changes: every thumbnail is made again


def name_for(url):
    return hashlib.sha1((VERSION + url).encode()).hexdigest()[:16] + ".webp"


def frame(im, size=360, margin=0.08):
    """Cut the plain background around the motor, then centre it on a white square."""
    im.seek(0)
    im = im.convert("RGBA")
    white = Image.new("RGBA", im.size, (255, 255, 255, 255))
    white.alpha_composite(im)
    rgb = white.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    if max(max(c) - min(c) for c in zip(*corners)) < 40:  # plain background: crop to the motor
        mask = Image.new("L", (w, h), 0)
        mp = mask.load()
        step = max(1, min(w, h) // 300)
        for y in range(0, h, step):
            for x in range(0, w, step):
                r, g, b = px[x, y]
                if max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2])) > 24:
                    mp[x, y] = 255
        box = mask.getbbox()
        if box and (box[2] - box[0]) * (box[3] - box[1]) > 0.02 * w * h:
            rgb = rgb.crop((max(0, box[0] - step), max(0, box[1] - step), min(w, box[2] + step), min(h, box[3] + step)))
    side = int(max(rgb.size) * (1 + 2 * margin))
    canvas = Image.new("RGB", (side, side), (255, 255, 255) if sum(bg) > 600 else bg)
    canvas.paste(rgb, ((side - rgb.width) // 2, (side - rgb.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def fetch(url):
    dest = OUT / name_for(url)
    if dest.exists():
        return url, dest.name
    try:
        r = requests.get(url, headers=UA, timeout=20)
        r.raise_for_status()
        frame(Image.open(io.BytesIO(r.content))).save(dest, "WEBP", quality=80, method=6)
        return url, dest.name
    except Exception as e:
        print(f"  échec {url[:80]}: {e}", file=sys.stderr)
        return url, None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    MAP.parent.mkdir(parents=True, exist_ok=True)
    with (ROOT / "catalogue" / "moteurs.csv").open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    photos_file = ROOT / "site" / "data" / "photos.json"
    photos = json.loads(photos_file.read_text()) if photos_file.exists() else {}
    source = {}
    for r in rows:
        img = r.get("IMG", "")
        fam = photos.get(f"{r['MARQUE']}|{r['NOM']}") or []
        url = img if img.startswith("http") else next((u for u in fam if u.startswith("http")), "")
        if url:
            source[r["REF"]] = url
    urls = sorted(set(source.values()))
    with ThreadPoolExecutor(8) as ex:
        done = dict(ex.map(fetch, urls))
    mapping = {ref: "assets/motors/" + done[u] for ref, u in source.items() if done.get(u)}
    MAP.write_text(json.dumps(mapping, separators=(",", ":")), encoding="utf-8")
    used = {Path(v).name for v in mapping.values()}
    old = [p for p in OUT.glob("*.webp") if p.name not in used]
    for p in old:
        p.unlink()
    print(f"{sum(1 for v in done.values() if v)}/{len(urls)} photos, {len(mapping)} moteurs illustrés, {len(old)} anciennes miniatures supprimées")


if __name__ == "__main__":
    main()
