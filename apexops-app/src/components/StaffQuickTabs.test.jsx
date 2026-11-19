import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import StaffQuickTabs from './StaffQuickTabs';

test('staff shortcut shows both supplier and department and selects the staff member', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const onSelect = jest.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <StaffQuickTabs
          staff={[{ id:'staff-1', name:'Taylor Example', supplier_name:'Bright Spark', departments:['Electrical'] }]}
          onSelect={onSelect}
          rows={[{ assignedTo:'staff-1' }]}
        />,
      );
    });

    const staffButton = container.querySelector('button[aria-label^="Taylor Example"]');
    expect(staffButton.textContent).toContain('Bright Spark · Electrical');
    expect(staffButton.getAttribute('aria-label')).toContain('Bright Spark · Electrical');

    const picker = container.querySelector('select[aria-label="Select staff member"]');
    expect([...picker.options].map(option => option.textContent)).toContain('Taylor Example · Bright Spark · Electrical');
    await act(async () => {
      picker.value = 'staff-1';
      picker.dispatchEvent(new Event('change', { bubbles:true }));
    });
    expect(onSelect).toHaveBeenCalledWith('staff-1');

    await act(async () => {
      staffButton.click();
    });
    expect(onSelect).toHaveBeenLastCalledWith('staff-1');
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});
