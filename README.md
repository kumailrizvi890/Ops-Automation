# Ops-Automation

Ops-Automation is a scheduled-task automation dashboard — a set of small, real operations workflows that run on a schedule, log what they did, and present the results in a tabbed dashboard.

## What it does

- **Job-board crawler** (`api/job-board-crawler.js`): fetches remote job postings from the Remotive API, filters them by role and keyword, de-duplicates them, and stores matches in Supabase — with a sample job included so the UI works before any API is configured.
- **CRM lead enrichment** (`api/crm-enrichment.js`): enriches leads with company domain, size, industry, and an engagement score, and records the enriched leads in Supabase.
- **Interview scheduler** (`api/interview-scheduler.js`): finds overlapping availability between a candidate and an interviewer (interval intersection), proposes time slots, and logs scheduled interviews.
- **Overdue follow-up drafting** (`api/overdue-followup.js`): finds overdue follow-ups and drafts follow-up messages for them.
- **Run logging and dashboard**: every workflow run is written to `workflow_runs` in Supabase, and the dashboard in `public/` shows Overview, Workflows, Activity, and Schedule tabs, with run history and per-workflow status.
- **Scheduled execution**: `vercel.json` wires the workflows to Vercel Cron, so they run automatically on the schedule defined there.

## Tech stack

- Backend: JavaScript serverless functions in `api/` (Node.js runtime on Vercel)
- Frontend: static dashboard in `public/` (HTML/CSS/JavaScript)
- Data: Supabase (`workflow_runs`, `jobs`, `leads`, `interviews`, `followups` tables)
- Deployment and scheduling: Vercel, Vercel Cron (`vercel.json`)

## How to run it

Deploy the repository on Vercel, which serves the dashboard from `public/`, the API functions from `api/`, and the scheduled jobs from `vercel.json`. Set the Supabase credentials the API functions expect, then open the dashboard to trigger workflows manually or view their scheduled runs.

## Status

Working demo: all four workflows, run logging, and the dashboard are implemented. The crawler uses the Remotive API and falls back to a sample job when no live results are available.
