import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import DeptQueue from './DeptQueue';
import { getExhibitors, getQueries, getStaff, updateQuery } from '../lib/mock';

jest.mock('../lib/supabase', () => ({ supabase:null }));
jest.mock('../lib/demoStore', () => ({ DEMO_MODE:true }));
jest.mock('../lib/eventScope', () => ({ getActiveEventId:()=> 'event-1' }));
jest.mock('../lib/mock', () => ({
  getExhibitors:jest.fn(), getQueries:jest.fn(), getStaff:jest.fn(), updateQuery:jest.fn(),
  normalizeStand:value=>String(value || '').toUpperCase(),
}));
jest.mock('../components/PhotoGallery', () => () => null);
jest.mock('../components/EvidenceUploader', () => () => null);
jest.mock('../lib/format', () => ({ formatDateTime:()=> '17 Nov, 10:00' }));

test('staff can start and complete an assigned job, then undo', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  let queries=[{id:'Q-101',assignedTo:'staff-1',stand:'A01',exhibitor:'Example',status:'ASSIGNED',category:'Electrical',description:'No power',loggedAt:'2026-11-17T10:00:00Z'}];
  getQueries.mockImplementation(async()=>queries);
  getExhibitors.mockResolvedValue([]);
  getStaff.mockResolvedValue([{id:'staff-1',name:'Alex Example',departments:['Electrical']}]);
  updateQuery.mockImplementation(async(id,patch)=>{queries=queries.map(query=>query.id===id?{...query,...patch}:query);return queries[0];});
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<DeptQueue />);});
    const picker=container.querySelector('select[aria-label="Choose staff member"]');
    await act(async()=>{picker.value='staff-1';picker.dispatchEvent(new Event('change',{bubbles:true}));});
    const button=text=>[...container.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
    await act(async()=>{button('Start').click();});
    expect(updateQuery).toHaveBeenLastCalledWith('Q-101',expect.objectContaining({status:'IN PROGRESS'}));
    await act(async()=>{button('Done').click();});
    expect(updateQuery).toHaveBeenLastCalledWith('Q-101',expect.objectContaining({status:'COMPLETED',completedAt:expect.any(Date)}));
    await act(async()=>{button('Undo').click();});
    expect(updateQuery).toHaveBeenLastCalledWith('Q-101',expect.objectContaining({status:'IN PROGRESS',completedAt:null}));
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
  }
});