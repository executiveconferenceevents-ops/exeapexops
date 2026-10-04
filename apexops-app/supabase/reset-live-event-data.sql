-- DESTRUCTIVE: clears activity for one event only. Change the slug before running.
-- Preserves staff, suppliers, exhibitors, other events, and application schema.
-- Review the connected Supabase project before running this script.

do $$
declare
	target_event_id uuid;
begin
	select id into target_event_id from public.events where slug = 'esg-africa-2026';
	if target_event_id is null then
		raise exception 'Event esg-africa-2026 was not found. Update the slug before running this script.';
	end if;
	delete from public.ops_notifications where event_id = target_event_id;
	delete from public.queries where event_id = target_event_id;
	delete from public.rebooking_requests where event_id = target_event_id;
end;
$$;

notify pgrst, 'reload schema';
