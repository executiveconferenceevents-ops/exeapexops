import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import OpsBoard from './OpsBoard';

jest.mock('../lib/mock', () => ({ CATEGORIES:['Electrical'] }));

test('Ops board groups jobs and sends assignment and status changes to the existing handler', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const rows=[
    {id:'new-1',stand:'A01',exhibitor:'Example',category:'Electrical',status:'LOGGED',description:'No power'},
    {id:'assigned-1',stand:'A02',exhibitor:'Example',category:'Electrical',status:'ASSIGNED',assignedTo:'staff-1',description:'Power point'},
    {id:'busy-1',stand:'A03',exhibitor:'Example',category:'Electrical',status:'IN PROGRESS',assignedTo:'staff-1',description:'Power tripping'},
  ];
  const onPatch=jest.fn();
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<OpsBoard rows={rows} staff={[{id:'staff-1',name:'Alex',departments:['Electrical']}]} onOpen={jest.fn()} onPatch={onPatch} isOverdue={()=>false} />);});
    expect(container.textContent).toContain('Needs assigning');
    expect(container.textContent).toContain('Done today');
    const assign=container.querySelector('[aria-label="Assign stand A01"]');
    await act(async()=>{assign.value='staff-1';assign.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(onPatch).toHaveBeenCalledWith('new-1',{assignedTo:'staff-1',status:'ASSIGNED'});
    const button=text=>[...container.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
    await act(async()=>{button('Start').click();});
    expect(onPatch).toHaveBeenCalledWith('assigned-1',{status:'IN PROGRESS',completedAt:null});
    await act(async()=>{button('Done').click();});
    expect(onPatch).toHaveBeenCalledWith('busy-1',{status:'COMPLETED',completedAt:expect.any(Date)});
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
  }
});