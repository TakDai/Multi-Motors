"""Rank the motor models for the three tabs of the home page, from real shop data.

- Best-seller: each shop's motor collection sorted by its own sales
  ("sort_by=best-selling", the order Shopify computes from the orders). A model
  in the first places of several shops sells well; the score adds up, for each
  shop, how high the model is placed (1 = first, 0 = last).
- Nouveauté: the date the model was first put on sale, the oldest
  "published_at" of its products among the shops (a shop lists a motor when it
  comes out; a day when a big part of a shop was listed at once is a shop
  migration and is ignored). Models not found in any shop keep the date of their first
  appearance in the catalogue (when it came after the first imports).
- Populaire: how much the model is talked about and sold: the views of its
  YouTube reviews and tests (site/data/videos.json), the number of shops that
  sell it and its best-seller score, each on a log scale.

A product is matched to a model (brand + every word of the model name, the
right size when the title gives one); when several models match, the most
precise one (most words) wins.

Result: site/data/classement.json {"MARQUE|NOM": {"bs": 0-100, "new": "YYYY-MM-DD", "pop": 0-100, "shops": n}}

Usage: python tools/ranking.py
"""
import csv, json, math, re, sys, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich import tokens  # noqa: E402
from shops import get  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
FIRST_SEEN = ROOT / "catalogue" / "premiere_vue.json"
VIDEOS = ROOT / "site" / "data" / "videos.json"
OUT = ROOT / "site" / "data" / "classement.json"
# Shop -> its collection of motors (checked by hand: only motors, all of them)
COLLECTIONS = {
    "www.racedayquads.com": "all-motors", "pyrodrone.com": "motors", "newbeedrone.com": "drone-motors",
    "rotorriot.com": "drone-motors", "www.speedyfpv.com": "brushless-motors", "www.fpvfaster.com": "motor",
    "www.unmannedtechshop.co.uk": "brushless-motors", "shop.emax-usa.com": "brushless-motors",
    "rushfpv.net": "motor", "betafpv.com": "motors", "www.hglrc.com": "motors",
}
# Motors that entered the catalogue before this day came with the first imports
# (old and new models mixed): their arrival date says nothing about their age
FIRST_SEEN_FROM = "2026-09-28"
UNNAMED = re.compile(r"KV · [\d.]+ g$")
NOT_MOTOR = re.compile(r"\b(props?|propellers?|frames?|esc|stack|screws?|bearings?|bells?|replacement|kit|combo|drone|quad|bnf|pnp|rtf)\b", re.I)


def best_selling(host, coll):
    """Product handles of the collection in the shop's best-selling order."""
    order = []
    for page in range(1, 40):
        html = get(f"https://{host}/collections/{coll}", json=False, params={"sort_by": "best-selling", "page": page}) or ""
        new = [h for h in dict.fromkeys(re.findall(r'/products/([a-z0-9][a-z0-9-]*)', html)) if h not in order]
        if not new:
            break
        order += new
    return order


def products(host, coll):
    """Every product of the collection: handle, title, first publication date."""
    out = []
    for page in range(1, 20):
        data = get(f"https://{host}/collections/{coll}/products.json", params={"limit": 250, "page": page}) or {}
        items = data.get("products") or []
        out += [{"handle": p["handle"], "title": p.get("title", ""),
                 "date": min(filter(None, [p.get("published_at"), p.get("created_at")]), default="")[:10]} for p in items]
        if len(items) < 250:
            break
        time.sleep(0.5)
    return out


