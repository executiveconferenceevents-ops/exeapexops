import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { getActiveEvent, getAvailableEvents, getEventSlug, getPublicEvents, getUserEventAccess, resolvePublicEvent, setActiveEvent } from './lib/eventScope';
import { supabase } from './lib/supabase';

jest.mock('./lib/demoStore', () => ({ DEMO_MODE:false }));
jest.mock('./lib/supabase', () => ({
  supabase:{
    auth:{
      getSession:jest.fn().mockResolvedValue({ data:{ session:{ user:{ id:'client-user' } } } }),
      onAuthStateChange:jest.fn().mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } }),
      signInWithPassword:jest.fn(),
      signOut:jest.fn().mockResolvedValue({ error:null }),
    },
  },
}));
jest.mock('./lib/eventScope', () => {
  let activeEvent = null;
  return {
    PRIVACY_NOTICE_VERSION:'test',
    getActiveEvent:jest.fn(() => activeEvent),
    setActiveEvent:jest.fn(event => { activeEvent = event; }),
    clearActiveEvent:jest.fn(() => { activeEvent = null; }),
    getEventSlug:jest.fn(() => 'original-event'),
    getAvailableEvents:jest.fn().mockResolvedValue([{ id:'original', client_id:'client', slug:'original-event', name:'Original event' }]),
    getUserEventAccess:jest.fn().mockResolvedValue({ platformAdmin:false, memberships:[{ client_id:'client', event_id:null, role:'client_admin' }] }),
    getPublicEvents:jest.fn().mockResolvedValue([]),
    getEventAccessCode:jest.fn(),
    resolvePublicEvent:jest.fn(),
  };
});
jest.mock('./views/ClientEventAdmin', () => {
  const React = require('react');
  return function MockClientEventAdmin({ onEventCreated, clientWorkspaceOnly }) {
    return React.createElement('div', null,
      React.createElement('span', null, clientWorkspaceOnly ? 'Client workspace fixture' : 'Owner dashboard fixture'),
      React.createElement('button', { onClick:() => onEventCreated({ id:'new-event', client_id:'client', slug:'new-event', name:'New event' }) }, 'Create test event'));
  };
});
jest.mock('./views/OpsPortal', () => {
  const React = require('react');
  return function MockOpsPortal() {
    const { getActiveEvent } = require('./lib/eventScope');
    return React.createElement('div', null, `Operations event: ${getActiveEvent()?.name}`);
  };
});
jest.mock('./views/DeptQueue', () => () => 'Staff queue fixture');
jest.mock('./views/Deliveries', () => () => 'Deliveries fixture');
jest.mock('./views/ExhibitorStatus', () => () => 'Exhibitor status fixture');
jest.mock('./views/StaffSetup', () => () => 'Staff setup fixture');
jest.mock('./views/PeopleSetup', () => () => 'People setup fixture');
jest.mock('./views/ExhibitorSetup', () => () => 'Exhibitor setup fixture');
jest.mock('./views/RebookingForm', () => () => 'Rebooking fixture');
jest.mock('./views/ClientQuery', () => () => 'Client query fixture');
jest.mock('./components/HomeOverview', () => () => 'Home overview fixture');

function buttonWithText(container, text) {
  return [...container.querySelectorAll('button')].find(button => button.textContent.includes(text) || button.getAttribute('aria-label') === text);
}

async function openRolePortal(container, label) {
  const portal = label === 'Operations' ? 'Event Operations' : label === 'Staff' ? 'Staff & Delivery' : 'Client / Organiser';
  await act(async () => { buttonWithText(container, portal).click(); });
}

