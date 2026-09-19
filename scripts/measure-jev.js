/*
 * Optional live measurement harness. It is intentionally opt-in because it
 * spends Jev credits. Capture one JSON result on main and one on the feature
 * branch with the same fixture file, then compare usage.input_tokens.
 *
 *   SIFT_JEV_API_KEY=tsk_... npm run measure:jev > after.json
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const apiKey = process.env.SIFT_JEV_API_KEY || process.env.JEV_API_KEY;
if (!apiKey) {
  console.error("Set SIFT_JEV_API_KEY to run the live Jev measurement (this makes paid requests).");
  process.exit(1);
}

const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "defaults.js"), "utf8"), context);
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tests", "fixtures", "jev-fixtures.json"), "utf8"));
const model = process.env.SIFT_JEV_MODEL || "jev-latest";
const dimensions = (process.env.SIFT_JEV_DIMENSIONS || "category,tech,ai_written").split(",").filter(Boolean);
const apiUrl = process.env.SIFT_JEV_URL || "https://api.typesafe.ai/v1/systemone";

(async () => {
  const rows = [];
  for (const fixture of fixtures) {
    const state = context.XQF_normalizeStateForJev(fixture);
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state, model, questions: context.XQF_questionsForDimensions(dimensions) })
    });
    if (!res.ok) throw new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    rows.push({ id: fixture.id, input_tokens: Number(data.usage?.input_tokens) || 0 });
  }
  const total = rows.reduce((sum, row) => sum + row.input_tokens, 0);
  console.log(JSON.stringify({ model, dimensions, fixtureCount: rows.length, totalInputTokens: total, inputTokensPerFixture: rows.length ? total / rows.length : 0, rows }, null, 2));
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
