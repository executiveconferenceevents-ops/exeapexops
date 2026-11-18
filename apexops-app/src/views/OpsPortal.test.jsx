import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import OpsPortal from './OpsPortal';
import { getExhibitors, getOpsNotifications, getQueries, getRebookingRequests, getStaff, markOpsNotificationRead } from '../lib/mock';

jest.mock('../lib/supabase', () => ({ supabase:null }));
jest.mock('../lib/eventScope', () => ({ getActiveEvent:()=>({id:'event-1',name:'Northstar Expo'}) }));
jest.mock('../lib/mock', () => ({
  CATEGORIES:['Electrical','Organiser'],
  STATUS_COLORS:{LOGGED:{badge:'#406880'}},
  STATUS_FLOW:['LOGGED','IN PROGRESS','COMPLETED'],
  addQuery:jest.fn(),
  getExhibitors:jest.fn().mockResolvedValue([]),
  getOpsNotifications:jest.fn(),
  getQueries:jest.fn().mockResolvedValue([]),
  getRebookingRequests:jest.fn(()=>Promise.resolve([])),
  getStaff:jest.fn().mockResolvedValue([]),
  markOpsNotificationRead:jest.fn().mockResolvedValue(undefined),
  readableError:(error,fallback)=>error?.message||fallback,
  updateQuery:jest.fn(),
}));

function buttonWithText(container, text) {
  const button=[...container.querySelectorAll('button')].find(item=>item.textContent.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

test('organizer can mark an event notification read without removing it', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  getExhibitors.mockResolvedValue([]);
  getQueries.mockResolvedValue([]);
  getRebookingRequests.mockResolvedValue([]);
  getStaff.mockResolvedValue([]);
  getOpsNotifications.mockResolvedValue([{
    id:'notification-1',event_id:'event-1',kind:'CLIENT_QUERY',title:'New client query',
    message:'Northstar Events · Stand A01 · Electrical',created_at:new Date().toISOString(),read_at:null,
  }]);
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<OpsPortal />);});
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    await act(async()=>{buttonWithText(container,'Notifications').click();});
    expect(container.textContent).toContain('New client query');
    expect(container.textContent).toContain('Northstar Events · Stand A01 · Electrical');
    const markRead=container.querySelector('button[title="Mark as read"]');
    expect(markRead).not.toBeNull();
    await act(async()=>{markRead.click();await Promise.resolve();});
    expect(markOpsNotificationRead).toHaveBeenCalledWith('notification-1');
    expect(container.querySelector('button[title="Mark as read"]')).toBeNull();
    expect(container.textContent).toContain('New client query');
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
  }
});