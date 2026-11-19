# APEXOps: system record and build checklist

*Executive Conference Events · Status as at 18 November 2026*

This document records what APEXOps does, how each part works, and where each feature stands in the code. Keep it in the repository as `docs/APEXOPS-SYSTEM-RECORD.md`. Copilot uses the checklist at the end to compare the code against it.

**Status key**
- ✅ **Built**: in the code on branch `release-demo`, tested in demo mode
- 🟡 **Built, not released**: written and tested, but on a separate branch (`exhibitor-payments-wip`) and not yet in `release-demo`
- ⬜ **Planned**: agreed but not built yet

---

## 1. What APEXOps is

APEXOps is an event build-up and operations platform. It gives organisers, operations teams, suppliers, staff and exhibitors one live system, from the first stand booking to the last truck out.

- **Built for:** event organisers, venues, stand builders and service providers.
- **Hosted at:** apexops.executiveconferenceevents.com
- **Technology:**
  - React (Create React App)
  - Supabase: database, sign-in, storage, Edge Functions
  - Vercel hosting
- **Many clients, many events:** each client sees only its own events and data. One client can run up to 40 events a year.

---

## 2. Who uses it (roles)

| Role | How they get in | What they see |
|---|---|---|
| **Platform owner (ECE)** | Platform Admin portal | Everything, plus Platform admin |
| **Client / organiser admin** (`client_admin`, `event_admin`) | Client / Organiser portal, invited by ECE or their own admin | Their events, team, suppliers, exhibitors, orders, packages, deliveries, Events & team workspace |
| **Operations team** (`ops`) | Event Operations portal | Event operations board, queues, exhibitors, orders, deliveries |
| **Staff / suppliers** (`staff`) | Staff & Delivery portal | My queue and Deliveries only |
| **Delivery team** (`delivery`) | Staff & Delivery portal | Deliveries only |
| **Exhibitor** | Event code (no account), or their private stand link | Report a problem, track issues, order furniture, rebook, their own stand page |

The public home page offers separate portal choices and each team portal opens its own sign-in screen. Authentication is shared; account permissions still control access after sign-in.

---

## 3. Features and how they work

