const SUPABASE_URL = "https://gxjyjvqgdmtxipqpgisl.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4anlqdnFnZG10eGlwcXBnaXNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0OTQxOTMsImV4cCI6MjEwNjA3MDE5M30.odB-vMHeyknhPZTYACLYyijgyiW1OflkTNdSlzDERTI";

const JOBS = [
  {
    id: "job-board-crawler",
    label: "Job board crawler",
    desc: "Live-crawls Remotive's public jobs API and counts current “software engineer” listings.",
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

const CRON_SCHEDULE = { hourUTC: 13, minuteUTC: 0 }; // matches vercel.json: "0 13 * * *"

const state = {
  runs: [],
  totalCount: null,
  lastByWorkflow: {},
  sessionStart: Date.now(),
};

// ---------- element refs ----------
const logBody = document.getElementById("log-body");
const logBodyPreview = document.getElementById("log-body-preview");
const outputSection = document.getElementById("output-section");
const outputBody = document.getElementById("output-body");
const feedList = document.getElementById("live-feed-list");
const filterSelect = document.getElementById("filter-workflow");

// ---------- tabs ----------
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
  const item = document.createElement("div");
  item.className = `lf-item lf-${kind}`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  item.innerHTML = `<span class="lf-time">${time}</span>${message}`;
  feedList.prepend(item);
  while (feedList.children.length > 40) feedList.removeChild(feedList.lastChild);
}

// ---------- time helpers ----------
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function nextCronRun() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), CRON_SCHEDULE.hourUTC, CRON_SCHEDULE.minuteUTC, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  const msLeft = next.getTime() - now.getTime();
  const hrsLeft = Math.floor(msLeft / 3600000);
  const minsLeft = Math.floor((msLeft % 3600000) / 60000);
  const label = next.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  return { label, countdown: `in ${hrsLeft}h ${minsLeft}m` };
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ---------- job cards ----------
function renderJobCards(containerEl) {
  containerEl.innerHTML = "";
  for (const job of JOBS) {
    const card = document.createElement("div");
    card.className = "job-card";
    card.dataset.jobId = job.id;
    card.innerHTML = `
      <div class="jc-head">
        <h3>${job.label}</h3>
      </div>
      <p>${job.desc}</p>
      <div class="jc-last" data-last-for="${job.id}"><span class="status-dot idle"></span>No runs loaded yet</div>
      <button class="run-btn" data-workflow="${job.id}">Run now</button>
    `;
    containerEl.appendChild(card);
  }
  containerEl.querySelectorAll(".run-btn").forEach((btn) => {
    btn.addEventListener("click", () => runWorkflow(btn.dataset.workflow));
  });
}

function renderLastRunLines() {
  document.querySelectorAll("[data-last-for]").forEach((el) => {
    const id = el.dataset.lastFor;
    const last = state.lastByWorkflow[id];
    if (!last) {
      el.innerHTML = `<span class="status-dot idle"></span>No runs in last 25 loaded`;
      return;
    }
    el.innerHTML = `<span class="status-dot ${last.status}"></span>${last.status} · ${timeAgo(last.created_at)} · ${last.duration_ms}ms`;
  });
}

// ---------- stats ----------
function renderStats() {
  const runs = state.runs;
  const total = runs.length;
  const successCount = runs.filter((r) => r.status === "success").length;
  const successRate = total ? Math.round((successCount / total) * 100) : null;
  const avgDuration = total ? Math.round(runs.reduce((sum, r) => sum + (r.duration_ms || 0), 0) / total) : null;
  const next = nextCronRun();

  document.getElementById("hs-runs").textContent = total ? String(total) : "—";
  document.getElementById("hs-success").textContent = successRate === null ? "—" : `${successRate}%`;
  document.getElementById("hs-duration").textContent = avgDuration === null ? "—" : `${avgDuration}ms`;
  document.getElementById("hs-next").textContent = next.countdown;
  document.getElementById("sched-next").textContent = `${next.label} (${next.countdown})`;

  const cardsEl = document.getElementById("stat-cards");
  cardsEl.innerHTML = `
    <div class="stat-card">
      <span class="sc-label">Total Runs</span>
      <span class="sc-value">${state.totalCount !== null ? state.totalCount : "—"}</span>
      <div class="sc-sub">logged in Supabase</div>
    </div>
    <div class="stat-card">
      <span class="sc-label">Success Rate</span>
      <span class="sc-value">${successRate === null ? "—" : successRate + "%"}</span>
      <div class="sc-sub">last ${total || 0} runs</div>
    </div>
    <div class="stat-card">
      <span class="sc-label">Avg Duration</span>
      <span class="sc-value">${avgDuration === null ? "—" : avgDuration + "ms"}</span>
      <div class="sc-sub">last ${total || 0} runs</div>
    </div>
    <div class="stat-card">
      <span class="sc-label">Next Scheduled</span>
      <span class="sc-value">${next.countdown}</span>
      <div class="sc-sub">${next.label}</div>
    </div>
  `;
}

// ---------- run log ----------
function renderLogRows(targetEl, rows, limit) {
  if (!Array.isArray(rows) || rows.length === 0) {
    targetEl.innerHTML = `<tr><td colspan="5" class="empty">No runs yet - trigger one above.</td></tr>`;
    return;
  }
  targetEl.innerHTML = rows
    .slice(0, limit || rows.length)
    .map(
      (r) => `
    <tr>
      <td class="mono">${r.workflow_name}</td>
      <td><span class="status-badge ${r.status}">${r.status}</span></td>
      <td class="mono">${r.duration_ms}ms</td>
      <td class="mono">${r.source}</td>
      <td class="mono">${timeAgo(r.created_at)}</td>
    </tr>`
    )
    .join("");
}

