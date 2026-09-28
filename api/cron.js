import { WORKFLOWS } from "./_jobs.js";
import { logWorkflowRun } from "./_supabase.js";

// Hit by Vercel Cron (see vercel.json) - runs one real workflow on a fixed
// schedule, independent of anyone viewing the dashboard, and logs it with
// source "scheduled" so the log visibly distinguishes automated runs from
// visitor-triggered ones.
export default async function handler(req, res) {
  const names = Object.keys(WORKFLOWS);
  const workflow_name = names[Math.floor(Math.random() * names.length)];
  const start = Date.now();
  let status = "success";
  try {
    await WORKFLOWS[workflow_name]();
  } catch (err) {
    status = "failed";
  }
  const duration_ms = Date.now() - start;
  try {
    await logWorkflowRun({ workflow_name, status, duration_ms, source: "scheduled" });
  } catch (err) {
    console.error("cron log failed", err);
  }
  res.status(200).json({ workflow_name, status, duration_ms });
}
