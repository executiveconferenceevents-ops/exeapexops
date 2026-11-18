import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import QueryForm from './QueryForm';

jest.mock('../lib/mock', () => ({
  CATEGORIES:['Electrical'], EST_OPTIONS:['1 hour'], QUERY_PHOTO_LIMIT:3,
  prepareQueryPhoto:jest.fn(),
}));

test('report form submits the selected stand and clears contact details when switching exhibitors', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const originalCrypto=globalThis.crypto;
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{randomUUID:()=> 'test-submission-id'}});
  const submit=jest.fn().mockResolvedValue(undefined);
  const exhibitors=[{name:'First',stand:'A01',contact:'First contact',phone:'111'}, {name:'Second',stand:'B02'}];
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<QueryForm exhibitors={exhibitors} onSubmit={submit} clientMode />);});
    const select=container.querySelector('[aria-label="Exhibitor / Stand"]');
    await act(async()=>{select.value='First';select.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>{select.value='Second';select.dispatchEvent(new Event('change',{bubbles:true}));});
    const button=text=>[...container.querySelectorAll('button')].find(item=>item.textContent.trim()===text);
    await act(async()=>{button('Power').click();});
    await act(async()=>{button('No power').click();});
    await act(async()=>{button('Send to Ops Desk').click();});
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      exhibitor:'Second',stand:'B02',contact:'',phone:'',category:'Electrical',description:'No power',sourceTab:'CLIENT',submissionId:expect.any(String),
    }));
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:originalCrypto});
  }
});