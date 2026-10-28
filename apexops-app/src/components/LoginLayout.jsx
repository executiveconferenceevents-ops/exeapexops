import './login.css';
import { CheckCircle2 } from 'lucide-react';

export default function LoginLayout({ title, accent, subtitle, bullets, children, onAdmin }) {
  return (
    <div className="lg-page">
      <aside className="lg-brand">
        <div className="lg-brand-top">APEXOPS<sup>™</sup><span>by Executive Conference Events</span></div>
        <div className="lg-brand-body">
          <h1>{title}<em>{accent}</em></h1>
          <p>{subtitle}</p>
          {bullets && <ul>{bullets.map(item => <li key={item}><CheckCircle2 size={18} aria-hidden="true" /> {item}</li>)}</ul>}
        </div>
        <div className="lg-brand-foot">APEXOPS™ © 2026 Executive Conference Events (Pty) Ltd · All rights reserved</div>
      </aside>
      <main className="lg-main">
        <div className="lg-card">{children}</div>
        {onAdmin && <button type="button" className="lg-admin" onClick={onAdmin}>Admin</button>}
      </main>
    </div>
  );
}
