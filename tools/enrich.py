"""Complete the motor catalogue from product pages of FPV shops.

For every motor family (brand + model name) it looks the product up in shops
that publish their catalogue as JSON (Shopify), reads the "Key: value" lines
of the product description and fills the EMPTY fields only. Existing values
are never overwritten. Every added value is logged with its source in
catalogue/enrichissement.csv, and families already searched are remembered in
catalogue/enrichissement_fait.json so the job can run in several passes.

Usage: python tools/enrich.py [--limit N] [--brand EMAX]
"""
import argparse, csv, html, json, re, sys, time
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
LOG = ROOT / "catalogue" / "enrichissement.csv"
DONE = ROOT / "catalogue" / "enrichissement_fait.json"
EXTRA_COLS = ["RESISTANCE", "UTILISATION"]
SHOPS = ["www.racedayquads.com", "pyrodrone.com", "newbeedrone.com", "shop.emax-usa.com",
         "rushfpv.net", "www.unmannedtechshop.co.uk", "betafpv.com"]
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
NOT_MOTOR = re.compile(r"\b(quadcopter|whoop|drone kit|bnf|pnp|rtf|frame|esc|stack|propellers?|props?|"
                       r"flight controller|receiver|goggles?|camera|battery|bell|screws?|shaft kit|replacement)\b", re.I)
KV_SPECIFIC = {"POIDS", "AMP", "PUISSANCE", "LIPO", "RESISTANCE"}

session = requests.Session()
session.headers.update(UA)


def get_json(url, **params):
    for attempt in range(3):
        try:
            r = session.get(url, params=params, timeout=20)
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            if r.ok:
                return r.json()
            return None
        except (requests.RequestException, ValueError):
            time.sleep(1)
    return None


def tokens(s):
    return [t for t in re.findall(r"[a-z0-9]+", s.lower()) if len(t) >= 2 or t.isdigit()]


def search(shop, query):
    data = get_json(f"https://{shop}/search/suggest.json", q=query,
                    **{"resources[type]": "product", "resources[limit]": 8})
    try:
        return [(p["title"], f"https://{shop}{p['url'].split('?')[0]}") for p in data["resources"]["results"]["products"]]
    except (TypeError, KeyError):
        return []


def product(url):
    data = get_json(url + ".json")
    return data.get("product") if data else None


