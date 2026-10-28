import './shell.css';

export function AppShell({ eventName, badge, nav = [], onSignOut, topActions, children }) {
  return (
    <div className="shell">
      <header className="shell-top">
        <div className="shell-brand">APEXOPS<sup>™</sup><small>Event Management Platform</small></div>
        <div className="shell-top-right">
          {eventName && <span className="shell-event" title={eventName}>{eventName}</span>}
          {topActions}
          {onSignOut && <button type="button" className="shell-ghost" onClick={onSignOut}>Sign out</button>}
        </div>
      </header>
      <div className="shell-body">
        <nav className="shell-nav" aria-label="Main navigation">
          {nav.map(({ key, label, Icon, onClick, active, disabled }) => (
            <button key={key} type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClick} disabled={disabled}>
              {Icon && <Icon size={18} strokeWidth={1.8} aria-hidden="true" />}<span>{label}</span>
            </button>
          ))}
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export function StatusBadge({ icon: Icon, children }) {
  return <span className="shell-badge">{Icon && <Icon size={14} aria-hidden="true" />}{children}</span>;
}

export function ServiceCard({ icon: Icon, eyebrow, title, description, onClick, disabled }) {
  return (
    <button type="button" className="svc-card" onClick={onClick} disabled={disabled}>
      <span className="svc-icon">{Icon && <Icon size={22} strokeWidth={1.8} aria-hidden="true" />}</span>
      <span>
        {eyebrow && <span className="svc-eyebrow">{eyebrow}</span>}
        <span className="svc-title">{title}</span>
        <span className="svc-desc">{description}</span>
      </span>
    </button>
  );
}
