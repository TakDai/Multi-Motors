#!/usr/bin/env python3
"""Add to the catalogue the motors sold by the shops that it does not list yet.

Reads the whole motor category of each shop (Shopify collections, Drone-FPV-Racer,
Studiosport), recognises brand, model, stator class and KV in each product, and:
- skips it when the catalogue already has this brand + model + KV;
- adds the missing KV to a model the catalogue knows;
- adds the model otherwise.
Specs come from the product description (same reader and plausibility checks as
tools/enrich.py), the photos go to site/data/photos.json and every added motor is
listed with its source in catalogue/ajouts_boutiques.csv.

Usage: python tools/shop_motors.py [--dry-run]
"""
import argparse, csv, html, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich import parse, plausible, tokens  # noqa: E402
from shops import SHOPS as ADAPTERS, get  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
LOG = ROOT / "catalogue" / "ajouts_boutiques.csv"
PHOTOS = ROOT / "site" / "data" / "photos.json"
ALIAS = ROOT / "catalogue" / "marques_alias.json"
COLLECTIONS = {
    "www.racedayquads.com": "all-motors", "pyrodrone.com": "motors", "newbeedrone.com": "drone-motors",
    "rotorriot.com": "drone-motors", "www.speedyfpv.com": "brushless-motors", "www.fpvfaster.com": "motor",
    "www.unmannedtechshop.co.uk": "motors", "shop.emax-usa.com": "brushless-motors", "rushfpv.net": "motor",
    "betafpv.com": "motors", "www.hglrc.com": "motors", "www.diatone.us": "motor", "sunnyskyusa.com": "multirotor-motors",
}
# Not a motor on its own, even in a motor category
NOT_MOTOR = re.compile(r"\b(bells?|screws?|shafts?|bearings?|props?|propellers?|frames?|esc|stack|mount|mounts|guards?|"
                       r"covers?|protectors?|wires?|cables?|tools?|magnets?|stator only|replacement|spare|kit|bnf|pnp|rtf|"
                       r"drone|quad(copter)?|servo|gimbal|h[ée]lices?|vis|cloches?|roulements?|axes?)\b", re.I)
NOISE = re.compile(r"\b(brushless|fpv|drone|racing|race|freestyle|cinematic|cinewhoop|long[- ]?range|motors?|moteurs?|"
                   r"multirotor|multicopter|quadcopter|for|with|and|pour|avec|new|nouveau|edition|single|pcs?|pack|set|of|lot|de|"
                   r"series|version|unibell|motor|micro|whoop|choose|your|color|colour|cw|ccw|titanium)\b", re.I)


NOT_BRANDS = {"editionyukisavage", "unite", "camerabutter", "fpvstorerc", "fpvelite", "hqprop", "sequre", "quadifier", "hypetrain"}
# Accessories whose title mentions the motor they fit ("bearing for 22xx motors")
ACCESSORY = re.compile(r"\b(roulements?|bearings?|plugs?|screws?|vis|magnets?|aimants?|stators? only|connecteurs?|connectors?|"
                       r"guards?|tubes?|protections?|covers?|brushed|coreless|[àa] balais)\b", re.I)  # not brushless motors
# Words that only mean "accessory" when the title gives no KV ("spare part motor 16000KV" is a motor)
MAYBE_ACCESSORY = re.compile(r"\b(replacement|spare|kit|bells?|cloches?|shafts?)\b", re.I)
COLORS = r"(black|white|red|blue|green|orange|gold|golden|silver|grey|gray|purple|pink|yellow|rainbow|royal|gunmetal|titanium|" \
         r"noir|blanc|rouge|bleu|vert|violet|jaune|&|and|et|/)"


ALIASES = {k: v for k, v in json.loads((Path(__file__).resolve().parent.parent / "catalogue" / "marques_alias.json").read_text()).items()}


