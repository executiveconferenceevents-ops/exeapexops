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

export function getDefaultPricingConfig() {
  return {
    eventTiers:EVENT_TIERS.map(tier => ({ ...tier })),
    volumePlans:VOLUME_PLANS.map(plan => ({ ...plan })),
  };
}

export function validatePricingConfig(config) {
  if (!Array.isArray(config?.eventTiers) || !config.eventTiers.length) return 'Add at least one event tier.';
  if (!Array.isArray(config?.volumePlans) || !config.volumePlans.length) return 'Add at least one annual discount band.';

  const tiers = [...config.eventTiers].sort((left, right) => Number(left.minLocations) - Number(right.minLocations));
  if (new Set(tiers.map(tier => tier.id)).size !== tiers.length) return 'Event tier identifiers must be unique.';
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const minimum = Number(tier.minLocations);
    const maximum = tier.maxLocations === '' || tier.maxLocations == null ? null : Number(tier.maxLocations);
    const price = tier.listPrice === '' || tier.listPrice == null ? null : Number(tier.listPrice);
    if (!tier.name.trim() || !Number.isInteger(minimum) || minimum < 1) return 'Each event tier needs a name and a valid minimum stand/build-location count.';
    if (maximum !== null && (!Number.isInteger(maximum) || maximum < minimum)) return `Check the maximum size for ${tier.name}.`;
    if (price !== null && (!Number.isInteger(price) || price < 0)) return `Check the price for ${tier.name}.`;
    if (index > 0) {
      const previousMaximum = tiers[index - 1].maxLocations == null || tiers[index - 1].maxLocations === '' ? null : Number(tiers[index - 1].maxLocations);
      if (previousMaximum === null || minimum <= previousMaximum) return 'Event tier sizes cannot overlap; adjust the minimum and maximum values.';
    }
  }

  const plans = [...config.volumePlans].sort((left, right) => Number(left.eventsPerYear) - Number(right.eventsPerYear));
  if (new Set(plans.map(plan => plan.id)).size !== plans.length) return 'Annual discount band identifiers must be unique.';
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const minimum = Number(plan.eventsPerYear);
    const maximum = Number(plan.maxEvents);
    const discount = Number(plan.discountPct);
    if (!Number.isInteger(minimum) || minimum < 12 || !Number.isInteger(maximum) || maximum < minimum) return 'Annual discount bands must start at 12 events and have valid event ranges.';
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) return 'Annual discounts must be from 0% to 100%.';
    if (index > 0 && minimum <= Number(plans[index - 1].maxEvents)) return 'Annual event ranges cannot overlap.';
  }
  return '';
}

export function getEventTier(locationCount, eventTiers = EVENT_TIERS) {
  if (locationCount === '' || locationCount == null) return null;
  const count = Number(locationCount);
  if (!Number.isInteger(count) || count < 1) return null;
  return eventTiers.find(tier => count >= tier.minLocations && (tier.maxLocations === null || count <= tier.maxLocations)) || null;
}

export function getVolumePlan(eventCount, volumePlans = VOLUME_PLANS) {
  const count = Number(eventCount);
  if (!Number.isInteger(count) || count < 12) return null;
  return volumePlans.find(plan => count >= plan.eventsPerYear && count <= plan.maxEvents) || null;
}

export function getPerEventPrice(tierId, planId = 'pay_per_event', eventTiers = EVENT_TIERS, volumePlans = VOLUME_PLANS) {
  const tier = eventTiers.find(item => item.id === tierId);
  if (!tier || tier.listPrice === null) return null;
  if (planId === 'pay_per_event') return tier.listPrice;
  const plan = volumePlans.find(item => item.id === planId);
  return plan ? tier.listPrice * (100 - plan.discountPct) / 100 : null;
}

export function getAnnualQuote(allocations, eventTiers = EVENT_TIERS, volumePlans = VOLUME_PLANS) {
  if (!Array.isArray(allocations) || !allocations.length) return null;
  let eventCount = 0;
  let totalCents = 0;
  for (const allocation of allocations) {
    const tier = eventTiers.find(item => item.id === allocation.tierId);
    const count = Number(allocation.count);
    if (!tier || tier.listPrice === null || !Number.isInteger(count) || count < 0) return null;
    eventCount += count;
    totalCents += tier.listPrice * 100 * count;
  }
  const plan = getVolumePlan(eventCount, volumePlans);
  if (!plan) return null;
  const annualCents = Math.round(totalCents * (100 - plan.discountPct) / 100);
  const monthlyCents = Math.round(annualCents / 12);
  return { eventCount, discountPct:plan.discountPct, annualCents, monthlyCents, finalMonthCents:annualCents - monthlyCents * 11 };
}

export function getMonthlyPlanPrice(tierId, planId, eventTiers = EVENT_TIERS, volumePlans = VOLUME_PLANS) {
  const plan = volumePlans.find(item => item.id === planId);
  const quote = plan && getAnnualQuote([{ tierId, count:plan.eventsPerYear }], eventTiers, volumePlans);
  return quote ? quote.monthlyCents / 100 : null;
}