"""Shops searched for prices and photos (tools/prices.py).

Each shop answers search(query) with a list of candidate products:
    {"title", "url", "variants": [{"title", "price", "stock", "id"}], "images": [url, ...]}
Prices are in the shop's currency (SHOP.cur). Three kinds of shop:
- Shopify: /search/suggest.json then /products/<handle>.json (variants per KV, every photo)
- PrestaShop (Drone-FPV-Racer): search controller in JSON
- Studiosport: search result page (HTML)
"""
import html, re, threading, time
import requests

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
session = requests.Session()
session.headers.update(UA)


def get(url, json=True, **kw):
    for attempt in range(3):
        try:
            r = session.get(url, timeout=25, **kw)
            if r.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            if not r.ok:
                return None
            return r.json() if json else r.text
        except (requests.RequestException, ValueError):
            time.sleep(1)
    return None


class Shopify:
    def __init__(self, host, name, cur="USD", brand=""):
        self.host, self.name, self.cur, self.brand = host, name, cur, brand

    def search(self, query):
        data = get(f"https://{self.host}/search/suggest.json", params={"q": query, "resources[type]": "product", "resources[limit]": 8})
        try:
            hits = data["resources"]["results"]["products"]
        except (TypeError, KeyError):
            return []
        return [{"title": p["title"], "url": f"https://{self.host}{p['url'].split('?')[0]}", "lazy": True} for p in hits]

    def details(self, item):
        p = (get(item["url"] + ".json") or {}).get("product")
        if not p:
            return None
        return {**item, "title": p.get("title", item["title"]),
                "variants": [{"title": v.get("title") or "", "price": float(v.get("price") or 0), "stock": bool(v.get("available", True)),
                              "id": v.get("id")} for v in p.get("variants") or []],
                "images": [i["src"].split("?")[0] for i in p.get("images") or [] if i.get("src")]}


class PrestaShop:
    """Drone-FPV-Racer: its search needs exact words, so the whole motor category is read once
    (the category controller answers JSON) and matched locally by tools/prices.py."""

    def __init__(self, host, name, category, cur="EUR"):
        self.host, self.name, self.category, self.cur, self.brand = host, name, category, cur, ""
        self._items, self._lock = None, threading.Lock()

    def catalogue(self):
        with self._lock:
            if self._items is None:
                self._items, page = [], 1
                while page <= 30:
                    data = get(f"https://{self.host}/{self.category}", params={"page": page, "resultsPerPage": 100},
                               headers={"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"}) or {}
                    for p in data.get("products", []):
                        img = ((p.get("cover") or {}).get("large") or {}).get("url")
                        self._items.append({"title": html.unescape(p.get("name", "")), "url": p.get("url", "").split("#")[0],
                                            "variants": [{"title": "", "price": float(p.get("price_amount") or 0),
                                                          "stock": int(p.get("quantity") or 0) > 0 or p.get("availability") == "available", "id": None}],
                                            "images": [img] if img else [], "lazy": True})
                    if page >= int((data.get("pagination") or {}).get("pages_count") or 0):
                        break
                    page += 1
            return self._items

    def search(self, query):
        return self.catalogue()

    def details(self, item):
        # Every photo of the product page (same image ids, "large_default" size)
        page = get(item["url"], json=False) or ""
        imgs = re.findall(rf"https://{re.escape(self.host)}/\d+-large_default/[\w-]+\.jpg", page)
        return {**item, "images": list(dict.fromkeys(item["images"] + imgs))}


class Studiosport:
    """Its search is fuzzy: the "Moteurs" category (FPV motors) is read once and matched locally."""
    host, name, cur, brand = "www.studiosport.fr", "Studiosport", "EUR", ""
    category = "/mini-multirotors-motorisations-c-963_1252_1255.html"

    def __init__(self):
        self._items, self._lock = None, threading.Lock()

    @staticmethod
    def boxes(page):
        out = []
        for b in page.split('class="product_box ')[1:]:
            a = re.search(r'class="bp_designation">\s*<a href="([^"]+)">\s*([^<]+?)\s*</a>', b)
            price = re.search(r"<!-- PRICE -->.*?([\d\s.]+,\d{2})\s*&euro;", b, re.S)
            if not a or not price:
                continue
            img = re.search(r'src="(https://www\.studiosport\.fr/upload/image/[^"?]+)', b)
            out.append({"title": html.unescape(a.group(2)), "url": a.group(1),
                        "variants": [{"title": "", "price": float(price.group(1).replace(" ", "").replace(".", "").replace(",", ".")),
                                      "stock": "enstock" in b, "id": None}],
                        "images": [img.group(1).replace("-moyenne.", "-grande.")] if img else [], "lazy": True})
        return out

    def search(self, query):
        with self._lock:
            if self._items is None:
                self._items, seen = [], set()
                for n in range(1, 30):
                    page = get(f"https://{self.host}{self.category}", json=False, params={"numPage": n} if n > 1 else None) or ""
                    new = [i for i in self.boxes(page) if i["url"] not in seen]
                    if not new:
                        break
                    seen.update(i["url"] for i in new)
                    self._items += new
            return self._items

    def details(self, item):
        page = get(item["url"], json=False) or ""
        imgs = [u.replace("-moyenne.", "-grande.") for u in re.findall(r"https://www\.studiosport\.fr/upload/image/[\w-]+-(?:grande|moyenne|zoom)\.jpg", page)]
        return {**item, "images": list(dict.fromkeys(item["images"] + imgs))}


SHOPS = [
    Shopify("www.racedayquads.com", "RaceDayQuads"),
    Shopify("pyrodrone.com", "Pyrodrone"),
    Shopify("newbeedrone.com", "NewBeeDrone"),
    Shopify("rotorriot.com", "Rotor Riot"),
    Shopify("www.speedyfpv.com", "SpeedyFPV"),
    Shopify("www.fpvfaster.com", "FPVFaster"),
    Shopify("www.quadmula.com", "Quadmula"),
    Shopify("www.unmannedtechshop.co.uk", "Unmanned Tech", "GBP"),
    PrestaShop("www.drone-fpv-racer.com", "Drone-FPV-Racer", "417-moteurs"),
    Studiosport(),
    # Brand stores: only asked about their own motors
    Shopify("shop.emax-usa.com", "Emax (officiel)", brand="emax"),
    Shopify("rushfpv.net", "RushFPV (officiel)", brand="rush"),
    Shopify("betafpv.com", "BetaFPV (officiel)", brand="beta"),
    Shopify("www.hglrc.com", "HGLRC (officiel)", brand="hglrc"),
    Shopify("www.diatone.us", "Diatone (officiel)", brand="diatone"),
]
