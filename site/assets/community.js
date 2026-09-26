/* Multi-Motors — community features on top of the catalogue (app.js):
 * accounts (email + Google), likes, comments, change suggestions, moderation
 * panel, indicative prices + comparator, news feed.
 * Talks to api/index.php (PHP + MySQL on the hosting). The standalone preview
 * has no server: it runs on an in-memory demo API instead.
 */
(function () {
  "use strict";
  const hooks = (window.MM_HOOKS = window.MM_HOOKS || {});
  const $ = (id) => document.getElementById(id);
  const MM = () => window.MM;
  const esc = (s) => MM().esc(s);
  const DEMO = !!window.MM_ASSETS;
  const C = { user: null, googleId: "", likes: {}, overrides: {}, prices: {}, actus: [], online: false };
  const FIELD_LABELS = {
    NOM: "Nom du modèle", VERSION: "Version", CLASSE: "Classe (stator)", KV: "KV", POIDS: "Poids (g)",
    "D MOTEUR": "Diamètre moteur (mm)", "H MOTEUR": "Hauteur moteur (mm)", "D SHAFT": "Diamètre shaft (mm)",
    "L SHAFT": "Longueur shaft (mm)", "TYPE SHAFT": "Type de shaft", "VIS HEL": "Fixation hélice", "VIS FIX": "Vis de fixation",
    "ENTRAXE FIX": "Entraxe de fixation", LIPO: "LiPo (ex. 4S-6S)", "L CABLE": "Longueur câble", "TYPE CABLE": "Section câble (AWG)",
    HELICE: "Hélice recommandée", PUISSANCE: "Puissance max (W)", AMP: "Courant max (A)", AIMANT: "Aimants", CLOCHE: "Cloche",
    CONFIG: "Configuration (ex. 12N14P)", RESISTANCE: "Résistance", UTILISATION: "Utilisation", LIEN: "Lien officiel",
    IMG: "Photo (lien)", AUTRE: "Autre remarque",
  };
  const ROLE_LABEL = { user: "Membre", moderator: "Modération", admin: "Admin" };

  // ------------------------------------------------------------------ API
  async function api(action, data) {
    if (DEMO) return demoApi(action, data || {});
    const opts = { credentials: "same-origin", headers: { "X-MM": "1" } };
    let url = `api/index.php?action=${action}`;
    if (data && data.__get) url += "&" + new URLSearchParams(data.__get);
    else if (data) Object.assign(opts, { method: "POST", body: JSON.stringify(data), headers: { "X-MM": "1", "Content-Type": "application/json" } });
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({ error: "Réponse invalide du serveur." }));
    if (!res.ok || json.error) throw new Error(json.error || "Erreur du serveur.");
    return json;
  }
  const get = (action, params) => api(action, params ? { __get: params } : undefined);

  // Demo API for the standalone preview: nothing leaves the browser page
  const D = { users: [], me: null, likes: {}, comments: [], sugg: [], news: [], profiles: {}, id: 1 };
  function demoApi(action, d) {
    const q = d.__get || d;
    const me = D.me;
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const need = () => { if (!me) throw new Error("Connectez-vous pour faire cela."); };
    const mod = () => { need(); if (me.role === "user") throw new Error("Réservé à la modération."); };
    const pub = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, verified: true, color: D.profiles[u.id]?.color || "", avatar: D.profiles[u.id]?.avatar || "" };
    switch (action) {
      case "me": return { user: pub(me), google_client_id: "" };
      case "register": case "login": {
        const email = (d.email || "").toLowerCase();
        if (!/.+@.+\..+/.test(email)) throw new Error("Adresse email invalide.");
        if ((d.password || "").length < 8) throw new Error("Le mot de passe doit faire au moins 8 caractères.");
        let u = D.users.find((x) => x.email === email);
        if (!u) { u = { id: D.id++, email, name: d.name || email.split("@")[0], role: D.users.length ? "user" : "admin", since: now }; D.users.push(u); }
        D.me = u;
        return { user: pub(u), message: action === "register" ? "Compte de démonstration créé (premier compte = administrateur)." : undefined };
      }
      case "logout": D.me = null; return { user: null };
      case "forgot": return { message: "Sur le site, un lien de réinitialisation est envoyé par email." };
      case "likes": { const o = {}; for (const [r, s] of Object.entries(D.likes)) if (s.size) o[r] = s.size; return o; }
      case "overrides": { const o = {}; D.sugg.filter((s) => s.status === "approved" && s.field !== "AUTRE").forEach((s) => ((o[s.ref] = o[s.ref] || {})[s.field] = s.new_value)); return o; }
      case "news": return D.news.filter((n) => n.published).map((n) => ({ ...n, author: "Admin" }));
      case "motor": {
        const s = D.likes[q.ref] || new Set();
        const isMod = me && me.role !== "user";
        return {
          likes: s.size, liked: !!me && s.has(me.id), pending_suggestions: D.sugg.filter((x) => x.ref === q.ref && x.status === "pending").length,
          comments: D.comments.filter((c) => c.ref === q.ref && (c.status === "visible" || (isMod && c.status === "hidden")))
            .map((c) => { const u = D.users.find((x) => x.id === c.user_id); return { ...c, author: u?.name || "Membre", role: u?.role, uid: u ? u.id : 0, color: D.profiles[c.user_id]?.color || "", avatar: D.profiles[c.user_id]?.avatar || "", mine: me && c.user_id === me.id }; }).reverse(),
        };
      }
      case "like": { need(); const s = (D.likes[d.ref] = D.likes[d.ref] || new Set()); s.has(me.id) ? s.delete(me.id) : s.add(me.id); return { liked: s.has(me.id), likes: s.size }; }
      case "comment": need(); if ((d.body || "").length < 3) throw new Error("Votre commentaire est vide."); D.comments.push({ id: D.id++, ref: d.ref, user_id: me.id, body: d.body, status: "visible", at: now }); return { ok: true };
      case "comment_delete": case "moderate_comment": { need(); const c = D.comments.find((x) => x.id === +d.id); if (c) c.status = d.status || "deleted"; return { ok: true }; }
      case "suggest": need(); if (!d.value) throw new Error("Indiquez la nouvelle valeur."); D.sugg.push({ id: D.id++, ...d, new_value: d.value, old_value: d.old, user_id: me.id, author: me.name, status: "pending", created_at: now }); return { message: "Merci ! Votre suggestion sera vérifiée par la modération." };
      case "admin_stats": mod(); return { pending: D.sugg.filter((s) => s.status === "pending").length, users: D.users.length, comments: D.comments.filter((c) => c.status === "visible").length, likes: Object.values(D.likes).reduce((a, s) => a + s.size, 0) };
      case "admin_suggestions": mod(); return D.sugg.filter((s) => s.status === (q.status || "pending"));
      case "moderate_suggestion": { mod(); const s = D.sugg.find((x) => x.id === +d.id); if (s) { s.status = d.decision; if (d.value) s.new_value = d.value; s.reviewer = me.name; s.reviewed_at = now; } return { ok: true }; }
      case "admin_comments": mod(); return D.comments.filter((c) => c.status !== "deleted").map((c) => ({ ...c, created_at: c.at, author: D.users.find((u) => u.id === c.user_id)?.name })).reverse();
      case "admin_users": mod(); return D.users.map((u) => ({ ...u, verified: 1, banned: u.banned ? 1 : 0, created_at: now }));
      case "user_update": { mod(); const u = D.users.find((x) => x.id === +d.id); if (u) { if (d.role) u.role = d.role; if (d.banned !== undefined && d.banned !== "") u.banned = d.banned === "1"; } return { ok: true }; }
      case "profile": {
        const u = D.users.find((x) => x.id === +q.id);
        if (!u) throw new Error("Ce membre n'existe pas ou plus.");
        const p = D.profiles[u.id] || {}, mine = !!me && me.id === u.id;
        const base = { id: u.id, name: u.name, role: u.role, since: u.since, mine, color: p.color || "", avatar: p.avatar || "" };
        if (p.is_public === false && !mine && !(me && me.role !== "user")) return { ...base, private: true };
        return {
          ...base, bio: p.bio || "", location: p.location || "", website: p.website || "", youtube: p.youtube || "", instagram: p.instagram || "",
          flying: p.flying || "", setup: p.setup || [], is_public: p.is_public !== false, show_likes: p.show_likes !== false,
          stats: { comments: D.comments.filter((c) => c.user_id === u.id && c.status === "visible").length, approved: D.sugg.filter((x) => x.user_id === u.id && x.status === "approved").length,
            suggestions: D.sugg.filter((x) => x.user_id === u.id).length, likes: Object.values(D.likes).filter((st) => st.has(u.id)).length },
          comments: D.comments.filter((c) => c.user_id === u.id && c.status === "visible").slice(-10).reverse(),
          likes: p.show_likes !== false || mine ? Object.entries(D.likes).filter(([, st]) => st.has(u.id)).map(([r]) => r).slice(0, 24) : [],
        };
      }
      case "profile_save": {
        need();
        const p = (D.profiles[me.id] = D.profiles[me.id] || {});
        const url = (v, host) => { if (!v) return ""; if (!/^https?:\/\//i.test(v)) v = "https://" + v; try { const h = new URL(v).hostname; if (host && !h.endsWith(host)) throw 0; } catch (e) { throw new Error(host ? `Le lien doit mener à ${host}.` : `Lien invalide : ${v}`); } return v; };
        if ((d.setup || []).length > 8) throw new Error("8 moteurs au maximum dans votre setup.");
        if ("avatar" in d && d.avatar && !/^data:image\/(png|jpeg|webp);base64,/.test(d.avatar)) throw new Error("Image refusée : PNG, JPEG ou WebP uniquement.");
        Object.assign(p, { bio: (d.bio || "").slice(0, 280), location: (d.location || "").slice(0, 60), website: url(d.website), youtube: url(d.youtube, "youtube.com"),
          instagram: url(d.instagram, "instagram.com"), color: d.color || "", flying: d.flying || "", setup: d.setup || [], is_public: d.is_public !== "0", show_likes: d.show_likes !== "0" });
        if ("avatar" in d) p.avatar = d.avatar || "";
        return { user: pub(me), message: "Profil enregistré." };
      }
      case "account_update": {
        need(); const msg = [];
        if (d.name && d.name !== me.name) { if (d.name.length < 2) throw new Error("Choisissez un pseudo d'au moins 2 caractères."); me.name = d.name; msg.push("Pseudo modifié."); }
        if (d.email && d.email !== me.email) { if (!/.+@.+\..+/.test(d.email)) throw new Error("Adresse email invalide."); me.email = d.email.toLowerCase(); msg.push("Adresse modifiée."); }
        if (d.password) { if (d.password.length < 8) throw new Error("Le nouveau mot de passe doit faire au moins 8 caractères."); msg.push("Mot de passe modifié."); }
        return { user: pub(me), message: msg.join(" ") || "Rien à modifier." };
      }
      case "account_delete": {
        need(); if (d.confirm !== "SUPPRIMER") throw new Error("Tapez SUPPRIMER pour confirmer.");
        D.users = D.users.filter((u) => u.id !== me.id); delete D.profiles[me.id];
        Object.values(D.likes).forEach((st) => st.delete(me.id)); D.comments.forEach((c) => { if (c.user_id === me.id) c.status = "deleted"; });
        D.me = null; return { user: null, message: "Votre compte a été supprimé." };
      }
      case "admin_news": mod(); return D.news;
      case "news_save": { mod(); if (!d.title || !d.body) throw new Error("Titre et texte obligatoires."); const n = D.news.find((x) => x.id === +d.id); if (n) Object.assign(n, { title: d.title, body: d.body, published: d.published !== "0" }); else D.news.unshift({ id: D.id++, title: d.title, body: d.body, published: d.published !== "0", created_at: now, at: now }); return { ok: true }; }
      case "news_delete": mod(); D.news = D.news.filter((x) => x.id !== +d.id); return { ok: true };
      default: throw new Error("Action inconnue.");
    }
  }

  // ------------------------------------------------------------ UI helpers
  function toast(msg, kind = "") {
    const t = document.createElement("div");
    t.className = `toast ${kind}`;
    t.setAttribute("role", "status");
    t.textContent = msg;
    $("toasts").appendChild(t);
    setTimeout(() => t.classList.add("out"), 3600);
    setTimeout(() => t.remove(), 4100);
  }
  function modal(html, cls = "") {
    const d = $("modal");
    d.className = cls;
    d.innerHTML = `<button class="m-close" type="button" aria-label="Fermer">×</button>${html}`;
    if (!d.open) d.showModal();
    return d;
  }
  const closeModal = () => $("modal").open && $("modal").close();
  const when = (at) => {
    const d = new Date((at || "").replace(" ", "T") + "Z");
    return isNaN(d) ? "" : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  };
  const euro = (v) => `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  // Prices with and without VAT: shops in euros (and the UK shop) show VAT-inclusive prices;
  // shops outside Europe are VAT-free, French import VAT (20 %) is added to compare like for like
  const VAT = 0.2;
  const ttc = (o) => (o.cur === "USD" ? o.eur * (1 + VAT) : o.eur);
  const ht = (v) => v / (1 + VAT);
  const median = (xs) => { const s = xs.slice().sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  const ttcOf = (p) => (p?.offers?.length ? median(p.offers.map(ttc)) : null);
  const priceTag = (v, cls = "") => `<span class="pt ${cls}"><b>${euro(v)}</b><small>TTC</small><span class="pt-ht">${euro(ht(v))} HT</span></span>`;
  const motorBy = (ref) => MM().state.motors.find((m) => m.REF === ref);
  const isMod = () => C.user && C.user.role !== "user";
  const motorName = (ref) => { const m = motorBy(ref); return m ? `${m.MARQUE} ${m.NOM || ""} ${m.KV ? m.KV + "KV" : ""}` : ref; };

  // ------------------------------------------------------------- account bar
  function renderAccount() {
    const el = $("acct");
    if (!el) return;
    el.innerHTML = C.user
      ? `<button type="button" class="nav-pill acct-btn" aria-haspopup="true" aria-expanded="false">${avatar(C.user, "xs")}${esc(C.user.name)}${C.user.role !== "user" ? `<em>${ROLE_LABEL[C.user.role]}</em>` : ""}</button>
         <div class="acct-menu" hidden>
           <a href="#u/${C.user.id}">Mon profil</a>
           <a href="#profil">Modifier mon profil</a>
           ${isMod() ? `<a href="#admin">Administration</a>` : ""}
           <button type="button" data-logout>Se déconnecter</button>
         </div>`
      : `<button type="button" class="nav-pill" data-login>Connexion</button>`;
  }

  function authForm(tab = "login") {
    const google = C.googleId ? `<div class="g-wrap"><div id="g-btn"></div><p class="or">ou</p></div>` : "";
    modal(`
      <h2 class="m-title">${tab === "register" ? "Créer un compte" : tab === "forgot" ? "Mot de passe oublié" : "Connexion"}</h2>
      ${DEMO ? `<p class="demo-note">Aperçu : comptes de démonstration, rien n'est enregistré. Le premier compte créé est administrateur.</p>` : ""}
      ${tab !== "forgot" ? google : ""}
      <form class="m-form" data-auth="${tab}">
        ${tab === "register" ? `<label>Pseudo<input name="name" required minlength="2" maxlength="40" autocomplete="nickname"></label>` : ""}
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        ${tab !== "forgot" ? `<label>Mot de passe<input name="password" type="password" required minlength="8" autocomplete="${tab === "register" ? "new-password" : "current-password"}"></label>` : ""}
        <p class="m-error" role="alert" hidden></p>
        <button class="btn-red" type="submit">${tab === "register" ? "Créer mon compte" : tab === "forgot" ? "Envoyer le lien" : "Se connecter"}</button>
      </form>
      <p class="m-links">
        ${tab === "login" ? `<button type="button" data-auth-tab="register">Créer un compte</button> · <button type="button" data-auth-tab="forgot">Mot de passe oublié ?</button>`
          : `<button type="button" data-auth-tab="login">J'ai déjà un compte</button>`}
      </p>`, "m-auth");
    if (C.googleId && tab !== "forgot") mountGoogle();
  }

  function mountGoogle() {
    const draw = () => {
      window.google.accounts.id.initialize({
        client_id: C.googleId,
        callback: async (r) => {
          try { C.user = (await api("google", { credential: r.credential })).user; afterLogin(); }
          catch (err) { toast(err.message, "bad"); }
        },
      });
      window.google.accounts.id.renderButton($("g-btn"), { theme: "outline", size: "large", width: 300, text: "continue_with", locale: "fr" });
    };
    if (window.google?.accounts?.id) return draw();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = draw;
    document.head.appendChild(s);
  }

  function afterLogin(msg) {
    closeModal();
    renderAccount();
    toast(msg || `Bonjour ${C.user.name} !`, "good");
    refreshCurrent();
  }

  // ----------------------------------------------------- catalogue additions
  const priceOf = (m) => ttcOf(C.prices[m.REF]);
  hooks.likes = (m) => C.likes[m.REF] || 0;
  hooks.rowExtra = (m) => {
    const p = priceOf(m), l = C.likes[m.REF];
    if (!p && !l) return "";
    return `<span class="row-meta">${p ? `<span class="price-chip" title="Prix indicatif TTC, médiane des offres relevées (${euro(ht(p))} HT)">≈ ${euro(p)} <small>TTC</small></span>` : ""}${l ? `<span class="like-chip">♥ ${l}</span>` : ""}</span>`;
  };

  hooks.onBoot = async () => {
    const load = async (name, inline) => {
      if (inline) return inline;
      try { const r = await fetch(`data/${name}.json`, { cache: "no-cache" }); if (r.ok) return r.json(); } catch (e) { /* not published yet */ }
      return name === "actus" ? [] : {};
    };
    [C.prices, C.actus] = await Promise.all([load("prix", window.MM_PRIX), load("actus", window.MM_ACTUS)]);
    try {
      const me = await get("me");
      C.user = me.user; C.googleId = me.google_client_id || ""; C.online = true;
      [C.likes, C.overrides] = await Promise.all([get("likes"), get("overrides")]);
    } catch (e) { C.online = false; /* server not configured yet: catalogue still works */ }
    applyOverrides();
    renderAccount();
  };

  // Approved community corrections are applied on top of the catalogue
  function applyOverrides() {
    for (const [ref, fields] of Object.entries(C.overrides || {})) {
      const m = motorBy(ref);
      if (!m) continue;
      m._community = Object.keys(fields);
      Object.assign(m, fields);
    }
  }

  // ------------------------------------------------------------ motor page
  const HICON = {
    price: '<svg viewBox="0 0 24 24"><path d="M3 12l9-9h8v8l-9 9z"/><circle cx="15.5" cy="8.5" r="1.5"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  };
  const head = (icon, title, note = "") => `<header class="sec-h"><span class="sec-ico" aria-hidden="true">${HICON[icon]}</span><h3>${title}</h3>${note ? `<small>${note}</small>` : ""}</header>`;
  hooks.onDetail = (m) => {
    const top = document.querySelector("#detail .d-top");
    const p = C.prices[m.REF];
    top.insertAdjacentHTML("afterend", `<div class="d-actions">
      <button type="button" class="like-btn" data-like="${esc(m.REF)}" aria-pressed="false"><span class="heart" aria-hidden="true">♥</span><b>0</b><span class="sr"> j'aime</span></button>
      ${ttcOf(p) ? `<a class="price-badge" href="#m/${encodeURIComponent(m.REF)}" data-scroll="d-prix">Prix indicatif <b>≈ ${euro(ttcOf(p))} TTC</b><small>${euro(ht(ttcOf(p)))} HT</small></a>` : ""}
      <button type="button" class="suggest-btn" data-suggest="${esc(m.REF)}">Suggérer une modification</button>
      ${m._community ? `<span class="community-badge" title="${esc(m._community.map((f) => FIELD_LABELS[f] || f).join(", "))}">Corrigé par la communauté</span>` : ""}
    </div>`);
    document.querySelector("#detail .d-body").insertAdjacentHTML("beforeend", `
      <section class="d-extra card" id="d-prix">${pricesBlock(m)}</section>
      <section class="d-extra card" id="d-comments">${head("chat", "Commentaires")}<div id="c-list"><p class="note">Chargement…</p></div></section>`);
    loadSocial(m.REF);
  };

  function pricesBlock(m) {
    const p = C.prices[m.REF];
    if (!p || !p.offers?.length) {
      return `${head("price", "Comparateur de prix")}<p class="note">Aucune offre relevée pour ce moteur pour l'instant.</p>`;
    }
    const offers = p.offers.map((o) => ({ ...o, ttc: ttc(o) })).sort((a, b) => (!a.stock - !b.stock) || a.ttc - b.ttc);
    const best = Math.min(...offers.map((o) => o.ttc)), mid = ttcOf(p);
    return `${head("price", "Comparateur de prix", `${offers.length} boutique${offers.length > 1 ? "s" : ""}`)}
      <div class="price-head"><div class="price-big">${priceTag(mid, "big")}<small>prix indicatif par moteur</small></div>
        <p>Médiane de ${offers.length} offre${offers.length > 1 ? "s" : ""} relevée${offers.length > 1 ? "s" : ""} le ${new Date(p.date).toLocaleDateString("fr-FR")}, convertie${offers.length > 1 ? "s" : ""} en euros au taux BCE du jour. Boutiques hors Europe : TVA de 20 % ajoutée ; frais de port et de douane non compris.</p></div>
      <div class="offers">${offers.map((o) => `
        <a class="offer ${o.ttc === best ? "best" : ""} ${o.stock ? "" : "oos"}" href="${esc(o.url)}" target="_blank" rel="noopener">
          <span class="o-shop">${esc(o.shop)}${o.ttc === best ? `<em>Meilleur prix</em>` : ""}</span>
          <span class="o-price">${priceTag(o.ttc)}<small class="o-orig">${o.pack > 1 ? `lot de ${o.pack} : ` : ""}${o.price.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${o.cur === "USD" ? "$ HT" : o.cur === "GBP" ? "£" : "€"}</small></span>
          <span class="o-stock">${o.stock ? "En stock" : "Rupture"}</span>
          <span class="o-go">Voir l'offre →</span>
        </a>`).join("")}</div>`;
  }

  async function loadSocial(ref) {
    const list = $("c-list");
    if (!C.online) {
      list.innerHTML = `<p class="note">Les commentaires et les « j'aime » seront disponibles dès que le serveur du site sera configuré.</p>`;
      document.querySelectorAll(".like-btn, .suggest-btn").forEach((b) => (b.disabled = true));
      return;
    }
    try {
      const s = await get("motor", { ref });
      const btn = document.querySelector(`[data-like]`);
      if (btn) { btn.querySelector("b").textContent = s.likes; btn.setAttribute("aria-pressed", String(s.liked)); }
      list.innerHTML = commentsBlock(ref, s);
    } catch (e) { list.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
  }

  function commentsBlock(ref, s) {
    const form = C.user
      ? `<form class="c-form" data-comment="${esc(ref)}"><label class="sr" for="c-body">Votre commentaire</label>
          <textarea id="c-body" name="body" rows="3" maxlength="2000" required placeholder="Votre avis, votre expérience en vol, un conseil de montage…"></textarea>
          <button class="btn-red" type="submit">Publier</button></form>`
      : `<p class="c-login"><button type="button" class="btn-dark" data-login>Connectez-vous</button> pour donner votre avis.</p>`;
    const items = s.comments.length ? s.comments.map((c) => `
      <article class="comment ${c.status === "hidden" ? "hidden-c" : ""}">
        <header>${c.uid ? `<a class="c-author" href="#u/${c.uid}">${avatar({ name: c.author, color: c.color, avatar: c.avatar }, "sm")}<b>${esc(c.author)}</b></a>` : `<b>${esc(c.author)}</b>`}${c.role && c.role !== "user" ? `<em>${ROLE_LABEL[c.role]}</em>` : ""}<time>${when(c.at)}</time>
          ${c.status === "hidden" ? `<span class="tagc">Masqué</span>` : ""}</header>
        <p>${esc(c.body).replace(/\n/g, "<br>")}</p>
        <footer>${c.mine ? `<button type="button" data-cdel="${c.id}">Supprimer</button>` : ""}
          ${isMod() && !c.mine ? (c.status === "hidden" ? `<button type="button" data-cmod="${c.id}" data-status="visible">Rétablir</button>` : `<button type="button" data-cmod="${c.id}" data-status="hidden">Masquer</button>`) + `<button type="button" data-cmod="${c.id}" data-status="deleted">Supprimer</button>` : ""}</footer>
      </article>`).join("") : `<p class="note">Pas encore de commentaire. Soyez le premier à donner votre avis.</p>`;
    return form + `<div class="comments">${items}</div>`;
  }

  function suggestForm(ref) {
    const m = motorBy(ref);
    if (!C.user) return authForm("login");
    const opts = Object.entries(FIELD_LABELS).map(([k, l]) => `<option value="${esc(k)}">${esc(l)}${m && m[k] ? ` (actuel : ${esc(String(m[k]).slice(0, 30))})` : ""}</option>`).join("");
    modal(`<h2 class="m-title">Suggérer une modification</h2>
      <p class="m-sub">${esc(motorName(ref))}</p>
      <form class="m-form" data-suggest-form="${esc(ref)}">
        <label>Caractéristique<select name="field">${opts}</select></label>
        <label>Nouvelle valeur<input name="value" required maxlength="255"></label>
        <label>Source (lien vers la fiche officielle, une review…)<input name="source" type="url" maxlength="500" placeholder="https://"></label>
        <label>Commentaire pour la modération (facultatif)<textarea name="note" rows="2" maxlength="1000"></textarea></label>
        <p class="m-error" role="alert" hidden></p>
        <button class="btn-red" type="submit">Envoyer la suggestion</button>
      </form>`, "m-suggest");
  }

  // ------------------------------------------------------------------ news
  function renderActus() {
    const v = $("view-actus");
    v.hidden = false;
    v.innerHTML = `<div class="page"><h1 class="page-title">Actualités</h1>
      <div class="chips" role="tablist"><button class="tab" data-actus="all" aria-selected="true">Tout</button><button class="tab" data-actus="moteurs" aria-selected="false">Nouveaux moteurs</button><button class="tab" data-actus="site" aria-selected="false">Le site</button></div>
      <div id="feed"><p class="note">Chargement…</p></div></div>`;
    (C.online ? get("news").catch(() => []) : Promise.resolve([])).then((news) => {
      const items = [
        ...news.map((n) => ({ kind: "site", at: n.at, title: n.title, body: n.body, author: n.author })),
        ...(C.actus || []).map((a) => ({ kind: a.type || "moteurs", at: a.date, title: a.title, body: a.body || "", refs: a.refs || [] })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
      v._items = items;
      drawFeed("all");
    });
  }
  function drawFeed(kind) {
    const v = $("view-actus");
    const items = (v._items || []).filter((i) => kind === "all" || i.kind === kind);
    $("feed").innerHTML = items.length ? items.map((i) => `
      <article class="news ${i.kind}">
        <header><span class="n-kind">${i.kind === "site" ? "Le site" : "Nouveaux moteurs"}</span><time>${when(String(i.at).length === 10 ? i.at + " 12:00:00" : i.at)}</time></header>
        <h2>${esc(i.title)}</h2>
        ${i.body ? `<p>${esc(i.body).replace(/\n/g, "<br>")}</p>` : ""}
        ${i.refs?.length ? `<div class="n-motors">${i.refs.slice(0, 12).map((r) => { const m = motorBy(r); return m ? `<a class="n-motor" href="#m/${encodeURIComponent(r)}">${MM().photo(m)}<span>${esc(m.MARQUE)} ${esc(m.NOM || "")}<small>${esc(m.CLASSE || "")} · ${esc(m.KV || "")}KV</small></span></a>` : ""; }).join("")}${i.refs.length > 12 ? `<span class="note">et ${i.refs.length - 12} autres</span>` : ""}</div>` : ""}
      </article>`).join("") : `<p class="note">Aucune actualité pour l'instant.</p>`;
  }

  // ----------------------------------------------------------------- admin
  async function renderAdmin(tab = "suggestions", status = "pending") {
    const v = $("view-admin");
    v.hidden = false;
    if (!isMod()) {
      v.innerHTML = `<div class="page"><h1 class="page-title">Administration</h1><p class="note">Connectez-vous avec un compte de modération.</p><p class="note"><button class="btn-dark" data-login>Connexion</button></p></div>`;
      return;
    }
    const stats = await get("admin_stats").catch(() => ({}));
    const tabs = [["suggestions", "Suggestions", stats.pending], ["comments", "Commentaires"], ["users", "Membres", stats.users], ["news", "Actualités"]];
    v.innerHTML = `<div class="page"><h1 class="page-title">Administration</h1>
      <div class="stats">${[["Suggestions en attente", stats.pending], ["Membres", stats.users], ["Commentaires", stats.comments], ["J'aime", stats.likes]].map(([l, n]) => `<div class="stat"><b>${n ?? "—"}</b><span>${l}</span></div>`).join("")}</div>
      <div class="chips">${tabs.map(([k, l, n]) => `<button class="tab" data-admin-tab="${k}" aria-selected="${k === tab}">${l}${n ? ` (${n})` : ""}</button>`).join("")}</div>
      <div id="admin-body"><p class="note">Chargement…</p></div></div>`;
    const body = $("admin-body");
    try {
      if (tab === "suggestions") {
        const rows = await get("admin_suggestions", { status });
        body.innerHTML = `<div class="chips small">${[["pending", "En attente"], ["approved", "Validées"], ["rejected", "Refusées"]].map(([k, l]) => `<button class="tab" data-admin-status="${k}" aria-selected="${k === status}">${l}</button>`).join("")}</div>` +
          (rows.length ? rows.map((s) => `
          <article class="adm-card" data-sid="${s.id}">
            <header><a href="#m/${encodeURIComponent(s.ref)}">${esc(motorName(s.ref))}</a><time>${when(s.created_at)}</time></header>
            <div class="adm-change"><span class="lbl">${esc(FIELD_LABELS[s.field] || s.field)}</span>
              <span class="old">${esc(s.old_value || "vide")}</span><span aria-hidden="true">→</span>
              ${status === "pending" ? `<input class="new" value="${esc(s.new_value)}" aria-label="Valeur à valider">` : `<b class="new">${esc(s.new_value)}</b>`}</div>
            ${s.source ? `<p class="adm-src">Source : <a href="${esc(s.source)}" target="_blank" rel="noopener nofollow">${esc(s.source)}</a></p>` : ""}
            ${s.note ? `<p class="adm-note">« ${esc(s.note)} »</p>` : ""}
            <footer><span>Proposé par <b>${esc(s.author)}</b>${s.reviewer ? ` · traité par ${esc(s.reviewer)}` : ""}</span>
              ${status === "pending" ? `<button class="btn-dark" data-decide="rejected">Refuser</button><button class="btn-red" data-decide="approved">Valider</button>` : ""}</footer>
          </article>`).join("") : `<p class="note">Rien à traiter.</p>`);
      } else if (tab === "comments") {
        const rows = await get("admin_comments");
        body.innerHTML = rows.length ? rows.map((c) => `
          <article class="adm-card ${c.status === "hidden" ? "hidden-c" : ""}">
            <header><a href="#m/${encodeURIComponent(c.ref)}">${esc(motorName(c.ref))}</a><time>${when(c.created_at)}</time></header>
            <p>${esc(c.body)}</p>
            <footer><span>par <b>${esc(c.author)}</b>${c.status === "hidden" ? " · masqué" : ""}</span>
              ${c.status === "hidden" ? `<button class="btn-dark" data-cmod="${c.id}" data-status="visible">Rétablir</button>` : `<button class="btn-dark" data-cmod="${c.id}" data-status="hidden">Masquer</button>`}
              <button class="btn-red" data-cmod="${c.id}" data-status="deleted">Supprimer</button></footer>
          </article>`).join("") : `<p class="note">Aucun commentaire.</p>`;
      } else if (tab === "users") {
        const rows = await get("admin_users");
        const admin = C.user.role === "admin";
        body.innerHTML = `<div class="tbl-wrap"><table class="adm-table"><thead><tr><th>Pseudo</th><th>Email</th><th>Rôle</th><th>État</th><th>Inscrit le</th></tr></thead><tbody>${rows.map((u) => `
          <tr data-uid="${u.id}"><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
            <td>${admin && u.id !== C.user.id ? `<select data-role>${["user", "moderator", "admin"].map((r) => `<option value="${r}" ${r === u.role ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("")}</select>` : ROLE_LABEL[u.role]}</td>
            <td>${+u.banned ? "Suspendu" : +u.verified ? "Actif" : "Email non confirmé"} ${admin && u.id !== C.user.id ? `<button class="mini" data-ban="${+u.banned ? 0 : 1}">${+u.banned ? "Réactiver" : "Suspendre"}</button>` : ""}</td>
            <td>${when(u.created_at)}</td></tr>`).join("")}</tbody></table></div>`;
      } else if (tab === "news") {
        const rows = await get("admin_news");
        body.innerHTML = `<form class="m-form news-form" data-news-form><input type="hidden" name="id" value="">
            <label>Titre<input name="title" required maxlength="160"></label>
            <label>Texte<textarea name="body" rows="4" required maxlength="5000"></textarea></label>
            <label class="inline"><input type="checkbox" name="published" checked> Publier</label>
            <button class="btn-red" type="submit">Enregistrer l'actualité</button></form>` +
          rows.map((n) => `<article class="adm-card"><header><b>${esc(n.title)}</b><time>${when(n.created_at)}</time></header><p>${esc(n.body)}</p>
            <footer><span>${+n.published ? "Publiée" : "Brouillon"}</span><button class="btn-dark" data-news-edit='${esc(JSON.stringify(n))}'>Modifier</button><button class="btn-red" data-news-del="${n.id}">Supprimer</button></footer></article>`).join("");
      }
    } catch (e) { body.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
    v.dataset.tab = tab; v.dataset.status = status;
  }

  // ---------------------------------------------------------------- profiles
  const COLORS = ["#111111", "#ff5757", "#ff9f1c", "#2ec4b6", "#3a86ff", "#8338ec", "#06a77d", "#e63973"];
  const FLYING = ["Racing", "Freestyle", "Long Range", "Cinematic", "Cinewhoop", "Toothpick", "Whoop", "Aile volante", "Avion", "Hélicoptère"];
  // Photo, or initials on the member's colour (a colour derived from the name when none was chosen)
  function avatar(u, size = "md") {
    const name = (u && u.name) || "?";
    const color = (u && u.color) || COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
    const src = u && u.avatar && (/^api\/index\.php\?action=avatar&id=\d+&v=\d+$/.test(u.avatar) || /^data:image\/(png|jpeg|webp);base64,/.test(u.avatar)) ? u.avatar : "";
    const ini = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    return src ? `<span class="av av-${size}"><img src="${esc(src)}" alt=""></span>`
      : `<span class="av av-${size}" style="--av:${esc(color)}" aria-hidden="true">${esc(ini)}</span>`;
  }
  const PICON = {
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
    yt: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
    ig: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".8" fill="currentColor"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    fly: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8 8l8 8M16 8l-8 8"/></svg>',
  };
  // Badges earned from what the member did on the site
  function badges(p) {
    const b = [], s = p.stats || {};
    if (p.role === "admin") b.push(["Administrateur", "gold"]); else if (p.role === "moderator") b.push(["Modérateur", "gold"]);
    if (s.approved >= 10) b.push(["Expert catalogue", "gold"]); else if (s.approved >= 1) b.push(["Contributeur", "blue"]);
    if (s.comments >= 10) b.push(["Pilote bavard", "green"]); else if (s.comments >= 1) b.push(["A donné son avis", "green"]);
    if ((p.setup || []).length) b.push(["Setup partagé", "purple"]);
    if (s.likes >= 20) b.push(["Collectionneur", "red"]);
    const days = p.since ? (Date.now() - new Date(p.since.replace(" ", "T") + "Z")) / 864e5 : 0;
    if (days > 365) b.push(["Membre depuis plus d'un an", "grey"]);
    return b;
  }
  const motorCard = (ref) => {
    const m = motorBy(ref);
    if (!m) return "";
    return `<a class="pm-card" href="#m/${encodeURIComponent(m.REF)}"><span class="pm-img">${MM().photo(m)}</span>
      <span class="pm-brand">${MM().brandMark(m)}</span><b>${esc(m.NOM || m.REF)}</b><small>${[m.CLASSE, m.KV ? `${m.KV} KV` : ""].filter(Boolean).map(esc).join(" · ")}</small></a>`;
  };

  async function renderProfile(id) {
    const v = $("view-profile");
    v.hidden = false;
    v.innerHTML = `<div class="pf-wrap"><p class="note">Chargement du profil…</p></div>`;
    if (!C.online && !DEMO) { v.innerHTML = `<div class="pf-wrap"><p class="note">Les profils seront disponibles dès que le serveur du site sera configuré.</p></div>`; return; }
    let p;
    try { p = await get("profile", { id }); } catch (e) { v.innerHTML = `<div class="pf-wrap"><p class="note">${esc(e.message)}</p><p><a class="ghost-btn" href="#">Retour au catalogue</a></p></div>`; return; }
    document.title = `${p.name} — Multi-Motors`;
    const color = p.color || COLORS[[...p.name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
    const since = p.since ? new Date(p.since.replace(" ", "T") + "Z").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "";
    const link = (url, icon, label) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener nofollow ugc" class="pf-link">${PICON[icon]}<span>${esc(label)}</span></a>` : "";
    const head = `
      <header class="pf-head" style="--pf:${esc(color)}">
        <div class="pf-banner"></div>
        <div class="pf-id">
          ${avatar(p, "xl")}
          <div class="pf-name"><h1>${esc(p.name)}</h1>${p.role !== "user" ? `<em class="pf-role">${ROLE_LABEL[p.role]}</em>` : ""}
            <p class="pf-meta">${since ? `<span>${PICON.cal}Membre depuis ${esc(since)}</span>` : ""}${p.location ? `<span>${PICON.pin}${esc(p.location)}</span>` : ""}${p.flying ? `<span>${PICON.fly}${esc(p.flying)}</span>` : ""}</p></div>
          ${p.mine ? `<a class="btn-dark pf-edit" href="#profil">Modifier mon profil</a>` : ""}
        </div>
      </header>`;
    if (p.private) { v.innerHTML = `<div class="pf-wrap">${head}<section class="card"><p class="note">Ce profil est privé.</p></section></div>`; return; }
    const s = p.stats || {};
    v.innerHTML = `<div class="pf-wrap">${head}
      <div class="pf-grid">
        <aside class="pf-side">
          <section class="card pf-about">
            ${p.bio ? `<p class="pf-bio">${esc(p.bio).replace(/\n/g, "<br>")}</p>` : `<p class="note">${p.mine ? "Ajoutez une courte présentation depuis « Modifier mon profil »." : "Pas encore de présentation."}</p>`}
            <div class="pf-links">${link(p.website, "web", p.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}${link(p.youtube, "yt", "YouTube")}${link(p.instagram, "ig", "Instagram")}</div>
          </section>
          <section class="card pf-stats">
            <div><b>${s.comments || 0}</b><span>avis</span></div>
            <div><b>${s.approved || 0}</b><span>corrections validées</span></div>
            <div><b>${s.likes || 0}</b><span>j'aime</span></div>
          </section>
          ${badges(p).length ? `<section class="card"><h3 class="pf-h">Badges</h3><div class="pf-badges">${badges(p).map(([t, c]) => `<span class="pf-badge b-${c}">${esc(t)}</span>`).join("")}</div></section>` : ""}
        </aside>
        <div class="pf-main">
          <section class="card"><h3 class="pf-h">Mon setup <small>${(p.setup || []).length} moteur${(p.setup || []).length > 1 ? "s" : ""}</small></h3>
            ${(p.setup || []).length ? `<div class="pm-grid">${p.setup.map(motorCard).join("")}</div>` : `<p class="note">${p.mine ? "Ajoutez les moteurs que vous utilisez depuis « Modifier mon profil »." : "Aucun moteur partagé pour l'instant."}</p>`}</section>
          ${p.likes && p.likes.length ? `<section class="card"><h3 class="pf-h">Moteurs aimés <small>${p.likes.length}</small></h3><div class="pm-grid small">${p.likes.map(motorCard).join("")}</div></section>` : ""}
          <section class="card"><h3 class="pf-h">Derniers avis</h3>
            ${(p.comments || []).length ? `<div class="pf-comments">${p.comments.map((c) => `<a class="pf-c" href="#m/${encodeURIComponent(c.ref)}"><span class="pf-c-m">${esc(motorName(c.ref))}</span><p>${esc(c.body.length > 220 ? c.body.slice(0, 220) + "…" : c.body)}</p><time>${when(c.at)}</time></a>`).join("")}</div>`
              : `<p class="note">Pas encore d'avis publié.</p>`}</section>
        </div>
      </div></div>`;
  }

  // Edit page: profile, account and privacy
  const P = { tab: "profil", setup: [], avatar: undefined, color: "" };
  async function renderProfileEdit(tab) {
    const v = $("view-profile");
    v.hidden = false;
    if (!C.user) { v.innerHTML = `<div class="pf-wrap"><section class="card"><p class="note">Connectez-vous pour modifier votre profil.</p><p><button type="button" class="btn-dark" data-login>Connexion</button></p></section></div>`; return; }
    if (tab) P.tab = tab;
    let p = {};
    try { p = await get("profile", { id: C.user.id }); } catch (e) { /* profile not created yet */ }
    P.setup = [...(p.setup || [])]; P.avatar = undefined; P.color = p.color || "";
    const tabs = [["profil", "Profil"], ["compte", "Compte"], ["confidentialite", "Confidentialité"]];
    const sel = (a, b) => (a === b ? " selected" : "");
    v.innerHTML = `<div class="pf-wrap pf-editor">
      <div class="pf-edit-top"><h1>Mon profil</h1><a class="ghost-btn" href="#u/${C.user.id}">Voir mon profil public →</a></div>
      <div class="pf-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-pf-tab="${k}" aria-selected="${P.tab === k}">${l}</button>`).join("")}</div>

      <form class="card pf-form" data-pf="profil" ${P.tab === "profil" ? "" : "hidden"}>
        <div class="pf-av-edit">
          <span id="pf-av-prev">${avatar({ ...C.user, color: P.color, avatar: C.user.avatar }, "xl")}</span>
          <div>
            <p class="pf-label">Photo de profil</p>
            <label class="btn-dark pf-file">Choisir une image<input type="file" id="pf-file" accept="image/png,image/jpeg,image/webp" hidden></label>
            <button type="button" class="ghost-btn" data-pf-noavatar>Retirer la photo</button>
            <p class="pf-hint">PNG, JPEG ou WebP. Recadrée en carré et réduite automatiquement.</p>
            <p class="pf-label">Couleur</p>
            <div class="pf-colors">${COLORS.map((c) => `<button type="button" class="pf-color" data-pf-color="${c}" style="--c:${c}" aria-label="Couleur ${c}" aria-pressed="${P.color === c}"></button>`).join("")}</div>
          </div>
        </div>
        <label>Présentation <span class="pf-count" data-for="bio">${(p.bio || "").length}/280</span><textarea name="bio" maxlength="280" rows="3" placeholder="Pilote FPV depuis 2019, freestyle et long range…">${esc(p.bio || "")}</textarea></label>
        <div class="pf-2">
          <label>Localisation<input name="location" maxlength="60" value="${esc(p.location || "")}" placeholder="Lyon, France"></label>
          <label>Type de vol préféré<select name="flying"><option value="">—</option>${FLYING.map((f) => `<option${sel(p.flying, f)}>${esc(f)}</option>`).join("")}</select></label>
        </div>
        <div class="pf-3">
          <label>Site web<input name="website" inputmode="url" maxlength="200" value="${esc(p.website || "")}" placeholder="monsite.fr"></label>
          <label>YouTube<input name="youtube" inputmode="url" maxlength="200" value="${esc(p.youtube || "")}" placeholder="youtube.com/@pseudo"></label>
          <label>Instagram<input name="instagram" inputmode="url" maxlength="200" value="${esc(p.instagram || "")}" placeholder="instagram.com/pseudo"></label>
        </div>
        <div class="pf-setup-edit">
          <p class="pf-label">Mon setup <small>(8 moteurs au maximum)</small></p>
          <div class="pf-setup-chips" id="pf-setup"></div>
          <div class="pf-search"><input id="pf-motor-q" type="search" placeholder="Ajouter un moteur : marque, modèle, classe…" autocomplete="off"><div class="pf-results" id="pf-results" hidden></div></div>
        </div>
        <p class="m-error" role="alert" hidden></p>
        <div class="pf-actions"><button class="btn-red" type="submit">Enregistrer le profil</button></div>
      </form>

      <form class="card pf-form" data-pf="compte" ${P.tab === "compte" ? "" : "hidden"} autocomplete="off">
        <div class="pf-2">
          <label>Pseudo<input name="name" minlength="2" maxlength="40" value="${esc(C.user.name)}" required></label>
          <label>Adresse email<input name="email" type="email" maxlength="190" value="${esc(C.user.email || "")}" required></label>
        </div>
        <div class="pf-2">
          <label>Nouveau mot de passe<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Laisser vide pour ne pas changer"></label>
          <label>Confirmer le nouveau mot de passe<input name="password2" type="password" minlength="8" autocomplete="new-password"></label>
        </div>
        <label>Mot de passe actuel <small>(obligatoire pour changer d'email ou de mot de passe)</small><input name="current" type="password" autocomplete="current-password"></label>
        <p class="m-error" role="alert" hidden></p>
        <div class="pf-actions"><button class="btn-red" type="submit">Enregistrer</button></div>
      </form>
      <form class="card pf-form pf-danger" data-pf="supprimer" ${P.tab === "compte" ? "" : "hidden"}>
        <h3 class="pf-h">Supprimer mon compte</h3>
        <p class="pf-hint">Vos « j'aime », votre profil et vos commentaires sont supprimés. Les corrections déjà validées restent dans le catalogue, sans votre nom. C'est définitif.</p>
        <div class="pf-2">
          <label>Tapez SUPPRIMER<input name="confirm" autocomplete="off" pattern="SUPPRIMER" required></label>
          <label>Mot de passe actuel<input name="current" type="password" autocomplete="current-password"></label>
        </div>
        <p class="m-error" role="alert" hidden></p>
        <div class="pf-actions"><button class="btn-danger" type="submit">Supprimer définitivement</button></div>
      </form>

      <form class="card pf-form" data-pf="confidentialite" ${P.tab === "confidentialite" ? "" : "hidden"}>
        <label class="pf-toggle"><input type="checkbox" name="is_public" ${p.is_public === false ? "" : "checked"}><span><b>Profil public</b><small>Visible par tous les visiteurs. Décoché, seuls vous et la modération le voyez.</small></span></label>
        <label class="pf-toggle"><input type="checkbox" name="show_likes" ${p.show_likes === false ? "" : "checked"}><span><b>Afficher mes « j'aime »</b><small>Les moteurs que vous avez aimés apparaissent sur votre profil.</small></span></label>
        <p class="m-error" role="alert" hidden></p>
        <div class="pf-actions"><button class="btn-red" type="submit">Enregistrer</button></div>
      </form>
    </div>`;
    P.profile = p;
    drawSetup();
  }
  function drawSetup() {
    const el = $("pf-setup");
    if (!el) return;
    el.innerHTML = P.setup.length ? P.setup.map((r) => `<span class="pf-chip">${esc(motorName(r))}<button type="button" data-pf-rm="${esc(r)}" aria-label="Retirer">✕</button></span>`).join("")
      : `<span class="pf-hint">Aucun moteur pour l'instant.</span>`;
  }
  function searchMotors(qv) {
    const box = $("pf-results");
    const words = qv.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { box.hidden = true; return; }
    const seen = new Set(), hits = [];
    for (const m of MM().state.motors) {
      const hay = `${m.MARQUE} ${m.NOM} ${m.CLASSE} ${m.KV}KV`.toLowerCase();
      if (words.every((w) => hay.includes(w)) && !seen.has(m.REF)) { seen.add(m.REF); hits.push(m); if (hits.length >= 8) break; }
    }
    box.innerHTML = hits.length ? hits.map((m) => `<button type="button" data-pf-add="${esc(m.REF)}">${MM().brandMark(m)}<span>${esc(m.NOM || m.REF)}${m.KV ? ` · ${esc(m.KV)} KV` : ""}</span></button>`).join("") : `<p class="pf-hint">Aucun moteur trouvé.</p>`;
    box.hidden = false;
  }
  // Square crop, 256 px, WebP (JPEG where WebP is not supported)
  function readAvatar(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error("Image refusée : PNG, JPEG ou WebP uniquement."));
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const side = Math.min(img.width, img.height), c = document.createElement("canvas");
        c.width = c.height = 256;
        c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
        URL.revokeObjectURL(url);
        let d = c.toDataURL("image/webp", 0.85);
        if (!d.startsWith("data:image/webp")) d = c.toDataURL("image/jpeg", 0.85);
        resolve(d);
      };
      img.onerror = () => reject(new Error("Image illisible."));
      img.src = url;
    });
  }
  const refreshAvatarPreview = () => {
    const prev = $("pf-av-prev");
    if (prev) prev.innerHTML = avatar({ ...C.user, color: P.color, avatar: P.avatar === undefined ? C.user.avatar : P.avatar }, "xl");
  };

  // ---------------------------------------------------------------- routing
  hooks.route = (h) => {
    ["view-actus", "view-admin", "view-profile"].forEach((id) => ($(id).hidden = true));
    if (/^#u\/\d+$/.test(h)) { renderProfile(+h.slice(3)); window.scrollTo(0, 0); return true; }
    if (/^#profil(\/\w+)?$/.test(h)) { renderProfileEdit(h.split("/")[1]); window.scrollTo(0, 0); return true; }
    if (h === "#actus") { renderActus(); window.scrollTo(0, 0); return true; }
    if (h === "#admin") { renderAdmin(); window.scrollTo(0, 0); return true; }
    if (h.startsWith("#reset/")) {
      const tok = h.slice(7);
      modal(`<h2 class="m-title">Nouveau mot de passe</h2><form class="m-form" data-reset="${esc(tok)}">
        <label>Nouveau mot de passe<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <p class="m-error" role="alert" hidden></p><button class="btn-red" type="submit">Enregistrer</button></form>`);
      history.replaceState(null, "", "#");
      return false;
    }
    if (h === "#compte-confirme") { toast("Adresse confirmée, bienvenue !", "good"); history.replaceState(null, "", "#"); }
    if (h === "#lien-invalide") { toast("Ce lien n'est plus valable.", "bad"); history.replaceState(null, "", "#"); }
    return false;
  };
  function refreshCurrent() {
    if (location.hash === "#admin") return renderAdmin();
    if (/^#(u\/\d+|profil)/.test(location.hash)) return hooks.route(location.hash);
    if (location.hash.startsWith("#m/")) MM().rerender();
  }

  // ----------------------------------------------------------------- events
  const formData = (f) => Object.fromEntries(new FormData(f).entries());
  const showErr = (f, msg) => { const e = f.querySelector(".m-error"); if (e) { e.textContent = msg; e.hidden = false; } else toast(msg, "bad"); };

  document.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (t.closest(".m-close")) return closeModal();
    if (t.closest("[data-login]")) return authForm("login");
    const at = t.closest("[data-auth-tab]"); if (at) return authForm(at.dataset.authTab);
    const ab = t.closest(".acct-btn");
    if (ab) { const menu = ab.nextElementSibling; menu.hidden = !menu.hidden; ab.setAttribute("aria-expanded", String(!menu.hidden)); return; }
    if (!t.closest(".acct-menu")) document.querySelectorAll(".acct-menu").forEach((m) => (m.hidden = true));
    if (t.closest("[data-logout]")) { await api("logout", {}); C.user = null; renderAccount(); toast("Vous êtes déconnecté."); return refreshCurrent(); }
    const lk = t.closest("[data-like]");
    if (lk) {
      if (!C.user) return authForm("login");
      try {
        const r = await api("like", { ref: lk.dataset.like });
        lk.querySelector("b").textContent = r.likes;
        lk.setAttribute("aria-pressed", String(r.liked));
        lk.classList.remove("pop"); void lk.offsetWidth; lk.classList.add("pop");
        C.likes[lk.dataset.like] = r.likes;
      } catch (e) { toast(e.message, "bad"); }
      return;
    }
    const sg = t.closest("[data-suggest]"); if (sg) return suggestForm(sg.dataset.suggest);
    const cd = t.closest("[data-cdel]");
    if (cd) { try { await api("comment_delete", { id: cd.dataset.cdel }); loadSocial($("detail").dataset.ref); } catch (e) { toast(e.message, "bad"); } return; }
    const cm = t.closest("[data-cmod]");
    if (cm) {
      try { await api("moderate_comment", { id: cm.dataset.cmod, status: cm.dataset.status }); toast("Commentaire mis à jour.", "good"); }
      catch (e) { toast(e.message, "bad"); }
      return location.hash === "#admin" ? renderAdmin("comments") : loadSocial($("detail").dataset.ref);
    }
    const pt = t.closest("[data-pf-tab]");
    if (pt) {
      P.tab = pt.dataset.pfTab;
      document.querySelectorAll("[data-pf-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === pt)));
      document.querySelectorAll("[data-pf]").forEach((f) => (f.hidden = !(f.dataset.pf === P.tab || (P.tab === "compte" && f.dataset.pf === "supprimer"))));
      return;
    }
    const pc = t.closest("[data-pf-color]");
    if (pc) { P.color = pc.dataset.pfColor; document.querySelectorAll("[data-pf-color]").forEach((b) => b.setAttribute("aria-pressed", String(b === pc))); return refreshAvatarPreview(); }
    if (t.closest("[data-pf-noavatar]")) { P.avatar = ""; return refreshAvatarPreview(); }
    const pa = t.closest("[data-pf-add]");
    if (pa) {
      if (P.setup.length >= 8) return toast("8 moteurs au maximum dans votre setup.", "bad");
      if (!P.setup.includes(pa.dataset.pfAdd)) P.setup.push(pa.dataset.pfAdd);
      $("pf-motor-q").value = ""; $("pf-results").hidden = true; return drawSetup();
    }
    const pr = t.closest("[data-pf-rm]"); if (pr) { P.setup = P.setup.filter((r) => r !== pr.dataset.pfRm); return drawSetup(); }
    if (!t.closest(".pf-search") && $("pf-results")) $("pf-results").hidden = true;
    const tb = t.closest("[data-admin-tab]"); if (tb) return renderAdmin(tb.dataset.adminTab);
    const st = t.closest("[data-admin-status]"); if (st) return renderAdmin("suggestions", st.dataset.adminStatus);
    const dc = t.closest("[data-decide]");
    if (dc) {
      const card = dc.closest("[data-sid]");
      try {
        await api("moderate_suggestion", { id: card.dataset.sid, decision: dc.dataset.decide, value: card.querySelector("input.new")?.value || "" });
        if (dc.dataset.decide === "approved") { C.overrides = await get("overrides"); applyOverrides(); }
        card.classList.add("done");
        toast(dc.dataset.decide === "approved" ? "Modification validée et appliquée." : "Suggestion refusée.", "good");
        setTimeout(() => renderAdmin("suggestions", "pending"), 350);
      } catch (e) { toast(e.message, "bad"); }
      return;
    }
    const bn = t.closest("[data-ban]");
    if (bn) { try { await api("user_update", { id: bn.closest("tr").dataset.uid, banned: bn.dataset.ban }); renderAdmin("users"); } catch (e) { toast(e.message, "bad"); } return; }
    const ne = t.closest("[data-news-edit]");
    if (ne) {
      const n = JSON.parse(ne.dataset.newsEdit), f = document.querySelector("[data-news-form]");
      f.id.value = n.id; f.title.value = n.title; f.body.value = n.body; f.published.checked = !!+n.published;
      f.scrollIntoView({ behavior: "smooth" }); return;
    }
    const nd = t.closest("[data-news-del]");
    if (nd) { try { await api("news_delete", { id: nd.dataset.newsDel }); renderAdmin("news"); } catch (e) { toast(e.message, "bad"); } return; }
    const af = t.closest("[data-actus]");
    if (af) { document.querySelectorAll("[data-actus]").forEach((b) => b.setAttribute("aria-selected", String(b === af))); drawFeed(af.dataset.actus); }
  });

  document.addEventListener("input", (ev) => {
    if (ev.target.id === "pf-motor-q") searchMotors(ev.target.value);
    if (ev.target.name === "bio" && ev.target.closest("[data-pf]")) document.querySelector('.pf-count[data-for="bio"]').textContent = `${ev.target.value.length}/280`;
  });
  document.addEventListener("change", async (ev) => {
    if (ev.target.id === "pf-file" && ev.target.files[0]) {
      try { P.avatar = await readAvatar(ev.target.files[0]); refreshAvatarPreview(); } catch (e) { toast(e.message, "bad"); }
      ev.target.value = "";
      return;
    }
    const r = ev.target.closest("[data-role]");
    if (r) { try { await api("user_update", { id: r.closest("tr").dataset.uid, role: r.value }); toast("Rôle modifié.", "good"); } catch (e) { toast(e.message, "bad"); } }
  });

  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    if (!f.matches("[data-auth], [data-suggest-form], [data-comment], [data-reset], [data-news-form], [data-pf]")) return;
    ev.preventDefault();
    const d = formData(f);
    const btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      if (f.dataset.auth) {
        const r = await api(f.dataset.auth === "forgot" ? "forgot" : f.dataset.auth, d);
        if (f.dataset.auth === "forgot") { closeModal(); toast(r.message, "good"); }
        else { C.user = r.user; afterLogin(r.message); }
      } else if (f.dataset.suggestForm) {
        const m = motorBy(f.dataset.suggestForm);
        const r = await api("suggest", { ...d, ref: f.dataset.suggestForm, old: m ? m[d.field] || "" : "" });
        closeModal(); toast(r.message, "good");
      } else if (f.dataset.comment) {
        await api("comment", { ref: f.dataset.comment, body: d.body });
        toast("Commentaire publié.", "good");
        loadSocial(f.dataset.comment);
      } else if (f.dataset.reset) {
        const r = await api("reset", { token: f.dataset.reset, password: d.password });
        C.user = r.user; afterLogin(r.message);
      } else if (f.dataset.pf) {
        const p = P.profile || {};
        let r;
        if (f.dataset.pf === "compte") {
          if (d.password && d.password !== d.password2) throw new Error("Les deux nouveaux mots de passe ne correspondent pas.");
          r = await api("account_update", { name: d.name, email: d.email, password: d.password, current: d.current });
          f.password.value = f.password2.value = f.current.value = "";
        } else if (f.dataset.pf === "supprimer") {
          r = await api("account_delete", { confirm: d.confirm, current: d.current });
          C.user = null; renderAccount(); toast(r.message, "good"); location.hash = "#"; return;
        } else {
          // Profile and privacy are saved together: each form sends the other one's current values
          const src = f.dataset.pf === "profil" ? d : { bio: p.bio, location: p.location, flying: p.flying, website: p.website, youtube: p.youtube, instagram: p.instagram };
          const priv = f.dataset.pf === "confidentialite" ? { is_public: f.is_public.checked ? "1" : "0", show_likes: f.show_likes.checked ? "1" : "0" }
            : { is_public: p.is_public === false ? "0" : "1", show_likes: p.show_likes === false ? "0" : "1" };
          const payload = { ...src, ...priv, color: P.color, setup: P.setup };
          if (P.avatar !== undefined && f.dataset.pf === "profil") payload.avatar = P.avatar;
          r = await api("profile_save", payload);
          P.profile = { ...p, ...src, is_public: priv.is_public !== "0", show_likes: priv.show_likes !== "0", color: P.color, setup: P.setup };
          P.avatar = undefined;
        }
        if (r.user) { C.user = r.user; renderAccount(); refreshAvatarPreview(); }
        toast(r.message, "good");
      } else if (f.matches("[data-news-form]")) {
        await api("news_save", { id: d.id, title: d.title, body: d.body, published: f.published.checked ? "1" : "0" });
        toast("Actualité enregistrée.", "good");
        renderAdmin("news");
      }
    } catch (e) { showErr(f, e.message); }
    finally { btn.disabled = false; }
  });
})();