def key(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def shopify_products(host, handle):
    out, page = [], 1
    while page <= 12:
        data = get(f"https://{host}/collections/{handle}/products.json", params={"limit": 250, "page": page}) or {}
        items = data.get("products", [])
        for p in items:
            out.append({"title": p.get("title", ""), "vendor": p.get("vendor", ""), "body": p.get("body_html") or "",
                        "url": f"https://{host}/products/{p.get('handle')}",
                        "kvs": [v.get("title", "") for v in p.get("variants", [])] + [o for opt in p.get("options", []) for o in opt.get("values", [])],
                        "images": [i["src"].split("?")[0] for i in p.get("images", []) if i.get("src")], "shop": host})
        if len(items) < 250:
            break
        page += 1
    return out


def other_products():
    out = []
    for a in ADAPTERS:
        if a.name in ("Drone-FPV-Racer", "Studiosport"):
            for it in a.search(""):
                out.append({"title": it["title"], "vendor": "", "body": "", "url": it["url"], "kvs": [],
                            "images": it.get("images", []), "shop": a.host, "adapter": a, "item": it})
    return out


def brand_of(p, brands, shop_names):
    """A known brand written in the title first, then the shop's vendor or the brand written last."""
    title = html.unescape(p["title"])
    # Brand = one to three whole words of the title ("flash hobby", "t motor"), never a piece of a word
    words = re.findall(r"[a-z0-9]+", title.lower())
    grams = {"".join(words[i:i + n]): n for n in (1, 2, 3) for i in range(len(words) - n + 1)}
    hits = [(k, b) for k, b in brands.items() if len(k) >= 3 and k in grams]
    if hits:
        return max(hits, key=lambda kb: len(kb[0]))[1]
    v = key(p["vendor"])
    if v and v in brands and v not in shop_names:
        return brands[v]
    # Drone-FPV-Racer / Studiosport write the brand at the end: "Moteur Cine77 - 777KV - T-Motor"
    parts = re.split(r"\s[-–]\s", title)
    tail = parts[-1].strip()
    if p.get("adapter") and len(parts) > 1 and not re.search(r"\d", tail) and len(tail) <= 24 and key(tail) not in NOT_BRANDS:
        return brands.get(key(tail), tail)
    # A brand the catalogue does not know yet: the vendor given by the shop
    if v and v not in shop_names and v not in NOT_BRANDS and len(p["vendor"]) <= 24:
        return p["vendor"].strip()
    return ""


def model_of(title, brand, from_adapter=False):
    t = html.unescape(title).replace("’", "'")
    t = re.sub(r"\((?:[^)]*)\)|\[[^]]*\]", " ", t)
    # "Name - 2207.5 Motor - 1400KV/1900KV - Black": keep the parts that name the motor
    parts = [x for x in re.split(r"\s[-–|]\s", t) if x.strip()]
    if from_adapter and len(parts) > 1:
        parts = parts[:-1]  # the brand, written last by these shops
    keep = [x for x in parts if not re.fullmatch(r"[\s\d/,kKvV-]*|\s*(choose|select|color|colour|pack|set).*", x.strip(), re.I)
            and not re.fullmatch(rf"\s*({COLORS}\s*)+", x, re.I)
            and not re.fullmatch(r"\s*(" + NOISE.pattern.strip("\\b()") + r"|\s)+\s*", x, re.I)]
    t = " ".join(keep or parts[:1])
    t = re.sub(r"\b\d{3,5}\s*kv(?![a-z\d])|\bkv\s*\d{3,5}\b", " ", t, flags=re.I)
    t = re.sub(r"(?<![\w.])\d{1,2}\s*(?:[-~]|to)?\s*\d{0,2}\s*s\b(?:\s*lipo)?", " ", t, flags=re.I)
    t = re.sub(r"\b\d+(?:\.\d+)?\s*mm\s*shaft\b|\bw/\s*m\d\s*shaft\b|\b[\d.]+(?:\s*-\s*[\d.]+)?\s*(?:inch(?:es)?|\")(?=\s|$)", " ", t, flags=re.I)
    t = re.sub(r"\b\d\s*(?:x|pcs?|pack|p)\b|\bx\s*\d\b|\bset of \d\b|\blot de \d\b|\b\d-pack\b|\bspare parts?\b|\bcombo\b|\bpairs?\b|"
               r"\bpower system\b|\b(?:2x\s*)?c?cw\b", " ", t, flags=re.I)
    for w in re.split(r"[\s-]+", brand) + [brand] + [a for a, b in ALIASES.items() if b == brand]:
        t = re.sub(rf"\b{re.escape(w)}\b", " ", t, flags=re.I)
    # Brand written with spaces or hyphens (Flash Hobby, T-Motor) and shop house marks
    t = re.sub(r"\b" + r"[\s-]?".join(map(re.escape, key(brand))) + r"\b", " ", t, flags=re.I)
    t = re.sub(r"\b(rdq|rotor riot|pyrodrone|newbeedrone|speedyfpv|fpvfaster|moteur|moteurs)\b", " ", t, flags=re.I)
    t = re.sub(r"\b(fixed wing|long shaft|power|\d+(?:-\d+)?\s*cc|mobula\d*|tinyhawk\s*\w*|kit(?: de \d+)?|by|hobby|"
               r"(?:to|for) .*drones?|lig?h?tweight)\b", " ", t, flags=re.I)
    t = NOISE.sub(" ", t)
    t = re.sub(rf"(\s{COLORS})+\s*$", " ", t, flags=re.I)
    t = re.sub(r"[^\w.\s/'-]", " ", t)
    t = re.sub(r"(?<=\w)-(?=\s|$)|(?<=\s)[-./]+(?=\s|$)|(?<=\s)\.(?=\s|$)", " ", " " + t + " ")
    return re.sub(r"\s+", " ", t).strip(" -/.").upper()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    with CAT.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        cols, rows = list(reader.fieldnames), list(reader)
    alias = {key(k): v for k, v in json.loads(ALIAS.read_text()).items()} if ALIAS.exists() else {}
    brands = {}
    for r in rows:
        brands.setdefault(key(r["MARQUE"]), r["MARQUE"])
    for k, v in alias.items():
        brands[k] = v
    shop_names = {key(a.name) for a in ADAPTERS} | {"racedayquads", "pyrodrone", "newbeedrone", "rotorriot", "speedyfpv",
                                                     "fpvfaster", "unmannedtech", "unmannedtechshop", "rdq"}
    known = {}  # (brand, model tokens) -> {kv: row}
    for r in rows:
        known.setdefault(key(r["MARQUE"]), []).append(r)
    refs = {r["REF"] for r in rows}

    products = [p for h, c in COLLECTIONS.items() for p in shopify_products(h, c)] + other_products()
    print(f"{len(products)} produits lus", flush=True)
    added, new_models, skipped = [], set(), {"pas un moteur": 0, "marque inconnue": 0, "déjà là": 0, "sans modèle": 0}
    photos = json.loads(PHOTOS.read_text()) if PHOTOS.exists() else {}
    seen = set()
    for p in products:
        title = html.unescape(p["title"])
        has_kv = re.search(r"\d{3,5}\s*kv|\bkv\s*\d{3,5}", title, re.I)
        if (NOT_MOTOR.search(title) and not re.search(r"\bmotors?\b|\bmoteurs?\b", title, re.I)) or ACCESSORY.search(title) \
                or (MAYBE_ACCESSORY.search(title) and not has_kv) or re.search(r"\b(esc|stack|frame|props?)\b", title, re.I):
            skipped["pas un moteur"] += 1
            continue
        brand = brand_of(p, brands, shop_names)
        if not brand:
            skipped["marque inconnue"] += 1
            continue
        model = model_of(title, brand, bool(p.get("adapter")))
        cls = re.search(r"(?<![\d.])(\d{4}(?:[.,]\d)?)(?![\d])", title)
        cls = cls.group(1).replace(",", ".") if cls else ""
        # The stator size is part of the name: two sizes of a range are two models
        if cls and cls not in model.replace(",", "."):
            model = f"{model} {cls}".strip()
        if not model or not re.search(r"\d", model):
            skipped["sans modèle"] += 1
            continue
        kvs = sorted({int(k) for s in [title] + p["kvs"] for k in re.findall(r"(?<![\w.])(\d{3,5})\s*kv(?![a-z\d])|\bkv\s*(\d{3,5})\b", str(s), re.I)
                      for k in [k[0] or k[1]] if 100 <= int(k) <= 60000})
        mtoks = set(tokens(model))
        fam = [r for r in known.get(key(brand), []) if r["NOM"] and set(tokens(r["NOM"])) and
               (key(r["NOM"]) == key(model) or set(tokens(r["NOM"])) <= mtoks or mtoks <= set(tokens(r["NOM"])))
               and (not cls or not r["CLASSE"] or r["CLASSE"].replace(",", ".") == cls)]
        have = {round(float(r["KV"])) for r in fam if re.fullmatch(r"\d+(\.\d+)?", r["KV"] or "")}
        missing = [k for k in (kvs or [None]) if (k is None and not fam) or (k is not None and k not in have)]
        if not missing:
            skipped["déjà là"] += 1
            continue
        name = fam[0]["NOM"] if fam else model
        if (key(brand), key(name), tuple(missing)) in seen:
            continue
        seen.add((key(brand), key(name), tuple(missing)))
        body = p["body"]
        if not body and p.get("adapter"):
            page = get(p["url"], json=False) or ""
            body = page
        specs = parse(body, title) if body else {}
        for kv in missing:
            ref = f"{key(brand)[:4].upper()}-{cls or 'X'}-{kv or 'X'}"
            base, i = ref, 2
            while ref in refs:
                ref, i = f"{base}-{i}", i + 1
            refs.add(ref)
            r = {c: "" for c in cols}
            r.update({"REF": ref, "MARQUE": brand, "NOM": name, "CLASSE": cls or (fam[0]["CLASSE"] if fam else ""), "KV": str(kv or ""),
                      "LIEN": p["url"], "IMG": p["images"][0] if p["images"] else ""})
            for c, v in specs.items():
                if c in r and not r[c] and plausible(r, c, v) and (c not in ("POIDS", "AMP", "PUISSANCE", "RESISTANCE", "LIPO") or len(missing) == 1):
                    r[c] = v
            rows.append(r)
            known.setdefault(key(brand), []).append(r)
            added.append({"REF": ref, "MARQUE": brand, "NOM": name, "KV": kv or "", "SOURCE": p["url"], "TITRE": title})
            if not fam:
                new_models.add((brand, name))
        if p["images"]:
            fk = f"{brand}|{name}"
            photos[fk] = list(dict.fromkeys((photos.get(fk) or []) + p["images"]))[:10]

    print(f"{len(added)} moteurs à ajouter dont {len(new_models)} nouveaux modèles ; ignorés : {skipped}")
    import random
    random.seed(7)
    for a in random.sample(added, min(40, len(added))):
        print(f"  {a['MARQUE']:<14} {a['NOM']:<28} {str(a['KV']):>6}  <- {a['TITRE'][:70]}")
    print("nouvelles marques :", sorted({a['MARQUE'] for a in added} - set(brands.values())))
    if args.dry_run:
        return
    for i, r in enumerate(rows, 1):
        r["ID"] = str(i)
    with CAT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    PHOTOS.write_text(json.dumps(photos, ensure_ascii=False, separators=(",", ":")))
    new = not LOG.exists()
    with LOG.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["REF", "MARQUE", "NOM", "KV", "SOURCE", "TITRE"])
        if new:
            w.writeheader()
        w.writerows(added)


if __name__ == "__main__":
    main()
