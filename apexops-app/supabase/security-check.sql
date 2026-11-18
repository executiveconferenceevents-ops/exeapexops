-- ─── APEXOPS security check (READ-ONLY: this changes nothing) ─────────────────
-- Paste into Supabase → SQL Editor → Run. Send the results back to Claude.

-- 1. Tables that do NOT have Row Level Security switched on (should be empty)
select schemaname, tablename
from pg_tables
where schemaname = 'public' and rowsecurity = false
order by tablename;

-- 2. Every security policy, flagging any that let everyone in
select
  tablename,
  policyname,
  cmd                                   as applies_to,
  roles,
  qual                                  as who_can_read_rows,
  with_check                            as who_can_write_rows,
  case
    when coalesce(qual, '') in ('true', '') and coalesce(with_check, 'true') = 'true'
      then '⚠️ OPEN TO EVERYONE'
    else 'ok - restricted'
  end                                   as verdict
from pg_policies
where schemaname = 'public'
order by verdict desc, tablename, policyname;

-- 3. Storage buckets: which are public (photos should be private)
select id as bucket, public from storage.buckets order by id;
