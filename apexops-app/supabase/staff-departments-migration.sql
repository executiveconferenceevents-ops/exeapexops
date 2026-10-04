alter table public.staff add column if not exists departments text[];

update public.staff
set departments = array[category]
where departments is null or cardinality(departments) = 0;

alter table public.staff alter column departments set default '{}';
alter table public.staff alter column departments set not null;