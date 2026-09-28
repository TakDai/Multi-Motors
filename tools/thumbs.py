"""Download a small thumbnail of every motor photo into site/assets/motors/.

Source: the IMG column, or else the first photo of the motor's family
(site/data/photos.json). The empty background around the motor is cut away and
the motor is centred on a square, so every card shows it at the same size; a plain
light background is made transparent (only the part connected to the edges, so the
white parts of the motor stay), which lets the motor sit on any card colour.
The site then shows the photo from our own server instead of hot-linking the
shop (links break, some shops block it). site/data/thumbs.json maps REF -> file;
thumbnails no longer used are deleted.

Photos listed in catalogue/photos_rejetees.txt (packaging, propellers, logos…) are
never used: the next photo of the family is taken instead. Logos and captions
standing apart from the motor are left out of the crop, and a result that is
almost empty (a watermark-only "no photo" picture) also moves on to the next photo.

Usage: python tools/thumbs.py
"""
import csv, hashlib, io, json, re, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "assets" / "motors"
MAP = ROOT / "site" / "data" / "thumbs.json"
REJECTED = ROOT / "catalogue" / "photos_rejetees.txt"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}


VERSION = "v4"  # bump when the processing changes: every thumbnail is made again


def rejected_urls():
    if not REJECTED.exists():
        return set()
    lines = (re.split(r"\s+#", l)[0].strip() for l in REJECTED.read_text(encoding="utf-8").splitlines())
    return {l for l in lines if l.startswith("http")}


def main_parts(mask, cols, rows):
    """Bounding box (in grid cells) of the motor: the connected parts of the mask,
    slightly grown so the pieces of one motor stay together, without the small
    parts standing apart (logos, captions, loose screws)."""
    grown = [[False] * cols for _ in range(rows)]
    for y in range(rows):
        for x in range(cols):
            if mask[y][x]:
                for yy in range(max(0, y - 2), min(rows, y + 3)):
                    for xx in range(max(0, x - 2), min(cols, x + 3)):
                        grown[yy][xx] = True
    label = [[0] * cols for _ in range(rows)]
    parts = []
    for y in range(rows):
        for x in range(cols):
            if grown[y][x] and not label[y][x]:
                n = len(parts) + 1
                label[y][x] = n
                stack, size, box = [(x, y)], 0, [x, y, x, y]
                while stack:
                    cx, cy = stack.pop()
                    size += mask[cy][cx]
                    box = [min(box[0], cx), min(box[1], cy), max(box[2], cx), max(box[3], cy)]
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < cols and 0 <= ny < rows and grown[ny][nx] and not label[ny][nx]:
                            label[ny][nx] = n
                            stack.append((nx, ny))
                parts.append((size, box))
    if not parts:
        return None
    big = max(size for size, _ in parts)
    keep = [box for size, box in parts if size >= 0.35 * big]
    return (min(b[0] for b in keep), min(b[1] for b in keep), max(b[2] for b in keep) + 1, max(b[3] for b in keep) + 1)


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
        step = max(1, min(w, h) // 200)
        cols, rows = (w + step - 1) // step, (h + step - 1) // step
        mask = [[max(abs(c[0] - bg[0]), abs(c[1] - bg[1]), abs(c[2] - bg[2])) > 24
                 for c in (px[x, y] for x in range(0, w, step))] for y in range(0, h, step)]
        cell = main_parts(mask, cols, rows)
        box = cell and (cell[0] * step, cell[1] * step, min(w, cell[2] * step), min(h, cell[3] * step))
        if box and (box[2] - box[0]) * (box[3] - box[1]) > 0.02 * w * h:
            rgb = rgb.crop((max(0, box[0] - step), max(0, box[1] - step), min(w, box[2] + step), min(h, box[3] + step)))
    plain = max(max(c) - min(c) for c in zip(*corners)) < 40
    side = int(max(rgb.size) * (1 + 2 * margin))
    canvas = Image.new("RGB", (side, side), bg if plain else (255, 255, 255))
    canvas.paste(rgb, ((side - rgb.width) // 2, (side - rgb.height) // 2))
    canvas = canvas.resize((size, size), Image.LANCZOS)
    if not (plain and sum(bg) > 600):
        return canvas
    return cut_background(canvas, bg)


def cut_background(im, bg, tol=18):
    """Light plain background -> transparent: pixels close to the background colour
    that are connected to the edges of the picture (flood fill), edges softened."""
    w, h = im.size
    px = im.load()
    near = Image.new("L", (w, h), 0)
    npx = near.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2])) <= tol:
                npx[x, y] = 255
    for x in range(0, w, 6):
        for y in (0, h - 1):
            if npx[x, y] == 255:
                ImageDraw.floodfill(near, (x, y), 128)
    for y in range(0, h, 6):
        for x in (0, w - 1):
            if npx[x, y] == 255:
                ImageDraw.floodfill(near, (x, y), 128)
    alpha = near.point(lambda v: 0 if v == 128 else 255).filter(ImageFilter.GaussianBlur(0.7))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def fetch(url):
    dest = OUT / name_for(url)
    if dest.exists():
        return url, dest.name
    try:
        r = requests.get(url, headers=UA, timeout=20)
        r.raise_for_status()
        im = frame(Image.open(io.BytesIO(r.content)))
        if im.mode == "RGBA" and sum(im.getchannel("A").histogram()[128:]) < 0.05 * im.width * im.height:
            print(f"  presque vide, photo suivante : {url[:80]}", file=sys.stderr)
            return url, None
        im.save(dest, "WEBP", quality=80, method=6)
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
    rejected = rejected_urls()
    candidates = {}
    for r in rows:
        img = r.get("IMG", "")
        fam = photos.get(f"{r['MARQUE']}|{r['NOM']}") or []
        urls = ([img] if img.startswith("http") else []) + [u for u in fam if u.startswith("http")]
        urls = [u for u in dict.fromkeys(urls) if u not in rejected]
        if urls:
            candidates[r["REF"]] = urls
    done, mapping = {}, {}
    for turn in range(3):  # a failed or unusable photo: try the next one of the family
        todo = {ref: urls[turn] for ref, urls in candidates.items()
                if ref not in mapping and len(urls) > turn}
        with ThreadPoolExecutor(8) as ex:
            done.update(ex.map(fetch, sorted(set(todo.values()) - set(done))))
        mapping.update({ref: "assets/motors/" + done[u] for ref, u in todo.items() if done.get(u)})
    urls = done
    MAP.write_text(json.dumps(mapping, separators=(",", ":")), encoding="utf-8")
    used = {Path(v).name for v in mapping.values()}
    old = [p for p in OUT.glob("*.webp") if p.name not in used]
    for p in old:
        p.unlink()
    print(f"{sum(1 for v in done.values() if v)}/{len(urls)} photos, {len(mapping)} moteurs illustrés, {len(old)} anciennes miniatures supprimées")


if __name__ == "__main__":
    main()
