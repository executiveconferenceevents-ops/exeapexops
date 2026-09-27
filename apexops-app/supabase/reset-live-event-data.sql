-- DESTRUCTIVE: clears all event queries, stand rebooking requests, and Ops notifications.
-- Preserves staff, suppliers, exhibitors, and application schema.
-- Review the connected Supabase project before running this script.

begin;

delete from public.ops_notifications;
delete from public.queries;
delete from public.rebooking_requests;

commit;

notify pgrst, 'reload schema';
