-- Remove exhibitors and their linked demo queries from the directory.
delete from public.queries
where stand in ('B05', 'C5', 'D2', 'S9', 'T5')
   or exhibitor in ('Sovereign Ratings', 'Standard Bank', 'Capitec Bank', 'Bidvest', 'Tsogo Sun');

delete from public.exhibitors
where stand in ('B05', 'C5', 'D2', 'S9', 'T5')
   or name in ('Sovereign Ratings', 'Standard Bank', 'Capitec Bank', 'Bidvest', 'Tsogo Sun');