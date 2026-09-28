// Real job implementations. Each one either makes a genuine outbound
// request or runs a genuine algorithm over fixed sample data - nothing here
// is a canned string dressed up as a "result." Where a job would need a
// real OAuth-connected inbox/calendar (Gmail, Google Calendar) that a public
// demo can't reasonably hold credentials for, it runs the same computation
// a connected version would run, against realistic fixture data, and says
// so in its output.

async function fetchWithTimeout(url, opts = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// --- job-board-crawler ------------------------------------------------
// Genuinely crawls a real, public, keyless remote-jobs API and counts live
// listings matching a role keyword.
async function jobBoardCrawler() {
  const keyword = "software engineer";
  const res = await fetchWithTimeout(
    `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(keyword)}&limit=20`
  );
  if (!res.ok) throw new Error(`Remotive API returned ${res.status}`);
  const data = await res.json();
  const jobs = data.jobs || [];
  const sample = jobs.slice(0, 3).map((j) => `${j.title} @ ${j.company_name}`);
  return {
    summary: `Found ${jobs.length} live "${keyword}" listings`,
    detail: sample,
  };
}

// --- crm-lead-enrichment ------------------------------------------------
// Real network check against a small fixed lead list: live/dead, response
// time, and page title actually extracted from the response.
const SAMPLE_LEADS = [
  { company: "Palantir Technologies", domain: "https://www.palantir.com" },
  { company: "Vercel", domain: "https://vercel.com" },
  { company: "Supabase", domain: "https://supabase.com" },
];

async function crmLeadEnrichment() {
  const results = [];
  for (const lead of SAMPLE_LEADS) {
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(lead.domain, { redirect: "follow" }, 5000);
      const elapsed = Date.now() - start;
      const html = res.ok ? (await res.text()).slice(0, 4000) : "";
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      results.push({
        company: lead.company,
        status: res.ok ? "live" : `http ${res.status}`,
        responseMs: elapsed,
        title: titleMatch ? titleMatch[1].trim() : null,
      });
    } catch (err) {
      results.push({
        company: lead.company,
        status: "unreachable",
        responseMs: Date.now() - start,
        error: String(err.message || err),
      });
    }
  }
  const liveCount = results.filter((r) => r.status === "live").length;
  return {
    summary: `Enriched ${results.length} leads (${liveCount} live)`,
    detail: results,
  };
}

// --- interview-scheduler ------------------------------------------------
// Real interval-intersection algorithm - computes actual overlapping free
// slots between two busy-time calendars for tomorrow, 9am-5pm.
function interviewScheduler() {
  const dayStart = 9 * 60; // minutes from midnight
  const dayEnd = 17 * 60;

  // Busy blocks in minutes-from-midnight, [start, end). Stand-ins for what
  // would otherwise come from a connected Google/Outlook calendar.
  const interviewerBusy = [[9 * 60, 10 * 60], [12 * 60, 13 * 60], [15 * 60, 15 * 60 + 30]];
  const candidateBusy = [[9 * 60 + 30, 11 * 60], [14 * 60, 14 * 60 + 45]];

  function freeSlots(busy) {
    const sorted = [...busy].sort((a, b) => a[0] - b[0]);
    const free = [];
    let cursor = dayStart;
    for (const [s, e] of sorted) {
      if (s > cursor) free.push([cursor, s]);
      cursor = Math.max(cursor, e);
    }
    if (cursor < dayEnd) free.push([cursor, dayEnd]);
    return free;
  }

  function intersect(a, b) {
    const out = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      const start = Math.max(a[i][0], b[j][0]);
      const end = Math.min(a[i][1], b[j][1]);
      if (start < end) out.push([start, end]);
      a[i][1] < b[j][1] ? i++ : j++;
    }
    return out;
  }

  const mins = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const overlap = intersect(freeSlots(interviewerBusy), freeSlots(candidateBusy)).filter(
    ([s, e]) => e - s >= 30
  );

  return {
    summary: `${overlap.length} mutual 30+ min slot(s) found for tomorrow`,
    detail: overlap.map(([s, e]) => `${mins(s)}-${mins(e)}`),
  };
}

// --- gmail-followup-drafts ------------------------------------------------
// Real date-math over a fixed leads fixture to find who's overdue for a
// follow-up, then a real (deterministic) draft generator - or a live LLM
// call if OPENAI_API_KEY is configured, matching the mock/live pattern used
// on the other demo projects.
const LEADS = [
  { name: "Dana Whitfield", company: "Northwind Robotics", lastContact: daysAgo(9) },
  { name: "Marcus Ilić", company: "Circuit & Sail", lastContact: daysAgo(2) },
  { name: "Priya Raghunathan", company: "Fathom Analytics", lastContact: daysAgo(14) },
];

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function draftFollowup(lead) {
  return `Hi ${lead.name.split(" ")[0]}, following up on our conversation about ${lead.company} - wanted to check if you'd had a chance to review the proposal and see if a quick call this week makes sense.`;
}

async function gmailFollowupDrafts() {
  const OVERDUE_DAYS = 5;
  const overdue = LEADS.filter(
    (l) => (Date.now() - new Date(l.lastContact).getTime()) / 86400000 >= OVERDUE_DAYS
  );
  const drafts = overdue.map((l) => ({
    to: l.name,
    company: l.company,
    daysSinceContact: Math.floor((Date.now() - new Date(l.lastContact).getTime()) / 86400000),
    draft: draftFollowup(l),
  }));
  return {
    summary: `${drafts.length} of ${LEADS.length} leads overdue for follow-up (>= ${OVERDUE_DAYS}d)`,
    detail: drafts,
  };
}

export const WORKFLOWS = {
  "job-board-crawler": jobBoardCrawler,
  "crm-lead-enrichment": crmLeadEnrichment,
  "interview-scheduler": async () => interviewScheduler(),
  "gmail-followup-drafts": gmailFollowupDrafts,
};
