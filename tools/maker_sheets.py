#!/usr/bin/env python3
"""Technical sheets from the manufacturers' own sites.

For every motor page of a manufacturer site (T-Motor for now), the spec table
("Label | value | Label | value" rows, one block per KV) and the test tables
(thrust, current, power… per throttle step) are read. Then:
  - empty catalogue fields of the matching motors are filled (logged in
    catalogue/enrichissement.csv with the page as source);
  - KV versions missing from the catalogue are added (catalogue/ajouts_boutiques.csv);
  - site/data/fabricant.json gets, per model, the official page, the whole
    official spec sheet per KV and the test tables:
      {"BRAND|MODEL": {"url": str, "site": host, "specs": {"KV" | "*": [[label, value], ...]},
                       "tests": [{"title", "headers", "rows", "source"}]}}
It also records, as the official page of a model, a catalogue link (LIEN) that
points to the manufacturer's own domain (catalogue/fabricants.json).

Usage: python tools/maker_sheets.py [--dry-run]
"""
import argparse, csv, html, json, re, sys, time
from pathlib import Path
from urllib.parse import urljoin
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bench import grid, tables_of  # noqa: E402
from enrich import plausible  # noqa: E402
from shop_motors import key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
OUT = ROOT / "site" / "data" / "fabricant.json"
MAKERS = ROOT / "catalogue" / "fabricants.json"
LOG = ROOT / "catalogue" / "enrichissement.csv"
ADDED = ROOT / "catalogue" / "ajouts_boutiques.csv"
PHOTOS = ROOT / "site" / "data" / "photos.json"
UNNAMED = re.compile(r"KV · [\d.]+ g$")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"}
session = requests.Session()
session.headers.update(UA)


def get(url):
    for i in range(3):
        try:
            r = session.get(url, timeout=40)
            if r.ok:
                return r.text
            if r.status_code in (403, 404):
                return ""
        except requests.RequestException:
            pass
        time.sleep(2 * (i + 1))
    return ""


def clean(s):
    return html.unescape(re.sub(r"\s+", " ", s or "")).replace("（", "(").replace("）", ")").replace("：", ":").strip()


