# APEX Ops Development Workstreams

## Data, Billing, and Access

- [x] Stage 1 local billing foundation: migration, preservation/security tests, timestamp triggers, pricing versioning, and agreement-history limitation documentation.
- [x] Stage 1B staging preflight: verify APEXOps Staging and export the read-only existing-client/access baseline.
- [x] Stage 1C staging migration: applied to APEXOps Staging; exact client, membership, pricing, event, policy, and grant comparisons passed.
- [ ] Stage 1C app-level access verification: staging Platform Owner assigned, and a separate confirmed test client account has one organisation-wide client-admin membership and no Platform Owner role; client session testing remains. Free plan has no managed backups; baseline archived separately.
- [x] Stage 2 local invoice core: headers, line items, sequence numbering, tax/discount totals, editable drafts, immutable issued values, credit notes, audit history, and passing focused database/UI tests.
- [x] Stage 2 staging migration: applied to APEXOps Staging after preflight; five invoice tables have RLS, four admin policies and RPCs are present, ten triggers are enabled, and existing record counts match the baseline.
- [x] Stage 2 local PDF artifact: issued invoices download as generated PDFs; actual PDF output and owner-console download wiring are tested.
- [ ] Stage 2 email delivery: Resend Edge Function and issued-PDF email action are implemented locally; configure RESEND_API_KEY and verified RESEND_FROM, deploy the function, and verify a real staging delivery.
- [ ] Stage 3 payments: payment ledger, client-scoped EFT proof submission/review, secure proof storage, PayFast checkout/ITN endpoints, and owner workflows are implemented; Stage 3 migration is applied and verified on staging, with baseline counts unchanged. The PayFast Sandbox transaction and existing ITN were validated and settled invoice ECE-2026-000001; the client portal shows paid with one settled R10 payment. The sandbox passphrase has been rotated and synced to staging; `payfast-itn` is deployed with JWT verification off. Remaining: request a Merchant Key rotation from PayFast support (no rotation control is available in the sandbox account UI), run Deno typecheck in an environment with Deno, and complete broader release regression before production.
- [ ] Stage 4 registration and access: public request intake, idempotency/rate limiting, admin review, billing-gated explicit activation, invitations, and database-enforced pending/suspended restrictions are implemented; migration is applied and verified on staging. A separate staging test client membership is configured; app-level identity verification remains pending.
- [ ] Stage 5 client billing portal: invoice list/PDF download, EFT proof submission/history, and online checkout action are implemented locally; staging RLS and Edge Function deployment are verified, and the client-admin staging view shows the settled test invoice. Broader EFT and client-session testing remain.
- [ ] Stage 6 Platform Owner administration: client, event, user, registration, subscription, invoice, payment/EFT, pricing, event-usage, ledger-backed collection summary, and platform/client audit views are implemented. Event and membership changes now write metadata-only audit records in staging; triggers, Owner-only read policy, and rollback smoke test are verified. Remaining: define and build global platform settings, verify notification coverage, decide whether to add signed historical agreement records, and complete Owner-role regression testing.
- [ ] Stage 7 end-to-end security/regression testing and production release approval. Current checks: app suite 23 tests across 8 suites; security suite 18 tests; both pass. Local tests cover organizer notification read-state and exhibitor stand lookup, query submission, and escalation. Staging PayFast settlement and operational audit triggers are verified. Remaining: Deno typecheck in a Deno-enabled environment, real organizer/staff/exhibitor acceptance, email delivery, credential support follow-up, and final production review/approval.

## Platform Admin Experience

- [x] Build the initial owner-console visual shell with grouped navigation, a data-backed overview, client details, user access, subscriptions, and event usage.
- [x] Use the supplied screenshots as the reference while retaining the existing navy/gold brand.
- [x] Add navigation for Overview; Clients & Organisations; Events; Users & Access; Subscriptions & Agreements; Invoices; Payments & EFT Verification; Pricing Plans; Revenue & Reports; Activity & Audit Logs; Security & Permissions; System Settings.
- [x] Prepare dashboard, table, filter, status, and client-detail layouts.
- [ ] Preserve the current React 18, Create React App, JavaScript, and Supabase architecture and existing permissions.
- [ ] Show only real data; do not use fabricated financial or operational metrics.
- [ ] Connect invoice, payment, activity, and global-settings screens when their backing workflows and permissions are implemented and verified.
