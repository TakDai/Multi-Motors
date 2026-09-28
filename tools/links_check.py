"""Find and repair the dead links of the catalogue.

Checked: the product page of every motor (LIEN), its original photo (IMG), the maker
pages (site/data/fabricant.json) and the review videos (site/data/videos.json).
A link is dead only on a sure answer: "not found" (404 / 410) or a domain that no
longer exists. A refusal (403, anti-robot pages), a timeout or a server error is
checked again next time, never treated as dead.

Repairs:
- dead product page -> the maker page of the model when it works, else the offer of a
  shop that sells it (site/data/prix.json, in stock first), else emptied (the site then
  shows the other links it knows);
- dead photo -> emptied (the thumbnail comes from the other photos of the model);
- dead maker page -> removed from fabricant.json (the site falls back to the shop link);
- deleted video -> removed.

Results are cached in catalogue/liens_verifies.json: a working link is checked again
after 7 days, a dead one is kept out.

Usage: python tools/links_check.py [--dry-run]
"""
import argparse, csv, json, socket, sys, threading, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse
import requests

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
CACHE = ROOT / "catalogue" / "liens_verifies.json"
DATA = ROOT / "site" / "data"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"}
RECHECK = 7  # days
per_host = defaultdict(lambda: threading.Semaphore(4))  # four requests at a time per site, shops rate-limit


def check(url):
    """'ok', 'dead' or 'unknown' (refused, slow, server error: try again later)."""
    host = urlparse(url).netloc
    with per_host[host]:
        for attempt in range(2):
            try:
                r = requests.get(url, headers=UA, timeout=12, stream=True, allow_redirects=True)
                r.close()
                if r.status_code in (404, 410):
                    return "dead"
                if r.status_code == 429:
                    time.sleep(10 * (attempt + 1))
                    continue
                return "ok" if r.status_code < 400 else "unknown"
            except requests.exceptions.ConnectionError as e:
                # A domain that does not exist any more is dead; a refused or reset connection is not sure
                try:
                    socket.gethostbyname(host)
                except socket.gaierror:
                    return "dead" if "Name or service not known" in str(e) or "NameResolution" in str(e) or "getaddrinfo" in str(e) else "unknown"
                return "unknown"
            except requests.RequestException:
                return "unknown"
    return "unknown"


def video_alive(vid):
    """YouTube answers 404 for a deleted video (401 / 403: private or not embeddable, still listed)."""
    try:
        r = requests.get("https://www.youtube.com/oembed", params={"url": f"https://www.youtube.com/watch?v={vid}", "format": "json"}, headers=UA, timeout=20)
        return "dead" if r.status_code in (400, 404) else "ok" if r.ok else "unknown"
    except requests.RequestException:
        return "unknown"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    with CAT.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        cols, rows = list(reader.fieldnames), list(reader)
    fab = json.loads((DATA / "fabricant.json").read_text())
    videos = json.loads((DATA / "videos.json").read_text())
    prices = json.loads((DATA / "prix.json").read_text())
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    today = date.today()
    fresh = lambda k: k in cache and (cache[k]["s"] == "dead" or date.fromisoformat(cache[k]["d"]) > today - timedelta(days=RECHECK))

    urls = {r[c] for r in rows for c in ("LIEN", "IMG") if r[c].startswith("http")} | {v["url"] for v in fab.values() if v.get("url", "").startswith("http")}
    vids = {x["id"] for v in videos.values() for x in v or []}
    todo_u = sorted(u for u in urls if not fresh(u))
    todo_v = sorted(v for v in vids if not fresh("yt:" + v))
    print(f"{len(urls)} liens et {len(vids)} vidéos ; à vérifier : {len(todo_u)} liens, {len(todo_v)} vidéos", flush=True)
    with ThreadPoolExecutor(24) as ex:
        # Saved as it goes: a long check that is stopped keeps what it found
        for i, (u, s) in enumerate(zip(todo_u, ex.map(check, todo_u)), 1):
            cache[u] = {"s": s, "d": today.isoformat()}
            if i % 200 == 0:
                CACHE.write_text(json.dumps(cache, separators=(",", ":")))
                print(f"  {i}/{len(todo_u)} liens", flush=True)
        for v, s in zip(todo_v, ex.map(video_alive, todo_v)):
            cache["yt:" + v] = {"s": s, "d": today.isoformat()}
    dead = lambda k: (cache.get(k) or {}).get("s") == "dead"

    # Repairs
    offers = defaultdict(list)
    for r in rows:
        for o in (prices.get(r["REF"]) or {}).get("offers") or []:
            offers[(r["MARQUE"], r["NOM"])].append(o)
    fixed = {"lien remplacé par la page fabricant": 0, "lien remplacé par une boutique": 0, "lien vidé": 0, "photo vidée": 0}
    examples = []
    for r in rows:
        if r["LIEN"].startswith("http") and dead(r["LIEN"]):
            f = fab.get(f"{r['MARQUE']}|{r['NOM']}") or {}
            maker = f["url"] if f.get("url") and not dead(f["url"]) else ""
            shop = next((o["url"] for o in sorted(offers[(r["MARQUE"], r["NOM"])], key=lambda o: (not o["stock"], o["eur"])) if not dead(o["url"])), "")
            examples.append((r["REF"], r["LIEN"][:70], maker or shop or "—"))
            r["LIEN"] = maker or shop
            fixed["lien remplacé par la page fabricant" if maker else "lien remplacé par une boutique" if shop else "lien vidé"] += 1
        if r["IMG"].startswith("http") and dead(r["IMG"]):
            r["IMG"] = ""
            fixed["photo vidée"] += 1
    dead_fab = [k for k, v in fab.items() if dead(v.get("url", ""))]
    for k in dead_fab:
        fab[k].pop("url", None)
    n_vid = 0
    for k, v in videos.items():
        keep = [x for x in v or [] if not dead("yt:" + x["id"])]
        n_vid += len(v or []) - len(keep)
        videos[k] = keep
    print(f"morts : {sum(1 for u in urls if dead(u))} liens, {sum(1 for v in vids if dead('yt:' + v))} vidéos ; "
          f"incertains (revérifiés plus tard) : {sum(1 for u in urls if (cache.get(u) or {}).get('s') == 'unknown')}")
    print("réparations :", fixed, f"; pages fabricant retirées : {len(dead_fab)} ; vidéos retirées : {n_vid}")
    for e in examples[:25]:
        print("  ", *e)
    CACHE.write_text(json.dumps(cache, separators=(",", ":")))  # checks kept, even for a dry run
    if args.dry_run:
        return
    with CAT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    (DATA / "fabricant.json").write_text(json.dumps(fab, ensure_ascii=False, separators=(",", ":")))
    (DATA / "videos.json").write_text(json.dumps(videos, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
