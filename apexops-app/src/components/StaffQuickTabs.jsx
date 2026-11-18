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
}) {
  const countFor = memberId => rows.filter(row => String(row.assignedTo || '') === String(memberId)).length;
  const allCount = rows.length;
  const unassignedCount = rows.filter(row => !row.assignedTo).length;
  return (
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
        const company = member.supplier_name || (member.departments || [member.category]).filter(Boolean).join(', ');
        return <button key={id} type="button" className={String(selectedId) === id ? 'is-selected' : ''} aria-pressed={String(selectedId) === id} aria-label={`${name}${company ? `, ${company}` : ''}, ${countFor(id)} assigned jobs`} onClick={() => onSelect(id)}>
          <span className="staff-quick-avatar">{member.photo_url ? <img src={member.photo_url} alt="" /> : initials(name)}</span>
          <span className="staff-quick-name"><strong>{name}</strong><small>{company || 'No supplier assigned'}</small></span>
          <span className="staff-quick-count">{countFor(id)}</span>
        </button>;
      })}
      {!staff.length && <span className="staff-quick-empty">No staff members yet</span>}
    </nav>
  );
}