# --- T-Motor (store.tmotor.com) ------------------------------------------------
class TMotor:
    brand = "T-Motor"
    host = "https://store.tmotor.com"
    categories = ["multi-rotor-drone-motor", "fixed-wing-uav-motors", "vtol-fixed-wing-motor", "agricultural-uav-motor-p-type",
                  "at-series-fixed-wing-motor", "at-series-vtol-pusher-motor", "ax-series-fixed-wing-motor", "uav-motor-u-efficiency",
                  "uav-motor-u-power", "uav-motor-u-type", "uav-mult-motor-antigravity-type", "uav-multi-motor-navigator-type",
                  "v-series-vtol-motor", "manned-aircraft-power", "gimbal-motor"]
    not_motor = re.compile(r"combo|propeller|adapter|air gear|\besc\b|^(Q\d{4}|NS\d)", re.I)

    def pages(self):
        urls = []
        for c in self.categories:
            for u in re.findall(r'href="/?(product/[a-z0-9-]+\.html)"', get(f"{self.host}/categorys/{c}")):
                urls.append(f"{self.host}/{u}")
        return list(dict.fromkeys(urls))

    @staticmethod
    def model(title):
        """'U8Ⅱ PRO Efficiency Type … KV100' -> 'U8II PRO'; 'Antigravity MN5008 KV170 …' -> 'MN5008'."""
        t = title.replace("Ⅱ", "II").replace("Ⅲ", "III").upper()
        t = re.sub(r"(\d)(II|III)(?=[A-Z])", r"\1\2 ", t)  # "U8IILITE" -> "U8II LITE"
        words = t.split()
        start = next((i for i, w in enumerate(words) if re.fullmatch(r"[A-Z]{1,2}\d[\w\-.*]*", w) and not w.startswith("KV")), None)
        if start is None:
            return ""
        name = [words[start]]
        for w in words[start + 1:]:
            if w in ("II", "III", "PRO", "LITE", "L", "XL", "XXL", "EVO", "V2.0"):
                name.append(w)
            else:
                break
        return " ".join(name)

    def read(self, url):
        page = get(url)
        if not page:
            return None
        title = clean(re.sub(r"<[^>]+>", " ", (re.search(r"<h1[^>]*>(.*?)</h1>", page, re.S) or re.search(r"<title>(.*?)</title>", page, re.S) or [None, ""])[1]))
        if self.not_motor.search(title):
            return None
        tables = [t for t in re.findall(r"<table.*?</table>", page, re.S | re.I) if "${" not in t and "{{" not in t]
        specs, tests = {"*": []}, []
        for t in tables:
            g = [[clean(c) for c in r] for r in grid(t)]
            if any(sum(bool(re.search(r"thrust|throttle|rpm|efficiency|effciency", c, re.I)) for c in r) >= 2 for r in g[:3]):
                for x in tables_of(t):
                    x["title"] = x["title"] or ""
                    tests.append(x)
                continue
            read_pairs(g, specs)
        imgs = [urljoin(url, i) for i in re.findall(r'<img[^>]+src="([^"]+/(?:uploads|upload|product)[^"]+\.(?:jpe?g|png|webp))"', page, re.I)]
        og = re.findall(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', page)
        return {"url": url, "title": title, "model": self.model(title), "specs": specs, "tests": tests,
                "images": list(dict.fromkeys(og + imgs))[:10], "sheet": self.sheet_images(page, url)}

    @staticmethod
    def sheet_images(page, url):
        """Pictures of the product description, in page order: drawings with dimensions,
        parts supplied, construction details (product photos, menus and lists excluded)."""
        out = []
        for src in re.findall(r'<img[^>]+?(?:data-src|data-original|src)="([^"]+)"', page, re.I):
            u = urljoin(url, src.strip())
            if re.search(r"goods_img|thumb_img|source_img|category_img|logo|icon|mobile|/themes/|\.gif", u, re.I):
                continue
            if not re.search(r"/images/\d{6}/[^/]+\.(jpe?g|png|webp)$|img\.tmotor\.com/products/.+\.(jpe?g|png|webp)$", u, re.I):
                continue
            out.append(u)
        seen, res = set(), []
        for u in out:
            k = re.sub(r"\.(jpe?g|png|webp)$", "", u, flags=re.I)
            if k not in seen:
                seen.add(k)
                res.append(u)
        return res[:24]


KV_LABEL = re.compile(r"^(kv|kv value|kv \(rpm/v\)|test item|motor item|model no\.?(/ ?kv)?|item no\.?)$", re.I)
SKIP_SECTION = re.compile(r"esc|prop|combination|package|packing|recommend", re.I)


def one_kv(v):
    if re.search(r"kv", v, re.I):
        ks = [a or b for a, b in re.findall(r"kv\s*(\d{2,5})|\b(\d{2,5})\s*kv\b", v, re.I)]
    else:
        ks = re.findall(r"^(\d{2,5})$", v.strip())
    ks = list(dict.fromkeys(ks))
    if re.search(r"kv\s*\d+\s*/\s*\d+", v, re.I):
        return None  # "KV400/650": several versions described together
    return ks[-1] if len(ks) == 1 else None


def read_pairs(g, specs):
    """Label/value pairs of a spec table, grouped by KV ('*' = common to every KV)."""
    # Where the previous table stopped: tables often continue each other
    cur, skip = specs.setdefault("_cur", "*"), specs.get("_skip", False)
    for r in g:
        u = [c for c in dict.fromkeys(r) if c]
        if len(u) == 1 and len(r) > 2:
            skip = bool(SKIP_SECTION.search(u[0]))  # "ESC Specs", "Prop Specs", "Tech Specs"…
            continue
        if skip and not any(KV_LABEL.match(c) and one_kv(r[j + 1]) for j, c in enumerate(r[:-1]) if j % 2 == 0):
            continue
        skip = False
        for i in range(0, len(r) - 1, 2):
            k, v = r[i], r[i + 1]
            if not k or not v or v == "/" or k == v:
                continue
            if KV_LABEL.match(k):
                kv = one_kv(v)
                if kv:
                    cur, skip = kv, False
                    specs.setdefault(cur, [])
                    continue
            specs.setdefault(cur, []).append([k, v])
    specs["_cur"], specs["_skip"] = cur, skip


def num(v):
    m = re.search(r"\d+(?:[.,]\d+)?", v or "")
    return float(m.group(0).replace(",", ".")) if m else None


def fmtn(x):
    return str(int(x)) if x == int(x) else f"{x:g}"


def fields(pairs):
    """Catalogue columns read from the official label/value pairs."""
    out = {}
    put = lambda k, v: v and k not in out and out.__setitem__(k, v)
    for k, v in pairs:
        kl, vl = k.lower(), v.lower()
        if re.search(r"package|packing|recommend|thrust|torsion|idle|ambient|insulation|balance|withdraw", kl):
            if re.search(r"propeller recommend|prop.* recommend", kl):
                put("HELICE", v[:30])
            continue
        if "resistance" in kl and "temperature" not in kl:
            x = num(v)
            if x is not None:
                put("RESISTANCE", re.sub(r"\s", "", v.split("(")[0]) if "Ω" in v else f"{fmtn(x)}mΩ")
        elif "configuration" in kl:
            m = re.search(r"(\d+)\s*N\s*(\d+)\s*P", v, re.I)
            if m:
                put("CONFIG", f"{m.group(1)}N{m.group(2)}P")
        elif "shaft" in kl and "length" not in kl:
            x = num(v)
            if x:
                put("D SHAFT", fmtn(x))
        elif re.search(r"dimension|motor size", kl):
            nums = re.findall(r"\d+(?:\.\d+)?", v)
            if len(nums) >= 2:
                put("D MOTEUR", nums[0]); put("H MOTEUR", nums[1])
        elif "weight" in kl and "exclud" not in kl and "single" not in kl:
            x = num(v)
            if x:
                put("POIDS", fmtn(x * 1000 if re.search(r"\d\s*kg", vl) else x))
        elif re.search(r"lead|cable|wire spec", kl):
            g = re.search(r"(\d+)\s*#?\s*awg", vl)
            if g:
                put("TYPE CABLE", f"{g.group(1)}AWG")
            ln = re.search(r"(\d+)\s*(mm|cm)\b", vl) or (re.search(r"\*\s*(\d{2,4})\b", vl) if "mm" in kl or "awg" in vl else None)
            if ln:
                put("L CABLE", f"{int(ln.group(1)) * (10 if ln.lastindex == 2 and ln.group(2) == 'cm' else 1)}mm")
        elif re.search(r"voltage|lipo|cells|battery", kl):
            m = re.search(r"(\d{1,2})\s*s?\s*[-~–]\s*(\d{1,2})\s*s", vl) or re.search(r"(\d{1,2})\s*s\b", vl)
            if m:
                put("LIPO", f"{m.group(1)}S-{m.group(2)}S" if m.lastindex == 2 else f"{m.group(1)}S")
        elif re.search(r"(max|peak).*current|continuous current", kl):
            x = num(v)
            if x:
                put("AMP", fmtn(x))
        elif re.search(r"max\.? ?power|rated power", kl):
            x = num(v)
            if x:
                put("PUISSANCE", fmtn(x * 1000 if re.search(r"\d\s*kw", vl) else x))
        elif re.search(r"magnet", kl):
            m = re.search(r"\bn\d{2}\w{0,2}\b", vl)
            if m:
                put("AIMANT", m.group(0).upper())
    return out


def core(name):
    """Comparable form of a model name: 'ANTIGRAVITY 5008' ~ 'MN5008', 'AS 2312 LONG SHAFT' ~ 'AT2312'."""
    s = name.upper().replace("Ⅱ", "II")
    s = re.sub(r"\b(LONG SHAFT|V2\.0|UAV|MOTOR|SET)\b", " ", s)
    s = re.sub(r"^ANTIGRAVITY\s*(MN)?", "MN", s.strip())
    s = re.sub(r"^A[ST]\s*(?=\d)", "AT", s)
    return re.sub(r"[^A-Z0-9]", "", s)


def official_domain(url, domains):
    host = re.sub(r"^https?://", "", url or "").split("/")[0].lower()
    return any(host == d or host.endswith("." + d) for d in domains)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    with CAT.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        cols, rows = list(reader.fieldnames), list(reader)
    fab = json.loads(OUT.read_text()) if OUT.exists() else {}
    photos = json.loads(PHOTOS.read_text()) if PHOTOS.exists() else {}
    refs = {r["REF"] for r in rows}
    log, added = [], []

    for maker in [TMotor()]:
        mine = [r for r in rows if key(r["MARQUE"]) == key(maker.brand)]
        brand = mine[0]["MARQUE"] if mine else maker.brand
        pages = maker.pages()
        print(f"{maker.brand}: {len(pages)} pages produit", flush=True)
        read = n_models = 0
        for url in pages:
            p = maker.read(url)
            if not p or not p["model"]:
                continue
            read += 1
            specs = {k: v for k, v in p["specs"].items() if not k.startswith("_") and v}
            kvs = [k for k in specs if k != "*"]
            if not kvs:  # one version only: its KV is in the title
                k = re.search(r"\bKV\s*(\d{2,5})\b|\b(\d{2,5})\s*KV\b", p["title"], re.I)
                if k:
                    kvs = [k.group(1) or k.group(2)]
                    specs[kvs[0]] = specs.pop("*", [])
            common = specs.get("*", [])
            want = core(p["model"])
            fam = [r for r in mine if r["NOM"] and not UNNAMED.search(r["NOM"]) and core(r["NOM"]) == want]
            name = fam[0]["NOM"] if fam else p["model"]
            cls = re.search(r"(\d{4})", p["model"])
            cls = cls.group(1) if cls and re.match(r"^(MN|AT|GB|P|V|VL|AX)", want) else ""
            n_models += 1
            for kv in kvs:
                vals = fields(specs.get(kv, []) + common)
                r = next((x for x in fam if re.sub(r"\.0$", "", x["KV"]) == kv), None)
                if r is None:
                    ref = f"{key(brand)[:4].upper()}-{cls or core(name)}-{kv}"
                    base, i = ref, 2
                    while ref in refs:
                        ref, i = f"{base}-{i}", i + 1
                    refs.add(ref)
                    r = {c: "" for c in cols}
                    r.update({"REF": ref, "MARQUE": brand, "NOM": name, "CLASSE": cls or (fam[0]["CLASSE"] if fam else ""),
                              "KV": kv, "LIEN": url, "IMG": p["images"][0] if p["images"] else ""})
                    rows.append(r)
                    mine.append(r)
                    fam.append(r)
                    added.append({"REF": ref, "MARQUE": brand, "NOM": name, "KV": kv, "SOURCE": url, "TITRE": p["title"]})
                for c, v in vals.items():
                    if c in r and not r[c] and plausible(r, c, v):
                        r[c] = v
                        log.append({"REF": r["REF"], "CHAMP": c, "VALEUR": v, "SOURCE": url})
            seen = []
            for t in p["tests"]:
                t["source"] = url
                if not any(x["headers"] == t["headers"] and x["rows"] == t["rows"] for x in seen):
                    seen.append(t)
            # Every spelling of the model in the catalogue ("AS 2312 LONG SHAFT", "AT2312 LONG SHAFT")
            for nm in dict.fromkeys(r["NOM"] for r in fam):
                fk = f"{brand}|{nm}"
                fab[fk] = {"url": url, "site": re.sub(r"^https?://", "", maker.host), "specs": {k: v for k, v in specs.items() if v}, "tests": seen,
                           "sheet": p["sheet"]}
                if p["images"]:
                    photos[fk] = list(dict.fromkeys((photos.get(fk) or []) + p["images"]))[:10]
        print(f"  {read} fiches lues, {n_models} modèles", flush=True)

    # Catalogue links that already point to the manufacturer's own site
    makers = {key(k): v for k, v in json.loads(MAKERS.read_text()).items() if not k.startswith("_")}
    from_links = 0
    for r in rows:
        doms = makers.get(key(r["MARQUE"]))
        if doms and r["NOM"] and official_domain(r["LIEN"], doms):
            fk = f"{r['MARQUE']}|{r['NOM']}"
            if not (fab.get(fk) or {}).get("url"):
                fab.setdefault(fk, {}).update({"url": r["LIEN"], "site": re.sub(r"^https?://(www\.)?", "", r["LIEN"]).split("/")[0]})
                from_links += 1

    print(f"{len(log)} valeurs complétées, {len(added)} moteurs ajoutés, {from_links} liens constructeur repris du catalogue, "
          f"{len(fab)} modèles avec une page fabricant, {sum(len(v.get('tests') or []) for v in fab.values())} tableaux d'essai")
    for a in added[:60]:
        print(f"  + {a['NOM']:<22} KV{a['KV']:<6} {a['TITRE'][:60]}")
    if args.dry_run:
        return
    for i, r in enumerate(rows, 1):
        r["ID"] = str(i)
    with CAT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    OUT.write_text(json.dumps(fab, ensure_ascii=False, separators=(",", ":")))
    PHOTOS.write_text(json.dumps(photos, ensure_ascii=False, separators=(",", ":")))
    for path, data, fields_ in ((LOG, log, ["REF", "CHAMP", "VALEUR", "SOURCE"]), (ADDED, added, ["REF", "MARQUE", "NOM", "KV", "SOURCE", "TITRE"])):
        if not data:
            continue
        new = not path.exists()
        with path.open("a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields_)
            if new:
                w.writeheader()
            w.writerows(data)


if __name__ == "__main__":
    main()
