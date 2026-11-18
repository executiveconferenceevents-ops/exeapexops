// ─── Exhibitor status (public, code-protected) ────────────────────────────────
// Visual tracker: Received → Assigned → Being fixed → Done.
// The stand is remembered on this phone, so returning exhibitors land straight
// on their live status. All styling lives in ExhibitorStatus.css.

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Camera, Check, ChevronDown, ClipboardPlus, Clock, Hourglass, LogOut,
  Radio, Search, Siren, Wrench, X, Inbox, UserCheck,
} from 'lucide-react';
import PhotoGallery from '../components/PhotoGallery';
import QueryForm from '../components/QueryForm';
import { formatDateTime } from '../lib/format';
import { escalatePublicQuery, getPublicExhibitors, getPublicStatus, normalizeStand, readableError, submitClientQuery } from '../lib/mock';
import { getActiveEvent } from '../lib/eventScope';
import { categoryVisual } from '../lib/categoryIcons';
import { loadExhibitorStand, saveExhibitorStand } from '../lib/exhibitorPass';
import './ExhibitorStatus.css';

const STEPS = [
  { label:'Received',    Icon:Inbox },
  { label:'Assigned',    Icon:UserCheck },
  { label:'Being fixed', Icon:Wrench },
  { label:'Done',        Icon:Check },
];
const STEP_FOR_STATUS = {
  'LOGGED':0, 'ASSIGNED':1, 'PENDING':1, 'ESCALATED':1, 'IN PROGRESS':2, 'ISSUES/DELAYED':2, 'COMPLETED':3,
};
const BANNERS = {
  'PENDING':        { tone:'amber', Icon:Hourglass,     text:'Waiting on something before the team can continue.' },
  'ISSUES/DELAYED': { tone:'red',   Icon:AlertTriangle, text:'Delayed. The team knows and is working on it.' },
  'ESCALATED':      { tone:'red',   Icon:Siren,         text:'Escalated to the Ops Desk.' },
};

