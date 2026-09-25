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
  const state = { motors: [], tab: "populaire", sort: "", q: "", shown: PAGE, f: {} };

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

  // Product photo, or the line drawing from the mockup when there is none / it fails to load
  function photo(m, fallback = "moteur-trait.png") {
    const u = safeUrl(m.IMG), alt = esc(`${m.MARQUE} ${m.NOM}`);
    return u
      ? `<img src="${esc(u)}" alt="${alt}" loading="lazy" onerror="this.onerror=null;this.src='${asset(fallback)}'">`
      : `<img src="${asset(fallback)}" alt="${alt}" loading="lazy">`;
  }

  // --- Home: motor cards ---------------------------------------------------
  const lbl = (t) => `<span class="lbl">${esc(t)}</span>`;
  const val = (v) => (has(v) ? `<span class="val">${esc(v)}</span>` : `<span class="val na">—</span>`);
  const pair = (a, b) => (has(a) || has(b) ? `${val(a)}<span class="x">X</span>${val(b)}` : val(""));
  const kvVals = (m) => kvList(m).slice(0, 3).map((k) => val(k)).join(`<span class="x">X</span>`) || val("");

  function row(m) {
    const href = `#m/${encodeURIComponent(m.REF)}`;
    const link = safeUrl(m.LIEN);
    return `<article class="row">
      <div class="row-id">${brandMark(m)}<a class="name" href="${href}">${esc(m.NOM || m.REF)}</a></div>
      <a class="row-img" href="${href}" tabindex="-1" aria-hidden="true">${photo(m)}</a>
      <div class="specs">
        <div class="spec-line">${lbl("Classe")}${val(m.CLASSE)}${lbl("Poids")}${val(weight(m))}${lbl("Configuration")}${val(m.CONFIG)}${lbl("KV")}${kvVals(m)}</div>
        <div class="spec-line">${lbl("Shaft")}${val(shaft(m))}${lbl("Entraxe de fixation")}${val(m["ENTRAXE FIX"])}${lbl("Dimension")}${pair(fmt(m["D MOTEUR"]), fmt(m["H MOTEUR"]))}${lbl("L shaft")}${val(fmt(m["L SHAFT"]))}</div>
        <div class="spec-line">${lbl("Résistance")}${val(m.RESISTANCE)}${lbl("Utilisation")}${val(m.UTILISATION)}${lbl("Hélice")}${val(m.HELICE)}${lbl("Câble")}${val(cable(m))}</div>
        <div class="spec-line">${lbl("Amp max")}${val(fmt(m.AMP))}${lbl("Voltage")}${val(m.LIPO)}${lbl("Vis hélice")}${val(m["VIS HEL"])}
          ${link ? `<a class="official" href="${esc(link)}" target="_blank" rel="noopener">Lien officiel</a>` : `<span class="official off">Lien officiel</span>`}</div>
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
      "bestseller": (a, b) => completeness(b) - completeness(a) || a.MARQUE.localeCompare(b.MARQUE),
      "nouveautes": (a, b) => (num(b.ID) ?? 0) - (num(a.ID) ?? 0),
    }[state.sort || state.tab];
    return list.slice().sort(by);
  }

  function renderList() {
    const list = sorted(state.motors.filter(matches));
    $("rows").innerHTML = list.slice(0, state.shown).map(row).join("");
    $("more").hidden = list.length <= state.shown;
    $("empty").hidden = list.length > 0;
    $("count").textContent = `${list.length} moteur${list.length > 1 ? "s" : ""} sur ${state.motors.length}`;
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === state.tab)));
  }

  // --- Motor page ----------------------------------------------------------
  const dSpec = (label, value) => `<div class="d-spec"><span class="tag">${esc(label)}</span><strong class="${value ? "" : "na"}">${value || "—"}</strong></div>`;
  const dSpecR = (label, value) => `<div class="d-spec"><strong class="${value ? "" : "na"}">${value || "—"}</strong><span class="tag">${esc(label)}</span></div>`;
  const e = (v) => (has(v) ? esc(v) : "");

  // Label + red value capsule(s)
  function pv(label, values, cls = "") {
    const list = (Array.isArray(values) ? values : [values]).filter(has);
    const inner = list.length ? list.map((v) => `<em>${esc(v)}</em>`).join("") : "<em>—</em>";
    return `<span class="pv ${list.length ? "" : "na"} ${cls}"><b>${esc(label)}</b><span>${inner}</span></span>`;
  }

  function panelDimension(m) {
    return `<div class="dim">
      <div class="dim-thumb">${photo(m, "hero-moteur.png")}</div>
      <div class="dim-info">
        <div class="head"><p class="cap">Information général</p><h2>${esc(m.NOM)}</h2>${brandMark(m)}</div>
        <div class="box"><div class="pvs">
          ${pv("Classe", m.CLASSE)}${pv("Poids", weight(m))}${pv("Configuration", m.CONFIG)}
          ${pv("KV", kvList(m).slice(0, 4))}${pv("Câble", cable(m))}
        </div></div>
      </div>
      <div class="dim-draw">
        <p class="cap">Dimension</p>
        <div class="draw-scroll"><div class="drawing">
          <div class="pl-dessus"><img src="${asset("plan-dessus.png")}" alt=""></div>
          <div class="pl-profil"><div><img src="${asset("plan-profil.png")}" alt=""></div></div>
          <img class="cote-2" src="${asset("cote-2.svg")}" alt="">
          <img class="cote-3" src="${asset("cote-3.svg")}" alt="">
          <img class="cote-4" src="${asset("cote-4.svg")}" alt="">
          <img class="cote-5" src="${asset("cote-5.svg")}" alt="">
          <img class="cote-6" src="${asset("cote-6.svg")}" alt="">
          ${pv("Ø shaft", shaft(m), "c-shaft")}
          ${pv("L shaft", unit(m["L SHAFT"], "mm"), "c-lshaft")}
          ${pv("Ø moteur", unit(m["D MOTEUR"], "mm"), "c-dmot")}
          ${pv("H moteur", unit(m["H MOTEUR"], "mm"), "c-hmot")}
          ${pv("Vis fixation", m["VIS FIX"], "c-visfix")}
          ${pv("Entraxe fixation", m["ENTRAXE FIX"], "c-entraxe")}
        </div></div>
      </div>
      <div class="dim-side">
        <div><p class="cap big">Caractéristiques</p>
          <div class="box pvs col">
            ${pv("Voltage", m.VOLTAGE ? `${fmt(m.VOLTAGE)}V` : m.LIPO)}${pv("Ampérage", unit(m.AMP, "A"))}${pv("Puissance", unit(m.PUISSANCE, "W"))}
            ${pv("Résistance", m.RESISTANCE)}${pv("Aimant", m.AIMANT)}${pv("Type de shaft", m["TYPE SHAFT"])}
            ${pv("Type de cloche", m.CLOCHE)}${pv("Vis hélice", m["VIS HEL"])}
          </div></div>
        <div><p class="cap">Recommandation</p>
          <div class="box pvs col">${pv("Hélice", m.HELICE)}${pv("Utilisation", m.UTILISATION)}</div></div>
      </div>
    </div>`;
  }

  function panelTech(m) {
    const rows = [
      ["Référence", m.REF], ["Marque", m.MARQUE], ["Modèle", m.NOM], ["Version", m.VERSION], ["Classe", m.CLASSE],
      ["KV", fmt(m.KV)], ["Poids", unit(m.POIDS, " g")], ["Diamètre stator", unit(m["D STATOR"], " mm")], ["Hauteur stator", unit(m["H STATOR"], " mm")],
      ["Diamètre moteur", unit(m["D MOTEUR"], " mm")], ["Hauteur moteur", unit(m["H MOTEUR"], " mm")], ["Diamètre shaft", unit(m["D SHAFT"], " mm")],
      ["Longueur shaft", unit(m["L SHAFT"], " mm")], ["Type de shaft", m["TYPE SHAFT"]], ["Vis hélice", m["VIS HEL"]], ["Vis fixation", m["VIS FIX"]],
      ["Entraxe fixation", m["ENTRAXE FIX"]], ["LiPo", m.LIPO], ["Voltage", unit(m.VOLTAGE, " V")], ["Câble", [m["TYPE CABLE"], m["L CABLE"]].filter(has).join(" · ")],
      ["Hélice recommandée", m.HELICE], ["Puissance", unit(m.PUISSANCE, " W")], ["Ampérage max", unit(m.AMP, " A")], ["Résistance", m.RESISTANCE],
      ["Utilisation", m.UTILISATION], ["Aimant", m.AIMANT], ["Cloche", m.CLOCHE], ["Configuration", m.CONFIG],
    ];
    const fam = family(m).filter((x) => x !== m);
    return `<table class="tech">${rows.map(([k, v]) => `<tr class="${has(v) ? "" : "na"}"><th>${k}</th><td>${esc(has(v) ? v : "—")}</td></tr>`).join("")}</table>
      ${fam.length ? `<p class="cap" style="margin-top:22px">Autres KV</p><div class="versions">${fam.map((x) => `<a href="#m/${encodeURIComponent(x.REF)}">${pv("KV", fmt(x.KV))}</a>`).join("")}</div>` : ""}`;
  }

  function panelVideos(m) {
    const q = encodeURIComponent(`${m.MARQUE} ${m.NOM} ${m.CLASSE || ""} moteur`);
    return `<p class="note">Aucune vidéo n'est encore associée à ce moteur.</p>
      <p class="note"><a class="official" style="margin:0 auto;display:inline-flex" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">Chercher sur YouTube</a></p>`;
  }

  function panelPhotos(m) {
    const link = safeUrl(m.LIEN);
    return `<div class="photos">${photo(m, "hero-moteur.png")}
      ${link ? `<a class="official" style="margin:0" href="${esc(link)}" target="_blank" rel="noopener">Lien officiel</a>` : ""}</div>`;
  }

  const PANELS = { dimension: panelDimension, tech: panelTech, videos: panelVideos, photos: panelPhotos };

  function renderDetail(ref, panel = "dimension") {
    const m = state.motors.find((x) => x.REF === ref);
    if (!m) { $("detail").innerHTML = `<p class="empty">Ce moteur n'est plus dans le catalogue. <a href="#">Retour</a></p>`; return; }
    const kvs = kvList(m).slice(0, 3).map(esc).join("<i></i>");
    document.title = `${m.MARQUE} ${m.NOM} — Multi-Motors`;
    const dims = has(m["D MOTEUR"]) && has(m["H MOTEUR"]) ? `${fmt(m["D MOTEUR"])}X${fmt(m["H MOTEUR"])}` : "";
    $("detail").innerHTML = `
      <div class="d-top">${brandMark(m, true)}<h1>${esc(m.NOM)}</h1><a class="back" href="#">← Tous les moteurs</a></div>
      <div class="d-hero">
        <div class="d-side d-left">
          ${dSpec("Classe", e(m.CLASSE))}${dSpec("KV", kvs ? `<span class="kvs">${kvs}</span>` : "")}${dSpec("Shaft", e(shaft(m)))}
          ${dSpec("Entraxe fixation", e(m["ENTRAXE FIX"]))}${dSpec("Poids", e(weight(m)))}${dSpec("Dimension", e(dims))}
        </div>
        <div class="d-img">${photo(m, "hero-moteur.png")}</div>
        <div class="d-side d-right">
          ${dSpecR("Câble", e(cable(m)))}${dSpecR("Voltage", e(m.LIPO))}${dSpecR("Configuration", e(m.CONFIG))}
          ${dSpecR("Résistance", e(m.RESISTANCE))}${dSpecR("Utilisation", e(m.UTILISATION))}${dSpecR("Hélice recommandé", e(m.HELICE))}
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
  }

  // --- Routing -------------------------------------------------------------
  function route() {
    const h = location.hash;
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
    try {
      state.motors = parseCSV(await loadCSV());
    } catch (err) {
      $("empty").textContent = "Le catalogue n'a pas pu être chargé. Réessayez dans quelques minutes.";
      $("empty").hidden = false;
      return;
    }

    [...new Set(state.motors.map((m) => m.MARQUE))].sort((a, b) => a.localeCompare(b))
      .forEach((b) => $("a-marque").insertAdjacentHTML("beforeend", `<option value="${esc(b)}">${esc(b)}</option>`));

    const refresh = () => { readFilters(); state.shown = PAGE; renderList(); };
    ["spec-form", "adv"].forEach((id) => { $(id).addEventListener("input", refresh); $(id).addEventListener("change", refresh); });
    $("spec-form").addEventListener("submit", (ev) => { ev.preventDefault(); $("liste").scrollIntoView(); });
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
    $("detail").addEventListener("click", (ev) => {
      const t = ev.target.closest(".d-tab");
      if (t) { renderDetail($("detail").dataset.ref, t.dataset.panel); $("d-tabs").scrollIntoView({ block: "start" }); return; }
      const c = ev.target.closest("[data-scroll]");
      if (c) { ev.preventDefault(); $(c.dataset.scroll).scrollIntoView({ block: "start" }); }
    });
    window.addEventListener("hashchange", route);

    readFilters();
    renderList();
    route();
  }

  start();
})();
