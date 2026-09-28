"""Shops searched for prices and photos (tools/prices.py).

Each shop answers search(query) with a list of candidate products:
    {"title", "url", "variants": [{"title", "price", "stock", "id"}], "images": [url, ...]}
Prices are in the shop's currency (SHOP.cur); SHOP.country is where it ships from
(the site shows the shops of the visitor's country first). Kinds of shop:
- Shopify: /search/suggest.json then /products/<handle>.json (variants per KV, every photo)
- PrestaShop (Drone-FPV-Racer, Drone Doctors): motor category in JSON
- Studiosport, FPV Fly (Magento), Team BlackSheep: motor category pages (HTML)
- WooCommerce (FPV World): public Store API, one price per variation
Shops that refuse robots (La Caméra Embarquée, Banggood, AliExpress, GetFPV) are
only offered as search links by the site (SEARCH_LINKS in site/assets/community.js).
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
    def __init__(self, host, name, cur="USD", brand="", country="US"):
        self.host, self.name, self.cur, self.brand, self.country = host, name, cur, brand, country

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

    def __init__(self, host, name, category, cur="EUR", country="FR"):
        self.host, self.name, self.category, self.cur, self.brand, self.country = host, name, category, cur, "", country
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
        # Every photo of the product page (same image ids, "large_default" size), and the stock
        # when the category hides it (schema.org availability of the page)
        page = get(item["url"], json=False) or ""
        imgs = re.findall(rf"https://{re.escape(self.host)}/\d+-large_default/[\w-]+\.jpg", page)
        variants = item["variants"]
        if "schema.org/InStock" in page or "schema.org/OutOfStock" in page:
            variants = [{**v, "stock": "schema.org/InStock" in page} for v in variants]
        return {**item, "variants": variants, "images": list(dict.fromkeys(item["images"] + imgs))}


class Studiosport:
    """Its search is fuzzy: the "Moteurs" category (FPV motors) is read once and matched locally."""
    host, name, cur, brand, country = "www.studiosport.fr", "Studiosport", "EUR", "", "FR"
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


class Magento:
    """FPV Fly: the motor categories are read once (listing pages) and matched locally."""

    def __init__(self, host, name, categories, cur="EUR", country="FR"):
        self.host, self.name, self.categories, self.cur, self.brand, self.country = host, name, categories, cur, "", country
        self._items, self._lock = None, threading.Lock()

    def search(self, query):
        with self._lock:
            if self._items is None:
                self._items, seen = [], set()
                for cat in self.categories:
                    for n in range(1, 30):
                        page = get(f"https://{self.host}/{cat}", json=False, params={"p": n, "product_list_limit": 36}) or ""
                        new = []
                        for it in re.findall(r'<li class="item product product-item">(.*?)</li>', page, re.S):
                            a = re.search(r'class="product-item-link"\s+href="([^"]+)"[^>]*>\s*([^<]+?)\s*</a>', it)
                            prices = [float(x) for x in re.findall(r'data-price-amount="([\d.]+)"', it)]
                            if not a or not prices or a.group(1) in seen:
                                continue
                            seen.add(a.group(1))
                            img = re.search(r'<img[^>]+src="(https://[^"]+/catalog/product/[^"]+)"', it)
                            new.append({"title": html.unescape(a.group(2)), "url": a.group(1),
                                        "variants": [{"title": "", "price": min(prices), "id": None,
                                                      "stock": "unavailable" not in it and "Rupture" not in it}],
                                        "images": [img.group(1)] if img else []})
                        if not new:
                            break
                        self._items += new
            return self._items


class TeamBlackSheep:
    """TBS shop: every motor sub-category (08XX, 22XX…) listed with title, price and stock."""
    host, name, cur, brand, country = "www.team-blacksheep.com", "Team BlackSheep", "USD", "", "HK"

    def __init__(self):
        self._items, self._lock = None, threading.Lock()

    def search(self, query):
        with self._lock:
            if self._items is None:
                self._items, seen = [], set()
                top = get(f"https://{self.host}/products/cat:motors", json=False) or ""
                for cat in dict.fromkeys(re.findall(r'href="/shop/(cat:motors-\w+)"', top)):
                    page = get(f"https://{self.host}/shop/{cat}", json=False) or ""
                    for href, img, title, price, rest in re.findall(
                            r'<a href="(/products/product:\d+)"[^>]*><img class="product" src="([^"]+)"\s*/><p><b>([^<]+)</b><br\s*/><em>US\$\s*([\d.,]+)(.*?)</em>', page, re.S):
                        if href in seen:
                            continue
                        seen.add(href)
                        self._items.append({"title": html.unescape(title), "url": f"https://{self.host}{href}",
                                            "variants": [{"title": "", "price": float(price.replace(",", "")), "stock": "In Stock" in rest, "id": None}],
                                            "images": [f"https://{self.host}{img}".replace(" ", "%20")]})
                    time.sleep(0.3)
            return self._items


class WooStore:
    """WooCommerce shops (FPV World): public Store API, the KV of a variation is in its attributes."""

    def __init__(self, host, name, cur="EUR", country="FR"):
        self.host, self.name, self.cur, self.brand, self.country = host, name, cur, "", country

    @staticmethod
    def price(p):
        pr = p.get("prices") or {}
        return int(pr.get("price") or 0) / 10 ** int(pr.get("currency_minor_unit") or 2)

    def search(self, query):
        # Its search wants every word: the size alone ("2306") finds the model, prices.py checks the rest
        size = re.search(r"(?<![\d.])\d{4}(?![\d])", query)
        term = size.group(0) if size else " ".join(re.findall(r"[\w.]+", query)[-2:])
        hits = get(f"https://{self.host}/wp-json/wc/store/v1/products", params={"search": term, "per_page": 50}) or []
        return [{"title": html.unescape(p.get("name", "")), "url": p.get("permalink", ""), "id": p.get("id"), "raw": p, "lazy": True}
                for p in hits if isinstance(p, dict)]

    def details(self, item):
        p = item["raw"]
        variants = []
        for v in p.get("variations") or []:
            vp = get(f"https://{self.host}/wp-json/wc/store/v1/products/{v['id']}") or {}
            if vp:
                variants.append({"title": " ".join(a.get("value", "") for a in v.get("attributes") or []), "price": self.price(vp),
                                 "stock": bool(vp.get("is_in_stock")), "id": None})
        if not variants:
            variants = [{"title": "", "price": self.price(p), "stock": bool(p.get("is_in_stock")), "id": None}]
        return {**item, "variants": variants, "images": [i["src"] for i in p.get("images") or [] if i.get("src")]}


SHOPS = [
    Shopify("www.racedayquads.com", "RaceDayQuads"),
    Shopify("pyrodrone.com", "Pyrodrone"),
    Shopify("newbeedrone.com", "NewBeeDrone"),
    Shopify("rotorriot.com", "Rotor Riot"),
    Shopify("www.speedyfpv.com", "SpeedyFPV"),
    Shopify("www.fpvfaster.com", "FPVFaster"),
    Shopify("www.quadmula.com", "Quadmula"),
    Shopify("www.unmannedtechshop.co.uk", "Unmanned Tech", "GBP", country="GB"),
    Shopify("wrekd.com", "WREKD"),
    Shopify("rcdrone.top", "RCDrone", country="CN"),
    # French shops
    PrestaShop("www.drone-fpv-racer.com", "Drone-FPV-Racer", "417-moteurs"),
    Studiosport(),
    PrestaShop("www.drone-doctors.fr", "Drone Doctors", "14-moteurs"),
    Magento("www.fpv-fly.fr", "FPV Fly", ["quadcopter/moteurs/moteurs-08xx-16xx.html", "quadcopter/moteurs/moteurs-22xx.html",
                                          "quadcopter/moteurs/moteurs-23xx-28xx.html", "avion-fpv/moteurs.html"]),
    WooStore("fpv-world.fr", "FPV World"),
    TeamBlackSheep(),
    # Brand stores: only asked about their own motors
    Shopify("shop.emax-usa.com", "Emax (officiel)", brand="emax"),
    Shopify("rushfpv.net", "RushFPV (officiel)", brand="rush"),
    Shopify("betafpv.com", "BetaFPV (officiel)", brand="beta"),
    Shopify("www.hglrc.com", "HGLRC (officiel)", brand="hglrc", country="CN"),
    Shopify("www.diatone.us", "Diatone (officiel)", brand="diatone"),
]
