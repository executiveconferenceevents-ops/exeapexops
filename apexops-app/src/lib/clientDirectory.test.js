import { loadClientDirectory } from './clientDirectory';

test('loads client workspaces without requiring the optional account_status column', async () => {
  const clients = [{ id:'client-1', name:'Northstar Events' }];
  const order = jest.fn().mockResolvedValue({ data:clients, error:null });
  const select = jest.fn(fields => ({
    order: sort => {
      if (fields.split(',').map(field => field.trim()).includes('account_status')) {
        return Promise.resolve({ data:null, error:new Error('column clients.account_status does not exist') });
      }
      return order(sort);
    },
  }));
  const database = { from:jest.fn(() => ({ select })) };

  await expect(loadClientDirectory(database)).resolves.toEqual(clients);
  expect(database.from).toHaveBeenCalledWith('clients');
  expect(select).toHaveBeenCalledWith(expect.not.stringContaining('account_status'));
  expect(order).toHaveBeenCalledWith('name');
});