test.each([true, false])('saved exhibitor access restores only after server validation: %s', async valid => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  window.localStorage.setItem('apexops-exhibitor-pass-v1', JSON.stringify({
    slug:'saved-event', accessCode:'TEST-CODE', stand:'A01', privacyAcknowledgementId:'ack-1',
    privacyNoticeVersion:'test', expiresAt:Date.now()+60000,
  }));
  supabase.auth.getSession.mockResolvedValue({ data:{ session:null } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getPublicEvents.mockResolvedValue([]);
  resolvePublicEvent.mockResolvedValue(valid ? { id:'saved', slug:'saved-event', name:'Saved event', accessCode:'TEST-CODE' } : null);
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<App />);});
    expect(resolvePublicEvent).toHaveBeenCalledWith('saved-event','TEST-CODE',{requireOnline:true});
    if (valid) expect(container.textContent).toContain('Exhibitor status fixture');
    else {
      expect(container.textContent).not.toContain('Exhibitor status fixture');
      expect(window.localStorage.getItem('apexops-exhibitor-pass-v1')).toBeNull();
    }
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    window.localStorage.removeItem('apexops-exhibitor-pass-v1');
    window.history.replaceState({}, '', '/');
  }
});

test('a newly created event becomes the selected Operations workspace', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let activeEvent = null;
  supabase.auth.getSession.mockResolvedValue({ data:{ session:{ user:{ id:'client-user' } } } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getActiveEvent.mockImplementation(() => activeEvent);
  setActiveEvent.mockImplementation(event => { activeEvent = event; });
  getEventSlug.mockReturnValue('original-event');
  getAvailableEvents.mockResolvedValue([{ id:'original', client_id:'client', slug:'original-event', name:'Original event' }]);
  getUserEventAccess.mockResolvedValue({ platformAdmin:false, memberships:[{ client_id:'client', event_id:null, role:'client_admin' }] });
  getPublicEvents.mockResolvedValue([]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  expect(container.textContent).toContain('Client Workspace');

  await act(async () => { buttonWithText(container, 'Client Workspace').click(); });
  await act(async () => { buttonWithText(container, 'Create test event').click(); });
  await act(async () => { buttonWithText(container, 'Home').click(); });

  expect(container.querySelector('#active-event').value).toBe('new-event');
  expect(getActiveEvent().id).toBe('new-event');
  expect(setActiveEvent).toHaveBeenLastCalledWith(expect.objectContaining({ id:'new-event' }));
  await act(async () => { buttonWithText(container, 'Event Operations').click(); });
  expect(container.textContent).toContain('Operations event: New event');
  await act(async () => { root.unmount(); });
  container.remove();
});

test('staff-only members do not see platform or Operations workspaces', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let activeEvent = null;
  supabase.auth.getSession.mockResolvedValue({ data:{ session:{ user:{ id:'staff-user' } } } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getActiveEvent.mockImplementation(() => activeEvent);
  setActiveEvent.mockImplementation(event => { activeEvent = event; });
  getEventSlug.mockReturnValue('original-event');
  getAvailableEvents.mockResolvedValue([{ id:'original', client_id:'client', slug:'original-event', name:'Original event' }]);
  getUserEventAccess.mockResolvedValue({ platformAdmin:false, memberships:[{ client_id:'client', event_id:'original', role:'staff' }] });
  getPublicEvents.mockResolvedValue([]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });

  expect(container.textContent).toContain('My Queue');
  expect(container.textContent).not.toContain('Event Operations');
  expect(container.textContent).not.toContain('Platform Admin');
  expect(container.textContent).not.toContain('Client Workspace');
  await act(async () => { root.unmount(); });
  container.remove();
});

test('platform-admin login opens the admin dashboard without the workspace chooser', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/?admin');
  supabase.auth.getSession.mockResolvedValue({ data:{ session:null } });
  supabase.auth.signInWithPassword.mockResolvedValue({ data:{ session:{ user:{ id:'platform-admin' } } }, error:null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getAvailableEvents.mockResolvedValue([
    { id:'internal-1', client_id:'ece', slug:'internal-event', name:'Internal event', billing_exempt:true },
    { id:'client-1', client_id:'client', slug:'client-event', name:'Client event', billing_exempt:false },
  ]);
  getUserEventAccess.mockResolvedValue({ platformAdmin:true, memberships:[] });
  getPublicEvents.mockResolvedValue([]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(<App />); });
  expect(container.textContent).toContain('Admin sign in');
  const email = container.querySelector('input[aria-label="Work email"]');
  const password = container.querySelector('input[aria-label="Password"]');
  await act(async () => {
    email.value = 'didi@executiveconferenceevents.com';
    email.dispatchEvent(new Event('input', { bubbles:true }));
    password.value = 'test-password';
    password.dispatchEvent(new Event('input', { bubbles:true }));
  });
  await act(async () => { buttonWithText(container, 'Sign in').click(); });

  expect(container.textContent).toContain('Create test event');
  expect(container.textContent).toContain('Owner dashboard fixture');
  expect(container.textContent).not.toContain('Choose your workspace');
  expect(window.location.search).not.toContain('admin');
  await act(async () => { buttonWithText(container, 'Home').click(); });
  const activeEventOptions = [...container.querySelector('#active-event').options].map(option => option.textContent);
  expect(activeEventOptions).toContain('Internal event');
  expect(activeEventOptions).not.toContain('Client event');
  expect(container.textContent).toContain('Event Operations');
  expect(container.textContent).not.toContain('Platform Admin');
  await act(async () => { buttonWithText(container, 'Sign out').click(); });
  expect(window.location.search).not.toContain('admin');
  expect(window.location.search).not.toContain('event');
  expect(container.textContent).toContain('Select your portal.');
  await act(async () => { root.unmount(); });
  container.remove();
  window.history.replaceState({}, '', '/');
});

test('public home provides separate role portals and routes exhibitors to event code access', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  supabase.auth.getSession.mockResolvedValue({ data:{ session:null } });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getPublicEvents.mockResolvedValue([{
    client_name:'Example Organizer', event_name:'Example Expo', slug:'example-expo',
    event_start_date:'2027-05-01', event_end_date:'2027-05-02',
    build_up_start_date:'2027-04-29', build_up_end_date:'2027-04-30',
    breakdown_start_date:'2027-05-03', breakdown_end_date:'2027-05-03', logo_url:'',
  }, {
    client_name:'Second Organizer', event_name:'Second Expo', slug:'second-expo',
    event_start_date:'2027-06-01', event_end_date:'2027-06-02',
    build_up_start_date:'2027-05-30', build_up_end_date:'2027-05-31',
    breakdown_start_date:'2027-06-03', breakdown_end_date:'2027-06-03', logo_url:'',
  }]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(<App />); });
  expect(container.textContent).toContain('Select your portal.');
  expect(container.textContent).toContain('Client / Organiser');
  expect(container.textContent).toContain('Platform Admin');
  expect(container.textContent).toContain('Event Operations');
  expect(container.textContent).toContain('Staff & Delivery');
  expect(container.querySelector('input[aria-label="Work email"]')).toBeNull();
  expect(container.querySelector('input[aria-label="Password"]')).toBeNull();
  expect(container.textContent).toContain('Request a demo');

  await act(async () => { buttonWithText(container, 'Platform Admin').click(); });
  expect(container.textContent).toContain('Admin sign in');
  expect(container.querySelector('.lg-tabs')).toBeNull();
  await act(async () => { buttonWithText(container, 'Back to portal selection').click(); });

  await act(async () => { buttonWithText(container, 'Event Operations').click(); });
  expect(container.textContent).toContain('Operations sign in');
  expect(container.querySelector('.lg-tabs')).toBeNull();
  await act(async () => { buttonWithText(container, 'Back to portal selection').click(); });

  await act(async () => { buttonWithText(container, 'Staff & Delivery').click(); });
  expect(container.textContent).toContain('Staff sign in');
  expect(container.querySelector('.lg-tabs')).toBeNull();
  await act(async () => { buttonWithText(container, 'Back to portal selection').click(); });

  await act(async () => { buttonWithText(container, 'Request a client account').click(); });
  expect(container.textContent).toContain('Request an account');
  expect(container.textContent).toContain('This is an account request only.');
  await act(async () => { buttonWithText(container, 'Back to sign in').click(); });

  await act(async () => { buttonWithText(container, 'Client / Organiser').click(); });
  expect(container.textContent).toContain('Client / Organiser sign in');
  expect(container.querySelector('.lg-tabs')).toBeNull();
  await act(async () => { buttonWithText(container, 'Back to portal selection').click(); });

  await act(async () => { buttonWithText(container, 'Exhibitor access').click(); });
  expect(container.querySelector('.lg-tabs')).toBeNull();
  expect(container.textContent).toContain('Example Expo');
  await act(async () => { buttonWithText(container, 'Example Expo').click(); });
  expect(container.querySelector('#public-event-code')).not.toBeNull();
  expect(window.location.search).toContain('event=example-expo');
  await act(async () => { buttonWithText(container, 'Back to event list').click(); });
  expect(container.textContent).toContain('Choose your event');
  expect(container.querySelector('#public-event-code')).toBeNull();
  expect(window.location.search).not.toContain('event=');
  await act(async () => { buttonWithText(container, 'Second Expo').click(); });
  expect(container.querySelector('#public-event-code')).not.toBeNull();
  expect(window.location.search).toContain('event=second-expo');

  await act(async () => { root.unmount(); });
  container.remove();
  window.history.replaceState({}, '', '/');
});

