// ============================================================
// Ops Automation — dashboard front-end
//
// Real behavior only: stats and history come from Supabase
// (table `workflow_runs`), runs are executed by POST /api/run
// and logged server-side. Nothing here is sample data.
//
// Pipeline redesign port: the hero loop animates on its own,
// "Run pipeline" steps through the four real workflows in
// order (crawl -> enrich -> schedule -> follow-up), narrates
// each step in the run log, and lands a real output card per
// stage. Every stage card is tappable to inspect the module.
// ============================================================

const SUPABASE_URL = "https://gxjyjvqgdmtxipqpgisl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4anlqdnFnZG10eGlwcXBnaXNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0OTQxOTMsImV4cCI6MjEwNjA3MDE5M30.odB-vMHeyknhPZTYACLYyijgyiW1OflkTNdSlzDERTI";

const JOBS = [
  {
    id: "job-board-crawler",
    label: "Job board crawler",
    desc: "Live-crawls Remotive's public jobs API and counts current \u201csoftware engineer\u201d listings.",
  },
  {
    id: "crm-lead-enrichment",
    label: "CRM lead enrichment",
    desc: "Real HTTP checks against sample leads - live status, response time, and page title.",
  },
  {
    id: "interview-scheduler",
    label: "Interview scheduler",
    desc: "Computes actual overlapping free slots between two sample calendars.",
  },
  {
    id: "gmail-followup-drafts",
    label: "Follow-up drafts",
    desc: "Finds leads overdue for follow-up by real date math and drafts a message.",
  },
];

// Pipeline module details shown by the stage inspector. Every
// line describes the real code in api/_jobs.js — no invented
// stages, scores or drafts.
const MODULES = {
  "job-board-crawler": {
    stage: 1,
    icon: "\u{1F577}\uFE0F",
    title: "Crawl \u2014 Finds fresh postings",
    io: "Input: the search term \u201csoftware engineer\u201d against Remotive's public jobs API (20 results per call). Output: a live count of current listings plus the first three \u2014 title @ company \u2014 written to Supabase as a run row.",
    how: "GET https://remotive.com/api/remote-jobs\n  ?search=software%20engineer&limit=20\n\ncount = data.jobs.length\nsample = jobs.slice(0, 3)  // \u201ctitle @ company\u201d",
    fails:
      "If Remotive is unreachable, returns a non-200 status, or the JSON has no jobs array, the run fails and is logged as failed \u2014 the other workflows still run.",
    tags: ["live API", "scheduled"],
  },
  "crm-lead-enrichment": {
    stage: 2,
    icon: "\u{1F9EC}",
    title: "Enrich \u2014 Adds company context",
    io: "Input: three sample leads \u2014 Palantir, Vercel, Supabase \u2014 with their public home pages. Output: live HTTP status, response time in ms, and page title for each lead.",
    how: "for (const lead of SAMPLE_LEADS) {\n  const res = await fetchWithTimeout(lead.domain, {}, 5000);\n  title = html.match(/<title>(.*?)<\\/title>/i)?.[1];\n}",
    fails:
      "A site that times out (5 s) or returns an error is recorded as unreachable in that lead's row; the run still completes with the other leads.",
    tags: ["live checks", "signals"],
  },
  "interview-scheduler": {
    stage: 3,
    icon: "\u23F0",
    title: "Schedule \u2014 Puts follow-up on the clock",
    io: "Input: two sample calendars (interviewer busy 09:00\u201310:00, 12:00\u201313:00, 15:00\u201315:30; candidate busy 09:30\u201311:00, 14:00\u201314:45) and a 09:00\u201317:00 day. Output: every overlapping free window of 30 minutes or more, with a plain-English summary.",
    how: "free = complement(busy, 09:00\u201317:00)\nslots = intersect(interviewerFree, candidateFree)\n  .filter(([s, e]) => e - s >= 30)  // minutes",
    fails:
      "No overlapping window of 30 minutes or more means the summary says so and nothing is booked; the run still succeeds.",
    tags: ["cron", "30-min slots"],
  },
  "gmail-followup-drafts": {
    stage: 4,
    icon: "\u{1F501}",
    title: "Follow-up \u2014 Fires when it's due",
    io: "Input: three sample leads with last-contact dates \u2014 Dana 9 days ago, Marcus 2 days, Priya 14 days \u2014 and a 5-day overdue rule. Output: a draft for every overdue lead, e.g. \u201cHi Dana, following up on our conversation about Northwind\u2026\u201d",
    how: "overdue = leads.filter(l => daysSince(l.lastContact) >= 5)\ndraft = `Hi ${first}, following up on our conversation\n  about ${company} \u2026`",
    fails:
      "Nothing overdue means the summary says \u201c0 of 3 leads overdue\u201d and no draft is produced. Drafts are previews \u2014 nothing is ever sent by this workflow.",
    tags: ["due checks", "human send"],
  },
};

