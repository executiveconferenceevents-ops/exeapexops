import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import HomeOverview from './HomeOverview';
import { getQueries } from '../lib/mock';

jest.mock('../lib/mock', () => ({ getQueries:jest.fn() }));

test('Home shows event counts and attention items from loaded jobs', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const now=Date.now();
  getQueries.mockResolvedValue([
    {id:'late',status:'IN PROGRESS',stand:'A01',category:'Electrical',description:'No power',assignedTo:'staff-1',loggedAt:new Date(now-7200000),slaDeadline:new Date(now-3600000)},
    {id:'open',status:'LOGGED',stand:'A02',category:'Furniture',description:'Missing chair',loggedAt:new Date(now-1800000)},
    {id:'escalated',status:'ESCALATED',stand:'A03',category:'Electrical',description:'Power tripping',assignedTo:'staff-1',loggedAt:new Date(now-600000)},
    {id:'done',status:'COMPLETED',stand:'A04',category:'Electrical',description:'Completed',loggedAt:new Date(now-600000),completedAt:new Date(now)},
  ]);
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  const onOpenOps=jest.fn();
  try {
    await act(async()=>{root.render(<HomeOverview eventId="event-1" onOpenOps={onOpenOps} />);});
    const stats=[...container.querySelectorAll('.ho-stat')].map(item=>item.textContent.replace(/\s+/g,' '));
    expect(stats[0]).toContain('Open jobs3');
    expect(stats[1]).toContain('Overdue1');
    expect(stats[2]).toContain('Done today1');
    expect(stats[3]).toContain('Escalated or delayed1');
    expect(container.textContent).toContain('Needs your attention.');
    expect(container.textContent).toContain('Stand A01');
    expect(container.textContent).toContain('Stand A02');
    expect(container.textContent).toContain('Stand A03');
    const unassigned=[...container.querySelectorAll('.ho-list li')].find(item=>item.textContent.includes('Stand A02'));
    await act(async()=>{unassigned.querySelector('button').click();});
    expect(onOpenOps).toHaveBeenCalledWith('open');
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
  }
});

test('Home does not present zero counts when jobs cannot be loaded', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  getQueries.mockRejectedValue(new Error('Could not load jobs'));
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<HomeOverview eventId="event-1" onOpenOps={jest.fn()} />);});
    expect(container.textContent).toContain('Could not load jobs');
    expect(container.textContent).toContain('Job details are unavailable.');
    expect([...container.querySelectorAll('.ho-stat strong')].map(item=>item.textContent)).toEqual(['–','–','–','–']);
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
  }
});