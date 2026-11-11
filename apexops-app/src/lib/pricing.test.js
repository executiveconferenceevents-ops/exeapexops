import { getAnnualQuote, getEventTier, getVolumePlan, INCLUDED_INTERNAL_SEATS } from './pricing';

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