const PIPELINE_ORDER = JOBS.map((j) => j.id);

const CRON_SCHEDULE = { hourUTC: 13, minuteUTC: 0 }; // matches vercel.json: "0 13 * * *"

const state = {
  runs: [],
  totalCount: null,
  lastByWorkflow: {},
  sessionStart: Date.now(),
  showAll: false,
  filter: "all",
};
const running = new Set();
let pipelineRunning = false;
let pipelineSpeedMs = 900; // Normal; Fast is 250 ms between stages
let inspectedJob = PIPELINE_ORDER[0];

// ---------- element refs (every lookup is guarded: the same
// script serves the tabbed dashboard and the redesign page) ----------
const logBody = document.getElementById("log-body");
const logBodyPreview = document.getElementById("log-body-preview");
const outputSection = document.getElementById("output-section");
const outputBody = document.getElementById("output-body");
const feedList = document.getElementById("live-feed-list");
const filterSelect = document.getElementById("filter-workflow");
const runLogEl = document.getElementById("runLog");
const pipelineOutputEl = document.getElementById("pipelineOutput");
const pipelineStatusEl = document.getElementById("pipelineStatus");
const pipelineStartedEl = document.getElementById("pipelineStarted");
const runPipelineBtn = document.getElementById("runPipelineBtn");
const pipelineResetBtn = document.getElementById("pipelineReset");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---------- tabs (legacy dashboard layout; no-op on the redesign page) ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.goto));
});

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel-view").forEach((p) => p.classList.toggle("active", p.id === `panel-${name}`));
}

// ---------- live feed ----------
function pushFeed(kind, message) {
  if (!feedList) return;
  const item = document.createElement("div");
  item.className = `lf-item lf-${kind}`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  item.innerHTML = `<span class="lf-time">${time}</span>${message}`;
  feedList.prepend(item);
  while (feedList.children.length > 40) feedList.removeChild(feedList.lastChild);
}

// ---------- pipeline run log (redesign console; falls back to the feed) ----------
function addPipelineLog(tag, message) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (runLogEl) {
    const line = document.createElement("div");
    line.className = "log-line";
    line.innerHTML = `<span class="log-time">${time}</span><span class="log-tag">${escapeHtml(tag)}</span><span>${escapeHtml(message)}</span>`;
    runLogEl.appendChild(line);
    runLogEl.scrollTop = runLogEl.scrollHeight;
    return;
  }
  pushFeed("info", `${tag} ${escapeHtml(message)}`);
}

function setPipelineStatus(text) {
  if (pipelineStatusEl) pipelineStatusEl.innerHTML = `Status: <strong>${escapeHtml(text)}</strong>`;
}

