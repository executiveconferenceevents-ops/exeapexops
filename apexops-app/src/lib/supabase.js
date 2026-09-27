// ─── Supabase client ──────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';
import { DEMO_MODE } from './demoStore';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;

export const supabase = !DEMO_MODE && supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// ── SQL schema to paste into Supabase SQL editor ─────────────────────────────
/*
create table queries (
  id          text primary key,
  stand       text,
  exhibitor   text,
  contact     text,
  phone       text,
  category    text,
  description text,
  est         text,
  status      text default 'LOGGED',
  assigned_to text,
  logged_at   timestamptz default now(),
  updated_at  timestamptz default now(),
  completed_at timestamptz,
  notes       text
);

create table staff (
  id       uuid primary key default gen_random_uuid(),
  name     text,
  supplier_name text,
  email    text,
  category text,
  role     text default 'staff'   -- 'ops', 'gl', 'staff'
);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger trg_queries_updated
before update on queries
for each row execute function update_updated_at();

-- Row level security (enable per-client isolation later)
alter table queries enable row level security;
alter table staff   enable row level security;

-- For now allow all authenticated users (tighten per event later)
create policy "allow_all" on queries for all using (true);
create policy "allow_all" on staff   for all using (true);
*/

export {};
