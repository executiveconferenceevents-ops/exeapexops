// ─── APEXOPS app frame (approved "Look & Feel" design) ────────────────────────
// One frame for every signed-in page: left menu with the wordmark, event chip and
// user, plus a calm content area. Same exports and props as before, so existing
// screens keep working; new optional props add the finishing touches:
//   AppShell: eventMeta, userLabel, userRole, topActions, wide (full-width pages), onEventClick
//   PageHeader: eyebrow, accent (gold italic words after the title)
//   ServiceCard: cta (defaults to "Open")
import { ArrowLeft, ArrowRight, LogOut } from 'lucide-react';
import './shell.css';

export function Wordmark({ dark = false, byline = true }) {
  return (
    <span className={`ax-wordmark${dark ? ' is-dark' : ''}`}>
      <span className="ax-wordmark-name">APEXOPS<sup>™</sup></span>
      {byline && <span className="ax-wordmark-by">by Executive Conference Events</span>}
    </span>
  );
}

function initials(value) {
  return String(value || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export function AppShell({ eventName, eventMeta, badge, nav = [], onSignOut, onBack, backLabel = 'Back to dashboard', topActions, userLabel, userRole, wide = false, onEventClick, children }) {  // [APEX look 2] wide, onEventClick
  return (
    <div className="shell">
      <aside className="shell-side">
        <div className="shell-side-brand"><Wordmark byline={false} /><span className="ax-eyebrow">by Executive Conference Events</span></div>
        {eventName && (
          <button type="button" className="shell-event-chip" title={onEventClick ? 'Change event' : eventName} onClick={onEventClick} disabled={!onEventClick}>
            <span className="shell-event-mark" aria-hidden="true">{initials(eventName).slice(0, 3)}</span>
            <span className="shell-event-text"><strong>{eventName}</strong>{eventMeta && <small>{eventMeta}</small>}</span>
          </button>
        )}
        <nav className="shell-nav" aria-label="Main navigation">
          {nav.map(({ key, label, Icon, onClick, active, disabled, count }) => (
            <button key={key} type="button" className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onClick} disabled={disabled}>
              {Icon && <Icon size={18} strokeWidth={1.6} aria-hidden="true" />}<span>{label}</span>
              {count ? <span className="shell-count">{count}</span> : null}
            </button>
          ))}
        </nav>
        {(userLabel || onSignOut) && (
          <div className="shell-user">
            {userLabel && <span className="shell-avatar" aria-hidden="true">{initials(userLabel)}</span>}
            <span className="shell-user-text">{userLabel && <strong>{userLabel}</strong>}{userRole && <small>{userRole}</small>}</span>
            {onSignOut && <button type="button" className="shell-signout" onClick={onSignOut} aria-label="Sign out" title="Sign out"><LogOut size={18} strokeWidth={1.6} /></button>}
          </div>
        )}
      </aside>
      <div className="shell-content">
        {(onBack || topActions || badge) && <header className="shell-top">
          {onBack && <button type="button" className="shell-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />{backLabel}</button>}
          {badge}{topActions}
        </header>}
        <main className={`shell-main${wide ? ' is-wide' : ''}`}>{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, accent, subtitle, eyebrow }) {
  return (
    <div className="page-header">
      {eyebrow && <div className="ax-eyebrow">{eyebrow}</div>}
      <h1>{title}{accent && <> <em>{accent}</em></>}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export function StatusBadge({ icon: Icon, children }) {
  return <span className="shell-badge">{Icon && <Icon size={14} aria-hidden="true" />}{children}</span>;
}

export function ServiceCard({ icon: Icon, eyebrow, title, description, onClick, disabled, cta = 'Open' }) {
  return (
    <button type="button" className="svc-card" onClick={onClick} disabled={disabled}>
      <span className="svc-icon">{Icon && <Icon size={22} strokeWidth={1.5} aria-hidden="true" />}</span>
      <span className="svc-body">
        {eyebrow && <span className="svc-eyebrow">{eyebrow}</span>}
        <span className="svc-title">{title}</span>
        <span className="svc-desc">{description}</span>
      </span>
      <span className="svc-cta">{cta} <ArrowRight size={16} aria-hidden="true" /></span>
    </button>
  );
}
