import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ExhibitorStatus from './ExhibitorStatus';
import { escalatePublicQuery, getPublicExhibitors, getPublicStatus, submitClientQuery } from '../lib/mock';

jest.mock('../lib/mock', () => ({
  escalatePublicQuery:jest.fn(),
  getPublicExhibitors:jest.fn(),
  getPublicStatus:jest.fn(),
  normalizeStand:value=>String(value||'').trim().toUpperCase().replace(/^([A-Z])(\d)$/,(_,letter,digit)=>`${letter}0${digit}`),
  readableError:(error,fallback)=>error?.message||fallback,
  STATUS_COLORS:{LOGGED:{badge:'#406880'},ESCALATED:{badge:'#ad802b'},COMPLETED:{badge:'#337a67'}},
  submitClientQuery:jest.fn(),
}));
jest.mock('../components/PhotoGallery', () => () => null);
jest.mock('../lib/format', () => ({ formatDateTime:()=> '17 Nov, 10:00' }));
jest.mock('../components/QueryForm', () => props => {
  const React = require('react');
  return React.createElement('button', {
    type:'button',
    onClick:()=>props.onSubmit({ ...props.initialValues, category:'Electrical', description:'No power' }),
  }, 'Submit test query');
});

function buttonWithText(container, text) {
  const button=[...container.querySelectorAll('button')].find(item=>item.textContent.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

function setInputValue(input, value) {
  const setter=Object.getOwnPropertyDescriptor(input.constructor.prototype,'value').set;
  setter.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
}

test('exhibitor can find a stand, submit a query, and escalate it', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const loggedQuery={id:'Q-101',stand:'A01',exhibitor:'Northstar Events',status:'LOGGED',category:'Electrical',description:'No power',loggedAt:'2026-11-17T10:00:00Z'};
  const escalatedQuery={...loggedQuery,status:'ESCALATED'};
  getPublicExhibitors.mockResolvedValue([{stand:'A01',name:'Northstar Events'}]);
  getPublicStatus.mockResolvedValueOnce([loggedQuery]).mockResolvedValueOnce([loggedQuery]).mockResolvedValueOnce([escalatedQuery]);
  submitClientQuery.mockResolvedValue({query:loggedQuery,duplicate:false,queued:false});
  escalatePublicQuery.mockResolvedValue('Q-101');

  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<ExhibitorStatus />);});
    await act(async()=>{await Promise.resolve();});
    setInputValue(container.querySelector('input[aria-label="Stand number"]'),'a1');
    await act(async()=>{buttonWithText(container,'Show my status').click();});
    expect(getPublicStatus).toHaveBeenNthCalledWith(1,'A01');
    expect(container.textContent).toContain('Northstar Events');
    expect(container.textContent).toContain('Q-101');

    await act(async()=>{buttonWithText(container,'Report a problem').click();});
    await act(async()=>{buttonWithText(container,'Submit test query').click();});
    expect(submitClientQuery).toHaveBeenCalledWith(expect.objectContaining({stand:'A01',exhibitor:'Northstar Events',category:'Electrical',description:'No power',sourceTab:'CLIENT'}));
    expect(container.textContent).toContain('Sent. Your reference is Q-101.');

    await act(async()=>{buttonWithText(container,'Still waiting? Escalate to Ops Desk').click();});
    setInputValue(container.querySelector('textarea'), 'Power has been unavailable since setup.');
    await act(async()=>{buttonWithText(container,'Escalate now').click();});
    expect(escalatePublicQuery).toHaveBeenCalledWith({queryId:'Q-101',stand:'A01',message:'Power has been unavailable since setup.'});
    expect(container.textContent).toContain('Q-101 was escalated to the Ops Desk.');
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
  }
});