test('organization client admins enter the Client Workspace before Event Operations', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  supabase.auth.getSession.mockResolvedValue({ data:{ session:null } });
  supabase.auth.signInWithPassword.mockResolvedValue({ data:{ session:{ user:{ id:'client-admin' } } }, error:null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getAvailableEvents.mockResolvedValue([{ id:'client-event', client_id:'client', slug:'client-event', name:'Client event' }]);
  getUserEventAccess.mockResolvedValue({ platformAdmin:false, memberships:[{ client_id:'client', event_id:null, role:'client_admin' }] });
  getPublicEvents.mockResolvedValue([]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(<App />); });
  await act(async () => { buttonWithText(container, 'Client / Organiser').click(); });
  const email = container.querySelector('input[aria-label="Work email"]');
  const password = container.querySelector('input[aria-label="Password"]');
  await act(async () => {
    email.value = 'admin@example.test';
    email.dispatchEvent(new Event('input', { bubbles:true }));
    password.value = 'test-password';
    password.dispatchEvent(new Event('input', { bubbles:true }));
  });
  await act(async () => { buttonWithText(container, 'Sign in').click(); });

  expect(container.textContent).toContain('Create test event');
  expect(container.textContent).not.toContain('Operations event:');
  await act(async () => { root.unmount(); });
  container.remove();
  window.history.replaceState({}, '', '/');
});