# --- Spec parsing ------------------------------------------------------------
def lines_of(body):
    t = re.sub(r"<(br|/p|/li|/tr|/h\d|/div)[^>]*>", "\n", body or "", flags=re.I)
    t = re.sub(r"</t[dh]>\s*<t[dh][^>]*>", ": ", t, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    out = []
    for l in t.split("\n"):
        l = re.sub(r"\s+", " ", l).strip(" -•*|\t")
        if ":" in l and len(l) < 160:
            k, v = l.split(":", 1)
            out.append((k.strip().lower(), v.strip()))
    return out


def n(v):
    m = re.search(r"\d+(?:[.,]\d+)?", v)
    return m.group(0).replace(",", ".") if m else ""


def parse(body, title):
    specs = {}
    put = lambda k, v: v and k not in specs and specs.__setitem__(k, v)
    for k, v in lines_of(body):
        low = v.lower()
        if re.search(r"\bweight\b|\bpoids\b", k):
            if not re.search(r"thrust|prop", k):
                put("POIDS", n(v))
        elif re.search(r"(motor )?(dimension|size)s?\b|dia\w* ?[x*] ?len", k) and not re.search(r"stator|shaft|bearing|prop", k):
            nums = re.findall(r"\d+(?:\.\d+)?", v.replace(",", "."))
            if len(nums) >= 2 and 5 < float(nums[0]) < 120 and 3 < float(nums[1]) < 120:
                put("D MOTEUR", nums[0]); put("H MOTEUR", nums[1])
        elif re.search(r"(bearing )?shaft( diameter| dia|$)|prop shaft|shaft size", k) and "length" not in k:
            put("D SHAFT", n(v))
            if re.search(r"\bm5\b", low):
                put("VIS HEL", "M5")
            if "hollow" in low:
                put("TYPE SHAFT", "Creux")
        elif re.search(r"shaft (length|protruding)|protruding", k):
            put("L SHAFT", n(v))
        elif re.search(r"thread|prop adapter|prop nut", k) and re.search(r"\bm\d", low):
            put("VIS HEL", re.search(r"m\d(?:\.\d)?", low).group(0).upper())
        elif re.search(r"mount|hole|fixation", k) and "prop" not in k:
            m = re.search(r"(\d+(?:\.\d+)?)\s*[x*×]\s*(\d+(?:\.\d+)?)", v)
            if m:
                put("ENTRAXE FIX", f"{m.group(1)}x{m.group(2)}")
            elif re.search(r"[φø∅]\s*\d", low):
                put("ENTRAXE FIX", "Ø" + n(v))
            s = re.search(r"\bm(\d(?:\.\d)?)\b", low)
            if s:
                put("VIS FIX", "M" + s.group(1))
        elif re.search(r"cells?|lipo|input volt|voltage", k) and not re.search(r"idle|current", k):
            m = re.search(r"(\d)\s*s?\s*[-~–]\s*(\d)\s*s", low) or re.search(r"(\d)\s*s\b", low)
            if m:
                put("LIPO", f"{m.group(1)}S-{m.group(2)}S" if m.lastindex == 2 else f"{m.group(1)}S")
        elif re.search(r"config|framework|pole|slot", k):
            m = re.search(r"(\d+)\s*n\s*(\d+)\s*p", low)
            if m:
                put("CONFIG", f"{m.group(1)}N{m.group(2)}P")
        elif re.search(r"lead|wire|cable|outlet", k):
            g = re.search(r"(\d+)\s*#?\s*awg", low)
            if g:
                put("TYPE CABLE", f"{g.group(1)}AWG")
            ln = re.search(r"(\d+)\s*mm", low)
            if ln:
                put("L CABLE", f"{ln.group(1)}mm")
        elif re.search(r"prop", k) and not re.search(r"thread|adapter|shaft|nut|mount", k):
            put("HELICE", v[:30])
        elif re.search(r"(max|peak).*(power|watt)|power.*max|^power", k):
            put("PUISSANCE", n(v))
        elif re.search(r"(max|peak).*current|current.*max|max.*amp", k) and "idle" not in k:
            put("AMP", n(v))
        elif re.search(r"resistance", k):
            put("RESISTANCE", v[:20])
        elif re.search(r"magnet", k):
            m = re.search(r"n\d{2}\w{0,2}", low)
            if m:
                put("AIMANT", m.group(0).upper())
        elif re.search(r"bell", k):
            put("CLOCHE", v[:20])
    # Intended use, only when the product says so
    intro = re.sub(r"<[^>]+>", " ", body or "")[:400]
    use = re.search(r"\b(freestyle|racing|cinewhoop|long[- ]range|toothpick|whoop|cinematic)\b", (title + " " + intro).lower())
    if use:
        specs["UTILISATION"] = use.group(1).replace("-", " ").title()
    return specs


# --- Matching ----------------------------------------------------------------
def best_match(brand, name, kvs):
    need = [t for t in tokens(name) if t not in tokens(brand)] or tokens(name)
    btoks = tokens(brand.replace("-", ""))
    found = []
    brand_shops = {"shop.emax-usa.com": "emax", "betafpv.com": "beta", "rushfpv.net": "rush"}
    for shop in SHOPS:
        if shop in brand_shops and brand_shops[shop] not in brand.lower():
            continue
        for title, url in search(shop, f"{brand} {name}"):
            tl = title.lower()
            tt = set(tokens(title)) | set(tokens(title.replace("-", "")))
            if NOT_MOTOR.search(tl) and "motor" not in tl:
                continue
            # Props / frames sold "for" a motor mention the motor too
            if re.search(r"\b(props?|propellers?|frames?|replacement bell|screws?)\b", tl):
                continue
            if not all(t in tt for t in need):
                continue
            if btoks and not any(b in tt or b in tl.replace("-", "") for b in btoks):
                continue
            kv_hit = [kv for kv in kvs if kv and re.search(rf"\b{kv}\s*kv\b", tl)]
            found.append((len(kv_hit), shop, title, url, kv_hit))
        time.sleep(0.3)
        if any(f[0] for f in found):
            break
    found.sort(key=lambda f: -f[0])
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="max families to search this run")
    ap.add_argument("--brand", default="")
    args = ap.parse_args()

    with CAT.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        cols = list(reader.fieldnames)
        rows = list(reader)
    for c in EXTRA_COLS:
        if c not in cols:
            cols.append(c)
    done = set(json.loads(DONE.read_text())) if DONE.exists() else set()

    families = {}
    for r in rows:
        if r.get("NOM"):
            families.setdefault((r["MARQUE"], r["NOM"]), []).append(r)
    todo = [k for k in families if f"{k[0]}|{k[1]}" not in done and (not args.brand or k[0].lower() == args.brand.lower())]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(todo)} familles à chercher ({len(families)} au total)", flush=True)

    new_log = []
    filled_fam = 0
    for i, (brand, name) in enumerate(todo, 1):
        members = families[(brand, name)]
        kvs = [str(int(float(m["KV"]))) if n(m.get("KV", "")) else "" for m in members]
        try:
            matches = best_match(brand, name, kvs)
        except Exception as e:
            print(f"  erreur {brand} {name}: {e}", file=sys.stderr)
            matches = []
        added = 0
        for _, shop, title, url, kv_hit in matches[:3]:
            p = product(url)
            if not p:
                continue
            specs = parse(p.get("body_html"), p.get("title", ""))
            img = (p.get("images") or [{}])[0].get("src", "")
            for m, kv in zip(members, kvs):
                # KV-specific values only go to the matching KV (or a single-KV family)
                kv_ok = kv in kv_hit or (len(members) == 1 and not kv_hit)
                for col, v in specs.items():
                    if col in KV_SPECIFIC and not kv_ok:
                        continue
                    if v and not m.get(col):
                        m[col] = v
                        new_log.append({"REF": m["REF"], "CHAMP": col, "VALEUR": v, "SOURCE": url})
                        added += 1
                if kv_ok or len(matches) == 1:
                    for col, v in (("LIEN", url), ("IMG", img)):
                        if v and not m.get(col):
                            m[col] = v
                            new_log.append({"REF": m["REF"], "CHAMP": col, "VALEUR": v, "SOURCE": url})
                            added += 1
        done.add(f"{brand}|{name}")
        filled_fam += bool(added)
        if i % 25 == 0 or i == len(todo):
            print(f"{i}/{len(todo)} familles, {filled_fam} complétées, {len(new_log)} valeurs ajoutées", flush=True)
            save(cols, rows, new_log, done)
            new_log = []
    save(cols, rows, new_log, done)


def save(cols, rows, new_log, done):
    tmp = CAT.with_suffix(".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    tmp.replace(CAT)
    new = not LOG.exists()
    with LOG.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["REF", "CHAMP", "VALEUR", "SOURCE"])
        if new:
            w.writeheader()
        w.writerows(new_log)
    DONE.write_text(json.dumps(sorted(done), ensure_ascii=False))


if __name__ == "__main__":
    main()
