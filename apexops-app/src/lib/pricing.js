export const PRICING_STATUS = 'Proposed launch pricing';
export const PRICING_CURRENCY = 'ZAR';
export const INCLUDED_INTERNAL_SEATS = 20;
export const EXTRA_STAFF_SEAT_PRICE = 150;

export const EVENT_TIERS = [
  { id:'small', name:'Small', minLocations:1, maxLocations:50, listPrice:15000 },
  { id:'medium', name:'Medium', minLocations:51, maxLocations:100, listPrice:25000 },
  { id:'large', name:'Large', minLocations:101, maxLocations:200, listPrice:45000 },
  { id:'extra_large', name:'Extra Large', minLocations:201, maxLocations:400, listPrice:70000 },
  { id:'major', name:'Major', minLocations:401, maxLocations:600, listPrice:100000 },
  { id:'enterprise', name:'Enterprise', minLocations:601, maxLocations:null, listPrice:null, pricing:'custom_quote' },
];

export const VOLUME_PLANS = [
  { id:'vol_12', eventsPerYear:12, maxEvents:19, discountPct:5 },
  { id:'vol_20', eventsPerYear:20, maxEvents:29, discountPct:8 },
  { id:'vol_30', eventsPerYear:30, maxEvents:49, discountPct:12 },
  { id:'vol_50', eventsPerYear:50, maxEvents:74, discountPct:15 },
  { id:'vol_75', eventsPerYear:75, maxEvents:100, discountPct:18 },
];

export function getEventTier(locationCount) {
  if (locationCount === '' || locationCount == null) return null;
  const count = Number(locationCount);
  if (!Number.isInteger(count) || count < 1) return null;
  return EVENT_TIERS.find(tier => count >= tier.minLocations && (tier.maxLocations === null || count <= tier.maxLocations)) || null;
}

export function getVolumePlan(eventCount) {
  const count = Number(eventCount);
  if (!Number.isInteger(count) || count < 12 || count > 100) return null;
  return VOLUME_PLANS.find(plan => count >= plan.eventsPerYear && count <= plan.maxEvents) || null;
}

export function getPerEventPrice(tierId, planId = 'pay_per_event') {
  const tier = EVENT_TIERS.find(item => item.id === tierId);
  if (!tier || tier.listPrice === null) return null;
  if (planId === 'pay_per_event') return tier.listPrice;
  const plan = VOLUME_PLANS.find(item => item.id === planId);
  return plan ? tier.listPrice * (100 - plan.discountPct) / 100 : null;
}

export function getAnnualQuote(allocations) {
  if (!Array.isArray(allocations) || !allocations.length) return null;
  let eventCount = 0;
  let totalCents = 0;
  for (const allocation of allocations) {
    const tier = EVENT_TIERS.find(item => item.id === allocation.tierId);
    const count = Number(allocation.count);
    if (!tier || tier.listPrice === null || !Number.isInteger(count) || count < 0) return null;
    eventCount += count;
    totalCents += tier.listPrice * 100 * count;
  }
  const plan = getVolumePlan(eventCount);
  if (!plan) return null;
  const annualCents = Math.round(totalCents * (100 - plan.discountPct) / 100);
  const monthlyCents = Math.round(annualCents / 12);
  return { eventCount, discountPct:plan.discountPct, annualCents, monthlyCents, finalMonthCents:annualCents - monthlyCents * 11 };
}

export function getMonthlyPlanPrice(tierId, planId) {
  const plan = VOLUME_PLANS.find(item => item.id === planId);
  const quote = plan && getAnnualQuote([{ tierId, count:plan.eventsPerYear }]);
  return quote ? quote.monthlyCents / 100 : null;
}