test.each([
  ['staff', 'Staff', 'Staff queue fixture'],
  ['ops', 'Operations', 'Operations event: Unified event'],
  ['client_admin', 'Client / Organiser', 'Client workspace fixture'],
])('role-specific %s sign-in routes to the appropriate workspace', async (role, portal, expected) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  let activeEvent = null;
  getActiveEvent.mockImplementation(() => activeEvent);
  setActiveEvent.mockImplementation(event => { activeEvent = event; });
  getEventSlug.mockReturnValue('unified-event');
  supabase.auth.getSession.mockResolvedValue({ data:{ session:null } });
  supabase.auth.signInWithPassword.mockResolvedValue({ data:{ session:{ user:{ id:'unified-user', email:'alex@example.test' } } }, error:null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getAvailableEvents.mockResolvedValue([{ id:'unified-event', client_id:'client', slug:'unified-event', name:'Unified event' }]);
  getUserEventAccess.mockResolvedValue({ platformAdmin:false, memberships:[{ client_id:'client', event_id:role === 'client_admin' ? null : 'unified-event', role }] });
  getPublicEvents.mockResolvedValue([]);
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<App />);});
    if (portal === 'Client / Organiser') await act(async()=>{buttonWithText(container, portal).click();});
    else await openRolePortal(container, portal);
    await act(async()=>{buttonWithText(container, 'Sign in').click();});
    expect(container.textContent).toContain(expected);
    expect(container.textContent).not.toContain('Owner dashboard fixture');
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    window.history.replaceState({}, '', '/');
  }
});

