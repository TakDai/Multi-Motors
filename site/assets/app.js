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
  // The standalone preview cannot load outside images: it ships copies of them in window.MM_MEDIA
  const media = (url) => {
    const M = window.MM_MEDIA, yt = /i\.ytimg\.com\/vi\/([\w-]+)\//.exec(url);
    return (M && M[yt ? `yt:${yt[1]}` : url]) || url;
  };
  // Brand logos available in the Figma file; other brands use a text mark
  const LOGOS = { "T-MOTOR": "logo-t-motor.png" };
  // Logos fetched from the brands' sites and redrawn in black (tools/logos.py)
  const logoSrc = (m) => {
    const p = state.logos[String(m.MARQUE || "").trim().toUpperCase()];
    return p ? (/^data:/.test(p) ? p : `assets/${p}`) : "";
  };
  // Extension points used by community.js (accounts, likes, prices, news…)
  const hooks = (window.MM_HOOKS = window.MM_HOOKS || {});
  const state = { motors: [], thumbs: {}, videos: {}, photos: {}, tab: "populaire", sort: "", q: "", shown: PAGE, f: {}, adv: {}, logos: {}, revealed: false };

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
    const logo = LOGOS[String(m.MARQUE).toUpperCase()], src = logoSrc(m);
    if (!logo && src) return `<span class="logo"><img class="brand-logo" src="${esc(src)}" alt="${esc(m.MARQUE)}" title="${esc(m.MARQUE)}"></span>`;
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
  const pr = (label, valuesHtml) => (valuesHtml.includes('class="val na"') ? "" : `<span class="pair">${lbl(label)}${valuesHtml}</span>`);
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
        ${pr("Amp max", val(fmt(m.AMP)))}${pr("Puissance max", val(unit(m.PUISSANCE, "W")))}${pr("Voltage", val(m.LIPO))}${pr("Vis hélice", val(m["VIS HEL"]))}
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
      modele: v("a-modele").toLowerCase(),
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
    if (f.modele && !inc(m.NOM, f.modele)) return false;
    if (!advMatch(m)) return false;
    return true;
  }

  // --- Advanced filters: one control type per kind of data -----------------
  // chips = multiple choice among the values found in the catalogue, rng = min/max slider,
  // seg = yes/no/all, combo = searchable multi-select (brands)
  const clean = (v) => String(v ?? "").trim();
  const firstNum = (s) => num(String(s || "").replace(/^[^\d]+/, ""));
  const awg = (s) => num(String(s).replace(/\D+/g, "")) ?? 99;
  const ADV = {
    marque: { type: "combo", get: (m) => clean(m.MARQUE).toUpperCase() },
    cable: { type: "chips", get: (m) => m["TYPE CABLE"], order: (a, b) => awg(a) - awg(b), label: (v) => v.replace(/awg/i, " AWG") },
    aimant: { type: "chips", get: (m) => m.AIMANT, max: 6 },
    cloche: { type: "chips", get: (m) => m.CLOCHE, max: 6 },
    tshaft: { type: "chips", get: (m) => m["TYPE SHAFT"], max: 6 },
    visfix: { type: "chips", get: (m) => m["VIS FIX"], max: 7 },
    avec: { type: "chips", flags: {
      "Photo": (m) => !!(state.thumbs[m.REF] || safeUrl(m.IMG)),
      "Vidéos": (m) => (state.videos[famKey(m)] || []).length > 0,
      "Lien officiel": (m) => !!safeUrl(m.LIEN),
    } },
    res: { type: "rng", get: (m) => firstNum(m.RESISTANCE), unit: "mΩ", step: 1 },
    lcable: { type: "rng", get: (m) => num(m["L CABLE"]), unit: "mm", step: 5 },
    lshaft: { type: "rng", get: (m) => num(m["L SHAFT"]), unit: "mm", step: 0.5 },
    dstat: { type: "rng", get: (m) => num(m["D STATOR"]), unit: "mm", step: 0.5 },
    hstat: { type: "rng", get: (m) => num(m["H STATOR"]), unit: "mm", step: 0.5 },
    vish: { type: "seg", opts: [["", "Tous"], ["oui", "Oui"], ["non", "Non"]],
      get: (m) => (/^non$/i.test(m["VIS HEL"] || "") ? "non" : has(m["VIS HEL"]) ? "oui" : "") },
  };
  const isOn = (k) => {
    const d = ADV[k], v = state.adv[k];
    if (d.type === "rng") return v[0] > d.min || v[1] < d.max;
    return d.type === "seg" ? !!v : v.size > 0;
  };
  function advMatch(m) {
    for (const k in ADV) {
      if (!state.adv[k] || !isOn(k)) continue;
      const d = ADV[k], v = state.adv[k];
      if (d.flags) { for (const f of v) if (!d.flags[f](m)) return false; continue; }
      const x = d.get(m);
      if (d.type === "rng") { if (x === null || (v[0] > d.min && x < v[0]) || (v[1] < d.max && x > v[1])) return false; }
      else if (d.type === "seg") { if (x !== v) return false; }
      else if (!v.has(clean(x))) return false;
    }
    return true;
  }
  const chipBtn = (v, n, label = v) =>
    `<button type="button" class="chip" aria-pressed="false" data-v="${esc(v)}">${esc(label)}${n ? `<i>${n}</i>` : ""}</button>`;
  const quantile = (xs, q) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(q * (xs.length - 1))))];
  const rngText = (d, [a, b]) => (a <= d.min && b >= d.max ? "Tous"
    : a <= d.min ? `≤ ${fmt(b)} ${d.unit}` : b >= d.max ? `≥ ${fmt(a)} ${d.unit}` : `${fmt(a)} – ${fmt(b)} ${d.unit}`);

  function buildAdv(refresh) {
    const counts = (get) => {
      const c = new Map();
      state.motors.forEach((m) => { const v = clean(get(m)); if (v) c.set(v, (c.get(v) || 0) + 1); });
      return c;
    };
    document.querySelectorAll("#adv [data-f]").forEach((el) => {
      const k = el.dataset.f, d = ADV[k], name = $(el.getAttribute("aria-labelledby"))?.textContent || k;
      if (d.type === "chips") {
        state.adv[k] = new Set();
        if (d.flags) el.innerHTML = Object.keys(d.flags).map((f) => chipBtn(f, state.motors.filter(d.flags[f]).length)).join("");
        else {
          let vals = [...counts(d.get)].sort((a, b) => b[1] - a[1]).slice(0, d.max || 12);
          if (d.order) vals.sort((a, b) => d.order(a[0], b[0]));
          el.innerHTML = vals.map(([v, n]) => chipBtn(v, n, d.label ? d.label(v) : v)).join("");
        }
        el.addEventListener("click", (ev) => {
          const b = ev.target.closest(".chip"); if (!b) return;
          const on = b.getAttribute("aria-pressed") !== "true";
          b.setAttribute("aria-pressed", String(on));
          state.adv[k][on ? "add" : "delete"](b.dataset.v);
          refresh();
        });
      } else if (d.type === "rng") {
        const xs = state.motors.map(d.get).filter((x) => x !== null && x > 0).sort((a, b) => a - b);
        d.min = Math.floor(quantile(xs, 0.02) / d.step) * d.step;
        d.max = Math.ceil(quantile(xs, 0.98) / d.step) * d.step;
        state.adv[k] = [d.min, d.max];
        const attrs = `min="${d.min}" max="${d.max}" step="${d.step}"`;
        el.innerHTML = `<div class="rng-track"><i class="rng-fill"></i>
          <input type="range" class="lo" ${attrs} value="${d.min}" aria-label="${esc(name)} minimum">
          <input type="range" class="hi" ${attrs} value="${d.max}" aria-label="${esc(name)} maximum"></div>
          <output class="rng-out">Tous</output>`;
        const [lo, hi] = el.querySelectorAll("input");
        d.paint = () => {
          const [a, b] = state.adv[k], pc = (x) => ((x - d.min) / (d.max - d.min || 1)) * 100;
          lo.value = a; hi.value = b;
          el.style.setProperty("--a", `${pc(a)}%`); el.style.setProperty("--b", `${pc(b)}%`);
          el.querySelector("output").textContent = rngText(d, state.adv[k]);
          el.classList.toggle("on", isOn(k));
        };
        el.addEventListener("input", (ev) => {
          let a = +lo.value, b = +hi.value;
          if (a > b) { if (ev.target === lo) a = b; else b = a; }
          state.adv[k] = [a, b];
          d.paint();
        });
        d.paint();
      } else if (d.type === "seg") {
        state.adv[k] = "";
        el.innerHTML = d.opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${!v}" data-v="${v}">${l}</button>`).join("");
        el.addEventListener("click", (ev) => {
          const b = ev.target.closest("button"); if (!b) return;
          state.adv[k] = b.dataset.v;
          el.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
          refresh();
        });
      } else if (d.type === "combo") {
        // Same brand written differently in the sheet (Emax / EMAX): one entry, shown with its most common spelling
        const spell = new Map();
        state.motors.forEach((m) => { const u = d.get(m), c = spell.get(u) || new Map(); c.set(m.MARQUE, (c.get(m.MARQUE) || 0) + 1); spell.set(u, c); });
        d.label = (u) => [...(spell.get(u) || [[u]])].sort((a, b) => b[1] - a[1])[0][0];
        buildCombo(el, k, counts(d.get), refresh);
      }
    });
    $("adv-reset").addEventListener("click", () => {
      for (const k in ADV) {
        const d = ADV[k];
        state.adv[k] = d.type === "rng" ? [d.min, d.max] : d.type === "seg" ? "" : new Set();
        d.paint?.();
      }
      document.querySelectorAll("#adv .chip, #adv .combo-list [role=option]").forEach((b) => b.setAttribute(b.matches(".chip") ? "aria-pressed" : "aria-selected", "false"));
      document.querySelectorAll("#adv .seg button").forEach((b) => b.setAttribute("aria-checked", String(!b.dataset.v)));
      ADV.marque.paint?.();
      $("a-modele").value = "";
      refresh();
    });
  }

  // Brands: type to narrow the list, pick several, remove with the ✕ of each tag
  function buildCombo(el, k, counts, refresh) {
    state.adv[k] = new Set();
    const label = ADV[k].label;
    const brands = [...counts].map(([v, n]) => [v, n, label(v)]).sort((a, b) => a[2].localeCompare(b[2]));
    el.innerHTML = `<div class="combo-box"><span class="combo-sel"></span>
      <input type="search" placeholder="Toutes les marques" role="combobox" aria-expanded="false" aria-controls="combo-list-${k}" aria-autocomplete="list" aria-label="Chercher une marque"></div>
      <div class="combo-list" id="combo-list-${k}" role="listbox" aria-multiselectable="true" hidden>
        ${brands.map(([v, n, l]) => `<button type="button" role="option" aria-selected="false" data-v="${esc(v)}">${esc(l)}<i>${n}</i></button>`).join("")}
        <p class="combo-none" hidden>Aucune marque</p></div>`;
    const input = el.querySelector("input"), list = el.querySelector(".combo-list"), sel = el.querySelector(".combo-sel");
    const opts = [...list.querySelectorAll("[role=option]")];
    const show = (open) => { list.hidden = !open; input.setAttribute("aria-expanded", String(open)); el.classList.toggle("open", open); };
    const narrow = () => {
      const q = input.value.trim().toLowerCase();
      let n = 0;
      opts.forEach((o) => { const ok = !q || o.textContent.toLowerCase().includes(q); o.hidden = !ok; n += ok; });
      list.querySelector(".combo-none").hidden = n > 0;
    };
    ADV[k].paint = () => {
      const s = state.adv[k];
      opts.forEach((o) => o.setAttribute("aria-selected", String(s.has(o.dataset.v))));
      sel.innerHTML = [...s].map((v) => `<button type="button" class="combo-tag" data-v="${esc(v)}" aria-label="Retirer ${esc(label(v))}">${esc(label(v))}<b aria-hidden="true">✕</b></button>`).join("");
      input.placeholder = s.size ? "Ajouter…" : "Toutes les marques";
    };
    const toggle = (v) => { const s = state.adv[k]; s.has(v) ? s.delete(v) : s.add(v); ADV[k].paint(); refresh(); };
    input.addEventListener("focus", () => { narrow(); show(true); });
    input.addEventListener("input", (ev) => { ev.stopPropagation(); narrow(); show(true); });
    input.addEventListener("keydown", (ev) => {
      const vis = opts.filter((o) => !o.hidden);
      if (ev.key === "ArrowDown" && vis[0]) { ev.preventDefault(); show(true); vis[0].focus(); }
      else if (ev.key === "Enter") { ev.preventDefault(); if (vis[0] && input.value.trim()) { toggle(vis[0].dataset.v); input.value = ""; narrow(); show(false); } }
      else if (ev.key === "Escape") { show(false); }
      else if (ev.key === "Backspace" && !input.value && state.adv[k].size) toggle([...state.adv[k]].pop());
    });
    list.addEventListener("keydown", (ev) => {
      const vis = opts.filter((o) => !o.hidden), i = vis.indexOf(document.activeElement);
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); const j = i + (ev.key === "ArrowDown" ? 1 : -1); (j < 0 ? input : vis[Math.min(j, vis.length - 1)]).focus(); }
      else if (ev.key === "Escape") { show(false); input.focus(); }
    });
    list.addEventListener("click", (ev) => { const o = ev.target.closest("[role=option]"); if (o) toggle(o.dataset.v); });
    sel.addEventListener("click", (ev) => { const t = ev.target.closest(".combo-tag"); if (t) { toggle(t.dataset.v); input.focus(); } });
    document.addEventListener("pointerdown", (ev) => { if (!el.contains(ev.target)) show(false); });
    el.addEventListener("focusout", (ev) => { if (ev.relatedTarget && !el.contains(ev.relatedTarget)) show(false); });
  }

  // Badge on the toggle + summary line under the panel
  function advSummary() {
    const n = Object.keys(ADV).filter((k) => state.adv[k] && isOn(k)).length + (state.f.modele ? 1 : 0);
    $("adv-badge").hidden = !n;
    $("adv-badge").textContent = n;
    $("adv-sum").textContent = n ? `${n} filtre${n > 1 ? "s" : ""} avancé${n > 1 ? "s" : ""} actif${n > 1 ? "s" : ""}` : "Aucun filtre avancé";
    $("adv-reset").disabled = !n;
    // Same count per group, next to its title
    document.querySelectorAll("#adv .ag").forEach((g) => {
      const c = [...g.querySelectorAll("[data-f]")].filter((el) => state.adv[el.dataset.f] && isOn(el.dataset.f)).length
        + (g.contains($("a-modele")) && state.f.modele ? 1 : 0);
      const b = g.querySelector(".ag-n");
      b.hidden = !c; b.textContent = c;
      g.classList.toggle("on", !!c);
    });
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
    return `<div class="schema" data-schema>
      <div class="schema-draw">${svg}</div>
      <ul class="schema-legend">${legend}${stator}</ul>
    </div>`;
  }

  // Icons of the tabs and section headers
  const ICON = {
    dimension: '<svg viewBox="0 0 24 24"><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
    tech: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    videos: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9v6l5-3z"/></svg>',
    photos: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>',
    target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>',
    price: '<svg viewBox="0 0 24 24"><path d="M3 12l9-9h8v8l-9 9z"/><circle cx="15.5" cy="8.5" r="1.5"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    similar: '<svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/></svg>',
  };
  // Same section header everywhere: icon, title, optional note on the right
  const secH = (icon, title, note = "") => `<header class="sec-h"><span class="sec-ico" aria-hidden="true">${ICON[icon] || ""}</span><h3>${title}</h3>${note ? `<small>${note}</small>` : ""}</header>`;
  // Aligned "label → value" list; missing values stay discreet
  const kvRows = (rows) => `<dl class="kv-list">${rows.map(([l, v]) => `<div class="kv-row ${has(v) ? "" : "na"}"><dt>${esc(l)}</dt><dd>${has(v) ? `<span>${esc(v)}</span>` : "—"}</dd></div>`).join("")}</dl>`;

  function panelDimension(m) {
    const kv = kvList(m).slice(0, 4).join(" · ");
    return `<div class="dim2">
      <section class="card info-card">
        <div class="info-img">${photo(m, "hero-moteur.png")}</div>
        <div class="info-main">
          <p class="eyebrow">Informations générales</p>
          <div class="info-title"><h2>${esc(m.NOM)}</h2>${brandMark(m)}</div>
          <div class="info-chips">
            ${[["Classe", m.CLASSE], ["Poids", weight(m)], ["KV", kv], ["Configuration", m.CONFIG], ["Câble", cable(m)]].map(([l, v]) =>
              `<span class="ichip ${has(v) ? "" : "na"}"><b>${l}</b><em>${esc(has(v) ? v : "—")}</em></span>`).join("")}
          </div>
        </div>
      </section>
      <div class="dim2-grid">
        <section class="card schema-card">
          ${secH("dimension", "Schéma coté", "Survolez ou touchez une cote")}
          ${dimSchema(m)}
        </section>
        <aside class="dim2-side">
          <section class="card">
            ${secH("bolt", "Caractéristiques")}
            ${kvRows([["Voltage", m.VOLTAGE || m.LIPO], ["Ampérage", unit(m.AMP, " A")], ["Puissance", unit(m.PUISSANCE, " W")],
              ["Résistance", m.RESISTANCE], ["Aimant", m.AIMANT], ["Type de shaft", m["TYPE SHAFT"]], ["Cloche", m.CLOCHE], ["Fixation hélice", m["VIS HEL"]]])}
          </section>
          <section class="card">
            ${secH("target", "Recommandation")}
            ${kvRows([["Hélice", m.HELICE], ["Utilisation", m.UTILISATION], ["LiPo", m.LIPO]])}
          </section>
        </aside>
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
    const more = `<p class="more-row"><a class="ghost-btn" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">Plus de vidéos sur YouTube →</a></p>`;
    if (!list.length) return `<section class="card">${secH("videos", "Vidéos de review")}<p class="note">Aucune vidéo de review trouvée pour ce moteur pour l'instant.</p>${more}</section>`;
    const card = (v, big) => `
      <a class="video ${big ? "featured" : ""}" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener" data-yt="${esc(v.id)}">
        <span class="video-media">
          <img src="${esc(media(`https://i.ytimg.com/vi/${v.id}/${big ? "hqdefault" : "mqdefault"}.jpg`))}" alt="" loading="lazy" onerror="this.remove()">
          <span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
          ${v.d ? `<span class="dur">${esc(v.d)}</span>` : ""}
        </span>
        <span class="video-txt"><span class="video-t">${esc(v.t)}</span><span class="video-m">${esc(v.c)}${v.v ? ` · ${esc(v.v)}` : ""}</span></span>
      </a>`;
    return `<section class="card">
      ${secH("videos", "Vidéos de review", `${list.length} vidéo${list.length > 1 ? "s" : ""} trouvée${list.length > 1 ? "s" : ""} sur YouTube`)}
      <div class="videos2">${card(list[0], true)}${list.length > 1 ? `<div class="video-list">${list.slice(1).map((v) => card(v, false)).join("")}</div>` : ""}</div>
      ${more}
    </section>`;
  }

  // Photo gallery: hosted thumbnail, shop photos (tools/photos.py), original image
  function gallery(m) {
    const urls = [state.thumbs[m.REF], ...(state.photos[famKey(m)] || []), safeUrl(m.IMG)].filter(Boolean);
    return [...new Set(urls)].map(media).filter((u) => !window.MM_MEDIA || /^data:/.test(u));
  }
  function panelPhotos(m) {
    const list = gallery(m);
    const link = safeUrl(m.LIEN);
    // Only real photos here, never the default drawing
    const linkBtn = link ? `<p class="more-row"><a class="ghost-btn" href="${esc(link)}" target="_blank" rel="noopener">Voir la fiche officielle →</a></p>` : "";
    if (!list.length) return `<section class="card">${secH("photos", "Photos")}<p class="note">Pas encore de photo pour ce moteur.</p>${linkBtn}</section>`;
    return `<section class="card">${secH("photos", "Photos", `${list.length} photo${list.length > 1 ? "s" : ""}`)}<div class="gallery" data-gallery>
        <div class="g-main"><img src="${esc(list[0])}" alt="${esc(`${m.MARQUE} ${m.NOM}`)}" class="is-photo" onerror="this.closest('[data-gallery]').querySelector('.g-th[aria-current=true]')?.remove();this.remove()">
          ${list.length > 1 ? `<button class="g-nav prev" type="button" aria-label="Photo précédente">‹</button><button class="g-nav next" type="button" aria-label="Photo suivante">›</button>` : ""}
          <span class="g-count">1 / ${list.length}</span></div>
        ${list.length > 1 ? `<div class="g-thumbs">${list.map((u, i) => `<button type="button" class="g-th" data-i="${i}" aria-label="Photo ${i + 1}" aria-current="${i === 0}"><img src="${esc(u)}" alt="" loading="lazy" onerror="this.closest('button').remove()"></button>`).join("")}</div>` : ""}
      </div>${linkBtn}</section>`;
  }


  const PANELS = { dimension: panelDimension, tech: panelTech, videos: panelVideos, photos: panelPhotos };

  // --- Similar motors: same stator size (± a little), closest KV, weight and shaft -----
  const stator = (m) => {
    const d = num(m["D STATOR"]), h = num(m["H STATOR"]);
    if (d && h) return [d, h];
    const c = String(m.CLASSE || "").match(/^(\d{2})(\d{2})/);
    return c ? [+c[1], +c[2]] : null;
  };
  const gimbal = (m) => /gimbal/i.test(`${m.NOM} ${m.VERSION} ${m.UTILISATION}`);
  function similar(m, max = 8) {
    const s0 = stator(m), kv0 = num(m.KV), w0 = num(m.POIDS), sh0 = norm(shaft(m)), self = famKey(m);
    if (!s0) return [];
    const best = new Map();
    for (const x of state.motors) {
      const k = famKey(x);
      if (k === self || gimbal(x) !== gimbal(m)) continue;
      const s = stator(x);
      if (!s || Math.abs(s[0] - s0[0]) > 2 || Math.abs(s[1] - s0[1]) > 2) continue;
      const kv = num(x.KV), w = num(x.POIDS);
      let score = Math.abs(s[0] - s0[0]) / 1.5 + Math.abs(s[1] - s0[1]);
      score += kv0 && kv ? Math.abs(Math.log(kv / kv0)) * 5 : 1.5;
      score += w0 && w ? Math.min(2, (Math.abs(w - w0) / w0) * 3) : 0.8;
      if (sh0 && norm(shaft(x)) !== sh0) score += 0.5;
      score -= completeness(x) * 0.04 + (state.thumbs[x.REF] || safeUrl(x.IMG) ? 0.3 : 0);
      const cur = best.get(k);
      if (!cur || score < cur.score) best.set(k, { m: x, score });
    }
    return [...best.values()].sort((a, b) => a.score - b.score).slice(0, max).map((r) => r.m);
  }
  const delta = (v, v0, unit, digits = 0) => {
    if (v === null || v0 === null) return "";
    const d = Math.round((v - v0) * 10 ** digits) / 10 ** digits;
    return d ? `<em class="${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${Math.abs(d)}${unit}</em>` : `<em class="eq">=</em>`;
  };
  function similarBlock(m) {
    const list = similar(m);
    if (!list.length) return "";
    const kv0 = num(m.KV), w0 = num(m.POIDS), cls = String(m.CLASSE || "");
    return `${secH("similar", "Moteurs similaires", `Même taille de stator${has(m.KV) ? `, KV proche de ${esc(fmt(m.KV))}` : ""}`)}
      <div class="sim-list">${list.map((x, i) => `
        <a class="sim" href="#m/${encodeURIComponent(x.REF)}" style="--i:${i}">
          <span class="sim-img">${photo(x)}</span>
          <span class="sim-brand">${brandMark(x)}</span>
          <strong class="sim-name">${esc(x.NOM || x.REF)}</strong>
          <span class="sim-specs">
            <span><small>Classe</small><b>${esc(x.CLASSE || "—")}</b>${x.CLASSE && x.CLASSE === cls ? `<em class="eq">=</em>` : ""}</span>
            <span><small>KV</small><b>${esc(fmt(x.KV) || "—")}</b>${delta(num(x.KV), kv0, "")}</span>
            <span><small>Poids</small><b>${has(x.POIDS) ? `${esc(fmt(x.POIDS))} g` : "—"}</b>${delta(num(x.POIDS), w0, " g", 1)}</span>
          </span>
        </a>`).join("")}</div>`;
  }

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
          ${[["dimension", "Dimension"], ["tech", "Fiche technique"], ["videos", "Vidéos", (state.videos[famKey(m)] || []).length], ["photos", "Photos", gallery(m).length]].map(([k, l, n]) =>
            `<button class="d-tab" role="tab" data-panel="${k}" aria-selected="${panel === k}"><span class="d-tab-ico" aria-hidden="true">${ICON[k]}</span><span class="d-tab-l">${l}</span>${n ? `<span class="d-tab-n">${n}</span>` : ""}</button>`).join("")}
        </div>
        <div class="d-panel" id="d-panel">${PANELS[panel](m)}</div>
      </div>`;
    $("detail").dataset.ref = ref;
    $("detail").dataset.panel = panel;
    hooks.onDetail?.(m);
    // After the price comparator, before the comments (both added by community.js)
    const sim = similarBlock(m);
    if (sim) {
      const html = `<section class="d-extra card" id="d-similar">${sim}</section>`;
      const before = $("d-comments");
      before ? before.insertAdjacentHTML("beforebegin", html) : document.querySelector("#detail .d-body").insertAdjacentHTML("beforeend", html);
    }
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
      [state.motors, state.thumbs, state.videos, state.photos, state.logos] = await Promise.all([
        loadCSV().then(parseCSV), loadJSON("thumbs", window.MM_THUMBS), loadJSON("videos", window.MM_VIDEOS), loadJSON("photos", window.MM_PHOTOS),
        loadJSON("logos", window.MM_LOGOS),
      ]);
    } catch (err) {
      $("empty").textContent = "Le catalogue n'a pas pu être chargé. Réessayez dans quelques minutes.";
      $("empty").hidden = false;
      return;
    }

    const refresh = () => { readFilters(); state.shown = PAGE; advSummary(); renderList(); };
    buildAdv(refresh);
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
    // Advanced filters unfold smoothly (height, then fields in cascade)
    $("adv-toggle").addEventListener("click", () => {
      const open = !$("filters").classList.contains("open");
      $("filters").classList.toggle("open", open);
      $("adv-toggle").setAttribute("aria-expanded", String(open));
      document.querySelector(".adv-inner").inert = !open;
      // Dropdowns (brands) may overflow the panel once it has finished unfolding
      $("filters").classList.remove("shown");
      if (open) setTimeout(() => $("filters").classList.toggle("shown", $("filters").classList.contains("open")), 520);
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
      if (t) {
        const m = state.motors.find((x) => x.REF === $("detail").dataset.ref);
        document.querySelectorAll(".d-tab").forEach((b) => b.setAttribute("aria-selected", String(b === t)));
        $("d-panel").innerHTML = PANELS[t.dataset.panel](m);
        $("detail").dataset.panel = t.dataset.panel;
        if ($("d-tabs").getBoundingClientRect().top < 0) $("d-tabs").scrollIntoView({ block: "start" });
        return;
      }
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
