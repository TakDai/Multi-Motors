"""Pages Google can read, built next to the site (the catalogue itself is a JavaScript app
whose #m/... addresses are not indexed by search engines).

For every named motor model, every brand, every stator size and every drone size, a plain
HTML page with the real content (specifications per KV, photo, prices, links), its own title
and description, structured data (schema.org) and links to the full sheet in the app; plus a
hub page "moteurs brushless FPV", sitemap.xml and robots.txt.

The pages are generated when the site is built for OVH (.github/workflows/ovh-branch.yml),
never committed: they follow the catalogue every day.

Usage: python tools/seo_pages.py <site output folder>   (e.g. build)
"""
import csv, html, json, re, sys, unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://multi-motors.fr"
# Legal pages (pages/*.html): contact address shown to visitors, date of the last change of their text
CONTACT = "contact@tom-bigot.fr"
LEGAL_DATE = "28 septembre 2026"
UNNAMED = re.compile(r"KV · [\d.]+ g$")
# Drone sizes, from the stator size (first two digits of the class): what people search for
SIZES = [
    ("whoop", "Moteurs pour tiny whoop et micro drone", "Whoop et micro drones (65 à 85 mm)", range(5, 10)),
    ("toothpick", "Moteurs pour toothpick et drone 2 à 3 pouces", "Toothpick, 2 et 2,5 pouces", range(10, 13)),
    ("3-pouces", "Moteurs pour drone FPV 3 pouces", "Drones 3 et 3,5 pouces, cinewhoops", range(13, 16)),
    ("4-pouces", "Moteurs pour drone FPV 4 pouces", "Drones 4 pouces", range(16, 21)),
    ("5-pouces", "Moteurs pour drone FPV 5 pouces : course et freestyle", "Drones 5 et 6 pouces : course, racing et freestyle", range(21, 25)),
    ("7-pouces", "Moteurs pour drone FPV 7 pouces long range", "Drones 7 à 10 pouces, long range", range(25, 29)),
    ("gros-drones", "Moteurs pour gros drones, X-class et multirotors", "Gros drones, X-class, cinelifters et multirotors", range(29, 100)),
]
SPECS = [("KV", "KV", ""), ("POIDS", "Poids", " g"), ("CLASSE", "Classe", ""), ("CONFIG", "Configuration", ""),
         ("LIPO", "Voltage", ""), ("HELICE", "Hélice", ""), ("PUISSANCE", "Puissance max", " W"), ("AMP", "Intensité max", " A"),
         ("D SHAFT", "Ø shaft", " mm"), ("L SHAFT", "L shaft", " mm"), ("ENTRAXE FIX", "Entraxe de fixation", " mm"),
         ("D MOTEUR", "Ø moteur", " mm"), ("H MOTEUR", "H moteur", " mm"), ("RESISTANCE", "Résistance", " mΩ")]

e = lambda s: html.escape(str(s or ""), quote=True)


