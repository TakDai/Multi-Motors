#!/usr/bin/env python3
"""Thrust / bench test tables published on the shops' product pages.

For every motor product whose description holds a test table (thrust, current,
power, efficiency…), the table is rebuilt cell by cell (merged cells repeated on
every row they cover) and attached to the catalogue model it describes.

Result: site/data/bench.json
  {"BRAND|MODEL": [{"source": url, "title": str, "headers": [...], "rows": [[...], ...]}]}
Rows with a single cell are section titles (for example one KV of the model).

Usage: python tools/bench.py
"""
import csv, html, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from enrich import tokens  # noqa: E402
import shop_motors as S  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
OUT = ROOT / "site" / "data" / "bench.json"
TEST_WORDS = re.compile(r"thrust|pouss[ée]e|traction|\(gf?\)", re.I)


def text(cell):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", cell))).strip()


def grid(table):
    """Rows of the table with rowspan / colspan cells repeated where they apply."""
    rows, pending = [], {}  # pending: column -> (value, rows left)
    for tr in re.findall(r"<tr.*?</tr>", table, re.S | re.I):
        cells = re.findall(r"<t([dh])([^>]*)>(.*?)</t[dh]>", tr, re.S | re.I)
        row, col = [], 0
        queue = list(cells)
        while queue or col in pending:
            if col in pending:
                v, left = pending[col]
                row.append(v)
                if left > 1:
                    pending[col] = (v, left - 1)
                else:
                    del pending[col]
                col += 1
                continue
            _, attrs, content = queue.pop(0)
            v = text(content)
            cs = int((re.search(r"colspan=['\"]?(\d+)", attrs) or [0, 1])[1])
            rs = int((re.search(r"rowspan=['\"]?(\d+)", attrs) or [0, 1])[1])
            for _ in range(max(1, min(cs, 20))):
                row.append(v)
                if rs > 1:
                    pending[col] = (v, rs - 1)
                col += 1
        if any(row):
            rows.append(row)
    return rows


def tables_of(body):
    out = []
    for t in re.findall(r"<table.*?</table>", body or "", re.S | re.I):
        if not TEST_WORDS.search(t):
            continue
        g = grid(t)
        if len(g) < 2:
            continue
        # Property/value tables ("Thrust | 40.6 g | 46.3 g" rows): the first row names the columns
        labels = [r[0] for r in g if r and r[0] and not re.search(r"^\d", r[0])]
        if sum(bool(TEST_WORDS.search(l)) for l in labels) and len(labels) >= 0.6 * len(g) and not TEST_WORDS.search(" ".join(g[0][1:])):
            h = 0
        else:
            # Header: the first row naming a thrust column; a single-cell row before it is the title
            h = next((i for i, r in enumerate(g) if len(set(r)) > 2 and any(TEST_WORDS.search(c) for c in r)), 0)
        title = next((r[0] for r in g[:h] if len(set(r)) == 1 and r[0]), "")
        headers = g[h]
        rows = []
        for r in g[h + 1:]:
            uniq = [c for c in dict.fromkeys(r) if c]
            if len(uniq) == 1 and len(headers) > 2:
                rows.append([uniq[0]])  # section title (one KV, one propeller…)
            elif any(re.search(r"\d", c) for c in r):
                rows.append((r + [""] * len(headers))[:len(headers)])
        # A header cell spread over two columns: keep one column
        keep = [i for i, c in enumerate(headers) if i == 0 or c != headers[i - 1] or not c]
        headers = [headers[i] for i in keep]
        rows = [r if len(r) == 1 else [r[i] for i in keep if i < len(r)] for r in rows]
        if len(rows) >= 1:
            out.append({"title": title[:120], "headers": headers[:14], "rows": [r[:14] for r in rows[:120]]})
    return out


def main():
    with CAT.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    alias = {S.key(k): v for k, v in S.ALIASES.items()}
    brands = {S.key(r["MARQUE"]): r["MARQUE"] for r in rows}
    brands.update(alias)
    fams = {}
    for r in rows:
        if r["NOM"] and not re.search(r"KV · [\d.]+ g$", r["NOM"]):
            fams.setdefault(S.key(r["MARQUE"]), {}).setdefault(r["NOM"], r)
    shop_names = {"racedayquads", "pyrodrone", "newbeedrone", "rotorriot", "speedyfpv", "fpvfaster", "unmannedtech", "unmannedtechshop"}
    products = [p for h, c in S.COLLECTIONS.items() for p in S.shopify_products(h, c)]
    bench, found = {}, 0
    for p in products:
        tabs = tables_of(p["body"])
        if not tabs:
            continue
        found += 1
        brand = S.brand_of(p, brands, shop_names)
        model = S.model_of(p["title"], brand) if brand else ""
        cls = re.search(r"(?<![\d.])(\d{4}(?:[.,]\d)?)(?![\d])", p["title"])
        mt = set(tokens(model))
        cands = [(name, r) for name, r in fams.get(S.key(brand), {}).items()
                 if set(tokens(name)) and (set(tokens(name)) <= mt or mt <= set(tokens(name)))
                 and (not cls or not r["CLASSE"] or r["CLASSE"].replace(",", ".") == cls.group(1).replace(",", "."))]
        if not cands:
            continue
        name = max(cands, key=lambda c: len(set(tokens(c[0])) & mt))[0]
        k = f"{fams[S.key(brand)][name]['MARQUE']}|{name}"
        for t in tabs:
            t["source"] = p["url"]
            if not any(x["headers"] == t["headers"] and x["rows"] == t["rows"] for x in bench.get(k, [])):
                bench.setdefault(k, []).append(t)
    OUT.write_text(json.dumps(bench, ensure_ascii=False, separators=(",", ":")))
    print(f"{found} produits avec un tableau d'essai, {sum(len(v) for v in bench.values())} tableaux rattachés à {len(bench)} modèles")


if __name__ == "__main__":
    main()
