-- Remove selected exhibitors and their linked queries from one event only.
-- Change the event slug before running.
delete from public.queries
where event_id = (select id from public.events where slug = 'esg-africa-2026')
   and (stand in ('B05', 'C5', 'D2', 'S9', 'T5')
    or exhibitor in ('Sovereign Ratings', 'Standard Bank', 'Capitec Bank', 'Bidvest', 'Tsogo Sun'));

delete from public.exhibitors
where event_id = (select id from public.events where slug = 'esg-africa-2026')
   and (stand in ('B05', 'C5', 'D2', 'S9', 'T5')
    or name in ('Sovereign Ratings', 'Standard Bank', 'Capitec Bank', 'Bidvest', 'Tsogo Sun'));