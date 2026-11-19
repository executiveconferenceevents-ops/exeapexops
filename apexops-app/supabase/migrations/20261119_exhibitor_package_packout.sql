-- APEXOPS package stock pack-out and detailed exhibitor order status.
-- Apply after the prerequisite exhibitor service migrations.
begin;

alter table public.exhibitor_profiles
  add column if not exists package_fulfillment jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='exhibitor_profiles_package_fulfillment_object'
      and conrelid='public.exhibitor_profiles'::regclass
  ) then
    alter table public.exhibitor_profiles
      add constraint exhibitor_profiles_package_fulfillment_object
      check (jsonb_typeof(package_fulfillment)='object');
  end if;
end $$;

create or replace function public.get_exhibitor_portal(requested_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_p public.exhibitor_profiles;
  v_event public.events;
  v_pkg public.event_packages;
  v_settings public.event_order_settings;
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
    'package_fulfillment', coalesce(v_p.package_fulfillment, '{}'::jsonb),
    'logo_included', coalesce(v_pkg.includes_fascia_logo, false) or v_p.logo_paid,
    'logo_terms', coalesce(v_settings.logo_terms, 'Logos are only printed on fascia boards when included in your package or paid for.'),
    'fascia_name', v_p.fascia_name,
    'fascia_status', v_p.fascia_status,
    'files', coalesce((
      select jsonb_agg(jsonb_build_object('kind', f.kind, 'file_name', f.file_name, 'uploaded_at', f.uploaded_at) order by f.uploaded_at desc)
      from public.exhibitor_files f
      where f.event_id = v_p.event_id and upper(f.stand) = upper(v_p.stand)
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', o.ref,
        'status', o.status,
        'total_payable', o.total_payable,
        'delivery_at', o.delivery_at,
        'created_at', o.created_at,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id,
            'code', i.code,
            'name', i.name,
            'option', i.option,
            'qty', i.qty,
            'picked', i.picked,
            'loaded', i.loaded,
            'delivered', i.delivered
          ) order by i.id)
          from public.service_order_items i
          where i.order_id = o.id
        ), '[]'::jsonb)
      ) order by o.created_at desc)
      from public.service_orders o
      where o.event_id = v_p.event_id and upper(o.stand) = upper(v_p.stand)
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public.get_exhibitor_portal(uuid) to anon, authenticated;

commit;
