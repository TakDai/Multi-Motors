"""Import the Google Sheet motor catalogue (one tab per brand) into catalogue/moteurs.csv.

Usage: python tools/import_sheet.py <export.xlsx>
       (export: https://docs.google.com/spreadsheets/d/<ID>/export?format=xlsx)

Cleaning:
- "www,site,com" / "10,7": commas typed instead of dots are fixed
- VOLTAGE (a formula giving 0) is recomputed from LIPO (3.7 V per cell)
- rows whose columns are shifted (no name, no class, weight in H MOTEUR,
  max power in AIMANT) are realigned: they either complete the catalogue
  motor with the same brand, KV and weight, or are added as a motor named
  after its KV and weight; only rows that stay unusable go to
  catalogue/a_verifier.csv
- duplicate REFs are merged (first complete value wins)
- rows already in catalogue/moteurs.csv (hand-checked) keep their values;
  the sheet only fills their empty fields
"""
import csv, re, sys
from pathlib import Path
import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
CHECK = ROOT / "catalogue" / "a_verifier.csv"
COLS = ["ID", "REF", "MARQUE", "NOM", "VERSION", "CLASSE", "KV", "POIDS", "H STATOR", "D STATOR", "H MOTEUR",
        "D MOTEUR", "D SHAFT", "L SHAFT", "TYPE SHAFT", "VIS HEL", "VIS FIX", "ENTRAXE FIX", "LIPO", "VOLTAGE",
        "L CABLE", "TYPE CABLE", "HELICE", "PUISSANCE", "AMP", "AIMANT", "CLOCHE", "CONFIG", "LIEN", "IMG",
        "RESISTANCE", "UTILISATION"]
NUMERIC = {"KV", "POIDS", "H MOTEUR", "D MOTEUR", "D SHAFT", "L SHAFT", "PUISSANCE", "AMP"}
ALIASES = {"POID": "POIDS"}


def clean(col, v):
    if v is None:
        return ""
    if isinstance(v, float):
        v = f"{v:g}"
    v = str(v).strip()
    if v in ("0", "None") and col not in ("KV",):
        return "" if col == "VOLTAGE" else v
    if col in ("LIEN", "IMG"):
        # URLs were typed with commas instead of dots
        if v.startswith("http") and "," in v:
            v = v.replace(",", ".")
        return v if v.startswith("http") else ""
    if re.fullmatch(r"-?\d+,\d+", v):
        v = v.replace(",", ".")
    if col == "CLASSE" and re.fullmatch(r"\d{3}", v):
        v = "0" + v  # 802 -> 0802
    return v


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def lipo_voltage(lipo):
    cells = [int(c) for c in re.findall(r"(\d+)\s*S", lipo.upper())]
    if not cells:
        return ""
    lo, hi = min(cells), max(cells)
    f = lambda n: f"{n * 3.7:.1f}".rstrip("0").rstrip(".")
    return f"{f(lo)}V" if lo == hi else f"{f(lo)}-{f(hi)}V"


def shifted(r):
    # A motor is never 300 mm tall and a magnet grade is not a number: these rows
    # come from an import whose columns are shifted (KV in H MOTEUR, RPM in AIMANT)
    return ((num(r["H MOTEUR"]) or 0) >= 300 or num(r["AIMANT"]) is not None
            or (not r["NOM"] and not r["CLASSE"]))


def as_weight(v):
    """H MOTEUR of a shifted row: grams, or a date the sheet made of "16.3" (2023-03-16 -> 16.3)."""
    d = re.match(r"\d{4}-(\d{2})-(\d{2})", v)
    if d:
        return float(f"{int(d.group(2))}.{int(d.group(1))}")
    return num(v)


def realign(r):
    """Shifted row -> KV, POIDS, PUISSANCE in their columns (None if nothing usable is left)."""
    kv, w = num(r["KV"]), as_weight(r["H MOTEUR"])
    p = num(r["AIMANT"]) if num(r["AIMANT"]) is not None else num(r["PUISSANCE"])
    if not kv or not w:
        return None
    r = dict(r, **{"H MOTEUR": "", "AIMANT": "", "POIDS": f"{w:g}", "PUISSANCE": f"{p:g}" if p else ""})
    r["NOM"] = f"{kv:g}KV · {w:g} g"
    r["REF"] = f"{r['REF']}-{w:g}G"
    return r


