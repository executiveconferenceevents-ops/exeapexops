-- ════════════════════════════════════════════════════════════════════════════
-- APEXOPS · Exhibitor services: stock list, packages, furniture orders,
-- deliveries, fascia & logo portal, event access window
-- ────────────────────────────────────────────────────────────────────────────
-- PREPARED FOR REVIEW. Do not run until Claude / your developer has checked it
-- against your live schema. Back up first (Supabase → Database → Backups).
--
-- Assumes (from the app code): events(id uuid, client_id, slug, event_start_date,
-- event_end_date, …), client_event_memberships(user_id, client_id, event_id, role),
-- is_platform_admin(), get_public_event(requested_slug, requested_code).
-- Nothing existing is dropped or changed; everything here is new.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Permission helpers ──────────────────────────────────────────────────────
create or replace function public.apex_can_operate_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_platform_admin(), false) or exists (
    select 1 from public.client_event_memberships m
    join public.events e on e.id = p_event
    where m.user_id = auth.uid()
      and m.role in ('client_admin', 'event_admin', 'ops')
      and (m.event_id = p_event or (m.event_id is null and m.client_id = e.client_id))
  );
$$;

create or replace function public.apex_can_view_event(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.apex_can_operate_event(p_event) or exists (
    select 1 from public.client_event_memberships m
    join public.events e on e.id = p_event
    where m.user_id = auth.uid()
      and (m.event_id = p_event or (m.event_id is null and m.client_id = e.client_id))
  );
$$;

-- Event access window: opens 3 months before the event starts, closes 1 month
-- after it ends. Organisers can narrow it with orders_open_at / orders_close_at.
create or replace function public.apex_event_window_open(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select now() >= coalesce(s.orders_open_at, (e.event_start_date::timestamptz - interval '3 months'))
       and now() <= coalesce(s.orders_close_at, (e.event_end_date::timestamptz + interval '1 month' + interval '1 day'))
    from public.events e
    left join public.event_order_settings s on s.event_id = e.id
    where e.id = p_event
  ), false);
$$;

-- ── Settings per event ──────────────────────────────────────────────────────
create table if not exists public.event_order_settings (
  event_id uuid primary key references public.events(id) on delete cascade,
  prices_exclude_vat boolean not null default true,
  vat_rate numeric(5,4) not null default 0.15,
  platform_fee_rate numeric(5,4) not null default 0.03,      -- internal, never shown to exhibitors
  orders_open_at timestamptz,
  orders_close_at timestamptz,
  supplier_name text,
  order_terms text default 'Orders cannot be cancelled or refunded once confirmed.',
  logo_terms text default 'Logos are only printed on fascia boards when included in your package or paid for.',
  updated_at timestamptz not null default now()
);

-- ── Stock list (catalogue) per event ────────────────────────────────────────
create table if not exists public.catalogue_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  category text not null default 'Furniture',
  code text not null,
  name text not null,
  options text[] not null default '{}',
  size text,
  price_excl_vat numeric(12,2) not null default 0,
  stock_qty integer,
  photo_url text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, code)
);
create index if not exists catalogue_items_event_idx on public.catalogue_items (event_id, active, sort_order);

-- ── Packages per event (e.g. "Shell scheme 9m²") ────────────────────────────
create table if not exists public.event_packages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  size_sqm numeric(6,1),
  includes_fascia_logo boolean not null default false,   -- kept in step with the 'fascia_logo' feature by the app
  features jsonb not null default '[]',  -- ticked features: [{ "key": "fascia_logo", "label": "Logo printed on fascia" }, …]
  items jsonb not null default '[]',     -- [{ "label": "Chair", "qty": 2, "code": "H01" }]
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, code)
);

-- ── Exhibitor profile per event & stand (package, fascia, private link) ─────
create table if not exists public.exhibitor_profiles (
  event_id uuid not null references public.events(id) on delete cascade,
  stand text not null,
  package_code text,
  fascia_name text,
  fascia_status text not null default 'pending' check (fascia_status in ('pending', 'submitted', 'approved')),
  fascia_submitted_at timestamptz,
  logo_paid boolean not null default false,          -- organiser ticks if logo printing was bought separately
  portal_token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now(),
  primary key (event_id, stand)
);

