create table if not exists public.rebooking_requests (
  id text primary key,
  company text not null,
  contact_person text not null,
  contact_title text not null default '',
  email text not null,
  mobile text not null,
  current_stand text not null,
  interest text not null,
  preferred_stand text not null default '',
  stand_size text not null default '6 sqm',
  booth_type text not null default 'Shell scheme',
  sponsorship_interest text not null default 'No',
  discussion_topics jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table public.rebooking_requests add column if not exists contact_title text not null default '';
alter table public.rebooking_requests add column if not exists preferred_stand text not null default '';
alter table public.rebooking_requests add column if not exists stand_size text not null default '6 sqm';
alter table public.rebooking_requests add column if not exists booth_type text not null default 'Shell scheme';
alter table public.rebooking_requests add column if not exists sponsorship_interest text not null default 'No';
alter table public.rebooking_requests add column if not exists discussion_topics jsonb not null default '[]'::jsonb;
alter table public.rebooking_requests add column if not exists notes text not null default '';

alter table public.rebooking_requests enable row level security;
drop policy if exists "public can submit rebooking requests" on public.rebooking_requests;
drop policy if exists "team can read rebooking requests" on public.rebooking_requests;
drop policy if exists "team can update rebooking requests" on public.rebooking_requests;
create policy "public can submit rebooking requests"
on public.rebooking_requests for insert to anon, authenticated with check (true);
create policy "team can read rebooking requests"
on public.rebooking_requests for select to authenticated using (true);
create policy "team can update rebooking requests"
on public.rebooking_requests for update to authenticated using (true) with check (true);
grant insert on public.rebooking_requests to anon, authenticated;
grant select, update on public.rebooking_requests to authenticated;

create table if not exists public.ops_notifications (
  id bigint generated always as identity primary key,
  kind text not null,
  title text not null,
  message text not null,
  query_id text,
  rebooking_id text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.ops_notifications enable row level security;
drop policy if exists "team can read ops notifications" on public.ops_notifications;
drop policy if exists "team can update ops notifications" on public.ops_notifications;
create policy "team can read ops notifications"
on public.ops_notifications for select to authenticated using (true);
create policy "team can update ops notifications"
on public.ops_notifications for update to authenticated using (true) with check (read_at is not null);
grant select, update on public.ops_notifications to authenticated;

drop policy if exists "public can submit client queries" on public.queries;
create policy "public can submit client queries"
on public.queries for insert to anon, authenticated
with check (
  source_tab = 'CLIENT'
  and status = 'LOGGED'
  and assigned_to is null
  and length(trim(stand)) between 1 and 30
  and length(trim(exhibitor)) between 1 and 200
  and length(trim(category)) between 1 and 100
  and length(trim(description)) between 1 and 3000
);
grant insert on public.queries to anon, authenticated;

create or replace function public.prevent_duplicate_client_query()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  duplicate_key text;
begin
  duplicate_key := upper(trim(new.stand)) || ':' || lower(regexp_replace(trim(new.exhibitor), '\s+', ' ', 'g')) || ':' ||
    case when lower(trim(new.category)) = 'other' then 'organiser' else lower(trim(new.category)) end || ':' ||
    lower(regexp_replace(trim(new.description), '\s+', ' ', 'g'));
  perform pg_advisory_xact_lock(hashtextextended(duplicate_key, 0));

  if exists (
    select 1
    from public.queries q
    where upper(trim(q.stand)) = upper(trim(new.stand))
      and lower(regexp_replace(trim(q.exhibitor), '\s+', ' ', 'g')) = lower(regexp_replace(trim(new.exhibitor), '\s+', ' ', 'g'))
      and (case when lower(trim(q.category)) = 'other' then 'organiser' else lower(trim(q.category)) end)
        = (case when lower(trim(new.category)) = 'other' then 'organiser' else lower(trim(new.category)) end)
      and lower(regexp_replace(trim(q.description), '\s+', ' ', 'g')) = lower(regexp_replace(trim(new.description), '\s+', ' ', 'g'))
  ) then
    raise exception 'This issue has already been submitted for this exhibitor and stand.' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_client_query on public.queries;
create trigger prevent_duplicate_client_query
before insert on public.queries
for each row execute function public.prevent_duplicate_client_query();

create or replace function public.notify_ops_of_client_query()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_tab = 'CLIENT' then
    insert into public.ops_notifications (kind, title, message, query_id)
    values ('CLIENT_QUERY', 'New client query', new.exhibitor || ' · Stand ' || new.stand || ' · ' || new.category, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists client_query_ops_notification on public.queries;
create trigger client_query_ops_notification
after insert on public.queries
for each row execute function public.notify_ops_of_client_query();

create or replace function public.notify_ops_of_client_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ESCALATED' and old.status is distinct from 'ESCALATED' then
    insert into public.ops_notifications (kind, title, message, query_id)
    values ('CLIENT_ESCALATION', 'Client escalated a query', new.exhibitor || ' · Stand ' || new.stand || ' · ' || new.category, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists client_escalation_ops_notification on public.queries;
create trigger client_escalation_ops_notification
after update of status on public.queries
for each row execute function public.notify_ops_of_client_escalation();

create or replace function public.escalate_public_query(requested_query_id text, requested_stand text, escalation_message text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_id text;
begin
  update public.queries
  set status = 'ESCALATED',
      notes = concat_ws(E'\n', nullif(notes, ''), nullif('Client escalation: ' || trim(coalesce(escalation_message, '')), 'Client escalation: '))
  where id = requested_query_id
    and upper(trim(stand)) = upper(trim(requested_stand))
    and status <> 'COMPLETED'
  returning id into updated_id;

  if updated_id is null then
    raise exception 'This query could not be escalated. Check the stand and query status.';
  end if;
  return updated_id;
end;
$$;

revoke all on function public.escalate_public_query(text, text, text) from public;
grant execute on function public.escalate_public_query(text, text, text) to anon, authenticated;

create or replace function public.notify_ops_of_rebooking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ops_notifications (kind, title, message, rebooking_id)
  values ('REBOOKING', 'New stand rebooking request', new.company || ' · Current stand ' || new.current_stand || ' · ' || new.interest, new.id);
  return new;
end;
$$;

drop trigger if exists rebooking_ops_notification on public.rebooking_requests;
create trigger rebooking_ops_notification
after insert on public.rebooking_requests
for each row execute function public.notify_ops_of_rebooking();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ops_notifications'
  ) then
    alter publication supabase_realtime add table public.ops_notifications;
  end if;
end;
$$;

notify pgrst, 'reload schema';
