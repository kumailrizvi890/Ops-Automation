import { WORKFLOWS } from "./_jobs.js";
import { logWorkflowRun } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const workflow_name =
    (req.body && req.body.workflow) || req.query.workflow || "";

  const job = WORKFLOWS[workflow_name];
  if (!job) {
    res.status(400).json({
      error: `Unknown workflow "${workflow_name}"`,
      available: Object.keys(WORKFLOWS),
    });
    return;
  }

  const start = Date.now();
  let status = "success";
  let output = null;
  let errorMessage = null;

  try {
    output = await job();
  } catch (err) {
    status = "failed";
    errorMessage = String(err.message || err);
  }

  const duration_ms = Date.now() - start;

  let logged = null;
  try {
    logged = await logWorkflowRun({
      workflow_name,
      status,
      duration_ms,
      source: "manual trigger",
    });
  } catch (logErr) {
    // Logging failure shouldn't hide the job's real result from the caller.
    console.error("Failed to log run:", logErr);
  }

  res.status(status === "success" ? 200 : 502).json({
    workflow_name,
    status,
    duration_ms,
    output,
    error: errorMessage,
    logged,
  });
}
