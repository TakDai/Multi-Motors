"""Daily report of the catalogue for the news feed: what changed since the day before.

The state of the catalogue (motors, filled fields per model, lowest price per model, photos,
videos, test benches, maker sheets) is kept in catalogue/etat_jour.json. Each run compares the
current state with the state at the end of the previous day and writes the report of the day
in catalogue/rapports.json (several runs the same day update the same report). actus.py puts
the reports in the news feed.
Detailed report of the day (site/data/rapports/AAAA-MM-JJ.json, opened from the news): every
motor added, removed or completed (field, old and new value, from the catalogue as it was at the
end of the day before in git), every price and stock change per shop (site/data/prix_hist.json,
kept by prices_check.py), the photos and videos added. Plus site/data/prix_boutiques.json: a price
index per shop over the last 60 days (mean of price / first price seen in that period, 100 = no change).

Usage: run by actus.py every day (python tools/rapport.py does the same)
       python tools/rapport.py --backfill 5     (reports of the last days, rebuilt from the git history)
"""
import argparse, csv, datetime, io, json, re, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = ROOT / "catalogue" / "etat_jour.json"
REPORTS = ROOT / "catalogue" / "rapports.json"
FILES = {"cat": "catalogue/moteurs.csv", "prix": "site/data/prix.json", "thumbs": "site/data/thumbs.json", "photos": "site/data/photos.json",
         "videos": "site/data/videos.json", "bench": "site/data/bench.json", "fab": "site/data/fabricant.json"}
SPECS = ["CLASSE", "KV", "POIDS", "D MOTEUR", "H MOTEUR", "D SHAFT", "L SHAFT", "TYPE SHAFT", "VIS HEL", "VIS FIX", "ENTRAXE FIX", "LIPO",
         "L CABLE", "TYPE CABLE", "HELICE", "PUISSANCE", "AMP", "CONFIG", "RESISTANCE", "UTILISATION", "LIEN", "IMG"]
UNNAMED = re.compile(r"KV · [\d.]+ g$")
KEEP = 120  # days of reports kept
DETAILS = ROOT / "site" / "data" / "rapports"
HIST = ROOT / "site" / "data" / "prix_hist.json"
INDEX = ROOT / "site" / "data" / "prix_boutiques.json"
INDEX_FROM = "2026-09-29"
LABELS = {"CLASSE": "Classe", "KV": "KV", "POIDS": "Poids", "D MOTEUR": "Ø moteur", "H MOTEUR": "H moteur", "D SHAFT": "Ø shaft",
          "L SHAFT": "L shaft", "TYPE SHAFT": "Type de shaft", "VIS HEL": "Fixation hélice", "VIS FIX": "Vis de fixation",
          "ENTRAXE FIX": "Entraxe", "LIPO": "Voltage", "L CABLE": "L câble", "TYPE CABLE": "Section câble", "HELICE": "Hélice",
          "PUISSANCE": "Puissance", "AMP": "Intensité", "CONFIG": "Configuration", "RESISTANCE": "Résistance",
          "UTILISATION": "Utilisation", "LIEN": "Lien", "IMG": "Photo", "NOM": "Nom", "MARQUE": "Marque"}


def state_of(read):
    """Compact state of the catalogue; read(name) gives the text of one of FILES (or None)."""
    rows = [r for r in csv.DictReader(io.StringIO(read("cat") or "")) if r.get("REF")]
    js = lambda n: json.loads(read(n) or "{}")
    prix, thumbs, photos, videos, bench, fab = js("prix"), js("thumbs"), js("photos"), js("videos"), js("bench"), js("fab")
    fams = {}
    for r in rows:
        if r.get("NOM") and not UNNAMED.search(r["NOM"]):
            f = fams.setdefault(f"{r['MARQUE']}|{r['NOM']}", {"refs": [], "filled": 0})
            f["refs"].append(r["REF"])
            f["filled"] += sum(1 for c in SPECS if r.get(c))
    out = {}
    for k, f in fams.items():
        offers = [(o["eur"], ref) for ref in f["refs"] for o in (prix.get(ref) or {}).get("offers") or [] if o.get("stock", True) and o.get("eur")]
        low = min(offers) if offers else None
        out[k] = [f["filled"], round(low[0], 2) if low else 0, low[1] if low else f["refs"][0],
                  len(photos.get(k) or []) + sum(1 for ref in f["refs"] if ref in thumbs), len(videos.get(k) or videos.get(k.upper()) or [])]
    return {"total": len(rows), "fams": out, "bench": len(bench), "fab": sum(1 for v in fab.values() if v.get("specs"))}