test('event Operations users still enter the Operations workspace', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  let activeEvent = null;
  getActiveEvent.mockImplementation(() => activeEvent);
  setActiveEvent.mockImplementation(event => { activeEvent = event; });
  getEventSlug.mockReturnValue('ops-event');
  supabase.auth.getSession.mockResolvedValue({ data:{ session:null } });
  supabase.auth.signInWithPassword.mockResolvedValue({ data:{ session:{ user:{ id:'ops-user' } } }, error:null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getAvailableEvents.mockResolvedValue([{ id:'ops-event', client_id:'client', slug:'ops-event', name:'Operations event' }]);
  getUserEventAccess.mockResolvedValue({ platformAdmin:false, memberships:[{ client_id:'client', event_id:'ops-event', role:'ops' }] });
  getPublicEvents.mockResolvedValue([]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => { root.render(<App />); });
  await openRolePortal(container, 'Operations');
  const email = container.querySelector('input[aria-label="Work email"]');
  const password = container.querySelector('input[aria-label="Password"]');
  await act(async () => {
    email.value = 'ops@example.test';
    email.dispatchEvent(new Event('input', { bubbles:true }));
    password.value = 'test-password';
    password.dispatchEvent(new Event('input', { bubbles:true }));
  });
  await act(async () => { buttonWithText(container, 'Sign in').click(); });

  expect(container.textContent).toContain('Operations event: Operations event');
  await act(async () => { root.unmount(); });
  container.remove();
  window.history.replaceState({}, '', '/');
});

test.each([
  ['Client / Organiser', 'organisation-wide client administrator access'],
  ['Operations sign in', 'Operations event: Internal event'],
  ['Staff sign in', 'Staff queue fixture'],
])('Platform Owner using %s does not open the owner dashboard', async (entry, expected) => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  let activeEvent = null;
  getActiveEvent.mockImplementation(() => activeEvent);
  setActiveEvent.mockImplementation(event => { activeEvent = event; });
  getEventSlug.mockReturnValue('internal-event');
  supabase.auth.getSession.mockResolvedValue({ data:{ session:null } });
  supabase.auth.signInWithPassword.mockResolvedValue({ data:{ session:{ user:{ id:'platform-admin' } } }, error:null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getAvailableEvents.mockResolvedValue([{ id:'internal', client_id:'ece', slug:'internal-event', name:'Internal event', billing_exempt:true }]);
  getUserEventAccess.mockResolvedValue({ platformAdmin:true, memberships:[] });
  getPublicEvents.mockResolvedValue([]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  if (entry === 'Client / Organiser') await act(async () => { buttonWithText(container, entry).click(); });
  else await openRolePortal(container, entry === 'Operations sign in' ? 'Operations' : 'Staff');
  const email = container.querySelector('input[aria-label="Work email"]');
  const password = container.querySelector('input[aria-label="Password"]');
  await act(async () => {
    email.value = 'owner@example.test';
    email.dispatchEvent(new Event('input', { bubbles:true }));
    password.value = 'test-password';
    password.dispatchEvent(new Event('input', { bubbles:true }));
  });
  await act(async () => { buttonWithText(container, 'Sign in').click(); });
  expect(container.textContent).toContain(expected);
  expect(container.textContent).not.toContain('Owner dashboard fixture');
  expect(container.textContent).not.toContain('Platform Admin');
  await act(async () => { root.unmount(); });
  container.remove();
  window.history.replaceState({}, '', '/');
});

test('a Platform Owner with a client membership enters client-only mode from client sign-in', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  supabase.auth.getSession.mockResolvedValue({ data:{ session:null } });
  supabase.auth.signInWithPassword.mockResolvedValue({ data:{ session:{ user:{ id:'dual-user' } } }, error:null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getAvailableEvents.mockResolvedValue([{ id:'client-event', client_id:'client', slug:'client-event', name:'Client event' }]);
  getUserEventAccess.mockResolvedValue({ platformAdmin:true, memberships:[{ user_id:'dual-user', client_id:'client', event_id:null, role:'client_admin' }] });
  getPublicEvents.mockResolvedValue([]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await act(async () => { buttonWithText(container, 'Client / Organiser').click(); });
  const email = container.querySelector('input[aria-label="Work email"]');
  const password = container.querySelector('input[aria-label="Password"]');
  await act(async () => {
    email.value = 'dual@example.test';
    email.dispatchEvent(new Event('input', { bubbles:true }));
    password.value = 'test-password';
    password.dispatchEvent(new Event('input', { bubbles:true }));
  });
  await act(async () => { buttonWithText(container, 'Sign in').click(); });
  expect(container.textContent).toContain('Client workspace fixture');
  expect(container.textContent).not.toContain('Owner dashboard fixture');
  await act(async () => { root.unmount(); });
  container.remove();
  window.history.replaceState({}, '', '/');
});

test.each([
  ['staff', ['Home','My queue'], ['Event operations','Suppliers & staff','People','Exhibitors','Exhibitor view','Log a query','Rebooking','Events & team']],
  ['ops', ['Home','My queue','Event operations','Suppliers & staff','People','Exhibitors','Exhibitor view','Log a query','Rebooking'], ['Events & team']],
  ['client_admin', ['Home','My queue','Event operations','Suppliers & staff','People','Exhibitors','Exhibitor view','Log a query','Rebooking','Events & team'], []],
])('shared menu exposes only %s role tools and stays visible inside them', async(role, allowed, forbidden)=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  let activeEvent=null;
  getActiveEvent.mockImplementation(()=>activeEvent);
  setActiveEvent.mockImplementation(event=>{activeEvent=event;});
  getEventSlug.mockReturnValue('role-event');
  getAvailableEvents.mockResolvedValue([{id:'role-event',client_id:'client',slug:'role-event',name:'Role event',exhibitor_code:'TEST'}]);
  getUserEventAccess.mockResolvedValue({platformAdmin:false,memberships:[{client_id:'client',event_id:role==='client_admin'?null:'role-event',role}]});
  supabase.auth.getSession.mockResolvedValue({data:{session:{user:{id:'role-user',email:'role@example.test'}}}});
  supabase.auth.onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe:jest.fn()}}});
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<App />);});
    const nav=()=>container.querySelector('nav[aria-label="Main navigation"]');
    const navButton=label=>[...nav().querySelectorAll('button')].find(button=>button.textContent.trim()===label);
    allowed.forEach(label=>expect(navButton(label)).toBeDefined());
    forbidden.forEach(label=>expect(navButton(label)).toBeUndefined());
    expect(navButton('Platform admin')).toBeUndefined();
    const expectedViews={
      'Event operations':'Operations event: Role event','My queue':'Staff queue fixture','Suppliers & staff':'Staff setup fixture',
      'People':'People setup fixture','Exhibitors':'Exhibitor setup fixture','Exhibitor view':'Exhibitor status fixture',
      'Log a query':'Client query fixture','Rebooking':'Rebooking fixture','Events & team':'Client workspace fixture',
    };
    for (const [label, expected] of Object.entries(expectedViews)) {
      if (!allowed.includes(label)) continue;
      await act(async()=>{navButton(label).click();await Promise.resolve();});
      expect(container.textContent).toContain(expected);
      expect(nav()).not.toBeNull();
    }
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    window.history.replaceState({}, '', '/');
  }
});

