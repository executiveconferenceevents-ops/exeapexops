-- Replace the old exhibitor seed data with the 25 exhibitors from
-- Delivery sheet (4).xlsx -> Exhibitor deliverables.

begin;

delete from public.queries
where id like 'Q-DEMO-%'
   or id like 'Q-20260921-%';

delete from public.exhibitors;

insert into public.exhibitors (stand, name, contact, phone, email)
values
  ('A01', 'Nedbank', 'Lorna Louw', 'Siphumelele: +27 10 234 3380 / Edith: 083 700 0399 / Lorna: +27 83 325 0283', 'LornaL@Nedbank.co.za; edith@edithventerpromo.com; SiphumeleleS@Nedbank.co.za'),
  ('A02', 'Henley Business', 'Mamodise Mailula', '0118080860', 'mamodisem2henleysa.ac.za'),
  ('A03', 'Compliance Centre', 'Caylin Swanepoel', '+27125432971', 'caylin@rmgirs.com'),
  ('A04', 'Nerdma Systems', 'Thamsanqa Moyo', '083 779 3979', 'thamsanqa.moyo@nerdma.co.za'),
  ('A05', 'LAB17', 'Lesego Mautloa', '27 73 336 5845', 'lesego@leapco.co.za'),
  ('A06', 'MARSH (PTY) LTD', 'Nobubele Mkwananzi-Ngwenya', '+27 71 350 7703', 'Nobubele.Mkwananzi-Ngwenya@marsh.com, Gift.Nke@marsh.com'),
  ('A07', 'NxGN (Pty) Ltd', 'Bonita Field', '082 451 2802', 'bfield@nxgn.co.za; dkok@nxgn.co.za'),
  ('A08', 'YES', 'Reba Hlabangane', '+27 76 980 6029', 'Rebaona@yes4youth.co.za; rahiwamashudu@yes4youth.co.za'),
  ('A9/A10', 'SGS', 'Tracy Simone', 'Tracy: 27 71 366 7814 / Rifiloe: 066-275-3408', 'Tracy.Simone@sgs.com; khanyisile.zulu@sgs.com; refiloe.morobane@sgs.com'),
  ('A11', 'Kenya Airways', 'Wycliff Mwangi', '+254740754694', 'Wycliff.Mwangi@kenya-airways.com'),
  ('A12', 'Gordon Carbon Solutions', 'Prakshna Velter', '27 82 617 8683', 'prakshna@gordoncarbonsolutions.com; info@gordoncarbonsolutions.com'),
  ('A13', 'Corporate Traveller', 'Kelebetsing Scheppers; Kirsten van Deventer', '067 375 3628 / 079 132 6216', 'kelebetsing.scheppers@fctg.co.za; kirsten.vandeventer@flightcentre.co.za'),
  ('A14', 'The Gordon Group', 'Prakshna Velter', '27 82 617 8683', 'prakshna@gordongroup.co.za'),
  ('A15/A16', 'Dis-Chem Pharmacies', 'Zama Pila', '079 498 9921', 'zama.pila@dischem.co.za; ashwarya.suradin@dischem.co.za'),
  ('A21', 'Zenith Car Rental (Pty) Ltd T/A Avis', 'Tiisetso Ramagoshi', '078 035 8691', 'tiisetso.ramagoshi@avisbudget.co.za; Mandisa.Mncwango@avisbudget.co.za; mary.thipe@zeda.co.za'),
  ('B01', 'Sari for Change', 'Rayana Edwards', '+2782 568 7757', 'rayanaedwards@gmail.com'),
  ('B02', 'LEZA & Co', 'Jodi Leza / Thurtell', '+27 76 898 7411', 'lezaandco@gmail.com'),
  ('B03', 'TDS Energies (Pty) Ltd', 'Oletta Ntshane', '+27 60 554 2025', 'oletta@techniquedrillingservices.co.za; vusi@techniquedrillingservices.co.za'),
  ('B04', 'TUV Rheinland', 'Gloria Tererai', '060 345 2789', 'gloria.tererai@za.tuv.com'),
  ('B05', 'Sovereign Ratings', 'Antoinette Mtambo', '844105802', 'antoinette.mtambo@saratings.com'),
  ('B06', 'Ukusimama Foundation', 'Thobekile Gambu', '079 965 3491', 'Thobekile@ukusimama.co.za; info@ukusimama.co.za'),
  ('B07', 'Good Governance Academy / ESG Exchange', 'Carolynn Chalmers', '27 83 300 1309', 'carolynn@candorgovernance.co.za'),
  ('B08', 'IAIAsa', 'Sue George', '27 82 961 5750', 'operations@iaiasa.co.za'),
  ('B09', 'Klein Muis', 'Aiden Peters', '+27 67 324 6739', 'aidanjpeters@gmail.com'),
  ('B10', 'Khumo Morojele', null, null, null);

commit;
