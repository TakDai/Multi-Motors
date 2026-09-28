"""Frame the gallery photos (Photos tab) on the motor.

Shop photos often have wide empty margins, a motor off-centre or a logo in a
corner: shown as they are, the motor looks small and badly placed. For every
photo on a plain background, the box of the motor is found the same way as for
the thumbnails (tools/thumbs.py: logos and captions standing apart are left out)
and saved; the site then shows only that part of the photo, centred, with a
small margin. Photos on a real background (scenery, workshop) are left whole.

Result: site/data/cadrage.json {url: [x0, y0, x1, y1]} in thousandths of the
width / height, only for photos where framing changes something.
Boxes are cached in catalogue/photos_cadrage.json so a photo is downloaded once.

Usage: python tools/photos_frame.py
"""
import io, json, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from thumbs import UA, main_parts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PHOTOS = ROOT / "site" / "data" / "photos.json"
OUT = ROOT / "site" / "data" / "cadrage.json"
CACHE = ROOT / "catalogue" / "photos_cadrage.json"
VERSION = 1  # bump when the box detection changes: every photo is measured again
MARGIN = 0.05  # room kept around the motor, share of its size


def motor_box(im):
    """Box of the motor in thousandths [x0, y0, x1, y1], or None (real background, nothing to cut)."""
    im.seek(0)
    im = im.convert("RGBA")
    white = Image.new("RGBA", im.size, (255, 255, 255, 255))
    white.alpha_composite(im)
    rgb = white.convert("RGB")
    rgb.thumbnail((320, 320))
    w, h = rgb.size
    px = rgb.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    if max(max(c) - min(c) for c in zip(*corners)) >= 40:
        return None
    bg = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    mask = [[max(abs(c[0] - bg[0]), abs(c[1] - bg[1]), abs(c[2] - bg[2])) > 24
             for c in (px[x, y] for x in range(w))] for y in range(h)]
    cell = main_parts(mask, w, h)
    if not cell or (cell[2] - cell[0]) * (cell[3] - cell[1]) < 0.02 * w * h:
        return None
    mx, my = (cell[2] - cell[0]) * MARGIN, (cell[3] - cell[1]) * MARGIN
    box = [max(0, cell[0] - mx) / w, max(0, cell[1] - my) / h, min(w, cell[2] + mx) / w, min(h, cell[3] + my) / h]
    return [round(v * 1000) for v in box]


def measure(url):
    try:
        r = requests.get(url, headers=UA, timeout=25)
        if not r.ok:
            return url, None
        return url, {"v": VERSION, "box": motor_box(Image.open(io.BytesIO(r.content)))}
    except Exception:  # unreachable or not an image: measured again next time
        return url, None


def main():
    photos = json.loads(PHOTOS.read_text())
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    urls = sorted({u for v in photos.values() for u in (v or []) if u.startswith("http")})
    todo = [u for u in urls if (cache.get(u) or {}).get("v") != VERSION]
    with ThreadPoolExecutor(16) as ex:
        for url, res in ex.map(measure, todo):
            if res:
                cache[url] = res
    out = {}
    for u in urls:
        box = (cache.get(u) or {}).get("box")
        # Only when it changes something: at least 12 % of the photo cut away
        if box and (box[2] - box[0]) * (box[3] - box[1]) < 0.88e6:
            out[u] = box
    CACHE.write_text(json.dumps({u: cache[u] for u in urls if u in cache}, separators=(",", ":")))
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{len(urls)} photos, {len(todo)} mesurées, {len(out)} recadrées sur le moteur")


if __name__ == "__main__":
    main()
