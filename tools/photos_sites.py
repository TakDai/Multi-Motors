#!/usr/bin/env python3
"""Photos from the manufacturers' own sites, found through their sitemaps.

For each brand of SITES, every product page listed in the site's sitemap(s) is
matched to the catalogue models by the words of its address (all the words of
the model name must be in it). Photos come from the sitemap (<image:loc>) or,
when it lists none, from the page itself (og:image and product pictures).
They are added to site/data/photos.json (up to 10 photos per family).

Usage: python tools/photos_sites.py [--brand T-MOTOR]
"""
import argparse, csv, gzip, json, re, sys
from pathlib import Path
from urllib.parse import urljoin
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich import tokens  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
OUT = ROOT / "site" / "data" / "photos.json"
MAX_PHOTOS = 10
UNNAMED = re.compile(r"KV · [\d.]+ g$")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
SITES = {
    "FLASHHOBBY": "https://www.flashhobby.com/sitemap.xml",
    "RCTIMER": "https://rctimer.com/sitemap.xml",
    "AXIS": "https://www.axisflying.com/www-axisflying-com-sitemap.xml",
    "IFLIGHT": "https://shop.iflight.com/sitemap.xml",
    "RACERSTAR": "https://www.racerstar.com/sitemap.xml",
    "EACHINE": "https://www.eachine.com/sitemap.xml",
    "KDE": "https://www.kdedirect.com/sitemap.xml",
    "HGLRC": "https://www.hglrc.com/sitemap.xml",
    "SUNNYSKY": "https://sunnyskyusa.com/sitemap.xml",
    "LEOMOTION": "https://www.leomotion.com/sitemap_index.xml",
    "NEUMOTORS": "https://neumotors.com/sitemap_index.xml",
    "KONTRONIK": "https://kontronik.com/product-sitemap.xml",
    "TENSHOCK": "https://www.tenshock.com/sitemap.xml",
    "EMAX": "https://emaxmodel.com/sitemap.xml",
    "DYS": "http://www.dys.hk/sitemap.xml",
}
SKIP = re.compile(r"(blog|news|article|category|tag|page|post|policy|about|contact|faq|cart|account|/c/|-c\d)", re.I)
NOT_MOTOR = re.compile(r"(prop|propeller|frame|esc|stack|controller|camera|battery|goggle|receiver|drone|quad|bnf|pnp|kit|combo|screw|bell|antenna|charger|shaft|bearing|magnet)", re.I)
session = requests.Session()
session.headers.update(UA)


def fetch(url):
    try:
        r = session.get(url, timeout=30)
        if not r.ok:
            return ""
        data = r.content
        if url.endswith(".gz") or data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        return data.decode("utf-8", "replace")
    except (requests.RequestException, OSError):
        return ""


def sitemap_products(url, depth=0):
    """{page url: [image urls]} of every page listed, following sitemap indexes."""
    xml = fetch(url)
    out = {}
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)
    nested = locs and all(re.search(r"\.xml(\.gz)?(\?|$)", l) for l in locs)
    if ("<sitemapindex" in xml or nested) and depth < 2:
        for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml):
            loc = loc.replace("&amp;", "&")
            if not re.search(r"(post|page|blog|categor|collection|agentic)", loc, re.I) or "product" in loc:
                out.update(sitemap_products(loc, depth + 1))
        return out
    for block in re.findall(r"<url>(.*?)</url>", xml, re.S):
        loc = re.search(r"<loc>\s*([^<\s]+)", block)
        if not loc:
            continue
        page = loc.group(1).replace("&amp;", "&")
        out[page] = [i.replace("&amp;", "&") for i in re.findall(r"<image:loc>\s*([^<\s]+)", block)]
    return out


def page_photos(url):
    page = fetch(url)
    imgs = re.findall(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', page)
    for src in re.findall(r'<img[^>]+(?:data-src|data-zoom-image|data-large|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"', page, re.I):
        if re.search(r"(product|upload|photo|goods|big|large|zoom|files)", src, re.I) and not re.search(r"(logo|icon|banner|pay|flag|avatar)", src, re.I):
            imgs.append(urljoin(url, src))
    return list(dict.fromkeys(i.split("?")[0] if "shopify" not in i else i for i in imgs))[:MAX_PHOTOS]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brand", default="")
    args = ap.parse_args()
    with CAT.open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("NOM") and not UNNAMED.search(r["NOM"])]
    photos = json.loads(OUT.read_text()) if OUT.exists() else {}
    added = 0
    for brand, sitemap in SITES.items():
        if args.brand and args.brand.upper() != brand:
            continue
        fams = sorted({r["NOM"] for r in rows if r["MARQUE"].upper() == brand})
        if not fams:
            continue
        pages = {u: im for u, im in sitemap_products(sitemap).items() if not SKIP.search(u.split("//", 1)[-1].split("/", 1)[-1])}
        slugs = {u: set(tokens(re.sub(r"https?://[^/]+", "", u).replace("-", " ").replace("_", " "))) for u in pages}
        found = 0
        for name in fams:
            key = f"{next(r['MARQUE'] for r in rows if r['MARQUE'].upper() == brand and r['NOM'] == name)}|{name}"
            if len(photos.get(key) or []) >= 4:
                continue
            need = [t for t in tokens(name) if t not in tokens(brand)] or tokens(name)
            if not need or all(t.isalpha() for t in need) and len(need) < 2:
                continue  # too vague ("PRO", "RACE"…) to be matched on an address
            hits = [u for u, s in slugs.items() if all(t in s for t in need) and not NOT_MOTOR.search(u.lower().replace("motor", ""))]
            if not hits:
                continue
            u = min(hits, key=lambda u: len(slugs[u]))  # the page about this model only, not a combo
            imgs = pages[u] or page_photos(u)
            imgs = [i for i in imgs if not re.search(r"(logo|icon|banner)", i, re.I)]
            if imgs:
                photos[key] = list(dict.fromkeys((photos.get(key) or []) + imgs))[:MAX_PHOTOS]
                found += 1
        added += found
        print(f"{brand}: {len(pages)} pages, {found}/{len(fams)} modèles avec photos", flush=True)
    OUT.write_text(json.dumps(photos, ensure_ascii=False, separators=(",", ":")))
    print(f"{added} modèles complétés, {sum(1 for v in photos.values() if v)} modèles avec photos")


if __name__ == "__main__":
    main()
