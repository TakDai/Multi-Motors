#!/usr/bin/env python3
"""Merge duplicate brands and duplicate motors in catalogue/moteurs.csv.

Brands: one name per brand. Spellings that differ only by case or punctuation
(Emax / EMAX) take the most common one; brands known under two names
(KDEDirect / KDE…) follow catalogue/marques_alias.json {"NAME AS WRITTEN": "Name to keep"}.

Model names: one spelling per model of a brand. Names that differ only by spaces,
hyphens or the decimal sign ("U8 II" / "U8II", "AT 4130" / "AT4130", "2207,5" / "2207.5")
take the most common one; other names of the same model follow
catalogue/modeles_alias.json {"Brand": [["regex of the name", "replacement"], ...]}.
The KV versions of a model thus all carry the same name and show together.

Motors:
- same brand, model name and KV: one motor, empty fields filled from the others;
- motor without a model name (a row of the sheet giving only KV, weight and power)
  that matches a named motor of the same brand (same KV, weight within 5 %, or 12 %
  when it is the only named motor of the brand with this KV):
  its values complete the named motor and the row is removed;
- motors without a name that repeat each other (brand, KV, weight): one kept.

Data keyed by "BRAND|MODEL" (site/data/photos.json, videos.json, fabricant.json, bench.json) follows the new
brand names; REF-keyed data of removed motors moves to the motor they were merged into.

Usage: python tools/dedupe.py
"""
import csv, json, re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
ALIAS = ROOT / "catalogue" / "marques_alias.json"
MODEL_ALIAS = ROOT / "catalogue" / "modeles_alias.json"
DATA = ROOT / "site" / "data"
UNNAMED = re.compile(r"KV · [\d.]+ g$")


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def key(brand):
    return re.sub(r"[^a-z0-9]", "", brand.lower())


def mkey(name):
    return re.sub(r"[\s\-_/]+", "", name.upper().replace(",", "."))


def kv(r):
    n = num(r.get("KV", ""))
    return round(n) if n else None


def fill(dst, src, cols):
    for c in cols:
        if c not in ("ID", "REF", "MARQUE", "NOM") and not dst.get(c) and src.get(c):
            dst[c] = src[c]