create table if not exists public.exhibitor_files (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  stand text not null,
  kind text not null check (kind in ('logo', 'document')),
  file_name text not null,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);
create index if not exists exhibitor_files_stand_idx on public.exhibitor_files (event_id, stand);

-- ── Orders ──────────────────────────────────────────────────────────────────
create sequence if not exists public.order_ref_seq;

create table if not exists public.service_orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  ref text not null default ('FO-' || lpad(nextval('public.order_ref_seq')::text, 5, '0')),
  stand text not null,
  exhibitor_name text,
  contact_name text,
  contact_email text,
  contact_phone text,
  delivery_at timestamptz,
  notes text,
  status text not null default 'submitted'
    check (status in ('submitted', 'confirmed', 'picking', 'loaded', 'delivered', 'cancelled')),
  total_excl_vat numeric(12,2) not null default 0,
  total_vat numeric(12,2) not null default 0,
  total_fee numeric(12,2) not null default 0,          -- internal 3%
  total_payable numeric(12,2) not null default 0,      -- what the exhibitor pays
  edit_token uuid not null default gen_random_uuid() unique,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_orders_event_idx on public.service_orders (event_id, status, delivery_at);
create index if not exists service_orders_stand_idx on public.service_orders (event_id, stand);

create table if not exists public.service_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.service_orders(id) on delete cascade,
  catalogue_item_id uuid references public.catalogue_items(id) on delete set null,
  code text not null,
  name text not null,
  option text,
  qty integer not null check (qty > 0),
  unit_price_excl_vat numeric(12,2) not null,
  unit_payable numeric(12,2) not null,
  picked boolean not null default false,
  loaded boolean not null default false,
  delivered boolean not null default false
);
create index if not exists service_order_items_order_idx on public.service_order_items (order_id);

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.event_order_settings enable row level security;
alter table public.catalogue_items      enable row level security;
alter table public.event_packages       enable row level security;
alter table public.exhibitor_profiles   enable row level security;
alter table public.exhibitor_files      enable row level security;
alter table public.service_orders       enable row level security;
alter table public.service_order_items  enable row level security;

-- Team: everyone on the event can read; organisers/ops can change.
-- Supplier staff (delivery team) can read orders and tick picked / loaded / delivered.
create policy "team reads settings"   on public.event_order_settings for select using (public.apex_can_view_event(event_id));
create policy "ops manage settings"   on public.event_order_settings for all    using (public.apex_can_operate_event(event_id)) with check (public.apex_can_operate_event(event_id));
create policy "team reads catalogue"  on public.catalogue_items for select using (public.apex_can_view_event(event_id));
create policy "ops manage catalogue"  on public.catalogue_items for all    using (public.apex_can_operate_event(event_id)) with check (public.apex_can_operate_event(event_id));
create policy "team reads packages"   on public.event_packages for select using (public.apex_can_view_event(event_id));
create policy "ops manage packages"   on public.event_packages for all    using (public.apex_can_operate_event(event_id)) with check (public.apex_can_operate_event(event_id));
create policy "team reads profiles"   on public.exhibitor_profiles for select using (public.apex_can_view_event(event_id));
create policy "ops manage profiles"   on public.exhibitor_profiles for all    using (public.apex_can_operate_event(event_id)) with check (public.apex_can_operate_event(event_id));
create policy "ops read files"        on public.exhibitor_files for select using (public.apex_can_operate_event(event_id));
create policy "ops manage files"      on public.exhibitor_files for delete using (public.apex_can_operate_event(event_id));
create policy "team reads orders"     on public.service_orders for select using (public.apex_can_view_event(event_id));
create policy "team updates orders"   on public.service_orders for update using (public.apex_can_view_event(event_id)) with check (public.apex_can_view_event(event_id));
create policy "team reads order items" on public.service_order_items for select
  using (exists (select 1 from public.service_orders o where o.id = order_id and public.apex_can_view_event(o.event_id)));
