export const DEMO_CLIENT_ID = 'demo-client-ece';
export const DEMO_EVENT_ID = 'demo-event-esg-africa-2026';

const DEMO_PASSWORD = 'DemoAccess26!';

export const DEMO_ACCOUNTS = [
  { email:'admin@apexops.demo', label:'Platform Admin', role:'platform-admin', portal:'admin', portalLabel:'Platform Admin' },
  { email:'organiser@apexops.demo', label:'Client / Organiser', role:'client', portal:'client', portalLabel:'Client / Organiser', id:'demo-owner' },
  { email:'operations@apexops.demo', label:'Event Operations', role:'operations', portal:'operations', portalLabel:'Event Operations' },
  { email:'staff@apexops.demo', label:'Staff', role:'staff', portal:'team', portalLabel:'Staff & Delivery' },
  { email:'supplier@apexops.demo', label:'Supplier / Delivery', role:'supplier', portal:'team', portalLabel:'Staff & Delivery' },
  { email:'exhibitor@apexops.demo', label:'Exhibitor', role:'exhibitor', portal:'exhibitor', portalLabel:'Exhibitor access' },
].map(account => ({ ...account, password:DEMO_PASSWORD }));

export function getDemoAccountsForPortal(portal) {
  return DEMO_ACCOUNTS.filter(account => account.portal === portal);
}

export function authenticateDemoAccount(email, password) {
  const account = DEMO_ACCOUNTS.find(item => item.email === String(email || '').trim().toLowerCase());
  if (!account || account.password !== password) return null;
  return {
    id:account.id || `demo-${account.role}`,
    email:account.email,
    demoRole:account.role,
    portal:account.portal,
    portalLabel:account.portalLabel,
  };
}

export function getDemoAccess(demoRole) {
  const eventMembership = role => ({ client_id:DEMO_CLIENT_ID, event_id:DEMO_EVENT_ID, role });
  if (demoRole === 'platform-admin') return { platformAdmin:true, memberships:[] };
  if (demoRole === 'client') return {
    platformAdmin:false,
    memberships:[{ client_id:DEMO_CLIENT_ID, event_id:null, role:'client_admin' }],
  };
  if (demoRole === 'operations') return { platformAdmin:false, memberships:[eventMembership('ops')] };
  if (demoRole === 'staff') return { platformAdmin:false, memberships:[eventMembership('staff')] };
  if (demoRole === 'supplier') return { platformAdmin:false, memberships:[eventMembership('delivery')] };
  if (demoRole === 'exhibitor') return { platformAdmin:false, memberships:[eventMembership('exhibitor')] };
  return { platformAdmin:false, memberships:[] };
}
