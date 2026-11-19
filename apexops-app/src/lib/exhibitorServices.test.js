import { eventAccessWindow, packageFulfillmentRows, packageInfrastructure, parseStockRows, priceBreakdown, readServiceImportRows, SHELL_SIZES, standardShellPackage } from './exhibitorServices';

test('standard shell schemes cover all six sizes and infrastructure totals assigned stands', () => {
  expect(SHELL_SIZES).toEqual([6, 9, 12, 18, 24, 32]);
  const packages = SHELL_SIZES.map(size => standardShellPackage(size));
  const totals = packageInfrastructure([{ package_code:'SHELL6' }, { package_code:'SHELL6', logo_paid:true }, { package_code:'SHELL9' }], packages);
  expect(totals.lines).toContainEqual({ label:'Chair', qty:6 });
  expect(totals.features).toContainEqual({ label:'Fascia name board', qty:3 });
  expect(totals.features).toContainEqual({ label:'Logo printed on fascia', qty:1 });
});

test('package pack-out rows retain independent packed, on-stand, and returned states', () => {
  const pkg = { code:'SHELL9', items:[{ qty:2, label:'Chair' },{ qty:1, label:'Table' }] };
  const rows = packageFulfillmentRows({ package_fulfillment:{ 'SHELL9:0:chair':{ packed:true, on_stand:true } } },pkg);
  expect(rows).toEqual([
    expect.objectContaining({ id:'SHELL9:0:chair', packed:true, on_stand:true, returned:false }),
    expect.objectContaining({ id:'SHELL9:1:table', packed:false, on_stand:false, returned:false }),
  ]);
});

test('CSV import preserves quoted commas and leading zeroes', async () => {
  const rows = await readServiceImportRows({ name:'exhibitors.csv', text:async () => 'Company,Stand,Cell No.\n"Example, Ltd",A01,0821234567\n' });
  expect(rows).toEqual([{ Company:'Example, Ltd', Stand:'A01', 'Cell No.':'0821234567' }]);
});

test('CSV import rejects malformed rows instead of importing partial data', async () => {
  await expect(readServiceImportRows({ name:'exhibitors.csv', text:async () => 'Company,Stand\n"Unclosed,A01' })).rejects.toThrow('Could not read the CSV file');
});

test('exhibitor price applies VAT and the platform fee before rounding to the rand', () => {
  expect(priceBreakdown(100, { supplier_vat_registered:true, vat_rate:0.15, platform_fee_rate:0.03 }).exhibitorPrice).toBe(118);
  expect(priceBreakdown(100, { supplier_vat_registered:false, vat_rate:0.15, platform_fee_rate:0.03 }).exhibitorPrice).toBe(103);
  expect(priceBreakdown(100, { supplier_vat_registered:true, vat_rate:0.15, platform_fee_rate:0.03 }).fee).toBeCloseTo(3.45, 10);
});

test('stock import maps the supplied template columns', () => {
  expect(parseStockRows([{Category:'Furniture','Item code':'H01',Item:'Chair','Options (separate with |)':'White | Black','Price excl VAT':'125.50','Stock quantity':'4'}])).toEqual([
    expect.objectContaining({category:'Furniture',code:'H01',name:'Chair',options:['White','Black'],price_excl_vat:125.5,stock_qty:4}),
  ]);
});

test('event window is upcoming before the configured opening date', () => {
  const result=eventAccessWindow({event_start_date:'2099-06-01',event_end_date:'2099-06-02'});
  expect(result.state).toBe('upcoming');
});