create policy "team ticks order items" on public.service_order_items for update
  using (exists (select 1 from public.service_orders o where o.id = order_id and public.apex_can_view_event(o.event_id)));
-- Note: prices are still readable by the team in the database; the Deliveries screen
-- simply never shows them. If suppliers must not be able to read prices at all,
-- ask for the "deliveries view" variant (a view without price columns).

-- ── Public (exhibitor) functions: event code or private link, never table access ──
create or replace function public.apex_public_event_id(requested_event_slug text, requested_code text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_event uuid;
begin
  select (e).id into v_event from (select public.get_public_event(requested_event_slug, requested_code) as e) x limit 1;
  return v_event;
exception when others then
  return null;
end $$;

create or replace function public.get_public_order_catalogue(requested_event_slug text, requested_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_event uuid; v_settings public.event_order_settings;
begin
  v_event := public.apex_public_event_id(requested_event_slug, requested_code);
  if v_event is null then raise exception 'Event code is not valid'; end if;
  select * into v_settings from public.event_order_settings where event_id = v_event;
  return jsonb_build_object(
    'open', public.apex_event_window_open(v_event),
    'order_terms', coalesce(v_settings.order_terms, 'Orders cannot be cancelled or refunded once confirmed.'),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'category', c.category, 'code', c.code, 'name', c.name, 'options', c.options,
        'size', c.size, 'photo_url', c.photo_url,
        -- exhibitor price only: price (+VAT if registered) + 3% platform fee, rounded to the rand
        'price', round(c.price_excl_vat
                 * (1 + case when coalesce(v_settings.supplier_vat_registered, coalesce(v_settings.prices_exclude_vat, false), false) then coalesce(v_settings.vat_rate, 0.15) else 0 end)
                 * 1.03)
      ) order by c.sort_order, c.name)
      from public.catalogue_items c where c.event_id = v_event and c.active), '[]'::jsonb)
  );
end $$;