def report(day, base, cur, new_refs):
    """What changed between two states, as shown in the news feed (new motors: those first seen that day)."""
    bf, cf = base["fams"], cur["fams"]
    completed, values, priced, photos, videos, drops = 0, 0, 0, 0, 0, []
    for k, (filled, low, ref, ph, vi) in cf.items():
        o = bf.get(k)
        if not o:
            continue  # a new model: counted with the new motors
        if filled > o[0]:
            completed += 1
            values += filled - o[0]
        if low and not o[1]:
            priced += 1
        if low and o[1] and low <= o[1] * 0.95 and o[1] - low >= 0.5:
            drops.append({"model": k.replace("|", " "), "ref": ref, "old": o[1], "new": low, "pct": round((1 - low / o[1]) * 100)})
        photos += max(0, ph - o[3])
        videos += max(0, vi - o[4])
    drops.sort(key=lambda d: -d["pct"])
    new_models = sum(1 for k in cf if k not in bf)
    r = {"date": day, "motors": len(new_refs), "models": new_models, "completed": completed, "values": values, "priced": priced,
         "drops": len(drops), "dropList": drops[:10], "photos": photos, "videos": videos,
         "bench": max(0, cur["bench"] - base["bench"]), "fab": max(0, cur["fab"] - base["fab"]),
         "total": cur["total"], "totalModels": len(cf)}
    parts = [(r["motors"], "nouveau moteur", "nouveaux moteurs"), (r["values"], "information ajoutée", "informations ajoutées"),
             (r["drops"], "baisse de prix", "baisses de prix"), (r["priced"], "nouveau prix", "nouveaux prix"),
             (r["photos"], "nouvelle photo", "nouvelles photos"), (r["videos"], "nouvelle vidéo", "nouvelles vidéos")]
    said = [f"{n:,} {one if n == 1 else many}".replace(",", " ") for n, one, many in parts if n][:3]
    d = datetime.date.fromisoformat(day)
    months = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
    when = f"{'1er' if d.day == 1 else d.day} {months[d.month - 1]}"
    r["title"] = f"Rapport du {when} : " + (", ".join(said) if said else "catalogue vérifié, rien de nouveau")
    return r


