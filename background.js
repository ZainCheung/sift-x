// Service worker: talks to TypeSafe Jev, caches verdicts, keeps stats.
importScripts("defaults.js");

const API_URL = "https://api.typesafe.ai/v1/systemone";
const CACHE_KEY = "xqf_cache";
const STATS_KEY = "xqf_stats";
const CACHE_MAX = 4000;
const CONCURRENCY = 6;

let settings = null;
let cache = null; // Map id -> verdict
let stats = null;
let saveTimer = null;

async function loadState() {
  if (settings && cache && stats) return;
  const s = await chrome.storage.sync.get(XQF_DEFAULTS);
  settings = { ...XQF_DEFAULTS, ...s };
  // verdict shape changed (0.4 category, 0.6 tech): drop stale cache entries
  const l0 = await chrome.storage.local.get(["xqf_schema"]);
  if (l0.xqf_schema !== 6) {
    await chrome.storage.local.set({ [CACHE_KEY]: {}, xqf_schema: 6 });
    // old per-fine-category hide map -> new five labels
    const old = (await chrome.storage.sync.get(["hide"])).hide || {};
    if ("bait" in old || "insight" in old) {
      await chrome.storage.sync.set({ hide: { ...XQF_DEFAULTS.hide, promo: !!old.promo, humor: !!old.humor, chitchat: !!old.personal, substance: !!(old.insight && old.news && old.discussion) } });
    }
  }
  const l = await chrome.storage.local.get([CACHE_KEY, STATS_KEY]);
  cache = new Map(Object.entries(l[CACHE_KEY] || {}));
  stats = l[STATS_KEY] || { analyzed: 0, hidden: 0, tokens: 0, cost: 0, errors: 0 };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && settings) {
    for (const [k, v] of Object.entries(changes)) settings[k] = v.newValue;
  }
});

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    // LRU-ish trim: Map keeps insertion order, drop oldest
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    await chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(cache), [STATS_KEY]: stats });
  }, 1500);
}

// ---- Jev call ----------------------------------------------------------
async function askJev(state, apiKey, model) {
  const body = JSON.stringify({ state, model: model || "jev-latest", questions: XQF_QUESTIONS });
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body
    });
    if (res.ok) return res.json();
    const text = await res.text().catch(() => "");
    lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (res.status === 401 || res.status === 403 || res.status === 422) throw lastErr;
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after")) || 0.5 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, ra * 1000));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}

// Turn Jev answers into a compact verdict the content script can act on.
function toVerdict(resp) {
  const a = resp.answers || {};
  const c = a.category || {};
  return {
    category: c.choice || "personal",
    confidence: c.confidence ?? 0,
    probs: c.probabilities || {},
    ai: a.ai_written?.noul ?? 0,
    tech: a.tech?.noul ?? 1,
    model: resp.model,
    t: Date.now()
  };
}

// ---- Queue with concurrency ---------------------------------------------
const queue = [];
let running = 0;

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift();
    running++;
    (async () => {
      try {
        const resp = await askJev(job.state, settings.apiKey, settings.model);
        const v = toVerdict(resp);
        cache.set(job.id, v);
        stats.analyzed++;
        const tok = resp.usage?.input_tokens || 0;
        stats.tokens += tok;
        stats.cost += (tok / 1e6) * 0.042;
        scheduleSave();
        job.resolve({ id: job.id, verdict: v });
      } catch (e) {
        stats.errors++;
        scheduleSave();
        job.resolve({ id: job.id, error: String(e.message || e) });
      } finally {
        running--;
        pump();
      }
    })();
  }
}

function score(id, state) {
  const hit = cache.get(id);
  if (hit) {
    // refresh position for LRU
    cache.delete(id); cache.set(id, hit);
    return Promise.resolve({ id, verdict: hit, cached: true });
  }
  return new Promise((resolve) => { queue.push({ id, state, resolve }); pump(); });
}

// ---- Onboarding: first install opens the setup page ---------------------------
chrome.runtime.onInstalled.addListener(async (d) => {
  // re-inject into already-open x.com tabs so an update/reload never leaves orphaned pages
  try {
    const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
    for (const t of tabs) {
      try {
        await chrome.scripting.insertCSS({ target: { tabId: t.id }, files: ["content.css"] });
        await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["defaults.js", "content.js"] });
      } catch { /* tab not scriptable */ }
    }
  } catch { /* ignore */ }
  if (d.reason !== "install") return;
  const s = await chrome.storage.sync.get(["apiKey"]);
  if (!s.apiKey) chrome.runtime.openOptionsPage();
});

async function addToList(key, handle) {
  const s = await chrome.storage.sync.get([key]);
  const lines = (s[key] || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const h = handle.replace(/^@/, "").toLowerCase();
  if (!lines.some((x) => x.replace(/^@/, "").toLowerCase() === h)) lines.push(h);
  // keep the other list clean
  const other = key === "allowlist" ? "blocklist" : "allowlist";
  const o = await chrome.storage.sync.get([other]);
  const otherLines = (o[other] || "").split("\n").map((x) => x.trim()).filter((x) => x && x.replace(/^@/, "").toLowerCase() !== h);
  await chrome.storage.sync.set({ [key]: lines.join("\n"), [other]: otherLines.join("\n") });
}

// ---- Messages ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    await loadState();
    switch (msg.type) {
      case "openOptions":
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        break;
      case "allow":
        await addToList("allowlist", msg.handle);
        sendResponse({ ok: true });
        break;
      case "block":
        await addToList("blocklist", msg.handle);
        sendResponse({ ok: true });
        break;
      case "settings":
        sendResponse({ settings, stats });
        break;
      case "score": {
        if (!settings.apiKey) { sendResponse({ error: "no_api_key" }); break; }
        const results = await Promise.all(msg.items.map((it) => score(it.id, it.state)));
        sendResponse({ results });
        break;
      }
      case "hidden":
        stats.hidden += msg.count || 1;
        scheduleSave();
        sendResponse({ ok: true });
        break;
      case "stats":
        sendResponse({ stats });
        break;
      case "resetStats":
        stats = { analyzed: 0, hidden: 0, tokens: 0, cost: 0, errors: 0 };
        scheduleSave();
        sendResponse({ ok: true });
        break;
      case "clearCache":
        cache.clear();
        scheduleSave();
        sendResponse({ ok: true });
        break;
      case "test": {
        try {
          const r = await askJev(
            { author: "test", text: "Bookmark this. Most people will never understand this simple system 🧵👇" },
            msg.apiKey || settings.apiKey, msg.model || settings.model
          );
          sendResponse({ ok: true, verdict: toVerdict(r), model: r.model });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      default:
        sendResponse({ error: "unknown" });
    }
  })();
  return true; // async
});
