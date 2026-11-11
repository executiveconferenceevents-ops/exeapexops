export const PRICING_STATUS = 'DRAFT - suggested prices, not yet validated with customers';
export const PRICING_CURRENCY = 'ZAR';

export const EVENT_TIERS = [
  { id:'small', name:'Small event', maxExhibitors:50, listPrice:9500, includedStaffSeats:5, includedStorageGb:5, historyMonths:12 },
  { id:'medium', name:'Medium event', maxExhibitors:150, listPrice:19500, includedStaffSeats:15, includedStorageGb:15, historyMonths:12 },
  { id:'large', name:'Large event', maxExhibitors:400, listPrice:35000, includedStaffSeats:30, includedStorageGb:40, historyMonths:12 },
  { id:'major', name:'Major event', minExhibitors:401, maxExhibitors:null, listPrice:null, pricing:'custom_quote', includedStaffSeats:null, includedStorageGb:null, historyMonths:12 },
];

export const VOLUME_PLANS = [
  { id:'vol_12', eventsPerYear:12, discounts:{ small:7, medium:7, large:7 } },
  { id:'vol_15', eventsPerYear:15, discounts:{ small:8, medium:9, large:10 } },
  { id:'vol_20', eventsPerYear:20, discounts:{ small:9, medium:11, large:13 } },
  { id:'vol_30', eventsPerYear:30, discounts:{ small:11, medium:14, large:17 } },
  { id:'vol_40', eventsPerYear:40, discounts:{ small:13, medium:17, large:21 } },
  { id:'vol_50', eventsPerYear:50, discounts:{ small:15, medium:20, large:25 } },
  { id:'vol_75', eventsPerYear:75, discounts:{ small:15, medium:20, large:25 } },
  { id:'vol_100', eventsPerYear:100, discounts:{ small:15, medium:20, large:25 } },
];

export const EXTRA_STAFF_SEAT_PRICE = 150;

export function getEventTier(exhibitorCount) {
  const count = Number(exhibitorCount);
  if (!Number.isInteger(count) || count < 0) return null;
  return EVENT_TIERS.find(tier => tier.maxExhibitors === null || count <= tier.maxExhibitors) || null;
}

export function getPerEventPrice(tierId, planId = 'pay_per_event') {
  const tier = EVENT_TIERS.find(item => item.id === tierId);
  if (!tier || tier.listPrice === null) return null;
  if (planId === 'pay_per_event') return tier.listPrice;
  const plan = VOLUME_PLANS.find(item => item.id === planId);
  const discount = plan?.discounts[tierId];
  return discount === undefined ? null : Math.round(tier.listPrice * (1 - discount / 100));
}

export function getMonthlyPlanPrice(tierId, planId) {
  const plan = VOLUME_PLANS.find(item => item.id === planId);
  const perEventPrice = getPerEventPrice(tierId, planId);
  if (!plan || perEventPrice === null) return null;
  return Math.ceil((plan.eventsPerYear * perEventPrice / 12) / 50) * 50;
}