test('delivery-only users enter deliveries from the Staff & Delivery portal', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, '', '/');
  let activeEvent = null;
  getActiveEvent.mockImplementation(() => activeEvent);
  setActiveEvent.mockImplementation(event => { activeEvent = event; });
  getEventSlug.mockReturnValue('delivery-event');
  supabase.auth.getSession.mockResolvedValue({ data:{ session:null } });
  supabase.auth.signInWithPassword.mockResolvedValue({ data:{ session:{ user:{ id:'delivery-user' } } }, error:null });
  supabase.auth.onAuthStateChange.mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } });
  getAvailableEvents.mockResolvedValue([{ id:'delivery-event', client_id:'client', slug:'delivery-event', name:'Delivery event' }]);
  getUserEventAccess.mockResolvedValue({ platformAdmin:false, memberships:[{ client_id:'client', event_id:'delivery-event', role:'delivery' }] });
  getPublicEvents.mockResolvedValue([]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<App />); });
    await openRolePortal(container, 'Staff');
    await act(async () => { buttonWithText(container, 'Sign in').click(); });
    expect(container.textContent).toContain('Deliveries fixture');
    expect(container.textContent).not.toContain('Event operations');
    expect(container.textContent).not.toContain('Orders & packages');
    expect(container.textContent).not.toContain('My queue');
    expect(buttonWithText(container, 'Home')).toBeUndefined();
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    window.history.replaceState({}, '', '/');
  }
});