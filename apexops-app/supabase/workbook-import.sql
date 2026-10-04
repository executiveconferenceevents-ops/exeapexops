-- Optional seed import for one event. Change the event slug before running.
-- Requires the multi-client event schema; this file does not alter RLS policies.
insert into public.exhibitors (event_id, stand, name, contact)
select event.id, imported.stand, imported.name, imported.contact
from public.events event
cross join (values
  ('A01', 'Nedbank', 'Lorna Louw'),
  ('A02', 'Henley Business School', 'Mamodise Mailula'),
  ('A03', 'Compliance Centre', 'Caylin Swanepoel'),
  ('A04', 'Nerdma Systems', 'Thamsanqa Moyo'),
  ('A05', 'LAB17 / LEAP Group', 'Lesego Mautloa'),
  ('A06', 'MARSH (PTY) LTD', 'Nobubele MkwananzI-Ngwenya'),
  ('A07', 'NxGN (Pty) Ltd', 'Bonita Field'),
  ('A08', 'YES', 'Reba Hlabangane'),
  ('A09/A10', 'SGS', 'Tracy Simone'),
  ('A11', 'Kenya Airways', 'Wycliff Mwangi'),
  ('A12', 'Gordon Carbon Solutions', 'Prakshna Velter'),
  ('A13', 'Corporate Traveller', 'Kelebetseng Scheppers'),
  ('A14', 'The Gordon Group', 'Prakshna Velter'),
  ('A15/A16', 'Dis-Chem Pharmacies', 'Zama Pila'),
  ('A21', 'Zenith Car Rental / Avis', 'Tiisetso Ramagoshi'),
  ('B01', 'Sari for Change', 'Rayana Edwards'),
  ('B02', 'LEZA & Co', 'Jodi Leza Thurtell'),
  ('B03', 'TDS Energies (Pty) Ltd', 'Oletta Ntshane'),
  ('B04', 'TUV Rheinland', 'Gloria Tererai'),
  ('B06', 'Ukusimama Foundation', 'Thobekile Gambu'),
  ('B07', 'Good Governance Academy / ESG Exchange', 'Carolynn Chalmers'),
  ('B08', 'IAIAsa', 'Sue George'),
  ('B09', 'Klein Muis', 'Aiden Peters')
) as imported(stand, name, contact)
where event.slug = 'esg-africa-2026'
on conflict (event_id, stand) do update set
  name = excluded.name,
  contact = excluded.contact;

-- Optional test record so stand A01 can be tested end to end.
insert into public.queries
  (event_id, id, stand, exhibitor, contact, category, description, est, source_tab, sla_deadline, status, logged_at)
select event.id, 'Q-DEMO-A01', 'A01', 'Nedbank', 'Lorna Louw', 'Stand Construction',
  'Demo query - test the exhibitor status screen', '1 hour', 'Stand Construction', now() + interval '1 hour', 'LOGGED', now()
from public.events event
where event.slug = 'esg-africa-2026'
on conflict (id) do nothing;