-- payload: { stand, contact_name, contact_email, contact_phone, delivery_at, notes, accept_terms, items: [{ id, option, qty }] }
create or replace function public.submit_public_order(requested_event_slug text, requested_code text, payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_event uuid; v_settings public.event_order_settings; v_vat numeric; v_fee numeric;
  v_order public.service_orders; v_item jsonb; v_cat public.catalogue_items; v_qty int;
  v_ex numeric := 0; v_pay numeric := 0; v_unit_pay numeric; v_name text; v_stand text;
begin
  v_event := public.apex_public_event_id(requested_event_slug, requested_code);
  if v_event is null then raise exception 'Event code is not valid'; end if;
  if not public.apex_event_window_open(v_event) then raise exception 'Ordering is closed for this event'; end if;
  if coalesce((payload->>'accept_terms')::boolean, false) is false then raise exception 'Please accept the order terms'; end if;
  if jsonb_array_length(coalesce(payload->'items', '[]')) = 0 then raise exception 'Add at least one item'; end if;
  if jsonb_array_length(payload->'items') > 60 then raise exception 'Too many lines in one order'; end if;

  v_stand := upper(trim(payload->>'stand'));
  select name into v_name from public.exhibitors where event_id = v_event and upper(stand) = v_stand limit 1;
  if v_name is null then raise exception 'Stand not found for this event'; end if;

  -- simple abuse guard: max 20 orders per stand per day
  if (select count(*) from public.service_orders where event_id = v_event and stand = v_stand and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many orders today for this stand. Please contact the organiser.';
  end if;

  select * into v_settings from public.event_order_settings where event_id = v_event;
  v_vat := case when coalesce(v_settings.supplier_vat_registered, coalesce(v_settings.prices_exclude_vat, false), false) then coalesce(v_settings.vat_rate, 0.15) else 0 end;
  v_fee := 0.03;

  insert into public.service_orders (event_id, stand, exhibitor_name, contact_name, contact_email, contact_phone, delivery_at, notes, terms_accepted_at)
  values (v_event, v_stand, v_name, left(payload->>'contact_name', 120), left(payload->>'contact_email', 200),
          left(payload->>'contact_phone', 60), nullif(payload->>'delivery_at', '')::timestamptz, left(payload->>'notes', 1000), now())
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(payload->'items') loop
    select * into v_cat from public.catalogue_items where id = (v_item->>'id')::uuid and event_id = v_event and active;
    if v_cat.id is null then raise exception 'An item is no longer available'; end if;
    v_qty := greatest(1, least(500, coalesce((v_item->>'qty')::int, 1)));
    v_unit_pay := round(v_cat.price_excl_vat * (1 + v_vat) * (1 + v_fee));
    insert into public.service_order_items (order_id, catalogue_item_id, code, name, option, qty, unit_price_excl_vat, unit_payable)
    values (v_order.id, v_cat.id, v_cat.code, v_cat.name, nullif(left(v_item->>'option', 80), ''), v_qty, v_cat.price_excl_vat, v_unit_pay);
    v_ex := v_ex + v_cat.price_excl_vat * v_qty;
    v_pay := v_pay + v_unit_pay * v_qty;
  end loop;

  update public.service_orders
     set total_excl_vat = round(v_ex, 2), total_vat = round(v_ex * v_vat, 2),
         total_fee = round(v_ex * (1 + v_vat) * v_fee, 2), total_payable = round(v_pay, 2)
   where id = v_order.id;

  return jsonb_build_object('ref', v_order.ref, 'edit_token', v_order.edit_token, 'total_payable', round(v_pay, 2), 'exhibitor_name', v_name);
end $$;

-- Exhibitor's private link (fascia, logo, documents, their package and orders)
create or replace function public.get_exhibitor_portal(requested_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_p public.exhibitor_profiles; v_event public.events; v_pkg public.event_packages; v_settings public.event_order_settings;
begin
  select * into v_p from public.exhibitor_profiles where portal_token = requested_token;
  if v_p.event_id is null then raise exception 'This link is not valid'; end if;
  select * into v_event from public.events where id = v_p.event_id;
  select * into v_pkg from public.event_packages where event_id = v_p.event_id and code = v_p.package_code;
  select * into v_settings from public.event_order_settings where event_id = v_p.event_id;
  return jsonb_build_object(
    'open', public.apex_event_window_open(v_p.event_id),
    'event', jsonb_build_object('name', v_event.name, 'slug', v_event.slug, 'start', v_event.event_start_date, 'end', v_event.event_end_date),
    'stand', v_p.stand,
    'exhibitor_name', (select name from public.exhibitors where event_id = v_p.event_id and upper(stand) = upper(v_p.stand) limit 1),
    'package', case when v_pkg.id is null then null else jsonb_build_object('name', v_pkg.name, 'size_sqm', v_pkg.size_sqm, 'description', v_pkg.description, 'includes_fascia_logo', v_pkg.includes_fascia_logo, 'features', v_pkg.features, 'items', v_pkg.items) end,
    'logo_included', coalesce(v_pkg.includes_fascia_logo, false) or v_p.logo_paid,
    'logo_terms', coalesce(v_settings.logo_terms, 'Logos are only printed on fascia boards when included in your package or paid for.'),
    'fascia_name', v_p.fascia_name, 'fascia_status', v_p.fascia_status,
    'files', coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'file_name', f.file_name, 'uploaded_at', f.uploaded_at) order by f.uploaded_at desc)
                       from public.exhibitor_files f where f.event_id = v_p.event_id and upper(f.stand) = upper(v_p.stand)), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('ref', o.ref, 'status', o.status, 'total_payable', o.total_payable, 'delivery_at', o.delivery_at, 'created_at', o.created_at) order by o.created_at desc)
                        from public.service_orders o where o.event_id = v_p.event_id and o.stand = upper(v_p.stand)), '[]'::jsonb)
  );
end $$;

