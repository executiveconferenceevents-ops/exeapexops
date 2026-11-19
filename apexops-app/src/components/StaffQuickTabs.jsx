import './StaffQuickTabs.css';

function initials(name) {
  return String(name || '?').trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
}

export default function StaffQuickTabs({
  staff = [],
  selectedId = 'ALL',
  onSelect,
  rows = [],
  showAll = true,
  showUnassigned = false,
  variant = 'light',
  label = 'Filter by staff member',
  allLabel = 'All staff',
  selectLabel = 'Select staff member',
}) {
  const countFor = memberId => rows.filter(row => String(row.assignedTo || '') === String(memberId)).length;
  const allCount = rows.length;
  const unassignedCount = rows.filter(row => !row.assignedTo).length;
  return (
    <div className={`staff-quick-controls staff-quick-controls--${variant}`}>
      <label className="staff-quick-picker">
        <span>{selectLabel}</span>
        <select value={selectedId} onChange={event => onSelect(event.target.value)} aria-label={selectLabel}>
          {!showAll && !showUnassigned && <option value="">Choose staff member…</option>}
          {showAll && <option value="ALL">{allLabel}</option>}
          {showUnassigned && <option value="UNASSIGNED">Unassigned ({unassignedCount})</option>}
          {staff.map(member => {
            const name = member.name || 'Unnamed staff';
            const departments = (Array.isArray(member.departments) ? member.departments : [member.category]).filter(Boolean);
            const context = [member.supplier_name, ...departments].filter(Boolean).join(' · ');
            return <option key={member.id} value={String(member.id)}>{[name, context].filter(Boolean).join(' · ')}</option>;
          })}
        </select>
      </label>
      <nav className={`staff-quick-tabs staff-quick-tabs--${variant}`} aria-label={label}>
        {showAll && <button type="button" className={selectedId === 'ALL' ? 'is-selected' : ''} aria-pressed={selectedId === 'ALL'} onClick={() => onSelect('ALL')}>
          <span className="staff-quick-count">{allCount}</span><span>{allLabel}</span>
        </button>}
        {showUnassigned && <button type="button" className={selectedId === 'UNASSIGNED' ? 'is-selected' : ''} aria-pressed={selectedId === 'UNASSIGNED'} onClick={() => onSelect('UNASSIGNED')}>
          <span className="staff-quick-count">{unassignedCount}</span><span>Unassigned</span>
        </button>}
        {staff.map(member => {
          const id = String(member.id);
          const name = member.name || 'Unnamed staff';
          const departments = (Array.isArray(member.departments) ? member.departments : [member.category]).filter(Boolean);
          const context = [member.supplier_name, ...departments].filter(Boolean).join(' · ') || 'No supplier assigned';
          return <button key={id} type="button" className={String(selectedId) === id ? 'is-selected' : ''} aria-pressed={String(selectedId) === id} aria-label={`${name}, ${context}, ${countFor(id)} assigned jobs`} onClick={() => onSelect(id)}>
            <span className="staff-quick-avatar">{member.photo_url ? <img src={member.photo_url} alt="" /> : initials(name)}</span>
            <span className="staff-quick-name"><strong>{name}</strong><small>{context}</small></span>
            <span className="staff-quick-count">{countFor(id)}</span>
          </button>;
        })}
        {!staff.length && <span className="staff-quick-empty">No staff members yet</span>}
      </nav>
    </div>
  );
}
