"""Collect shop prices and photos of every motor (price comparator + Photos tab).

For each motor family it searches every shop of tools/shops.py (Shopify
shops, Drone-FPV-Racer, Studiosport…), keeps the offers whose product is the
right motor and KV, reads price and stock of the matching variant, converts
to euros with the ECB rate of the day and divides pack prices (4 pack, set
of 4…) per motor. The photos of the matching products are kept too.

Result: site/data/prix.json
  {REF: {"offers": [{shop, url, price, cur, eur, stock, pack}], "eur": median, "date": "YYYY-MM-DD"}}
and site/data/photos.json {"MARQUE|NOM": [url, ...]} (up to 10 photos per family)

Usage: python tools/prices.py [--limit N] [--brand EMAX] [--refresh] [--workers 6]
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
            got_one = False
            for ref, kv in kvs.items():
                kv_re = re.compile(rf"\b{kv}\s*kv\b", re.I)
                variants = p.get("variants") or []
                if kv_re.search(p["title"]):
                    pick = variants
                else:
                    pick = [v for v in variants if kv_re.search(v["title"])]
                    # A single-KV family may match a product that does not print the KV
                    if not pick and len(kvs) == 1 and not re.search(r"\d{3,5}\s*kv", p["title"], re.I):
                        pick = variants
                pick = [v for v in pick if v["price"] > 0]
                if not pick:
                    continue
                v = min(pick, key=lambda v: v["price"])
                pack = pack_size(p["title"] + " " + v["title"])
                eur = round(v["price"] / rates.get(shop.cur, 1) / pack, 2) if shop.cur != "EUR" else round(v["price"] / pack, 2)
                link = f"{url}?variant={v['id']}" if v.get("id") and len(variants) > 1 else url
                found[ref].append({"shop": shop.name, "url": link, "price": v["price"], "cur": shop.cur,
                                   "eur": eur, "stock": v["stock"], "pack": pack})
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
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    with CAT.open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("NOM") and not UNNAMED.search(r["NOM"])]
    fams = {}
    for r in rows:
        fams.setdefault((r["MARQUE"], r["NOM"]), []).append(r)
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    photos = json.loads(PHOTOS.read_text()) if PHOTOS.exists() else {}
    done = {r["REF"] for r in rows if r["REF"] in data and data[r["REF"]].get("v") == 2}
    todo = [k for k in fams if not args.brand or k[0].lower() == args.brand.lower()]
    # Families never searched first, then the oldest prices: a daily run with --limit keeps every price fresh
    age = lambda k: min((data.get(m["REF"], {}).get("date", "") if m["REF"] in done else "") for m in fams[k])
    todo.sort(key=age)
    if not args.refresh and not args.limit:
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
                # Bundles / kits sold under the same name are far above the motor price
                if offers:
                    low = min(o["eur"] for o in offers)
                    offers[:] = [o for o in offers if o["eur"] <= low * 2.2]
                offers.sort(key=lambda o: (not o["stock"], o["eur"]))
                data[ref] = {"offers": offers, "eur": round(statistics.median(o["eur"] for o in offers), 2) if offers else None,
                             "date": today, "v": 2}
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