def views(v):
    """ "12,345 views" / "1.2K views" -> 12345 / 1200."""
    m = re.match(r"([\d.,]+)\s*([KMB]?)", (v or "").replace(",", ""), re.I)
    if not m:
        return 0
    return int(float(m.group(1)) * {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[m.group(2).upper()])


def main():
    with CAT.open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("NOM") and not UNNAMED.search(r["NOM"])]
    fams = {}
    for r in rows:
        fams.setdefault(f"{r['MARQUE']}|{r['NOM']}", []).append(r)
    # Words that must all be in a product title for it to be this model
    need, sizes = {}, {}
    for key, members in fams.items():
        brand, name = key.split("|", 1)
        btoks = tokens(brand.replace("-", ""))
        words = [t for t in tokens(name) if t not in btoks] or tokens(name)
        need[key] = (btoks, words)
        sizes[key] = {(m.get("CLASSE") or "").replace(",", ".")[:4] for m in members} - {""}

    def model_of(title):
        tl = title.lower()
        if NOT_MOTOR.search(tl) and "motor" not in tl:
            return None
        tt = set(tokens(title)) | set(tokens(title.replace("-", "")))
        tt |= {t[:-1] for t in tt if t.endswith("s") and not t[:-1].isdigit()}  # "Motors" names a "Motor" model
        tsize = {c[:4] for c in re.findall(r"(?<![\d.])(\d{4})(?:[.,]\d)?(?![\d.,])(?!\s*kv)", title, re.I)}
        best = None
        for key, (btoks, words) in need.items():
            if not all(w in tt for w in words) or (btoks and not any(b in tt or b in tl.replace("-", "") for b in btoks)):
                continue
            if sizes[key] and tsize and not sizes[key] & tsize:
                continue
            if not best or len(words) > len(need[best][1]):
                best = key
        return best

    with ThreadPoolExecutor(6) as ex:
        ranks = dict(zip(COLLECTIONS, ex.map(lambda h: best_selling(h, COLLECTIONS[h]), COLLECTIONS)))
        catalog = dict(zip(COLLECTIONS, ex.map(lambda h: products(h, COLLECTIONS[h]), COLLECTIONS)))

    bs, dates, shops = {}, {}, {}
    for host in COLLECTIONS:
        by_handle = {p["handle"]: p for p in catalog[host]}
        # The best-selling page only has handles: titles come from products.json (or the handle itself)
        order = [h for h in ranks[host] if h in by_handle] or ranks[host]
        seen = set()
        for i, h in enumerate(order):
            key = model_of(by_handle.get(h, {}).get("title") or h.replace("-", " "))
            if not key or key in seen:
                continue
            seen.add(key)
            bs[key] = bs.get(key, 0) + 1 - i / max(1, len(order))
        # A day when a big part of the shop was listed at once is a shop migration, not releases
        per_day = {}
        for p in catalog[host]:
            per_day[p["date"]] = per_day.get(p["date"], 0) + 1
        bulk = {d for d, n in per_day.items() if n >= 8 and n >= 0.1 * len(catalog[host])}
        for p in catalog[host]:
            key = model_of(p["title"])
            if not key:
                continue
            shops.setdefault(key, set()).add(host)
            if p["date"] and p["date"] not in bulk and (key not in dates or p["date"] < dates[key]):
                dates[key] = p["date"]
        print(f"{host}: {len(catalog[host])} produits, {len(order)} classés, {len(seen)} modèles reconnus", flush=True)

    first_seen = json.loads(FIRST_SEEN.read_text()) if FIRST_SEEN.exists() else {}
    vids = json.loads(VIDEOS.read_text()) if VIDEOS.exists() else {}
    top_bs = max(bs.values(), default=1)
    raw_pop = {}
    for key, members in fams.items():
        v = sum(views(x.get("v")) for x in vids.get(key.upper(), vids.get(key, [])) or [])
        raw_pop[key] = math.log10(1 + v) + 1.5 * math.log2(1 + len(shops.get(key, ()))) + 3 * bs.get(key, 0) / top_bs
    top_pop = max(raw_pop.values(), default=1) or 1
    out = {}
    for key, members in fams.items():
        seen_first = min((first_seen.get(m["REF"], "") for m in members if first_seen.get(m["REF"])), default="")
        seen_first = seen_first if seen_first >= FIRST_SEEN_FROM else ""
        e = {"bs": round(100 * bs.get(key, 0) / top_bs), "pop": round(100 * raw_pop[key] / top_pop),
             "new": dates.get(key) or seen_first, "shops": len(shops.get(key, ()))}
        if dates.get(key):
            e["sale"] = 1  # date of the first sale, not only of the arrival in the catalogue
        out[key] = e
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(out)} modèles : {sum(1 for e in out.values() if e['bs'])} best-sellers classés, "
          f"{sum(1 for e in out.values() if e.get('sale'))} dates de mise en vente, "
          f"{sum(1 for e in out.values() if e['shops'])} vendus en boutique")


if __name__ == "__main__":
    main()