def slug(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "x"


def size_of(cls):
    m = re.match(r"(\d{2})\d{2}", cls or "")
    if not m:
        return None
    n = int(m.group(1))
    return next((s for s in SIZES if n in s[3]), None)


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        return None


def page(path, title, desc, body, crumbs, ld=None):
    """One page: head for search engines and link previews, header, breadcrumb, content, footer."""
    url = f"{SITE}/{path}"
    trail = [("Multi-Motors", "/")] + crumbs
    ld_all = [{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": SITE + (h if h.startswith("/") else "/" + h)} for i, (n, h) in enumerate(trail)]}]
    if ld:
        ld_all.append(ld)
    return f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(url)}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website"><meta property="og:site_name" content="Multi-Motors"><meta property="og:locale" content="fr_FR">
<meta property="og:url" content="{e(url)}"><meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">
<meta property="og:image" content="{SITE}/og-image.png">
<link rel="stylesheet" href="/assets/seo.css">
{"".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld_all)}
</head>
<body>
<header class="s-top"><a class="s-logo" href="/"><img src="/assets/img/logo-multi-motors.png" alt="" width="44" height="48"><span>Multi-Motors</span></a>
<a class="s-btn" href="/">Rechercher un moteur</a></header>
<nav class="s-crumbs" aria-label="Fil d'Ariane">{" › ".join(f'<a href="{e(h)}">{e(n)}</a>' for n, h in trail[:-1])} › <span>{e(trail[-1][0])}</span></nav>
<main class="s-main">
{body}
</main>
<footer class="s-foot"><p><b>Multi-Motors</b> : le catalogue des moteurs brushless pour drones FPV — fiches techniques, KV, poids, fixation, bancs d'essai, photos, vidéos et comparateur de prix, mis à jour chaque jour.</p>
<p><a href="/moteurs-brushless.html">Tous les moteurs brushless FPV</a> · {" · ".join(f'<a href="/taille/{s[0]}.html">{e(s[2].split(":")[0])}</a>' for s in SIZES)}</p>
<p class="s-legal"><a href="/mentions-legales.html">Mentions légales</a> · <a href="/confidentialite.html">Confidentialité et cookies</a> · <a href="/cgu.html">Conditions d'utilisation</a> · <a href="mailto:{CONTACT}">Contact</a></p></footer>
<script src="/assets/bug.js" defer></script>
</body>
</html>
"""


def main(out):
    out = Path(out)
    with (ROOT / "catalogue" / "moteurs.csv").open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("NOM") and not UNNAMED.search(r["NOM"])]
    load = lambda n: json.loads((ROOT / "site" / "data" / f"{n}.json").read_text()) if (ROOT / "site" / "data" / f"{n}.json").exists() else {}
    thumbs, prices, ranks, videos = load("thumbs"), load("prix"), load("classement"), load("videos")

    fams = {}
    for r in rows:
        fams.setdefault((r["MARQUE"], r["NOM"]), []).append(r)
    for k in fams:
        fams[k].sort(key=lambda r: num(r["KV"]) or 0)
    brands, classes, sizes = {}, {}, {}
    model_url = {}
    used = set()
    for (b, n) in fams:
        s = f"{slug(b)}-{slug(n)}"
        while s in used:
            s += "-2"
        used.add(s)
        model_url[(b, n)] = f"moteur/{s}.html"
        brands.setdefault(b, []).append((b, n))
        cls = next((r["CLASSE"] for r in fams[(b, n)] if r["CLASSE"]), "")
        if cls:
            classes.setdefault(cls.replace(",", ".")[:4], []).append((b, n))
            sz = size_of(cls)
            if sz:
                sizes.setdefault(sz[0], []).append((b, n))
    popularity = lambda k: -(ranks.get(f"{k[0]}|{k[1]}") or {}).get("pop", 0)

    def card(k):
        m = fams[k]
        img = next((thumbs[r["REF"]] for r in m if r["REF"] in thumbs), "")
        kvs = " · ".join(dict.fromkeys(f"{r['KV']} KV" for r in m if r["KV"]))
        cls = next((r["CLASSE"] for r in m if r["CLASSE"]), "")
        return (f'<a class="s-card" href="/{model_url[k]}">' + (f'<img src="/{e(img)}" alt="Moteur {e(k[0])} {e(k[1])}" loading="lazy" width="120" height="120">' if img else '<span class="s-noimg"></span>')
                + f'<span class="s-brand">{e(k[0])}</span><b>{e(k[1])}</b><small>{e(" · ".join(x for x in [cls, kvs] if x))}</small></a>')

    grid = lambda keys: '<div class="s-grid">' + "".join(card(k) for k in sorted(keys, key=lambda k: (popularity(k), k))) + "</div>"
    urls = [("", "1.0")]
    (out / "moteur").mkdir(parents=True, exist_ok=True)
    (out / "marque").mkdir(exist_ok=True)
    (out / "classe").mkdir(exist_ok=True)
    (out / "taille").mkdir(exist_ok=True)

    class_pages = {c for c, ks in classes.items() if len(ks) >= 2}  # a stator size page exists from 2 models

    # One page per model
    for k, m in fams.items():
        b, n = k
        first = m[0]
        cls = next((r["CLASSE"] for r in m if r["CLASSE"]), "")
        sz = size_of(cls)
        kvs = [r["KV"] for r in m if r["KV"]]
        img = next((thumbs[r["REF"]] for r in m if r["REF"] in thumbs), "")
        offers = [o for r in m for o in ((prices.get(r["REF"]) or {}).get("offers") or [])]
        low = min((o["eur"] for o in offers), default=None)
        high = max((o["eur"] for o in offers), default=None)
        shops = sorted({o["shop"] for o in offers})
        weight = next((r["POIDS"] for r in m if r["POIDS"]), "")
        cols = [c for c in SPECS if any(r.get(c[0]) for r in m)]
        table = ('<div class="s-table"><table><thead><tr>' + "".join(f"<th>{e(l)}</th>" for _, l, _ in cols) + "</tr></thead><tbody>"
                 + "".join("<tr>" + "".join(f"<td>{e(r.get(c) + u if r.get(c) and u and not str(r.get(c)).strip().endswith(u.strip()) else r.get(c) or '—')}</td>" for c, _, u in cols)
                           + f'<td><a href="/#m/{e(r["REF"])}">Fiche</a></td></tr>' for r in m)
                 + "</tbody></table></div>").replace("</tr></thead>", "<th></th></tr></thead>")
        vids = videos.get(f"{b}|{n}".upper()) or videos.get(f"{b}|{n}") or []
        title = f"Moteur {b} {n}" + (f" {'/'.join(kvs[:4])} KV" if kvs else "") + " : fiche technique et prix | Multi-Motors"
        desc = (f"Moteur brushless {b} {n}" + (f", classe {cls}" if cls else "") + (f", {', '.join(kvs[:5])} KV" if kvs else "")
                + (f", {weight} g" if weight else "") + ". Caractéristiques, dimensions, fixation" + (", prix comparés" if offers else "")
                + (", vidéos de test" if vids else "") + " sur Multi-Motors.")
        body = f"""<article class="s-model">
<div class="s-hero">{f'<img src="/{e(img)}" alt="Moteur brushless {e(b)} {e(n)}" width="260" height="260">' if img else ""}
<div><p class="s-kicker"><a href="/marque/{slug(b)}.html">{e(b)}</a>{(f' · <a href="/classe/{slug(cls.replace(",", ".")[:4])}.html">Classe {e(cls)}</a>' if cls.replace(",", ".")[:4] in class_pages else f" · Classe {e(cls)}") if cls else ""}{f' · <a href="/taille/{sz[0]}.html">{e(sz[2].split(":")[0])}</a>' if sz else ""}</p>
<h1>Moteur {e(b)} {e(n)}</h1>
<p class="s-lead">Moteur brushless{f" de classe {e(cls)}" if cls else ""} pour drone FPV{f", disponible en {len(kvs)} versions ({e(', '.join(kvs[:-1]))} et {e(kvs[-1])} KV)" if len(kvs) > 1 else (f", {e(kvs[0])} KV" if kvs else "")}{f", poids {e(weight)} g" if weight else ""}.{f" Utilisation : {e(first['UTILISATION'])}." if first.get("UTILISATION") else ""}</p>
{f'<p class="s-price">À partir de <b>{low:.2f} €</b> par moteur{f" (jusqu&#39;à {high:.2f} €)" if high and high > low else ""} chez {len(shops)} boutique{"s" if len(shops) > 1 else ""} : {e(", ".join(shops))}.</p>' if low else ""}
<p><a class="s-btn big" href="/#m/{e(first['REF'])}">Voir la fiche complète : photos, vidéos, banc d'essai, prix →</a></p></div></div>
<h2>Caractéristiques techniques{f" par KV" if len(m) > 1 else ""}</h2>
{table}
{f"<h2>Vidéos de test</h2><ul>" + "".join(f'<li><a href="https://www.youtube.com/watch?v={e(v["id"])}" rel="nofollow noopener" target="_blank">{e(v["t"])}</a> — {e(v.get("c", ""))}</li>' for v in vids[:4]) + "</ul>" if vids else ""}
<h2>Moteurs {e(b)} proches</h2>
{grid([x for x in brands[b] if x != k][:12]) if len(brands[b]) > 1 else "<p>Pas d'autre modèle de cette marque dans le catalogue.</p>"}
</article>"""
        ld = {"@context": "https://schema.org", "@type": "Product", "name": f"Moteur brushless {b} {n}", "brand": {"@type": "Brand", "name": b},
              "category": "Moteur brushless pour drone FPV", "url": f"{SITE}/{model_url[k]}", "description": desc}
        if img:
            ld["image"] = f"{SITE}/{img}"
        if low:
            ld["offers"] = {"@type": "AggregateOffer", "priceCurrency": "EUR", "lowPrice": f"{low:.2f}", "highPrice": f"{high:.2f}", "offerCount": len(offers)}
        crumbs = [(b, f"/marque/{slug(b)}.html"), (n, "/" + model_url[k])]
        (out / model_url[k]).write_text(page(model_url[k], title, desc, body, crumbs, ld), encoding="utf-8")
        urls.append((model_url[k], "0.6"))

    # One page per brand
    for b, keys in brands.items():
        p = f"marque/{slug(b)}.html"
        title = f"Moteurs brushless {b} : les {len(keys)} modèles, fiches et prix | Multi-Motors"
        desc = f"Tous les moteurs brushless {b} pour drone FPV : {len(keys)} modèles, KV, poids, classes, fiches techniques et prix comparés."
        body = f"<h1>Moteurs brushless {e(b)}</h1><p class='s-lead'>{len(keys)} modèle{'s' if len(keys) > 1 else ''} de moteurs {e(b)} pour drones FPV (course, freestyle, long range…), du plus populaire au moins connu.</p>{grid(keys)}"
        (out / p).write_text(page(p, title, desc, body, [("Moteurs brushless", "/moteurs-brushless.html"), (b, "/" + p)]), encoding="utf-8")
        urls.append((p, "0.7"))

    # One page per stator size (at least 2 models)
    for cls, keys in classes.items():
        if len(keys) < 2:
            continue
        p = f"classe/{slug(cls)}.html"
        sz = size_of(cls)
        title = f"Moteurs brushless {cls} : {len(keys)} modèles comparés | Multi-Motors"
        desc = f"Comparez les {len(keys)} moteurs brushless {cls} pour drone FPV" + (f" ({sz[2].split(':')[0].lower()})" if sz else "") + " : KV, poids, marques, fiches techniques et prix."
        body = f"<h1>Moteurs brushless {e(cls)}</h1><p class='s-lead'>Stator de {e(cls[:2])} mm de diamètre et {e(cls[2:4])} mm de hauteur" + (f", utilisé pour : {e(sz[2])}" if sz else "") + f". {len(keys)} modèles de {len({k[0] for k in keys})} marques.</p>{grid(keys)}"
        crumbs = [("Moteurs brushless", "/moteurs-brushless.html")] + ([(sz[2].split(":")[0], f"/taille/{sz[0]}.html")] if sz else []) + [(f"Classe {cls}", "/" + p)]
        (out / p).write_text(page(p, title, desc, body, crumbs), encoding="utf-8")
        urls.append((p, "0.7"))

    # One page per drone size
    for key, h1, label, _ in SIZES:
        keys = sizes.get(key, [])
        p = f"taille/{key}.html"
        cls_here = sorted({c for c, ks in classes.items() if len(ks) >= 2 and size_of(c) and size_of(c)[0] == key})
        title = f"{h1} | Multi-Motors"
        desc = f"{h1} : {len(keys)} moteurs brushless comparés (KV, poids, classe, prix) pour {label.lower()}."
        body = (f"<h1>{e(h1)}</h1><p class='s-lead'>{len(keys)} moteurs brushless pour {e(label.lower())}. Choisissez la classe du stator :</p>"
                "<p class='s-tags'>" + "".join(f'<a href="/classe/{slug(c)}.html">{e(c)}</a>' for c in cls_here) + f"</p>{grid(keys)}")
        (out / p).write_text(page(p, title, desc, body, [("Moteurs brushless", "/moteurs-brushless.html"), (label.split(":")[0], "/" + p)]), encoding="utf-8")
        urls.append((p, "0.8"))

    # Hub page
    p = "moteurs-brushless.html"
    top = sorted(fams, key=lambda k: (popularity(k), k))[:24]
    body = f"""<h1>Moteurs brushless pour drones FPV</h1>
<p class="s-lead">Le catalogue Multi-Motors réunit {len(rows)} moteurs brushless identifiés ({len(fams)} modèles, {len(brands)} marques) pour drones FPV de course (racing), freestyle, long range, cinewhoop et whoop : fiches techniques par KV, poids, dimensions, shaft et fixation, bancs d'essai, photos, vidéos de review et prix comparés dans les boutiques françaises et internationales.</p>
<h2>Par taille de drone</h2><p class="s-tags">{"".join(f'<a href="/taille/{s[0]}.html">{e(s[2])}</a>' for s in SIZES)}</p>
<h2>Par marque</h2><p class="s-tags">{"".join(f'<a href="/marque/{slug(b)}.html">{e(b)} <small>{len(ks)}</small></a>' for b, ks in sorted(brands.items(), key=lambda x: (-len(x[1]), x[0])))}</p>
<h2>Par classe de stator</h2><p class="s-tags">{"".join(f'<a href="/classe/{slug(c)}.html">{e(c)} <small>{len(ks)}</small></a>' for c, ks in sorted(classes.items(), key=lambda x: (-len(x[1]), x[0])) if len(ks) >= 2)}</p>
<h2>Les moteurs les plus populaires</h2>{grid(top)}"""
    (out / p).write_text(page(p, "Moteurs brushless FPV : catalogue et comparatif par marque, taille et KV | Multi-Motors",
                              f"Catalogue de {len(fams)} moteurs brushless pour drone FPV : course, freestyle, long range, whoop. Comparez KV, poids, classes, marques et prix.",
                              body, [("Moteurs brushless", "/" + p)]), encoding="utf-8")
    urls.append((p, "0.9"))

    # Legal pages: text written in pages/, same layout as the other pages
    for f in sorted((ROOT / "pages").glob("*.html")):
        src = f.read_text(encoding="utf-8").replace("{{CONTACT}}", CONTACT).replace("{{DATE}}", LEGAL_DATE)
        title = re.search(r"<!-- title: (.*?) -->", src).group(1)
        desc = re.search(r"<!-- description: (.*?) -->", src).group(1)
        body = re.sub(r"<!--.*?-->\n?", "", src, flags=re.S)
        (out / f.name).write_text(page(f.name, title, desc, f'<div class="s-legal-page">{body}</div>', [(title.split(" |")[0], "/" + f.name)]), encoding="utf-8")
        urls.append((f.name, "0.3"))

    today = date.today().isoformat()
    (out / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                     + "".join(f"<url><loc>{SITE}/{u}</loc><lastmod>{today}</lastmod><priority>{pr}</priority></url>\n" for u, pr in urls)
                                     + "</urlset>\n", encoding="utf-8")
    (out / "robots.txt").write_text(f"User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: {SITE}/sitemap.xml\n", encoding="utf-8")
    print(f"{len(fams)} pages modèle, {len(brands)} marques, {sum(1 for ks in classes.values() if len(ks) >= 2)} classes, {len(SIZES)} tailles, {len(urls)} adresses dans le sitemap")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "build")
