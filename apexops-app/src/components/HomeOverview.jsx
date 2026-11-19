// ─── Home: today's numbers + "Needs your attention" ──────────────────────────
// Shown on the organiser / operations Home page for the selected event.
// Reads the same live jobs as the Ops board (getQueries) and refreshes every 30 s
// while the page is visible. Nothing here changes data.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, LayoutGrid, Siren, UserPlus } from 'lucide-react';
import { getQueries } from '../lib/mock';
import { categoryVisual } from '../lib/categoryIcons';
import './HomeOverview.css';

function minutesSince(value) {
  return value ? Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000)) : 0;
}
function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return h < 24 ? `${h}h ${minutes % 60}m` : `${Math.floor(h / 24)}d`;
}
function isSameDay(value) {
  return value && new Date(value).toDateString() === new Date().toDateString();
}
function isOverdue(q) {
  return q.status !== 'COMPLETED' && q.slaDeadline && new Date(q.slaDeadline) < new Date();
}

export default function HomeOverview({ eventId, onOpenOps }) {
  const [queries, setQueries] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timer;
    const load = async () => {
      if (document.hidden) return;
      try {
        const rows = await getQueries();
        if (!cancelled) { setQueries(rows); setError(''); }
      } catch (loadError) {
        if (!cancelled) setError(loadError?.message || 'Live numbers are not available right now.');
      }
    };
    load();
    timer = window.setInterval(load, 30000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [eventId]);

  const stats = useMemo(() => {
    const rows = queries || [];
    const open = rows.filter(q => q.status !== 'COMPLETED');
    const unassigned = open.filter(q => !q.assignedTo);
    const overdue = open.filter(isOverdue).sort((a, b) => new Date(a.slaDeadline) - new Date(b.slaDeadline));
    const escalated = open.filter(q => q.status === 'ESCALATED' || q.status === 'ISSUES/DELAYED');
    const doneToday = rows.filter(q => q.status === 'COMPLETED' && isSameDay(q.completedAt || q.updatedAt));
    const fixTimes = doneToday.filter(q => q.completedAt && q.loggedAt).map(q => (new Date(q.completedAt) - new Date(q.loggedAt)) / 60000).filter(n => n >= 0);
    const avgFix = fixTimes.length ? Math.round(fixTimes.reduce((s, n) => s + n, 0) / fixTimes.length) : null;

    const seen = new Set();
    const attention = [];
    const push = (q, kind) => { if (!seen.has(q.id)) { seen.add(q.id); attention.push({ q, kind }); } };
    overdue.forEach(q => push(q, 'overdue'));
    escalated.forEach(q => push(q, 'escalated'));
    [...unassigned].sort((a, b) => new Date(a.loggedAt) - new Date(b.loggedAt)).forEach(q => push(q, 'unassigned'));

    return { open, unassigned, overdue, escalated, doneToday, avgFix, attention: attention.slice(0, 6), attentionTotal: attention.length };
  }, [queries]);

  const loading = queries === null && !error;
  const unavailable = queries === null;
  const oldest = stats.overdue[0];

  return (
    <section className="ho" aria-label="Today at a glance">
      {error && <div className="shell-alert" role="alert">{error}</div>}

      <div className="ho-stats">
        <Stat icon={LayoutGrid} label="Open jobs" value={unavailable ? '–' : stats.open.length}
          sub={unavailable ? (loading ? 'Loading…' : 'Unavailable') : stats.unassigned.length ? `${stats.unassigned.length} need assigning` : 'All assigned'} />
        <Stat icon={Clock} label="Overdue" value={unavailable ? '–' : stats.overdue.length}
          sub={unavailable ? '' : oldest ? `Oldest: ${duration(minutesSince(oldest.slaDeadline))} late · Stand ${oldest.stand}` : 'Nothing late'} />
        <Stat icon={CheckCircle2} label="Done today" value={unavailable ? '–' : stats.doneToday.length}
          sub={unavailable ? '' : stats.avgFix !== null ? `Avg. ${duration(stats.avgFix)} to fix` : 'No jobs closed yet'} />
        <Stat icon={Siren} label="Escalated or delayed" value={unavailable ? '–' : stats.escalated.length}
          sub={unavailable ? '' : stats.escalated.length ? 'Needs a decision' : 'None'} />
      </div>

      <div className="ho-attention">
        <div className="ho-attention-head">
          <h2>Needs your <em>attention.</em></h2>
          {stats.attentionTotal > 0 && <span className="ho-count">{stats.attentionTotal}</span>}
        </div>
        {loading ? <p className="ho-empty">Loading live jobs…</p>
          : unavailable ? <p className="ho-empty">Job details are unavailable.</p>
          : !stats.attention.length ? <p className="ho-empty"><CheckCircle2 size={18} strokeWidth={1.6} aria-hidden="true" /> All clear. Nothing needs you right now.</p>
          : <ul className="ho-list">
            {stats.attention.map(({ q, kind }) => {
              const { Icon, tone, short } = categoryVisual(q.category);
              const meta = kind === 'overdue' ? `${short} · overdue ${duration(minutesSince(q.slaDeadline))}`
                : kind === 'escalated' ? `${short} · ${q.status === 'ESCALATED' ? 'escalated' : 'delayed'}`
                  : `${short} · unassigned · ${duration(minutesSince(q.loggedAt))}`;
              const KindIcon = kind === 'overdue' ? Clock : kind === 'escalated' ? AlertTriangle : UserPlus;
              return (
                <li key={q.id}>
                  <span className={`ho-tile ho-tone--${tone}`}><Icon size={20} strokeWidth={1.6} aria-hidden="true" /></span>
                  <span className="ho-text"><strong>Stand {q.stand} · {q.description}</strong><small><KindIcon size={13} aria-hidden="true" /> {meta}</small></span>
                  <button type="button" className="shell-secondary ho-btn" onClick={()=>onOpenOps(q.id)}>{kind === 'unassigned' ? 'Assign' : 'Open'}</button>
                </li>
              );
            })}
          </ul>}
        {stats.attentionTotal > stats.attention.length && <button type="button" className="ho-more" onClick={()=>onOpenOps()}>See all {stats.attentionTotal} on the Ops board <ArrowRight size={15} aria-hidden="true" /></button>}
      </div>
    </section>
  );
}

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="ho-stat">
      <div className="ho-stat-top"><span>{label}</span><span className="ho-stat-icon"><Icon size={18} strokeWidth={1.5} aria-hidden="true" /></span></div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