def main():
    with CAT.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        cols, rows = list(reader.fieldnames), list(reader)
    alias = {key(k): v for k, v in json.loads(ALIAS.read_text()).items()} if ALIAS.exists() else {}

    # --- Brands --------------------------------------------------------------
    spellings = defaultdict(Counter)
    for r in rows:
        k = key(r["MARQUE"])
        spellings[key(alias.get(k, r["MARQUE"]))][alias.get(k, r["MARQUE"])] += 1
    # The brand's own styling (iFlight, RCinPower) rather than all capitals, then the most common
    canon = {k: max(c, key=lambda s: (any(ch.islower() for ch in s), c[s])) for k, c in spellings.items()}
    for k, v in alias.items():
        canon[key(v)] = v
    renamed = {}
    for r in rows:
        old = r["MARQUE"]
        new = canon[key(alias.get(key(old), old))]
        if new != old:
            renamed[old] = new
            r["MARQUE"] = new

    # --- Model names -----------------------------------------------------------
    rules = {key(b): [(re.compile(a, re.I), rep) for a, rep in v] for b, v in json.loads(MODEL_ALIAS.read_text()).items()
             if not b.startswith("_")} if MODEL_ALIAS.exists() else {}
    fam_renamed = {}  # "brand|old name" -> "brand|new name"
    names = defaultdict(Counter)
    for r in rows:
        if r.get("NOM") and not UNNAMED.search(r["NOM"]):
            n = re.sub(r"\s+", " ", r["NOM"]).strip()
            for rx, rep in rules.get(key(r["MARQUE"]), []):
                n = rx.sub(rep, n)
            r["_nom"] = n
            names[(key(r["MARQUE"]), mkey(n))][n] += 1
    # The most common spelling, then the one with spaces (easier to read)
    best = {k: max(c, key=lambda n: (c[n], n.count(" "), n)) for k, c in names.items()}
    for r in rows:
        n = r.pop("_nom", None)
        if n is None:
            continue
        new = best[(key(r["MARQUE"]), mkey(n))]
        if new != r["NOM"]:
            fam_renamed[f"{r['MARQUE']}|{r['NOM']}"] = f"{r['MARQUE']}|{new}"
            r["NOM"] = new

    # --- Motors --------------------------------------------------------------
    moved = {}  # removed REF -> REF kept
    kept, named = [], {}
    for r in rows:
        if r.get("NOM") and not UNNAMED.search(r["NOM"]):
            k = (key(r["MARQUE"]), r["NOM"].strip().upper(), kv(r))
            if k in named:
                fill(named[k], r, cols)
                moved[r["REF"]] = named[k]["REF"]
                continue
            named[k] = r
        kept.append(r)
    by_kv = defaultdict(list)
    for r in named.values():
        by_kv[(key(r["MARQUE"]), kv(r))].append(r)
    out, seen = [], {}
    for r in kept:
        if r.get("NOM") and not UNNAMED.search(r["NOM"]):
            out.append(r)
            continue
        w = num(r.get("POIDS", ""))
        cands = [m for m in by_kv.get((key(r["MARQUE"]), kv(r)), []) if w and num(m.get("POIDS", ""))]
        # Same weight (±5 %), or ±12 % when a single named motor of the brand has this KV
        twin = next((m for m in cands if abs(num(m["POIDS"]) - w) <= 0.05 * w), None) or \
            (cands[0] if len(cands) == 1 and abs(num(cands[0]["POIDS"]) - w) <= 0.12 * w else None)
        if twin:
            fill(twin, r, cols)
            moved[r["REF"]] = twin["REF"]
            continue
        k = (key(r["MARQUE"]), kv(r), w)
        if k in seen:
            fill(seen[k], r, cols)
            moved[r["REF"]] = seen[k]["REF"]
            continue
        seen[k] = r
        out.append(r)
    for i, r in enumerate(out, 1):
        r["ID"] = str(i)
    with CAT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(out)

    # --- Data files follow ---------------------------------------------------
    brand_new = lambda k: f"{renamed.get(k.split('|', 1)[0], k.split('|', 1)[0])}|{k.split('|', 1)[1]}" if "|" in k else k
    fam_new = lambda k: fam_renamed.get(brand_new(k), brand_new(k))
    for name in ("photos", "videos"):
        p = DATA / f"{name}.json"
        if not p.exists():
            continue
        d, nd = json.loads(p.read_text()), {}
        for k, v in d.items():
            nk = fam_new(k)
            nd[nk] = list({json.dumps(x, sort_keys=True): x for x in (nd.get(nk) or []) + (v or [])}.values())
        p.write_text(json.dumps(nd, ensure_ascii=False, separators=(",", ":")))
    for name in ("fabricant", "bench"):
        p = DATA / f"{name}.json"
        if p.exists():
            d = json.loads(p.read_text())
            nd = {}
            for k, v in d.items():
                nd.setdefault(fam_new(k), v)
            p.write_text(json.dumps(nd, ensure_ascii=False, separators=(",", ":")))
    for name in ("prix", "thumbs"):
        p = DATA / f"{name}.json"
        if not p.exists():
            continue
        d = json.loads(p.read_text())
        for old, new in moved.items():
            if old in d:
                v = d.pop(old)
                d.setdefault(new, v)
        p.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))

    print(f"{len(set(fam_renamed.values()))} modèles réunis sous un seul nom ({len(fam_renamed)} écritures remplacées)")
    print(f"{len(rows)} lignes -> {len(out)} moteurs ({len(rows) - len(out)} doublons fusionnés), "
          f"{len(renamed)} écritures de marque unifiées : {', '.join(f'{a} -> {b}' for a, b in sorted(renamed.items()))}")


if __name__ == "__main__":
    main()
