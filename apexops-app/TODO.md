# APEX Ops Development Workstreams

## Data, Billing, and Access

- [x] Stage 1 local billing foundation: migration, preservation/security tests, timestamp triggers, pricing versioning, and agreement-history limitation documentation.
- [x] Stage 1B staging preflight: verify APEXOps Staging and export the read-only existing-client/access baseline.
- [x] Stage 1C staging migration: applied to APEXOps Staging; exact client, membership, pricing, event, policy, and grant comparisons passed.
- [ ] Stage 1C app-level access verification: staging has zero Platform Admin assignments and zero client memberships; verify when approved staging test identities exist. Free plan has no managed backups; baseline archived separately.
- [x] Stage 2 local invoice core: headers, line items, sequence numbering, tax/discount totals, editable drafts, immutable issued values, credit notes, audit history, and passing focused database/UI tests.
- [x] Stage 2 staging migration: applied to APEXOps Staging after preflight; five invoice tables have RLS, four admin policies and RPCs are present, ten triggers are enabled, and existing record counts match the baseline.
- [x] Stage 2 local PDF artifact: issued invoices download as generated PDFs; actual PDF output and owner-console download wiring are tested.
- [ ] Stage 2 email delivery: Resend Edge Function and issued-PDF email action are implemented locally; configure RESEND_API_KEY and verified RESEND_FROM, deploy the function, and verify a real staging delivery.
- [ ] Stage 3 payments: payment ledger, client-scoped EFT proof submission/review, secure proof storage, PayFast checkout/ITN endpoints, and owner workflows are implemented; Stage 3 migration is applied and verified on staging, with baseline counts unchanged. Local database, signature, amount, IP, and app tests pass. Deno typecheck, sandbox credentials/transaction, and end-to-end reconciliation remain.
- [ ] Stage 4 registration and access: public request intake, idempotency/rate limiting, admin review, billing-gated explicit activation, invitations, and database-enforced pending/suspended restrictions are implemented; migration is applied and verified on staging. App-level identity verification is pending because staging has no Platform Admin or client memberships.
- [ ] Stage 5 client billing portal: invoice list/PDF download, EFT proof submission/history, and online checkout action are implemented locally; staging RLS is present, but client-admin session testing and Edge Function deployment remain.
- [ ] Stage 6 Platform Owner administration, billing management, reports, audit views, and notifications.
- [ ] Stage 7 end-to-end security/regression testing and production release approval.

## Platform Admin Experience

- [x] Build the initial owner-console visual shell with grouped navigation, a data-backed overview, client details, user access, subscriptions, and event usage.
- [x] Use the supplied screenshots as the reference while retaining the existing navy/gold brand.
- [x] Add navigation for Overview; Clients & Organisations; Events; Users & Access; Subscriptions & Agreements; Invoices; Payments & EFT Verification; Pricing Plans; Revenue & Reports; Activity & Audit Logs; Security & Permissions; System Settings.
- [x] Prepare dashboard, table, filter, status, and client-detail layouts.
- [ ] Preserve the current React 18, Create React App, JavaScript, and Supabase architecture and existing permissions.
- [ ] Show only real data; do not use fabricated financial or operational metrics.
- [ ] Connect invoice, payment, activity, and global-settings screens when their backing workflows and permissions are implemented and verified.