create or replace function public.save_exhibitor_fascia(requested_token uuid, requested_fascia_name text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if length(trim(coalesce(requested_fascia_name, ''))) = 0 then raise exception 'Enter the fascia name'; end if;
  update public.exhibitor_profiles
     set fascia_name = left(trim(requested_fascia_name), 40), fascia_status = 'submitted', fascia_submitted_at = now(), updated_at = now()
   where portal_token = requested_token and public.apex_event_window_open(event_id);
  if not found then raise exception 'This link is not valid or the event is closed'; end if;
end $$;

-- Called by the app after a private-link upload to Storage (see bucket below)
create or replace function public.register_exhibitor_file(requested_token uuid, requested_kind text, requested_file_name text, requested_path text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_p public.exhibitor_profiles;
begin
  select * into v_p from public.exhibitor_profiles where portal_token = requested_token;
  if v_p.event_id is null or not public.apex_event_window_open(v_p.event_id) then raise exception 'This link is not valid or the event is closed'; end if;
  if requested_kind not in ('logo', 'document') then raise exception 'Unknown file type'; end if;
  if split_part(requested_path, '/', 1) <> requested_token::text then raise exception 'Invalid file path'; end if;
  if (select count(*) from public.exhibitor_files where event_id = v_p.event_id and stand = v_p.stand) >= 30 then raise exception 'Too many files for this stand'; end if;
  insert into public.exhibitor_files (event_id, stand, kind, file_name, storage_path)
  values (v_p.event_id, v_p.stand, requested_kind, left(requested_file_name, 200), requested_path);
end $$;

grant execute on function public.get_public_order_catalogue(text, text) to anon, authenticated;
grant execute on function public.submit_public_order(text, text, jsonb) to anon, authenticated;
grant execute on function public.get_exhibitor_portal(uuid) to anon, authenticated;
grant execute on function public.save_exhibitor_fascia(uuid, text) to anon, authenticated;
grant execute on function public.register_exhibitor_file(uuid, text, text, text) to anon, authenticated;
grant execute on function public.apex_can_operate_event(uuid), public.apex_can_view_event(uuid), public.apex_event_window_open(uuid) to authenticated;

-- ── Storage ─────────────────────────────────────────────────────────────────
-- catalogue-photos: public read (product photos), team upload into <event_id>/…
-- exhibitor-files: PRIVATE (high-res logos, documents). Exhibitors upload into
--                  <portal_token>/… using their private link; only the team can read.
insert into storage.buckets (id, name, public) values ('catalogue-photos', 'catalogue-photos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit) values ('exhibitor-files', 'exhibitor-files', false, 52428800) on conflict (id) do nothing;

create policy "team uploads catalogue photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'catalogue-photos' and public.apex_can_operate_event(((storage.foldername(name))[1])::uuid));
create policy "exhibitor uploads own files" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'exhibitor-files' and exists (
    select 1 from public.exhibitor_profiles p
    where p.portal_token::text = (storage.foldername(name))[1] and public.apex_event_window_open(p.event_id)));
create policy "team reads exhibitor files" on storage.objects for select to authenticated
  using (bucket_id = 'exhibitor-files' and exists (
    select 1 from public.exhibitor_profiles p
    where p.portal_token::text = (storage.foldername(name))[1] and public.apex_can_operate_event(p.event_id)));

-- Keep exhibitor_profiles in step with the exhibitor list (one row per stand)
create or replace function public.apex_ensure_exhibitor_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.exhibitor_profiles (event_id, stand) values (new.event_id, upper(new.stand))
  on conflict (event_id, stand) do nothing;
  return new;
end $$;
drop trigger if exists apex_exhibitor_profile_trg on public.exhibitors;
create trigger apex_exhibitor_profile_trg after insert or update of stand on public.exhibitors
  for each row execute function public.apex_ensure_exhibitor_profile();
insert into public.exhibitor_profiles (event_id, stand)
  select event_id, upper(stand) from public.exhibitors on conflict do nothing;

-- ── Delivery team role ──────────────────────────────────────────────────────
-- The app lets a member with role 'delivery' see ONLY the Deliveries screen.
-- If client_event_memberships.role has a CHECK constraint or enum, 'delivery'
-- must be added to it. Copilot: look up the existing constraint name and prepare
-- the ALTER for review — do not guess it.
