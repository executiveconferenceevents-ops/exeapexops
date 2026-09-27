-- Add per-stand exhibitor pack collection tracking.
alter table public.exhibitors add column if not exists pack_collected boolean not null default false;
alter table public.exhibitors add column if not exists pack_collected_by text;
alter table public.exhibitors add column if not exists pack_collected_at timestamptz;