// ---------- time helpers ----------
function nextCronRun(now) {
  const next = new Date(now);
  next.setUTCHours(CRON_SCHEDULE.hourUTC, CRON_SCHEDULE.minuteUTC, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function formatDuration(ms) {
  if (ms <= 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatUptime(ms) {
  return formatDuration(ms);
}

// ---------- job cards ----------
function renderScheduleList() {
  const scheduleList = document.getElementById("schedule-list");
  if (scheduleList) {
    scheduleList.innerHTML = JOBS.map(
      (j) =>
        `<div class="schedule-item"><span class="si-name">${j.label}</span><span class="si-odds">1 in 4 chance on any given day</span></div>`,
    ).join("");
  }
}

function renderJobCards(el, filter = "all") {
  if (!el) return;
  const filtered = JOBS.filter((j) => filter === "all" || j.id === filter);
  if (filtered.length === 0) {
    el.innerHTML = `<div class="empty">No workflows match this filter.</div>`;
    return;
  }
  el.innerHTML = filtered
    .map((j) => {
      const last = state.lastByWorkflow[j.id];
      const mod = MODULES[j.id];
      const tags = mod
        ? `<div class="tag-row">${mod.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`
        : "";
      return `<article class="job-card">
        <div class="jc-head"><h3>${j.label}</h3></div>
        <div class="jc-last">${last ? lastLine(last) : "<span class=\"status-dot\"></span>Not run yet this session"}</div>
        <p>${j.desc}</p>
        ${tags}
        <div class="job-actions">
          <button class="run-btn" data-run="${j.id}">Run now</button>
          <button class="inspect-btn" data-inspect="${j.id}">Inspect</button>
        </div>
      </article>`;
    })
    .join("");
}

function lastLine(last) {
  const dot = last.status === "success" ? "success" : last.status === "failed" ? "failed" : "running";
  const when = new Date(last.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `<span class="status-dot ${dot}"></span>Last run: ${last.status} \u00b7 ${last.durationMs}ms \u00b7 ${when}`;
}

function renderLastRunLines() {
  // Refresh the per-card "last run" lines without rebuilding buttons.
  document.querySelectorAll(".job-card").forEach((card) => {
    const btn = card.querySelector("[data-run]");
    if (!btn) return;
    const last = state.lastByWorkflow[btn.dataset.run];
    const line = card.querySelector(".jc-last");
    if (line) line.innerHTML = last ? lastLine(last) : `<span class="status-dot"></span>Not run yet this session`;
  });
}

// ---------- stats ----------
function renderStats() {
  const runs = state.runs;
  const total = runs.length;
  const successes = runs.filter((r) => r.status === "success").length;
  const successRate = total ? Math.round((successes / total) * 100) : 0;
  const avg = total ? Math.round(runs.reduce((s, r) => s + (r.duration_ms ?? 0), 0) / total) : 0;
  const next = nextCronRun(new Date());
  const inMs = next - Date.now();

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set("hs-runs", `${total} / ${state.totalCount ?? "\u2026"}`);
  set("hs-success", `${successRate}%`);
  set("hs-duration", `${avg}ms`);
  set("hs-next", `in ${formatDuration(inMs)}`);
  set("sched-next", `${next.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} (in ${formatDuration(inMs)})`);

  const statCards = document.getElementById("stat-cards");
  if (statCards) {
    statCards.innerHTML = `
      <div class="stat-card">
        <span class="sc-label">Total runs (all time)</span>
        <span class="sc-value">${state.totalCount ?? "\u2014"}</span>
        <span class="sc-sub">from Supabase (exact count)</span>
      </div>
      <div class="stat-card">
        <span class="sc-label">Runs loaded</span>
        <span class="sc-value">${total}</span>
        <span class="sc-sub">last 25 from Supabase</span>
      </div>
      <div class="stat-card">
        <span class="sc-label">Success rate (last ${total} runs)</span>
        <span class="sc-value">${successRate}%</span>
        <span class="sc-sub">${successes} successful of ${total} runs</span>
      </div>
      <div class="stat-card">
        <span class="sc-label">Average duration (last ${total} runs)</span>
        <span class="sc-value">${avg}ms</span>
        <span class="sc-sub">across the runs above</span>
      </div>`;
  }
}

// ---------- run history (Supabase REST, read-only) ----------
function renderLogRows() {
  const rows = state.runs.slice(0, state.showAll ? 25 : 5);
  const html = rows.length
    ? rows
        .map(
          (r) => `<tr>
            <td class="mono">${new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
            <td>${escapeHtml(r.workflow_name)}</td>
            <td><span class="status-badge ${r.status === "success" ? "success" : "failed"}">${r.status}</span></td>
            <td class="mono">${r.duration_ms ?? "\u2014"}ms</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="empty">No runs in the last 25 entries.</td></tr>`;
  const previewRows = state.runs.slice(0, 5).map(
    (r) => `<tr>
      <td class="mono">${new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
      <td>${escapeHtml(r.workflow_name)}</td>
      <td><span class="status-badge ${r.status === "success" ? "success" : "failed"}">${r.status}</span></td>
      <td class="mono">${r.duration_ms ?? "\u2014"}ms</td>
    </tr>`,
  ).join("") || `<tr><td colspan="4" class="empty">No runs in the last 25 entries.</td></tr>`;
  if (logBody) logBody.innerHTML = html;
  if (logBodyPreview) logBodyPreview.innerHTML = previewRows;
}

async function fetchTotalCount() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/workflow_runs?select=id`, {
      method: "GET",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Range: "0-0", Prefer: "count=exact" },
    });
    const range = res.headers.get("content-range");
    if (range) {
      const total = Number(range.split("/")[1]);
      if (!Number.isNaN(total)) state.totalCount = total;
    }
  } catch (err) {
    console.warn("Could not fetch total run count", err);
  }
  renderStats();
}

async function loadRuns() {
  try {
    let url = `${SUPABASE_URL}/rest/v1/workflow_runs?select=id,workflow_name,status,duration_ms,created_at&order=created_at.desc&limit=25`;
    if (state.filter !== "all") url += `&workflow_name=eq.${state.filter}`;
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.runs = await res.json();
    renderLogRows();
    renderStats();
    pushFeed("success", `Loaded ${state.runs.length} recent runs.`);
  } catch (err) {
    console.error("loadRuns failed", err);
    const message = `<tr><td colspan="4" class="empty">Error loading run history: ${escapeHtml(err.message)}</td></tr>`;
    if (logBody) logBody.innerHTML = message;
    if (logBodyPreview) logBodyPreview.innerHTML = message;
    pushFeed("failed", "Could not load run history.");
  }
}

// ---------- running workflows ----------
function showToast(message) {
  document.querySelectorAll(".toast").forEach((n) => n.remove());
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5200);
}

async function runWorkflow(id, options = {}) {
  if (running.has(id)) return { ok: false, status: "running", summary: "Already running." };
  running.add(id);
  const job = JOBS.find((j) => j.id === id);
  const label = job?.label ?? id;
  const buttons = document.querySelectorAll(`[data-run="${id}"]`);
  const originalLabels = [...buttons].map((b) => b.textContent);
  buttons.forEach((b) => {
    b.disabled = true;
    b.textContent = "Running\u2026";
  });
  pushFeed("info", `Running <strong>${escapeHtml(label)}</strong>\u2026`);
  let result;
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow: id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === "failed") throw new Error(data.error || data.output?.summary || `HTTP ${res.status}`);
    const durationMs = data.duration_ms ?? 0;
    const summary = data.output?.summary || `${label} completed.`;
    if (outputSection) outputSection.hidden = false;
    if (outputBody) outputBody.textContent = JSON.stringify(data, null, 2);
    state.lastByWorkflow[id] = { status: "success", durationMs, at: new Date().toISOString() };
    pushFeed("success", `<strong>${escapeHtml(label)}</strong> \u2014 ${escapeHtml(summary)}`);
    showToast(`${label} ran successfully`);
    result = { ok: true, status: "success", durationMs, summary };
  } catch (err) {
    console.error("runWorkflow failed", id, err);
    state.lastByWorkflow[id] = { status: "failed", durationMs: 0, at: new Date().toISOString() };
    pushFeed("failed", `<strong>${escapeHtml(label)}</strong> failed: ${escapeHtml(err.message)}`);
    showToast(`${label} failed: ${err.message}`);
    result = { ok: false, status: "failed", durationMs: 0, summary: err.message };
  }
  buttons.forEach((b, i) => {
    b.disabled = false;
    b.textContent = originalLabels[i];
  });
  running.delete(id);
  renderLastRunLines();
  await loadRuns();
  await fetchTotalCount();
  if (!options.fromPipeline && document.querySelector(".tab")) switchTab("activity");
  return result;
}

async function runAll(btn) {
  if (btn) {
    btn.disabled = true;
    btn.dataset.label = btn.textContent;
    btn.textContent = "Running all\u2026";
  }
  pushFeed("info", "Running all workflows \u2014 one after another.");
  for (const j of JOBS) await runWorkflow(j.id, { fromPipeline: true });
  pushFeed("success", "Finished running all workflows.");
  if (btn) {
    btn.disabled = false;
    btn.textContent = btn.dataset.label;
  }
}

// ---------- pipeline: sequential run, inspector, output ----------
function setStageState(id, status) {
  document.querySelectorAll(`.stage-node[data-job="${id}"]`).forEach((node) => {
    node.classList.remove("running", "done", "failed");
    const stateEl = node.querySelector(".stage-state");
    if (status === "running") {
      node.classList.add("running");
      if (stateEl) stateEl.textContent = "running\u2026";
    } else if (status === "done") {
      node.classList.add("done");
      if (stateEl) stateEl.textContent = "done \u2713";
    } else if (status === "failed") {
      node.classList.add("failed");
      if (stateEl) stateEl.textContent = "failed";
    } else if (stateEl) {
      stateEl.textContent = "queued";
    }
  });
}

function selectModule(id) {
  const mod = MODULES[id];
  if (!mod) return;
  inspectedJob = id;
  document.querySelectorAll(".stage-node").forEach((n) => n.classList.toggle("selected", n.dataset.job === id));
  document.querySelectorAll(".module-card").forEach((c) => c.classList.toggle("selected", c.dataset.job === id));
  const title = document.getElementById("inspectorTitle");
  const meta = document.getElementById("inspectorMeta");
  const io = document.getElementById("inspectorIo");
  const how = document.getElementById("inspectorHow");
  const fails = document.getElementById("inspectorFails");
  if (title) title.textContent = `${mod.icon} ${mod.title}`;
  if (meta) meta.textContent = `Stage ${mod.stage} of ${PIPELINE_ORDER.length} \u00b7 JavaScript module \u00b7 reads and writes Supabase`;
  if (io) io.textContent = mod.io;
  if (how) how.textContent = mod.how;
  if (fails) fails.textContent = mod.fails;
}

function renderModuleGrid() {
  const grid = document.getElementById("moduleGrid");
  if (!grid) return;
  grid.innerHTML = JOBS.map((j) => {
    const mod = MODULES[j.id];
    return `<button class="module-card" data-job="${j.id}" data-inspect="${j.id}" type="button">
      <h3>${mod.icon} ${mod.title}</h3>
      <p>${j.desc}</p>
      <p><strong>Input:</strong> ${escapeHtml(mod.io.split("Output:")[0].replace("Input:", "").trim())}<br><strong>Output:</strong> ${escapeHtml(mod.io.split("Output:")[1]?.trim() ?? "")}</p>
      <div class="tag-row">${mod.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
      <span class="inspect-hint">Tap to inspect \u2191</span>
    </button>`;
  }).join("");
}

function appendOutputCard(id, result) {
  if (!pipelineOutputEl) return;
  const empty = pipelineOutputEl.querySelector(".output-empty");
  if (empty) empty.remove();
  const job = JOBS.find((j) => j.id === id);
  const mod = MODULES[id];
  const card = document.createElement("article");
  card.className = `output-card${result.ok ? "" : " is-failed"}`;
  card.innerHTML = `<h4>${mod ? `${mod.icon} ` : ""}${escapeHtml(job?.label ?? id)}</h4>
    <div class="output-meta">${result.status} \u00b7 ${result.durationMs}ms \u00b7 ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
    <p class="output-summary">${escapeHtml(result.summary)}</p>`;
  pipelineOutputEl.appendChild(card);
}

function resetPipeline() {
  if (pipelineRunning) return;
  PIPELINE_ORDER.forEach((id) => setStageState(id, "queued"));
  if (pipelineOutputEl) {
    pipelineOutputEl.innerHTML = `<p class="output-empty">Nothing yet. Output cards appear here as each stage finishes.</p>`;
  }
  if (runLogEl) runLogEl.innerHTML = "";
  if (pipelineStartedEl) pipelineStartedEl.textContent = "";
  setPipelineStatus("idle \u2014 ready to run");
  addPipelineLog("RESET", "Pipeline reset \u2014 ready.");
}

async function runPipeline() {
  if (pipelineRunning) return;
  pipelineRunning = true;
  if (runPipelineBtn) {
    runPipelineBtn.disabled = true;
    runPipelineBtn.textContent = "\u25CF Running\u2026";
  }
  const runAllBtn = document.getElementById("run-all-btn");
  if (runAllBtn) runAllBtn.disabled = true;
  document.querySelectorAll("[data-run]").forEach((b) => (b.disabled = true));
  if (pipelineStartedEl) {
    pipelineStartedEl.textContent = `run started ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  }
  setPipelineStatus("running \u2014 crawl in progress");
  addPipelineLog("RUN", "cron-style run starting \u2014 4 workflows, in order");
  let failed = 0;
  for (const id of PIPELINE_ORDER) {
    const job = JOBS.find((j) => j.id === id);
    selectModule(id);
    setStageState(id, "running");
    setPipelineStatus(`running \u2014 ${job.label.toLowerCase()} in progress`);
    addPipelineLog("RUN", `${job.label} \u2014 calling POST /api/run`);
    const result = await runWorkflow(id, { fromPipeline: true });
    setStageState(id, result.ok ? "done" : "failed");
    appendOutputCard(id, result);
    addPipelineLog(result.ok ? "OK" : "FAIL", `${job.label} \u2014 ${result.summary}`);
    if (!result.ok) failed += 1;
    if (id !== PIPELINE_ORDER[PIPELINE_ORDER.length - 1]) await new Promise((r) => setTimeout(r, pipelineSpeedMs));
  }
  setPipelineStatus(failed ? `done \u2014 ${failed} stage${failed > 1 ? "s" : ""} failed` : "done \u2014 all 4 stages finished");
  addPipelineLog("DONE", failed ? `Pipeline finished with ${failed} failed stage${failed > 1 ? "s" : ""}.` : "Pipeline finished \u2014 all 4 stages done, results logged to Supabase.");
  pushFeed(failed ? "failed" : "success", failed ? "Pipeline run finished with failures." : "Pipeline run finished \u2014 all 4 stages done.");
  if (runPipelineBtn) {
    runPipelineBtn.disabled = false;
    runPipelineBtn.textContent = "\u25B6 Run pipeline";
  }
  if (runAllBtn) runAllBtn.disabled = false;
  document.querySelectorAll("[data-run]").forEach((b) => (b.disabled = false));
  pipelineRunning = false;
}

// ---------- wiring ----------
document.addEventListener("click", (event) => {
  const runBtn = event.target.closest("[data-run]");
  if (runBtn && !runBtn.disabled && !pipelineRunning) {
    runWorkflow(runBtn.dataset.run);
    return;
  }
  const inspectBtn = event.target.closest("[data-inspect]");
  if (inspectBtn) {
    selectModule(inspectBtn.dataset.inspect);
    const consoleEl = document.getElementById("demo");
    if (consoleEl && !document.querySelector(".panel-view")) consoleEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

if (runPipelineBtn) runPipelineBtn.addEventListener("click", runPipeline);
if (pipelineResetBtn) pipelineResetBtn.addEventListener("click", resetPipeline);

const speedNormalBtn = document.getElementById("speedNormal");
const speedFastBtn = document.getElementById("speedFast");
if (speedNormalBtn && speedFastBtn) {
  speedNormalBtn.addEventListener("click", () => {
    pipelineSpeedMs = 900;
    speedNormalBtn.classList.add("active");
    speedFastBtn.classList.remove("active");
  });
  speedFastBtn.addEventListener("click", () => {
    pipelineSpeedMs = 250;
    speedFastBtn.classList.add("active");
    speedNormalBtn.classList.remove("active");
  });
}

const runAllBtn = document.getElementById("run-all-btn");
if (runAllBtn) runAllBtn.addEventListener("click", () => runAll(runAllBtn));

const refreshBtn = document.getElementById("refresh");
if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    await loadRuns();
    await fetchTotalCount();
    pushFeed("info", "Refreshed run history.");
  });
}

const viewAllBtn = document.getElementById("view-all-btn");
if (viewAllBtn) {
  viewAllBtn.addEventListener("click", () => {
    state.showAll = !state.showAll;
    viewAllBtn.textContent = state.showAll ? "Show less \u2190" : "View all \u2192";
    renderLogRows();
  });
}

if (filterSelect) {
  filterSelect.addEventListener("change", async () => {
    state.filter = filterSelect.value;
    renderJobCards(document.getElementById("jobs-overview"), state.filter);
    renderJobCards(document.getElementById("jobs-full"), state.filter);
    await loadRuns();
  });
}

// ---------- init ----------
renderScheduleList();
renderJobCards(document.getElementById("jobs-overview"));
renderJobCards(document.getElementById("jobs-full"));
renderModuleGrid();
selectModule(inspectedJob);
setPipelineStatus("idle \u2014 ready to run");
addPipelineLog("READY", "Run console ready \u2014 pipeline idle.");
pushFeed("info", "Dashboard connected \u2014 loading run history\u2026");
loadRuns();
fetchTotalCount();

setInterval(() => {
  const uptimeEl = document.getElementById("sc-uptime");
  if (uptimeEl) uptimeEl.textContent = formatUptime(Date.now() - state.sessionStart);
  // "next run" countdowns tick every second.
  renderStats();
}, 1000);

setInterval(() => {
  loadRuns();
  fetchTotalCount();
}, 30000);
