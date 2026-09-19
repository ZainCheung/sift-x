const $ = (id) => document.getElementById(id);
let settings, counts = {};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && /^https:\/\/(x|twitter)\.com\//.test(tab.url || "") ? tab : null;
}

function row(icon, label, hidden, count, onChange) {
  const r = document.createElement("div"); r.className = "cat";
  r.innerHTML = `<span>${icon}</span><span class="n">${label}</span><span class="cnt">${count || ""}</span>
    <span class="seg"><button class="show ${hidden ? "" : "active"}">Show</button><button class="hide ${hidden ? "active" : ""}">Hide</button></span>`;
  const [bs, bh] = r.querySelectorAll("button");
  const set = (h) => { bs.classList.toggle("active", !h); bh.classList.toggle("active", h); onChange(h); };
  bs.addEventListener("click", () => set(false)); bh.addEventListener("click", () => set(true));
  return r;
}

function renderCats() {
  const box = $("cats"); box.innerHTML = "";
  for (const [k, c] of Object.entries(XQF_CATEGORIES)) {
    box.appendChild(row(c.icon, c.label, !!settings.hide[k], counts[k], async (h) => {
      settings.hide = { ...settings.hide, [k]: h };
      await chrome.storage.sync.set({ hide: settings.hide });
    }));
  }
  const sep = document.createElement("div"); sep.className = "sep"; box.appendChild(sep);
  box.appendChild(row(XQF_AI.icon, XQF_AI.label, settings.hideAI !== false, counts.ai, async (h) => {
    settings.hideAI = h; await chrome.storage.sync.set({ hideAI: h });
  }));
}

function renderPaused() {
  const paused = settings.pausedUntil > Date.now();
  $("paused").style.display = paused ? "block" : "none";
  $("pause").textContent = paused ? "Resume" : "Pause 1 h";
}

(async () => {
  settings = { ...XQF_DEFAULTS, ...(await chrome.storage.sync.get(XQF_DEFAULTS)) };
  settings.hide = { ...XQF_DEFAULTS.hide, ...(settings.hide || {}) };
  $("enabled").checked = settings.enabled;
  $("warn").style.display = settings.apiKey ? "none" : "block";
  renderPaused();

  const tab = await activeTab();
  if (tab) {
    try { counts = (await chrome.tabs.sendMessage(tab.id, { type: "pageStats" })).counts || {}; } catch { counts = {}; }
  } else { $("showAll").disabled = true; $("showAll").style.opacity = .5; $("pageNote").textContent = ""; }
  renderCats();

  const { stats } = await chrome.runtime.sendMessage({ type: "stats" });
  $("spent").textContent = `${stats.analyzed.toLocaleString()} labelled · $${stats.cost.toFixed(3)}`;
})();

$("enabled").addEventListener("change", (e) => chrome.storage.sync.set({ enabled: e.target.checked, pausedUntil: 0 }));
$("pause").addEventListener("click", async () => {
  const until = settings.pausedUntil > Date.now() ? 0 : Date.now() + 3600e3;
  settings.pausedUntil = until;
  await chrome.storage.sync.set({ pausedUntil: until });
  renderPaused();
});
$("resume").addEventListener("click", async (e) => { e.preventDefault(); settings.pausedUntil = 0; await chrome.storage.sync.set({ pausedUntil: 0 }); renderPaused(); });
$("showAll").addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab) { await chrome.tabs.sendMessage(tab.id, { type: "showAll" }).catch(() => {}); counts = {}; renderCats(); }
});
for (const id of ["openOpts", "setup"]) $(id).addEventListener("click", (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
