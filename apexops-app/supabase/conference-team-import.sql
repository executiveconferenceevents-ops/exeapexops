-- Adds the conference organising team and official service providers to the Suppliers directory.
-- Mobile numbers only (landlines omitted). Safe to re-run; matches on id and updates existing rows.

insert into public.staff (id, supplier_name, name, email, mobile, category, role)
values
  ('s-joshua-low',       'ESG Africa Conference', 'Joshua Low',       'joshua@esgafricaconference.com',   null,               'Organiser', 'staff'),
  ('s-wendy-poulton',    'ESG Africa Conference', 'Wendy Poulton',    'wendy@esgafricaconference.com',    null,               'Organiser', 'staff'),
  ('s-leann-hare',       'ESG Africa Conference', 'Le-Ann Hare',      'leann@esgafricaconference.com',    null,               'Organiser', 'staff'),
  ('s-hannelie-bennett', 'ESG Africa Conference', 'Hannelie Bennett', 'hannelie@esgafricaconference.com', '+27 81 781 3798',  'Organiser', 'staff'),
  ('s-didi-liebenberg',  'ESG Africa Conference', 'Didi Liebenberg',  'didi@esgafricaconference.com',     '+27 78 861 1432',  'Organiser', 'staff'),
  ('s-sales-alan',       'ESG Africa Conference', 'Alan (Sales)',     'alan@esgafricaconference.com',     null,               'Organiser', 'staff'),
  ('s-nitisha-dheda',    'Sandton Convention Centre', 'Nitisha Dheda', 'Nitisha.Dheda@southernsun.com',   null,               'Organiser', 'staff'),
  ('s-ruan-king',        'King Cargo',            'Ruan King',        'ruan@kingcargo.co.za',             '082 889 1659',     'Logistics / Freight / Loading Bay', 'staff'),
  ('s-wame-tshabalala',  'GL Events',             'Wame Tshabalala',  'wame.tshabalala@gl-events.com',    '078 099 0903',     'Stand Builder', 'staff'),
  ('s-sipho-mphuthi',    'Lodge Security',        'Sipho Mphuthi',    'sipho@lodgevents.co.za',           '078 732 1510',     'Security', 'staff')
on conflict (id) do update set
  supplier_name = excluded.supplier_name,
  name = excluded.name,
  email = excluded.email,
  mobile = excluded.mobile,
  category = excluded.category,
  role = excluded.role;

delete from public.staff where id = 's-sales-zayeen';
