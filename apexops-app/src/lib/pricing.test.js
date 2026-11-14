import { getAnnualQuote, getEventTier, getVolumePlan, INCLUDED_INTERNAL_SEATS, validatePricingConfig } from './pricing';

test('categorizes stand counts at the stated boundaries', () => {
  expect([1,50,51,100,101,200,201,400,401,600,601].map(count => getEventTier(count).id))
    .toEqual(['small','small','medium','medium','large','large','extra_large','extra_large','major','major','enterprise']);
  expect(getEventTier('')).toBeNull();
  expect(getEventTier(0)).toBeNull();
  expect(INCLUDED_INTERNAL_SEATS).toBe(20);
});

test('applies volume discounts to a mixed annual allocation', () => {
  expect(getVolumePlan(11)).toBeNull();
  expect([12,19,20,29,30,49,50,74,75,100].map(count => getVolumePlan(count).discountPct))
    .toEqual([5,5,8,8,12,12,15,15,18,18]);
  expect(getVolumePlan(101)).toBeNull();
  expect(getAnnualQuote([{ tierId:'medium', count:20 }])).toEqual({ eventCount:20, discountPct:8, annualCents:46000000, monthlyCents:3833333, finalMonthCents:3833337 });
  expect(getAnnualQuote([{ tierId:'small', count:10 }, { tierId:'major', count:10 }]).annualCents).toBe(105800000);
  expect(getAnnualQuote([{ tierId:'enterprise', count:12 }])).toBeNull();
});

test('editable pricing config drives tier, discount and annual quote calculations', () => {
  const eventTiers = [{ id:'custom', name:'Custom', minLocations:1, maxLocations:10, listPrice:20000 }];
  const volumePlans = [{ id:'custom_volume', eventsPerYear:12, maxEvents:14, discountPct:10 }];
  expect(validatePricingConfig({ eventTiers, volumePlans })).toBe('');
  expect(getEventTier(8, eventTiers).id).toBe('custom');
  expect(getVolumePlan(13, volumePlans).discountPct).toBe(10);
  expect(getVolumePlan(11, volumePlans)).toBeNull();
  expect(getAnnualQuote([{ tierId:'custom', count:12 }], eventTiers, volumePlans)).toEqual({ eventCount:12, discountPct:10, annualCents:21600000, monthlyCents:1800000, finalMonthCents:1800000 });
  expect(validatePricingConfig({ eventTiers:[...eventTiers, { id:'overlap', name:'Overlap', minLocations:8, maxLocations:20, listPrice:30000 }], volumePlans })).toMatch(/overlap/);
  expect(validatePricingConfig({ eventTiers, volumePlans:[{ id:'invalid', eventsPerYear:11, maxEvents:15, discountPct:8 }] })).toMatch(/12 events/);
});