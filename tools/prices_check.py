"""Check every known shop offer again, every day, and keep the price history.

tools/prices.py finds offers (a few hundred models a day, by searching every shop). This
script re-reads each offer already found, which is quick, so every price on the site is
less than a day old:
- Shopify shops: the product (/products/<handle>.json), the variant of the offer (its KV,
  its pack: the price of one motor is kept), its stock;
- French shops (PrestaShop, Studiosport, Magento) and Team BlackSheep: their motor listing,
  read once, and the product page for the stock when the listing does not show it;
- an offer whose product page is gone (404 / 410) is removed; a shop that does not answer
  keeps yesterday's price (marked with its last check date).

Each offer gets "checked" (date of the last successful check). Every change of price or
stock is recorded in site/data/prix_hist.json:
  {REF: {shop: [[date, price in the shop's currency, price in EUR, in stock 1/0], ...]}}
(a point only when something changed: the graphs of the site draw steps).

Usage: python tools/prices_check.py [--limit N] [--backfill]   (--backfill: history rebuilt from git)
"""
import argparse, json, re, statistics, subprocess, sys, threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shops as S  # noqa: E402
from prices import ecb_rates, pack_size  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PRIX = ROOT / "site" / "data" / "prix.json"
HIST = ROOT / "site" / "data" / "prix_hist.json"
BY_NAME = {s.name: s for s in S.SHOPS}
per_host = defaultdict(lambda: threading.Semaphore(3))


def record(hist, ref, o, day):
    """A history point for the offer when its price or stock changed (or it is new)."""
    pts = hist.setdefault(ref, {}).setdefault(o["shop"], [])
    point = [day, o["price"], o["eur"], 1 if o.get("stock") else 0]
    if pts and pts[-1][1] == point[1] and pts[-1][3] == point[3]:
        return False
    if pts and pts[-1][0] == day:
        pts[-1] = point
    else:
        pts.append(point)
    return True


class Checker:
    def __init__(self, rates):
        self.rates, self.cache, self.lock = rates, {}, threading.Lock()

    def product(self, shop, url):
        """Shopify product JSON, once per product (several offers share it)."""
        base = url.split("?")[0]
        with self.lock:
            if base in self.cache:
                return self.cache[base]
        with per_host[urlparse(base).netloc]:
            try:
                r = S.session.get(base + ".json", timeout=25)
                res = "gone" if r.status_code in (404, 410) else (r.json().get("product") if r.ok else None)
            except Exception:
                res = None
        with self.lock:
            self.cache[base] = res
        return res

    def listing(self, shop):
        """Every product of a listing shop, by address (read once)."""
        key = "listing:" + shop.name
        with self.lock:
            if key in self.cache:
                return self.cache[key]
        try:
            items = {i["url"].split("#")[0]: i for i in shop.search("")}
        except Exception:
            items = {}
        with self.lock:
            self.cache[key] = items
        return items

    def check(self, o, kv=""):
        """Fresh copy of the offer, None when the product is gone, the same offer when unsure."""
        shop = BY_NAME.get(o["shop"])
        if not shop:
            return o
        conv = lambda price, pack: round(price / pack / (self.rates.get(shop.cur, 1) if shop.cur != "EUR" else 1), 2)
        if isinstance(shop, S.Shopify):
            p = self.product(shop, o["url"])
            if p == "gone":
                return None
            if not p:
                return o
            variants = p.get("variants") or []
            vid = (parse_qs(urlparse(o["url"]).query).get("variant") or [""])[0]
            v = next((v for v in variants if str(v.get("id")) == vid), None) if vid else (variants[0] if len(variants) == 1 else None)
            if v is None and not vid and variants:
                # Product without a variant in the address: the variant of this motor's KV when the
                # variants are named after their KV, else the cheapest of the same pack
                by_kv = [v for v in variants if kv and re.search(rf"(?<!\d){kv}(?!\d)", v.get("title") or "")]
                if not by_kv and kv and any(re.search(r"\d{3,5}\s*kv|kv\s*\d{3,5}", v.get("title") or "", re.I) for v in variants):
                    return None  # the shop lists KV variants and this KV is not one of them any more
                same = by_kv or [v for v in variants if pack_size(v.get("title") or p.get("title", "")) == o.get("pack", 1)] or variants
                v = min(same, key=lambda v: float(v.get("price") or 1e9))
            if v is None:
                return None  # the variant of this KV does not exist any more
            price = float(v.get("price") or 0)
            if price <= 0:
                return o
            pack = o.get("pack", 1)
            return {**o, "price": price, "eur": conv(price, pack), "stock": bool(v.get("available", True))}
        if hasattr(shop, "search") and not isinstance(shop, S.WooStore):
            item = self.listing(shop).get(o["url"].split("?")[0].split("#")[0])
            if not item:
                # Not in the listing any more: gone only when its page says so
                with per_host[urlparse(o["url"]).netloc]:
                    try:
                        r = S.session.get(o["url"], timeout=25)
                    except Exception:
                        return o
                return None if r.status_code in (404, 410) else o
            v = item["variants"][0]
            stock = v["stock"]
            if isinstance(shop, S.PrestaShop):
                # The category listing does not always tell the stock: the product page does
                with per_host[urlparse(o["url"]).netloc]:
                    d = shop.details(item)
                stock = d["variants"][0]["stock"] if d else stock
            pack = o.get("pack", 1)
            return {**o, "price": v["price"], "eur": conv(v["price"], pack), "stock": stock}
        return o


