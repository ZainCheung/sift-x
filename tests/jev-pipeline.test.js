const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadDefaults() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "defaults.js"), "utf8"), context);
  return context;
}

function makeBackgroundContext() {
  const local = {};
  const sync = {};
  let onMessage;
  const chrome = {
    storage: {
      sync: {
        get: async (keys) => {
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, sync[key]]).filter(([, value]) => value !== undefined));
          if (keys && typeof keys === "object") return { ...keys, ...sync };
          return { ...sync };
        },
        set: async (values) => Object.assign(sync, values)
      },
      local: {
        get: async (keys) => Object.fromEntries(keys.map((key) => [key, local[key]]).filter(([, value]) => value !== undefined)),
        set: async (values) => Object.assign(local, values)
      },
      onChanged: { addListener() {} }
    },
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener(fn) { onMessage = fn; } },
      openOptionsPage() {}
    },
    tabs: { query: async () => [] },
    scripting: { insertCSS: async () => {}, executeScript: async () => {} }
  };
  const context = {
    console,
    chrome,
    importScripts() {},
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({}) })
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "defaults.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"), context);
  return { context, chrome, local, sync, get onMessage() { return onMessage; } };
}

const defaults = loadDefaults();
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "jev-fixtures.json"), "utf8"));

test("compact questions stay below the Phase 1 budget", () => {
  assert.ok(JSON.stringify(defaults.XQF_QUESTIONS).length < 2400);
});

test("state normalization is sparse and preserves both ends of long text", () => {
  const source = {
    author: "@ignored",
    display_name: "Ignored",
    likes: 100,
    reposts: 20,
    replies: 4,
    has_media: true,
    text: `${"start ".repeat(600)}END-MARKER`,
    quoted_post: { author: "quoted", text: "quoted context" }
  };
  const state = defaults.XQF_normalizeStateForJev(source);
  assert.equal(state.author, undefined);
  assert.equal(state.display_name, undefined);
  assert.equal(state.likes, undefined);
  assert.equal(state.has_media, true);
  assert.ok(state.text.length <= defaults.XQF_STATE_LIMITS.text);
  assert.match(state.text, /^start/);
  assert.match(state.text, /END-MARKER$/);
  assert.equal(JSON.stringify(state.quoted_post), JSON.stringify({ text: "quoted context", author: "quoted" }));
});

test("dimensions follow filtering and badge settings", () => {
  assert.equal(JSON.stringify(defaults.XQF_dimensionsForSettings({ hide: { substance: false, humor: false, chitchat: false, promo: false, junk: false }, hideOffTopic: false, hideAI: false, showBadges: false })), "[]");
  assert.equal(JSON.stringify(defaults.XQF_dimensionsForSettings({ hide: { substance: false, humor: false, chitchat: false, promo: false, junk: false }, hideOffTopic: true, hideAI: false, showBadges: false })), JSON.stringify(["tech"]));
  assert.equal(JSON.stringify(defaults.XQF_dimensionsForSettings({ hide: { substance: false, humor: false, chitchat: false, promo: false, junk: true }, hideOffTopic: false, hideAI: true, showBadges: false })), JSON.stringify(["category", "ai_written"]));
  assert.equal(JSON.stringify(defaults.XQF_dimensionsForSettings({ hide: {}, hideOffTopic: true, hideAI: true, showBadges: false }, { isReply: true, filterReplies: false })), JSON.stringify(["category", "tech", "ai_written"]));
});

test("fixture corpus covers the requested regression classes", () => {
  const ids = new Set(fixtures.map((fixture) => fixture.id));
  for (const id of ["technical-analysis", "tech-news", "discussion", "humor", "personal", "promo", "bait", "filler", "long-premium", "quote-post", "image", "tech-reply", "non-tech-reply", "contextual-reply", "ai-style", "human-style"]) assert.ok(ids.has(id), id);
  assert.ok(fixtures.some((fixture) => fixture.expected.local));
  const long = fixtures.find((fixture) => fixture.id === "long-premium");
  assert.ok(long.text.length > defaults.XQF_STATE_LIMITS.text);
  const bounded = defaults.XQF_normalizeStateForJev(long).text;
  assert.match(bounded, /^START:/);
  assert.match(bounded, /migration\.$/);
  assert.equal(defaults.XQF_localVerdictForJev(fixtures.find((fixture) => fixture.id === "filler")).category, "filler");
  assert.equal(defaults.XQF_localVerdictForJev({ text: "nice", in_reply_to: { text: "A technical post" } }), null);
});

test("background deduplicates concurrent evaluations and reuses dimensions", async () => {
  const env = makeBackgroundContext();
  let calls = 0;
  env.context.fetch = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, json: async () => ({ model: "jev-test", usage: { input_tokens: 42 }, answers: { tech: { noul: 0.9 }, category: { choice: "insight", confidence: 0.9, probabilities: { insight: 0.9 } }, ai_written: { noul: 0.1 } } }) };
  };
  await env.context.loadState();
  const state = { text: "same semantic state", likes: 1 };
  const [a, b] = await Promise.all([
    env.context.score("one", state, ["tech"]),
    env.context.score("two", state, ["tech"])
  ]);
  assert.equal(calls, 1);
  assert.equal(a.verdict.tech, 0.9);
  assert.equal(b.verdict.tech, 0.9);
  assert.equal(env.context.statsSnapshot().inflightDedupe, 1);

  const category = await env.context.score("one", state, ["category"]);
  assert.equal(calls, 2);
  assert.equal(category.verdict.category, "insight");
  const cached = await env.context.score("one", state, ["tech"]);
  assert.equal(calls, 2);
  assert.equal(cached.cached, true);
  assert.ok(env.context.evaluatorVersion("tech", "jev-test").includes("jev-test"));

  const mergeState = { text: "concurrent dimension merge" };
  await Promise.all([
    env.context.score("merge", mergeState, ["category"]),
    env.context.score("merge", mergeState, ["tech"])
  ]);
  const merged = await env.context.score("merge", mergeState, ["category", "tech"]);
  assert.equal(merged.cached, true);
  assert.equal(merged.verdict.category, "insight");
  assert.equal(merged.verdict.tech, 0.9);
});
