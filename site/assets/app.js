/* Multi-Motors — catalogue front-end.
 * Loads catalogue/moteurs.csv (copied to data/moteurs.csv at deploy time)
 * and renders a filterable grid of brushless motors.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = { motors: [], q: "", brand: "", stator: "", lipo: "", sort: "recent" };

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
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (s) => { const n = parseFloat(String(s).replace(",", ".")); return Number.isFinite(n) ? n : null; };
  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "");
  const fmtInt = (n) => n.toLocaleString("fr-FR");
  // "1.5895" -> "1,59", "07" -> "7"; leaves non-numeric values untouched
  const fmtNum = (s) => {
    const n = num(s);
    return n === null || !/^\s*[\d.,]+\s*$/.test(s) ? s : n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  };
  const imgUrl = (m) => safeUrl(m.IMG);

  // "2207" -> { d: 22, h: 7 }, "0802" -> { d: 8, h: 2 }
  function statorDims(m) {
    let d = num(m["D STATOR"]), h = num(m["H STATOR"]);
    const c = (m.CLASSE || "").match(/^(\d{2})(\d{2})$/);
    if (c) { d = d ?? parseInt(c[1], 10); h = h ?? parseInt(c[2], 10); }
    return { d, h };
  }

  // Top view of a stator: ring size follows the diameter, ring thickness the height.
  function statorGlyph(m) {
    const { d, h } = statorDims(m);
    const r = 8 + Math.min(d || 10, 40) / 40 * 17;
    const w = 2 + Math.min(h || 4, 14) / 14 * 7;
    const teeth = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      const x1 = 28 + Math.cos(a) * (r - w / 2), y1 = 28 + Math.sin(a) * (r - w / 2);
      const x2 = 28 + Math.cos(a) * (r - w / 2 - 3), y2 = 28 + Math.sin(a) * (r - w / 2 - 3);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`;
    }).join("");
    return `<svg class="stator-glyph" viewBox="0 0 56 56" aria-hidden="true">
      <circle cx="28" cy="28" r="27" fill="none" stroke="currentColor" stroke-opacity=".18" stroke-dasharray="2 3"/>
      <circle cx="28" cy="28" r="${r.toFixed(1)}" fill="none" stroke="currentColor" stroke-width="${w.toFixed(1)}"/>
      ${teeth}
      <circle cx="28" cy="28" r="2.5" fill="currentColor"/>
    </svg>`;
  }

  function spec(label, value, unit) {
    value = value && fmtNum(value);
    const v = value ? `${esc(value)}${unit ? " " + unit : ""}` : "—";
    return `<div><dt>${label}</dt><dd class="${value ? "" : "na"}">${v}</dd></div>`;
  }

  // --- Rendering -----------------------------------------------------------
  function card(m, i) {
    const cls = m.CLASSE || "—";
    const img = imgUrl(m);
    return `<button class="card" type="button" data-i="${i}">
      ${img ? `<div class="card-img"><img src="${esc(img)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>` : ""}
      <div class="card-head">
        ${statorGlyph(m)}
        <div class="card-class">${esc(cls)}<small>stator</small></div>
      </div>
      <p class="card-title">${esc(m.MARQUE)}<span>${esc(m.NOM || m.REF)}</span></p>
      ${m.LIPO ? `<span class="badge">${esc(m.LIPO)}</span>` : ""}
      <dl class="specs">
        ${spec("KV", m.KV)}
        ${spec("Poids", m.POIDS, "g")}
        ${spec("Axe", m["D SHAFT"], "mm")}
      </dl>
    </button>`;
  }

  function filtered() {
    const q = state.q.toLowerCase();
    let list = state.motors.filter((m) =>
      (!state.brand || m.MARQUE === state.brand) &&
      (!state.stator || m.CLASSE === state.stator) &&
      (!state.lipo || m.LIPO === state.lipo) &&
      (!q || [m.REF, m.MARQUE, m.NOM, m.VERSION, m.CLASSE, m.KV].join(" ").toLowerCase().includes(q))
    );
    const by = {
      "recent": (a, b) => (num(b.ID) ?? 0) - (num(a.ID) ?? 0),
      "kv-asc": (a, b) => (num(a.KV) ?? 1e9) - (num(b.KV) ?? 1e9),
      "kv-desc": (a, b) => (num(b.KV) ?? -1) - (num(a.KV) ?? -1),
      "weight-asc": (a, b) => (num(a.POIDS) ?? 1e9) - (num(b.POIDS) ?? 1e9),
      "stator": (a, b) => (a.CLASSE || "9999").localeCompare(b.CLASSE || "9999") || (num(a.KV) ?? 0) - (num(b.KV) ?? 0),
    }[state.sort];
    return list.slice().sort(by);
  }

  function render() {
    const list = filtered();
    $("grid").innerHTML = list.map((m) => card(m, state.motors.indexOf(m))).join("");
    $("empty").hidden = list.length > 0;
    $("count").textContent = `${fmtInt(list.length)} moteur${list.length > 1 ? "s" : ""} affiché${list.length > 1 ? "s" : ""}`;
    document.querySelectorAll(".size-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === state.stator)));
    $("stator").value = state.stator;
  }

  function fillSelect(id, values) {
    const sel = $(id);
    values.forEach((v) => sel.insertAdjacentHTML("beforeend", `<option value="${esc(v)}">${esc(v)}</option>`));
  }

  function countBy(key) {
    const map = new Map();
    state.motors.forEach((m) => m[key] && map.set(m[key], (map.get(m[key]) || 0) + 1));
    return map;
  }

  function openDetail(m) {
    const row = (label, value, unit) => value ? `<tr><th>${label}</th><td>${esc(fmtNum(value))}${unit ? " " + unit : ""}</td></tr>` : "";
    const group = (title, rows) => rows.trim() ? `<div class="d-group"><h3>${title}</h3><table class="d-table">${rows}</table></div>` : "";
    const img = imgUrl(m), link = safeUrl(m.LIEN);
    $("d-body").innerHTML = `
      <div class="d-head">${statorGlyph(m)}<div>
        <h2 id="d-title">${esc(m.MARQUE)} ${esc(m.NOM)}</h2>
        <p>${esc(m.REF)}</p>
      </div></div>
      ${img ? `<img class="d-img" src="${esc(img)}" alt="${esc(m.MARQUE + " " + m.NOM)}" loading="lazy" onerror="this.remove()">` : ""}
      ${group("Moteur", row("Classe de stator", m.CLASSE) + row("KV", m.KV) + row("Poids", m.POIDS, "g") + row("Version", m.VERSION) + row("Configuration", m.CONFIG) + row("Aimants", m.AIMANT) + row("Cloche", m.CLOCHE))}
      ${group("Dimensions", row("Diamètre stator", m["D STATOR"], "mm") + row("Hauteur stator", m["H STATOR"], "mm") + row("Diamètre moteur", m["D MOTEUR"], "mm") + row("Hauteur moteur", m["H MOTEUR"], "mm"))}
      ${group("Axe et fixation", row("Diamètre d'axe", m["D SHAFT"], "mm") + row("Longueur d'axe", m["L SHAFT"], "mm") + row("Type d'axe", m["TYPE SHAFT"]) + row("Écrou d'hélice", m["VIS HEL"]) + row("Vis de fixation", m["VIS FIX"]) + row("Entraxe", m["ENTRAXE FIX"], "mm"))}
      ${group("Électrique", row("LiPo", m.LIPO) + row("Tension", m.VOLTAGE) + row("Courant max", m.AMP, "A") + row("Puissance", m.PUISSANCE, "W") + row("Câble", [m["TYPE CABLE"], m["L CABLE"]].filter(Boolean).join(" · ")) + row("Hélice conseillée", m.HELICE))}
      ${link ? `<a class="d-link" href="${esc(link)}" target="_blank" rel="noopener">Voir la fiche produit</a>` : ""}`;
    $("detail").showModal();
  }

  // --- Boot ----------------------------------------------------------------
  async function start() {
    try {
      state.motors = parseCSV(await loadCSV());
    } catch (e) {
      $("stats").textContent = "Catalogue indisponible";
      $("empty").textContent = "Le catalogue n'a pas pu être chargé. Réessayez dans quelques minutes.";
      $("empty").hidden = false;
      return;
    }

    const brands = countBy("MARQUE"), sizes = countBy("CLASSE"), lipos = countBy("LIPO");
    fillSelect("brand", [...brands.keys()].sort((a, b) => a.localeCompare(b)));
    fillSelect("stator", [...sizes.keys()].sort());
    fillSelect("lipo", [...lipos.keys()].sort());
    $("sizes").innerHTML = [...sizes.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 14)
      .map(([v, n]) => `<button class="size-btn" type="button" data-v="${esc(v)}" aria-pressed="false">${esc(v)} <small>${n}</small></button>`)
      .join("");
    $("stats").textContent = `${fmtInt(state.motors.length)} moteurs · ${brands.size} marques`;

    const bind = (id, key, ev = "change") => $(id).addEventListener(ev, (e) => { state[key] = e.target.value; render(); });
    bind("q", "q", "input"); bind("brand", "brand"); bind("stator", "stator"); bind("lipo", "lipo"); bind("sort", "sort");
    $("sizes").addEventListener("click", (e) => {
      const b = e.target.closest(".size-btn"); if (!b) return;
      state.stator = state.stator === b.dataset.v ? "" : b.dataset.v; render();
    });
    $("grid").addEventListener("click", (e) => {
      const c = e.target.closest(".card"); if (c) openDetail(state.motors[+c.dataset.i]);
    });
    $("detail").addEventListener("click", (e) => { if (e.target === $("detail")) $("detail").close(); });

    render();
  }

  start();
})();
