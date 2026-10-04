# APEXOPS™ Web App

Exhibitor query management portal for Executive Conference Events.

---

## Run locally in VS Code (5 minutes)

### Requirements
- Node.js installed → download from https://nodejs.org (LTS version)
- VS Code with a terminal

### Steps

```bash
# 1. Open this folder in VS Code
# 2. Open the terminal (Ctrl + `)
# 3. Install dependencies
npm install

# 4. Start the app
npm start
```

Your browser opens at **http://localhost:3000** automatically.

### Run an isolated demo

```bash
npm run start:demo
```

Open **http://localhost:3001**. Demo mode disables Supabase even when the live app has `.env` credentials, uses fictional sample records, and saves changes only in that browser tab's session storage. Closing the demo tab clears its changes; the live app on port 3000 is not modified.

---

## Three views

| View | URL | Who uses it |
|---|---|---|
| Home / Role picker | / | Everyone |
| Ops Portal | Click "Ops Portal" | ECE + GL Events managers |
| My Queue | Click "My Queue" | Dept technicians |
| Exhibitor Status | Click "Check My Status" | Exhibitors (type stand number) |

---

## Connect to Supabase (when ready to go live)

### Step 1 — Create account
Go to https://supabase.com → Sign up (free) → New Project → name it `apexops`

### Step 2 — Create database tables and run migrations
In your Supabase project, open **SQL Editor** and run the current `supabase/schema.sql` first. Then run the feature migrations that have not already been applied:

- `supabase/exhibitor-logo-migration.sql`
- `supabase/exhibitor-scanner-migration.sql`
- `supabase/supplier-logo-migration.sql`
- `supabase/staff-photos-bucket.sql`
- `supabase/client-ops-notifications-migration.sql`

Run `supabase/people-migration.sql` and `supabase/staff-supplier-fields.sql` if your existing staff/supplier tables do not already contain those fields. The workbook import scripts are optional data imports, not required application migrations.

The client/Ops migration enables anonymous clients to submit unassigned queries and escalate their own stand's open query. It also stores Ops notifications for client queries, rebooking requests, and client escalations. Apply it in the Supabase SQL Editor after `supabase/schema.sql` before using those flows in the live app.

### Step 2A — Enable multiple clients and events

Run `supabase/multi-client-events-migration.sql` after the existing schema and feature migrations, and before any event-scoped seed/import scripts. It creates client organizations, events, user memberships, event-scoped RLS, public event RPCs, and storage folders. It backfills existing rows to **Executive Conference Events / ESG Africa 2026** (`esg-africa-2026`): build-up 2026-09-29, event 2026-09-30 to 2026-10-01, breakdown 2026-10-01. The generated exhibitor code is `ESGAF-20260930`. Review these dates before applying the migration to live data. Do not run this migration against production until you have a backup. If the migration stops on an unrecognized RLS policy, review that policy before adding its exact name to the migration's legacy-policy cleanup list; do not ignore an unrecognized permissive policy.

The migration automatically grants platform-admin access to `didi@executiveconferenceevents.com` if that user already exists in Supabase Auth. If the account is created later, run this once in the Supabase SQL Editor:

```sql
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = lower('didi@executiveconferenceevents.com')
on conflict (user_id) do nothing;
```

If this account does not exist in Supabase Auth yet, create/invite it first, then rerun the bootstrap SQL. Sign in as Didi and open **Clients & Events** to create an organization only after payment is confirmed. Client admins do not see the platform-wide organization list; they can create events inside their own organization. Each event requires event, build-up, and breakdown date ranges. Its exhibitor code is generated as the first five letters of the event name plus its start date (`ESGAF-20260930`); share it separately with exhibitors. Event links use `?event=<slug>`, for example `https://your-app.example/?event=esg-africa-2026`; the welcome page asks exhibitors for the code before opening event services. The demo code is `ESGAF-20260930`.

Deploy the invitation function from this project with the Supabase CLI:

```bash
supabase functions deploy invite-event-member
supabase secrets set APP_URL=https://your-app.example
```

Supabase supplies the function’s URL, anon key, and service-role key as Edge Function environment variables. Never put the service-role key in the React `.env` file or browser code. The app continues to use only the publishable/anon key; membership checks and invitations run server-side.

The optional seed/import SQL files target `esg-africa-2026` by default. Change the event slug before running them for another event. The event-scoped reset script also targets only that slug; review it before execution.

To clear one event's activity after you have reviewed the demo, update the slug and run `supabase/reset-live-event-data.sql` manually in the SQL Editor for the production project. It deletes that event's rows from `queries`, `rebooking_requests`, and `ops_notifications`; staff, suppliers, exhibitors, and other events are preserved. This is destructive and cannot be undone.

### Step 3 — Get your keys
Settings → API → copy:
- Project URL (looks like https://xxxx.supabase.co)
- anon public key (long string starting with "eyJ…")

### Step 4 — Add keys to the app
Create a file called `.env` in this folder:
```
REACT_APP_SUPABASE_URL=https://xxxx.supabase.co
REACT_APP_SUPABASE_PUBLISHABLE_KEY=eyJ...your-publishable-key...
```

Restart the development server after creating or changing `.env`. The Supabase client is already enabled when both variables are present; otherwise the app uses its local fallback mode.

### Step 6 — Deploy to the web (free)
```bash
npm install -g vercel
vercel
```
Follow the prompts — your app gets a live URL in 2 minutes.

---

## IP Protection

- Exhibitors only see the status screen — no data, no structure, no forms
- Staff see only their own queue
- All data lives in your Supabase database — not in the app code
- Clients never receive the codebase
- You control access by adding/removing users in Supabase

---

## APEXOPS™ © 2026 Executive Conference Events (Pty) Ltd
Proprietary software. Unauthorised use prohibited.
