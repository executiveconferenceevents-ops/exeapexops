-- Add exhibitor phone and email details from the supplied exhibitor list
alter table public.exhibitors add column if not exists phone text;
alter table public.exhibitors add column if not exists email text;

insert into public.exhibitors (stand, name, contact, phone, email)
values
  ('A01', 'Nedbank', 'Lorna Louw', '+27 83 325 0283', 'LornaL@Nedbank.co.za'),
  ('A02', 'Henley Business School', 'Mamodise Mailula', '011 808 0860', 'mamodisem@henleysa.ac.za'),
  ('A03', 'Compliance Centre', 'Caylin Swanepoel', '+27 12 543 2971', 'caylin@rmgirs.com'),
  ('A04', 'Nerdma Systems', 'Thamsanqa Moyo', '083 779 3979', 'thamsanqa.moyo@nerdma.co.za'),
  ('A05', 'LAB17 / LEAP Group', 'Lesego Mautloa', '+27 73 336 5845', 'lesego@leapco.co.za'),
  ('A06', 'MARSH (PTY) LTD', 'Nobubele Mkwananzi-Ngwenya', '+27 71 350 7703', null),
  ('A07', 'NxGN (Pty) Ltd', 'Bonita Field', '082 451 2802', 'bfield@nxgn.co.za'),
  ('A08', 'YES', 'Reba Hlabangane', '+27 76 980 6029', 'Rebaona@yes4youth.co.za'),
  ('A09/A10', 'SGS', 'Tracy Simone', '+27 71 366 7814', 'Tracy.Simone@sgs.com'),
  ('A11', 'Kenya Airways', 'Wycliff Mwangi', '+254 740 754 694', 'Wycliff.Mwangi@kenya-airways.com'),
  ('A12', 'Gordon Carbon Solutions', 'Prakshna Velter', '+27 82 617 8683', 'prakshna@gordoncarbonsolutions.com'),
  ('A13', 'Corporate Traveller', 'Kelebetsing Scheppers', '067 375 3628', 'kelebetsing.scheppers@fctg.co.za'),
  ('A14', 'The Gordon Group', 'Prakshna Velter', '+27 82 617 8683', 'prakshna@gordongroup.com'),
  ('A15/A16', 'Dis-Chem Pharmacies', 'Zama Pila', '079 498 9921', 'zama.pila@dischem.co.za'),
  ('A21', 'Zenith Car Rental / Avis', 'Tiisetso Ramagoshi', '078 035 8691', 'tiisetso.ramagoshi@avisbudget.co.za'),
  ('B01', 'Sari for Change', 'Rayana Edwards', '+27 82 568 7757', 'rayanaedwards@gmail.com'),
  ('B02', 'LEZA & Co', 'Jodi Leza Thurtell', '+27 76 898 7411', 'lezaandco@gmail.com'),
  ('B03', 'TDS Energies (Pty) Ltd', 'Oletta Ntshane', '060 554 2025', 'oletta@techniquedrillingservices.co.za'),
  ('B04', 'TUV Rheinland', 'Gloria Tererai', '060 345 2789', 'gloria.tererai@za.tuv.com'),
  ('B06', 'Ukusimama Foundation', 'Thobekile Gambu', '079 965 3491', 'thobekile@ukusimama.co.za'),
  ('B07', 'Good Governance Academy / ESG Exchange', 'Carolynn Chalmers', '+27 83 300 1309', 'carolynn@candorgovernance.co.za'),
  ('B08', 'IAIAsa', 'Sue George', '+27 82 961 5750', 'operations@iaiasa.co.za'),
  ('B09', 'Klein Muis', 'Aiden Peters', '+27 67 324 6739', 'aidanjpeters@gmail.com')
on conflict (stand) do update set
  name = excluded.name,
  contact = excluded.contact,
  phone = excluded.phone,
  email = excluded.email;
