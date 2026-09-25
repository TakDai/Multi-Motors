/* Multi-Motors — catalogue front-end, d'après la maquette Figma.
 * Loads catalogue/moteurs.csv (copied to data/moteurs.csv at deploy time).
 * Views: home (#, #liste) and motor sheet (#m/<REF>).
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const PAGE = 20;
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
  const fmtNum = (s) => {
    const n = num(s);
    return n === null || !/^\s*[\d.,]+\s*$/.test(String(s)) ? s : n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  };
  const fmtInt = (n) => Math.round(n).toLocaleString("fr-FR");
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s*×]/g, "x").replace(/[^a-z0-9.x]/g, "");

  function cells(m) {
    const c = (m.LIPO || "").match(/\d+/g);
    return c ? c.map(Number) : [];
  }
  // Theoretical no-load speed on a fully charged pack: KV × cells × 4.2 V
  function vmax(m) {
    const kv = num(m.KV), c = cells(m);
    return kv && c.length ? kv * Math.max(...c) * 4.2 : null;
  }
  const dims = (m) => (m["D MOTEUR"] && m["H MOTEUR"] ? `${fmtNum(m["D MOTEUR"])}x${fmtNum(m["H MOTEUR"])}` : m["D MOTEUR"] ? `Ø${fmtNum(m["D MOTEUR"])}` : "");
  const shaft = (m) => m["VIS HEL"] && /^M\d/.test(m["VIS HEL"]) ? m["VIS HEL"] : m["D SHAFT"] ? `${fmtNum(m["D SHAFT"])} mm` : "";
  const weight = (m) => (m.POIDS ? `${fmtNum(m.POIDS)} g` : "");
  const unit = (v, u) => (v ? `${fmtNum(v)} ${u}` : "");
  const family = (m) => state.motors.filter((x) => x.MARQUE === m.MARQUE && x.NOM === m.NOM);
  function completeness(m) {
    const keys = ["POIDS", "D MOTEUR", "H MOTEUR", "D SHAFT", "ENTRAXE FIX", "LIPO", "CONFIG", "AMP", "PUISSANCE", "TYPE CABLE", "HELICE", "AIMANT"];
    return keys.filter((k) => m[k]).length;
  }

  // --- Illustrations -------------------------------------------------------
  // Generic brushless motor, side view, used when no product photo is available.
  function motorSVG() {
    const spokes = [0, 1, 2, 3, 4].map((i) => {
      const x = 58 + i * 21;
      return `<path d="M${x} 96 L${x + 8} 96 L${x + 11} 116 L${x - 3} 116 Z" fill="#4a4a4a"/>`;
    }).join("");
    const thread = Array.from({ length: 9 }, (_, i) => `<line x1="92" x2="108" y1="${14 + i * 5}" y2="${16 + i * 5}" stroke="#555" stroke-width="1.4"/>`).join("");
    return `<svg viewBox="0 0 200 230" role="img" aria-label="Moteur brushless">
      <rect x="92" y="10" width="16" height="50" rx="3" fill="#8d8d8d"/>${thread}
      <rect x="93" y="58" width="14" height="30" fill="#b9b9b9"/>
      <ellipse cx="100" cy="94" rx="64" ry="14" fill="#1b1b1b"/>
      <rect x="36" y="94" width="128" height="76" fill="#161616"/>
      ${spokes}
      <ellipse cx="100" cy="94" rx="64" ry="14" fill="none" stroke="#2c2c2c" stroke-width="2"/>
      <ellipse cx="100" cy="170" rx="64" ry="14" fill="#0e0e0e"/>
      <rect x="36" y="118" width="128" height="3" fill="#2f2f2f"/>
      <path d="M58 180 h84 l10 18 h-20 l-6 12 h-52 l-6 -12 h-20 z" fill="#222"/>
      <ellipse cx="100" cy="94" rx="11" ry="4" fill="#333"/>
    </svg>`;
  }

  function photo(m, cls) {
    const u = safeUrl(m.IMG);
    const alt = esc(`${m.MARQUE} ${m.NOM}`);
    // The SVG stays hidden behind the photo and shows up if the photo fails to load
    return u
      ? `<img class="${cls || ""}" src="${esc(u)}" alt="${alt}" loading="lazy" onerror="this.outerHTML=window.__mmMotor">`
      : motorSVG();
  }

  // --- Chips ---------------------------------------------------------------
  function chip(label, value, extra = "") {
    return value
      ? `<span class="chip ${extra}"><b>${esc(label)}</b><span>${esc(value)}</span></span>`
      : `<span class="chip na"><b>${esc(label)}</b><span>—</span></span>`;
  }
  function kvChip(m) {
    return `<span class="chip"><b>KV</b><span>${esc(fmtNum(m.KV))}</span></span>`;
  }

  // --- Home ----------------------------------------------------------------
  function row(m) {
    const href = `#m/${encodeURIComponent(m.REF)}`;
    return `<article class="row">
      <div class="row-id">
        <span class="brand-mark">${esc(m.MARQUE)}</span>
        <a class="pill" href="${href}">${esc(m.NOM || m.REF)}</a>
      </div>
      <a class="row-img" href="${href}" tabindex="-1" aria-hidden="true">${photo(m)}</a>
      <div class="row-specs">
        ${chip("Classe", m.CLASSE)}
        ${chip("Poids", weight(m))}
        ${chip("Configuration", m.CONFIG)}
        ${kvChip(m)}
        ${chip("Shaft", shaft(m))}
        ${chip("Entraxe de fixation", m["ENTRAXE FIX"])}
        ${chip("Dimension", dims(m))}
        ${chip("Voltage", m.LIPO)}
        ${chip("Hélice", m.HELICE)}
        ${chip("Ampérage", unit(m.AMP, "A"))}
        ${chip("Puissance", unit(m.PUISSANCE, "W"))}
        ${chip("Câble", m["TYPE CABLE"])}
        <a class="cta" href="${href}">Voir la fiche</a>
      </div>
    </article>`;
  }

  function readFilters() {
    const v = (id) => $(id).value.trim();
    state.f = {
      kv: num(v("f-kv")), poids: num(v("f-poids")), classe: v("f-classe"), voltage: num(v("f-voltage")),
      vmax: num(v("f-vmax")), pmax: num(v("f-pmax")), shaft: num(v("f-shaft")), marque: v("f-marque"),
      dmot: num(v("f-dmot")), hmot: num(v("f-hmot")), config: norm(v("f-config")), entraxe: norm(v("f-entraxe")),
      helice: v("f-helice").replace(/[^\d.]/g, ""),
    };
  }

  function matches(m) {
    const f = state.f, q = state.q.toLowerCase();
    if (q && ![m.REF, m.MARQUE, m.NOM, m.VERSION, m.CLASSE, m.KV].join(" ").toLowerCase().includes(q)) return false;
    if (f.kv !== null && !(num(m.KV) && Math.abs(num(m.KV) - f.kv) <= f.kv * 0.1)) return false;
    if (f.poids !== null && !(num(m.POIDS) !== null && num(m.POIDS) <= f.poids)) return false;
    if (f.classe && !(m.CLASSE || "").startsWith(f.classe)) return false;
    if (f.voltage !== null) {
      const c = cells(m);
      if (!c.length || f.voltage < Math.min(...c) || f.voltage > Math.max(...c)) return false;
    }
    if (f.vmax !== null && !(vmax(m) >= f.vmax)) return false;
    if (f.pmax !== null && !(num(m.PUISSANCE) >= f.pmax)) return false;
    if (f.shaft !== null && num(m["D SHAFT"]) !== f.shaft) return false;
    if (f.marque && m.MARQUE !== f.marque) return false;
    if (f.dmot !== null && !(num(m["D MOTEUR"]) !== null && num(m["D MOTEUR"]) <= f.dmot)) return false;
    if (f.hmot !== null && !(num(m["H MOTEUR"]) !== null && num(m["H MOTEUR"]) <= f.hmot)) return false;
    if (f.config && !norm(m.CONFIG).includes(f.config)) return false;
    if (f.entraxe && !norm(m["ENTRAXE FIX"]).includes(f.entraxe)) return false;
    if (f.helice && !(m.HELICE || "").includes(f.helice)) return false;
    return true;
  }

  function sorted(list) {
    const by = {
      "kv-asc": (a, b) => (num(a.KV) ?? 1e9) - (num(b.KV) ?? 1e9),
      "kv-desc": (a, b) => (num(b.KV) ?? -1) - (num(a.KV) ?? -1),
      "poids-asc": (a, b) => (num(a.POIDS) ?? 1e9) - (num(b.POIDS) ?? 1e9),
      "classe": (a, b) => (a.CLASSE || "9999").localeCompare(b.CLASSE || "9999") || (num(a.KV) ?? 0) - (num(b.KV) ?? 0),
      "marque": (a, b) => a.MARQUE.localeCompare(b.MARQUE) || (a.NOM || "").localeCompare(b.NOM || ""),
      "populaire": (a, b) => completeness(b) - completeness(a) || (num(a.ID) ?? 0) - (num(b.ID) ?? 0),
      "nouveautes": (a, b) => (num(b.ID) ?? 0) - (num(a.ID) ?? 0),
      "tous": (a, b) => a.MARQUE.localeCompare(b.MARQUE) || (a.CLASSE || "").localeCompare(b.CLASSE || "") || (num(a.KV) ?? 0) - (num(b.KV) ?? 0),
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

  // --- Motor sheet ---------------------------------------------------------
  function dSpec(label, value) {
    return `<div class="d-spec"><span class="pill">${esc(label)}</span><strong class="${value ? "" : "na"}">${esc(value || "—")}</strong></div>`;
  }
  function dSpecR(label, value) {
    return `<div class="d-spec"><strong class="${value ? "" : "na"}">${esc(value || "—")}</strong><span class="pill">${esc(label)}</span></div>`;
  }

  // Dimension drawing: top view (left) and side view (right) with value callouts.
  function drawing(m) {
    const txtW = (s) => Math.max(26, String(s).length * 7 + 14);
    const call = (x, y, label, value) => {
      const lw = txtW(label), vw = txtW(value || "—");
      return `<g class="draw-text">
        <rect x="${x}" y="${y - 11}" width="${lw + vw}" height="22" rx="11" fill="#111"/>
        <rect x="${x + lw}" y="${y - 11}" width="${vw}" height="22" rx="11" fill="${value ? "#ef5b55" : "#c9c9c9"}"/>
        <text x="${x + lw / 2}" y="${y + 4}" text-anchor="middle" fill="#fff">${esc(label)}</text>
        <text x="${x + lw + vw / 2}" y="${y + 4}" text-anchor="middle" fill="#fff">${esc(value || "—")}</text>
      </g>`;
    };
    const spokes = Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      return `<line x1="${170 + Math.cos(a) * 22}" y1="${165 + Math.sin(a) * 22}" x2="${170 + Math.cos(a) * 80}" y2="${165 + Math.sin(a) * 80}" stroke="#111" stroke-width="1.5"/>`;
    }).join("");
    const holes = [45, 135, 225, 315].map((d) => {
      const a = (d * Math.PI) / 180;
      return `<circle cx="${170 + Math.cos(a) * 40}" cy="${165 + Math.sin(a) * 40}" r="5" fill="#fff" stroke="#111" stroke-width="1.5"/>`;
    }).join("");
    return `<svg viewBox="0 0 720 320" role="img" aria-label="Plan coté du moteur">
      <circle cx="170" cy="165" r="92" fill="#fff" stroke="#111" stroke-width="1.5"/>
      <circle cx="170" cy="165" r="84" fill="none" stroke="#111" stroke-width="1" stroke-dasharray="3 4"/>
      ${spokes}${holes}
      <circle cx="170" cy="165" r="16" fill="#fff" stroke="#111" stroke-width="1.5"/>
      <circle cx="170" cy="165" r="6" fill="#111"/>
      <polyline points="170,165 200,70 205,52" fill="none" stroke="#111" stroke-width="1.5"/>
      ${call(150, 40, "D shaft", m["D SHAFT"] ? `${fmtNum(m["D SHAFT"])} mm` : "")}
      <polyline points="198,193 250,280" fill="none" stroke="#111" stroke-width="1.5"/>
      ${call(40, 290, "Vis fixation", m["VIS FIX"])}

      <rect x="452" y="58" width="16" height="52" fill="#fff" stroke="#111" stroke-width="1.5"/>
      <rect x="400" y="110" width="120" height="78" rx="4" fill="#fff" stroke="#111" stroke-width="1.5"/>
      <path d="M410 122 h100 M410 176 h100" stroke="#111" stroke-width="1" stroke-dasharray="3 4"/>
      <rect x="418" y="188" width="84" height="26" fill="#fff" stroke="#111" stroke-width="1.5"/>
      <path d="M430 214 v12 M490 214 v12" stroke="#111" stroke-width="1.5"/>

      <path d="M400 96 h120 M400 91 v10 M520 91 v10" stroke="#111" stroke-width="1.2"/>
      <polyline points="505,96 560,40" fill="none" stroke="#111" stroke-width="1.2"/>
      ${call(530, 40, "D moteur", m["D MOTEUR"] ? `${fmtNum(m["D MOTEUR"])} mm` : "")}
      <path d="M476 58 v52" stroke="#111" stroke-width="1.2"/>
      <polyline points="476,70 400,40" fill="none" stroke="#111" stroke-width="1.2"/>
      ${call(318, 40, "L shaft", m["L SHAFT"] ? `${fmtNum(m["L SHAFT"])} mm` : "")}
      <path d="M540 110 v104 M535 110 h10 M535 214 h10" stroke="#111" stroke-width="1.2"/>
      <polyline points="540,160 575,160" fill="none" stroke="#111" stroke-width="1.2"/>
      ${call(575, 160, "H moteur", m["H MOTEUR"] ? `${fmtNum(m["H MOTEUR"])} mm` : "")}
      <path d="M430 240 h60 M430 235 v10 M490 235 v10" stroke="#111" stroke-width="1.2"/>
      <polyline points="460,240 460,290" fill="none" stroke="#111" stroke-width="1.2"/>
      ${call(360, 290, "Entraxe fixation", m["ENTRAXE FIX"])}
    </svg>`;
  }

  function panelDimension(m) {
    const kvs = family(m).map((x) => fmtNum(x.KV)).join(" | ");
    return `<div class="dim-grid">
      <div class="dim-thumb">${photo(m)}<p>Aperçu</p></div>
      <div class="dim-info">
        <p class="box-title">Information générale</p>
        <div class="box">
          <div class="box-head"><h3>${esc(m.NOM)}</h3><span class="brand-mark">${esc(m.MARQUE)}</span></div>
          <div class="chips">
            ${chip("Classe", m.CLASSE, "red")}${chip("Poids", weight(m), "red")}${chip("Configuration", m.CONFIG, "red")}
            ${chip("KV", kvs, "red")}${chip("Câble", [m["TYPE CABLE"], m["L CABLE"]].filter(Boolean).join(" · "), "red")}
          </div>
        </div>
      </div>
      <div class="dim-draw"><p class="box-title">Dimensions</p><div class="box">${drawing(m)}</div></div>
      <div class="dim-side">
      <div class="dim-carac">
        <p class="box-title">Caractéristiques</p>
        <div class="box chips">
          ${chip("Voltage", m.VOLTAGE ? `${m.LIPO} · ${m.VOLTAGE}` : m.LIPO, "red")}
          ${chip("Ampérage", unit(m.AMP, "A"), "red")}
          ${chip("Puissance", unit(m.PUISSANCE, "W"), "red")}
          ${chip("Vitesse max", vmax(m) ? `${fmtInt(vmax(m))} tr/min` : "", "red")}
          ${chip("Aimant", m.AIMANT, "red")}
          ${chip("Type de shaft", m["TYPE SHAFT"], "red")}
          ${chip("Écrou hélice", m["VIS HEL"], "red")}
          ${chip("Cloche", m.CLOCHE, "red")}
        </div>
      </div>
      <div class="dim-usage">
        <p class="box-title">Utilisation</p>
        <div class="box chips">
          ${chip("Hélice", m.HELICE, "red")}
          ${chip("LiPo", m.LIPO, "red")}
        </div>
      </div>
      </div>
    </div>`;
  }

  function panelTech(m) {
    const rows = [
      ["Référence", m.REF], ["Marque", m.MARQUE], ["Modèle", m.NOM], ["Version", m.VERSION],
      ["Classe de stator", m.CLASSE], ["KV", fmtNum(m.KV)], ["Poids", weight(m)],
      ["Diamètre stator", unit(m["D STATOR"], "mm")], ["Hauteur stator", unit(m["H STATOR"], "mm")],
      ["Diamètre moteur", unit(m["D MOTEUR"], "mm")], ["Hauteur moteur", unit(m["H MOTEUR"], "mm")],
      ["Diamètre d'axe", unit(m["D SHAFT"], "mm")], ["Longueur d'axe", unit(m["L SHAFT"], "mm")],
      ["Type d'axe", m["TYPE SHAFT"]], ["Écrou d'hélice", m["VIS HEL"]], ["Vis de fixation", m["VIS FIX"]],
      ["Entraxe de fixation", m["ENTRAXE FIX"]], ["LiPo", m.LIPO], ["Tension nominale", m.VOLTAGE],
      ["Vitesse max (théorique)", vmax(m) ? `${fmtInt(vmax(m))} tr/min` : ""],
      ["Câble", [m["TYPE CABLE"], m["L CABLE"]].filter(Boolean).join(" · ")], ["Hélice conseillée", m.HELICE],
      ["Puissance max", unit(m.PUISSANCE, "W")], ["Courant max", unit(m.AMP, "A")], ["Aimants", m.AIMANT],
      ["Cloche", m.CLOCHE], ["Configuration", m.CONFIG],
    ];
    return `<table class="tech">${rows.map(([k, v]) => `<tr class="${v ? "" : "na"}"><th>${k}</th><td>${esc(v || "—")}</td></tr>`).join("")}</table>`;
  }

  function panelVersions(m) {
    const fam = family(m).sort((a, b) => (num(a.KV) ?? 0) - (num(b.KV) ?? 0));
    return `<div class="versions">${fam.map((x) => `
      <a class="version" href="#m/${encodeURIComponent(x.REF)}" ${x === m ? 'aria-current="page"' : ""}>
        <strong>${esc(fmtNum(x.KV))} KV</strong>
        <div class="chips">${chip("Poids", weight(x))}${chip("Voltage", x.LIPO)}${chip("Puissance", unit(x.PUISSANCE, "W"))}</div>
      </a>`).join("")}</div>`;
  }

  function panelPhotos(m) {
    const link = safeUrl(m.LIEN);
    return `<div class="photos">${photo(m)}</div>
      ${link ? `<p class="src"><a class="cta" href="${esc(link)}" target="_blank" rel="noopener">Voir la fiche produit</a></p>` : ""}`;
  }

  const PANELS = { dimension: panelDimension, tech: panelTech, versions: panelVersions, photos: panelPhotos };

  function renderDetail(ref, panel = "dimension") {
    const m = state.motors.find((x) => x.REF === ref);
    if (!m) { $("detail").innerHTML = `<p class="empty">Ce moteur n'est plus dans le catalogue.</p>`; return; }
    const kvs = family(m).map((x) => fmtNum(x.KV)).join(" | ");
    document.title = `${m.MARQUE} ${m.NOM} — Multi-Motors`;
    $("detail").innerHTML = `
      <div class="d-head"><span class="brand-mark">${esc(m.MARQUE)}</span><h1>${esc(m.NOM)}</h1></div>
      <div class="d-hero">
        <div class="d-side d-left">
          ${dSpec("Classe", m.CLASSE)}${dSpec("KV", kvs)}${dSpec("Shaft", shaft(m))}
          ${dSpec("Entraxe fixation", m["ENTRAXE FIX"])}${dSpec("Poids", weight(m))}${dSpec("Dimension", dims(m))}
        </div>
        <div class="d-motor">${photo(m)}</div>
        <div class="d-side d-right">
          ${dSpecR("Câble", m["TYPE CABLE"])}${dSpecR("Voltage", m.LIPO)}${dSpecR("Configuration", m.CONFIG)}
          ${dSpecR("Ampérage", unit(m.AMP, "A"))}${dSpecR("Puissance", unit(m.PUISSANCE, "W"))}${dSpecR("Hélice recommandée", m.HELICE)}
        </div>
      </div>
      <a class="chevron" href="#m/${encodeURIComponent(m.REF)}" data-scroll="d-tabs" aria-label="Voir le détail"><svg viewBox="0 0 40 20"><path d="M4 4l16 12L36 4" fill="none" stroke="currentColor" stroke-width="3"/></svg></a>
      <div class="d-tabs" id="d-tabs" role="tablist">
        <button class="d-tab" role="tab" data-panel="dimension" aria-selected="${panel === "dimension"}">Dimension</button>
        <button class="d-tab" role="tab" data-panel="tech" aria-selected="${panel === "tech"}">Fiche technique</button>
        <button class="d-tab" role="tab" data-panel="versions" aria-selected="${panel === "versions"}">Versions</button>
        <button class="d-tab" role="tab" data-panel="photos" aria-selected="${panel === "photos"}">Photos</button>
      </div>
      <div class="d-panel" id="d-panel">${PANELS[panel](m)}</div>`;
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
    window.__mmMotor = motorSVG();
    document.querySelector(".hero-motor").innerHTML = motorSVG();
    try {
      state.motors = parseCSV(await loadCSV());
    } catch (e) {
      $("count").textContent = "";
      $("empty").textContent = "Le catalogue n'a pas pu être chargé. Réessayez dans quelques minutes.";
      $("empty").hidden = false;
      return;
    }

    const brands = [...new Set(state.motors.map((m) => m.MARQUE))].sort((a, b) => a.localeCompare(b));
    brands.forEach((b) => $("f-marque").insertAdjacentHTML("beforeend", `<option value="${esc(b)}">${esc(b)}</option>`));

    const refresh = () => { readFilters(); state.shown = PAGE; renderList(); };
    $("spec-form").addEventListener("input", refresh);
    $("spec-form").addEventListener("change", refresh);
    $("spec-form").addEventListener("submit", (e) => { e.preventDefault(); $("liste").scrollIntoView(); });
    $("spec-form").addEventListener("reset", () => setTimeout(refresh));
    $("q").addEventListener("input", (e) => { state.q = e.target.value.trim(); state.shown = PAGE; renderList(); });
    $("sort").addEventListener("change", (e) => { state.sort = e.target.value; renderList(); });
    document.querySelector(".tabs").addEventListener("click", (e) => {
      const t = e.target.closest(".tab"); if (!t) return;
      state.tab = t.dataset.tab; state.sort = ""; $("sort").value = ""; state.shown = PAGE; renderList();
    });
    $("more").addEventListener("click", () => { state.shown += PAGE; renderList(); });
    $("detail").addEventListener("click", (e) => {
      const t = e.target.closest(".d-tab");
      if (t) { renderDetail($("detail").dataset.ref, t.dataset.panel); $("d-tabs").scrollIntoView({ block: "start" }); return; }
      const c = e.target.closest("[data-scroll]");
      if (c) { e.preventDefault(); $(c.dataset.scroll).scrollIntoView({ block: "start" }); }
    });
    window.addEventListener("hashchange", route);

    readFilters();
    renderList();
    route();
  }

  start();
})();
