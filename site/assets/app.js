/* Multi-Motors — catalogue front-end, d'après la maquette Figma.
 * Loads catalogue/moteurs.csv (copied to data/moteurs.csv at deploy time).
 * Views: home (#, #liste) and motor page (#m/<REF>).
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const PAGE = 20;
  const IMG = "assets/img/";
  // Standalone preview builds inline their images in window.MM_ASSETS
  const asset = (name) => (window.MM_ASSETS && window.MM_ASSETS[name]) || IMG + name;
  // Brand logos available in the Figma file; other brands use a text mark
  const LOGOS = { "T-MOTOR": "logo-t-motor.png" };
  // Extension points used by community.js (accounts, likes, prices, news…)
  const hooks = (window.MM_HOOKS = window.MM_HOOKS || {});
  const state = { motors: [], thumbs: {}, videos: {}, photos: {}, tab: "populaire", sort: "", q: "", shown: PAGE, f: {}, revealed: false };

  // --- CSV -----------------------------------------------------------------
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const header = rows.shift() || [];
    return rows
      .filter((r) => r.some((v) => v.trim()))
      .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] || "").trim()])));
  }

  async function loadCSV() {
    if (typeof window.MOTEURS_CSV === "string") return window.MOTEURS_CSV;
    for (const url of ["data/moteurs.csv", "../catalogue/moteurs.csv"]) {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (res.ok) return await res.text();
      } catch (e) { /* try next */ }
    }
    throw new Error("Catalogue introuvable");
  }

  // Optional data files published with the site (tools/thumbs.py, videos.py, photos.py)
  async function loadJSON(name, inline) {
    if (inline) return inline;
    try {
      const res = await fetch(`data/${name}.json`, { cache: "no-cache" });
      if (res.ok) return await res.json();
    } catch (e) { /* file not published yet */ }
    return {};
  }

  // --- Helpers -------------------------------------------------------------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (s) => { const n = parseFloat(String(s ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const fmt = (s) => {
    const n = num(s);
    return n === null || !/^\s*[\d.,]+\s*$/.test(String(s)) ? String(s ?? "") : String(Math.round(n * 100) / 100);
  };
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s*×]/g, "x").replace(/[^a-z0-9.x]/g, "");
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";

  const family = (m) => state.motors.filter((x) => x.MARQUE === m.MARQUE && x.NOM === m.NOM);
  const kvList = (m) => [...new Set(family(m).map((x) => fmt(x.KV)).filter(Boolean))].sort((a, b) => num(a) - num(b));
  const shaft = (m) => (/^M\d/i.test(m["VIS HEL"] || "") ? m["VIS HEL"] : has(m["D SHAFT"]) ? `${fmt(m["D SHAFT"])}mm` : "");
  const weight = (m) => (has(m.POIDS) ? `${fmt(m.POIDS)}GR` : "");
  const unit = (v, u) => (has(v) ? `${fmt(v)}${u}` : "");
  const cable = (m) => m["TYPE CABLE"] || "";
  function completeness(m) {
    return ["POIDS", "D MOTEUR", "H MOTEUR", "D SHAFT", "ENTRAXE FIX", "LIPO", "CONFIG", "AMP", "PUISSANCE", "TYPE CABLE", "HELICE", "AIMANT", "IMG"]
      .filter((k) => has(m[k])).length;
  }
  function cells(m) {
    const c = (m.LIPO || "").match(/\d+/g);
    return c ? c.map(Number) : [];
  }

  function brandMark(m, big) {
    const logo = LOGOS[String(m.MARQUE).toUpperCase()];
    return logo
      ? `<span class="logo"><img src="${asset(logo)}" alt="${esc(m.MARQUE)}"></span>`
      : `<span class="brand-word${big ? " big" : ""}">${esc(m.MARQUE)}</span>`;
  }

  // Motor photo (our thumbnail first, then the shop image), or the line drawing
  // from the mockup when there is none or it fails to load
  function photo(m, fallback = "moteur-trait.png") {
    const u = state.thumbs[m.REF] || safeUrl(m.IMG), alt = esc(`${m.MARQUE} ${m.NOM}`);
    return u
      ? `<img class="is-photo" src="${esc(u)}" alt="${alt}" loading="lazy" onerror="this.onerror=null;this.classList.remove('is-photo');this.src='${asset(fallback)}'">`
      : `<img src="${asset(fallback)}" alt="${alt}" loading="lazy">`;
  }

  // --- Home: motor cards ---------------------------------------------------
  const lbl = (t) => `<span class="lbl">${esc(t)}</span>`;
  // One "label + value" cell of a result card
  const pr = (label, valuesHtml) => `<span class="pair">${lbl(label)}${valuesHtml}</span>`;
  const one = (v) => (has(v) ? `<span class="val" title="${esc(v)}">${esc(v)}</span>` : `<span class="val na">—</span>`);
  const val = (v) => `<span class="vals">${one(v)}</span>`;
  const pair = (a, b) => `<span class="vals">${has(a) || has(b) ? `${one(a)}<span class="x">X</span>${one(b)}` : one("")}</span>`;
  const kvVals = (m) => `<span class="vals">${kvList(m).slice(0, 3).map(one).join(`<span class="x">X</span>`) || one("")}</span>`;

  function row(m, i) {
    const href = `#m/${encodeURIComponent(m.REF)}`;
    const link = safeUrl(m.LIEN);
    return `<article class="row" style="--i:${i % PAGE}">
      <div class="row-id">${brandMark(m)}<a class="name" href="${href}">${esc(m.NOM || m.REF)}</a>${hooks.rowExtra ? hooks.rowExtra(m) : ""}</div>
      <a class="row-img" href="${href}" tabindex="-1" aria-hidden="true">${photo(m)}</a>
      <div class="specs">
        ${pr("Classe", val(m.CLASSE))}${pr("Poids", val(weight(m)))}${pr("Configuration", val(m.CONFIG))}${pr("KV", kvVals(m))}
        ${pr("Shaft", val(shaft(m)))}${pr("Entraxe de fixation", val(m["ENTRAXE FIX"]))}${pr("Dimension", pair(fmt(m["D MOTEUR"]), fmt(m["H MOTEUR"])))}${pr("L shaft", val(fmt(m["L SHAFT"])))}
        ${pr("Résistance", val(m.RESISTANCE))}${pr("Utilisation", val(m.UTILISATION))}${pr("Hélice", val(m.HELICE))}${pr("Câble", val(cable(m)))}
        ${pr("Amp max", val(fmt(m.AMP)))}${pr("Voltage", val(m.LIPO))}${pr("Vis hélice", val(m["VIS HEL"]))}
        ${link ? `<a class="official" href="${esc(link)}" target="_blank" rel="noopener">Lien officiel</a>` : `<span class="official off">Lien officiel</span>`}
      </div>
    </article>`;
  }

  function readFilters() {
    const v = (id) => ($(id).type === "checkbox" ? $(id).checked : $(id).value.trim());
    state.f = {
      kv: num(v("f-kv")), poids: num(v("f-poids")), classe: v("f-classe"), voltage: num(v("f-voltage")),
      amp: num(v("f-amp")), pmax: num(v("f-pmax")), shaft: norm(v("f-shaft")), usage: v("f-usage").toLowerCase(),
      dmot: num(v("f-dmot")), hmot: num(v("f-hmot")), config: norm(v("f-config")), entraxe: norm(v("f-entraxe")),
      helice: v("f-helice").replace(/[^\d.]/g, ""),
      marque: v("a-marque"), modele: v("a-modele").toLowerCase(), cable: norm(v("a-cable")), res: v("a-res").toLowerCase(),
      aimant: v("a-aimant").toLowerCase(), cloche: v("a-cloche").toLowerCase(), vish: v("a-vish"),
      tshaft: v("a-tshaft").toLowerCase(), lshaft: num(v("a-lshaft")), visfix: v("a-visfix").toLowerCase(),
      // Fields from the mockup the catalogue has no column for yet (connecteur, efficacité, roulement…) are not filtered
    };
  }

  const inc = (field, q) => String(field || "").toLowerCase().includes(q);
  function matches(m) {
    const f = state.f, q = state.q.toLowerCase();
    if (q && ![m.REF, m.MARQUE, m.NOM, m.VERSION, m.CLASSE, m.KV].join(" ").toLowerCase().includes(q)) return false;
    if (f.kv !== null && !(num(m.KV) && Math.abs(num(m.KV) - f.kv) <= f.kv * 0.1)) return false;
    if (f.poids !== null && !(num(m.POIDS) !== null && num(m.POIDS) <= f.poids)) return false;
    if (f.classe && !(m.CLASSE || "").startsWith(f.classe)) return false;
    if (f.voltage !== null) { const c = cells(m); if (!c.length || f.voltage < Math.min(...c) || f.voltage > Math.max(...c)) return false; }
    if (f.amp !== null && !(num(m.AMP) >= f.amp)) return false;
    if (f.pmax !== null && !(num(m.PUISSANCE) >= f.pmax)) return false;
    if (f.shaft && !(norm(m["VIS HEL"]).includes(f.shaft) || norm(m["D SHAFT"]) === f.shaft.replace(/^m/, ""))) return false;
    if (f.usage && !inc(m.UTILISATION, f.usage)) return false;
    if (f.dmot !== null && !(num(m["D MOTEUR"]) !== null && num(m["D MOTEUR"]) <= f.dmot)) return false;
    if (f.hmot !== null && !(num(m["H MOTEUR"]) !== null && num(m["H MOTEUR"]) <= f.hmot)) return false;
    if (f.config && !norm(m.CONFIG).includes(f.config)) return false;
    if (f.entraxe && !norm(m["ENTRAXE FIX"]).includes(f.entraxe)) return false;
    if (f.helice && !(m.HELICE || "").includes(f.helice)) return false;
    if (f.marque && m.MARQUE !== f.marque) return false;
    if (f.modele && !inc(m.NOM, f.modele)) return false;
    if (f.cable && !norm(m["TYPE CABLE"]).includes(f.cable)) return false;
    if (f.res && !inc(m.RESISTANCE, f.res)) return false;
    if (f.aimant && !inc(m.AIMANT, f.aimant)) return false;
    if (f.cloche && !inc(m.CLOCHE, f.cloche)) return false;
    if (f.vish && !(has(m["VIS HEL"]) && !/^non$/i.test(m["VIS HEL"]))) return false;
    if (f.tshaft && !inc(m["TYPE SHAFT"], f.tshaft)) return false;
    if (f.lshaft !== null && !(num(m["L SHAFT"]) !== null && Math.abs(num(m["L SHAFT"]) - f.lshaft) <= 1)) return false;
    if (f.visfix && !inc(m["VIS FIX"], f.visfix)) return false;
    return true;
  }

  function sorted(list) {
    const by = {
      "kv-asc": (a, b) => (num(a.KV) ?? 1e9) - (num(b.KV) ?? 1e9),
      "kv-desc": (a, b) => (num(b.KV) ?? -1) - (num(a.KV) ?? -1),
      "poids-asc": (a, b) => (num(a.POIDS) ?? 1e9) - (num(b.POIDS) ?? 1e9),
      "classe": (a, b) => (a.CLASSE || "9999").localeCompare(b.CLASSE || "9999") || (num(a.KV) ?? 0) - (num(b.KV) ?? 0),
      "marque": (a, b) => a.MARQUE.localeCompare(b.MARQUE) || (a.NOM || "").localeCompare(b.NOM || ""),
      // No sales data yet: "Best-seller" and "Populaire" both show the most complete sheets first
      "populaire": (a, b) => completeness(b) - completeness(a) || (num(a.ID) ?? 0) - (num(b.ID) ?? 0),
      "bestseller": (a, b) => (hooks.likes?.(b) || 0) - (hooks.likes?.(a) || 0) || completeness(b) - completeness(a),
      "nouveautes": (a, b) => (num(b.ID) ?? 0) - (num(a.ID) ?? 0),
    }[state.sort || state.tab];
    return list.slice().sort(by);
  }

  function renderList() {
    if (!state.revealed) return;
    const list = sorted(state.motors.filter(matches));
    $("rows").innerHTML = list.slice(0, state.shown).map(row).join("");
    // "Afficher plus" only animates the newly added rows
    [...$("rows").children].slice(0, state.shown - PAGE).forEach((r) => (r.style.animation = "none"));
    $("more").hidden = list.length <= state.shown;
    $("empty").hidden = list.length > 0;
    $("count").textContent = `${list.length} moteur${list.length > 1 ? "s" : ""} sur ${state.motors.length}`;
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === state.tab)));
  }

  // --- Motor page ----------------------------------------------------------
  // Short explanations shown by the "i" icons of the technical sheet
  const GLOSSARY = {
    kv: "Tours par minute et par volt, à vide. KV élevé : le moteur tourne vite (petites hélices, basse tension). KV bas : plus de couple (grandes hélices, haute tension).",
    classe: "Taille du stator : les deux premiers chiffres donnent son diamètre, les deux derniers sa hauteur, en mm. 2207 = stator de 22 × 7 mm.",
    poids: "Masse d'un moteur, câbles compris sauf mention contraire. Sur un drone, 4 moteurs : chaque gramme compte quatre fois.",
    shaft: "L'axe qui porte l'hélice. M5 : axe fileté de 5 mm serré par un écrou. 1,5 mm ou moins : hélice vissée (T-mount) ou emmanchée.",
    lshaft: "Longueur de l'axe qui dépasse de la cloche : elle doit correspondre à l'épaisseur du moyeu de l'hélice.",
    entraxe: "Distance entre les trous de fixation sous le moteur. 16×16 et 19×19 mm pour les 5 à 7 pouces, 12×12 ou 9×9 pour les petits moteurs.",
    visfix: "Diamètre des vis qui fixent le moteur au châssis (M2, M3…).",
    voltage: "Batteries LiPo acceptées, en nombre de cellules « S ». Une cellule = 3,7 V nominal, 4,2 V chargée. 6S = 22,2 V.",
    amp: "Courant maximal absorbé à plein gaz. Choisissez un ESC qui supporte au moins 20 % de plus.",
    puissance: "Puissance électrique maximale absorbée à plein gaz, en watts.",
    config: "Nombre de bobines du stator (N) et d'aimants de la cloche (P). 12N14P est le standard des moteurs FPV ; 9N12P sur les petits moteurs.",
    resistance: "Résistance interne du bobinage. Plus elle est faible, moins le moteur chauffe et plus il est efficace à fort courant.",
    aimant: "Qualité des aimants néodyme. Le nombre indique la force (N52 > N48), les lettres la tenue en température (SH : jusqu'à 150 °C).",
    typeshaft: "Construction de l'axe : plein, creux (plus léger) ou en titane (plus résistant aux chocs).",
    cloche: "La partie tournante qui porte les aimants. Souvent en aluminium 7075 ; « unibell » = cloche d'une seule pièce.",
    vishel: "Mode de fixation de l'hélice : écrou sur axe fileté (M5) ou vis dans la cloche.",
    cable: "Section des fils en AWG : plus le nombre est petit, plus le fil est gros et supporte de courant.",
    helice: "Taille d'hélice conseillée par le fabricant, en pouces.",
    usage: "Pratique pour laquelle le moteur est conçu : racing, freestyle, cinewhoop, longue portée…",
    dims: "Diamètre × hauteur du moteur complet (sans l'axe), en mm : utile pour vérifier la place dans le châssis.",
    vmax: "Vitesse théorique à vide = KV × tension batterie chargée. En vol, avec l'hélice, elle est nettement plus basse.",
    stator: "Diamètre et hauteur du stator, la partie fixe bobinée. Plus il est gros, plus le moteur a de couple.",
  };
  const info = (k) => (GLOSSARY[k] ? `<span class="info" tabindex="0" role="note" aria-label="${esc(GLOSSARY[k])}" data-tip="${esc(GLOSSARY[k])}">i</span>` : "");

  const dSpec = (label, value) => `<div class="d-spec"><span class="tag">${esc(label)}</span><strong class="${value ? "" : "na"}">${value || "—"}</strong></div>`;
  const dSpecR = (label, value) => `<div class="d-spec"><strong class="${value ? "" : "na"}">${value || "—"}</strong><span class="tag">${esc(label)}</span></div>`;
  const e = (v) => (has(v) ? esc(v) : "");
  const famKey = (m) => `${m.MARQUE}|${m.NOM}`;
  function vmax(m) {
    const kv = num(m.KV), c = cells(m);
    return kv && c.length ? Math.round(kv * Math.max(...c) * 4.2) : null;
  }

  // Label + red value capsule(s)
  function pv(label, values, cls = "") {
    const list = (Array.isArray(values) ? values : [values]).filter(has);
    const inner = list.length ? list.map((v) => `<em>${esc(v)}</em>`).join("") : "<em>—</em>";
    return `<span class="pv ${list.length ? "" : "na"} ${cls}"><b>${esc(label)}</b><span>${inner}</span></span>`;
  }

  // Interactive dimension schema: the two plans from the mockup with real
  // dimension lines. Hovering / tapping a dimension or its legend entry
  // highlights it; clicking pins it.
  function dimSchema(m) {
    const mm = (v) => (has(v) ? `${fmt(v)} mm` : "");
    const dims = [
      { k: "dshaft", i: "shaft", label: "Ø shaft", value: [mm(m["D SHAFT"]), /^M\d/i.test(m["VIS HEL"] || "") ? m["VIS HEL"] : ""].filter(Boolean).join(" · ") },
      { k: "lshaft", i: "lshaft", label: "Longueur shaft", value: mm(m["L SHAFT"]) },
      { k: "dmot", i: "dims", label: "Ø moteur", value: mm(m["D MOTEUR"]) },
      { k: "hmot", i: "dims", label: "Hauteur moteur", value: mm(m["H MOTEUR"]) },
      { k: "entraxe", i: "entraxe", label: "Entraxe fixation", value: has(m["ENTRAXE FIX"]) ? `${m["ENTRAXE FIX"]}${/\d$/.test(m["ENTRAXE FIX"]) ? " mm" : ""}` : "" },
      { k: "visfix", i: "visfix", label: "Vis fixation", value: m["VIS FIX"] || "" },
    ];
    const byK = Object.fromEntries(dims.map((d, i) => [d.k, { ...d, n: i + 1 }]));
    const badge = (k, x, y) => `<g class="bd"><circle cx="${x}" cy="${y}" r="11"/><text x="${x}" y="${y + 4}">${byK[k].n}</text></g>`;
    const val = (k, x, y, anchor = "middle") => `<text class="vt" x="${x}" y="${y}" text-anchor="${anchor}">${esc(byK[k].value || "?")}</text>`;
    const g = (k, body) => `<g class="dg ${byK[k].value ? "" : "na"}" data-k="${k}" tabindex="0" role="button" aria-label="${esc(byK[k].label)} ${esc(byK[k].value || "inconnu")}">${body}</g>`;
    const holes = [[86, 147.5], [204, 147.5], [145, 90], [145, 207.5]];
    const svg = `<svg class="schema-svg" viewBox="0 0 800 330" role="img" aria-label="Schéma coté du moteur">
      <defs>
        <marker id="ak" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" fill="#111"/></marker>
        <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L10 5L0 9z" fill="#ff5757"/></marker>
      </defs>
      <text class="vw" x="145" y="318">Vue de dessus</text>
      <text class="vw" x="541" y="330">Vue de profil</text>
      <image href="${asset("plan-dessus.png")}" x="40" y="34" width="210" height="227"/>
      <image href="${asset("plan-profil-debout.png")}" x="400" y="34" width="281.5" height="260.4"/>
      ${g("visfix", `${holes.map(([x, y]) => `<circle class="hl" cx="${x}" cy="${y}" r="14"/>`).join("")}
        <path class="ln" d="M135 80 L70 30 L40 30"/>${badge("visfix", 28, 30)}${val("visfix", 60, 22, "start")}`)}
      ${g("entraxe", `<path class="ext" d="M86 160 V272 M204 160 V272"/><path class="ln dim" d="M86 266 H204"/>
        ${badge("entraxe", 145, 266)}${val("entraxe", 145, 292)}`)}
      ${g("dshaft", `<path class="ext" d="M527 46 V22 M558 46 V22"/><path class="ln dim" d="M527 26 H558"/>
        ${badge("dshaft", 505, 26)}${val("dshaft", 490, 30, "end")}`)}
      ${g("lshaft", `<path class="ext" d="M560 43 H598 M562 93 H598"/><path class="ln dim" d="M592 43 V93"/>
        ${badge("lshaft", 612, 68)}${val("lshaft", 628, 72, "start")}`)}
      ${g("dmot", `<path class="ext" d="M407 210 V306 M676.5 210 V306"/><path class="ln dim" d="M407 300 H676.5"/>
        ${badge("dmot", 541.75, 300)}${val("dmot", 600, 318, "start")}`)}
      ${g("hmot", `<path class="ext" d="M600 93 H726 M650 268 H726"/><path class="ln dim" d="M720 93 V268"/>
        ${badge("hmot", 720, 180)}${val("hmot", 736, 184, "start")}`)}
    </svg>`;
    const legend = dims.map((d, i) => `<li><button type="button" class="lg ${d.value ? "" : "na"}" data-k="${d.k}" aria-pressed="false">
        <span class="lg-n">${i + 1}</span><span class="lg-l">${esc(d.label)}</span><span class="lg-v">${esc(d.value || "—")}</span></button></li>`).join("");
    const stator = has(m["D STATOR"]) ? `<li class="lg-extra"><span class="lg-l">Stator</span><span class="lg-v">${fmt(m["D STATOR"])} × ${fmt(m["H STATOR"])} mm</span></li>` : "";
    return `<div class="schema box" data-schema>
      <div class="schema-draw">${svg}</div>
      <ul class="schema-legend">${legend}${stator}</ul>
      <p class="schema-hint">Survolez ou touchez une cote pour la mettre en évidence · cliquez pour la garder</p>
    </div>`;
  }

  function panelDimension(m) {
    return `<div class="dim">
      <div class="dim-thumb">${photo(m, "hero-moteur.png")}</div>
      <div class="dim-info">
        <div class="head"><p class="cap">Information général</p><h2>${esc(m.NOM)}</h2>${brandMark(m)}</div>
        <div class="box"><div class="pvs">
          ${pv("Classe", m.CLASSE, "", "classe")}${pv("Poids", weight(m), "", "poids")}${pv("Configuration", m.CONFIG, "", "config")}
          ${pv("KV", kvList(m).slice(0, 4), "", "kv")}${pv("Câble", cable(m), "", "cable")}
        </div></div>
      </div>
      <div class="dim-draw">
        <p class="cap">Dimension</p>
        ${dimSchema(m)}
      </div>
      <div class="dim-side">
        <div><p class="cap big">Caractéristiques</p>
          <div class="box pvs col">
            ${pv("Voltage", m.VOLTAGE || m.LIPO, "", "voltage")}${pv("Ampérage", unit(m.AMP, "A"), "", "amp")}${pv("Puissance", unit(m.PUISSANCE, "W"), "", "puissance")}
            ${pv("Résistance", m.RESISTANCE, "", "resistance")}${pv("Aimant", m.AIMANT, "", "aimant")}${pv("Type de shaft", m["TYPE SHAFT"], "", "typeshaft")}
            ${pv("Type de cloche", m.CLOCHE, "", "cloche")}${pv("Vis hélice", m["VIS HEL"], "", "vishel")}
          </div></div>
        <div><p class="cap">Recommandation</p>
          <div class="box pvs col">${pv("Hélice", m.HELICE, "", "helice")}${pv("Utilisation", m.UTILISATION, "", "usage")}</div></div>
      </div>
    </div>`;
  }

  // Where this motor sits among motors of the same stator size
  function benchmark(m) {
    const peers = state.motors.filter((x) => x.CLASSE && x.CLASSE === m.CLASSE);
    const items = [
      { col: "KV", label: "KV", fmtv: (v) => fmt(v), phrase: (p) => `KV plus élevé que ${p} % des ${m.CLASSE}` },
      { col: "POIDS", label: "Poids", fmtv: (v) => `${fmt(v)} g`, phrase: (p) => `plus léger que ${100 - p} % des ${m.CLASSE}`, low: true },
      { col: "PUISSANCE", label: "Puissance", fmtv: (v) => `${fmt(v)} W`, phrase: (p) => `plus puissant que ${p} % des ${m.CLASSE}` },
      { col: "AMP", label: "Ampérage", fmtv: (v) => `${fmt(v)} A`, phrase: (p) => `consomme plus que ${p} % des ${m.CLASSE}` },
    ];
    const bars = items.map((it) => {
      const me = num(m[it.col]);
      const vals = peers.map((x) => num(x[it.col])).filter((v) => v !== null).sort((a, b) => a - b);
      if (me === null || vals.length < 5) return "";
      const lo = vals[0], hi = vals[vals.length - 1];
      const pct = Math.round((vals.filter((v) => v < me).length / vals.length) * 100);
      const pos = hi > lo ? ((me - lo) / (hi - lo)) * 100 : 50;
      return `<div class="bench">
        <div class="bench-top"><b>${it.label}</b><span>${esc(it.fmtv(me))}</span></div>
        <div class="bench-bar" role="img" aria-label="${esc(it.phrase(pct))}"><i style="left:${pos.toFixed(1)}%"></i></div>
        <div class="bench-scale"><span>${esc(it.fmtv(lo))}</span><em>${esc(it.phrase(pct))}</em><span>${esc(it.fmtv(hi))}</span></div>
      </div>`;
    }).filter(Boolean);
    return bars.length ? `<section class="tech-card wide"><h3>Repères <small>parmi ${peers.length} moteurs ${esc(m.CLASSE)} du catalogue</small></h3><div class="bench-grid">${bars.join("")}</div></section>` : "";
  }

  function panelTech(m) {
    const row = (label, v, k) => `<div class="t-row ${has(v) ? "" : "na"}"><dt>${esc(label)}${info(k)}</dt><dd>${esc(has(v) ? v : "Non renseigné")}</dd></div>`;
    const card = (title, icon, rows) => `<section class="tech-card"><h3><span class="t-ico" aria-hidden="true">${icon}</span>${title}</h3><dl>${rows.join("")}</dl></section>`;
    const vm = vmax(m);
    const keyFields = ["POIDS", "D MOTEUR", "H MOTEUR", "D SHAFT", "L SHAFT", "ENTRAXE FIX", "VIS FIX", "LIPO", "CONFIG", "AMP", "PUISSANCE", "TYPE CABLE", "HELICE", "AIMANT", "RESISTANCE", "UTILISATION"];
    const filled = keyFields.filter((k) => has(m[k])).length;
    const pct = Math.round((filled / keyFields.length) * 100);
    const link = safeUrl(m.LIEN);
    const fam = family(m).filter((x) => x !== m).sort((a, b) => num(a.KV) - num(b.KV));
    const I = {
      id: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 10h8M8 14h5"/></svg>',
      mot: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/></svg>',
      axe: '<svg viewBox="0 0 24 24"><path d="M12 3v18M8 7h8M9 17h6"/><circle cx="12" cy="12" r="3"/></svg>',
      elec: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>',
      reco: '<svg viewBox="0 0 24 24"><path d="M12 12l7-7M12 12l-7 7M12 12l7 7M12 12L5 5"/><circle cx="12" cy="12" r="2"/></svg>',
    };
    return `<div class="tech-head">
        <div class="meter" role="img" aria-label="Fiche complétée à ${pct} %"><span style="width:${pct}%"></span></div>
        <p>Fiche complétée à <b>${pct} %</b> · ${filled} caractéristiques sur ${keyFields.length}</p>
        ${link ? `<a class="official" href="${esc(link)}" target="_blank" rel="noopener">Lien officiel</a>` : ""}
      </div>
      <div class="tech-grid">
        ${benchmark(m)}
        ${card("Identité", I.id, [row("Référence", m.REF), row("Marque", m.MARQUE), row("Modèle", m.NOM), row("Version", m.VERSION), row("Classe", m.CLASSE, "classe")])}
        ${card("Moteur & stator", I.mot, [row("KV", fmt(m.KV), "kv"), row("Poids", unit(m.POIDS, " g"), "poids"),
          row("Stator", has(m["D STATOR"]) ? `${fmt(m["D STATOR"])} × ${fmt(m["H STATOR"])} mm` : "", "stator"),
          row("Dimensions (Ø × H)", has(m["D MOTEUR"]) ? `${fmt(m["D MOTEUR"])} × ${fmt(m["H MOTEUR"]) || "?"} mm` : "", "dims"),
          row("Configuration", m.CONFIG, "config"), row("Aimants", m.AIMANT, "aimant"), row("Cloche", m.CLOCHE, "cloche")])}
        ${card("Axe & fixation", I.axe, [row("Ø shaft", unit(m["D SHAFT"], " mm"), "shaft"), row("Longueur shaft", unit(m["L SHAFT"], " mm"), "lshaft"),
          row("Type de shaft", m["TYPE SHAFT"], "typeshaft"), row("Fixation hélice", m["VIS HEL"], "vishel"),
          row("Entraxe fixation", m["ENTRAXE FIX"], "entraxe"), row("Vis de fixation", m["VIS FIX"], "visfix")])}
        ${card("Électrique", I.elec, [row("LiPo", m.LIPO, "voltage"), row("Tension nominale", m.VOLTAGE, "voltage"),
          row("Puissance max", unit(m.PUISSANCE, " W"), "puissance"), row("Courant max", unit(m.AMP, " A"), "amp"),
          row("Résistance", m.RESISTANCE, "resistance"), row("Vitesse max théorique", vm ? `${vm.toLocaleString("fr-FR")} tr/min` : "", "vmax"),
          row("Câble", [m["TYPE CABLE"], m["L CABLE"]].filter(has).join(" · "), "cable")])}
        ${card("Recommandations", I.reco, [row("Hélice", m.HELICE, "helice"), row("Utilisation", m.UTILISATION, "usage")])}
        ${fam.length ? `<section class="tech-card"><h3><span class="t-ico" aria-hidden="true">${I.mot}</span>Autres KV de ce modèle</h3>
          <div class="versions">${fam.map((x) => `<a href="#m/${encodeURIComponent(x.REF)}">${pv("KV", fmt(x.KV))}</a>`).join("")}</div></section>` : ""}
      </div>`;
  }

  // Review videos found by tools/videos.py. On the site a click plays the
  // video in place; the standalone preview opens YouTube instead.
  function panelVideos(m) {
    const list = state.videos[famKey(m)] || [];
    const q = encodeURIComponent(`${m.MARQUE} ${m.NOM} motor review`);
    const more = `<p class="note"><a class="official yt-more" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">Plus de vidéos sur YouTube</a></p>`;
    if (!list.length) return `<p class="note">Aucune vidéo de review trouvée pour ce moteur pour l'instant.</p>${more}`;
    return `<div class="videos">${list.map((v) => `
      <a class="video" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener" data-yt="${esc(v.id)}">
        <span class="video-media">
          <img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" onerror="this.remove()">
          <span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
          ${v.d ? `<span class="dur">${esc(v.d)}</span>` : ""}
        </span>
        <span class="video-t">${esc(v.t)}</span>
        <span class="video-m">${esc(v.c)}${v.v ? ` · ${esc(v.v)}` : ""}</span>
      </a>`).join("")}</div>${more}`;
  }

  // Photo gallery: hosted thumbnail, shop photos (tools/photos.py), original image
  function gallery(m) {
    const urls = [state.thumbs[m.REF], ...(state.photos[famKey(m)] || []), safeUrl(m.IMG)].filter(Boolean);
    return [...new Set(urls)];
  }
  function panelPhotos(m) {
    const list = gallery(m);
    const link = safeUrl(m.LIEN);
    // Only real photos here, never the default drawing
    if (!list.length) return `<p class="note">Pas encore de photo pour ce moteur.</p>${link ? `<p class="note"><a class="official yt-more" href="${esc(link)}" target="_blank" rel="noopener">Lien officiel</a></p>` : ""}`;
    return `<div class="gallery" data-gallery>
        <div class="g-main"><img src="${esc(list[0])}" alt="${esc(`${m.MARQUE} ${m.NOM}`)}" class="is-photo" onerror="this.closest('[data-gallery]').querySelector('.g-th[aria-current=true]')?.remove();this.remove()">
          ${list.length > 1 ? `<button class="g-nav prev" type="button" aria-label="Photo précédente">‹</button><button class="g-nav next" type="button" aria-label="Photo suivante">›</button>` : ""}
          <span class="g-count">1 / ${list.length}</span></div>
        ${list.length > 1 ? `<div class="g-thumbs">${list.map((u, i) => `<button type="button" class="g-th" data-i="${i}" aria-label="Photo ${i + 1}" aria-current="${i === 0}"><img src="${esc(u)}" alt="" loading="lazy" onerror="this.closest('button').remove()"></button>`).join("")}</div>` : ""}
      </div>
      ${link ? `<p class="note"><a class="official yt-more" href="${esc(link)}" target="_blank" rel="noopener">Lien officiel</a></p>` : ""}`;
  }


  const PANELS = { dimension: panelDimension, tech: panelTech, videos: panelVideos, photos: panelPhotos };

  function renderDetail(ref, panel = "dimension") {
    const m = state.motors.find((x) => x.REF === ref);
    if (!m) { $("detail").innerHTML = `<p class="empty">Ce moteur n'est plus dans le catalogue. <a href="#">Retour</a></p>`; return; }
    const kvs = kvList(m).slice(0, 3).map(esc).join("<i></i>");
    document.title = `${m.MARQUE} ${m.NOM} — Multi-Motors`;
    const dims = has(m["D MOTEUR"]) && has(m["H MOTEUR"]) ? `${fmt(m["D MOTEUR"])}X${fmt(m["H MOTEUR"])}` : "";
    $("detail").innerHTML = `
      <div class="d-top">${brandMark(m, true)}<h1>${esc(m.NOM)}</h1></div>
      <div class="d-hero">
        <div class="d-side d-left">
          ${dSpec("Classe", e(m.CLASSE), "classe")}${dSpec("KV", kvs ? `<span class="kvs">${kvs}</span>` : "", "kv")}${dSpec("Shaft", e(shaft(m)), "shaft")}
          ${dSpec("Entraxe fixation", e(m["ENTRAXE FIX"]), "entraxe")}${dSpec("Poids", e(weight(m)), "poids")}${dSpec("Dimension", e(dims), "dims")}
        </div>
        <div class="d-img">${photo(m, "hero-moteur.png")}</div>
        <div class="d-side d-right">
          ${dSpecR("Câble", e(cable(m)), "cable")}${dSpecR("Voltage", e(m.LIPO), "voltage")}${dSpecR("Configuration", e(m.CONFIG), "config")}
          ${dSpecR("Résistance", e(m.RESISTANCE), "resistance")}${dSpecR("Utilisation", e(m.UTILISATION), "usage")}${dSpecR("Hélice recommandé", e(m.HELICE), "helice")}
        </div>
      </div>
      <a class="chevron" href="#m/${encodeURIComponent(m.REF)}" data-scroll="d-tabs" aria-label="Voir le détail"><svg viewBox="0 0 48 48" width="48" height="48"><path d="M10 18l14 12 14-12" fill="none" stroke="currentColor" stroke-width="3"/></svg></a>
      <div class="d-body">
        <div class="d-tabs" id="d-tabs" role="tablist">
          <button class="d-tab" role="tab" data-panel="dimension" aria-selected="${panel === "dimension"}">Dimension</button>
          <button class="d-tab" role="tab" data-panel="tech" aria-selected="${panel === "tech"}">Fiche technique</button>
          <button class="d-tab" role="tab" data-panel="videos" aria-selected="${panel === "videos"}">Vidéos</button>
          <button class="d-tab" role="tab" data-panel="photos" aria-selected="${panel === "photos"}">Photos</button>
        </div>
        <div class="d-panel" id="d-panel">${PANELS[panel](m)}</div>
      </div>`;
    $("detail").dataset.ref = ref;
    $("detail").dataset.panel = panel;
    hooks.onDetail?.(m);
  }

  // --- Routing -------------------------------------------------------------
  function route() {
    const h = location.hash;
    const other = document.querySelectorAll(".view[data-extra]");
    if (hooks.route?.(h)) {
      $("view-home").hidden = true;
      $("view-detail").hidden = true;
      return;
    }
    other.forEach((v) => (v.hidden = true));
    if (h.startsWith("#m/")) {
      $("view-home").hidden = true;
      $("view-detail").hidden = false;
      renderDetail(decodeURIComponent(h.slice(3)));
      window.scrollTo(0, 0);
    } else {
      $("view-detail").hidden = true;
      $("view-home").hidden = false;
      document.title = "Multi-Motors";
    }
  }

  // --- Boot ----------------------------------------------------------------
  async function start() {
    // community.js is loaded after this file: wait until every script has run
    if (document.readyState === "loading") await new Promise((r) => document.addEventListener("DOMContentLoaded", r));
    try {
      [state.motors, state.thumbs, state.videos, state.photos] = await Promise.all([
        loadCSV().then(parseCSV), loadJSON("thumbs", window.MM_THUMBS), loadJSON("videos", window.MM_VIDEOS), loadJSON("photos", window.MM_PHOTOS),
      ]);
    } catch (err) {
      $("empty").textContent = "Le catalogue n'a pas pu être chargé. Réessayez dans quelques minutes.";
      $("empty").hidden = false;
      return;
    }

    [...new Set(state.motors.map((m) => m.MARQUE))].sort((a, b) => a.localeCompare(b))
      .forEach((b) => $("a-marque").insertAdjacentHTML("beforeend", `<option value="${esc(b)}">${esc(b)}</option>`));

    const refresh = () => { readFilters(); state.shown = PAGE; renderList(); };
    ["spec-form", "adv"].forEach((id) => { $(id).addEventListener("input", refresh); $(id).addEventListener("change", refresh); });
    // Results appear below the search screen once the search is validated
    $("spec-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      document.activeElement?.blur?.();
      state.revealed = true;
      $("sep").hidden = false;
      $("liste").hidden = false;
      $("liste").classList.add("reveal");
      refresh();
      $("sep").scrollIntoView({ block: "start" });
    });
    $("q").addEventListener("input", (ev) => { state.q = ev.target.value.trim(); state.shown = PAGE; renderList(); });
    $("sort").addEventListener("change", (ev) => { state.sort = ev.target.value; renderList(); });
    document.querySelector(".tabs").addEventListener("click", (ev) => {
      const t = ev.target.closest(".tab"); if (!t) return;
      state.tab = t.dataset.tab; state.sort = ""; $("sort").value = ""; state.shown = PAGE; renderList();
    });
    $("adv-toggle").addEventListener("click", () => {
      const open = $("adv").hidden;
      $("adv").hidden = !open;
      $("adv-toggle").setAttribute("aria-expanded", String(open));
    });
    $("more").addEventListener("click", () => { state.shown += PAGE; renderList(); });
    // Dimension schema: highlight on hover / focus, pin on click
    const schemaSet = (root, k, pin) => {
      if (!root) return;
      if (pin !== undefined) root.dataset.pin = pin ? k : "";
      const on = k || root.dataset.pin || "";
      root.classList.toggle("has-hl", !!on);
      root.querySelectorAll("[data-k]").forEach((el) => {
        el.classList.toggle("on", el.dataset.k === on);
        if (el.matches("button")) el.setAttribute("aria-pressed", String(el.dataset.k === root.dataset.pin));
      });
    };
    $("detail").addEventListener("mousemove", (ev) => {
      const main = ev.target.closest(".g-main");
      if (!main) return;
      const r = main.getBoundingClientRect();
      main.style.setProperty("--zx", `${((ev.clientX - r.left) / r.width) * 100}%`);
      main.style.setProperty("--zy", `${((ev.clientY - r.top) / r.height) * 100}%`);
    });
    ["mouseover", "focusin"].forEach((t) => $("detail").addEventListener(t, (ev) => {
      const el = ev.target.closest("[data-schema] [data-k]");
      if (el) schemaSet(el.closest("[data-schema]"), el.dataset.k);
    }));
    ["mouseout", "focusout"].forEach((t) => $("detail").addEventListener(t, (ev) => {
      const el = ev.target.closest("[data-schema] [data-k]");
      if (el && !el.contains(ev.relatedTarget)) schemaSet(el.closest("[data-schema]"), "");
    }));
    $("detail").addEventListener("keydown", (ev) => {
      const el = ev.target.closest("[data-schema] g[data-k]");
      if (el && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
    });

    $("detail").addEventListener("click", (ev) => {
      // Videos play in place on the site (the standalone preview cannot embed them)
      const yt = ev.target.closest("[data-yt]");
      if (yt && !window.MM_ASSETS) {
        ev.preventDefault();
        yt.querySelector(".video-media").innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${yt.dataset.yt}?autoplay=1" title="Vidéo" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
        yt.removeAttribute("href");
        return;
      }
      // Photo gallery
      const gal = ev.target.closest("[data-gallery]");
      if (gal) {
        const thumbs = [...gal.querySelectorAll(".g-th")];
        let i = thumbs.findIndex((b) => b.getAttribute("aria-current") === "true");
        const th = ev.target.closest(".g-th");
        if (th) i = thumbs.indexOf(th);
        else if (ev.target.closest(".next")) i = (i + 1) % thumbs.length;
        else if (ev.target.closest(".prev")) i = (i - 1 + thumbs.length) % thumbs.length;
        else return;
        const img = gal.querySelector(".g-main img");
        img.classList.remove("swap"); void img.offsetWidth; img.classList.add("swap");
        img.src = thumbs[i].querySelector("img").src;
        thumbs.forEach((b, j) => b.setAttribute("aria-current", String(j === i)));
        gal.querySelector(".g-count").textContent = `${i + 1} / ${thumbs.length}`;
        return;
      }
      const sk = ev.target.closest("[data-schema] [data-k]");
      if (sk) {
        const root = sk.closest("[data-schema]");
        schemaSet(root, sk.dataset.k, root.dataset.pin !== sk.dataset.k);
        return;
      }
      const t = ev.target.closest(".d-tab");
      if (t) { renderDetail($("detail").dataset.ref, t.dataset.panel); $("d-tabs").scrollIntoView({ block: "start" }); return; }
      const c = ev.target.closest("[data-scroll]");
      if (c) { ev.preventDefault(); $(c.dataset.scroll).scrollIntoView({ block: "start" }); }
    });
    window.addEventListener("hashchange", route);

    await hooks.onBoot?.();

    readFilters();
    renderList();
    route();
  }

  Object.assign(window.MM = window.MM || {}, {
    state, esc, has, fmt, num, safeUrl, photo, brandMark, asset, info, famKey, renderList, route,
    rerender: () => $("detail").dataset.ref && renderDetail($("detail").dataset.ref, $("detail").dataset.panel || "dimension"),
  });

  start();
})();