### 3.1 Look and feel ✅
- **Brand:**
  - Wordmark "APEXOPS™" in Cormorant Garamond Bold, with "by Executive Conference Events" in gold.
  - Titles in Playfair Display, with the last words in gold italic; italic Playfair subtitles.
  - Inter for buttons, forms and tables.
  - Colours: navy, blue (#2E6FA3) and gold (#B49A6A).
- **Layout:**
  - One app frame on every page: left menu, event chip and signed-in user.
  - On phones it changes to a navy header.
  - Rounded, soft cards. Thin gold line icons. No emoji.
- **Colour rules:**
  - Navy for primary actions, blue for links.
  - Green only for Done and WhatsApp.
  - No red or orange card outlines.
  - Soft department colours on icons and summary tiles.
- **Home page:** greeting, today's numbers (Open, Overdue, Done today, Escalated) and a "Needs your attention" list. It refreshes every 30 seconds.
- **Files:** `styles/apex-brand.css`, `components/AppShell.jsx`, `components/shell.css`, `components/HomeOverview.jsx`

### 3.2 Platform admin (ECE only) ✅
- Client registrations: approve or reject.
- Create clients and invite their admin.
- Subscriptions and agreements: trial, pay per event, annual volume plans, committed events, prepaid event credits, term dates.
- Invoices to clients (`send-client-invoice`). Payments and EFT verification, with proof-of-payment upload.
- Users and access; system settings.
- **Pricing editor:** event size bands and annual discounts (section 5).

### 3.3 New client sign-up ✅
- A public registration form (`register-client` Edge Function) checks input and applies an IP-based limit.
- ECE approves the registration, and the client admin is then invited.

### 3.4 Client / organiser workspace ✅
- **Tabs:** Overview, Users, Subscription, Events, Invoices, Activity.
- **Events:** create and edit events, within the event limit of their subscription.
- **Team:** invite members by role (`invite-event-member`).
- Pay ECE invoices by PayFast or EFT with proof of payment.

### 3.5 Suppliers and staff ✅
- Suppliers, staff and departments per event, reusable on the next event.
- Staff log in and see only their own jobs.

### 3.6 Exhibitor issue reporting ✅
- **Getting in:** the exhibitor opens the event page and enters the **event code** once. The device remembers them, with an online re-check of the pass.
- **Privacy notice:** shown before first use.
- **Report a problem:** two taps. Pick the stand, choose the problem type and add a photo.
- **Track:** a visual tracker shows the issue moving through New → On it → Done.
- **Rebook Your Stand:** exhibitors can ask to rebook for the next event.
- **Security:** event codes are random. More than 10 failed tries in 15 minutes locks that device out.

### 3.7 Staff queue ✅
- **Buttons:** big New → On it → Done buttons, with Undo.
- **Icons:** the same department icons and colours everywhere.
- **Photos:** before and after photos, stored privately and shown through short-lived signed links.
- **Contact:** one-tap call, or a WhatsApp click-to-chat link.

### 3.8 Event operations board (control room) ✅
- Every job by area and department, with an area strip.
- Assign, start, finish and escalate jobs. Overdue jobs show a navy "OVERDUE · 37m" label and are sorted to the top.

### 3.9 Exhibitor import ✅
- Excel or CSV import with a downloadable template.
- **Template columns:** Company, Stand, Contact, Email, Work No., Cell No., Package code, Fascia name.

### 3.10 Exhibitor services: Orders & packages ✅
This is the organiser screen, with five tabs.

- **Orders:**
  - Every furniture order with its status (New, Confirmed, Picking, Loaded, Delivered, Cancelled).
  - **Two downloads:**
    - **Orders with values** (for finance)
    - **Pick list (no prices)** (for the warehouse)
  - **Order for an exhibitor:** for phone orders.
- **Stock list:**
  - Import the event's stock list from a template (Excel or CSV), with photos and editable prices.
  - Grey columns, visible only to the organiser, show VAT and the 3% platform fee.
  - The exhibitor price is calculated as: round(price excl. VAT × (1 + VAT if the supplier is VAT registered) × 1.03).
- **Packages** (per event):
  - **Standard shell schemes:** one click adds 6, 9, 12, 18, 24 and 32m².
  - **Read-only cards:** packages can't be changed by accident.
  - **Edit:** tick boxes for standard features (fascia name board, logo printed on fascia, carpet, spotlights, plug point, fabric banner wall, vinyl graphics, storage cupboard, branded counter front, daily cleaning), plus your own options. Add or remove item lines and change quantities with − and +.
  - **Duplicate:** for variations of a package.
  - **Infrastructure print:** totals of items to pack and features to prepare across all stands, with Print, Excel and a per-stand sheet.
- **Fascia & links:**
  - Assign a package to each stand.
  - Approve fascia names.
  - Tick **Paid extra** where a logo was bought separately.
  - Copy or email each exhibitor's **private link**.
  - Download the fascia list for printing.
- **Settings:**
  - Access window dates.
  - VAT on/off and VAT rate.
  - Platform fee %.
  - Supplier name.
  - The order terms and logo note that exhibitors see.

### 3.11 Exhibitor furniture ordering ✅
- **Steps:**
  1. After the event code, choose **Order Furniture**.
  2. Search by company name or stand number.
  3. Choose items from a photo catalogue, with options and quantities.
  4. Set the delivery date and time, and contact details.
  5. Tick "no cancellation or refund".
  6. Get a printable order form.
- **Server checks:**
  - The server re-prices every order.
  - Up to 60 lines per order, and up to 20 orders per stand per day.

### 3.12 Exhibitor private link ✅
- The link (`?portal=<token>`) is unguessable and belongs to one stand only.
- **What the exhibitor can do:**
  - Confirm the fascia name (max 40 characters, approved by the organiser).
  - Upload a high-res logo and documents (private storage, up to 50 MB).
  - See their package and features, and their orders.
- **Logo note:** shown on the page. A logo is printed only if it's in the package or was paid for.

### 3.13 Deliveries ✅
- **No prices anywhere** on this screen.
- Orders are grouped by delivery day and stand, with warehouse pull totals.
- **Ticks:** Picked, Loaded and Delivered for each line. Ticking Loaded also ticks Picked.
- Excel and Print. It refreshes every 30 seconds.

### 3.14 Event access window ✅
- Each event **opens 3 months before** its start date and **closes 1 month after** its end date. It's then **archived** and read-only.
- Organisers can change the dates in Settings.
- The database functions (`apex_event_window_open`) enforce the window.

### 3.15 Exhibitor invoices and payments 🟡
This is on branch `exhibitor-payments-wip`, not yet in `release-demo`.

- **Invoices:** one invoice per order, with EFT bank details and proof-of-payment upload.
- **Client's own payment portals:**
  - PayFast and Yoco details, entered in the client's settings.
  - These details are encrypted, and only Edge Functions can read them.
  - Money goes straight into the client's own account.
- **Edge Functions:** `create-exhibitor-payfast-checkout`, `payfast-exhibitor-itn`, `create-exhibitor-yoco-checkout`, `yoco-exhibitor-webhook`.
- **The 3% fee:**
  - It stays inside the exhibitor's price.
  - It's counted only once the invoice is fully paid (`service_orders.total_fee`), and added to the client's monthly ECE invoice.
- **Migration:** `supabase/migrations/20261118_exhibitor_invoices_payments.sql` (not run).
- **Secret needed at go-live:** `EXHIBITOR_PAYMENT_ENCRYPTION_KEY`, set together with Claude.

### 3.16 Demo mode ✅
- Built with `REACT_APP_DEMO_MODE=true`. It uses sample data stored in the browser tab, and nothing touches the database.
- **Portal choices:** Platform Admin, Client / Organiser, Event Operations, Staff & Delivery, and Exhibitor each open their corresponding sign-in or event-code flow.
- **Demo sign-in:** accepts an email without authenticating it and routes to the workspace for the selected portal. This demonstrates navigation, not account-specific permissions.

---

## 4. Security (current)
- **Row Level Security** is on for all 28 tables, so each client sees only its own data.
- **Old scripts:** setup scripts that could reopen access are in `supabase/archive-do-not-run/`, and the order to run scripts in is in `supabase/RUN-ORDER.md`.
- **Query photos:** stored privately and shown through short-lived signed links. The fix in `20261118_fix_query_photo_access.sql` is prepared but not run.
- **Storage review:** `staff-photos` is currently a public bucket and should be made private before it is used for nonpublic staff photos. The logo buckets are public; `query-photos` and `query-photos-private` are private.
- **Spam limits on public submissions:** 20 per stand and 200 per event per hour. Prepared, not run.
- **PayFast confirmations** with a wrong signature are now refused.
- **Secrets** (`.env`, `.env.local`) are kept out of Git. No source maps in production builds.

---

## 5. Pricing (as built into Platform admin)

| Event size | Stands | Price per event | Per month over 4 months of access |
|---|---|---|---|
| Small | 1–50 | R15,000 | R3,750 |
| Medium | 51–100 | R25,000 | R6,250 |
| Large | 101–200 | R45,000 | R11,250 |
| Extra Large | 201–400 | R70,000 | R17,500 |
| Major | 401–600 | R100,000 | R25,000 |
| Enterprise | 601+ | Custom quote | — |

- **Annual volume discounts:** 12–19 events 5% · 20–29 8% · 30–49 12% · 50–74 15% · 75–100 18%
- **Users:**
  - Each event includes **20 users** (your team, suppliers and contractors).
  - Extra users are **R150 each per event**.
  - **Exhibitors are free.**
- **Trial:** a 30-day demo trial.
- **Exhibitor orders:** a 3% fee is built into exhibitor prices and charged only on paid orders.
- **Fix to make:** the app's pricing note still says "External participant access is free". Change it to "Exhibitor access is free".

---

## 6. Not built yet (planned) ⬜
1. **Automatic emails:**
   - Order confirmation and invoice to the exhibitor.
   - "New order" notice to the organiser.
   - Job status updates.
2. **"Send me my private link":** after the exhibitor signs in with the event code, the link is emailed to the stand's imported address.
3. **Payment link or QR code on the day,** per order.
4. **Live orders dashboard:** new orders appear without reloading.
5. **Separate Platform admin site:** admin on its own address. The instructions are ready.
6. **WhatsApp Business connection** per client (later).
7. **Move from react-scripts to Vite** (later, for security updates).

---

## 7. Going live: remaining steps
1. Verify the separate portal flows in demo mode and push `release-demo` for the presentation.
2. Read-only `security-check.sql` completed on ECE APEXOps Production on 18 November 2026: no public-schema tables without RLS and no policies matched the check's open-access rule. Review the public `staff-photos` bucket before using it for nonpublic images.
3. Claude reviews `20261118_exhibitor_services.sql`, `20261118_fix_query_photo_access.sql` and `RUN-ORDER.md`.
4. Run the approved migrations in Supabase, in the order given.
5. Merge into `main` and deploy to production on Vercel. Make sure `GENERATE_SOURCEMAP=false` is set in Vercel.
6. Then the payments: merge `exhibitor-payments-wip`, review its migration, set the encryption secret, and test with PayFast sandbox and Yoco test keys.

---

## 8. Checklist for Copilot (read-only check)

Paste this into Copilot (Agent mode):

```
Read docs/APEXOPS-SYSTEM-RECORD.md. Do NOT change code, run anything against Supabase or deploy.
On branch release-demo, check every feature marked ✅ in sections 3 and 4, and section 3.15
on branch exhibitor-payments-wip. For each one, give me: feature, file(s) where it lives,
status (present / partly present / missing), and one line of evidence.
Confirm specifically:
- src/lib/exhibitorServices.js has STANDARD_FEATURES, createStandardPackages, eventAccessWindow, priceBreakdown
- src/views/ ExhibitorServices.jsx, Deliveries.jsx, ExhibitorShop.jsx, ExhibitorPortal.jsx exist
- App.jsx has the ?portal= route, canOpenDeliveries, and the menu items "Orders & packages" and "Deliveries"
- supabase/archive-do-not-run/ and supabase/RUN-ORDER.md exist; multi-client-events-migration.sql is NOT archived
- payfast-itn rejects invalid signatures with 400
- .gitignore covers .env, .env.local, _updates/, data/, *.zip
- the pricing note text (search "External participant access is free")
- section 6 items: confirm each is NOT built, or tell me if any is
Then run npm test -- --watchAll=false and CI=true npm run build and report the results.
Finish with a table: Built / Partly built / Missing, and anything in the code that this record does not mention.
```
