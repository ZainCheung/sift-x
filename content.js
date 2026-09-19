// Sift content script for x.com: extract posts, pre-filter with stop phrases, score with Jev, hide/dim/badge.
(() => {
  if (window.__siftLoaded) return; window.__siftLoaded = true;
  const ATTR = "data-sift";
  const CAT = Object.fromEntries(Object.entries(XQF_CATEGORIES).map(([k, c]) => [k, [c.icon, c.label]]));
  const uiOf = (fine) => XQF_FINE_TO_UI[fine] || "chitchat";
  const fineLabel = (fine) => XQF_FINE_LABEL[fine] || fine;
  const AI_AT = 0.7; // P(ai_written) at which a post counts as AI-written
  const pageCounts = {}; // category -> hidden count on this page

  let settings = null;
  let stopRegexes = [];
  let allow = new Set();
  let block = new Set();
  const verdicts = new Map(); // id -> verdict (survives X's list virtualisation)
  const pending = new Map(); // id -> Promise
  let batch = [];
  let batchTimer = null;
  let pageHidden = 0;

  // ---------- settings ----------
  function compileSettings(s) {
    settings = s;
    stopRegexes = [];
    for (const line of (s.stopPhrases || "").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      try { stopRegexes.push(new RegExp(t, "i")); } catch { /* skip bad regex */ }
    }
    const toSet = (txt) => new Set((txt || "").split("\n").map((x) => x.trim().replace(/^@/, "").toLowerCase()).filter(Boolean));
    allow = toSet(s.allowlist);
    block = toSet(s.blocklist);
  }

  function active() {
    return !torn && settings?.enabled && !(settings.pausedUntil && settings.pausedUntil > Date.now());
  }

  async function loadSettings() {
    let s;
    try { s = await chrome.storage.sync.get(XQF_DEFAULTS); } catch { teardown(); return; }
    s.hide = { ...XQF_DEFAULTS.hide, ...(s.hide || {}) };
    compileSettings(s);
  }

  // ---------- orphan detection (extension reloaded while this page stayed open) ----------
  let torn = false, obs = null, tick = null;
  function alive() { try { return !!chrome.runtime?.id; } catch { return false; } }
  // every runtime call goes through here: never throws, never leaves an unhandled rejection
  async function send(msg) {
    if (!alive()) { teardown(); return null; }
    try { return await chrome.runtime.sendMessage(msg); }
    catch (e) { if (/context invalidated|Extension context|message port closed/i.test(String(e))) teardown(); return null; }
  }
  function teardown() {
    if (torn) return; torn = true;
    obs?.disconnect(); if (tick) clearInterval(tick);
    document.querySelectorAll(`article[${ATTR}]`).forEach((a) => { resetArticle(a); a.removeAttribute(ATTR); a.removeAttribute("data-sift-id"); });
    const t = el("div", "sift-toast");
    t.appendChild(el("span", null, "Sift was updated — reload this page to keep filtering."));
    const b = el("button", null, "Reload"); b.addEventListener("click", () => location.reload()); t.appendChild(b);
    document.body.appendChild(t);
  }

  function reevaluateAll() {
    document.querySelectorAll(`article[data-testid="tweet"]`).forEach((a) => { a.removeAttribute(ATTR); resetArticle(a); });
    pageHidden = 0; for (const k in pageCounts) delete pageCounts[k];
    scan();
  }

  try {
    chrome.storage.onChanged.addListener(async (_c, area) => {
      if (area !== "sync") return;
      await loadSettings();
      if (settings?.apiKey) toast(null);
      reevaluateAll();
    });
  } catch { /* orphaned */ }

  try { chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === "showAll") {
      document.querySelectorAll(".sift-bar:not(.sift-open) .sift-show").forEach((b) => b.click());
      reply({ ok: true });
    } else if (msg.type === "pageStats") {
      reply({ hidden: pageHidden, counts: pageCounts });
    }
  }); } catch { /* orphaned */ }

  // ---------- extraction ----------
  function parseCount(s) {
    if (!s) return 0;
    s = s.replace(/,/g, "").trim();
    const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
    if (!m) return 0;
    const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
    return Math.round(parseFloat(m[1]) * mult);
  }

  function extract(article) {
    const timeLink = article.querySelector(`a[href*="/status/"] time`)?.closest("a");
    let idMatch = (timeLink?.getAttribute("href") || "").match(/\/status\/(\d+)/);
    if (!idMatch) {
      // promoted posts have no timestamp permalink; any /status/ link (analytics, media) still carries the id
      for (const a of article.querySelectorAll(`a[href*="/status/"]`)) { idMatch = a.getAttribute("href").match(/\/status\/(\d+)/); if (idMatch) break; }
    }
    if (!idMatch) return null;
    const id = idMatch[1];

    const textEl = article.querySelector(`[data-testid="tweetText"]`);
    const text = textEl ? textEl.innerText.trim() : "";

    const userName = article.querySelector(`[data-testid="User-Name"]`);
    let handle = "", displayName = "";
    if (userName) {
      const spans = [...userName.querySelectorAll("span")].map((s) => s.textContent.trim()).filter(Boolean);
      handle = (spans.find((s) => s.startsWith("@")) || "").slice(1);
      displayName = spans[0] || "";
    }

    const metrics = { replies: 0, reposts: 0, likes: 0, views: 0 };
    const label = article.querySelector(`[role="group"][aria-label]`)?.getAttribute("aria-label") || "";
    for (const part of label.split(",")) {
      const m = part.trim().match(/^([\d.,]+[KMB]?)\s+(\w+)/i);
      if (!m) continue;
      const n = parseCount(m[1]); const w = m[2].toLowerCase();
      if (w.startsWith("repl")) metrics.replies = n;
      else if (w.startsWith("repost") || w.startsWith("retweet")) metrics.reposts = n;
      else if (w.startsWith("like")) metrics.likes = n;
      else if (w.startsWith("view")) metrics.views = n;
    }

    const photos = [...article.querySelectorAll(`[data-testid="tweetPhoto"] img`)];
    const hasVideo = !!article.querySelector(`[data-testid="videoPlayer"], video`);
    const alts = photos.map((i) => (i.getAttribute("alt") || "").trim()).filter((a) => a && !/^(image|图片|imagen|bild)$/i.test(a));
    const cardEl = article.querySelector(`[data-testid="card.wrapper"], [data-testid^="card."], a[href*="/i/article/"], [data-testid="twitter-article"]`);
    const card = cardEl ? cardEl.innerText.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const isArticle = !!article.querySelector(`a[href*="/i/article/"], [data-testid="twitter-article"]`);
    const hasMedia = photos.length > 0 || hasVideo || !!cardEl;
    const hasLink = !!(textEl && textEl.querySelector(`a[href^="http"], a[href*="t.co"]`));
    const isAd = !!article.closest(`[data-testid="placementTracking"]`) ||
      [...article.querySelectorAll("span")].some((s) => s.textContent === "Ad" || s.textContent === "Promoted");
    const isReply = /(^|\n)Replying to\b/i.test(article.innerText.slice(0, 400));
    const isFocal = article.getAttribute("tabindex") === "-1";
    const quoted = article.querySelectorAll(`[data-testid="tweetText"]`)[1]?.innerText?.trim() || "";
    const quotedAuthor = article.querySelectorAll(`[data-testid="User-Name"]`)[1]?.innerText?.split("\n")?.[0] || "";

    return { id, handle, displayName, text, hasMedia, hasLink, isAd, isReply, isFocal, quoted, quotedAuthor, metrics,
      media: hasVideo ? "video" : photos.length ? `${photos.length} photo${photos.length > 1 ? "s" : ""}` : "", alts, card, isArticle };
  }

  function toState(t) {
    const s = {
      author: t.handle, display_name: t.displayName, text: t.text,
      has_media: t.hasMedia, has_link: t.hasLink, is_reply: t.isReply,
      likes: t.metrics.likes, reposts: t.metrics.reposts, replies: t.metrics.replies
    };
    if (t.media) s.media = t.media;
    if (t.alts.length) s.image_descriptions = t.alts.join(" | ").slice(0, 400);
    if (t.quoted) s.quoted_post = { author: t.quotedAuthor, text: t.quoted.slice(0, 600) };
    if (t.card) s[t.isArticle ? "article" : "link_card"] = t.card;
    return s;
  }

  // ---------- decision ----------
  const pct = (x) => `${Math.round(x * 100)}%`;
  function catOf(t, v) {
    if (t.isAd) return "ad";
    return v?.category || null;
  }
  function isAI(v) { return !!v && v.ai >= AI_AT; }

  function decide(t, v) {
    const h = t.handle.toLowerCase();
    if (h && allow.has(h)) return { hide: false, reason: "allowlisted" };
    if (h && block.has(h)) return { hide: true, reason: `you hide @${t.handle}`, cat: "blocked" };
    if (t.isAd) return { hide: !!settings.hide.junk, reason: "🚫 Junk · ad", cat: "junk" };
    for (const re of stopRegexes) {
      if (re.test(t.text)) return { hide: !!settings.hide.junk, reason: "🚫 Junk · stop phrase", cat: "junk", local: true };
    }
    if (!v) return null;
    const ui = uiOf(v.category);
    const reasons = [];
    if (settings.hide[ui]) reasons.push(`${CAT[ui][0]} ${CAT[ui][1]}${ui !== v.category ? ` · ${fineLabel(v.category)}` : ""}`);
    if (settings.hideAI && isAI(v)) reasons.push(`🤖 AI-written ${pct(v.ai)}`);
    return { hide: reasons.length > 0, reason: reasons.join(" · "), cat: reasons.length ? (settings.hide[ui] ? ui : "ai") : ui };
  }

  // ---------- rendering ----------
  const cell = (article) => article.closest(`[data-testid="cellInnerDiv"]`) || article.parentElement;

  function resetArticle(article) {
    const c = cell(article);
    c.classList.remove("sift-hidden", "sift-dimmed", "sift-pending");
    c.querySelector(".sift-bar")?.remove();
    article.querySelectorAll(".sift-badge").forEach((b) => b.remove());
    
  }

  function badge(article, v, decision) {
    if (!settings.showBadges) return;
    const c = decision?.cat && CAT[decision.cat] ? decision.cat : (v ? uiOf(v.category) : null);
    if (!c) return;
    article.querySelector(".sift-badge")?.remove();
    const b = document.createElement("div");
    b.className = `sift-badge sift-c-${c}`;
    let txt = `${CAT[c][0]} ${CAT[c][1]}`;
    if (decision?.hide) txt += " · hidden";
    b.textContent = txt.trim();
    b.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); });
    // always show how likely the text is machine-written
    let ai = null;
    if (v) {
      article.querySelector(".sift-ai")?.remove();
      ai = document.createElement("div");
      const lvl = v.ai >= AI_AT ? "high" : v.ai >= 0.4 ? "mid" : "low";
      ai.className = `sift-badge sift-ai sift-ai-${lvl}`;
      ai.textContent = `🤖 ${pct(v.ai)}`;
      ai.title = `AI-written likelihood ${pct(v.ai)} — ${lvl === "high" ? "reads like an LLM wrote it" : lvl === "mid" ? "unsure" : "reads human"}`;
      ai.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); });
    }
    if (v) {
      const top = Object.entries(v.probs || {}).sort((a, b2) => b2[1] - a[1]).slice(0, 3).map(([k, p]) => `${k} ${pct(p)}`).join(", ");
      b.title = `Sift · ${CAT[c][1]} — ${fineLabel(v.category)} (confidence ${pct(v.confidence)})\n${top}\nAI-written ${pct(v.ai)}`;
    }
    const header = article.querySelector(`[data-testid="User-Name"]`);
    if (header) { b.classList.add("sift-inline"); header.appendChild(b); if (ai) { ai.classList.add("sift-inline"); header.appendChild(ai); } }
    else { article.appendChild(b); if (ai) { ai.style.right = "auto"; ai.style.left = "16px"; article.appendChild(ai); } }
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function applyHide(article, t, decision, v) {
    const c = cell(article);
    if (settings.mode === "badge") { badge(article, v, decision); return; }
    if (settings.mode === "dim") { c.classList.add("sift-dimmed"); badge(article, v, decision); return; }

    c.classList.add("sift-hidden");
    if (c.querySelector(".sift-bar")) return;
    pageHidden++;
    pageCounts[decision.cat] = (pageCounts[decision.cat] || 0) + 1;

    const bar = el("div", "sift-bar");
    // never let clicks on our bar reach X's "open this post" handler
    bar.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); });
    const who = t.handle ? `@${t.handle}` : "post";
    bar.appendChild(el("span", "sift-bar-text", `${who} · ${decision.reason}`));
    const actions = el("span", "sift-actions");
    const show = el("button", "sift-show", "Show");
    show.addEventListener("click", (e) => {
      e.stopPropagation(); e.preventDefault();
      const open = c.classList.toggle("sift-hidden") === false; // toggled off => now open
      bar.classList.toggle("sift-open", open);
      show.textContent = open ? "Hide" : "Show";
      article.setAttribute(ATTR, open ? "revealed" : "hidden");
      if (open) badge(article, v, decision);
    });
    actions.appendChild(show);
    if (t.handle) {
      const more = el("button", "sift-more", "⋯");
      more.title = "More";
      const menu = el("span", "sift-menu");
      const alw = el("button", "sift-menu-item", `Always show @${t.handle}`);
      alw.addEventListener("click", (e) => { e.stopPropagation(); send({ type: "allow", handle: t.handle }); });
      const blk = el("button", "sift-menu-item", `Always hide @${t.handle}`);
      blk.addEventListener("click", (e) => { e.stopPropagation(); send({ type: "block", handle: t.handle }); });
      menu.append(alw, blk);
      more.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("open"); });
      actions.append(more, menu);
    }
    bar.appendChild(actions);
    c.prepend(bar);
    send({ type: "hidden", count: 1 });
  }

  function finish(article, t, v) {
    cell(article).classList.remove("sift-pending");
    const d = decide(t, v) || { hide: false, reason: "" };
    article.setAttribute(ATTR, d.hide ? "hidden" : "kept");
    if (d.hide && !t.isFocal) applyHide(article, t, d, v);
    else badge(article, v, d);
  }

  // ---------- toast (setup / paused) ----------
  let toastEl = null;
  function toast(text, actionLabel, onAction) {
    toastEl?.remove(); toastEl = null;
    if (!text) return;
    toastEl = el("div", "sift-toast");
    toastEl.appendChild(el("span", null, text));
    if (actionLabel) {
      const b = el("button", null, actionLabel);
      b.addEventListener("click", onAction);
      toastEl.appendChild(b);
    }
    const x = el("button", "sift-toast-x", "×");
    x.addEventListener("click", () => toast(null));
    toastEl.appendChild(x);
    document.body.appendChild(toastEl);
  }

  // ---------- scoring pipeline ----------
  function flushBatch() {
    batchTimer = null;
    const items = batch; batch = [];
    if (!items.length) return;
    send({ type: "score", items: items.map((i) => ({ id: i.t.id, state: toState(i.t) })) })
      .then((r) => {
        if (r === null) { items.forEach((i) => i.resolve(null)); return; }
        if (r?.error === "no_api_key") {
          toast("Sift needs a TypeSafe API key to start filtering.", "Set up (1 min)", () => send({ type: "openOptions" }));
          items.forEach((i) => i.resolve(null));
          return;
        }
        const byId = new Map((r?.results || []).map((x) => [x.id, x]));
        let authErr = null;
        for (const i of items) {
          const res = byId.get(i.t.id);
          if (res?.verdict) verdicts.set(i.t.id, res.verdict);
          if (res?.error && /HTTP 40[13]/.test(res.error)) authErr = res.error;
          i.resolve(res?.verdict || null);
        }
        if (authErr) toast("Sift: TypeSafe rejected the API key.", "Fix key", () => send({ type: "openOptions" }));
      })
      .catch((e) => { items.forEach((i) => i.resolve(null)); console.warn("[Sift] score failed", e); });
  }

  function requestScore(t) {
    if (verdicts.has(t.id)) return Promise.resolve(verdicts.get(t.id));
    if (pending.has(t.id)) return pending.get(t.id);
    const p = new Promise((resolve) => {
      batch.push({ t, resolve });
      if (!batchTimer) batchTimer = setTimeout(flushBatch, 120);
    }).finally(() => pending.delete(t.id));
    pending.set(t.id, p);
    return p;
  }

  async function process(article) {
    if (!active()) return;
    if (article.getAttribute(ATTR)) return;
    const t = extract(article);
    if (!t) return;
    article.setAttribute(ATTR, "pending");
    article.setAttribute("data-sift-id", t.id);

    const onStatusPage = /\/status\/\d+/.test(location.pathname);
    if (onStatusPage && !t.isFocal && !settings.filterReplies) {
      const v0 = verdicts.get(t.id);
      if (v0) badge(article, v0, null);
      else requestScore(t).then((v) => v && article.isConnected && badge(article, v, null));
      article.setAttribute(ATTR, "kept");
      return;
    }

    const local = decide(t, null);
    if (local) { finish(article, t, verdicts.get(t.id) || null); return; }

    // nothing at all to judge (no text, no quote, no card, no media): keep silently
    if (!t.text && !t.quoted && !t.card && !t.media) { article.setAttribute(ATTR, "kept"); return; }

    if (!verdicts.has(t.id) && settings.mode === "hide") cell(article).classList.add("sift-pending");
    const v = await requestScore(t);
    if (!article.isConnected) return;
    finish(article, t, v);
  }

  function scan() {
    document.querySelectorAll(`article[data-testid="tweet"]:not([${ATTR}])`).forEach(process);
  }

  // ---------- theme ----------
  function applyTheme() {
    const bg = getComputedStyle(document.body).backgroundColor || "";
    const m = bg.match(/\d+/g); const lum = m ? (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3 : 0;
    document.documentElement.setAttribute("data-sift-theme", lum > 128 ? "light" : "dark");
  }

  // ---------- boot ----------
  (async () => {
    await loadSettings();
    if (torn || !settings) return;
    applyTheme();
    // a previous (now orphaned) copy of this script may have left marks behind
    document.querySelectorAll(`article[${ATTR}]`).forEach((a) => { resetArticle(a); a.removeAttribute(ATTR); a.removeAttribute("data-sift-id"); });
    document.querySelectorAll(".sift-toast").forEach((t) => t.remove());
    scan();
    obs = new MutationObserver((muts) => {
      for (const m of muts) if (m.addedNodes.length) { scan(); return; }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // X re-uses mounted articles while scrolling; detect content swaps and re-process
    tick = setInterval(() => {
      if (!alive()) { teardown(); return; }
      applyTheme();
      document.querySelectorAll(`article[data-testid="tweet"][${ATTR}]`).forEach((a) => {
        const t = extract(a);
        const prev = a.getAttribute("data-sift-id");
        if (t && prev && prev !== t.id) { a.removeAttribute(ATTR); a.removeAttribute("data-sift-id"); resetArticle(a); }
      });
      scan();
    }, 1500);
  })();
})();
