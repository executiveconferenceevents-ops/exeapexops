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

### Step 2 — Create database tables
In your Supabase project: SQL Editor → paste the SQL from `src/lib/supabase.js` (the block between the /* */ comments) → Run

### Step 3 — Get your keys
Settings → API → copy:
- Project URL (looks like https://xxxx.supabase.co)
- anon public key (long string starting with "eyJ…")

### Step 4 — Add keys to the app
Create a file called `.env` in this folder:
```
REACT_APP_SUPABASE_URL=https://xxxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJ...your-key...
```

### Step 5 — Uncomment Supabase in the code
Open `src/lib/supabase.js` and uncomment the 5 lines at the top.

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