def backfill():
    """History from the git history of prix.json (last version of each day)."""
    log = subprocess.run(["git", "log", "--first-parent", "--reverse", "--format=%H %cs", "--", "site/data/prix.json"], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout.split()
    last = {}
    for h, d in zip(log[::2], log[1::2]):
        last[d] = h
    hist = {}
    for d, h in sorted(last.items()):
        data = json.loads(subprocess.run(["git", "show", f"{h}:site/data/prix.json"], cwd=ROOT, capture_output=True, text=True).stdout or "{}")
        for ref, v in data.items():
            for o in (v or {}).get("offers") or []:
                record(hist, ref, o, d)
    HIST.write_text(json.dumps(hist, ensure_ascii=False, separators=(",", ":")))
    print(f"historique reconstitué : {len(last)} jours, {sum(len(s) for s in hist.values())} offres, "
          f"{sum(len(p) for s in hist.values() for p in s.values())} points")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--backfill", action="store_true")
    args = ap.parse_args()
    if args.backfill:
        return backfill()
    data = json.loads(PRIX.read_text())
    import csv
    with (ROOT / "catalogue" / "moteurs.csv").open(encoding="utf-8") as f:
        kv_of = {r["REF"]: str(int(float(r["KV"]))) for r in csv.DictReader(f) if re.fullmatch(r"\d+(\.\d+)?", r.get("KV") or "")}
    hist = json.loads(HIST.read_text()) if HIST.exists() else {}
    today = date.today().isoformat()
    jobs = [(ref, i) for ref, v in data.items() for i, _ in enumerate((v or {}).get("offers") or [])]
    if args.limit:
        jobs = jobs[: args.limit]
    ck = Checker(ecb_rates())
    print(f"{len(jobs)} offres à revérifier ({len(data)} moteurs)", flush=True)
    results = {}

    def job(j):
        ref, i = j
        o = data[ref]["offers"][i]
        try:
            results[j] = ck.check(o, kv_of.get(ref, ""))
        except Exception as e:
            print(f"  erreur {o['shop']} {o['url']}: {e}", flush=True)
            results[j] = o

    with ThreadPoolExecutor(args.workers) as ex:
        list(ex.map(job, jobs))
    stats = {"vérifiées": 0, "prix changés": 0, "stock changé": 0, "retirées": 0, "sans réponse": 0}
    for ref, v in data.items():
        if not v or not v.get("offers"):
            continue
        kept = []
        for i, o in enumerate(v["offers"]):
            if (ref, i) not in results:
                kept.append(o)
                continue
            n = results[(ref, i)]
            if n is None:
                stats["retirées"] += 1
                continue
            if n is o:
                stats["sans réponse"] += 1
            else:
                stats["vérifiées"] += 1
                stats["prix changés"] += n["price"] != o["price"]
                stats["stock changé"] += n["stock"] != o["stock"]
                n["checked"] = today
            kept.append(n)
        # Same rules as prices.py: in stock first, then the cheapest; the median per motor
        kept.sort(key=lambda o: (not o["stock"], o["eur"]))
        v["offers"] = kept
        v["eur"] = round(statistics.median(o["eur"] for o in kept), 2) if kept else None
        for o in kept:
            record(hist, ref, o, o.get("checked") or v.get("date") or today)
    PRIX.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    HIST.write_text(json.dumps(hist, ensure_ascii=False, separators=(",", ":")))
    print("offres : " + ", ".join(f"{k} {n}" for k, n in stats.items()))


if __name__ == "__main__":
    main()