def detail(day, base_read, cur_read, hist, new_refs):
    """Everything that changed that day, motor by motor (base_read: the catalogue at the end of the day before)."""
    js_ = lambda read, n: json.loads(read(n) or "{}") if read else {}
    rows = lambda read: {r["REF"]: r for r in csv.DictReader(io.StringIO(read("cat") or "")) if r.get("REF")}
    cur, base = rows(cur_read), rows(base_read) if base_read else {}
    model = lambda r: f"{r['MARQUE']} {r['NOM']}".strip()
    who = lambda ref, r: {"ref": ref, "model": model(r), "kv": r.get("KV", ""), "cls": r.get("CLASSE", "")}
    new_refs = set(new_refs) | (set(cur) - set(base) if base else set())
    added = [who(ref, cur[ref]) for ref in sorted(new_refs) if ref in cur]
    removed = [who(ref, base[ref]) for ref in sorted(set(base) - set(cur))]
    changed = []
    for ref, r in cur.items():
        o = base.get(ref)
        if not o or ref in new_refs:
            continue
        f = [[LABELS.get(c, c), (o.get(c) or "")[:90], (r.get(c) or "")[:90]] for c in ["NOM"] + SPECS if (o.get(c) or "") != (r.get(c) or "")]
        if f:
            changed.append({**who(ref, r), "fields": f})
    changed.sort(key=lambda x: (x["model"].lower(), x["kv"]))
    # Prices: the history points of that day, against the point before (currency of each offer: the site adds VAT to USD prices)
    prices, offers_new, stock = [], [], []
    cur_of = {(ref, o["shop"]): o.get("cur", "EUR") for ref, v in js_(cur_read, "prix").items() for o in (v or {}).get("offers") or []}
    for ref, shops in hist.items():
        r = cur.get(ref)
        if not r:
            continue
        for shop, pts in shops.items():
            for i, p in enumerate(pts):
                if p[0] != day:
                    continue
                cur_ = cur_of.get((ref, shop), "EUR")
                if i == 0:
                    offers_new.append({**who(ref, r), "shop": shop, "eur": p[2], "cur": cur_, "stock": p[3]})
                    continue
                q = pts[i - 1]
                if p[1] != q[1]:
                    prices.append({**who(ref, r), "shop": shop, "cur": cur_, "old": q[2], "new": p[2], "oldPrice": q[1], "newPrice": p[1],
                                   "pct": round((p[1] / q[1] - 1) * 100, 1) if q[1] else 0, "hist": [[x[0], x[2]] for x in pts][-30:]})
                if p[3] != q[3]:
                    stock.append({**who(ref, r), "shop": shop, "stock": p[3]})
    prices.sort(key=lambda x: x["pct"])
    by_shop = {}
    for x in prices:
        s_ = by_shop.setdefault(x["shop"], {"shop": x["shop"], "down": 0, "up": 0, "pcts": []})
        s_["down" if x["pct"] < 0 else "up"] += 1
        s_["pcts"].append(x["pct"])
    shops = sorted(({"shop": v["shop"], "down": v["down"], "up": v["up"], "avg": round(sum(v["pcts"]) / len(v["pcts"]), 1)} for v in by_shop.values()),
                   key=lambda v: -(v["down"] + v["up"]))
    # Photos and videos added, per model
    js = lambda read, n: json.loads(read(n) or "{}") if read else {}
    media = []
    for n, label in (("photos", "photos"), ("videos", "videos")):
        b, c = js(base_read, n), js(cur_read, n)
        for k, v in c.items():
            d = len(v or []) - len(b.get(k) or [])
            if d > 0 and base_read:
                ref = next((ref for ref, r in cur.items() if f"{r['MARQUE']}|{r['NOM']}".upper() == k.upper()), "")
                media.append({"model": k.replace("|", " "), "ref": ref, "kind": label, "n": d,
                              "titles": [x.get("t", "") for x in (v or [])[-d:]][:3] if n == "videos" else []})
    media.sort(key=lambda x: (x["kind"], x["model"].lower()))
    return {"date": day, "added": added[:1500], "removed": removed[:500], "changed": changed[:2000], "changedTotal": len(changed),
            "prices": prices[:800], "pricesTotal": len(prices), "shops": shops, "offersNew": offers_new[:800], "stock": stock[:500],
            "media": media[:800]}


def shop_index(hist, days=60):
    """Price index of each shop (mean over its offers of the price that day / first price in the period, x100)."""
    today = datetime.date.today()
    span = [(today - datetime.timedelta(days=i)).isoformat() for i in range(days - 1, -1, -1)]
    start = min((p[0] for shops in hist.values() for pts in shops.values() for p in pts), default=span[-1])
    # Prices were matched again with the right variant on 28/09: the index starts after that
    span = [d for d in span if d >= max(start, INDEX_FROM)]
    per_shop = {}
    for shops in hist.values():
        for shop, pts in shops.items():
            per_shop.setdefault(shop, []).append(pts)
    out = []
    for shop, offers in per_shop.items():
        if len(offers) < 8:
            continue
        idx = []
        for d in span:
            ratios = []
            for pts in offers:
                # Reference: the price at the start of the period (or the first one seen after it)
                first = next((p for p in reversed(pts) if p[0] <= span[0] and p[1]), None) or next((p for p in pts if p[1]), None)
                now = next((p for p in reversed(pts) if p[0] <= d), None)
                if first and now and first[0] <= d:
                    ratios.append(now[1] / first[1])
            idx.append(round(sum(ratios) / len(ratios) * 100, 2) if ratios else None)
        changes = sum(1 for pts in offers for a, b in zip(pts, pts[1:]) if a[1] != b[1])
        out.append({"shop": shop, "offers": len(offers), "changes": changes, "idx": idx})
    out.sort(key=lambda x: -x["offers"])
    return {"days": span, "shops": out}


