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

To clear live event activity after you have reviewed the demo, run `supabase/reset-live-event-data.sql` manually in the SQL Editor for the production project. It deletes all rows from `queries`, `rebooking_requests`, and `ops_notifications`; staff, suppliers, and exhibitors are preserved. This is destructive and cannot be undone.

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
