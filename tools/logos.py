#!/usr/bin/env python3
"""Download each brand's logo and rework it into a black logo on a transparent background.

Sources are listed in catalogue/logos_sources.json ({"BRAND": {"url": ..., "crop": [x0, y0, x1, y1], "mode": "dark" | "light"}}).
Output: site/assets/logos/<brand>.png (max 480x120) and site/data/logos.json ({"BRAND": "logos/<brand>.png"}).
Brands without a source keep the text wordmark on the site.

    python3 tools/logos.py            # only brands not done yet
    python3 tools/logos.py --force    # redo everything
"""
import io, json, re, sys
from pathlib import Path
import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "catalogue" / "logos_sources.json"
OUT = ROOT / "site" / "assets" / "logos"
INDEX = ROOT / "site" / "data" / "logos.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
INK = (17, 17, 17)


def load(url):
    r = requests.get(url, headers=UA, timeout=30)
    r.raise_for_status()
    data = r.content
    if b"<svg" in data[:2000].lower():
        import cairosvg  # only needed for SVG sources
        data = cairosvg.svg2png(bytestring=data, output_height=240)
    im = Image.open(io.BytesIO(data))
    im.seek(0)
    return im.convert("RGBA")


def mono(im, crop=None, mode=None):
    """Shape of the logo as an alpha mask, painted in the site's ink colour."""
    if crop:
        w, h = im.size
        im = im.crop((round(crop[0] * w), round(crop[1] * h), round(crop[2] * w), round(crop[3] * h)))
    if max(im.size) < 400:
        f = 400 / max(im.size)
        im = im.resize((round(im.width * f), round(im.height * f)), Image.LANCZOS)
    w, h = im.size
    px = im.load()
    alpha = im.getchannel("A")
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    if mode == "light":
        # White lettering on a coloured or grey plate: keep only the light strokes
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                lum = 0.3 * r + 0.59 * g + 0.11 * b
                mp[x, y] = max(0, min(255, int((lum - 190) * 4))) * a // 255
    elif mode == "dark":
        # Coloured badge: keep only the dark strokes (outline, lettering)
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                lum = 0.3 * r + 0.59 * g + 0.11 * b
                mp[x, y] = max(0, min(255, int((170 - lum) * 2.5))) * a // 255
    elif sum(alpha.histogram()[:200]) > 0.05 * w * h:
        # Transparent source: its alpha already is the shape (works for light or dark logos)
        mask = alpha
    else:
        # Opaque source: distance to the background colour (median of the border)
        border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
        bg = [sorted(c[i] for c in border)[len(border) // 2] for i in range(3)]
        for y in range(h):
            for x in range(w):
                r, g, b, _ = px[x, y]
                d = max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2]))
                mp[x, y] = max(0, min(255, int((d - 18) * 2.2)))
    box = mask.point(lambda v: 255 if v > 40 else 0).getbbox()
    if not box:
        return None
    mask = mask.crop(box)
    f = min(480 / mask.width, 120 / mask.height)
    mask = mask.resize((max(1, round(mask.width * f)), max(1, round(mask.height * f))), Image.LANCZOS)
    # Grey + alpha: same look as RGBA, much smaller files
    logo = Image.new("LA", mask.size, (INK[0], 255))
    logo.putalpha(mask)
    return logo


def slug(brand):
    return re.sub(r"[^a-z0-9]+", "-", brand.lower()).strip("-")


def main():
    force = "--force" in sys.argv
    sources = json.loads(SOURCES.read_text())
    index = json.loads(INDEX.read_text()) if INDEX.exists() else {}
    OUT.mkdir(parents=True, exist_ok=True)
    for brand, s in sources.items():
        name = f"{slug(brand)}.png"
        if not force and brand in index and (OUT / name).exists():
            continue
        try:
            logo = mono(load(s["url"]), s.get("crop"), s.get("mode"))
        except Exception as e:  # site down, blocked, not an image…
            print(f"{brand}: {e}", file=sys.stderr)
            continue
        if logo is None:
            print(f"{brand}: image vide", file=sys.stderr)
            continue
        logo.save(OUT / name, optimize=True)
        index[brand] = f"logos/{name}"
        print(f"{brand}: {logo.width}x{logo.height}")
    INDEX.write_text(json.dumps(dict(sorted(index.items())), ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
