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

For a local HTTPS demo, run `npm run start:demo:secure` and open **https://localhost:3003**. Your browser may show a certificate warning because the development certificate is self-signed; this is for local testing, not public deployment.

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
- `supabase/media-buckets.sql`
- `supabase/staff-photos-bucket.sql`
- `supabase/client-ops-notifications-migration.sql`

Run `supabase/people-migration.sql` and `supabase/staff-supplier-fields.sql` if your existing staff/supplier tables do not already contain those fields. The workbook import scripts are optional data imports, not required application migrations.

The client/Ops migration enables anonymous clients to submit unassigned queries and escalate their own stand's open query. It also stores Ops notifications for client queries, rebooking requests, and client escalations. Apply it in the Supabase SQL Editor after `supabase/schema.sql` before using those flows in the live app.

### Step 2A — Enable multiple clients and events

Run `supabase/multi-client-events-migration.sql` after the existing schema and feature migrations, and before any event-scoped seed/import scripts. It creates client organizations, events, user memberships, event-scoped RLS, public event RPCs, and storage folders. It backfills existing rows to **Executive Conference Events / ESG Africa 2026** (`esg-africa-2026`): build-up 2026-09-29, event 2026-09-30 to 2026-10-01, breakdown 2026-10-01. The generated exhibitor code is `ESGAF-20260930`. Review these dates before applying the migration to live data. Do not run this migration against production until you have a backup. If the migration stops on an unrecognized RLS policy, review that policy before adding its exact name to the migration's legacy-policy cleanup list; do not ignore an unrecognized permissive policy.

After the multi-client migration, run `supabase/event-logo-migration.sql` on existing projects to add event logo URLs to the public event RPCs. `supabase/media-buckets.sql` creates the public event-logo bucket used by organiser logo uploads.

The migration automatically grants platform-admin access to `didi@executiveconferenceevents.com` if that user already exists in Supabase Auth. If the account is created later, run this once in the Supabase SQL Editor:

```sql
insert into public.platform_admins (user_id)
select id from auth.users where lower(email) = lower('didi@executiveconferenceevents.com')
on conflict (user_id) do nothing;
```

If this account does not exist in Supabase Auth yet, create/invite it first, then rerun the bootstrap SQL. Platform Admin manages client accounts and access; client admins manage events inside their own organization. Each event requires event, build-up, and breakdown date ranges. The event-code hardening migration generates random exhibitor codes and rotates older codes, which must be shared separately with exhibitors. Event links use `?event=<slug>`, for example `https://your-app.example/?event=esg-africa-2026`; the welcome page asks exhibitors for the code before opening event services. The isolated demo code is `ESGAF-20260930`.

Deploy the invitation function from this project with the Supabase CLI:

```bash
supabase functions deploy invite-event-member
supabase secrets set APP_URL=https://your-app.example
```

Supabase supplies the function’s URL, anon key, and service-role key as Edge Function environment variables. Never put the service-role key in the React `.env` file or browser code. The app continues to use only the publishable/anon key; membership checks and invitations run server-side.

The optional seed/import SQL files target `esg-africa-2026` by default. Change the event slug before running them for another event. The event-scoped reset script also targets only that slug; review it before execution.

### Security and lifecycle rollout

The newer access, billing and event-expiry changes must be tested in a separate Supabase project before production. Run `npm test -- --watchAll=false --runInBand` and `npm run test:security` locally. The database tests use isolated PostgreSQL fixtures; they do not prove production RLS, proxy headers or Edge Function behavior.

After the existing base and event-code security migrations, the staged order is `client-event-limits-migration.sql`, `client-billing-access-migration.sql`, `staff-queue-security-migration.sql`, `event-code-rate-limit-migration.sql`, `client-trials-event-exemptions-migration.sql`, then `event-expiration-migration.sql`. After those, apply `event-code-rotation-migration.sql` and `platform-pricing-migration.sql`. Apply the updated query-photo privacy policies only after the expiry helper exists. Deploy the `create-client` and `invite-event-member` functions together with the database and app changes. Check `check-migrations.sql`, then test separate platform-admin, client-admin, Operations, staff and public accounts against active, expired and archived events.

Before rollout, verify the trusted client-IP headers and all code-bearing public endpoints, including storage, through the real proxy; the lockout deliberately fails closed when an IP is unavailable. The expiry migration immediately changes access for events already outside their active or archive periods. Existing event limits are initialized to at least each client's current event count, but an admin must increase a limit before that client can create further billable events. Platform Admins may mark ECE internal events non-billable; those events do not consume the client's event quota. Platform Admins may also start one 30-day client demo trial; access expires automatically at the stored trial end date. Trial expiry does not delete data. Billing is manual: approved overage credits do not generate or collect an invoice. Separate organiser and external-seat accounting and automated payment reconciliation are not implemented.

#### Data retention decision

Keep the existing client read-only access window through 12 months after an event ends; access then expires. Do not blanket-delete all event records at that point. Once legal and accounting retention periods are confirmed, delete event photos and other personal or operational data after 12 months unless a documented legal hold or approved extension applies. Retain only the minimum financial and audit records for their separately confirmed required period, and provide clients an export opportunity before deletion.

This is a policy decision, not an automated control: the current 12-month rule limits access only, and no data is automatically purged. Do not enable a purge job until data categories, export flow, legal-hold controls, required retention periods, and recovery/audit controls are approved.

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
