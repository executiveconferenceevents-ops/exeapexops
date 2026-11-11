import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { getActiveEvent, getAvailableEvents, getEventSlug, getPublicEvents, getUserEventAccess, setActiveEvent } from './lib/eventScope';
import { supabase } from './lib/supabase';

jest.mock('./lib/demoStore', () => ({ DEMO_MODE:false }));
jest.mock('./lib/supabase', () => ({
  supabase:{
    auth:{
      getSession:jest.fn().mockResolvedValue({ data:{ session:{ user:{ id:'client-user' } } } }),
      onAuthStateChange:jest.fn().mockReturnValue({ data:{ subscription:{ unsubscribe:jest.fn() } } }),
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
  return function MockClientEventAdmin({ onEventCreated }) {
    return React.createElement('button', { onClick:() => onEventCreated({ id:'new-event', client_id:'client', slug:'new-event', name:'New event' }) }, 'Create test event');
  };
});
jest.mock('./views/OpsPortal', () => {
  const React = require('react');
  return function MockOpsPortal() {
    const { getActiveEvent } = require('./lib/eventScope');
    return React.createElement('div', null, `Operations event: ${getActiveEvent()?.name}`);
  };
});
jest.mock('./views/DeptQueue', () => () => null);
jest.mock('./views/ExhibitorStatus', () => () => null);
jest.mock('./views/StaffSetup', () => () => null);
jest.mock('./views/PeopleSetup', () => () => null);
jest.mock('./views/ExhibitorSetup', () => () => null);
jest.mock('./views/RebookingForm', () => () => null);
jest.mock('./views/ClientQuery', () => () => null);

function buttonWithText(container, text) {
  return [...container.querySelectorAll('button')].find(button => button.textContent.includes(text));
}

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
  await act(async () => { buttonWithText(container, 'Back to workspace').click(); });

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