def main(xlsx):
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    rows, bad = [], []
    for ws in wb.worksheets:
        it = ws.iter_rows(values_only=True)
        try:
            header = [ALIASES.get(str(h).strip(), str(h).strip()) if h else "" for h in next(it)]
        except StopIteration:
            continue
        for raw in it:
            if not raw or not raw[0]:
                continue
            src = dict(zip(header, raw))
            r = {c: clean(c, src.get(c)) for c in COLS if c != "ID"}
            r["ONGLET"] = ws.title
            (bad if shifted(r) else rows).append(r)

    # One spelling per brand (DualSky / Dualsky / DUALSKY -> most frequent)
    spell = {}
    for r in rows:
        spell.setdefault(r["MARQUE"].lower(), []).append(r["MARQUE"])
    best = {k: max(set(v), key=v.count) for k, v in spell.items()}
    for r in rows:
        r["MARQUE"] = best[r["MARQUE"].lower()]

    # Merge duplicates on REF
    merged = {}
    for r in rows:
        cur = merged.setdefault(r["REF"], r)
        if cur is not r:
            for c in COLS[1:]:
                if not cur.get(c) and r.get(c):
                    cur[c] = r[c]

    # Shifted rows: complete the motor they describe when it is already known
    # (same brand and KV, weight within 5 %), otherwise add them
    known = {}
    for r in list(merged.values()) + (list(csv.DictReader(CAT.open(encoding="utf-8"))) if CAT.exists() else []):
        known.setdefault((r["MARQUE"].lower(), num(r["KV"])), []).append(r)
    fixed, completed, still_bad = [], 0, []
    for r in bad:
        a = realign(r)
        if not a:
            still_bad.append(r)
            continue
        a["MARQUE"] = best.get(a["MARQUE"].lower(), a["MARQUE"])
        w = num(a["POIDS"])
        twin = next((k for k in known.get((a["MARQUE"].lower(), num(a["KV"])), [])
                     if num(k.get("POIDS")) and abs(num(k["POIDS"]) - w) <= 0.05 * w), None)
        if twin:
            if a["PUISSANCE"] and not twin.get("PUISSANCE"):
                twin["PUISSANCE"] = a["PUISSANCE"]
                twin.setdefault("_fill", {})["PUISSANCE"] = a["PUISSANCE"]
                completed += 1
            continue
        fixed.append(a)
    bad = still_bad
    for r in fixed:
        cur = merged.setdefault(r["REF"], r)
        if cur is not r:
            for c in COLS[1:]:
                if not cur.get(c) and r.get(c):
                    cur[c] = r[c]

    # Hand-checked catalogue wins; the sheet fills gaps only
    existing = {}
    if CAT.exists():
        with CAT.open(encoding="utf-8") as f:
            existing = {r["REF"]: r for r in csv.DictReader(f)}
    fills = {}
    for group in known.values():
        for k in group:
            if k.get("_fill"):
                fills[k["REF"]] = k.pop("_fill")
    for ref, r in existing.items():
        for c, v in fills.get(ref, {}).items():
            r[c] = r.get(c) or v
        s = merged.pop(ref, None)
        if s:
            for c in COLS[1:]:
                if not r.get(c) and s.get(c):
                    r[c] = s[c]
    out = list(existing.values()) + list(merged.values())

    for r in out:
        if r.get("LIPO"):
            r["VOLTAGE"] = lipo_voltage(r["LIPO"]) or r.get("VOLTAGE", "")
        cl = r.get("CLASSE", "")
        if re.fullmatch(r"\d{4}", cl):
            r["D STATOR"] = r.get("D STATOR") or str(int(cl[:2]))
            r["H STATOR"] = r.get("H STATOR") or str(int(cl[2:]))
    for i, r in enumerate(out, 1):
        r["ID"] = str(i)

    with CAT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(out)
    with CHECK.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["ONGLET"] + COLS[1:], extrasaction="ignore")
        w.writeheader()
        w.writerows(bad)
    print(f"{len(out)} lignes importées ({len(existing)} vérifiés), {len(fixed)} lignes décalées réalignées, "
          f"{completed} fiches complétées par elles, {len(bad)} lignes à vérifier")
    # One name per brand, no motor twice (tools/dedupe.py)
    import dedupe
    dedupe.main()


if __name__ == "__main__":
    main(sys.argv[1])
