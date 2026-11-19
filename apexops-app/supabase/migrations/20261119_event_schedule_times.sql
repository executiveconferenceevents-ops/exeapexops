begin;

alter table public.events
  add column if not exists event_start_time time,
  add column if not exists event_end_time time,
  add column if not exists build_up_start_time time,
  add column if not exists build_up_end_time time,
  add column if not exists breakdown_start_time time,
  add column if not exists breakdown_end_time time;

commit;
