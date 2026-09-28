#!/usr/bin/env python3
"""Write the specs of catalogue/moteurs.csv in one consistent format.

The sheet and the shops write the same thing in many ways ("150MM", "150mm",
"15cm"; "5 Inch", '5"-5.5"'; "16", "16x16"). Only the spelling changes, never the
value. Anything not recognised is left as it is.

- L CABLE      -> "150 mm"
- TYPE CABLE   -> "20 AWG"
- HELICE       -> '5"', '5-6"', or "40 mm (3 pales)" for whoop propellers
- ENTRAXE FIX  -> "16x16", "16x16 / 19x19", "Ø6.6 (3 trous)"
- RESISTANCE   -> "46.8 mΩ"
- LIPO         -> "4S-6S"
- VIS HEL      -> "M5" (thread sizes in capitals)
- D / H STATOR -> taken from the class (2306.5 -> 23 and 6.5)

Usage: python tools/normalize.py
"""
import csv, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
NUM = r"\d+(?:[.,]\d+)?"


def f(v):
    """Number as written, with a dot and no useless zero."""
    v = float(str(v).replace(",", "."))
    return f"{v:g}"


def cable_length(v):
    m = re.fullmatch(rf"\s*({NUM})\s*(mm|cm)?\s*", v, re.I)
    if not m:
        return v
    n = float(m.group(1).replace(",", "."))
    return f"{f(n * 10 if (m.group(2) or '').lower() == 'cm' else n)} mm"


def awg(v):
    m = re.fullmatch(r"\s*#?(\d+)\s*#?\s*awg\s*", v, re.I)
    return f"{m.group(1)} AWG" if m else v


def prop(v):
    t = v.strip()
    m = re.fullmatch(rf"({NUM})\s*mm\s*\(?\s*(GF\s*\d+\w*\s*)?(\d)\s*pales?\s*\)?", t, re.I)
    if m:
        ref = f"{m.group(2).strip().upper()}, " if m.group(2) else ""
        return f"{f(m.group(1))} mm ({ref}{m.group(3)} pales)"
    # Inches: 5 Inch, 5", 5-6 Inch, 5"-5.5", 1.6inch~3inch, 3" - 4"
    unit = r'\s*(?:"|\'\'|inch(?:es)?|pouces?|in\b)?\s*'
    m = re.fullmatch(rf"({NUM}){unit}(?:[-~–à/]|to){unit}\s*({NUM}){unit}", t, re.I)
    if m and re.search(r'"|inch|pouce|\bin\b', t, re.I):
        a, b = f(m.group(1)), f(m.group(2))
        return f'{a}"' if a == b else f'{a}-{b}"'
    m = re.fullmatch(rf"({NUM}){unit}", t, re.I)
    if m and re.search(r'"|inch|pouce|\bin\b', t, re.I):
        return f'{f(m.group(1))}"'
    return v


def spacing(v):
    t = v.strip()
    if re.fullmatch(NUM, t):
        # "16" means a 16x16 square; 6.6 mm is the 3-hole circle of small motors
        if float(t.replace(",", ".")) == 6.6:
            return "Ø6.6"
        return f"{f(t)}x{f(t)}" if float(t.replace(",", ".")) >= 9 else v
    m = re.fullmatch(rf"({NUM})\s*/\s*({NUM})", t)  # "16/19": two hole patterns
    if m:
        return f"{f(m.group(1))}x{f(m.group(1))} / {f(m.group(2))}x{f(m.group(2))}"
    m = re.fullmatch(rf"({NUM})\s*[x*×]\s*({NUM})\s*(mm)?", t, re.I)
    if m:
        return f"{f(m.group(1))}x{f(m.group(2))}"
    return v


