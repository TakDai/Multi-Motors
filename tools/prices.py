"""Collect shop prices of every motor for the price comparator.

For each motor family it searches the shops (same Shopify search as
tools/enrich.py), keeps the offers whose product is the right motor and KV,
reads price and stock of the matching variant, converts to euros with the
ECB rate of the day and divides pack prices (4 pack, set of 4…) per motor.

Result: site/data/prix.json
  {REF: {"offers": [{shop, url, price, cur, eur, stock, pack}], "eur": median, "date": "YYYY-MM-DD"}}

Usage: python tools/prices.py [--limit N] [--brand EMAX] [--refresh]
"""
import argparse, csv, json, re, statistics, sys, time
from datetime import date
from pathlib import Path
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich import SHOPS, NOT_MOTOR, product, search, tokens  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
OUT = ROOT / "site" / "data" / "prix.json"
SHOP_NAMES = {"www.racedayquads.com": "RaceDayQuads", "pyrodrone.com": "Pyrodrone", "newbeedrone.com": "NewBeeDrone",
              "shop.emax-usa.com": "Emax (officiel)", "rushfpv.net": "RushFPV (officiel)",
              "www.unmannedtechshop.co.uk": "Unmanned Tech", "betafpv.com": "BetaFPV (officiel)"}
CURRENCY = {"www.unmannedtechshop.co.uk": "GBP"}
BRAND_SHOPS = {"shop.emax-usa.com": "emax", "betafpv.com": "beta", "rushfpv.net": "rush"}
# Accessories sold "for" a motor (props, frames…) must never be taken for the motor itself
ACCESSORY = re.compile(r"\b(props?|propellers?|frames?|esc|bell|replacement|screws?|kit)\b", re.I)
PACK = re.compile(r"(\d)\s*(?:pcs|pc|pack|x)\b|set of (\d)|\((\d) ?pcs?\)|(\d)[- ]pack", re.I)


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
    seen = set()
    for shop in SHOPS:
        if shop in BRAND_SHOPS and BRAND_SHOPS[shop] not in brand.lower():
            continue
        for title, url in search(shop, f"{brand} {name}"):
            tl = title.lower()
            tt = set(tokens(title)) | set(tokens(title.replace("-", "")))
            if url in seen or ACCESSORY.search(tl) or (NOT_MOTOR.search(tl) and "motor" not in tl):
                continue
            if not all(t in tt for t in need) or (btoks and not any(b in tt or b in tl.replace("-", "") for b in btoks)):
                continue
            seen.add(url)
            p = product(url)
            if not p:
                continue
            for ref, kv in kvs.items():
                kv_re = re.compile(rf"\b{kv}\s*kv\b", re.I)
                variants = p.get("variants") or []
                if kv_re.search(p.get("title", "")):
                    pick = variants
                else:
                    pick = [v for v in variants if kv_re.search(v.get("title", ""))]
                    # A single-KV family may match a product that does not print the KV
                    if not pick and len(kvs) == 1 and not re.search(r"\d{3,5}\s*kv", p.get("title", ""), re.I):
                        pick = variants
                if not pick:
                    continue
                v = min(pick, key=lambda v: float(v.get("price") or 1e9))
                price = float(v.get("price") or 0)
                if price <= 0:
                    continue
                cur = CURRENCY.get(shop, "USD")
                pack = pack_size(p.get("title", "") + " " + (v.get("title") or ""))
                eur = round(price / rates.get(cur, 1) / pack, 2)
                link = f"{url}?variant={v['id']}" if v.get("id") and len(variants) > 1 else url
                found[ref].append({"shop": SHOP_NAMES.get(shop, shop), "url": link, "price": price, "cur": cur,
                                   "eur": eur, "stock": bool(v.get("available", True)), "pack": pack})
        time.sleep(0.3)
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--brand", default="")
    ap.add_argument("--refresh", action="store_true", help="search again families already priced")
    args = ap.parse_args()
    with CAT.open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("NOM")]
    fams = {}
    for r in rows:
        fams.setdefault((r["MARQUE"], r["NOM"]), []).append(r)
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    done = {r["REF"] for r in rows if r["REF"] in data}
    todo = [k for k, ms in fams.items()
            if (args.refresh or not all(m["REF"] in done for m in ms)) and (not args.brand or k[0].lower() == args.brand.lower())]
    if args.limit:
        todo = todo[: args.limit]
    rates = ecb_rates()
    today = date.today().isoformat()
    print(f"{len(todo)} familles, taux BCE : 1 EUR = {rates.get('USD')} USD / {rates.get('GBP')} GBP", flush=True)
    for i, (brand, name) in enumerate(todo, 1):
        try:
            found = offers_for(brand, name, fams[(brand, name)], rates)
        except Exception as e:
            print(f"  erreur {brand} {name}: {e}", flush=True)
            continue
        for ref, offers in found.items():
            # Bundles / kits sold under the same name are far above the motor price
            if offers:
                low = min(o["eur"] for o in offers)
                offers[:] = [o for o in offers if o["eur"] <= low * 2.2]
            offers.sort(key=lambda o: (not o["stock"], o["eur"]))
            data[ref] = {"offers": offers, "eur": round(statistics.median(o["eur"] for o in offers), 2) if offers else None, "date": today}
        if i % 20 == 0 or i == len(todo):
            OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
            print(f"{i}/{len(todo)}, {sum(1 for v in data.values() if v['offers'])} moteurs avec prix", flush=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
