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
  const C = { user: null, googleId: "", likes: {}, overrides: {}, prices: {}, actus: [], online: false, site: { roles: {}, coupons: [] } };
  const FIELD_LABELS = {
    NOM: "Nom du modèle", VERSION: "Version", CLASSE: "Classe (stator)", KV: "KV", POIDS: "Poids (g)",
    "D MOTEUR": "Diamètre moteur (mm)", "H MOTEUR": "Hauteur moteur (mm)", "D SHAFT": "Diamètre shaft (mm)",
    "L SHAFT": "Longueur shaft (mm)", "TYPE SHAFT": "Type de shaft", "VIS HEL": "Fixation hélice", "VIS FIX": "Vis de fixation",
    "ENTRAXE FIX": "Entraxe de fixation", LIPO: "LiPo (ex. 4S-6S)", "L CABLE": "Longueur câble", "TYPE CABLE": "Section câble (AWG)",
    HELICE: "Hélice recommandée", PUISSANCE: "Puissance max (W)", AMP: "Courant max (A)", AIMANT: "Aimants", CLOCHE: "Cloche",
    CONFIG: "Configuration (ex. 12N14P)", RESISTANCE: "Résistance", UTILISATION: "Utilisation", LIEN: "Lien (fabricant ou boutique)",
    IMG: "Photo (lien)", AUTRE: "Autre remarque",
  };
  const ROLE_LABEL = { user: "Membre", moderator: "Modération", admin: "Admin" };
  // Role names come from the server (roles created in the administration)
  const roleLabel = (slug) => (C.site.roles || {})[slug]?.label || ROLE_LABEL[slug] || slug;
  const can = (perm) => !!(C.user && (C.user.perms || []).includes(perm));

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
  const DEMO_PERMS = { suggestions: "Valider ou refuser les corrections proposées", comments: "Modérer les avis (masquer, supprimer)", bugs: "Traiter les signalements de bug",
    news: "Publier et modifier les actualités", coupons: "Créer et gérer les codes promo", members: "Voir les membres et les profils privés", ban: "Suspendre ou réactiver des membres",
    assign: "Changer le rôle et les permissions des membres", roles: "Créer et modifier les rôles", partners: "Gérer les boutiques partenaires (liens affiliés) et voir les clics", settings: "Modifier les réglages du site (bandeau, inscriptions, avis)", logs: "Consulter le journal d'activité" };
  const D = { users: [], me: null, likes: {}, comments: [], sugg: [], news: [], profiles: {}, garage: {}, history: {}, id: 1, coupons: [], log: [], settings: { registrations: "1", comments: "1", announce_kind: "info" },
    roles: [{ slug: "user", label: "Membre", color: "#888888", perms: [] }, { slug: "moderator", label: "Modération", color: "#3a86ff", perms: ["suggestions", "comments", "bugs", "news", "members"] }, { slug: "admin", label: "Admin", color: "#ff5757", perms: Object.keys(DEMO_PERMS) }] };
  function demoApi(action, d) {
    const q = d.__get || d;
    const me = D.me;
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const need = () => { if (!me) throw new Error("Connectez-vous pour faire cela."); };
    const permsOf = (u) => u.role === "admin" ? Object.keys(DEMO_PERMS) : (D.roles.find((r) => r.slug === u.role)?.perms || []);
    const mod = () => { need(); if (!permsOf(me).length) throw new Error("Réservé à l'équipe du site."); };
    const pub = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, verified: true, perms: permsOf(u), color: D.profiles[u.id]?.color || "", avatar: D.profiles[u.id]?.avatar || "" };
    const today = now.slice(0, 10);
    const site = () => ({ registrations: true, comments: true, roles: Object.fromEntries(D.roles.map((r) => [r.slug, { label: r.label, color: r.color }])),
      announce: D.settings.announce_on === "1" && D.settings.announce_text ? { text: D.settings.announce_text, link: D.settings.announce_link, kind: D.settings.announce_kind } : null,
      partners: (D.partners || []).filter((p) => +p.active),
      coupons: D.coupons.filter((c) => +c.active && (!c.starts || c.starts <= today) && (!c.ends || c.ends >= today)) });
    const log = (action, target, detail = "") => D.log.unshift({ id: D.id++, who: me.name, action, target, detail, created_at: now });
    switch (action) {
      case "me": return { user: pub(me), google_client_id: "", site: site() };
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
          ...(() => {
            const rated = D.comments.filter((c) => c.ref === q.ref && c.status === "visible" && c.rating).map((c) => c.rating);
            const g = { owned: 0, tested: 0, wanted: 0 };
            Object.values(D.garage).forEach((mine) => mine[q.ref] && g[mine[q.ref].status]++);
            return { rating: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null, ratings: rated.length, garage: g, mine: me ? (D.garage[me.id] || {})[q.ref] || null : null };
          })(),
        };
      }
      case "like": { need(); const s = (D.likes[d.ref] = D.likes[d.ref] || new Set()); s.has(me.id) ? s.delete(me.id) : s.add(me.id); return { liked: s.has(me.id), likes: s.size }; }
      case "comment": need(); if ((d.body || "").length < 3 && !d.pros && !d.cons) throw new Error("Votre avis est vide."); D.comments.push({ id: D.id++, ref: d.ref, user_id: me.id, body: d.body || "", rating: +d.rating || null, pros: d.pros || "", cons: d.cons || "", status: "visible", at: now }); return { ok: true };
      case "garage_set": { need(); const g = (D.garage[me.id] = D.garage[me.id] || {}); if (!d.status) { delete g[d.ref]; return { mine: null }; } g[d.ref] = { status: d.status, note: d.note || "", at: now }; return { mine: g[d.ref] }; }
      case "view": { if (!me) return { ok: false }; const h = (D.history[me.id] = (D.history[me.id] || []).filter((x) => x.ref !== d.ref)); h.unshift({ ref: d.ref, at: now }); h.length = Math.min(h.length, 60); return { ok: true }; }
      case "history_clear": need(); D.history[me.id] = []; return { ok: true };
      case "my_space": need(); return {
        history: D.history[me.id] || [], likes: Object.entries(D.likes).filter(([, st]) => st.has(me.id)).map(([r]) => r),
        garage: Object.entries(D.garage[me.id] || {}).map(([ref, g]) => ({ ref, ...g })),
        reviews: D.comments.filter((c) => c.user_id === me.id && c.status === "visible").reverse(),
      };
      case "comment_delete": case "moderate_comment": { need(); const c = D.comments.find((x) => x.id === +d.id); if (c) c.status = d.status || "deleted"; return { ok: true }; }
      case "suggest": need(); if (!d.value) throw new Error("Indiquez la nouvelle valeur."); D.sugg.push({ id: D.id++, ...d, new_value: d.value, old_value: d.old, user_id: me.id, author: me.name, status: "pending", created_at: now }); return { message: "Merci ! Votre suggestion sera vérifiée par la modération." };
      case "admin_stats": mod(); return { pending: D.sugg.filter((s) => s.status === "pending").length, users: D.users.length, comments: D.comments.filter((c) => c.status === "visible").length,
        likes: Object.values(D.likes).reduce((a, s) => a + s.size, 0), coupons: site().coupons.length, coupon_uses: D.coupons.reduce((a, c) => a + c.uses, 0), perms: permsOf(me),
        week: { users: D.users.length, active: D.users.length }, signups: Array.from({ length: 14 }, (_, i) => ({ d: new Date(Date.now() - (13 - i) * 864e5).toISOString().slice(0, 10), n: i === 13 ? D.users.length : 0 })) };
      case "admin_roles": mod(); return { perms: DEMO_PERMS, system: ["user", "admin"], roles: D.roles.map((r) => ({ ...r, members: D.users.filter((u) => u.role === r.slug).length })) };
      case "role_save": {
        mod(); if (!d.label) throw new Error("Donnez un nom au rôle.");
        const r = D.roles.find((x) => x.slug === d.slug);
        if (r) Object.assign(r, { label: d.label, color: d.color, perms: ["user", "admin"].includes(r.slug) ? r.perms : d.perms });
        else D.roles.splice(-1, 0, { slug: d.label.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "").slice(0, 10) || "role" + D.id++, label: d.label, color: d.color, perms: d.perms || [] });
        log(r ? "role.updated" : "role.created", d.label); return { ok: true };
      }
      case "role_delete": mod(); D.users.forEach((u) => { if (u.role === d.slug) u.role = "user"; }); D.roles = D.roles.filter((r) => r.slug !== d.slug); log("role.deleted", d.slug); return { ok: true };
      case "admin_coupons": mod(); return D.coupons.map((c) => ({ ...c, state: !+c.active ? "off" : c.starts > today ? "later" : c.ends && c.ends < today ? "expired" : "on" }));
      case "coupon_save": {
        mod(); const code = (d.code || "").toUpperCase().replace(/\s+/g, "");
        if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw new Error("Code invalide : lettres, chiffres, - et _ uniquement.");
        if (!d.shop) throw new Error("Indiquez la boutique où le code fonctionne.");
        const c = D.coupons.find((x) => x.id === +d.id), vals = { code, shop: d.shop, discount: d.discount, title: d.title, url: d.url, brand: d.brand, starts: d.starts, ends: d.ends, active: d.active === "0" ? 0 : 1 };
        if (c) Object.assign(c, vals); else D.coupons.unshift({ id: D.id++, uses: 0, ...vals });
        log(c ? "coupon.updated" : "coupon.created", `${code} (${d.shop})`); return { ok: true };
      }
      case "coupon_delete": mod(); D.coupons = D.coupons.filter((c) => c.id !== +d.id); return { ok: true };
      case "coupon_use": { const c = D.coupons.find((x) => x.id === +d.id); if (c) c.uses++; return { ok: true }; }
      case "admin_settings": mod(); return { ...D.settings };
      case "settings_save": mod(); Object.assign(D.settings, d); log("settings", "réglages"); return { ok: true, message: "Réglages enregistrés." };
      case "admin_partners": mod(); return { partners: (D.partners || []).map((p) => ({ ...p, c7: 0, c30: 0, call: 0 })), shops: [], days: Array.from({ length: 30 }, (_, i) => ({ d: new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10), n: 0 })) };
      case "partner_save": { mod(); if (!d.shop || !d.link) throw new Error("Indiquez la boutique et le paramètre d'affiliation."); D.partners = D.partners || []; const p = D.partners.find((x) => x.id === +d.id); const v = { shop: d.shop, domain: d.domain, link: d.link.replace(/^[?&]/, ""), note: d.note, active: d.active === "0" ? 0 : 1 }; if (p) Object.assign(p, v); else D.partners.push({ id: D.id++, ...v }); return { ok: true }; }
      case "partner_delete": mod(); D.partners = (D.partners || []).filter((p) => p.id !== +d.id); return { ok: true };
      case "admin_log": mod(); return D.log.filter((l) => !q.kind || l.action.startsWith(q.kind));
      case "admin_suggestions": mod(); return D.sugg.filter((s) => s.status === (q.status || "pending"));
      case "moderate_suggestion": { mod(); const s = D.sugg.find((x) => x.id === +d.id); if (s) { s.status = d.decision; if (d.value) s.new_value = d.value; s.reviewer = me.name; s.reviewed_at = now; } return { ok: true }; }
      case "admin_comments": mod(); return D.comments.filter((c) => c.status !== "deleted").map((c) => ({ ...c, created_at: c.at, author: D.users.find((u) => u.id === c.user_id)?.name })).reverse();
      case "admin_users": mod(); return D.users.map((u) => ({ ...u, verified: 1, banned: u.banned ? 1 : 0, created_at: now, note: u.note || "", overrides: u.overrides || { grant: [], deny: [] }, perms: permsOf(u), comments: 0, suggestions: 0 }));
      case "user_update": {
        mod(); const u = D.users.find((x) => x.id === +d.id);
        if (u) { if (d.role) u.role = d.role; if (d.banned !== undefined && d.banned !== "") u.banned = d.banned === "1"; if (d.note !== undefined) u.note = d.note; if (d.grant) u.overrides = { grant: d.grant, deny: d.deny || [] }; log("user.role", u.name); }
        return { ok: true };
      }
      case "profile": {
        const u = D.users.find((x) => x.id === +q.id);
        if (!u) throw new Error("Ce membre n'existe pas ou plus.");
        const p = D.profiles[u.id] || {}, mine = !!me && me.id === u.id;
        const base = { id: u.id, name: u.name, role: u.role, since: u.since, mine, color: p.color || "", avatar: p.avatar || "", banner: p.banner || "", banner_preset: (p.extra || {}).banner_preset || "" };
        if (p.is_public === false && !mine && !(me && me.role !== "user")) return { ...base, private: true };
        return {
          ...base, bio: p.bio || "", location: p.location || "", website: p.website || "", youtube: p.youtube || "", instagram: p.instagram || "",
          flying: p.flying || "", setup: p.setup || [], is_public: p.is_public !== false, show_likes: p.show_likes !== false,
          extra: Object.fromEntries(Object.entries(p.extra || {}).filter(([k]) => k !== "banner_preset")),
          stats: { comments: D.comments.filter((c) => c.user_id === u.id && c.status === "visible").length, approved: D.sugg.filter((x) => x.user_id === u.id && x.status === "approved").length,
            suggestions: D.sugg.filter((x) => x.user_id === u.id).length, likes: Object.values(D.likes).filter((st) => st.has(u.id)).length },
          comments: D.comments.filter((c) => c.user_id === u.id && c.status === "visible").slice(-10).reverse(),
          garage: Object.entries(D.garage[u.id] || {}).filter(([, g]) => g.status !== "wanted").map(([ref, g]) => ({ ref, ...g })),
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
        if ("banner" in d) p.banner = d.banner || "";
        if (d.extra) {
          const e = d.extra;
          p.extra = { ...e, tiktok: url(e.tiktok, "tiktok.com"), twitch: url(e.twitch, "twitch.tv") };
          p.flying = (e.styles || [])[0] || "";
        }
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
  // The login window opens as a plain dialog with its own backdrop: a modal dialog sits in the
  // browser's top layer, above the fill-in menus of password managers (Bitwarden, 1Password…),
  // which then cannot be seen or clicked
  function modal(html, cls = "") {
    const d = $("modal"), plain = /\bm-auth\b/.test(cls);
    if (d.open && d.matches(":modal") === plain) d.close();
    d.className = cls;
    d.innerHTML = `<button class="m-close" type="button" aria-label="Fermer">×</button>${html}`;
    if (!d.open) {
      if (plain) {
        d.show();
        if (!$("m-backdrop")) document.body.insertAdjacentHTML("beforeend", `<div id="m-backdrop" class="m-backdrop"></div>`);
        (d.querySelector("input:not([type=hidden])") || d).focus();
      } else d.showModal();
    }
    return d;
  }
  const closeModal = () => $("modal").open && $("modal").close();
  // Backdrop of the plain login window: removed when it closes; a click on it or Escape closes it
  $("modal").addEventListener("close", () => $("m-backdrop")?.remove());
  document.addEventListener("click", (ev) => { if (ev.target.id === "m-backdrop") closeModal(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && $("modal").open && !$("modal").matches(":modal")) closeModal(); });
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
  const isMod = () => !!(C.user && (C.user.perms || []).length);
  const motorName = (ref) => { const m = motorBy(ref); return m ? `${m.MARQUE} ${m.NOM || ""} ${m.KV ? m.KV + "KV" : ""}` : ref; };

  // ------------------------------------------------------------- account bar
  function renderAccount() {
    const el = $("acct");
    if (!el) return;
    el.innerHTML = C.user
      ? `<button type="button" class="nav-pill acct-btn" aria-haspopup="true" aria-expanded="false">${avatar(C.user, "xs")}${esc(C.user.name)}${C.user.role !== "user" ? `<em>${esc(roleLabel(C.user.role))}</em>` : ""}</button>
         <div class="acct-menu" hidden>
           ${C.user.verified === false ? `<button type="button" class="acct-verify" data-resend-verify>⚠ Adresse non confirmée<small>Renvoyer le lien de confirmation</small></button>` : ""}
           <a href="#moi">Mon espace</a>
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
      ${tab !== "forgot" ? google : ""}${tab !== "forgot" && C.googleId ? `<p class="m-legal">Avec Google, vous acceptez les <a href="cgu.html" target="_blank">conditions d'utilisation</a> et la <a href="confidentialite.html" target="_blank">politique de confidentialité</a>.</p>` : ""}
      <form class="m-form" data-auth="${tab}">
        ${tab === "register" ? `<label>Pseudo<input name="name" required minlength="2" maxlength="40" autocomplete="nickname"></label>` : ""}
        <label>Email<input name="email" id="auth-email" type="email" required autocomplete="${tab === "register" ? "email" : "username"}" autocapitalize="off" spellcheck="false"></label>
        ${tab !== "forgot" ? `<label>Mot de passe<input name="password" id="auth-password" type="password" required minlength="8" autocomplete="${tab === "register" ? "new-password" : "current-password"}"></label>` : ""}
        ${tab === "register" ? `<label class="m-accept"><input type="checkbox" name="accept" value="1" required><span>J'accepte les <a href="cgu.html" target="_blank">conditions d'utilisation</a> et la <a href="confidentialite.html" target="_blank">politique de confidentialité</a>.</span></label>` : ""}
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
      C.user = me.user; C.googleId = me.google_client_id || ""; C.online = true; C.site = me.site || C.site;
      [C.likes, C.overrides] = await Promise.all([get("likes"), get("overrides")]);
    } catch (e) { C.online = false; /* server not configured yet: catalogue still works */ }
    applyOverrides();
    renderAccount();
    drawAnnounce();
    // A motor page opened before the session was known: show the member's options now
    if (C.user) refreshCurrent();
  };

  // Every link to a partner shop leaves with the affiliate parameter (product page of the motor, promo codes…);
  // links to shops are counted
  let hostShops = null;
  const shopByHost = (h) => {
    if (!hostShops) { hostShops = {}; Object.values(C.prices || {}).forEach((x) => (x.offers || []).forEach((o) => { const k = hostOf(o.url); if (k && !hostShops[k]) hostShops[k] = o.shop; })); }
    return hostShops[h] || "";
  };
  const onShopLink = (ev) => {
    const a = ev.target.closest && ev.target.closest('a[href^="http"]');
    if (!a || a.closest("#view-admin")) return;
    let p = null;
    if (!a.hasAttribute("data-aff")) {
      p = partnerFor(a.href, a.dataset.shop);
      if (p) { a.href = affiliate(a.href, p); a.rel = "sponsored noopener"; a.setAttribute("data-aff", ""); }
    }
    const shop = a.dataset.shop || (p || partnerFor(a.href, ""))?.shop || shopByHost(hostOf(a.href));
    if (shop) countClick(shop);
  };
  document.addEventListener("click", onShopLink, true);
  document.addEventListener("auxclick", (ev) => { if (ev.button === 1) onShopLink(ev); }, true);

  // Banner, role names and promo codes again after a change in the administration
  async function refreshSite() {
    try { const me = await get("me"); C.site = me.site || C.site; if (me.user) C.user = me.user; } catch (e) { /* keep the previous ones */ }
  }

  // Announcement banner set in the administration; a visitor who closes it does not see that text again
  const textKey = (t) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7).toString(36);
  function drawAnnounce() {
    document.querySelector(".mm-announce")?.remove();
    const a = C.site.announce;
    if (!a) return;
    try { if (localStorage.getItem("mm-announce-off") === textKey(a.text)) return; } catch (e) { /* storage blocked */ }
    const link = a.link && /^(https?:\/\/|#)/.test(a.link) ? ` <a href="${esc(a.link)}"${a.link[0] === "#" ? "" : ' target="_blank" rel="noopener"'}>En savoir plus</a>` : "";
    document.body.insertAdjacentHTML("afterbegin", `<div class="mm-announce ${esc(a.kind || "info")}" role="region" aria-label="Annonce"><p>${esc(a.text)}${link}</p><button type="button" data-announce-off aria-label="Fermer l'annonce">×</button></div>`);
  }

  // Promo codes of a shop (and of the motor's brand when the code is limited to one)
  const shopKey = (s) => (s || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");
  const couponsFor = (shop, brand) => (C.site.coupons || []).filter((c) => {
    const a = shopKey(c.shop), b = shopKey(shop);
    return a && b && (a === b || a.includes(b) || b.includes(a)) && (!c.brand || !brand || c.brand.toLowerCase() === brand.toLowerCase());
  });
  // Partner shops (affiliate links set in the administration): their links carry the partner parameter
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  function partnerFor(url, shop) {
    const h = hostOf(url);
    return (C.site.partners || []).find((p) => (shop && shopKey(p.shop) === shopKey(shop)) || (p.domain && h && (h === p.domain || h.endsWith("." + p.domain))));
  }
  function affiliate(url, p) {
    if (!p || !/^https?:\/\//.test(url)) return url;
    if (p.link.includes("{url}")) return p.link.replace("{url}", encodeURIComponent(url));
    try {
      const u = new URL(url);
      new URLSearchParams(p.link).forEach((v, k) => u.searchParams.set(k, v));
      return u.href;
    } catch (e) { return url; }
  }
  // Clicks to shops, counted per shop and per day (no visitor data)
  function countClick(shop) {
    if (!C.online || DEMO || !shop) return;
    try { navigator.sendBeacon("api/index.php?action=click", new Blob([JSON.stringify({ shop })], { type: "application/json" })); } catch (e) { /* not counted */ }
  }
  const partnerNote = `<p class="o-aff-note"><span class="o-aff">Partenaire</span> Lien affilié : si vous achetez après avoir cliqué, Multi-Motors peut toucher une petite commission, sans que le prix change pour vous. Le classement des offres n'en tient pas compte.</p>`;
  const couponLine = (c) => `<div class="o-coupon"><span class="o-c-lbl">Code promo</span><code>${esc(c.code)}</code>${c.discount ? `<b>${esc(c.discount)}</b>` : ""}
    <small>${esc([c.title, c.ends ? `jusqu'au ${when(c.ends)}` : ""].filter(Boolean).join(" · "))}</small><button type="button" class="mini" data-coupon-copy="${c.id}" data-code="${esc(c.code)}">Copier</button></div>`;

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
    // "Mes moteurs" (owned / tested / wanted) only for a signed-in member
    if (C.user) top.nextElementSibling.insertAdjacentHTML("afterend", garageBox(m.REF, null, null));
    trackView(m.REF);
    document.querySelector("#detail .d-body").insertAdjacentHTML("beforeend", `
      <section class="d-extra card" id="d-prix">${pricesBlock(m)}</section>
      <section class="d-extra card" id="d-comments">${head("chat", "Avis des pilotes")}<div id="c-list"><p class="note">Chargement…</p></div></section>`);
    loadSocial(m.REF);
    drawPriceHistory(m);
  };

  // Where the visitor lives: chosen in the price block, else the region of the browser language,
  // else its time zone; the shops of that country come first, then Europe, then the rest of the world
  const COUNTRIES = { FR: "France", BE: "Belgique", CH: "Suisse", LU: "Luxembourg", CA: "Canada", GB: "Royaume-Uni", DE: "Allemagne", ES: "Espagne", IT: "Italie", US: "États-Unis" };
  const EUROPE = new Set(["FR", "BE", "CH", "LU", "DE", "ES", "IT", "NL", "PT", "AT", "IE", "GB"]);
  // Offers collected before the shop country was saved
  const SHOP_COUNTRY = { "Drone-FPV-Racer": "FR", Studiosport: "FR", "Drone Doctors": "FR", "FPV Fly": "FR", "FPV World": "FR", "Unmanned Tech": "GB", RCDrone: "CN", "HGLRC (officiel)": "CN", "Team BlackSheep": "HK" };
  const flag = (cc) => /^[A-Z]{2}$/.test(cc || "") ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
  let chosenCountry = "";
  function userCountry() {
    if (chosenCountry) return chosenCountry;
    try { const c = localStorage.getItem("mm-country"); if (COUNTRIES[c]) return c; } catch (e) { /* storage blocked */ }
    for (const l of navigator.languages || [navigator.language || ""]) { const r = (l.split("-")[1] || "").toUpperCase(); if (COUNTRIES[r]) return r; }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const byTz = { "Europe/Paris": "FR", "Europe/Brussels": "BE", "Europe/Zurich": "CH", "Europe/Luxembourg": "LU", "Europe/London": "GB", "Europe/Berlin": "DE", "Europe/Madrid": "ES", "Europe/Rome": "IT" };
    if (byTz[tz]) return byTz[tz];
    if (/^America\/(Toronto|Montreal|Vancouver)/.test(tz)) return "CA";
    if (/^America\//.test(tz)) return "US";
    return "FR";
  }
  const zoneOf = (cc, me) => (cc === me ? 0 : EUROPE.has(cc) && EUROPE.has(me) ? 1 : 2);
  const IN = { CA: "Au", GB: "Au", LU: "Au", US: "Aux" };
  const ZONE_LABEL = (me) => [`${IN[me] || "En"} ${COUNTRIES[me]}`, "En Europe", "Reste du monde"];
  // Shops that do not let robots read their prices: a search link for the motor
  const SEARCH_LINKS = [
    ["La Caméra Embarquée", "FR", (q) => `https://www.lacameraembarquee.fr/recherche?controller=search&s=${encodeURIComponent(q)}`],
    ["GetFPV", "US", (q) => `https://www.getfpv.com/catalogsearch/result/?q=${encodeURIComponent(q)}`],
    ["Banggood", "CN", (q) => `https://www.banggood.com/search/${encodeURIComponent(q.replace(/\s+/g, "-"))}.html`],
    ["AliExpress", "CN", (q) => `https://fr.aliexpress.com/w/wholesale-${encodeURIComponent(q.replace(/\s+/g, "-"))}.html`],
  ];

  // ---------------------------------------------------------------- price graphs
  // Line charts drawn in SVG at the width of their box: one line per shop, prices as steps (a price
  // holds until it changes), shared tooltip with a crosshair, legend, and the values in a table.
  const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
  const dayMs = (d) => Date.parse(d + "T12:00:00Z");
  const dayFr = (d, long) => new Date(dayMs(d)).toLocaleDateString("fr-FR", long ? { weekday: "short", day: "numeric", month: "long" } : { day: "numeric", month: "short" });
  // Value of a series on a day: the last point on or before it (prices hold until they change)
  const valueAt = (pts, d) => { let v = null; for (const [x, y] of pts) { if (x <= d) v = y; else break; } return v; };
  function drawChart(box, { series, days, fmt, label, delta, best }) {
    series = series.filter((s) => s.pts.length).slice(0, PALETTE.length);
    if (!series.length || !days.length) { box.innerHTML = ""; return; }
    const W = Math.max(280, box.clientWidth || 600), H = 220, L = 54, R = 14, T = 12, B = 26;
    const t0 = dayMs(days[0]), t1 = Math.max(dayMs(days[days.length - 1]), t0 + 864e5);
    const vals = series.flatMap((s) => s.pts.map((p) => p[1])).filter((v) => v != null);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.15 || Math.max(Math.abs(hi) * 0.05, 0.5);
    lo -= pad; hi += pad;
    const x = (d) => L + ((dayMs(d) - t0) / (t1 - t0)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * (i + 0.5)) / 4).filter((v, i, a) => i === 0 || fmt(v) !== fmt(a[i - 1]));
    const xt = days.length > 6 ? [days[0], days[Math.floor(days.length / 2)], days[days.length - 1]] : days;
    const path = (pts) => {
      const ps = pts.filter((p) => p[0] <= days[days.length - 1]);
      if (!ps.length) return "";
      let dpath = `M${x(ps[0][0] < days[0] ? days[0] : ps[0][0]).toFixed(1)},${y(ps[0][1]).toFixed(1)}`;
      for (let i = 1; i < ps.length; i++) dpath += `H${x(ps[i][0]).toFixed(1)}V${y(ps[i][1]).toFixed(1)}`;
      return dpath + `H${x(days[days.length - 1]).toFixed(1)}`;
    };
    box.innerHTML = `<div class="ch-wrap"><svg class="ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img" aria-label="${esc(label)}">
      ${ticks.map((v) => `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ch-yl" x="${L - 6}" y="${(y(v) + 4).toFixed(1)}">${esc(fmt(v))}</text>`).join("")}
      <line class="ch-axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
      ${xt.map((d, i) => `<text class="ch-xl" x="${x(d).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 && xt.length > 1 ? "start" : i === xt.length - 1 && xt.length > 1 ? "end" : "middle"}">${esc(dayFr(d))}</text>`).join("")}
      ${series.map((s, i) => `<path class="ch-line" data-s="${i}" d="${path(s.pts)}" stroke="${PALETTE[i]}" pathLength="1" style="--d:${i * 0.08}s"/>`).join("")}
      ${series.map((s, i) => s.pts.filter((p) => p[0] >= days[0]).map((p) => `<circle class="ch-dot" data-s="${i}" cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="4" fill="${PALETTE[i]}"/>`).join("")).join("")}
      <line class="ch-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" hidden/>
      ${series.map((s, i) => `<circle class="ch-on" data-s="${i}" r="5.5" fill="${PALETTE[i]}" hidden/>`).join("")}
      <rect class="ch-hit" x="${L}" y="0" width="${W - L - R}" height="${H}"/></svg><div class="ch-tip" hidden></div></div>
      <ul class="ch-legend">${series.map((s, i) => `<li><button type="button" data-s="${i}" aria-pressed="true" title="Cliquer pour masquer ou afficher ${esc(s.name)}"><i style="background:${PALETTE[i]}"></i>${esc(s.name)}</button></li>`).join("")}</ul>
      <details class="ch-table"><summary>Voir les valeurs</summary><div class="tbl-wrap"><table><thead><tr><th>Date</th>${series.map((s) => `<th>${esc(s.name)}</th>`).join("")}</tr></thead><tbody>${
        [...new Set(series.flatMap((s) => s.pts.map((p) => p[0])))].filter((d) => d >= days[0]).sort().reverse().map((d) => `<tr><td>${esc(dayFr(d))}</td>${series.map((s) => { const v = valueAt(s.pts, d); return `<td>${v == null ? "—" : esc(fmt(v))}</td>`; }).join("")}</tr>`).join("")
      }</tbody></table></div></details>`;
    // Shared tooltip: every series at the day under the pointer (or chosen with the arrow keys)
    const svg = box.querySelector("svg"), tip = box.querySelector(".ch-tip"), cross = box.querySelector(".ch-cross");
    const ons = [...box.querySelectorAll(".ch-on")], off = new Set();
    let cur = days.length - 1;
    // Legend: hovering a shop brings its line forward, a click hides or shows it
    box.querySelectorAll(".ch-legend button").forEach((b) => {
      const i = +b.dataset.s;
      b.addEventListener("mouseenter", () => { svg.dataset.focus = i; });
      b.addEventListener("mouseleave", () => { delete svg.dataset.focus; });
      b.addEventListener("click", () => {
        off.has(i) ? off.delete(i) : off.add(i);
        b.setAttribute("aria-pressed", String(!off.has(i)));
        svg.querySelectorAll(`[data-s="${i}"]`).forEach((el) => el.classList.toggle("ch-off", off.has(i)));
      });
    });
    const show = (i) => {
      cur = Math.max(0, Math.min(days.length - 1, i));
      const d = days[cur], cx = x(d);
      cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.hidden = false;
      tip.replaceChildren();
      const h = document.createElement("b"); h.className = "ch-tip-d"; h.textContent = dayFr(d, true); tip.append(h);
      const shown = series.map((s, k) => [k, valueAt(s.pts, d)]).filter(([k, v]) => v != null && !off.has(k));
      const low = best && shown.length > 1 ? Math.min(...shown.map(([, v]) => v)) : null;
      series.forEach((s, k) => {
        const v = valueAt(s.pts, d);
        if (off.has(k)) { ons[k].hidden = true; return; }
        const row = document.createElement("div"), key = document.createElement("i"), val = document.createElement("strong"), nm = document.createElement("span");
        key.style.background = PALETTE[k]; val.textContent = v == null ? "—" : fmt(v); nm.textContent = s.name;
        row.append(key, val, nm);
        // Change since the price before (price graphs) and the cheapest shop that day
        const before = delta && v != null ? [...s.pts].reverse().find((p) => p[0] < d && p[1] !== v && p[0] <= d) : null;
        const lastChange = before && s.pts.find((p) => p[0] > before[0] && p[0] <= d);
        if (before && lastChange) {
          const dv = v - before[1], em = document.createElement("em");
          em.className = dv < 0 ? "dn" : "up"; em.textContent = `${dv < 0 ? "▼" : "▲"} ${fmt(Math.abs(dv))}`;
          em.title = `depuis le ${dayFr(lastChange[0])}`; row.append(em);
        }
        if (low != null && v === low) { const b = document.createElement("b"); b.className = "ch-best"; b.textContent = "le moins cher"; row.append(b); }
        tip.append(row);
        ons[k].hidden = v == null;
        if (v != null) { ons[k].setAttribute("cx", cx); ons[k].setAttribute("cy", y(v)); }
      });
      tip.hidden = false;
      const left = (cx / W) * svg.clientWidth;
      tip.style.left = `${Math.min(Math.max(left - tip.offsetWidth / 2, 0), svg.clientWidth - tip.offsetWidth)}px`;
    };
    const near = (ev) => { const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W; let best = 0; days.forEach((d, i) => { if (Math.abs(x(d) - px) < Math.abs(x(days[best]) - px)) best = i; }); return best; };
    const hide = () => { tip.hidden = true; cross.hidden = true; ons.forEach((o) => (o.hidden = true)); };
    svg.addEventListener("pointermove", (ev) => show(near(ev)));
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", () => show(cur));
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (ev) => { if (ev.key === "ArrowLeft") { show(cur - 1); ev.preventDefault(); } if (ev.key === "ArrowRight") { show(cur + 1); ev.preventDefault(); } });
  }
  // Same as the offers: shops outside Europe get the French VAT, to compare like for like
  const withVat = (eur, cur) => Math.round((cur === "USD" ? eur * (1 + VAT) : eur) * 100) / 100;
  // Tiny step line of one price (the rows of the detailed report)
  function spark(pts) {
    if (!pts || pts.length < 2) return "";
    const W = 84, H = 24, t0 = dayMs(pts[0][0]), t1 = Math.max(dayMs(pts[pts.length - 1][0]), t0 + 864e5);
    const vs = pts.map((p) => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), r = hi - lo || 1;
    const x = (d) => 3 + ((dayMs(d) - t0) / (t1 - t0)) * (W - 6), y = (v) => 3 + (1 - (v - lo) / r) * (H - 6);
    let d = `M${x(pts[0][0]).toFixed(1)},${y(pts[0][1]).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += `H${x(pts[i][0]).toFixed(1)}V${y(pts[i][1]).toFixed(1)}`;
    const last = pts[pts.length - 1];
    const label = `Historique : ${pts.map((p) => `${dayFr(p[0])} ${euro(p[1])}`).join(", ")}`;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><path d="${d}" pathLength="1"/><circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="3"/></svg>`;
  }
  // Data of the graphs, loaded when first needed
  const lazyJson = (() => { const cache = {}; return (name) => (cache[name] = cache[name] || fetch(`data/${name}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)); })();

  // Offers: arrow and amount when the price of the shop changed in the last 30 days (from the price history)
  function decorateOffers(m, shops, curOf) {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    document.querySelectorAll("#d-prix a.offer[data-shop]").forEach((a) => {
      const pts = shops[a.dataset.shop] || shops[a.querySelector(".o-shop")?.childNodes[1]?.textContent || ""];
      if (!pts || pts.length < 2 || a.querySelector(".o-trend")) return;
      const last = pts[pts.length - 1], prev = [...pts].reverse().find((p) => p[1] !== last[1]);
      if (!prev || last[0] < since) return;
      const cur = curOf[a.dataset.shop], dv = withVat(last[2], cur) - withVat(prev[2], cur);
      if (Math.abs(dv) < 0.01) return;
      a.querySelector(".o-price b")?.insertAdjacentHTML("afterend", `<span class="o-trend ${dv < 0 ? "dn" : "up"} tt" tabindex="0" data-tip="${dv < 0 ? "Baisse" : "Hausse"} de ${euro(Math.abs(dv))} le ${dayFr(last[0], true)} (avant : ${euro(withVat(prev[2], cur))})">${dv < 0 ? "▼" : "▲"} ${euro(Math.abs(dv))}</span>`);
    });
  }

  // Motor page: price history of the motor in each shop
  async function drawPriceHistory(m) {
    const box = document.querySelector("#d-prix .price-hist");
    if (!box) return;
    const hist = await lazyJson("prix_hist");
    const shops = (hist && hist[m.REF]) || {};
    const offers = (C.prices[m.REF] || {}).offers || [];
    const order = offers.map((o) => o.shop), curOf = Object.fromEntries(offers.map((o) => [o.shop, o.cur]));
    const series = Object.entries(shops).sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
      .map(([shop, pts]) => ({ name: shop, pts: pts.map((p) => [p[0], withVat(p[2], curOf[shop])]) }));
    const changes = series.reduce((n, s) => n + s.pts.length - 1, 0);
    const first = series.flatMap((s) => s.pts.map((p) => p[0])).sort()[0];
    if (!series.length || !first) { box.hidden = true; return; }
    const today = new Date().toISOString().slice(0, 10), days = [];
    for (let t = dayMs(first); t <= dayMs(today); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
    box.hidden = false;
    box.innerHTML = `<h4 class="ph-title">Historique des prix par boutique</h4><p class="ph-sub">${changes ? `${changes} changement${changes > 1 ? "s" : ""} de prix` : "Aucun changement de prix"} depuis le ${esc(dayFr(first))} : prix TTC d'un moteur, vérifiés chaque jour (TVA de 20 % ajoutée hors Europe).</p><div class="ph-chart"></div>`;
    drawChart(box.querySelector(".ph-chart"), { series, days, fmt: (v) => euro(v), delta: true, best: true, label: `Historique des prix de ${motorName(m.REF)} par boutique` });
    decorateOffers(m, shops, curOf);
  }

  function pricesBlock(m) {
    const p = C.prices[m.REF], me = userCountry();
    const q = `${m.MARQUE} ${m.NOM || ""} ${m.KV ? m.KV + "KV" : ""}`.replace(/\s+/g, " ").trim();
    const links = SEARCH_LINKS.slice().sort((a, b) => zoneOf(a[1], me) - zoneOf(b[1], me))
      .map(([n, cc, url]) => `<a href="${esc(url(q))}" target="_blank" rel="noopener nofollow">${flag(cc)} ${esc(n)}</a>`).join("");
    const picker = `<label class="o-country">Livraison en <select data-country>${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}"${k === me ? " selected" : ""}>${flag(k)} ${esc(v)}</option>`).join("")}</select></label>`;
    const more = `<p class="o-more"><span>Chercher aussi sur</span>${links}</p>`;
    if (!p || !p.offers?.length) {
      return `${head("price", "Comparateur de prix")}<p class="note">Aucune offre relevée pour ce moteur pour l'instant.</p>${more}`;
    }
    const offers = p.offers.map((o) => { const cc = o.country || SHOP_COUNTRY[o.shop] || "US"; return { ...o, cc, zone: zoneOf(cc, me), ttc: ttc(o), partner: partnerFor(o.url, o.shop) }; })
      .sort((a, b) => a.zone - b.zone || (!a.stock - !b.stock) || a.ttc - b.ttc);
    const best = Math.min(...offers.map((o) => o.ttc)), mid = ttcOf(p);
    const labels = ZONE_LABEL(me);
    return `${head("price", "Comparateur de prix", `${offers.length} boutique${offers.length > 1 ? "s" : ""}`)}
      <div class="price-head"><div class="price-big">${priceTag(mid, "big")}<small>prix indicatif par moteur</small></div>
        <p>Médiane de ${offers.length} offre${offers.length > 1 ? "s" : ""} relevée${offers.length > 1 ? "s" : ""} le ${new Date(p.date).toLocaleDateString("fr-FR")}, convertie${offers.length > 1 ? "s" : ""} en euros au taux BCE du jour. Boutiques hors Europe : TVA de 20 % ajoutée ; frais de port et de douane non compris.</p></div>
      <div class="o-bar">${picker}<small>Les boutiques de votre pays s'affichent en premier.</small></div>
      <div class="offers">${offers.map((o, i) => `${i === 0 || offers[i - 1].zone !== o.zone ? `<p class="o-zone">${esc(labels[o.zone])}</p>` : ""}
        <a class="offer ${o.ttc === best ? "best" : ""} ${o.stock ? "" : "oos"}" href="${esc(o.partner ? affiliate(o.url, o.partner) : o.url)}" target="_blank" rel="${o.partner ? "sponsored noopener" : "noopener"}" data-shop="${esc(o.partner ? o.partner.shop : o.shop)}"${o.partner ? " data-aff" : ""}>
          <span class="o-shop"><i class="o-flag" title="${esc(COUNTRIES[o.cc] || o.cc)}">${flag(o.cc)}</i>${esc(o.shop)}${o.ttc === best ? `<em>Meilleur prix</em>` : ""}${o.partner ? `<span class="o-aff" title="Lien affilié">Partenaire</span>` : ""}</span>
          <span class="o-price">${priceTag(o.ttc)}${offers.length > 1 ? `<span class="o-gauge tt" data-tip="${o.ttc === best ? "Le moins cher des offres relevées" : `${euro(o.ttc - best)} de plus que le moins cher (${Math.round((o.ttc / best - 1) * 100)} %)`}"><i style="--p:${Math.round(((o.ttc - best) / ((Math.max(...offers.map((x) => x.ttc)) - best) || 1)) * 100)}%"></i></span>` : ""}<small class="o-orig">${(() => {
            const sym = o.cur === "USD" ? "$" : o.cur === "GBP" ? "£" : "€";
            const f = (v) => `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${sym}`;
            return `sur la boutique : ${o.pack > 1 ? `lot de ${o.pack} à ${f(o.price)}, soit ${f(o.price / o.pack)} / moteur` : f(o.price)}${o.cur === "USD" ? " (hors TVA)" : ""}`;
          })()}</small></span>
          <span class="o-stock">${o.stock ? "En stock" : "Rupture"}${o.checked ? `<small>vérifié le ${esc(dayFr(o.checked))}</small>` : ""}</span>
          <span class="o-go">Voir l'offre →</span>
        </a>${couponsFor(o.shop, m.MARQUE).map(couponLine).join("")}`).join("")}</div>${offers.some((o) => o.partner) ? partnerNote : ""}
      <div class="price-hist" hidden></div>${more}`;
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
      const gb = document.querySelector(".garage-box");
      if (gb) gb.outerHTML = garageBox(ref, s.garage, s.mine);
      list.innerHTML = commentsBlock(ref, s);
    } catch (e) { list.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
  }

  const stars = (n, cls = "") => `<span class="stars ${cls}" aria-label="${n} sur 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= Math.round(n) ? "on" : ""}">★</i>`).join("")}</span>`;
  const points = (txt, kind) => (txt || "").split(/\n+/).map((l) => l.replace(/^\s*[-•+*]\s*/, "").trim()).filter(Boolean)
    .map((l) => `<li class="${kind}">${esc(l)}</li>`).join("");
  function commentsBlock(ref, s) {
    const summary = s.ratings ? `<div class="rv-summary">${stars(s.rating, "big")}<b>${String(s.rating).replace(".", ",")} / 5</b><span>${s.ratings} avis noté${s.ratings > 1 ? "s" : ""}</span></div>` : "";
    const form = C.user
      ? `<form class="c-form rv-form" data-comment="${esc(ref)}">
          <div class="rv-rate" role="radiogroup" aria-label="Votre note">
            <span class="rv-label">Votre note</span>
            ${[5, 4, 3, 2, 1].map((i) => `<input type="radio" name="rating" id="rv-${i}" value="${i}"><label for="rv-${i}" title="${i} sur 5">★</label>`).join("")}
          </div>
          <div class="rv-cols">
            <label class="rv-pros"><span>Qualités</span><textarea name="pros" rows="3" maxlength="600" placeholder="Une qualité par ligne : couple, douceur, finition…"></textarea></label>
            <label class="rv-cons"><span>Défauts</span><textarea name="cons" rows="3" maxlength="600" placeholder="Un défaut par ligne : chauffe, câbles courts, prix…"></textarea></label>
          </div>
          <label class="rv-body"><span>Votre avis</span><textarea id="c-body" name="body" rows="3" maxlength="2000" placeholder="Votre expérience en vol, le drone, l'hélice et la batterie utilisés, un conseil de montage…"></textarea></label>
          <button class="btn-red" type="submit">Publier mon avis</button></form>`
      : `<p class="c-login"><button type="button" class="btn-dark" data-login>Connectez-vous</button> pour donner votre avis.</p>`;
    const items = s.comments.length ? s.comments.map((c) => `
      <article class="comment ${c.status === "hidden" ? "hidden-c" : ""}">
        <header>${c.uid ? `<a class="c-author" href="#u/${c.uid}">${avatar({ name: c.author, color: c.color, avatar: c.avatar }, "sm")}<b>${esc(c.author)}</b></a>` : `<b>${esc(c.author)}</b>`}${c.role && c.role !== "user" ? `<em>${esc(roleLabel(c.role))}</em>` : ""}${c.rating ? stars(c.rating) : ""}<time>${when(c.at)}</time>
          ${c.status === "hidden" ? `<span class="tagc">Masqué</span>` : ""}</header>
        ${c.pros || c.cons ? `<ul class="rv-points">${points(c.pros, "pro")}${points(c.cons, "con")}</ul>` : ""}
        ${c.body ? `<p>${esc(c.body).replace(/\n/g, "<br>")}</p>` : ""}
        <footer>${c.mine ? `<button type="button" data-cdel="${c.id}">Supprimer</button>` : ""}
          ${isMod() && !c.mine ? (c.status === "hidden" ? `<button type="button" data-cmod="${c.id}" data-status="visible">Rétablir</button>` : `<button type="button" data-cmod="${c.id}" data-status="hidden">Masquer</button>`) + `<button type="button" data-cmod="${c.id}" data-status="deleted">Supprimer</button>` : ""}</footer>
      </article>`).join("") : `<p class="note">Pas encore d'avis. Soyez le premier à partager votre expérience.</p>`;
    return summary + form + `<div class="comments">${items}</div>`;
  }

  // ------------------------------------------------ "My motors" and history
  const GARAGE = { owned: ["Je le possède", "Possédé"], tested: ["Je l'ai testé", "Testé"], wanted: ["Il me fait envie", "Envie"] };
  function garageBox(ref, counts, mine) {
    const c = counts || {};
    const n = (c.owned || 0) + (c.tested || 0);
    return `<div class="garage-box" data-garage="${esc(ref)}">
      <span class="gb-title">Mes moteurs</span>
      ${Object.entries(GARAGE).map(([k, [label]]) => `<button type="button" data-gset="${k}" aria-pressed="${mine && mine.status === k}">${label}${c[k] ? `<i>${c[k]}</i>` : ""}</button>`).join("")}
      ${mine ? `<input class="gb-note" data-gnote maxlength="200" value="${esc(mine.note || "")}" placeholder="Note perso : drone, hélice, avis rapide…">` : ""}
      ${n ? `<span class="gb-count">${n} pilote${n > 1 ? "s" : ""} l'${n > 1 ? "ont" : "a"} en main</span>` : ""}
    </div>`;
  }
  const LOCAL_HISTORY = "mm_history";
  function localHistory() { try { return JSON.parse(localStorage.getItem(LOCAL_HISTORY) || "[]"); } catch (e) { return []; } }
  function trackView(ref) {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    try { localStorage.setItem(LOCAL_HISTORY, JSON.stringify([{ ref, at: now }, ...localHistory().filter((x) => x.ref !== ref)].slice(0, 60))); } catch (e) { /* private mode */ }
    if (C.user && C.online) api("view", { ref }).catch(() => {});
  }

  // Mon espace: history, likes, my motors, my reviews
  const SP = { tab: "historique" };
  async function renderSpace(tab) {
    const v = $("view-profile");
    v.hidden = false;
    if (tab) SP.tab = tab;
    let d = { history: localHistory(), likes: [], garage: [], reviews: [] };
    if (C.user && C.online) { try { d = await get("my_space"); if (!d.history.length) d.history = localHistory(); } catch (e) { /* keep local */ } }
    const card = (ref, extra = "") => { const h = motorCardHtml(ref); return h ? h.replace("</a>", `${extra}</a>`) : ""; };
    const tabs = [["historique", "Historique", d.history.length], ["jaime", "J'aime", d.likes.length], ["moteurs", "Mes moteurs", d.garage.length], ["avis", "Mes avis", d.reviews.length]];
    const empty = (t) => `<p class="note">${t}</p>`;
    const byStatus = (k) => d.garage.filter((g) => g.status === k);
    const panes = {
      historique: d.history.length ? `<div class="sp-head"><p class="pf-hint">Les ${d.history.length} derniers moteurs consultés${C.user ? "" : " sur cet appareil"}.</p><button type="button" class="ghost-btn" data-hclear>Effacer l'historique</button></div>
        <div class="pm-grid small">${d.history.map((h) => card(h.ref, `<em class="sp-when">${when(h.at)}</em>`)).join("")}</div>` : empty("Vous n'avez encore consulté aucun moteur."),
      jaime: C.user ? (d.likes.length ? `<div class="pm-grid small">${d.likes.map((r) => card(r)).join("")}</div>` : empty("Touchez ♥ sur une fiche moteur pour le retrouver ici.")) : "",
      moteurs: C.user ? (d.garage.length ? Object.keys(GARAGE).map((k) => byStatus(k).length ? `<h3 class="pf-h">${GARAGE[k][1]} <small>${byStatus(k).length}</small></h3>
          <div class="pm-grid small">${byStatus(k).map((g) => card(g.ref, g.note ? `<em class="sp-note">« ${esc(g.note)} »</em>` : "")).join("")}</div>` : "").join("")
        : empty("Sur une fiche moteur, indiquez « Je le possède », « Je l'ai testé » ou « Il me fait envie » : vos moteurs s'afficheront ici et sur votre profil.")) : "",
      avis: C.user ? (d.reviews.length ? `<div class="pf-comments">${d.reviews.map((c) => `<a class="pf-c" href="#m/${encodeURIComponent(c.ref)}"><span class="pf-c-m">${esc(motorName(c.ref))}</span>${c.rating ? stars(c.rating) : ""}${c.body ? `<p>${esc(c.body.slice(0, 220))}</p>` : ""}<time>${when(c.at)}</time></a>`).join("")}</div>` : empty("Vous n'avez pas encore publié d'avis.")) : "",
    };
    v.innerHTML = `<div class="pf-wrap sp-wrap">
      <div class="pf-edit-top"><h1>Mon espace</h1>${C.user ? `<a class="ghost-btn" href="#u/${C.user.id}">Mon profil public →</a>` : `<button type="button" class="btn-dark" data-login>Se connecter</button>`}</div>
      ${C.user ? "" : `<p class="pf-hint sp-anon">Connectez-vous pour retrouver vos « j'aime », vos moteurs et vos avis sur tous vos appareils.</p>`}
      <div class="pf-tabs" role="tablist">${tabs.filter(([k]) => C.user || k === "historique").map(([k, l, n]) => `<button type="button" role="tab" data-sp-tab="${k}" aria-selected="${SP.tab === k}">${l}${n ? ` <i>${n}</i>` : ""}</button>`).join("")}</div>
      <section class="card sp-pane">${panes[C.user ? SP.tab : "historique"]}</section>
    </div>`;
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
      ${catalogueStats()}
      ${(C.site.coupons || []).length ? `<section class="promo-box" aria-label="Codes promo du moment"><h2>Codes promo du moment</h2>${C.site.coupons.map((c) =>
        `<div class="promo"><span class="promo-shop">${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.shop)}</a>` : esc(c.shop)}${c.brand ? ` <small>${esc(c.brand)}</small>` : ""}</span>${couponLine(c)}</div>`).join("")}</section>` : ""}
      <div class="chips" role="tablist"><button class="tab" data-actus="all" aria-selected="true">Tout</button><button class="tab" data-actus="moteurs" aria-selected="false">Nouveaux moteurs</button><button class="tab" data-actus="rapport" aria-selected="false">Rapports du jour</button><button class="tab" data-actus="site" aria-selected="false">Le site</button></div>
      <div id="feed"><p class="note">Chargement…</p></div></div>`;
    // Figures count up when the page opens
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const els = [...v.querySelectorAll("[data-count]")], t0 = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - t0) / 1100), e = 1 - (1 - t) ** 3;
        els.forEach((el) => (el.textContent = nf(Math.round(+el.dataset.count * e))));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    (C.online ? get("news").catch(() => []) : Promise.resolve([])).then((news) => {
      const items = [
        ...news.map((n) => ({ kind: "site", at: n.at, title: n.title, body: n.body, author: n.author })),
        ...(C.actus || []).map((a) => ({ kind: a.type || "moteurs", at: a.date, title: a.title, body: a.body || "", refs: a.refs || [], all: a.all || [], count: a.count || (a.refs || []).length, models: a.models, brands: a.newBrands || [], nBrands: a.newBrandsCount || 0, rep: a.type === "rapport" ? a : null })),
      ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
      v._items = items;
      drawFeed("all");
    });
  }
  const nf = (n) => Number(n).toLocaleString("fr-FR");
  // The catalogue today, counted from the data the page has loaded (always up to date)
  function catalogueStats() {
    const st = MM().state, motors = st.motors || [];
    if (!motors.length) return "";
    const named = motors.filter((m) => m.NOM && !/KV · [\d.]+ g$/.test(m.NOM));
    const models = new Set(named.map((m) => `${m.MARQUE}|${m.NOM}`));
    const count = (o) => Object.values(o || {}).filter((v) => (Array.isArray(v) ? v.length : v)).length;
    const namedBrands = new Set(named.map((m) => m.MARQUE));
    const cards = [
      [named.length, "moteurs identifiés", `+ ${nf(motors.length - named.length)} sans nom de modèle`], [models.size, "modèles"],
      [namedBrands.size, "marques", `+ ${nf(new Set(motors.map((m) => m.MARQUE)).size - namedBrands.size)} sans modèle identifié`],
      [motors.filter((m) => st.thumbs[m.REF]).length, "moteurs en photo"],
      [Object.values(st.fab || {}).filter((f) => f.specs).length, "fiches fabricant"],
      [Object.values(st.fab || {}).reduce((a, f) => a + (f.tests || []).length, 0) + Object.values(st.bench || {}).reduce((a, t) => a + t.length, 0), "bancs d'essai"],
      [count(st.videos), "modèles avec vidéos"],
      [Object.values(C.prices || {}).filter((p) => p.offers?.length).length, "moteurs avec prix"],
    ].filter(([n]) => n > 0);
    return `<section class="cat-stats" aria-label="Le catalogue aujourd'hui"><h2>Le catalogue aujourd'hui</h2>
      <div class="stats">${cards.map(([n, l, sub], i) => `<div class="stat" style="--i:${i}"><b data-count="${n}">${nf(n)}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ""}</div>`).join("")}</div></section>`;
  }
  function drawFeed(kind) {
    const v = $("view-actus");
    const items = (v._items || []).filter((i) => kind === "all" || i.kind === kind);
    $("feed").innerHTML = items.length ? items.map((i) => `
      <article class="news ${i.kind}">
        <header><span class="n-kind">${i.kind === "site" ? "Le site" : i.kind === "rapport" ? "Rapport du jour" : "Nouveaux moteurs"}</span><time>${when(String(i.at).length === 10 ? i.at + " 12:00:00" : i.at)}</time></header>
        <h2>${esc(i.title)}</h2>
        ${i.body ? `<p>${esc(i.body).replace(/\n/g, "<br>")}</p>` : ""}
        ${i.rep ? reportBlock(i.rep) : ""}
        ${i.kind === "moteurs" && i.models ? `<p class="n-sum">${nf(i.models)} modèle${i.models > 1 ? "s" : ""}${i.nBrands ? ` · ${nf(i.nBrands)} nouvelle${i.nBrands > 1 ? "s" : ""} marque${i.nBrands > 1 ? "s" : ""}` : ""}</p>` : ""}
        ${i.brands?.length ? `<p class="n-brands">${i.brands.slice(0, 20).map((b) => `<span>${esc(b)}</span>`).join("")}${i.nBrands > 20 ? `<span class="note">et ${nf(i.nBrands - 20)} autres</span>` : ""}</p>` : ""}
        ${i.refs?.length ? `<div class="n-motors">${i.refs.slice(0, 12).map((r) => { const m = motorBy(r); return m ? `<a class="n-motor" href="#m/${encodeURIComponent(r)}">${MM().photo(m)}<span>${MM().freshTag(m)}${esc(m.MARQUE)} ${esc(m.NOM || "")}<small>${esc(m.CLASSE || "")} · ${esc(m.KV || "")}KV</small></span></a>` : ""; }).join("")}</div>` : ""}
        ${i.all?.filter(motorBy).length > 1 ? `<button type="button" class="n-all-btn" data-n-all="${esc(i.at)}" aria-expanded="false">Voir les ${nf(i.all.filter(motorBy).length)} moteurs ajoutés</button><div class="n-all" hidden></div>` : ""}
      </article>`).join("") : `<p class="note">Aucune actualité pour l'instant.</p>`;
    animateCounts($("feed"));
  }
  // Daily report: the figures of the day, and the price drops with a link to each motor
  function reportBlock(r) {
    const tiles = [[r.motors, "nouveaux moteurs", r.models ? `dont ${nf(r.models)} nouveaux modèles` : "", "Moteurs entrés au catalogue ce jour-là (tableau, boutiques, sites des fabricants)"],
      [r.values, "informations ajoutées", r.completed ? `sur ${nf(r.completed)} fiches` : "", "Caractéristiques remplies sur des fiches existantes : poids, dimensions, tension, shaft, lien…"],
      [r.drops, "baisses de prix", "", "Modèles dont le prix le plus bas en stock a baissé d'au moins 5 %"], [r.priced, "nouveaux prix", "", "Modèles qui ont maintenant au moins une offre en stock"],
      [r.photos, "nouvelles photos", "", "Photos ajoutées aux galeries des modèles"], [r.videos, "nouvelles vidéos", "", "Vidéos de test ou de review trouvées sur YouTube"],
      [r.bench, "bancs d'essai", "", "Tableaux de poussée ajoutés"], [r.fab, "fiches fabricant", "", "Fiches techniques officielles lues sur les sites des fabricants"]].filter(([n]) => n > 0);
    const drops = (r.dropList || []).filter((d) => motorBy(d.ref));
    return `${activityStrip(r.date)}${tiles.length ? `<div class="rep-tiles">${tiles.map(([n, l, sub, tip], i) => `<div class="rep-tile tt" tabindex="0" data-tip="${esc(tip)}" style="--i:${i}"><b data-count="${n}">${nf(n)}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ""}</div>`).join("")}</div>`
        : `<p>Toutes les sources ont été vérifiées : pas de changement aujourd'hui.</p>`}
      ${drops.length ? `<h3 class="rep-h">Baisses de prix</h3><ul class="rep-drops">${drops.map((d) => `<li><a href="#m/${encodeURIComponent(d.ref)}">${esc(d.model)}</a><span><s>${euro(d.old)}</s> ${euro(d.new)}</span><em class="tt" tabindex="0" data-tip="Économie de ${euro(d.old - d.new)} par moteur">▼ ${d.pct} %</em></li>`).join("")}</ul>
        <p class="rep-note">Prix le plus bas relevé parmi les offres en stock (avant TVA pour les boutiques hors Europe).</p>` : ""}
      <p class="rep-total">Catalogue : ${nf(r.total)} moteurs, ${nf(r.totalModels)} modèles identifiés.</p>
      <button type="button" class="n-all-btn" data-rep-detail="${esc(r.date)}" aria-expanded="false">Voir le rapport détaillé</button><div class="rep-detail" hidden></div>`;
  }
  // Activity of the last 14 reports up to this one: one bar per day (motors, information, prices, photos and videos)
  function activityStrip(day) {
    const reps = (C.actus || []).filter((a) => a.type === "rapport" && a.date <= day).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
    if (reps.length < 2) return "";
    const total = (r) => (r.motors || 0) + (r.values || 0) + (r.priced || 0) + (r.drops || 0) + (r.photos || 0) + (r.videos || 0);
    const max = Math.max(1, ...reps.map(total));
    return `<div class="rep-strip" role="img" aria-label="Activité des ${reps.length} derniers jours">${reps.map((r, i) => `<span class="tt${r.date === day ? " on" : ""}${i >= reps.length / 2 ? " r" : ""}" tabindex="0" style="--h:${Math.max(6, Math.round((total(r) / max) * 100))}%;--i:${i}" data-tip="${esc(dayFr(r.date, true))} : ${nf(total(r))} changements${r.motors ? `, ${nf(r.motors)} moteurs` : ""}${r.values ? `, ${nf(r.values)} informations` : ""}${r.priced ? `, ${nf(r.priced)} prix` : ""}"></span>`).join("")}<small>14 derniers jours</small></div>`;
  }
  // Figures that count up when a report comes into view
  const countIn = new ("IntersectionObserver" in window ? IntersectionObserver : class { observe() {} })((entries, obs) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    obs.unobserve(en.target);
    const el = en.target, n = +el.dataset.count, t0 = performance.now();
    const tick = (now) => { const t = Math.min(1, (now - t0) / 700), e = 1 - (1 - t) ** 3; el.textContent = nf(Math.round(n * e)); if (t < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  const animateCounts = (root) => { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; root.querySelectorAll(".rep-tile [data-count]").forEach((el) => countIn.observe(el)); };
  // Detailed report of a day (data/rapports/AAAA-MM-JJ.json): every motor added or changed, every price change per shop
  const motorLink = (x) => `<a href="#m/${encodeURIComponent(x.ref)}">${esc(x.model)}</a>${x.kv ? ` <small>${esc(x.kv)} KV</small>` : ""}`;
  const pctTag = (p) => `<em class="pct ${p < 0 ? "down" : "up"}">${p < 0 ? "▼" : "▲"} ${String(Math.abs(p)).replace(".", ",")} %</em>`;
  const fieldVal = (v) => (v ? esc(/^https?:/.test(v) ? v.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40) + "…" : v) : "<i>vide</i>");
  // A variation of a price index (100 = unchanged): "+2,6 %", "−0,12 %", "0 %"
  const pctFmt = (v) => { const d = v - 100, a = Math.abs(d); return a < 0.005 ? "0 %" : `${d > 0 ? "+" : "−"}${a.toFixed(a < 1 ? 2 : 1).replace(".", ",")} %`; };
  // Long lists: 15 lines, then a button for the rest
  const longList = (cls, items) => `<ul class="${cls}">${items.map((h, i) => `<li${i >= 15 ? " hidden" : ""}>${h}</li>`).join("")}</ul>${items.length > 15 ? `<button type="button" class="n-all-btn" data-rd-more>Afficher les ${nf(items.length - 15)} autres</button>` : ""}`;
  const sec = (title, n, body, open = false) => `<details class="rd-sec"${open ? " open" : ""}><summary>${title} <i>${nf(n)}</i></summary>${body}</details>`;
  async function openDetail(btn) {
    const box = btn.nextElementSibling, open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = open ? "Masquer le rapport détaillé" : "Voir le rapport détaillé";
    box.hidden = !open;
    if (!open || box.childElementCount) return;
    box.innerHTML = `<p class="note">Chargement…</p>`;
    const [d, idx] = await Promise.all([lazyJson(`rapports/${btn.dataset.repDetail}`), lazyJson("prix_boutiques")]);
    if (!d) { box.innerHTML = `<p class="note">Le détail de ce jour n'est pas disponible.</p>`; return; }
    const priceRows = (d.prices || []).map((x) => `<tr><td>${motorLink(x)}</td><td>${esc(x.shop)}</td><td>${euro(withVat(x.old, x.cur))}</td><td><b>${euro(withVat(x.new, x.cur))}</b></td><td>${pctTag(x.pct)}</td><td>${spark((x.hist || []).map((p) => [p[0], withVat(p[1], x.cur)]))}</td></tr>`).join("");
    const parts = [];
    if (d.pricesTotal || (d.stock || []).length || (d.offersNew || []).length) {
      parts.push(sec("Prix", (d.pricesTotal || 0) + (d.stock || []).length + (d.offersNew || []).length, `
        ${d.pricesTotal ? `<h4 class="rd-h">Évolution des prix par boutique</h4><p class="rd-sub">Variation moyenne des prix de chaque boutique depuis le premier relevé (0 % = prix inchangés).</p><div class="rd-chart"></div>
        <div class="tbl-wrap"><table class="rd-table"><thead><tr><th>Boutique</th><th>Baisses</th><th>Hausses</th><th>Variation moyenne</th></tr></thead><tbody>${(d.shops || []).map((x) => `<tr><td>${esc(x.shop)}</td><td>${x.down}</td><td>${x.up}</td><td>${pctTag(x.avg)}</td></tr>`).join("")}</tbody></table></div>
        <h4 class="rd-h">Prix changés <small>${nf(d.pricesTotal)}</small></h4><div class="tbl-wrap"><table class="rd-table"><thead><tr><th>Moteur</th><th>Boutique</th><th>Avant</th><th>Après</th><th>Variation</th><th>Historique</th></tr></thead><tbody>${priceRows}</tbody></table></div>` : ""}
        ${(d.stock || []).length ? `<h4 class="rd-h">Stock</h4>${longList("rd-list", d.stock.map((x) => `${motorLink(x)} — ${esc(x.shop)} : <b class="${x.stock ? "st-in" : "st-out"}">${x.stock ? "de retour en stock" : "en rupture"}</b>`))}` : ""}
        ${(d.offersNew || []).length ? `<h4 class="rd-h">Nouvelles offres</h4>${longList("rd-list", d.offersNew.map((x) => `${motorLink(x)} — ${esc(x.shop)} : ${euro(withVat(x.eur, x.cur))}${x.stock ? "" : " (rupture)"}`))}` : ""}`, true));
    }
    if ((d.added || []).length) parts.push(sec("Moteurs ajoutés", d.added.length, longList("rd-list", d.added.map((x) => `${motorLink(x)}${x.cls ? ` <small>classe ${esc(x.cls)}</small>` : ""}`))));
    if ((d.changed || []).length) parts.push(sec("Fiches complétées ou corrigées", d.changedTotal || d.changed.length, `<ul class="rd-changes">${d.changed.map((x, i) => `<li${i >= 60 ? " hidden" : ""}>${motorLink(x)}<ul>${x.fields.map(([f, a, b]) => `<li><span>${esc(f)}</span> ${fieldVal(a)} → <b>${fieldVal(b)}</b></li>`).join("")}</ul></li>`).join("")}</ul>
      ${d.changed.length > 60 ? `<button type="button" class="n-all-btn" data-rd-more>Afficher les ${nf(d.changed.length - 60)} autres</button>` : ""}`));
    if ((d.media || []).length) parts.push(sec("Photos et vidéos ajoutées", d.media.length, longList("rd-list", d.media.map((x) => `${x.ref ? `<a href="#m/${encodeURIComponent(x.ref)}">${esc(x.model)}</a>` : esc(x.model)} : +${x.n} ${x.kind === "videos" ? `vidéo${x.n > 1 ? "s" : ""}${x.titles.length ? ` <small>(${esc(x.titles.join(" · "))})</small>` : ""}` : `photo${x.n > 1 ? "s" : ""}`}`))));
    if ((d.removed || []).length) parts.push(sec("Retirés (doublons, fiches fusionnées)", d.removed.length, longList("rd-list", d.removed.map((x) => `${esc(x.model)}${x.kv ? ` <small>${esc(x.kv)} KV</small>` : ""}`))));
    box.innerHTML = parts.join("") || `<p class="note">Aucun changement enregistré ce jour-là.</p>`;
    const chartBox = box.querySelector(".rd-chart");
    if (chartBox && idx && idx.days?.length) {
      // The shops whose prices changed that day first, then the biggest shops (8 lines at most)
      const changedShops = (d.shops || []).map((x) => x.shop);
      const days = idx.days.filter((x) => x <= d.date);
      // Only the shops whose prices moved in the period (flat lines at 0 % would hide each other)
      const moved = (x) => x.idx.some((v, i) => v != null && idx.days[i] <= d.date && Math.abs(v - 100) >= 0.005);
      const shops = idx.shops.filter(moved).sort((a, b) => (changedShops.includes(b.shop) - changedShops.includes(a.shop)) || b.offers - a.offers).slice(0, 8);
      const still = idx.shops.filter((x) => !moved(x)).map((x) => x.shop);
      if (still.length) chartBox.insertAdjacentHTML("afterend", `<p class="rd-sub">Prix inchangés sur la période : ${esc(still.join(", "))}.</p>`);
      drawChart(chartBox, { days, label: "Variation moyenne des prix par boutique", fmt: pctFmt,
        series: shops.map((x) => ({ name: x.shop, pts: idx.days.map((day, i) => [day, x.idx[i]]).filter((p) => p[1] != null && p[0] <= d.date) })) });
    }
  }
  // Every motor of an announcement, listed on demand (brand, model, class, KV), freshly released ones marked
  function drawAll(btn) {
    const box = btn.nextElementSibling, item = ($("view-actus")._items || []).find((x) => x.kind === "moteurs" && String(x.at) === btn.dataset.nAll);
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = open ? "Masquer la liste" : `Voir les ${nf(item.all.filter(motorBy).length)} moteurs ajoutés`;
    if (open && !box.childElementCount) {
      box.innerHTML = `<table class="n-table"><thead><tr><th>Marque</th><th>Modèle</th><th>Classe</th><th>KV</th><th>Poids</th></tr></thead><tbody>${item.all.map(motorBy).filter(Boolean).map((m) =>
        `<tr><td>${esc(m.MARQUE)}</td><td><a href="#m/${encodeURIComponent(m.REF)}">${esc(m.NOM || m.REF)}</a>${MM().freshTag(m)}</td><td>${esc(m.CLASSE || "—")}</td><td>${esc(m.KV || "—")}</td><td>${m.POIDS ? esc(m.POIDS) + " g" : "—"}</td></tr>`).join("")}</tbody></table>`;
    }
    box.hidden = !open;
  }

  // ----------------------------------------------------------------- admin
  // Tabs shown according to the permissions of the member (administrators have them all)
  const ADMIN_TABS = [["dashboard", "Tableau de bord"], ["suggestions", "Corrections", "suggestions", "pending"], ["bugs", "Bugs", "bugs", "bugs"],
    ["comments", "Avis", "comments"], ["users", "Membres", "members"], ["roles", "Rôles", "roles"], ["coupons", "Codes promo", "coupons"], ["partners", "Partenaires", "partners"],
    ["news", "Actualités", "news"], ["settings", "Réglages", "settings"], ["log", "Journal", "logs"]];
  const LOG_LABELS = { suggestion: "Correction", comment: "Avis", bug: "Bug", user: "Membre", role: "Rôle", coupon: "Code promo", partner: "Partenaire", news: "Actualité", settings: "Réglages" };
  const LOG_VERBS = {
    "suggestion.approved": "a validé une correction", "suggestion.rejected": "a refusé une correction", "comment.hidden": "a masqué un avis",
    "comment.visible": "a rétabli un avis", "comment.deleted": "a supprimé un avis", "bug.done": "a résolu un bug", "bug.rejected": "a rejeté un bug",
    "bug.open": "a rouvert un bug", "bug.deleted": "a supprimé un bug", "user.role": "a changé le rôle de", "user.perms": "a changé les permissions de",
    "user.banned": "a suspendu", "user.unbanned": "a réactivé", "user.verified": "a confirmé l'email de", "user.note": "a annoté la fiche de",
    "role.created": "a créé le rôle", "role.updated": "a modifié le rôle", "role.deleted": "a supprimé le rôle", "coupon.created": "a créé le code",
    "coupon.updated": "a modifié le code", "coupon.deleted": "a supprimé le code", "partner.created": "a ajouté la boutique partenaire", "partner.updated": "a modifié la boutique partenaire", "partner.deleted": "a retiré la boutique partenaire", "news.created": "a publié", "news.updated": "a modifié l'actualité",
    "news.deleted": "a supprimé l'actualité", settings: "a modifié les réglages :", "search.run": "a lancé la",
  };
  const COUPON_STATE = { on: ["Actif", "good"], later: ["Programmé", "blue"], expired: ["Expiré", "grey"], off: ["Désactivé", "grey"] };
  const A = { meta: null, users: [], q: "", role: "" };
  const adminMeta = async () => (A.meta = A.meta || await get("admin_roles"));
  const dateFr = (at) => at ? new Date(at.replace(" ", "T") + "Z").toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const roleChip = (slug) => { const r = (C.site.roles || {})[slug]; return `<span class="role-chip" style="--rc:${esc(r?.color || "#888")}">${esc(roleLabel(slug))}</span>`; };
  const permBoxes = (meta, on, locked) => `<div class="perm-grid">${Object.entries(meta.perms).map(([k, l]) =>
    `<label class="perm"><input type="checkbox" name="perm" value="${k}" ${on.includes(k) ? "checked" : ""} ${locked ? "disabled" : ""}><span>${esc(l)}</span></label>`).join("")}</div>`;
  const topList = (title, rows) => `<div class="adm-top"><h3>${title}</h3>${rows?.length ? `<ol>${rows.map((r) => `<li><a href="#m/${encodeURIComponent(r.ref)}">${esc(motorName(r.ref))}</a><b>${r.n}</b></li>`).join("")}</ol>` : `<p class="note">Rien pour l'instant.</p>`}</div>`;

  function drawUsers() {
    const body = $("adm-users");
    if (!body) return;
    const q = A.q.toLowerCase(), assign = can("assign"), ban = can("ban"), admin = C.user.role === "admin";
    const rows = A.users.filter((u) => (!A.role || u.role === A.role || (A.role === "banned" && u.banned)) && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q)));
    const roles = Object.keys(C.site.roles || {});
    body.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="adm-table"><thead><tr><th>Membre</th><th>Rôle</th><th>État</th><th>Activité</th><th>Inscrit</th><th></th></tr></thead><tbody>${rows.map((u) => {
      const self = u.id === C.user.id, locked = self || (u.role === "admin" && !admin);
      const extra = u.overrides.grant.length + u.overrides.deny.length;
      return `<tr data-uid="${u.id}"><td><a href="#u/${u.id}"><b>${esc(u.name)}</b></a><br><small>${esc(u.email)}</small>${u.note ? `<br><small class="adm-note-i" title="${esc(u.note)}">📝 ${esc(u.note.slice(0, 60))}</small>` : ""}</td>
        <td>${assign && !locked ? `<select data-role aria-label="Rôle de ${esc(u.name)}">${roles.filter((r) => r !== "admin" || admin).map((r) => `<option value="${esc(r)}" ${r === u.role ? "selected" : ""}>${esc(roleLabel(r))}</option>`).join("")}</select>` : roleChip(u.role)}
          ${extra ? `<br><small class="adm-extra">${u.overrides.grant.length ? `+${u.overrides.grant.length}` : ""} ${u.overrides.deny.length ? `−${u.overrides.deny.length}` : ""} permission${extra > 1 ? "s" : ""}</small>` : ""}</td>
        <td>${+u.banned ? `<span class="st bad">Suspendu</span>` : +u.verified ? `<span class="st good">Actif</span>` : `<span class="st grey">Email non confirmé</span>`}</td>
        <td><small>${u.comments} avis · ${u.suggestions} corrections${u.last_seen ? `<br>vu le ${when(u.last_seen)}` : ""}</small></td>
        <td><small>${when(u.created_at)}</small></td>
        <td class="adm-actions">${locked ? "" : `${ban && !+u.verified ? `<button class="mini" data-uverify>Confirmer</button>` : ""}${ban ? `<button class="mini" data-ban="${+u.banned ? 0 : 1}">${+u.banned ? "Réactiver" : "Suspendre"}</button>` : ""}<button class="mini" data-uperm>${assign ? "Permissions" : "Note"}</button>`}</td></tr>`;
    }).join("")}</tbody></table></div>` : `<p class="note">Aucun membre ne correspond.</p>`;
  }

  async function permForm(uid) {
    const u = A.users.find((x) => x.id === +uid), meta = await adminMeta(), assign = can("assign");
    const role = meta.roles.find((r) => r.slug === u.role) || { perms: [] };
    const state = (k) => u.overrides.grant.includes(k) ? "grant" : u.overrides.deny.includes(k) ? "deny" : "";
    modal(`<h2>${esc(u.name)}</h2><p class="m-sub">${roleChip(u.role)} · inscrit le ${when(u.created_at)}</p>
      <form class="m-form" data-perm-form="${u.id}">
        ${assign ? `<p class="note">Chaque permission suit le rôle, ou peut être accordée ou retirée à ce membre seulement.</p>
        <div class="perm-list">${Object.entries(meta.perms).map(([k, l]) => `<label class="perm-row"><span>${esc(l)}<small>${role.perms.includes(k) ? "incluse dans le rôle" : "pas dans le rôle"}</small></span>
          <select name="p_${k}"><option value="">Selon le rôle</option><option value="grant" ${state(k) === "grant" ? "selected" : ""}>Accordée</option><option value="deny" ${state(k) === "deny" ? "selected" : ""}>Retirée</option></select></label>`).join("")}</div>` : ""}
        <label>Note de l'équipe (visible seulement dans l'administration)<textarea name="note" rows="3" maxlength="2000">${esc(u.note || "")}</textarea></label>
        <p class="m-error" role="alert" hidden></p><button class="btn-red" type="submit">Enregistrer</button></form>`, "m-wide");
  }

  function couponForm(c = {}) {
    const shops = [...new Set(Object.values(C.prices || {}).flatMap((p) => (p.offers || []).map((o) => o.shop)))].sort();
    const brands = [...new Set(MM().state.motors.map((m) => m.MARQUE).filter(Boolean))].sort();
    return `<form class="m-form coupon-form" data-coupon-form><input type="hidden" name="id" value="${c.id || ""}">
      <div class="f-2"><label>Code<input name="code" required maxlength="40" value="${esc(c.code || "")}" placeholder="MULTIMOTORS10" autocapitalize="characters"></label>
        <label>Réduction<input name="discount" maxlength="30" value="${esc(c.discount || "")}" placeholder="-10 %"></label></div>
      <div class="f-2"><label>Boutique<input name="shop" required maxlength="60" list="dl-shops" value="${esc(c.shop || "")}" placeholder="Drone-FPV-Racer"></label>
        <label>Marque (facultatif)<input name="brand" maxlength="60" list="dl-brands" value="${esc(c.brand || "")}" placeholder="Toutes les marques"></label></div>
      <datalist id="dl-shops">${shops.map((s) => `<option value="${esc(s)}">`).join("")}</datalist><datalist id="dl-brands">${brands.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
      <label>Description<input name="title" maxlength="160" value="${esc(c.title || "")}" placeholder="Sur tous les moteurs, dès 50 € d'achat"></label>
      <label>Lien de la boutique (facultatif)<input name="url" type="url" maxlength="500" value="${esc(c.url || "")}" placeholder="https://"></label>
      <div class="f-2"><label>Début (facultatif)<input name="starts" type="date" value="${esc(c.starts || "")}"></label><label>Fin (facultatif)<input name="ends" type="date" value="${esc(c.ends || "")}"></label></div>
      <label class="inline"><input type="checkbox" name="active" ${c.id && !+c.active ? "" : "checked"}> Actif</label>
      <p class="m-error" role="alert" hidden></p>
      <div class="f-actions">${c.id ? `<button class="btn-dark" type="button" data-coupon-new>Annuler</button>` : ""}<button class="btn-red" type="submit">${c.id ? "Enregistrer le code" : "Créer le code"}</button></div></form>`;
  }

  function partnerForm(p = {}) {
    const shops = [...new Set(Object.values(C.prices || {}).flatMap((x) => (x.offers || []).map((o) => o.shop)))].sort();
    return `<form class="m-form" data-partner-form><input type="hidden" name="id" value="${p.id || ""}">
      <div class="f-2"><label>Boutique<input name="shop" required maxlength="60" list="dl-pshops" value="${esc(p.shop || "")}" placeholder="Drone-FPV-Racer"></label>
        <label>Domaine du site (facultatif)<input name="domain" maxlength="120" value="${esc(p.domain || "")}" placeholder="drone-fpv-racer.com"></label></div>
      <datalist id="dl-pshops">${shops.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
      <label>Paramètre ou lien d'affiliation<input name="link" required maxlength="500" value="${esc(p.link || "")}" placeholder="ref=multimotors   ou   https://plateforme.com/clic?id=123&url={url}"></label>
      <label>Note privée (commission, contact, conditions…)<textarea name="note" rows="2" maxlength="2000">${esc(p.note || "")}</textarea></label>
      <label class="inline"><input type="checkbox" name="active" ${p.id && !+p.active ? "" : "checked"}> Actif</label>
      <p class="m-error" role="alert" hidden></p>
      <div class="f-actions">${p.id ? `<button class="btn-dark" type="button" data-partner-new>Annuler</button>` : ""}<button class="btn-red" type="submit">${p.id ? "Enregistrer" : "Ajouter la boutique"}</button></div></form>`;
  }

  async function renderAdmin(tab = "dashboard", status = "") {
    const v = $("view-admin");
    v.hidden = false;
    if (!isMod()) {
      v.innerHTML = `<div class="page"><h1 class="page-title">Administration</h1><p class="note">Connectez-vous avec un compte de l'équipe du site.</p><p class="note"><button class="btn-dark" data-login>Connexion</button></p></div>`;
      return;
    }
    const tabs = ADMIN_TABS.filter(([k, , p]) => !p || can(p) || (k === "roles" && can("assign")));
    if (!tabs.some(([k]) => k === tab)) tab = "dashboard";
    const stats = await get("admin_stats").catch(() => ({}));
    v.innerHTML = `<div class="page adm-page"><h1 class="page-title">Administration</h1>
      <div class="chips adm-tabs">${tabs.map(([k, l, , n]) => `<button class="tab" data-admin-tab="${k}" aria-selected="${k === tab}">${l}${n && stats[n] ? ` <i>${stats[n]}</i>` : ""}</button>`).join("")}</div>
      <div id="admin-body"><p class="note">Chargement…</p></div></div>`;
    const body = $("admin-body"), on = v.querySelector(".adm-tabs [aria-selected=true]");
    if (on) on.parentNode.scrollLeft = on.offsetLeft - (on.parentNode.clientWidth - on.offsetWidth) / 2;
    try {
      if (tab === "dashboard") {
        const w = stats.week || {}, max = Math.max(1, ...(stats.signups || []).map((d) => d.n));
        const tiles = [["Corrections à valider", stats.pending, "suggestions"], ["Bugs à traiter", stats.bugs, "bugs"], ["Membres", stats.users, "users", w.users ? `+${w.users} cette semaine` : ""],
          ["Membres actifs", w.active, "", "ces 7 derniers jours"], ["Avis publiés", stats.comments, "comments", w.comments ? `+${w.comments} cette semaine` : ""], ["J'aime", stats.likes],
          ["Codes promo actifs", stats.coupons, "coupons"], ["Codes copiés", stats.coupon_uses, "coupons"],
          ["Clics vers les boutiques", stats.clicks, "partners", "ces 30 derniers jours"], ["Boutiques partenaires", stats.partners, "partners"]];
        body.innerHTML = `<div class="stats adm-stats">${tiles.map(([l, n, t, sub]) => `<${t && tabs.some(([k]) => k === t) ? `button type="button" data-admin-tab="${t}"` : "div"} class="stat"><b>${n ?? "—"}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ""}</${t && tabs.some(([k]) => k === t) ? "button" : "div"}>`).join("")}</div>
          <div class="adm-dash">
            <section class="adm-chart"><h3>Inscriptions des 14 derniers jours</h3>
              <div class="sbars" role="img" aria-label="${(stats.signups || []).map((d) => `${when(d.d)} : ${d.n}`).join(", ")}">${(stats.signups || []).map((d) =>
                `<span class="sbar" style="--h:${d.n ? Math.max(4, Math.round((d.n / max) * 100)) : 0}%" data-tip="${esc(new Date(d.d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }))} : ${d.n} inscription${d.n > 1 ? "s" : ""}" tabindex="0"><i></i></span>`).join("")}</div>
              <div class="sbars-axis"><span>${stats.signups?.[0] ? new Date(stats.signups[0].d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : ""}</span><span>max. ${max} / jour</span><span>aujourd'hui</span></div></section>
            ${topList("Les plus aimés", stats.top_liked)}${topList("Les plus commentés", stats.top_reviewed)}${topList("Les plus possédés", stats.top_owned)}
            <section class="adm-top"><h3>Votre accès</h3><p>${roleChip(C.user.role)}</p><ul class="perm-mine">${(stats.perms || []).map((p) => `<li>${esc((A.meta?.perms || {})[p] || p)}</li>`).join("")}</ul></section>
          </div>`;
        if (!A.meta) adminMeta().then(() => { const ul = body.querySelector(".perm-mine"); if (ul) ul.innerHTML = (stats.perms || []).map((p) => `<li>${esc(A.meta.perms[p] || p)}</li>`).join(""); }).catch(() => {});
      } else if (tab === "suggestions") {
        status = ["pending", "approved", "rejected"].includes(status) ? status : "pending";
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
      } else if (tab === "bugs") {
        const st = ["open", "done", "rejected"].includes(status) ? status : "open";
        status = st;
        const rows = await get("admin_bugs", { status: st });
        body.innerHTML = `<div class="chips small">${[["open", "À traiter"], ["done", "Résolus"], ["rejected", "Rejetés"]].map(([k, l]) => `<button class="tab" data-admin-bugs="${k}" aria-selected="${k === st}">${l}</button>`).join("")}</div>` +
          (rows.length ? rows.map((b) => `
          <article class="adm-card bug-card" data-bug="${b.id}">
            <header><span class="bug-cat">${esc(b.category)}</span><time>${when(b.created_at)}</time></header>
            <p class="bug-body">${esc(b.body).replace(/\n/g, "<br>")}</p>
            <dl class="bug-meta">
              ${b.url ? `<div><dt>Page</dt><dd><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.url.replace(/^https?:\/\/[^/]+/, "") || "/")}</a></dd></div>` : ""}
              ${b.selector ? `<div><dt>Élément</dt><dd><code>${esc(b.selector)}</code>${b.element_text ? `<br><small>« ${esc(b.element_text)} »</small>` : ""}</dd></div>` : ""}
              ${b.viewport ? `<div><dt>Écran</dt><dd>${esc(b.viewport)}</dd></div>` : ""}
              ${b.agent ? `<div><dt>Navigateur</dt><dd><small>${esc(b.agent)}</small></dd></div>` : ""}
            </dl>
            ${b.snippet ? `<details class="bug-html"><summary>Code HTML de l'élément</summary><pre>${esc(b.snippet)}</pre></details>` : ""}
            <footer><span>${b.author ? `par <b>${esc(b.author)}</b>` : "visiteur"}${b.email ? ` · <a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ""}</span>
              ${st === "open" ? `<button class="btn-dark" data-bug-set="rejected">Rejeter</button><button class="btn-red" data-bug-set="done">Résolu</button>`
                : `<button class="btn-dark" data-bug-set="open">Rouvrir</button><button class="btn-red" data-bug-set="deleted">Supprimer</button>`}</footer>
          </article>`).join("") : `<p class="note">Aucun signalement ${st === "open" ? "à traiter" : st === "done" ? "résolu" : "rejeté"}.</p>`);
      } else if (tab === "comments") {
        const rows = await get("admin_comments");
        body.innerHTML = rows.length ? rows.map((c) => `
          <article class="adm-card ${c.status === "hidden" ? "hidden-c" : ""}">
            <header><a href="#m/${encodeURIComponent(c.ref)}">${esc(motorName(c.ref))}</a>${c.rating ? stars(c.rating) : ""}<time>${when(c.created_at)}</time></header>
            <p>${esc(c.body)}</p>
            <footer><span>par <b>${esc(c.author)}</b>${c.status === "hidden" ? " · masqué" : ""}</span>
              ${c.status === "hidden" ? `<button class="btn-dark" data-cmod="${c.id}" data-status="visible">Rétablir</button>` : `<button class="btn-dark" data-cmod="${c.id}" data-status="hidden">Masquer</button>`}
              <button class="btn-red" data-cmod="${c.id}" data-status="deleted">Supprimer</button></footer>
          </article>`).join("") : `<p class="note">Aucun commentaire.</p>`;
      } else if (tab === "users") {
        A.users = await get("admin_users");
        const counts = A.users.reduce((o, u) => ((o[u.role] = (o[u.role] || 0) + 1), o), {});
        const banned = A.users.filter((u) => +u.banned).length;
        body.innerHTML = `<div class="adm-filter"><input type="search" data-users-q placeholder="Chercher un pseudo ou un email" value="${esc(A.q)}" aria-label="Chercher un membre">
            <div class="chips small"><button class="tab" data-users-role="" aria-selected="${!A.role}">Tous <i>${A.users.length}</i></button>${Object.keys(C.site.roles || {}).filter((r) => counts[r]).map((r) =>
              `<button class="tab" data-users-role="${esc(r)}" aria-selected="${A.role === r}">${esc(roleLabel(r))} <i>${counts[r]}</i></button>`).join("")}${banned ? `<button class="tab" data-users-role="banned" aria-selected="${A.role === "banned"}">Suspendus <i>${banned}</i></button>` : ""}</div></div>
          <div id="adm-users"></div>`;
        drawUsers();
      } else if (tab === "roles") {
        A.meta = null;
        const meta = await adminMeta(), edit = can("roles"), admin = C.user.role === "admin";
        body.innerHTML = `<p class="note">Un rôle regroupe des permissions. Les administrateurs ont toujours toutes les permissions et les membres aucune ; chaque membre peut ensuite recevoir ou perdre une permission précise depuis l'onglet Membres.</p>
          ${edit ? `<details class="adm-new"><summary>Créer un rôle</summary><form class="m-form" data-role-form>
            <div class="f-2"><label>Nom du rôle<input name="label" required maxlength="40" placeholder="Rédaction"></label><label>Couleur<input name="color" type="color" value="#2ec4b6"></label></div>
            ${permBoxes(meta, [], false)}<p class="m-error" role="alert" hidden></p><button class="btn-red" type="submit">Créer le rôle</button></form></details>` : ""}
          ${meta.roles.map((r) => {
            const sys = meta.system.includes(r.slug), canEdit = edit && (r.slug !== "admin" || admin);
            return `<article class="adm-card role-card" style="--rc:${esc(r.color || "#888")}"><form class="m-form" data-role-form="${esc(r.slug)}">
              <header><span class="role-dot"></span>${canEdit ? `<input name="label" value="${esc(r.label)}" maxlength="40" aria-label="Nom du rôle" class="role-name">` : `<b>${esc(r.label)}</b>`}
                ${canEdit ? `<input name="color" type="color" value="${esc(r.color || "#888888")}" aria-label="Couleur">` : ""}<small>${r.members} membre${r.members > 1 ? "s" : ""}</small></header>
              ${r.slug === "admin" ? `<p class="note">Toutes les permissions, toujours.</p>` : r.slug === "user" ? `<p class="note">Aucune permission d'administration : c'est le rôle de chaque nouveau compte.</p>` : permBoxes(meta, r.perms, !canEdit)}
              <p class="m-error" role="alert" hidden></p>
              ${canEdit ? `<footer>${sys ? "" : `<button class="btn-dark" type="button" data-role-del="${esc(r.slug)}">Supprimer</button>`}<button class="btn-red" type="submit">Enregistrer</button></footer>` : ""}</form></article>`;
          }).join("")}`;
      } else if (tab === "coupons") {
        const rows = await get("admin_coupons");
        body.innerHTML = `<p class="note">Les codes actifs s'affichent sous les offres de la boutique dans le comparateur de prix (et seulement pour la marque choisie, le cas échéant), et dans les actualités.</p>
          <div class="adm-new open" id="coupon-edit"><h3>Nouveau code promo</h3>${couponForm()}</div>
          ${rows.length ? `<div class="tbl-wrap"><table class="adm-table"><thead><tr><th>Code</th><th>Boutique</th><th>Réduction</th><th>Validité</th><th>État</th><th>Copié</th><th></th></tr></thead><tbody>${rows.map((c) => `
            <tr data-coupon='${esc(JSON.stringify(c))}'><td><code class="cp-code">${esc(c.code)}</code>${c.title ? `<br><small>${esc(c.title)}</small>` : ""}</td>
              <td>${esc(c.shop)}${c.brand ? `<br><small>${esc(c.brand)} uniquement</small>` : ""}</td><td>${esc(c.discount || "—")}</td>
              <td><small>${c.starts ? `du ${when(c.starts)}` : "dès maintenant"}<br>${c.ends ? `au ${when(c.ends)}` : "sans fin"}</small></td>
              <td><span class="st ${COUPON_STATE[c.state][1]}">${COUPON_STATE[c.state][0]}</span></td><td>${c.uses} fois</td>
              <td class="adm-actions"><button class="mini" data-coupon-edit>Modifier</button><button class="mini" data-coupon-toggle>${+c.active ? "Désactiver" : "Activer"}</button><button class="mini" data-coupon-del>Supprimer</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Aucun code promo pour l'instant.</p>`}`;
      } else if (tab === "partners") {
        const d = await get("admin_partners"), max = Math.max(1, ...d.days.map((x) => x.n)), top = Math.max(1, ...d.shops.map((x) => x.n));
        body.innerHTML = `<p class="note">Quand une boutique vous affilie, elle vous donne un paramètre (ex. <code>ref=multimotors</code>) ou un lien de plateforme d'affiliation contenant <code>{url}</code>. Il est ajouté automatiquement à tous les liens vers cette boutique, et ses offres portent la mention « Partenaire » (obligatoire).</p>
          <div class="adm-new open" id="partner-edit"><h3>Nouvelle boutique partenaire</h3>${partnerForm()}</div>
          ${d.partners.length ? `<div class="tbl-wrap"><table class="adm-table"><thead><tr><th>Boutique</th><th>Lien d'affiliation</th><th>Clics 7 j</th><th>30 j</th><th>Total</th><th>État</th><th></th></tr></thead><tbody>${d.partners.map((p) => `
            <tr data-partner='${esc(JSON.stringify(p))}'><td><b>${esc(p.shop)}</b>${p.domain ? `<br><small>${esc(p.domain)}</small>` : ""}${p.note ? `<br><small class="adm-note-i" title="${esc(p.note)}">📝 ${esc(p.note.slice(0, 60))}</small>` : ""}</td>
              <td><code class="aff-code">${esc(p.link)}</code><br><small>ex. ${esc(affiliate(`https://${p.domain || "boutique.com"}/produit`, p))}</small></td>
              <td>${p.c7}</td><td>${p.c30}</td><td>${p.call}</td><td><span class="st ${+p.active ? "good" : "grey"}">${+p.active ? "Actif" : "En pause"}</span></td>
              <td class="adm-actions"><button class="mini" data-partner-edit>Modifier</button><button class="mini" data-partner-toggle>${+p.active ? "Mettre en pause" : "Activer"}</button><button class="mini" data-partner-del>Retirer</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Aucune boutique partenaire pour l'instant.</p>`}
          <div class="adm-dash">
            <section class="adm-chart"><h3>Clics vers les boutiques, 30 derniers jours</h3>
              <div class="sbars" role="img" aria-label="${d.days.map((x) => `${when(x.d)} : ${x.n}`).join(", ")}">${d.days.map((x) =>
                `<span class="sbar" style="--h:${x.n ? Math.max(4, Math.round((x.n / max) * 100)) : 0}%" data-tip="${esc(new Date(x.d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }))} : ${x.n} clic${x.n > 1 ? "s" : ""}" tabindex="0"><i></i></span>`).join("")}</div>
              <div class="sbars-axis"><span>${new Date(d.days[0].d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span><span>max. ${max} / jour</span><span>aujourd'hui</span></div></section>
            <section class="adm-chart"><h3>Boutiques les plus cliquées (30 jours)</h3>${d.shops.length ? `<ol class="hbars">${d.shops.slice(0, 15).map((x) => `<li><span>${esc(x.shop)}${d.partners.some((p) => p.shop === x.shop && +p.active) ? ` <span class="o-aff">Partenaire</span>` : ""}</span><i style="--w:${Math.max(2, Math.round((x.n / top) * 100))}%"></i><b>${x.n}</b></li>`).join("")}</ol>
              <p class="note">Ces chiffres permettent de démarcher une boutique (« vos offres ont reçu N clics ce mois-ci ») et de comparer avec ses rapports d'affiliation.</p>` : `<p class="note">Pas encore de clic enregistré.</p>`}</section>
          </div>`;
      } else if (tab === "news") {
        const rows = await get("admin_news");
        body.innerHTML = `<form class="m-form news-form" data-news-form><input type="hidden" name="id" value="">
            <label>Titre<input name="title" required maxlength="160"></label>
            <label>Texte<textarea name="body" rows="4" required maxlength="5000"></textarea></label>
            <label class="inline"><input type="checkbox" name="published" checked> Publier</label>
            <button class="btn-red" type="submit">Enregistrer l'actualité</button></form>` +
          rows.map((n) => `<article class="adm-card"><header><b>${esc(n.title)}</b><time>${when(n.created_at)}</time></header><p>${esc(n.body)}</p>
            <footer><span>${+n.published ? "Publiée" : "Brouillon"}</span><button class="btn-dark" data-news-edit='${esc(JSON.stringify(n))}'>Modifier</button><button class="btn-red" data-news-del="${n.id}">Supprimer</button></footer></article>`).join("");
      } else if (tab === "settings") {
        const s = await get("admin_settings");
        body.innerHTML = `<form class="m-form adm-settings" data-settings-form>
          <fieldset><legend>Bandeau d'annonce</legend><p class="note">Affiché en haut de toutes les pages ; chaque visiteur peut le fermer.</p>
            <label class="inline"><input type="checkbox" name="announce_on" ${s.announce_on === "1" ? "checked" : ""}> Afficher le bandeau</label>
            <label>Texte<input name="announce_text" maxlength="300" value="${esc(s.announce_text)}" placeholder="-10 % chez Drone-FPV-Racer avec le code MULTIMOTORS"></label>
            <div class="f-2"><label>Lien (facultatif)<input name="announce_link" maxlength="500" value="${esc(s.announce_link)}" placeholder="https://… ou #actus"></label>
              <label>Style<select name="announce_kind">${[["info", "Information"], ["promo", "Promotion"], ["warning", "Alerte"]].map(([k, l]) => `<option value="${k}" ${s.announce_kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div></fieldset>
          <fieldset><legend>Communauté</legend>
            <label class="inline"><input type="checkbox" name="registrations" ${s.registrations !== "0" ? "checked" : ""}> Inscriptions ouvertes <small>(les comptes existants peuvent toujours se connecter)</small></label>
            <label class="inline"><input type="checkbox" name="comments" ${s.comments !== "0" ? "checked" : ""}> Avis ouverts <small>(l'équipe peut toujours publier)</small></label></fieldset>
          <p class="m-error" role="alert" hidden></p><button class="btn-red" type="submit">Enregistrer les réglages</button></form>
          <section class="adm-new adm-search"><h3>Recherche quotidienne</h3><div id="adm-search"><p class="note">Chargement…</p></div></section>`;
        drawSearchStatus();
      } else if (tab === "log") {
        const kind = Object.keys(LOG_LABELS).includes(status) ? status : "";
        status = kind;
        const rows = await get("admin_log", kind ? { kind } : undefined);
        body.innerHTML = `<div class="chips small"><button class="tab" data-admin-log="" aria-selected="${!kind}">Tout</button>${Object.entries(LOG_LABELS).map(([k, l]) => `<button class="tab" data-admin-log="${k}" aria-selected="${k === kind}">${l}</button>`).join("")}</div>
          ${rows.length ? `<ol class="adm-log">${rows.map((r) => `<li><time>${dateFr(r.created_at)}</time><span><b>${esc(r.who)}</b> ${esc(LOG_VERBS[r.action] || r.action)} ${r.target ? `<em>${esc(r.target)}</em>` : ""}${r.detail ? `<small>${esc(r.detail)}</small>` : ""}</span></li>`).join("")}</ol>` : `<p class="note">Aucune action enregistrée.</p>`}`;
      }
    } catch (e) { body.innerHTML = `<p class="note">${esc(e.message)}</p>`; }
    v.dataset.tab = tab; v.dataset.status = status;
  }
  // Daily search (GitHub Actions): last runs and a button to start it now
  const RUN_STATE = { success: ["Réussie", "good"], failure: ["Échec", "bad"], cancelled: ["Annulée", "grey"], skipped: ["Ignorée", "grey"] };
  const RUN_EVENT = { schedule: "programmée par GitHub", workflow_dispatch: "lancée par le site ou à la main", push: "publication" };
  async function drawSearchStatus() {
    const box = $("adm-search");
    if (!box) return;
    let st;
    try { st = await get("search_status"); } catch (e) { box.innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
    const runs = st.runs || [];
    box.innerHTML = `${st.configured ? "" : `<p class="note">Pour lancer la recherche depuis le site (et chaque matin à l'heure par la tâche planifiée OVH), ajoutez le jeton <code>github_token</code> dans <code>api/config.php</code>.</p>`}
      ${st.error ? `<p class="note">${esc(st.error)}</p>` : ""}
      ${runs.length ? `<ol class="adm-log run-list">${runs.map((r) => {
        const [lbl, cls] = r.status !== "completed" ? ["En cours", "blue"] : RUN_STATE[r.conclusion] || [r.conclusion || "—", "grey"];
        const min = Math.round((Date.parse(r.updated_at) - Date.parse(r.created_at)) / 60000);
        return `<li><time>${dateFr(r.created_at.replace("T", " ").slice(0, 19))}</time><span><span class="st ${cls}">${lbl}</span> ${esc(RUN_EVENT[r.event] || r.event)}${r.status === "completed" ? ` · ${min} min` : ""} · <a href="${esc(r.url)}" target="_blank" rel="noopener">détails</a></span></li>`;
      }).join("")}</ol>` : ""}
      <p><button type="button" class="btn-red" data-search-run ${st.configured ? "" : "disabled"}>Lancer la recherche maintenant</button></p>`;
  }
  const readPerms = (f) => [...f.querySelectorAll('input[name="perm"]:checked')].map((i) => i.value);

  // Admin actions that are not in the main click handler
  document.addEventListener("click", async (ev) => {
    const t = ev.target;
    if (!t.closest || !t.closest("#view-admin, #modal")) return;
    const ur = t.closest("[data-users-role]"); if (ur) { A.role = ur.dataset.usersRole; document.querySelectorAll("[data-users-role]").forEach((b) => b.setAttribute("aria-selected", String(b === ur))); return drawUsers(); }
    const lg = t.closest("[data-admin-log]"); if (lg) return renderAdmin("log", lg.dataset.adminLog);
    const up = t.closest("[data-uperm]"); if (up) return permForm(up.closest("tr").dataset.uid);
    const uv = t.closest("[data-uverify]");
    if (uv) { try { await api("user_update", { id: uv.closest("tr").dataset.uid, verified: "1" }); toast("Adresse confirmée.", "good"); renderAdmin("users"); } catch (e) { toast(e.message, "bad"); } return; }
    const rd = t.closest("[data-role-del]");
    if (rd) {
      if (!confirm("Supprimer ce rôle ? Ses membres redeviendront de simples membres.")) return;
      try { await api("role_delete", { slug: rd.dataset.roleDel }); toast("Rôle supprimé.", "good"); await refreshSite(); renderAdmin("roles"); } catch (e) { toast(e.message, "bad"); }
      return;
    }
    const row = t.closest("[data-coupon]");
    if (row && t.closest("[data-coupon-edit]")) {
      const box = $("coupon-edit"), c = JSON.parse(row.dataset.coupon);
      box.innerHTML = `<h3>Modifier le code ${esc(c.code)}</h3>${couponForm(c)}`;
      box.scrollIntoView({ behavior: "smooth", block: "start" }); return;
    }
    if (row && t.closest("[data-coupon-toggle]")) {
      const c = JSON.parse(row.dataset.coupon);
      try { await api("coupon_save", { ...c, active: +c.active ? "0" : "1" }); toast(+c.active ? "Code désactivé." : "Code activé.", "good"); await refreshSite(); renderAdmin("coupons"); } catch (e) { toast(e.message, "bad"); }
      return;
    }
    if (row && t.closest("[data-coupon-del]")) {
      if (!confirm("Supprimer définitivement ce code promo ?")) return;
      try { await api("coupon_delete", { id: JSON.parse(row.dataset.coupon).id }); toast("Code supprimé.", "good"); await refreshSite(); renderAdmin("coupons"); } catch (e) { toast(e.message, "bad"); }
      return;
    }
    if (t.closest("[data-search-run]")) {
      const b = t.closest("[data-search-run]"); b.disabled = true;
      try { const r = await api("search_run", {}); toast(r.message, "good"); setTimeout(drawSearchStatus, 4000); } catch (e) { toast(e.message, "bad"); b.disabled = false; }
      return;
    }
    if (t.closest("[data-coupon-new]")) { $("coupon-edit").innerHTML = `<h3>Nouveau code promo</h3>${couponForm()}`; return; }
    const pr = t.closest("[data-partner]");
    if (pr && t.closest("[data-partner-edit]")) {
      const p = JSON.parse(pr.dataset.partner), box = $("partner-edit");
      box.innerHTML = `<h3>Modifier ${esc(p.shop)}</h3>${partnerForm(p)}`; box.scrollIntoView({ behavior: "smooth", block: "start" }); return;
    }
    if (pr && t.closest("[data-partner-toggle]")) {
      const p = JSON.parse(pr.dataset.partner);
      try { await api("partner_save", { ...p, active: +p.active ? "0" : "1" }); toast(+p.active ? "Partenaire en pause." : "Partenaire activé.", "good"); await refreshSite(); renderAdmin("partners"); } catch (e) { toast(e.message, "bad"); }
      return;
    }
    if (pr && t.closest("[data-partner-del]")) {
      if (!confirm("Retirer cette boutique des partenaires ? Ses liens redeviendront des liens normaux.")) return;
      try { await api("partner_delete", { id: JSON.parse(pr.dataset.partner).id }); toast("Partenaire retiré.", "good"); await refreshSite(); renderAdmin("partners"); } catch (e) { toast(e.message, "bad"); }
      return;
    }
    if (t.closest("[data-partner-new]")) $("partner-edit").innerHTML = `<h3>Nouvelle boutique partenaire</h3>${partnerForm()}`;
  });
  document.addEventListener("input", (ev) => {
    if (ev.target.matches("[data-users-q]")) { A.q = ev.target.value; drawUsers(); }
    // Partner form: the shop's domain is taken from its offers
    if (ev.target.matches("[data-partner-form] [name=shop]")) {
      const dom = ev.target.form.domain, o = Object.values(C.prices || {}).flatMap((x) => x.offers || []).find((x) => x.shop === ev.target.value);
      if (o && !dom.value) dom.value = hostOf(o.url);
    }
  });
  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    if (!f.matches("[data-perm-form], [data-role-form], [data-coupon-form], [data-settings-form], [data-partner-form]")) return;
    ev.preventDefault();
    const d = formData(f), btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      if (f.dataset.permForm) {
        const payload = { id: f.dataset.permForm, note: d.note || "" };
        if (can("assign")) {
          const keys = Object.keys(d).filter((k) => k.startsWith("p_"));
          payload.grant = keys.filter((k) => d[k] === "grant").map((k) => k.slice(2));
          payload.deny = keys.filter((k) => d[k] === "deny").map((k) => k.slice(2));
        }
        await api("user_update", payload);
        closeModal(); toast("Membre mis à jour.", "good"); renderAdmin("users");
      } else if (f.matches("[data-role-form]")) {
        await api("role_save", { slug: f.dataset.roleForm || "", label: d.label, color: d.color || "", perms: readPerms(f) });
        toast(f.dataset.roleForm ? "Rôle enregistré." : "Rôle créé.", "good");
        await refreshSite(); renderAdmin("roles");
      } else if (f.matches("[data-coupon-form]")) {
        await api("coupon_save", { ...d, active: f.active.checked ? "1" : "0" });
        toast(d.id ? "Code promo enregistré." : "Code promo créé.", "good");
        await refreshSite(); renderAdmin("coupons");
      } else if (f.matches("[data-partner-form]")) {
        await api("partner_save", { ...d, active: f.active.checked ? "1" : "0" });
        toast(d.id ? "Partenaire enregistré." : "Boutique partenaire ajoutée.", "good");
        await refreshSite(); renderAdmin("partners");
      } else if (f.matches("[data-settings-form]")) {
        const r = await api("settings_save", { ...d, announce_on: f.announce_on.checked ? "1" : "0", registrations: f.registrations.checked ? "1" : "0", comments: f.comments.checked ? "1" : "0" });
        toast(r.message, "good");
        await refreshSite(); drawAnnounce();
      }
    } catch (e) { showErr(f, e.message); }
    finally { btn.disabled = false; }
  });

  // ---------------------------------------------------------------- profiles
  const COLORS = ["#111111", "#ff5757", "#ff9f1c", "#2ec4b6", "#3a86ff", "#8338ec", "#06a77d", "#e63973"];
  const FLYING = ["Racing", "Freestyle", "Long Range", "Cinematic", "Cinewhoop", "Toothpick", "Whoop", "Aile volante", "Avion", "Hélicoptère"];
  const LEVELS = ["Débutant", "Intermédiaire", "Confirmé", "Expert", "Pro"];
  const SIZES = ["Whoop", "2″", "2,5″", "3″", "3,5″", "4″", "5″", "6″", "7″", "8″ et +"];
  const VIDEO = ["DJI O4", "DJI O3", "DJI Vista / Air Unit", "Walksnail", "HDZero", "Analogique"];
  // Banners without a picture: drawn in CSS from the member's colour (.bn-* in style.css)
  const BANNERS = [["couleur", "Couleur"], ["coucher", "Coucher de soleil"], ["ocean", "Océan"], ["foret", "Forêt"],
    ["nuit", "Nuit étoilée"], ["carbone", "Carbone"], ["circuit", "Circuit"], ["aurore", "Aurore"]];
  const autoColor = (name) => COLORS[[...(name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  // Our own picture addresses only: served by the API, or a picture being edited
  const imgSrc = (v, action) => v && (new RegExp(`^api/index\\.php\\?action=${action}&id=\\d+&v=\\d+$`).test(v) || /^data:image\/(png|jpeg|webp);base64,/.test(v)) ? v : "";
  // Photo, or initials on the member's colour (a colour derived from the name when none was chosen)
  function avatar(u, size = "md") {
    const name = (u && u.name) || "?";
    const color = (u && u.color) || autoColor(name);
    const src = imgSrc(u && u.avatar, "avatar");
    const ini = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    return src ? `<span class="av av-${size}"><img src="${esc(src)}" alt=""></span>`
      : `<span class="av av-${size}" style="--av:${esc(color)}" aria-hidden="true">${esc(ini)}</span>`;
  }
  const PICON = {
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
    yt: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
    ig: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".8" fill="currentColor"/></svg>',
    tt: '<svg viewBox="0 0 24 24"><path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.6 2.2 4.3 5 4.6"/></svg>',
    tw: '<svg viewBox="0 0 24 24"><path d="M5 3.5h15v10l-4 4h-4l-3 3v-3H5z"/><path d="M11 8v4M15.5 8v4"/></svg>',
    dc: '<svg viewBox="0 0 24 24"><path d="M7 7.5c3-1.3 7-1.3 10 0l1.5 9c-1.6 1.2-3.2 1.8-4.5 2l-1-2c-1.2.3-2.8.3-4 0l-1 2c-1.3-.2-2.9-.8-4.5-2z"/><circle cx="9.5" cy="12.5" r="1" fill="currentColor"/><circle cx="14.5" cy="12.5" r="1" fill="currentColor"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    fly: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8 8l8 8M16 8l-8 8"/></svg>',
    lvl: '<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>',
  };
  // Badges earned from what the member did on the site
  function badges(p) {
    const b = [], s = p.stats || {}, e = p.extra || {};
    if (p.role === "admin") b.push(["Administrateur", "gold"]); else if (p.role === "moderator") b.push(["Modérateur", "gold"]); else if (p.role && p.role !== "user") b.push([roleLabel(p.role), "gold"]);
    if (s.approved >= 10) b.push(["Expert catalogue", "gold"]); else if (s.approved >= 1) b.push(["Contributeur", "blue"]);
    if (s.comments >= 10) b.push(["Pilote bavard", "green"]); else if (s.comments >= 1) b.push(["A donné son avis", "green"]);
    if ((p.setup || []).length) b.push(["Setup partagé", "purple"]);
    if ((p.garage || []).length >= 10) b.push(["Hangar bien rempli", "purple"]);
    if (s.likes >= 20) b.push(["Collectionneur", "red"]);
    if (e.pilot_since && new Date().getFullYear() - e.pilot_since >= 5) b.push(["Vétéran du FPV", "gold"]);
    const days = p.since ? (Date.now() - new Date(p.since.replace(" ", "T") + "Z")) / 864e5 : 0;
    if (days > 365) b.push(["Membre depuis plus d'un an", "grey"]);
    return b;
  }
  const motorCardHtml = (ref) => motorCard(ref);
  const motorCard = (ref) => {
    const m = motorBy(ref);
    if (!m) return "";
    return `<a class="pm-card" href="#m/${encodeURIComponent(m.REF)}"><span class="pm-img">${MM().photo(m)}</span>
      <span class="pm-brand">${MM().brandMark(m)}</span><b>${esc(m.NOM || m.REF)}</b><small>${[m.CLASSE, m.KV ? `${m.KV} KV` : ""].filter(Boolean).map(esc).join(" · ")}</small></a>`;
  };
  const yearsSince = (y) => { const n = new Date().getFullYear() - y; return n < 1 ? "cette année" : `${n} an${n > 1 ? "s" : ""}`; };

  // Banner, photo, name and main details: the public page and the live preview of the editor
  function profileHead(p, preview = false) {
    const color = p.color || autoColor(p.name), e = p.extra || {};
    const since = p.since ? new Date(p.since.replace(" ", "T") + "Z").toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : "";
    const img = imgSrc(p.banner, "banner");
    const preset = BANNERS.some(([k]) => k === p.banner_preset) ? p.banner_preset : "couleur";
    const styles = (e.styles && e.styles.length ? e.styles : [p.flying]).filter(Boolean);
    return `
      <header class="pf-head" style="--pf:${esc(color)}">
        <div class="pf-banner ${img ? "bn-image" : `bn-${preset}`}"${img ? ` style="background-image:url('${esc(img)}')"` : ""}></div>
        <div class="pf-id">
          ${avatar(p, "xl")}
          <div class="pf-name">
            <h1>${esc(p.name)}</h1>${p.role && p.role !== "user" ? `<em class="pf-role">${esc(roleLabel(p.role))}</em>` : ""}${e.level ? `<em class="pf-level">${PICON.lvl}${esc(e.level)}</em>` : ""}
            <p class="pf-meta">${since ? `<span>${PICON.cal}Membre depuis ${esc(since)}</span>` : ""}${p.location ? `<span>${PICON.pin}${esc(p.location)}</span>` : ""}${styles.length ? `<span>${PICON.fly}${esc(styles.join(" · "))}</span>` : ""}${e.pilot_since ? `<span>${PICON.lvl}Pilote depuis ${esc(e.pilot_since)}</span>` : ""}</p>
          </div>
          ${p.mine && !preview ? `<a class="btn-dark pf-edit" href="#profil">Modifier mon profil</a>` : ""}
        </div>
      </header>`;
  }

  async function renderProfile(id) {
    const v = $("view-profile");
    v.hidden = false;
    v.innerHTML = `<div class="pf-wrap"><p class="note">Chargement du profil…</p></div>`;
    if (!C.online && !DEMO) { v.innerHTML = `<div class="pf-wrap"><p class="note">Les profils seront disponibles dès que le serveur du site sera configuré.</p></div>`; return; }
    let p;
    try { p = await get("profile", { id }); } catch (e) { v.innerHTML = `<div class="pf-wrap"><p class="note">${esc(e.message)}</p><p><a class="ghost-btn" href="#">Retour au catalogue</a></p></div>`; return; }
    document.title = `${p.name} — Multi-Motors`;
    const head = profileHead(p);
    if (p.private) { v.innerHTML = `<div class="pf-wrap">${head}<section class="card"><p class="note">Ce profil est privé.</p></section></div>`; return; }
    const s = p.stats || {}, e = p.extra || {};
    const link = (url, icon, label) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener nofollow ugc" class="pf-link">${PICON[icon]}<span>${esc(label)}</span></a>` : "";
    const short = (url) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    const links = link(p.website, "web", short(p.website || "")) + link(p.youtube, "yt", "YouTube") + link(p.instagram, "ig", "Instagram")
      + link(e.tiktok, "tt", "TikTok") + link(e.twitch, "tw", "Twitch")
      + (e.discord ? `<button type="button" class="pf-link" data-copy="${esc(e.discord)}" title="Copier le pseudo Discord">${PICON.dc}<span>${esc(e.discord)}</span></button>` : "");
    const chips = (list) => `<div class="pf-tags">${list.map((x) => `<span>${esc(x)}</span>`).join("")}</div>`;
    const row = (label, value) => value ? `<div class="pf-dl"><dt>${label}</dt><dd>${value}</dd></div>` : "";
    const pilot = row("Niveau", esc(e.level || "")) + row("Pilote depuis", e.pilot_since ? `${esc(e.pilot_since)} <small>(${yearsSince(e.pilot_since)})</small>` : "")
      + row("Styles", (e.styles || []).length ? chips(e.styles) : "") + row("Tailles", (e.sizes || []).length ? chips(e.sizes) : "");
    const gear = row("Vidéo", esc(e.video || "")) + row("Radio", esc(e.radio || "")) + row("Lunettes", esc(e.goggles || ""))
      + row("Mes drones", e.drones ? esc(e.drones).replace(/\n/g, "<br>") : "");
    v.innerHTML = `<div class="pf-wrap">${head}
      <div class="pf-grid">
        <aside class="pf-side">
          <section class="card pf-about">
            ${p.bio ? `<p class="pf-bio">${esc(p.bio).replace(/\n/g, "<br>")}</p>` : `<p class="note">${p.mine ? "Ajoutez une courte présentation depuis « Modifier mon profil »." : "Pas encore de présentation."}</p>`}
            ${links ? `<div class="pf-links">${links}</div>` : ""}
          </section>
          ${pilot ? `<section class="card"><h3 class="pf-h">Pilote</h3><dl class="pf-dls">${pilot}</dl></section>` : ""}
          ${gear ? `<section class="card"><h3 class="pf-h">Matériel</h3><dl class="pf-dls">${gear}</dl></section>` : ""}
          <section class="card pf-stats">
            <div><b>${s.comments || 0}</b><span>avis</span></div>
            <div><b>${(p.garage || []).length}</b><span>moteurs</span></div>
            <div><b>${s.approved || 0}</b><span>corrections validées</span></div>
            <div><b>${s.likes || 0}</b><span>j'aime</span></div>
          </section>
          ${badges(p).length ? `<section class="card"><h3 class="pf-h">Badges</h3><div class="pf-badges">${badges(p).map(([t, c]) => `<span class="pf-badge b-${c}">${esc(t)}</span>`).join("")}</div></section>` : ""}
        </aside>
        <div class="pf-main">
          <section class="card"><h3 class="pf-h">Mon setup <small>${(p.setup || []).length} moteur${(p.setup || []).length > 1 ? "s" : ""}</small></h3>
            ${(p.setup || []).length ? `<div class="pm-grid">${p.setup.map(motorCard).join("")}</div>` : `<p class="note">${p.mine ? "Ajoutez les moteurs que vous utilisez depuis « Modifier mon profil »." : "Aucun moteur partagé pour l'instant."}</p>`}</section>
          ${(p.garage || []).length ? `<section class="card"><h3 class="pf-h">Mes moteurs <small>${p.garage.length}</small></h3>
            ${["owned", "tested"].map((k) => { const g = p.garage.filter((x) => x.status === k); return g.length ? `<p class="pf-sub">${k === "owned" ? "Possédés" : "Testés"}</p><div class="pm-grid small">${g.map((x) => motorCard(x.ref).replace("</a>", x.note ? `<em class="sp-note">« ${esc(x.note)} »</em></a>` : "</a>")).join("")}</div>` : ""; }).join("")}</section>` : ""}
          ${p.likes && p.likes.length ? `<section class="card"><h3 class="pf-h">Moteurs aimés <small>${p.likes.length}</small></h3><div class="pm-grid small">${p.likes.map(motorCard).join("")}</div></section>` : ""}
          <section class="card"><h3 class="pf-h">Derniers avis</h3>
            ${(p.comments || []).length ? `<div class="pf-comments">${p.comments.map((c) => `<a class="pf-c" href="#m/${encodeURIComponent(c.ref)}"><span class="pf-c-m">${esc(motorName(c.ref))}</span><p>${esc(c.body.length > 220 ? c.body.slice(0, 220) + "…" : c.body)}</p><time>${when(c.at)}</time></a>`).join("")}</div>`
              : `<p class="note">Pas encore d'avis publié.</p>`}</section>
        </div>
      </div></div>`;
  }

  // Edit page: profile, account and privacy
  // avatar / banner: undefined = unchanged, "" = removed, data URL = new picture; avSrc / bnSrc: the original to frame again
  const P = { tab: "profil", setup: [], avatar: undefined, banner: undefined, color: "", preset: "couleur", styles: [], sizes: [], avSrc: "", bnSrc: "" };
  async function renderProfileEdit(tab) {
    const v = $("view-profile");
    v.hidden = false;
    if (!C.user) { v.innerHTML = `<div class="pf-wrap"><section class="card"><p class="note">Connectez-vous pour modifier votre profil.</p><p><button type="button" class="btn-dark" data-login>Connexion</button></p></section></div>`; return; }
    if (tab) P.tab = tab;
    let p = {};
    try { p = await get("profile", { id: C.user.id }); } catch (e) { /* profile not created yet */ }
    const e = p.extra || {};
    Object.assign(P, { setup: [...(p.setup || [])], avatar: undefined, banner: undefined, color: p.color || "", preset: p.banner_preset || "couleur",
      styles: [...(e.styles || (p.flying ? [p.flying] : []))], sizes: [...(e.sizes || [])], avSrc: "", bnSrc: "" });
    const tabs = [["profil", "Profil"], ["compte", "Compte"], ["confidentialite", "Confidentialité"]];
    const sel = (a, b) => (a === b ? " selected" : "");
    const multi = (name, list, on) => `<div class="pf-pick" data-pf-multi="${name}">${list.map((x) => `<button type="button" data-pf-opt="${esc(x)}" aria-pressed="${on.includes(x)}">${esc(x)}</button>`).join("")}</div>`;
    const year = new Date().getFullYear();
    v.innerHTML = `<div class="pf-wrap pf-editor">
      <div class="pf-edit-top"><h1>Mon profil</h1><a class="ghost-btn" href="#u/${C.user.id}">Voir mon profil public →</a></div>
      <div class="pf-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-pf-tab="${k}" aria-selected="${P.tab === k}">${l}</button>`).join("")}</div>

      <form class="pf-form pf-form-profile" data-pf="profil" ${P.tab === "profil" ? "" : "hidden"}>
        <div class="pf-preview" aria-label="Aperçu de votre profil"><span class="pf-preview-tag">Aperçu</span><div id="pf-preview"></div></div>

        <section class="card pf-sec">
          <h3 class="pf-h">Bannière</h3>
          <div class="pf-banners">${BANNERS.map(([k, l]) => `<button type="button" class="pf-bn bn-${k}" data-pf-banner="${k}" aria-pressed="false" title="${esc(l)}"><span>${esc(l)}</span></button>`).join("")}</div>
          <div class="pf-btns">
            <label class="btn-dark pf-file">Importer une image<input type="file" id="pf-bfile" accept="image/png,image/jpeg,image/webp" hidden></label>
            <button type="button" class="ghost-btn" data-pf-crop="banner">Recadrer</button>
            <button type="button" class="ghost-btn" data-pf-nobanner>Retirer l'image</button>
          </div>
          <p class="pf-hint">Une image large (format 3:1), recadrée comme vous le souhaitez. Sans image, le motif choisi prend votre couleur.</p>
        </section>

        <section class="card pf-sec">
          <h3 class="pf-h">Photo et couleur</h3>
          <div class="pf-av-edit">
            <span id="pf-av-prev"></span>
            <div>
              <div class="pf-btns">
                <label class="btn-dark pf-file">Choisir une photo<input type="file" id="pf-file" accept="image/png,image/jpeg,image/webp" hidden></label>
                <button type="button" class="ghost-btn" data-pf-crop="avatar">Recadrer</button>
                <button type="button" class="ghost-btn" data-pf-noavatar>Retirer la photo</button>
              </div>
              <p class="pf-hint">PNG, JPEG ou WebP : vous choisissez le cadrage avant d'enregistrer.</p>
              <p class="pf-label">Couleur du profil</p>
              <div class="pf-colors">${COLORS.map((c) => `<button type="button" class="pf-color" data-pf-color="${c}" style="--c:${c}" aria-label="Couleur ${c}" aria-pressed="${P.color === c}"></button>`).join("")}</div>
            </div>
          </div>
        </section>

        <section class="card pf-sec">
          <h3 class="pf-h">À propos</h3>
          <label>Présentation <span class="pf-count" data-for="bio">${(p.bio || "").length}/280</span><textarea name="bio" maxlength="280" rows="3" placeholder="Pilote FPV depuis 2019, freestyle et long range…">${esc(p.bio || "")}</textarea></label>
          <div class="pf-3">
            <label>Localisation<input name="location" maxlength="60" value="${esc(p.location || "")}" placeholder="Lyon, France"></label>
            <label>Pilote depuis<select name="pilot_since"><option value="">—</option>${Array.from({ length: year - 1999 }, (_, i) => year - i).map((y) => `<option${sel(e.pilot_since, y)}>${y}</option>`).join("")}</select></label>
            <label>Niveau<select name="level"><option value="">—</option>${LEVELS.map((l) => `<option${sel(e.level, l)}>${esc(l)}</option>`).join("")}</select></label>
          </div>
        </section>

        <section class="card pf-sec">
          <h3 class="pf-h">Pilotage</h3>
          <p class="pf-label">Types de vol <small>(le premier choisi est affiché sous votre nom)</small></p>
          ${multi("styles", FLYING, P.styles)}
          <p class="pf-label">Tailles de drone</p>
          ${multi("sizes", SIZES, P.sizes)}
        </section>

        <section class="card pf-sec">
          <h3 class="pf-h">Matériel</h3>
          <div class="pf-3">
            <label>Système vidéo<select name="video"><option value="">—</option>${VIDEO.map((x) => `<option${sel(e.video, x)}>${esc(x)}</option>`).join("")}</select></label>
            <label>Radio<input name="radio" maxlength="60" value="${esc(e.radio || "")}" placeholder="RadioMaster TX16S"></label>
            <label>Lunettes<input name="goggles" maxlength="60" value="${esc(e.goggles || "")}" placeholder="DJI Goggles 3"></label>
          </div>
          <label>Mes drones <span class="pf-count" data-for="drones">${(e.drones || "").length}/400</span><textarea name="drones" maxlength="400" rows="3" placeholder="Un drone par ligne : châssis, moteurs, hélices…">${esc(e.drones || "")}</textarea></label>
        </section>

        <section class="card pf-sec">
          <h3 class="pf-h">Liens</h3>
          <div class="pf-3">
            <label>Site web<input name="website" inputmode="url" maxlength="200" value="${esc(p.website || "")}" placeholder="monsite.fr"></label>
            <label>YouTube<input name="youtube" inputmode="url" maxlength="200" value="${esc(p.youtube || "")}" placeholder="youtube.com/@pseudo"></label>
            <label>Instagram<input name="instagram" inputmode="url" maxlength="200" value="${esc(p.instagram || "")}" placeholder="instagram.com/pseudo"></label>
            <label>TikTok<input name="tiktok" inputmode="url" maxlength="200" value="${esc(e.tiktok || "")}" placeholder="tiktok.com/@pseudo"></label>
            <label>Twitch<input name="twitch" inputmode="url" maxlength="200" value="${esc(e.twitch || "")}" placeholder="twitch.tv/pseudo"></label>
            <label>Discord<input name="discord" maxlength="40" value="${esc(e.discord || "")}" placeholder="pseudo"></label>
          </div>
        </section>

        <section class="card pf-sec pf-setup-edit">
          <h3 class="pf-h">Mon setup <small>8 moteurs au maximum</small></h3>
          <div class="pf-setup-chips" id="pf-setup"></div>
          <div class="pf-search"><input id="pf-motor-q" type="search" placeholder="Ajouter un moteur : marque, modèle, classe…" autocomplete="off"><div class="pf-results" id="pf-results" hidden></div></div>
        </section>
        <p class="m-error" role="alert" hidden></p>
        <div class="pf-actions pf-sticky"><button class="btn-red" type="submit">Enregistrer le profil</button></div>
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
      <section class="card pf-form" data-pf="export" ${P.tab === "compte" ? "" : "hidden"}>
        <h3 class="pf-h">Mes données</h3>
        <p class="pf-hint">Téléchargez tout ce que Multi-Motors garde sur vous (compte, profil, j'aime, moteurs, historique, avis, corrections) dans un fichier. Voir la <a href="confidentialite.html">politique de confidentialité</a>.</p>
        <div class="pf-actions"><a class="ghost-btn" href="api/index.php?action=my_data" download>Télécharger mes données</a></div>
      </section>
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
    refreshAvatarPreview();
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
  // The picture chosen by the member, framed by hand: drag to move, wheel / slider to zoom.
  // Resolves with the framed picture (WebP, or JPEG on a white background where WebP can't be made), null if cancelled.
  function cropImage(src, { ratio, w, h, round, maxBytes }) {
    return new Promise((resolve) => {
      const d = modal(`<div class="crop">
        <h2 class="crop-title">${round ? "Cadrer la photo" : "Cadrer la bannière"}</h2>
        <div class="crop-stage${round ? " round" : ""}" style="aspect-ratio:${ratio}"><img alt="" draggable="false"></div>
        <label class="crop-zoom"><span>−</span><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"><span>+</span></label>
        <p class="pf-hint">Faites glisser l'image pour choisir la partie visible, zoomez avec le curseur ou la molette.</p>
        <div class="crop-actions"><button type="button" class="ghost-btn" data-crop="cancel">Annuler</button><button type="button" class="btn-red" data-crop="ok">Valider le cadrage</button></div>
      </div>`, "crop-modal");
      const stage = d.querySelector(".crop-stage"), img = stage.querySelector("img"), zoom = d.querySelector("input[type=range]");
      let nw = 0, nh = 0, base = 1, s = 1, x = 0, y = 0, done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); if (d.open) closeModal(); };
      const place = () => {
        const W = stage.clientWidth, H = stage.clientHeight, k = base * s;
        const mx = Math.max(0, (nw * k - W) / 2), my = Math.max(0, (nh * k - H) / 2);
        x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
        img.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${k})`;
      };
      img.onload = () => { nw = img.naturalWidth; nh = img.naturalHeight; img.style.width = `${nw}px`; base = Math.max(stage.clientWidth / nw, stage.clientHeight / nh); place(); stage.classList.add("ready"); };
      img.onerror = () => { toast("Image illisible.", "bad"); finish(null); };
      img.src = src;
      const zoomTo = (v) => { s = Math.min(4, Math.max(1, v)); zoom.value = s; place(); };
      zoom.addEventListener("input", () => zoomTo(+zoom.value));
      stage.addEventListener("wheel", (ev) => { ev.preventDefault(); zoomTo(s * Math.exp(-ev.deltaY * 0.0015)); }, { passive: false });
      let drag = null;
      stage.addEventListener("pointerdown", (ev) => { drag = { px: ev.clientX, py: ev.clientY, x, y }; stage.setPointerCapture(ev.pointerId); stage.classList.add("dragging"); });
      stage.addEventListener("pointermove", (ev) => { if (!drag) return; x = drag.x + ev.clientX - drag.px; y = drag.y + ev.clientY - drag.py; place(); });
      const up = () => { drag = null; stage.classList.remove("dragging"); };
      stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
      d.addEventListener("close", () => finish(null), { once: true });
      d.querySelector('[data-crop="cancel"]').addEventListener("click", () => finish(null));
      d.querySelector('[data-crop="ok"]').addEventListener("click", () => {
        if (!nw) return;
        const W = stage.clientWidth, H = stage.clientHeight, k = base * s;
        const left = W / 2 + x - (nw * k) / 2, top = H / 2 + y - (nh * k) / 2;
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const draw = (white) => { const g = c.getContext("2d"); g.clearRect(0, 0, w, h); if (white) { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); } g.drawImage(img, -left / k, -top / k, W / k, H / k, 0, 0, w, h); };
        draw(false);
        let out = "";
        for (const q of [0.88, 0.8, 0.7, 0.6, 0.5]) {
          out = c.toDataURL("image/webp", q);
          if (!out.startsWith("data:image/webp")) { draw(true); out = c.toDataURL("image/jpeg", q); }
          if (out.length * 0.75 <= maxBytes) break;
        }
        finish(out);
      });
    });
  }
  // A file picked by the member -> framing window -> new picture of the editor
  async function pickImage(file, kind) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast("Image refusée : PNG, JPEG ou WebP uniquement.", "bad");
    const url = URL.createObjectURL(file);
    const ok = await frameImage(url, kind);
    if (ok) { if (kind === "avatar") { if (P.avSrc) URL.revokeObjectURL(P.avSrc); P.avSrc = url; } else { if (P.bnSrc) URL.revokeObjectURL(P.bnSrc); P.bnSrc = url; } }
    else URL.revokeObjectURL(url);
  }
  async function frameImage(src, kind) {
    const out = await cropImage(src, kind === "avatar" ? { ratio: "1 / 1", w: 400, h: 400, round: true, maxBytes: 190000 }
      : { ratio: "3 / 1", w: 1500, h: 500, round: false, maxBytes: 430000 });
    if (!out) return false;
    if (kind === "avatar") P.avatar = out; else P.banner = out;
    refreshAvatarPreview();
    return true;
  }
  // The data shown by the live preview: what is saved, changed by what is being edited
  function previewData() {
    const f = document.querySelector('[data-pf="profil"]'), p = P.profile || {};
    const val = (n) => (f && f.elements[n] ? f.elements[n].value.trim() : "");
    return { ...p, name: C.user.name, role: C.user.role, color: P.color, mine: true,
      avatar: P.avatar === undefined ? C.user.avatar : P.avatar, banner: P.banner === undefined ? p.banner : P.banner, banner_preset: P.preset,
      location: val("location"), flying: P.styles[0] || "", extra: { level: val("level"), pilot_since: val("pilot_since"), styles: P.styles } };
  }
  const refreshAvatarPreview = () => {
    const prev = $("pf-av-prev");
    if (!prev) return;
    const d = previewData();
    prev.innerHTML = avatar(d, "xl");
    $("pf-preview").innerHTML = profileHead(d, true);
    document.querySelectorAll("[data-pf-banner]").forEach((b) => { b.style.setProperty("--pf", P.color || autoColor(C.user.name)); b.setAttribute("aria-pressed", String(!imgSrc(d.banner, "banner") && b.dataset.pfBanner === P.preset)); });
    const hasBanner = !!imgSrc(d.banner, "banner"), hasAv = !!imgSrc(d.avatar, "avatar");
    document.querySelector('[data-pf-crop="banner"]').hidden = !hasBanner; document.querySelector("[data-pf-nobanner]").hidden = !hasBanner;
    document.querySelector('[data-pf-crop="avatar"]').hidden = !hasAv; document.querySelector("[data-pf-noavatar]").hidden = !hasAv;
  };

  // ---------------------------------------------------------------- routing
  hooks.route = (h) => {
    ["view-actus", "view-admin", "view-profile"].forEach((id) => ($(id).hidden = true));
    if (/^#u\/\d+$/.test(h)) { renderProfile(+h.slice(3)); window.scrollTo(0, 0); return true; }
    if (/^#moi(\/\w+)?$/.test(h)) { renderSpace(h.split("/")[1]); window.scrollTo(0, 0); return true; }
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
    if (/^#(u\/\d+|profil|moi)/.test(location.hash)) return hooks.route(location.hash);
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
    if (t.closest("[data-resend-verify]")) {
      try { toast((await api("resend_verify", {})).message, "good"); } catch (e) { toast(e.message, "bad"); }
      return;
    }
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
    const cc = t.closest("[data-coupon-copy]");
    if (cc) {
      try { await navigator.clipboard.writeText(cc.dataset.code); toast(`Code ${cc.dataset.code} copié.`, "good"); } catch (e) { toast(`Code promo : ${cc.dataset.code}`); }
      cc.textContent = "Copié ✓";
      if (C.online) api("coupon_use", { id: cc.dataset.couponCopy }).catch(() => {});
      return;
    }
    if (t.closest("[data-announce-off]")) {
      try { localStorage.setItem("mm-announce-off", textKey(C.site.announce?.text || "")); } catch (e) { /* this page only */ }
      document.querySelector(".mm-announce")?.remove(); return;
    }
    const cd = t.closest("[data-cdel]");
    if (cd) { try { await api("comment_delete", { id: cd.dataset.cdel }); loadSocial($("detail").dataset.ref); } catch (e) { toast(e.message, "bad"); } return; }
    const cm = t.closest("[data-cmod]");
    if (cm) {
      try { await api("moderate_comment", { id: cm.dataset.cmod, status: cm.dataset.status }); toast("Commentaire mis à jour.", "good"); }
      catch (e) { toast(e.message, "bad"); }
      return location.hash === "#admin" ? renderAdmin("comments") : loadSocial($("detail").dataset.ref);
    }
    const gs = t.closest("[data-gset]");
    if (gs) {
      if (!C.user) return authForm("login");
      const box = gs.closest("[data-garage]"), on = gs.getAttribute("aria-pressed") === "true";
      try {
        await api("garage_set", { ref: box.dataset.garage, status: on ? "" : gs.dataset.gset, note: box.querySelector("[data-gnote]")?.value || "" });
        toast(on ? "Retiré de vos moteurs." : `Ajouté à vos moteurs : ${GARAGE[gs.dataset.gset][1].toLowerCase()}.`, "good");
        loadSocial(box.dataset.garage);
      } catch (e) { toast(e.message, "bad"); }
      return;
    }
    const spt = t.closest("[data-sp-tab]"); if (spt) return renderSpace(spt.dataset.spTab);
    if (t.closest("[data-hclear]")) {
      try { localStorage.removeItem(LOCAL_HISTORY); } catch (e) { /* ignore */ }
      if (C.user && C.online) await api("history_clear", {}).catch(() => {});
      toast("Historique effacé.", "good"); return renderSpace("historique");
    }
    const pt = t.closest("[data-pf-tab]");
    if (pt) {
      P.tab = pt.dataset.pfTab;
      document.querySelectorAll("[data-pf-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === pt)));
      document.querySelectorAll("[data-pf]").forEach((f) => (f.hidden = !(f.dataset.pf === P.tab || (P.tab === "compte" && ["supprimer", "export"].includes(f.dataset.pf)))));
      return;
    }
    const pc = t.closest("[data-pf-color]");
    if (pc) { P.color = pc.dataset.pfColor; document.querySelectorAll("[data-pf-color]").forEach((b) => b.setAttribute("aria-pressed", String(b === pc))); return refreshAvatarPreview(); }
    if (t.closest("[data-pf-noavatar]")) { P.avatar = ""; P.avSrc = ""; return refreshAvatarPreview(); }
    if (t.closest("[data-pf-nobanner]")) { P.banner = ""; P.bnSrc = ""; return refreshAvatarPreview(); }
    const pb = t.closest("[data-pf-banner]");
    if (pb) { P.preset = pb.dataset.pfBanner; if (imgSrc(P.banner === undefined ? P.profile?.banner : P.banner, "banner")) P.banner = ""; return refreshAvatarPreview(); }
    const pcr = t.closest("[data-pf-crop]");
    if (pcr) {
      // Frame again: the original picked in this visit, or else the saved picture
      const k = pcr.dataset.pfCrop, d = previewData();
      return frameImage(k === "avatar" ? P.avSrc || d.avatar : P.bnSrc || d.banner, k);
    }
    const po = t.closest("[data-pf-opt]");
    if (po) {
      const list = P[po.closest("[data-pf-multi]").dataset.pfMulti], v = po.dataset.pfOpt, i = list.indexOf(v);
      if (i >= 0) list.splice(i, 1); else list.push(v);
      po.setAttribute("aria-pressed", String(i < 0));
      return refreshAvatarPreview();
    }
    const cp = t.closest("[data-copy]");
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast("Pseudo Discord copié.", "good"); } catch (e) { toast(cp.dataset.copy); } return; }
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
    const bs = t.closest("[data-admin-bugs]"); if (bs) return renderAdmin("bugs", bs.dataset.adminBugs);
    const bu = t.closest("[data-bug-set]");
    if (bu) {
      const card = bu.closest("[data-bug]"), to = bu.dataset.bugSet;
      if (to === "deleted" && !confirm("Supprimer définitivement ce signalement ?")) return;
      try {
        await api("bug_update", { id: card.dataset.bug, status: to });
        card.classList.add("done");
        toast({ done: "Signalement marqué comme résolu.", rejected: "Signalement rejeté.", open: "Signalement rouvert.", deleted: "Signalement supprimé." }[to], "good");
        setTimeout(() => renderAdmin("bugs", $("view-admin").dataset.status || "open"), 300);
      } catch (e) { toast(e.message, "bad"); }
      return;
    }
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
    const na = t.closest("[data-n-all]"); if (na) return drawAll(na);
    const rd = t.closest("[data-rep-detail]"); if (rd) return openDetail(rd);
    const rm = t.closest("[data-rd-more]"); if (rm) { rm.previousElementSibling.querySelectorAll(":scope > li[hidden]").forEach((li) => (li.hidden = false)); rm.remove(); return; }
    const af = t.closest("[data-actus]");
    if (af) { document.querySelectorAll("[data-actus]").forEach((b) => b.setAttribute("aria-selected", String(b === af))); drawFeed(af.dataset.actus); }
  });

  document.addEventListener("input", (ev) => {
    if (ev.target.id === "pf-motor-q") searchMotors(ev.target.value);
    if (["bio", "drones"].includes(ev.target.name) && ev.target.closest("[data-pf]")) document.querySelector(`.pf-count[data-for="${ev.target.name}"]`).textContent = `${ev.target.value.length}/${ev.target.maxLength}`;
    if (ev.target.name === "location" && ev.target.closest('[data-pf="profil"]')) refreshAvatarPreview();
  });
  document.addEventListener("change", async (ev) => {
    if (ev.target.matches("[data-gnote]")) {
      const box = ev.target.closest("[data-garage]"), cur = box.querySelector("[data-gset][aria-pressed=true]");
      if (cur) { try { await api("garage_set", { ref: box.dataset.garage, status: cur.dataset.gset, note: ev.target.value }); toast("Note enregistrée.", "good"); } catch (e) { toast(e.message, "bad"); } }
      return;
    }
    if (ev.target.matches("[data-country]")) {
      chosenCountry = ev.target.value;
      try { localStorage.setItem("mm-country", ev.target.value); } catch (e) { /* storage blocked: this page only */ }
      const box = ev.target.closest("#d-prix"), m = motorBy(decodeURIComponent((location.hash.match(/^#m\/(.+)$/) || [])[1] || ""));
      if (box && m) { box.innerHTML = pricesBlock(m); box.querySelector("[data-country]")?.focus(); drawPriceHistory(m); }
      return;
    }
    if ((ev.target.id === "pf-file" || ev.target.id === "pf-bfile") && ev.target.files[0]) {
      const file = ev.target.files[0];
      ev.target.value = "";
      return pickImage(file, ev.target.id === "pf-file" ? "avatar" : "banner");
    }
    if (["level", "pilot_since"].includes(ev.target.name) && ev.target.closest('[data-pf="profil"]')) return refreshAvatarPreview();
    const r = ev.target.closest("[data-role]");
    if (r) { try { await api("user_update", { id: r.closest("tr").dataset.uid, role: r.value }); toast("Rôle modifié.", "good"); } catch (e) { toast(e.message, "bad"); } renderAdmin("users"); }
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
        await api("comment", { ref: f.dataset.comment, body: d.body || "", pros: d.pros || "", cons: d.cons || "", rating: d.rating || "" });
        toast("Avis publié, merci !", "good");
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
          const prof = f.dataset.pf === "profil";
          const src = prof ? { bio: d.bio, location: d.location, website: d.website, youtube: d.youtube, instagram: d.instagram }
            : { bio: p.bio, location: p.location, flying: p.flying, website: p.website, youtube: p.youtube, instagram: p.instagram };
          const priv = f.dataset.pf === "confidentialite" ? { is_public: f.is_public.checked ? "1" : "0", show_likes: f.show_likes.checked ? "1" : "0" }
            : { is_public: p.is_public === false ? "0" : "1", show_likes: p.show_likes === false ? "0" : "1" };
          const payload = { ...src, ...priv, color: P.color, setup: P.setup };
          if (prof) {
            payload.extra = { pilot_since: d.pilot_since, level: d.level, styles: P.styles, sizes: P.sizes, video: d.video, radio: d.radio, goggles: d.goggles,
              drones: d.drones, tiktok: d.tiktok, twitch: d.twitch, discord: d.discord, banner_preset: P.preset };
            if (P.avatar !== undefined) payload.avatar = P.avatar;
            if (P.banner !== undefined) payload.banner = P.banner;
          }
          r = await api("profile_save", payload);
          // Saved values as the server keeps them (links completed, banner address…)
          try { P.profile = await get("profile", { id: C.user.id }); } catch (e) { P.profile = { ...p, ...src, color: P.color, setup: P.setup }; }
          P.avatar = undefined; P.banner = undefined;
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
