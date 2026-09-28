"""Collect shop prices and photos of every motor (price comparator + Photos tab).

For each motor family it searches every shop of tools/shops.py (Shopify
shops, Drone-FPV-Racer, Studiosport…), keeps the offers whose product is the
right motor and KV, reads price and stock of the matching variant, converts
to euros with the ECB rate of the day and divides pack prices (4 pack, set
of 4…) per motor. The photos of the matching products are kept too.

Result: site/data/prix.json
  {REF: {"offers": [{shop, url, price, cur, eur, stock, pack, country}], "eur": median, "date": "YYYY-MM-DD"}}
and site/data/photos.json {"MARQUE|NOM": [url, ...]} (up to 10 photos per family)

Usage: python tools/prices.py [--limit N] [--brand EMAX] [--refresh] [--priced] [--sold] [--workers 6]
"""
import argparse, csv, json, re, statistics, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich import NOT_MOTOR, tokens  # noqa: E402
from shops import SHOPS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
OUT = ROOT / "site" / "data" / "prix.json"
PHOTOS = ROOT / "site" / "data" / "photos.json"
MAX_PHOTOS = 10
# Accessories sold "for" a motor (props, frames…) must never be taken for the motor itself
ACCESSORY = re.compile(r"\b(props?|propellers?|frames?|esc|bell|replacement|screws?|kit|h[ée]lices?|ch[aâ]ssis|cloche|vis)\b", re.I)
PACK = re.compile(r"(\d)\s*(?:pcs|pc|pack|x|pi[eè]ces?)\b|set of (\d)|lot de (\d)|\((\d) ?pcs?\)|(\d)[- ]pack", re.I)
# A motor name generated from KV and weight (rows of the sheet without a model name) is not searchable
UNNAMED = re.compile(r"KV · [\d.]+ g$")
# Bumped when the matching changes: older prices are searched again first (3: variant of the right KV, 4: French shops and shop country)
VERSION = 4


def ecb_rates():
    """EUR reference rates of the day (1 EUR = x CUR)."""
    try:
        xml = requests.get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", timeout=20).text
        rates = {m.group(1): float(m.group(2)) for m in re.finditer(r"currency='(\w+)' rate='([\d.]+)'", xml)}
        return rates or {"USD": 1.08, "GBP": 0.85}
    except requests.RequestException:
        return {"USD": 1.08, "GBP": 0.85}


def pack_size(text):
    m = PACK.search(text or "")
    if not m:
        return 1
    n = int(next(g for g in m.groups() if g))
    return n if 2 <= n <= 8 else 1


