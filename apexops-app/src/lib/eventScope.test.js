import { getUserEventAccess, resolvePublicEvent } from './eventScope';
import { supabase } from './supabase';
import { getCacheRecord } from './offlineDb';

jest.mock('./demoStore', () => ({ DEMO_MODE:false }));
jest.mock('./offlineDb', () => ({ getCacheRecord:jest.fn().mockResolvedValue(null), saveCacheRecord:jest.fn().mockResolvedValue(undefined) }));
jest.mock('./supabase', () => ({ supabase:{ rpc:jest.fn(), from:jest.fn() } }));

test('workspace access reads only the signed-in user memberships', async () => {
  const memberships = [{ client_id:'client-1', event_id:null, role:'client_admin' }];
  const filter = jest.fn().mockResolvedValue({ data:memberships, error:null });
  supabase.from.mockReturnValue({ select:jest.fn().mockReturnValue({ eq:filter }) });
  supabase.rpc.mockResolvedValue({ data:true, error:null });

  const result = await getUserEventAccess('owner-id');

  expect(supabase.from).toHaveBeenCalledWith('client_event_memberships');
  expect(filter).toHaveBeenCalledWith('user_id', 'owner-id');
  expect(result).toEqual({ platformAdmin:true, memberships });
});

test('remembered exhibitor access requires a live event verification', async () => {
  getCacheRecord.mockResolvedValue({ value:{ id:'cached-event' } });
  supabase.rpc.mockResolvedValue({ data:null, error:new Error('Failed to fetch') });
  await expect(resolvePublicEvent('example-event', 'CODE', { requireOnline:true })).rejects.toThrow('Failed to fetch');
  expect(getCacheRecord).not.toHaveBeenCalled();
  expect(supabase.rpc).toHaveBeenCalledWith('get_public_event', { requested_slug:'example-event', requested_code:'CODE' });
});