export default function ExhibitorStatus({ onForgetDevice }) {
  const eventSlug = getActiveEvent()?.slug || '';
  const [exhibitors, setExhibitors] = useState([]);
  const [stand, setStand] = useState('');                       // what's typed / selected
  const [searchMode, setSearchMode] = useState('number');
  const [myStand, setMyStand] = useState(() => loadExhibitorStand(eventSlug));
  const [queries, setQueries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState('');
  const [escalationNote, setEscalationNote] = useState('');
  const [escalatingId, setEscalatingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState(null);                 // { text, tone }

  useEffect(() => {
    getPublicExhibitors().then(setExhibitors).catch(e => setError(readableError(e, 'Stand names are temporarily unavailable.')));
  }, []);

  const load = useCallback(async standNumber => {
    const next = deduplicateQueries(await getPublicStatus(standNumber));
    setQueries(next); setLoaded(true); setLastUpdated(new Date()); setError('');
  }, []);

  // Load the remembered stand, then poll every 10 s while the page is visible.
  useEffect(() => {
    if (!myStand) return undefined;
    let cancelled = false; let timer;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      try { await load(myStand); } catch (e) { if (!cancelled) setError(readableError(e, 'Status is temporarily unavailable.')); }
      if (!cancelled && !document.hidden) timer = window.setTimeout(tick, 10000);
    };
    const onVisibility = () => { window.clearTimeout(timer); if (!document.hidden) void tick(); };
    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { cancelled = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [myStand, load]);

  const exhibitor = exhibitors.find(item => normalizeStand(item.stand) === normalizeStand(myStand));
  const open = queries.filter(q => q.status !== 'COMPLETED');
  const done = queries.filter(q => q.status === 'COMPLETED');

  function chooseStand(event) {
    event.preventDefault();
    const picked = searchMode === 'name' ? exhibitors.find(item => item.name === stand)?.stand : normalizeStand(stand);
    if (!picked) return;
    setLoaded(false); setQueries([]); setMessage(null);
    setMyStand(picked);
    saveExhibitorStand(eventSlug, picked);
  }

  function changeStand() {
    setMyStand(''); setStand(''); setQueries([]); setLoaded(false); setMessage(null);
    saveExhibitorStand(eventSlug, '');
  }

  async function submitQuery(query) {
    setError('');
    try {
      const result = await submitClientQuery({ ...query, sourceTab:'CLIENT' });
      setShowForm(false);
      setMessage(result.duplicate
        ? { tone:'amber', text:`You already reported this as ${result.query.id}. We didn't create a second one.` }
        : result.queued
          ? { tone:'amber', text:'Saved on this phone. It will send as soon as you have signal.' }
          : { tone:'green', text:`Sent. Your reference is ${result.query.id}.` });
      if (!result.queued) { try { await load(myStand); } catch { /* next poll will catch up */ } }
    } catch (submitError) {
      throw new Error(readableError(submitError, 'Could not send your problem to the Ops Desk.'));
    }
  }

  async function escalate(query) {
    setEscalatingId(query.id); setError('');
    try {
      await escalatePublicQuery({ queryId:query.id, stand:normalizeStand(myStand), message:escalationNote });
      setQueries(list => list.map(item => (item.id === query.id ? { ...item, status:'ESCALATED' } : item)));
      setEscalateOpen(''); setEscalationNote('');
      setMessage({ tone:'green', text:`${query.id} was escalated to the Ops Desk.` });
      try { await load(myStand); } catch { /* next poll */ }
    } catch (escalationError) {
      const details = readableError(escalationError, 'Could not escalate this request.');
      setError(/schema cache|could not find the function/i.test(details)
        ? 'Escalation is not switched on yet. Ask the organiser to run supabase/client-ops-notifications-migration.sql.'
        : details);
    } finally { setEscalatingId(''); }
  }

  // ── Stand picker ───────────────────────────────────────────────────────────
  if (!myStand) {
    return (
      <div className="xs">
        <Header />
        <main className="xs-main">
          <form className="xs-card xs-pick" onSubmit={chooseStand}>
            <h1>Which stand are you?</h1>
            <p>We'll remember it on this phone, so next time your status opens straight away.</p>
            <div className="xs-seg" role="tablist">
              {[['number', 'Stand number'], ['name', 'Company name']].map(([mode, label]) => (
                <button key={mode} type="button" role="tab" aria-selected={searchMode === mode}
                  className={searchMode === mode ? 'is-on' : ''}
                  onClick={() => { setSearchMode(mode); setStand(''); }}>{label}</button>
              ))}
            </div>
            {searchMode === 'number'
              ? <input className="xs-input xs-input--big" required autoFocus inputMode="text" autoCapitalize="characters"
                  value={stand} onChange={e => setStand(e.target.value.toUpperCase())} placeholder="e.g. A01" aria-label="Stand number" />
              : <select className="xs-input" required value={stand} onChange={e => setStand(e.target.value)} aria-label="Company">
                  <option value="">Choose your company…</option>
                  {exhibitors.map(item => <option key={`${item.stand}-${item.name}`} value={item.name}>{item.name} · Stand {item.stand}</option>)}
                </select>}
            <button type="submit" className="xs-btn xs-btn--primary xs-btn--wide"><Search size={18} /> Show my status</button>
            {error && <div className="xs-alert xs-alert--red" role="alert">{error}</div>}
          </form>
        </main>
      </div>
    );
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  return (
    <div className="xs">
      <Header live={loaded} lastUpdated={lastUpdated} />
      <main className="xs-main">
        <section className="xs-card xs-hero">
          <div className="xs-hero-id">
            {exhibitor?.logo_url ? <img src={exhibitor.logo_url} alt="" className="xs-logo" /> : <span className="xs-logo xs-logo--blank">{(exhibitor?.name || myStand).slice(0, 2).toUpperCase()}</span>}
            <div>
              <div className="xs-eyebrow">Stand</div>
              <div className="xs-stand">{exhibitor?.stand || myStand}</div>
              <div className="xs-company">{exhibitor?.name || 'Your stand'}</div>
            </div>
          </div>
          <div className="xs-counts">
            <div className="xs-count xs-count--open"><strong>{open.length}</strong><span>Open</span></div>
            <div className="xs-count xs-count--done"><strong>{done.length}</strong><span>Done</span></div>
          </div>
          <button type="button" className="xs-btn xs-btn--primary xs-btn--wide xs-hero-cta" onClick={() => setShowForm(true)}>
            <ClipboardPlus size={20} /> Report a problem
          </button>
          <button type="button" className="xs-link" onClick={changeStand}>Not your stand? Change it</button>
        </section>

        {error && <div className="xs-alert xs-alert--red" role="alert">{error}</div>}
        {message && <div className={`xs-alert xs-alert--${message.tone}`} role="status"><Check size={16} /> {message.text}</div>}

        {!loaded ? <div className="xs-card xs-empty">Loading your status…</div>
          : !open.length ? (
            <div className="xs-card xs-empty">
              <span className="xs-empty-icon"><Check size={30} strokeWidth={3} /></span>
              <strong>{done.length ? 'All sorted!' : 'No problems reported'}</strong>
              <span>{done.length ? 'Everything you reported has been completed.' : 'Tap Report a problem if anything needs attention on your stand.'}</span>
            </div>
          ) : open.map(q => (
            <QueryCard key={q.id} q={q}
              escalateOpen={escalateOpen === q.id} escalating={escalatingId === q.id}
              note={escalationNote} onNote={setEscalationNote}
              onToggleEscalate={() => { setEscalateOpen(escalateOpen === q.id ? '' : q.id); setEscalationNote(''); }}
              onEscalate={() => escalate(q)} />
          ))}

        {done.length > 0 && (
          <section className="xs-done">
            <button type="button" className="xs-done-toggle" aria-expanded={showDone} onClick={() => setShowDone(v => !v)}>
              <span><Check size={16} /> Completed ({done.length})</span>
              <ChevronDown size={18} className={showDone ? 'is-open' : ''} />
            </button>
            {showDone && done.map(q => <QueryCard key={q.id} q={q} compact />)}
          </section>
        )}

        {onForgetDevice && (
          <button type="button" className="xs-forget" onClick={onForgetDevice}>
            <LogOut size={14} /> Sign out on this phone
          </button>
        )}
      </main>

      {showForm && (
        <div className="xs-sheet-backdrop" onClick={() => setShowForm(false)}>
          <section className="xs-sheet" role="dialog" aria-modal="true" aria-label="Report a problem" onClick={e => e.stopPropagation()}>
            <header className="xs-sheet-head">
              <strong>Report a problem · Stand {exhibitor?.stand || myStand}</strong>
              <button type="button" className="xs-icon-btn" aria-label="Close" onClick={() => setShowForm(false)}><X size={20} /></button>
            </header>
            <div className="xs-sheet-body">
              <QueryForm exhibitors={exhibitors}
                initialValues={{ stand:exhibitor?.stand || myStand, exhibitor:exhibitor?.name || '' }}
                onSubmit={submitQuery} onCancel={() => setShowForm(false)} clientMode />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Header({ live, lastUpdated }) {
  return (
    <header className="xs-top">
      <div className="xs-brand"><span>APEXOPS™</span><small>Exhibitor status</small></div>
      {live && <span className="xs-live" title={lastUpdated ? `Updated ${formatDateTime(lastUpdated)}` : ''}><Radio size={14} /> Live</span>}
    </header>
  );
}

function QueryCard({ q, compact, escalateOpen, escalating, note, onNote, onToggleEscalate, onEscalate }) {
  const { Icon, tone, short } = categoryVisual(q.category);
  const step = STEP_FOR_STATUS[q.status] ?? 0;
  const banner = BANNERS[q.status];
  const photos = q.photo_urls?.length || 0;

  return (
    <article className={`xs-card xs-q xs-tone--${tone}${compact ? ' xs-q--compact' : ''}`}>
      <div className="xs-q-top">
        <span className="xs-cat"><Icon size={compact ? 22 : 28} strokeWidth={1.8} /><small>{short}</small></span>
        <div className="xs-q-text">
          <p className="xs-q-desc">{q.description}</p>
          <div className="xs-q-meta">
            <span><Clock size={13} /> {compact ? `Done ${timeAgo(q.completedAt || q.updatedAt)}` : `Reported ${timeAgo(q.loggedAt)}`}</span>
            {photos > 0 && <span><Camera size={13} /> {photos}</span>}
            <code>{q.id}</code>
          </div>
        </div>
      </div>

      {!compact && <>
        <ol className="xs-track" aria-label={`Progress: ${STEPS[step].label}`}>
          {STEPS.map((s, i) => (
            <li key={s.label} className={i < step ? 'is-past' : i === step ? 'is-now' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="xs-track-dot"><s.Icon size={16} strokeWidth={2.4} /></span>
              <span className="xs-track-label">{s.label}</span>
            </li>
          ))}
        </ol>

        {banner && <div className={`xs-banner xs-banner--${banner.tone}`}><banner.Icon size={16} /> {banner.text}</div>}

        {photos > 0 && <div className="xs-q-photos"><PhotoGallery urls={q.photo_urls} size={72} /></div>}

        {q.status !== 'ESCALATED' && (
          escalateOpen ? (
            <div className="xs-escalate">
              <textarea className="xs-input" rows={2} value={note} onChange={e => onNote(e.target.value)}
                placeholder="Optional: why is this urgent?" aria-label="Reason for escalating" />
              <div className="xs-escalate-actions">
                <button type="button" className="xs-btn xs-btn--ghost" onClick={onToggleEscalate}>Cancel</button>
                <button type="button" className="xs-btn xs-btn--red" disabled={escalating} onClick={onEscalate}>
                  <Siren size={16} /> {escalating ? 'Sending…' : 'Escalate now'}
                </button>
              </div>
            </div>
          ) : <button type="button" className="xs-link xs-link--red" onClick={onToggleEscalate}>Still waiting? Escalate to Ops Desk</button>
        )}
      </>}
    </article>
  );
}

function timeAgo(value) {
  if (!value) return '';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

// Same de-duplication as before: one card per issue, keeping the most advanced status.
function deduplicateQueries(items) {
  const byIssue = new Map(); const seen = new Set();
  for (const q of items) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    if (q.status === 'COMPLETED') { byIssue.set(`completed:${q.id}`, q); continue; }
    const key = `${normalizeStand(q.stand)}:${String(q.category || '').trim().toLowerCase()}:${normalizeIssue(q.description)}`;
    const existing = byIssue.get(key);
    if (!existing || statusPriority(q.status) > statusPriority(existing.status)) byIssue.set(key, q);
  }
  return [...byIssue.values()];
}
function normalizeIssue(value) {
  return [...new Set(String(value || '').split(';').map(s => s.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))].sort().join(';');
}
function statusPriority(status) {
  return { LOGGED:1, PENDING:2, ASSIGNED:2, 'IN PROGRESS':3, 'ISSUES/DELAYED':4, ESCALATED:5 }[status] || 0;
}
