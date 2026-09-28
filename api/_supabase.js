// Shared Supabase REST helper. This project logs every workflow run into the
// same `workflow_runs` table used elsewhere in the portfolio, via Supabase's
// PostgREST API and its public anon key - the anon key is meant to be
// client-visible (it's gated entirely by the table's RLS policies, which
// explicitly allow anon SELECT and INSERT on this table for exactly this
// kind of public demo), so it's safe to ship in this repo.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://gxjyjvqgdmtxipqpgisl.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4anlqdnFnZG10eGlwcXBnaXNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0OTQxOTMsImV4cCI6MjEwNjA3MDE5M30.odB-vMHeyknhPZTYACLYyijgyiW1OflkTNdSlzDERTI";

export async function logWorkflowRun({ workflow_name, status, duration_ms, source }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/workflow_runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify([{ workflow_name, status, duration_ms, source }]),
  });
  if (!res.ok) {
    throw new Error(`Failed to log workflow run: ${res.status} ${await res.text()}`);
  }
  const rows = await res.json();
  return rows[0];
}

export async function fetchRecentRuns(limit = 25) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/workflow_runs?select=*&order=created_at.desc&limit=${limit}`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`);
  return res.json();
}
