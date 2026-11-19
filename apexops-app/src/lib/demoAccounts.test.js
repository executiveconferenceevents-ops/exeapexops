import { authenticateDemoAccount, DEMO_ACCOUNTS, getDemoAccess, getDemoAccountsForPortal } from './demoAccounts';

test('demo logins are distinct and only accept their published preview credentials', () => {
  expect(new Set(DEMO_ACCOUNTS.map(account => account.email)).size).toBe(DEMO_ACCOUNTS.length);
  expect(DEMO_ACCOUNTS.map(account => account.role)).toEqual([
    'platform-admin','client','operations','staff','supplier','exhibitor',
  ]);
  expect(authenticateDemoAccount('  ORGANISER@APEXOPS.DEMO ', 'DemoAccess26!')).toMatchObject({
    demoRole:'client',
    portal:'client',
  });
  expect(authenticateDemoAccount('organiser@apexops.demo', 'wrong-password')).toBeNull();
  expect(authenticateDemoAccount('anyone@example.test', 'DemoAccess26!')).toBeNull();
});

test('demo portals list only accounts that can sign in through that portal', () => {
  expect(getDemoAccountsForPortal('team').map(account => account.role)).toEqual(['staff','supplier']);
});

test('demo account access maps to separate membership roles', () => {
  expect(getDemoAccess('platform-admin').platformAdmin).toBe(true);
  expect(getDemoAccess('client').memberships[0].role).toBe('client_admin');
  expect(getDemoAccess('operations').memberships[0].role).toBe('ops');
  expect(getDemoAccess('staff').memberships[0].role).toBe('staff');
  expect(getDemoAccess('supplier').memberships[0].role).toBe('delivery');
  expect(getDemoAccess('exhibitor').memberships[0].role).toBe('exhibitor');
});
