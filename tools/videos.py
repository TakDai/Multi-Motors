"""Find review / test videos on YouTube for every motor family (brand + model).

Keeps up to 4 videos whose title names the model (all its numbers and at
least one of its words), preferring reviews, thrust tests and comparisons.
Result: site/data/videos.json  {"MARQUE|NOM": [{id, t, c, d, v}, ...]}
Families already searched are skipped, so the job can run in several passes.

Usage: python tools/videos.py [--limit N]
"""
import argparse, csv, json, re, time
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
CAT = ROOT / "catalogue" / "moteurs.csv"
OUT = ROOT / "site" / "data" / "videos.json"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9"}
GOOD = re.compile(r"review|test|thrust|vs\b|comparison|unbox|first look|bench|flight|overview", re.I)
GENERIC = {"motor", "motors", "brushless", "series", "fpv", "ii", "iii", "iv", "v2", "v3", "pro", "the", "and"}


def search(q):
    r = requests.get("https://www.youtube.com/results", params={"search_query": q, "hl": "en", "gl": "US"},
                     headers=UA, timeout=20)
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", r.text)
    if not m:
        return []
    out = []

    def walk(o):
        if isinstance(o, dict):
            v = o.get("videoRenderer")
            if v and "videoId" in v:
                out.append({
                    "id": v["videoId"],
                    "t": "".join(x.get("text", "") for x in v.get("title", {}).get("runs", [])),
                    "c": (v.get("ownerText", {}).get("runs") or [{}])[0].get("text", ""),
                    "d": v.get("lengthText", {}).get("simpleText", ""),
                    "v": v.get("viewCountText", {}).get("simpleText", ""),
                })
            for x in o.values():
                walk(x)
        elif isinstance(o, list):
            for x in o:
                walk(x)
    walk(json.loads(m.group(1)))
    return out


def relevant(video, brand, name):
    t = video["t"].lower().replace("-", " ")
    toks = re.findall(r"[a-z0-9]+", name.lower().replace("-", " "))
    nums = [x for x in toks if any(c.isdigit() for c in x)]
    words = [x for x in toks if not any(c.isdigit() for c in x) and x not in GENERIC and len(x) > 1]
    if not all(x in t.replace(" ", "") or x in t for x in nums):
        return False
    flat = re.sub(r"[^a-z0-9]", "", t)
    b = re.sub(r"[^a-z0-9]", "", brand.lower())
    b_short = re.sub(r"(hobby|motors?|rc|fpv|power|drone)$", "", b) or b
    brand_ok = b in flat or (len(b_short) >= 2 and b_short in flat)
    word_ok = any(w in t for w in words)
    # The numbers of the model plus the brand or a word of the model name
    return brand_ok or word_ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    with CAT.open(encoding="utf-8") as f:
        fams = sorted({(r["MARQUE"], r["NOM"]) for r in csv.DictReader(f) if r.get("NOM")})
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    todo = [k for k in fams if f"{k[0]}|{k[1]}" not in data]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(todo)} familles à chercher", flush=True)
    for i, (brand, name) in enumerate(todo, 1):
        try:
            found = [v for v in search(f"{brand} {name} motor review") if relevant(v, brand, name)]
        except Exception as e:
            print(f"  erreur {brand} {name}: {e}", flush=True)
            time.sleep(5)
            continue
        found.sort(key=lambda v: not GOOD.search(v["t"]))
        data[f"{brand}|{name}"] = found[:4]
        if i % 25 == 0 or i == len(todo):
            OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
            print(f"{i}/{len(todo)}, {sum(1 for v in data.values() if v)} familles avec vidéos", flush=True)
        time.sleep(1.0)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