async function fetchTotalCount() {
  try {
    const knownWorkflows = JOBS.map((j) => j.id).join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/workflow_runs?select=id&workflow_name=in.(${knownWorkflows})`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          Prefer: "count=exact",
          Range: "0-0",
        },
      }
    );
    const range = res.headers.get("content-range"); // e.g. "0-0/137"
    if (range && range.includes("/")) {
      const total = range.split("/")[1];
      state.totalCount = total === "*" ? null : Number(total);
    }
  } catch (err) {
    // Non-fatal - stat card just shows a dash.
  }
}

async function loadRuns(workflowFilter) {
  try {
    const knownWorkflows = JOBS.map((j) => j.id).join(",");
    let url = `${SUPABASE_URL}/rest/v1/workflow_runs?select=*&workflow_name=in.(${knownWorkflows})&order=created_at.desc&limit=25`;
    if (workflowFilter) {
      url = `${SUPABASE_URL}/rest/v1/workflow_runs?select=*&workflow_name=eq.${workflowFilter}&order=created_at.desc&limit=25`;
    }
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    const rows = await res.json();
    const rowList = Array.isArray(rows) ? rows : [];

    if (!workflowFilter) {
      state.runs = rowList;
      state.lastByWorkflow = {};
      for (const r of rowList) {
        if (!state.lastByWorkflow[r.workflow_name]) state.lastByWorkflow[r.workflow_name] = r;
      }
      renderLastRunLines();
      renderStats();
      renderLogRows(logBodyPreview, rowList, 5);
    }
    renderLogRows(logBody, rowList);
  } catch (err) {
    logBody.innerHTML = `<tr><td colspan="5" class="empty">Couldn't load run history: ${err.message}</td></tr>`;
  }
}

// ---------- running workflows ----------
async function runWorkflow(workflow) {
  const buttons = document.querySelectorAll(`[data-workflow="${workflow}"]`);
  const originalLabels = [];
  buttons.forEach((btn) => {
    originalLabels.push(btn.textContent);
    btn.disabled = true;
    btn.textContent = "Running…";
  });

  const label = (JOBS.find((j) => j.id === workflow) || {}).label || workflow;
  pushFeed("info", `Triggered <strong>${label}</strong>…`);

  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow }),
    });
    const data = await res.json();
    outputSection.hidden = false;
    outputBody.textContent = JSON.stringify(data, null, 2);
    if (data.status === "success") {
      pushFeed("success", `${label} finished — ${data.duration_ms}ms`);
    } else {
      pushFeed("failed", `${label} failed — ${data.error || "see output"}`);
    }
    await Promise.all([loadRuns(filterSelect.value || undefined), fetchTotalCount()]);
    renderStats();
    switchTab("activity");
  } catch (err) {
    outputSection.hidden = false;
    outputBody.textContent = `Request failed: ${err.message}`;
    pushFeed("failed", `${label} request failed — ${err.message}`);
  } finally {
    buttons.forEach((btn, i) => {
      btn.disabled = false;
      btn.textContent = originalLabels[i];
    });
  }
}

async function runAll() {
  const btn = document.getElementById("run-all-btn");
  btn.disabled = true;
  btn.textContent = "Running all…";
  pushFeed("info", `Running all ${JOBS.length} workflows sequentially…`);
  for (const job of JOBS) {
    await runWorkflow(job.id);
  }
  btn.disabled = false;
  btn.textContent = "Run all now";
  pushFeed("info", "Run-all complete.");
}

// ---------- schedule panel ----------
function renderScheduleList() {
  const el = document.getElementById("schedule-list");
  el.innerHTML = JOBS.map(
    (job) => `
    <div class="schedule-item">
      <span class="si-name">${job.label}</span>
      <span class="si-odds">1 in ${JOBS.length} chance on any given day</span>
    </div>`
  ).join("");
}

// ---------- filter select ----------
function populateFilter() {
  for (const job of JOBS) {
    const opt = document.createElement("option");
    opt.value = job.id;
    opt.textContent = job.label;
    filterSelect.appendChild(opt);
  }
  filterSelect.addEventListener("change", () => loadRuns(filterSelect.value || undefined));
}

// ---------- wiring ----------
document.getElementById("refresh").addEventListener("click", () => loadRuns(filterSelect.value || undefined));
document.getElementById("run-all-btn").addEventListener("click", runAll);

renderJobCards(document.getElementById("jobs-overview"));
renderJobCards(document.getElementById("jobs-full"));
renderScheduleList();
populateFilter();

pushFeed("info", "Dashboard connected — loading run history…");
Promise.all([loadRuns(), fetchTotalCount()]).then(() => {
  renderStats();
  pushFeed("info", `Loaded ${state.runs.length} recent run${state.runs.length === 1 ? "" : "s"}.`);
});

setInterval(() => loadRuns(filterSelect.value || undefined), 30000);
setInterval(() => {
  document.getElementById("sc-uptime").textContent = formatUptime(Date.now() - state.sessionStart);
  document.getElementById("hs-next").textContent = nextCronRun().countdown;
}, 1000);
