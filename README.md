# Ops-Automation

Ops-Automation is a scheduled-task automation dashboard — a set of small, real operations workflows that run on a schedule, log what they did, and present the results in a live dashboard.

Live: https://ops-automation-kumailr.vercel.app/

## What it does

Four workflows, defined in `api/_jobs.js` and run through `POST /api/run` (or on schedule through `GET /api/cron`):

- **Job-board crawler** (`job-board-crawler`): fetches live "software engineer" listings from the Remotive public jobs API (20 per call) and reports the count plus the first three matches. If the API is unreachable or returns no jobs, the run is logged as failed — there is no sample fallback.
- **CRM lead enrichment** (`crm-lead-enrichment`): performs real HTTP checks against three sample leads (Palantir, Vercel, Supabase) and records each site's live status, response time, and page title. A site that times out (5 s) is recorded as unreachable.
- **Interview scheduler** (`interview-scheduler`): computes the real overlapping free slots of 30 minutes or more between two sample calendars (interviewer and candidate, 09:00–17:00 day).
- **Follow-up drafting** (`gmail-followup-drafts`): finds leads overdue for follow-up by real date math (5-day rule) and drafts a follow-up message for each. Drafts are previews — nothing is ever sent.
- **Run logging**: every workflow run is written to the `workflow_runs` table in Supabase (workflow name, status, duration, source, timestamp), with `source` set to `manual trigger` for a visitor run and `scheduled` for a cron run.
- **Scheduled execution**: `vercel.json` wires `/api/cron` to Vercel Cron (`0 13 * * *` UTC — 05:00 PT daily). Each cron tick runs one randomly selected workflow.

## The dashboard

`public/` is a single-page dashboard (HTML/CSS/JavaScript, no framework) in the pipeline-redesign style:

- **Hero + core loop**: an animated Crawl → Enrich → Schedule → Follow-up loop (CSS animation, paused for `prefers-reduced-motion`).
- **Live demo**: a run console. "Run pipeline" steps through all four real workflows in order — Normal or Fast speed — narrating each step in the run log and landing a real output card per stage. A stage inspector (tap any stage, module, or workflow card) shows that module's real input → output, how it works, and when it fails.
- **Pipeline**: the four workflow cards with per-workflow last-run status, a filter, Run now per workflow, and "Run all at once" (sequential).
- **Modules**: the same four modules, described as independently testable units.
- **Dashboard**: live stats from Supabase — total runs (exact count), runs loaded (last 25), success rate and average duration over the last 25, next scheduled run — plus recent activity, the cron schedule, system info, and a live feed. History refreshes every 30 seconds.

No sample data anywhere: every number and output card on the page comes from Supabase or from a live API call.

## Tech stack

- Backend: JavaScript serverless functions in `api/` (Node.js runtime on Vercel) — `api/run.js` (manual runs), `api/cron.js` (scheduled runs), `api/_jobs.js` (the four workflows), `api/_supabase.js` (Supabase client)
- Frontend: static dashboard in `public/` (HTML/CSS/JavaScript)
- Data: Supabase, table `workflow_runs` (columns: `workflow_name`, `status`, `duration_ms`, `source`, `created_at`)
- Deployment and scheduling: Vercel, Vercel Cron (`vercel.json`)

## How to run it

Deploy the repository on Vercel, which serves the dashboard from `public/`, the API functions from `api/`, and the scheduled job from `vercel.json`. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the API functions, then open the dashboard to trigger workflows manually ("Run pipeline" or any Run button) or view their scheduled runs.

Locally: `vercel dev` (Vercel CLI) with the same environment variables set.

## Status

Working demo: all four workflows, run logging, and the dashboard are implemented. Scores, drafts, and enrichment details are what the live APIs actually return — nothing is mocked.