def offers_for(brand, name, members, rates):
    need = [t for t in tokens(name) if t not in tokens(brand)] or tokens(name)
    btoks = tokens(brand.replace("-", ""))
    kvs = {m["REF"]: str(int(float(m["KV"]))) for m in members if re.fullmatch(r"\d+(\.\d+)?", m.get("KV", ""))}
    found = {ref: [] for ref in kvs}
    photos, seen = [], set()
    for shop in SHOPS:
        if shop.brand and shop.brand not in brand.lower():
            continue
        try:
            hits = shop.search(f"{brand} {name}")
        except Exception:
            continue
        for item in hits:
            title, url = item["title"], item["url"]
            tl = title.lower()
            tt = set(tokens(title)) | set(tokens(title.replace("-", "")))
            if url in seen or ACCESSORY.search(tl) or (NOT_MOTOR.search(tl) and "motor" not in tl and "moteur" not in tl):
                continue
            if not all(t in tt for t in need) or (btoks and not any(b in tt or b in tl.replace("-", "") for b in btoks)):
                continue
            seen.add(url)
            p = shop.details(item) if item.get("lazy") else item
            if not p:
                continue
            # A product of another size of the range ("Flat Rats 1507" for a 2407) is not this motor
            fam_cls = {(m.get("CLASSE") or "").replace(",", ".")[:4] for m in members} - {""}
            title_cls = {c[:4] for c in re.findall(r"(?<![\d.])(\d{4})(?:[.,]\d)?(?![\d.,])(?!\s*kv)", p["title"], re.I)}
            if fam_cls and title_cls and not fam_cls & title_cls:
                continue
            got_one = False
            variants = p.get("variants") or []
            title_kvs = {int(a or b) for a, b in re.findall(r"(\d{3,5})\s*kv|kv\s*(\d{3,5})", p["title"], re.I)}
            # Variants named after their KV ("1600", "2400KV", "RS III 2207 2100KV")
            sizes = {int(c) for c in fam_cls | title_cls if c.isdigit()}  # "2306" in a variant is the size, not a KV
            kv_of = lambda v: {int(x) for x in re.findall(r"(?<![\d.])(\d{3,5})(?![\d.])", v["title"]) if 300 <= int(x) <= 60000} - sizes
            variants_by_kv = any(kv_of(v) for v in variants) and len(variants) > 1
            for ref, kv in kvs.items():
                k = int(kv)
                if variants_by_kv:
                    # Several KV sold under one product: only the variant of this KV
                    pick = [v for v in variants if k in kv_of(v)]
                elif k in title_kvs and len(title_kvs) == 1:
                    pick = variants  # the product is this KV (variants = colours, packs…)
                elif not title_kvs and len(kvs) == 1:
                    pick = variants  # a single-KV family and a product that does not print the KV
                else:
                    pick = []  # several KV in the title and nothing to tell them apart: not reliable
                pick = [v for v in pick if v["price"] > 0]
                if not pick:
                    continue
                # Price of one motor: the pack size of the variant ("1PCS", "4 pack") wins over the
                # title, which often lists every choice ("1 / 2 / 4 pcs"); the cheapest motor is kept
                per_motor = lambda v: v["price"] / (pack_size(v["title"]) if PACK.search(v["title"]) else pack_size(p["title"]))
                v = min(pick, key=per_motor)
                pack = pack_size(v["title"]) if PACK.search(v["title"]) else pack_size(p["title"])
                eur = round(v["price"] / rates.get(shop.cur, 1) / pack, 2) if shop.cur != "EUR" else round(v["price"] / pack, 2)
                link = f"{url}?variant={v['id']}" if v.get("id") and len(variants) > 1 else url
                found[ref].append({"shop": shop.name, "url": link, "price": v["price"], "cur": shop.cur,
                                   "eur": eur, "stock": v["stock"], "pack": pack, "country": getattr(shop, "country", "US")})
                got_one = True
            # Photos of a product that is really this motor (right KV, or the family has one KV)
            if got_one or not kvs:
                photos += p.get("images") or []
        time.sleep(0.2)
    return found, photos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--brand", default="")
    ap.add_argument("--refresh", action="store_true", help="search again families already priced")
    ap.add_argument("--priced", action="store_true", help="search again only the families that already have a price")
    ap.add_argument("--sold", action="store_true", help="only the models sold in a shop (priced, or found by tools/ranking.py)")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    with CAT.open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("NOM") and not UNNAMED.search(r["NOM"])]
    fams = {}
    for r in rows:
        fams.setdefault((r["MARQUE"], r["NOM"]), []).append(r)
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    photos = json.loads(PHOTOS.read_text()) if PHOTOS.exists() else {}
    done = {r["REF"] for r in rows if r["REF"] in data and data[r["REF"]].get("v") == VERSION}
    todo = [k for k in fams if not args.brand or k[0].lower() == args.brand.lower()]
    if args.priced:
        todo = [k for k in todo if any((data.get(m["REF"]) or {}).get("offers") for m in fams[k])]
    if args.sold:
        ranks = json.loads((ROOT / "site" / "data" / "classement.json").read_text()) if (ROOT / "site" / "data" / "classement.json").exists() else {}
        todo = [k for k in todo if any((data.get(m["REF"]) or {}).get("offers") for m in fams[k]) or (ranks.get(f"{k[0]}|{k[1]}") or {}).get("shops")]
    # Families never searched first, then the oldest prices: a daily run with --limit keeps every price fresh
    age = lambda k: min((data.get(m["REF"], {}).get("date", "") if m["REF"] in done else "") for m in fams[k])
    todo.sort(key=age)
    if not args.refresh and not args.limit and not args.priced:
        todo = [k for k in todo if age(k) == ""]
    if args.limit:
        todo = todo[: args.limit]
    rates = ecb_rates()
    today = date.today().isoformat()
    print(f"{len(todo)} familles, {len(SHOPS)} boutiques, taux BCE : 1 EUR = {rates.get('USD')} USD / {rates.get('GBP')} GBP", flush=True)
    lock, count = threading.Lock(), [0]

    def save():
        OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        PHOTOS.write_text(json.dumps(photos, ensure_ascii=False, separators=(",", ":")))

    def job(fam):
        brand, name = fam
        try:
            found, pics = offers_for(brand, name, fams[fam], rates)
        except Exception as e:
            print(f"  erreur {brand} {name}: {e}", flush=True)
            return
        with lock:
            for ref, offers in found.items():
                # One offer per shop: the cheapest (in stock first)
                best = {}
                for o in sorted(offers, key=lambda o: (not o["stock"], o["eur"])):
                    best.setdefault(o["shop"], o)
                offers[:] = list(best.values())
                # Bundles / kits sold under the same name are far above the usual price, a wrong
                # match far below it: both are left out (compared with the median, not the lowest)
                if len(offers) >= 3:
                    mid = statistics.median(o["eur"] for o in offers)
                    offers[:] = [o for o in offers if mid / 2.5 <= o["eur"] <= mid * 2.2]
                elif offers:
                    low = min(o["eur"] for o in offers)
                    offers[:] = [o for o in offers if o["eur"] <= low * 2.2]
                offers.sort(key=lambda o: (not o["stock"], o["eur"]))
                data[ref] = {"offers": offers, "eur": round(statistics.median(o["eur"] for o in offers), 2) if offers else None,
                             "date": today, "v": VERSION}
            key = f"{brand}|{name}"
            if pics:
                photos[key] = list(dict.fromkeys((photos.get(key) or []) + pics))[:MAX_PHOTOS]
            count[0] += 1
            if count[0] % 25 == 0 or count[0] == len(todo):
                save()
                print(f"{count[0]}/{len(todo)}, {sum(1 for v in data.values() if v['offers'])} moteurs avec prix, "
                      f"{sum(1 for v in photos.values() if v)} familles avec photos", flush=True)

    with ThreadPoolExecutor(args.workers) as ex:
        list(ex.map(job, todo))
    save()


if __name__ == "__main__":
    main()