def resistance(v):
    m = re.fullmatch(rf"\s*({NUM})\s*(?:m\s*[Ωω]|mohms?)\s*", v, re.I)
    if m:
        return f"{f(m.group(1))} mΩ"
    m = re.fullmatch(rf"\s*({NUM})\s*(?:[Ωω]|ohms?)\s*", v, re.I)  # 0.054 Ω = 54 mΩ
    if m:
        return f"{f(round(float(m.group(1).replace(',', '.')) * 1000, 3))} mΩ"
    return re.sub(r"(\d)\s*m\s*Ω", r"\1 mΩ", v)


def lipo(v):
    t = v.strip().upper().replace(" ", "")
    m = re.fullmatch(r"(\d+)S?[-~–À/](\d+)S", t)
    if m:
        return f"{m.group(1)}S-{m.group(2)}S"
    m = re.fullmatch(r"(\d+)S", t)
    return f"{m.group(1)}S" if m else v


def thread(v):
    return re.sub(r"\bm(\d(?:[.,]\d)?)\b", lambda m: "M" + m.group(1).replace(",", "."), v)


RULES = {"L CABLE": cable_length, "TYPE CABLE": awg, "HELICE": prop, "ENTRAXE FIX": spacing,
         "RESISTANCE": resistance, "LIPO": lipo, "VIS HEL": thread}


def class_from_name(r):
    """Class that contradicts the model name ("2306 JOHNNYFPV" classed 2206, "FLAT RATS 1507"
    classed 2407): the size written in the name wins. Only when the name holds a single
    size (4 digits, not the KV) and it differs from the class."""
    name, cls, kv = r.get("NOM") or "", (r.get("CLASSE") or "").replace(",", "."), (r.get("KV") or "").split(".")[0]
    if not name or not re.fullmatch(r"0?\d{3,5}(\.\d+)?", cls):
        return 0
    sizes = {a + (("." + b) if b else "") for a, b in re.findall(r"(?<![\d.,])(\d{4})(?:[.,](\d))?(?![\d])(?!\s*kv)", name, re.I)}
    sizes = {x for x in sizes if x.split(".")[0] != kv and 5 <= int(x[:2]) <= 99 and int(x[2:4]) >= 1}  # "1500" is a range name, not 15 x 00
    if len(sizes) != 1:
        return 0
    size = sizes.pop()
    if cls == size:
        return 0
    if cls.lstrip("0").split(".")[0] == size.lstrip("0").split(".")[0]:
        if "." in size and cls == size.split(".")[0]:
            r["CLASSE"] = size  # "2207" -> "2207.5" when the name says so
            return 1
        return 0
    r["CLASSE"] = size
    return 1


def stator(r):
    """Stator size from the class (2306.5 -> 23 x 6.5): fixes ",5" and "07" left by the sheet."""
    m = re.fullmatch(r"(\d{2})(\d{2}(?:[.,]\d+)?)", (r.get("CLASSE") or "").strip())
    if not m:
        return 0
    d, h = f(m.group(1)), f(m.group(2))
    n = 0
    for col, val in (("D STATOR", d), ("H STATOR", h)):
        cur = (r.get(col) or "").strip()
        try:
            ok = cur and float(cur.replace(",", ".")) == float(val)
        except ValueError:
            ok = False
        if not ok or cur != val:
            r[col] = val
            n += 1
    return n


def main():
    with CAT.open(encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        cols, rows = list(reader.fieldnames), list(reader)
    changed = {c: 0 for c in RULES}
    changed["CLASSE"] = changed["STATOR"] = 0
    for r in rows:
        changed["CLASSE"] += class_from_name(r)
        changed["STATOR"] += stator(r)
        for c, rule in RULES.items():
            v = r.get(c, "")
            if v:
                nv = rule(re.sub(r"\s+", " ", v).strip())
                if nv != v:
                    r[c] = nv
                    changed[c] += 1
    with CAT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print("valeurs réécrites : " + ", ".join(f"{c} {n}" for c, n in changed.items()))


if __name__ == "__main__":
    main()
