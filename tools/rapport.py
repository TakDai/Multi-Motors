"""Daily report of the catalogue for the news feed: what changed since the day before.

The state of the catalogue (motors, filled fields per model, lowest price per model, photos,
videos, test benches, maker sheets) is kept in catalogue/etat_jour.json. Each run compares the
current state with the state at the end of the previous day and writes the report of the day
in catalogue/rapports.json (several runs the same day update the same report). actus.py puts
the reports in the news feed.

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
    for prev, day in list(zip(dates, dates[1:]))[-days:]:
        new = refs(last_of_day[day]) - refs(last_of_day[prev])
        r = report(day, state_of(git_read(last_of_day[prev])), state_of(git_read(last_of_day[day])), new)
        save_report(r)
        print(r["title"])


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
    for d in r["dropList"]:
        print(f"  baisse {d['model']} : {d['old']} € -> {d['new']} € (-{d['pct']} %)")


if __name__ == "__main__":
    main()
