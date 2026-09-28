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

const jobsEl = document.getElementById("jobs");
const logBody = document.getElementById("log-body");
const outputSection = document.getElementById("output-section");
const outputBody = document.getElementById("output-body");

function renderJobCards() {
  jobsEl.innerHTML = "";
  for (const job of JOBS) {
    const card = document.createElement("div");
    card.className = "job-card";
    card.innerHTML = `
      <h3>${job.label}</h3>
      <p>${job.desc}</p>
      <button class="run-btn" data-workflow="${job.id}">Run now</button>
    `;
    jobsEl.appendChild(card);
  }
  jobsEl.querySelectorAll(".run-btn").forEach((btn) => {
    btn.addEventListener("click", () => runWorkflow(btn.dataset.workflow, btn));
  });
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function loadRuns() {
  try {
    const knownWorkflows = JOBS.map((j) => j.id).join(",");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/workflow_runs?select=*&workflow_name=in.(${knownWorkflows})&order=created_at.desc&limit=25`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      logBody.innerHTML = `<tr><td colspan="5" class="empty">No runs yet - trigger one above.</td></tr>`;
      return;
    }
    logBody.innerHTML = rows
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
  } catch (err) {
    logBody.innerHTML = `<tr><td colspan="5" class="empty">Couldn't load run history: ${err.message}</td></tr>`;
  }
}

async function runWorkflow(workflow, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Running…";
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow }),
    });
    const data = await res.json();
    outputSection.hidden = false;
    outputBody.textContent = JSON.stringify(data, null, 2);
    await loadRuns();
  } catch (err) {
    outputSection.hidden = false;
    outputBody.textContent = `Request failed: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

document.getElementById("refresh").addEventListener("click", loadRuns);

renderJobCards();
loadRuns();
setInterval(loadRuns, 30000);