def save_detail(d):
    DETAILS.mkdir(parents=True, exist_ok=True)
    (DETAILS / f"{d['date']}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for f in sorted(DETAILS.glob("*.json"))[:-KEEP]:
        f.unlink()


def save_report(r):
    reports = json.loads(REPORTS.read_text()) if REPORTS.exists() else []
    reports = [x for x in reports if x["date"] != r["date"]] + [r]
    reports.sort(key=lambda x: x["date"])
    REPORTS.write_text(json.dumps(reports[-KEEP:], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def git_read(commit):
    def read(n):
        p = subprocess.run(["git", "show", f"{commit}:{FILES[n]}"], cwd=ROOT, capture_output=True, text=True)
        return p.stdout if p.returncode == 0 else None
    return read


def backfill(days):
    """Reports of the last days from the git history: end of each day against the end of the day before."""
    log = subprocess.run(["git", "log", "--first-parent", "--format=%H %cs", "--", FILES["cat"], FILES["prix"]], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout.split()
    last_of_day = {}
    for h, d in zip(log[::2], log[1::2]):
        last_of_day.setdefault(d, h)  # newest first: the first seen is the last commit of the day
    dates = sorted(last_of_day)
    refs = lambda c: {r["REF"] for r in csv.DictReader(io.StringIO(git_read(c)("cat") or "")) if r.get("REF")}
    hist = json.loads(HIST.read_text()) if HIST.exists() else {}
    for prev, day in list(zip(dates, dates[1:]))[-days:]:
        new = refs(last_of_day[day]) - refs(last_of_day[prev])
        r = report(day, state_of(git_read(last_of_day[prev])), state_of(git_read(last_of_day[day])), new)
        save_report(r)
        d = detail(day, git_read(last_of_day[prev]), git_read(last_of_day[day]), hist, new)
        save_detail(d)
        print(r["title"], f"| détail : {len(d['changed'])} moteurs modifiés, {d['pricesTotal']} prix changés")
    INDEX.write_text(json.dumps(shop_index(hist), ensure_ascii=False, separators=(",", ":")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", type=int, default=0)
    args = ap.parse_args()
    return backfill(args.backfill) if args.backfill else daily()


def daily():
    today = datetime.date.today().isoformat()
    cur = state_of(lambda n: (ROOT / FILES[n]).read_text(encoding="utf-8") if (ROOT / FILES[n]).exists() else None)
    saved = json.loads(STATE.read_text()) if STATE.exists() else None
    if not saved:
        # First run: compared with the previous commit when the history is there, else nothing to say yet
        STATE.write_text(json.dumps({"date": today, "state": cur, "base": cur, "baseDate": today}, separators=(",", ":")))
        print("État du catalogue enregistré : le premier rapport sera fait au prochain passage.")
        return
    if saved and "refs" in saved.get("base", {}):
        saved["base"].setdefault("total", len(saved["base"].pop("refs")))
    # The base is the state at the end of the last day before today
    base, base_date = (saved["base"], saved["baseDate"]) if saved["date"] == today else (saved["state"], saved["date"])
    STATE.write_text(json.dumps({"date": today, "state": cur, "base": base, "baseDate": base_date}, separators=(",", ":")))
    # Motors that entered the catalogue today (catalogue/premiere_vue.json, kept by actus.py, run before)
    first = json.loads((ROOT / "catalogue" / "premiere_vue.json").read_text())
    r = report(today, base, cur, [ref for ref, d in first.items() if d == today])
    save_report(r)
    print(r["title"])
    # The catalogue at the end of the day before: last commit before today (needs a git history of a few days)
    prev = subprocess.run(["git", "rev-list", "-1", f"--before={today}T00:00:00Z", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    hist = json.loads(HIST.read_text()) if HIST.exists() else {}
    cur_read = lambda n: (ROOT / FILES[n]).read_text(encoding="utf-8") if (ROOT / FILES[n]).exists() else None
    d = detail(today, git_read(prev) if prev else None, cur_read, hist, [ref for ref, x in first.items() if x == today])
    save_detail(d)
    INDEX.write_text(json.dumps(shop_index(hist), ensure_ascii=False, separators=(",", ":")))
    print(f"  détail : {len(d['added'])} ajoutés, {d['changedTotal']} modifiés, {d['pricesTotal']} prix changés, {len(d['stock'])} stocks, {len(d['media'])} médias")
    for d in r["dropList"]:
        print(f"  baisse {d['model']} : {d['old']} € -> {d['new']} € (-{d['pct']} %)")


if __name__ == "__main__":
    main()
