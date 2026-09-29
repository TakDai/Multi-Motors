/* Multi-Motors: "report a bug" pill, bottom left of every page (catalogue and static pages).
   The form sends a category, a description and, when the visitor points at it, the element of the
   page that misbehaves (its CSS path, a piece of its HTML and its text) to api/index.php?action=bug_report;
   the reports are read in Administration > Bugs. Self-contained: its own styles, no dependency. */
(() => {
  "use strict";
  if (window.__mmBug) return;
  window.__mmBug = true;
  const API = "/api/index.php";
  const CATEGORIES = ["Affichage", "Fiche moteur", "Prix ou boutique", "Photo ou vidéo", "Recherche et filtres", "Compte et profil", "Lien cassé", "Autre"];
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7.5a4 4 0 0 1 8 0"/><rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 12v8M3.5 13H7M17 13h3.5M4.5 8.5 7.3 10M19.5 8.5 16.7 10M4.5 19l2.8-1.8M19.5 19l-2.8-1.8M9.5 5 8 3M14.5 5 16 3"/></svg>';
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const css = `
  .mmb-pill { position: fixed; left: 16px; bottom: 16px; z-index: 950; display: inline-flex; align-items: center; gap: 0; height: 44px; padding: 0 12px; border: 0; border-radius: 22px; background: #111; color: #fff; cursor: pointer; box-shadow: 0 8px 22px rgba(0,0,0,.22); font: 700 11px "Glacial Indifference", "Helvetica Neue", Arial, sans-serif; letter-spacing: .12em; text-transform: uppercase; transition: gap .25s, background-color .2s, transform .2s; }
  .mmb-pill svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; flex: none; }
  .mmb-pill span { max-width: 0; overflow: hidden; white-space: nowrap; transition: max-width .3s ease; }
  .mmb-pill:hover, .mmb-pill:focus-visible, .mmb-pill[aria-expanded="true"] { gap: 8px; background: #ff5757; }
  .mmb-pill:hover span, .mmb-pill:focus-visible span, .mmb-pill[aria-expanded="true"] span { max-width: 160px; }
  .mmb-panel { position: fixed; left: 16px; bottom: 72px; z-index: 951; width: min(390px, calc(100vw - 32px)); max-height: calc(100vh - 100px); overflow: auto; padding: 20px; border-radius: 16px; background: #fff; color: #111; box-shadow: 0 24px 60px rgba(0,0,0,.28); font: 400 14px/1.45 "Glacial Indifference", "Helvetica Neue", Arial, sans-serif; animation: mmb-in .2s ease-out; }
  @keyframes mmb-in { from { opacity: 0; transform: translateY(8px); } }
  .mmb-panel h2 { margin: 0 0 4px; font-family: inherit; font-weight: 700; font-size: 17px; letter-spacing: .08em; text-transform: uppercase; }
  .mmb-panel p.mmb-sub { margin: 0 0 14px; color: rgba(0,0,0,.55); font-size: 13px; }
  .mmb-close { position: absolute; top: 12px; right: 12px; width: 30px; height: 30px; border: 0; border-radius: 50%; background: #f1f1f1; cursor: pointer; font-size: 16px; line-height: 1; }
  .mmb-label { display: block; margin: 12px 0 6px; font-weight: 700; font-size: 12px; letter-spacing: .06em; color: rgba(0,0,0,.7); }
  .mmb-cats { display: flex; flex-wrap: wrap; gap: 6px; }
  .mmb-cats label { cursor: pointer; }
  .mmb-cats input { position: absolute; opacity: 0; pointer-events: none; }
  .mmb-cats span { display: inline-block; padding: 6px 11px; border: 1.5px solid rgba(0,0,0,.15); border-radius: 16px; font-weight: 700; font-size: 12px; transition: background-color .15s, border-color .15s, color .15s; }
  .mmb-cats input:checked + span { background: #111; border-color: #111; color: #fff; }
  .mmb-cats input:focus-visible + span { outline: 2px solid #ff5757; outline-offset: 2px; }
  .mmb-panel textarea, .mmb-panel input[type=email] { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1.5px solid rgba(0,0,0,.18); border-radius: 10px; font: inherit; color: inherit; background: #fff; }
  .mmb-panel textarea { min-height: 90px; resize: vertical; }
  .mmb-panel textarea:focus, .mmb-panel input:focus { outline: none; border-color: #111; }
  .mmb-pick { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 12px; padding: 10px 12px; border: 1.5px dashed rgba(0,0,0,.35); border-radius: 10px; background: #fafafa; cursor: pointer; font-family: inherit; font-weight: 700; font-size: 12px; letter-spacing: .06em; text-align: left; }
  .mmb-pick:hover { border-color: #111; }
  .mmb-pick svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; flex: none; }
  .mmb-picked { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: #fff3f3; font-size: 12px; }
  .mmb-picked code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 12px ui-monospace, Menlo, monospace; }
  .mmb-picked button { border: 0; background: none; cursor: pointer; font-size: 14px; }
  .mmb-actions { display: flex; justify-content: flex-end; margin-top: 14px; }
  .mmb-send { padding: 11px 20px; border: 0; border-radius: 10px; background: #ff5757; color: #fff; cursor: pointer; font-family: inherit; font-weight: 700; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
  .mmb-send[disabled] { opacity: .6; cursor: wait; }
  .mmb-msg { margin: 10px 0 0; font-size: 13px; }
  .mmb-msg.bad { color: #c62828; }
  .mmb-done { text-align: center; padding: 10px 0 4px; }
  .mmb-done b { display: block; margin-bottom: 6px; font-size: 16px; }
  .mmb-banner { position: fixed; top: 12px; left: 50%; z-index: 2147483000; transform: translateX(-50%); padding: 10px 18px; border-radius: 12px; background: #111; color: #fff; box-shadow: 0 10px 30px rgba(0,0,0,.3); font: 700 13px "Glacial Indifference", "Helvetica Neue", Arial, sans-serif; letter-spacing: .04em; white-space: nowrap; }
  .mmb-banner small { font-weight: 400; opacity: .7; margin-left: 8px; }
  .mmb-hl { position: fixed; z-index: 2147482999; pointer-events: none; border: 2px solid #ff5757; border-radius: 4px; background: rgba(255,87,87,.12); transition: all .06s; }
  .mmb-hl b { position: absolute; left: -2px; bottom: 100%; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px; border-radius: 4px 4px 0 0; background: #ff5757; color: #fff; font: 11px ui-monospace, Menlo, monospace; }
  html.mmb-picking, html.mmb-picking * { cursor: crosshair !important; }
  @media (max-width: 600px) { .mmb-pill { left: 12px; bottom: 12px; } .mmb-panel { left: 12px; right: 12px; width: auto; bottom: 66px; } .mmb-banner { white-space: normal; width: calc(100vw - 32px); text-align: center; } }
  @media print { .mmb-pill, .mmb-panel { display: none !important; } }`;
  document.head.insertAdjacentHTML("beforeend", `<style id="mmb-style">${css}</style>`);

  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "mmb-pill";
  pill.setAttribute("aria-expanded", "false");
  pill.setAttribute("aria-label", "Signaler un bug");
  pill.title = "Signaler un bug";
  pill.innerHTML = `${ICON}<span>Signaler un bug</span>`;
  document.body.appendChild(pill);

  let panel = null, picked = null;
  const own = (el) => el && (el.closest(".mmb-pill, .mmb-panel, .mmb-banner, .mmb-hl"));
  const signedIn = () => !!document.querySelector(".acct-btn");

  // A readable CSS path: id when there is one, else tag.classes:nth-of-type, up to 6 levels
  function cssPath(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 6; n = n.parentElement) {
      if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) { parts.unshift(`#${n.id}`); break; }
      let s = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((c) => /^[A-Za-z][\w-]*$/.test(c) && !c.startsWith("mmb")).slice(0, 2);
      if (cls.length) s += "." + cls.join(".");
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(n) + 1})`;
      parts.unshift(s);
    }
    return parts.join(" > ");
  }

  function open() {
    if (panel) return;
    panel = document.createElement("div");
    panel.className = "mmb-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Signaler un bug");
    panel.innerHTML = `
      <button type="button" class="mmb-close" aria-label="Fermer">✕</button>
      <form>
        <h2>Signaler un bug</h2>
        <p class="mmb-sub">Quelque chose ne marche pas ou s'affiche mal ? Dites-le-nous, nous corrigeons au plus vite.</p>
        <span class="mmb-label">Catégorie</span>
        <div class="mmb-cats">${CATEGORIES.map((c) => `<label><input type="radio" name="category" value="${esc(c)}" required><span>${esc(c)}</span></label>`).join("")}</div>
        <label class="mmb-label" for="mmb-body">Que se passe-t-il ?</label>
        <textarea id="mmb-body" name="body" maxlength="3000" required placeholder="Ce que vous avez fait, ce qui s'est passé, ce que vous attendiez…"></textarea>
        <button type="button" class="mmb-pick"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l6.5 16 2.2-6.8L19.5 11z"/></svg>Désigner l'élément qui pose problème</button>
        <div class="mmb-picked" hidden><code></code><button type="button" aria-label="Retirer l'élément">✕</button></div>
        ${signedIn() ? "" : `<label class="mmb-label" for="mmb-email">Email <small>(facultatif, pour vous répondre)</small></label><input id="mmb-email" type="email" name="email" maxlength="190" autocomplete="email">`}
        <p class="mmb-msg" role="alert" hidden></p>
        <div class="mmb-actions"><button type="submit" class="mmb-send">Envoyer</button></div>
      </form>`;
    document.body.appendChild(panel);
    pill.setAttribute("aria-expanded", "true");
    showPicked();
    panel.querySelector("input[name=category]").focus();
    panel.querySelector(".mmb-close").addEventListener("click", close);
    panel.querySelector(".mmb-pick").addEventListener("click", startPick);
    panel.querySelector(".mmb-picked button").addEventListener("click", () => { picked = null; showPicked(); });
    panel.querySelector("form").addEventListener("submit", send);
  }
  function close() {
    panel?.remove();
    panel = null;
    pill.setAttribute("aria-expanded", "false");
  }
  function showPicked() {
    if (!panel) return;
    const box = panel.querySelector(".mmb-picked");
    box.hidden = !picked;
    if (picked) box.querySelector("code").textContent = picked.selector;
    panel.querySelector(".mmb-pick").lastChild.textContent = picked ? "Choisir un autre élément" : "Désigner l'élément qui pose problème";
  }

  // Picking: the panel steps aside, the element under the pointer is outlined, a click picks it
  function startPick() {
    panel.style.display = "none";
    pill.style.display = "none";
    document.documentElement.classList.add("mmb-picking");
    const banner = document.createElement("div");
    banner.className = "mmb-banner";
    banner.innerHTML = "Cliquez sur l'élément qui pose problème<small>Échap pour annuler</small>";
    const hl = document.createElement("div");
    hl.className = "mmb-hl";
    hl.innerHTML = "<b></b>";
    hl.hidden = true;
    document.body.append(banner, hl);
    let target = null;
    const move = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el || own(el)) return;
      target = el;
      const r = el.getBoundingClientRect();
      Object.assign(hl.style, { left: `${r.left - 2}px`, top: `${r.top - 2}px`, width: `${r.width + 4}px`, height: `${r.height + 4}px` });
      hl.querySelector("b").textContent = cssPath(el);
      hl.hidden = false;
    };
    const stop = () => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", pick, true);
      document.removeEventListener("keydown", key, true);
      document.documentElement.classList.remove("mmb-picking");
      banner.remove();
      hl.remove();
      pill.style.display = "";
      if (panel) panel.style.display = "";
      showPicked();
    };
    const pick = (ev) => {
      if (own(ev.target)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const el = target || ev.target;
      picked = { selector: cssPath(el), snippet: el.outerHTML.replace(/\s+/g, " ").slice(0, 1500), text: (el.innerText || el.alt || el.title || "").replace(/\s+/g, " ").trim().slice(0, 280) };
      stop();
    };
    const key = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); stop(); } };
    // Touch screens: a tap is both the pointing and the click
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", pick, true);
    document.addEventListener("keydown", key, true);
  }

  async function send(ev) {
    ev.preventDefault();
    const f = ev.target, msg = f.querySelector(".mmb-msg"), btn = f.querySelector(".mmb-send");
    const data = Object.fromEntries(new FormData(f).entries());
    const say = (t, bad) => { msg.textContent = t; msg.className = "mmb-msg" + (bad ? " bad" : ""); msg.hidden = false; };
    if (!data.category) return say("Choisissez une catégorie.", true);
    if ((data.body || "").trim().length < 10) return say("Décrivez le problème en quelques mots (10 caractères au moins).", true);
    btn.disabled = true;
    try {
      const r = await fetch(`${API}?action=bug_report`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-MM": "1" },
        body: JSON.stringify({ category: data.category, body: data.body.trim(), email: data.email || "", url: location.href,
          selector: picked?.selector || "", snippet: picked?.snippet || "", element_text: picked?.text || "",
          viewport: `${innerWidth}×${innerHeight} @${devicePixelRatio || 1}x` }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Le signalement n'a pas pu être envoyé. Réessayez dans un instant.");
      picked = null;
      f.innerHTML = `<div class="mmb-done"><b>Merci !</b>${esc(j.message || "Le signalement a été envoyé.")}</div>`;
      setTimeout(close, 2600);
    } catch (e) {
      say(e.message || "Le signalement n'a pas pu être envoyé.", true);
      btn.disabled = false;
    }
  }

  pill.addEventListener("click", () => (panel ? close() : open()));
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && panel && panel.style.display !== "none") close(); });
})();
