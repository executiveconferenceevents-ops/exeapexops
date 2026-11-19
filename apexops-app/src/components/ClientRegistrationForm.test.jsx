import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClientRegistrationForm from './ClientRegistrationForm';
import { supabase } from '../lib/supabase';

jest.mock('../lib/supabase',()=>({supabase:{functions:{invoke:jest.fn()}}}));

function setInputValue(input,value) {
  const setter=Object.getOwnPropertyDescriptor(input.constructor.prototype,'value').set;
  setter.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
}

test('client registration submits an acknowledged, idempotent request and grants no immediate access',async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const originalCrypto=window.crypto;
  Object.defineProperty(window,'crypto',{configurable:true,value:{getRandomValues:bytes=>{bytes.fill(3);return bytes;}}});
  supabase.functions.invoke.mockResolvedValue({data:{submissionId:'submission-1',message:'Request received.'},error:null});
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<ClientRegistrationForm onBack={jest.fn()}/>);});
    const form=container.querySelector('form');
    const inputs=[...form.querySelectorAll('input')];
    setInputValue(inputs[0],'Northstar Events Ltd');
    setInputValue(inputs[1],'2026/123456/07');
    setInputValue(inputs[2],'Alex Example');
    setInputValue(inputs[3],'alex@example.test');
    setInputValue(inputs[4],'billing@example.test');
    setInputValue(inputs[5],'021 555 0100');
    await act(async()=>{inputs[6].click();});
    await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    expect(supabase.functions.invoke).toHaveBeenCalledWith('register-client',expect.objectContaining({body:expect.objectContaining({
      businessName:'Northstar Events Ltd',primaryContactEmail:'alex@example.test',acknowledged:true,
      registrationRequestId:expect.stringMatching(/^[0-9a-f-]{36}$/),
    })}));
    expect(container.textContent).toContain('Request received');
    expect(container.textContent).toContain('does not create access');
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    Object.defineProperty(window,'crypto',{configurable:true,value:originalCrypto});
  }
});
