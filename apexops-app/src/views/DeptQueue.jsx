// ─── Staff work queue (on-site mode) ──────────────────────────────────────────
// Built for go-time on the show floor: big icons, one tap to move a job along.
//   New  ──[Start]──▶  On it  ──[Done]──▶  Done
// "Waiting", "Delayed" and "Escalated" are flags inside "On it", not extra steps.
// Desktop: cards can also be dragged between columns.
// All styling lives in DeptQueue.css (no inline styles).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getExhibitors, getQueries, getStaff, normalizeStand, updateQuery } from '../lib/mock';
import PhotoGallery from '../components/PhotoGallery';
import EvidenceUploader from '../components/EvidenceUploader';
import { formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import { DEMO_MODE } from '../lib/demoStore';
import { getActiveEventId } from '../lib/eventScope';
import {
  AlertTriangle, Camera, Check, CheckCircle2, Clock, Flag, HelpCircle, Hourglass,
  MessageCircle, Phone, Play, Siren, Undo2, X,
} from 'lucide-react';
import { categoryVisual } from '../lib/categoryIcons';
import './DeptQueue.css';

// ── Lanes ────────────────────────────────────────────────────────────────────
const LANES = [
  { id:'new',  label:'New',   statuses:['LOGGED', 'ASSIGNED'] },
  { id:'busy', label:'On it', statuses:['IN PROGRESS', 'PENDING', 'ISSUES/DELAYED', 'ESCALATED'] },
  { id:'done', label:'Done',  statuses:['COMPLETED'] },
];
const LANE_TARGET_STATUS = { new:'ASSIGNED', busy:'IN PROGRESS', done:'COMPLETED' };
const laneOf = status => (LANES.find(lane => lane.statuses.includes(status)) || LANES[0]).id;

const FLAGS = {
  'PENDING':        { label:'Waiting',   Icon:Hourglass,     tone:'amber' },
  'ISSUES/DELAYED': { label:'Delayed',   Icon:AlertTriangle, tone:'red' },
  'ESCALATED':      { label:'Escalated', Icon:Siren,         tone:'red' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(value) {
  if (!value) return '';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d`;
}
function ageTone(value, status) {
  if (status === 'COMPLETED' || !value) return '';
  const minutes = (Date.now() - new Date(value).getTime()) / 60000;
  return minutes > 60 ? 'is-late' : minutes > 30 ? 'is-aging' : '';
}
function firstContact(value) { return String(value || '').split(/[;,/]/)[0].replace(/^[^:]*:\s*/, '').trim(); }
function whatsappDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^0[6-8]\d{8}$/.test(digits) ? `27${digits.slice(1)}` : digits;
}
function initials(name) { return String(name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase(); }

// ── Main view ────────────────────────────────────────────────────────────────
export default function DeptQueue({ allowStaffPicker = false }) {
  const [staffId, setStaffId] = useState('');
  const [queries, setQueries] = useState([]);
  const [staff, setStaff] = useState([]);
  const [exhibitors, setExhibitors] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [mobileLane, setMobileLane] = useState('new');
  const [toast, setToast] = useState(null);           // { text, undo }
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [dragOverLane, setDragOverLane] = useState('');
  const refreshing = useRef(false);
  const toastTimer = useRef(null);
  const canPickStaff = DEMO_MODE || allowStaffPicker;

  // Initial load + match signed-in user to their staff profile
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nextQueries, nextExhibitors, nextStaff] = await Promise.all([getQueries(), getExhibitors(), getStaff()]);
        if (cancelled) return;
        setQueries(nextQueries); setExhibitors(nextExhibitors); setStaff(nextStaff);
        if (canPickStaff) return;
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const email = String(data.session?.user?.email || '').trim().toLowerCase();
        const matches = nextStaff.filter(m => String(m.email || '').trim().toLowerCase() === email);
        if (matches.length === 1) setStaffId(String(matches[0].id));
        else setProfileError(matches.length
          ? 'More than one staff profile uses this sign-in email. Ask your client administrator to fix the duplicate.'
          : 'Your sign-in email is not linked to a staff profile for this event. Ask your client administrator to add it.');
      } catch (loadError) {
        if (!cancelled) setProfileError(loadError?.message || 'Could not load your work queue.');
      }
    })();
    return () => { cancelled = true; };
  }, [canPickStaff]);

  const refresh = useCallback(async () => {
    if (refreshing.current || document.hidden) return;
    refreshing.current = true;
    try {
      const [nextQueries, nextExhibitors] = await Promise.all([getQueries(), getExhibitors()]);
      setQueries(nextQueries); setExhibitors(nextExhibitors);
    } finally { refreshing.current = false; }
  }, []);

  // Realtime + 15s fallback polling (paused when the tab is hidden)
  useEffect(() => {
    const eventId = getActiveEventId();
    let timer; let cancelled = false;
    const schedule = () => {
      window.clearTimeout(timer);
      if (cancelled || document.hidden) return;
      timer = window.setTimeout(async () => { try { await refresh(); } catch { /* retry next tick */ } schedule(); }, 15000);
    };
    const onVisibility = () => { window.clearTimeout(timer); if (!document.hidden) void refresh().catch(() => {}).finally(schedule); };
    const channel = supabase?.channel(`staff-queue:${eventId}`)
      .on('postgres_changes', { event:'*', schema:'public', table:'queries', filter:`event_id=eq.${eventId}` }, () => { void refresh().catch(() => {}); })
      .subscribe();
    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      cancelled = true; window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      if (channel) supabase.removeChannel(channel);
    };
  }, [refresh]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const me = staff.find(s => String(s.id) === String(staffId));
  const mine = useMemo(
    () => (staffId ? queries.filter(q => String(q.assignedTo || '') === String(staffId)) : []),
    [queries, staffId],
  );
  const byLane = useMemo(() => {
    const groups = { new:[], busy:[], done:[] };
    mine.forEach(q => groups[laneOf(q.status)].push(q));
    groups.new.sort((a, b) => new Date(a.loggedAt) - new Date(b.loggedAt));      // oldest first
    groups.busy.sort((a, b) => flagWeight(b) - flagWeight(a) || new Date(a.loggedAt) - new Date(b.loggedAt));
    groups.done.sort((a, b) => new Date(b.completedAt || b.updatedAt) - new Date(a.completedAt || a.updatedAt));
    return groups;
  }, [mine]);
  const selected = mine.find(q => q.id === selectedId) || null;
  const exhibitorFor = q => exhibitors.find(e => normalizeStand(e.stand) === normalizeStand(q.stand));

  function showToast(text, undo) {
    window.clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
  }

  // Optimistic status change: the card moves instantly, then saves in the background.
  async function moveTo(q, status, { silent = false, completedAt } = {}) {
    if (!q || q.status === status) return;
    const previous = { status:q.status, completedAt:q.completedAt };
    const patch = { status, completedAt:status === 'COMPLETED' ? completedAt ?? new Date() : null };
    setQueries(list => list.map(item => (item.id === q.id ? { ...item, ...patch } : item)));
    setBusyIds(ids => new Set(ids).add(q.id));
    try {
      await updateQuery(q.id, patch);
      if (!silent) {
        const verb = status === 'COMPLETED' ? 'Done' : status === 'IN PROGRESS' ? 'Started' : (FLAGS[status]?.label || 'Moved');
        showToast(`${verb} · Stand ${q.stand}`, () => moveTo({ ...q, ...patch }, previous.status, { silent:true, completedAt:previous.completedAt }));
      }
      void refresh().catch(() => {});
    } catch (saveError) {
      setQueries(list => list.map(item => (item.id === q.id ? { ...item, ...previous } : item)));
      showToast(saveError?.message || 'Could not save. Check your connection and try again.');
    } finally {
      setBusyIds(ids => { const next = new Set(ids); next.delete(q.id); return next; });
    }
  }

  // Desktop drag & drop between lanes
  function onDrop(laneId, event) {
    event.preventDefault();
    setDragOverLane('');
    const q = mine.find(item => item.id === event.dataTransfer.getData('text/plain'));
    if (q && laneOf(q.status) !== laneId) moveTo(q, LANE_TARGET_STATUS[laneId]);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="sq">
      <header className="sq-top">
        <div className="sq-brand">
          <span className="sq-brand-mark">APEXOPS™</span>
          <span className="sq-brand-sub">My work</span>
        </div>
        {me && (
          <div className="sq-me">
            <span className="sq-avatar">{me.photo_url ? <img src={me.photo_url} alt="" /> : initials(me.name)}</span>
            <span className="sq-me-text">
              <strong>{me.name}</strong>
              <small>{me.supplier_name || (me.departments || [me.category]).filter(Boolean).join(', ')}</small>
            </span>
          </div>
        )}
        {canPickStaff && (
          <select className="sq-picker" value={staffId} onChange={e => setStaffId(e.target.value)} aria-label="Choose staff member">
            <option value="">Choose staff member…</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.name}{s.supplier_name ? ` (${s.supplier_name})` : ''}</option>)}
          </select>
        )}
      </header>

      {!staffId ? (
        <div className="sq-empty sq-empty--page">
          <HelpCircle size={40} strokeWidth={1.5} />
          <h2>{profileError ? 'Staff profile not linked' : canPickStaff ? 'Choose a staff member' : 'Loading your work…'}</h2>
          <p>{profileError || 'Jobs assigned to you will appear here.'}</p>
        </div>
      ) : (
        <>
          {/* Big tappable counters double as lane tabs on phones */}
          <nav className="sq-tabs" aria-label="Lanes">
            {LANES.map(lane => (
              <button key={lane.id} type="button"
                className={`sq-tab sq-tab--${lane.id}${mobileLane === lane.id ? ' is-active' : ''}`}
                onClick={() => setMobileLane(lane.id)} aria-pressed={mobileLane === lane.id}>
                <span className="sq-tab-count">{byLane[lane.id].length}</span>
                <span className="sq-tab-label">{lane.label}</span>
              </button>
            ))}
          </nav>

          <main className="sq-board">
            {LANES.map(lane => (
              <section key={lane.id}
                className={`sq-lane sq-lane--${lane.id}${mobileLane === lane.id ? ' is-mobile-active' : ''}${dragOverLane === lane.id ? ' is-drop' : ''}`}
                aria-label={`${lane.label}: ${byLane[lane.id].length}`}
                onDragOver={e => { e.preventDefault(); setDragOverLane(lane.id); }}
                onDragLeave={() => setDragOverLane('')}
                onDrop={e => onDrop(lane.id, e)}>
                <h3 className="sq-lane-head"><span>{lane.label}</span><span className="sq-lane-count">{byLane[lane.id].length}</span></h3>
                <div className="sq-lane-cards">
                  {byLane[lane.id].map(q => (
                    <JobCard key={q.id} q={q} lane={lane.id} logo={exhibitorFor(q)?.logo_url}
                      busy={busyIds.has(q.id)}
                      onOpen={() => setSelectedId(q.id)}
                      onStart={() => moveTo(q, 'IN PROGRESS')}
                      onDone={() => moveTo(q, 'COMPLETED')} />
                  ))}
                  {!byLane[lane.id].length && (
                    <div className="sq-empty">
                      {lane.id === 'new' ? <><CheckCircle2 size={28} /><p>Nothing new. Nice.</p></>
                        : lane.id === 'busy' ? <p>Tap <strong>Start</strong> on a new job</p>
                        : <p>Finished jobs land here</p>}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </main>
        </>
      )}

      {selected && (
        <JobSheet q={selected} exhibitor={exhibitorFor(selected)} busy={busyIds.has(selected.id)}
          onClose={() => setSelectedId(null)}
          onMove={status => moveTo(selected, status)}
          onPhotos={urls => { setQueries(list => list.map(item => (item.id === selected.id ? { ...item, photo_urls:urls } : item))); void refresh().catch(() => {}); }} />
      )}

      {toast && (
        <div className="sq-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" onClick={() => { toast.undo(); setToast(null); }}><Undo2 size={16} /> Undo</button>}
        </div>
      )}
    </div>
  );
}

function flagWeight(q) { return q.status === 'ESCALATED' ? 3 : q.status === 'ISSUES/DELAYED' ? 2 : q.status === 'PENDING' ? 1 : 0; }

// ── Card ─────────────────────────────────────────────────────────────────────
function JobCard({ q, lane, logo, busy, onOpen, onStart, onDone }) {
  const { Icon, tone, short } = categoryVisual(q.category);
  const flag = FLAGS[q.status];
  const photos = q.photo_urls?.length || 0;
  return (
    <article className={`sq-card sq-tone--${tone}${flag ? ` sq-card--flag-${flag.tone}` : ''}${busy ? ' is-busy' : ''}`}
      draggable onDragStart={e => { e.dataTransfer.setData('text/plain', q.id); e.dataTransfer.effectAllowed = 'move'; }}>
      <button type="button" className="sq-card-body" onClick={onOpen} aria-label={`Open job ${q.id}, stand ${q.stand}`}>
        <span className="sq-cat" title={q.category}><Icon size={30} strokeWidth={1.8} /><small>{short}</small></span>
        <span className="sq-card-main">
          <span className="sq-stand">{q.stand}</span>
          <span className="sq-exhibitor">
            {logo && <img src={logo} alt="" />}
            {q.exhibitor}
          </span>
          <span className="sq-desc">{q.description}</span>
          <span className="sq-meta">
            <span className={`sq-age ${ageTone(q.loggedAt, q.status)}`}><Clock size={13} /> {lane === 'done' ? `Done ${timeAgo(q.completedAt || q.updatedAt)} ago` : timeAgo(q.loggedAt)}</span>
            {photos > 0 && <span><Camera size={13} /> {photos}</span>}
            {flag && <span className={`sq-flag sq-flag--${flag.tone}`}><flag.Icon size={13} /> {flag.label}</span>}
          </span>
        </span>
      </button>
      {lane === 'new' && <button type="button" className="sq-action sq-action--start" disabled={busy} onClick={onStart}><Play size={20} /> Start</button>}
      {lane === 'busy' && <button type="button" className="sq-action sq-action--done" disabled={busy} onClick={onDone}><Check size={22} strokeWidth={3} /> Done</button>}
    </article>
  );
}

// ── Detail sheet (slides up on phones, centred on desktop) ──────────────────
function JobSheet({ q, exhibitor, busy, onClose, onMove, onPhotos }) {
  const { Icon, tone, short } = categoryVisual(q.category);
  const phone = firstContact(q.phone);
  const wa = whatsappDigits(phone);
  const lane = laneOf(q.status);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sq-sheet-backdrop" onClick={onClose}>
      <div className="sq-sheet" role="dialog" aria-modal="true" aria-label={`Job ${q.id}`} onClick={e => e.stopPropagation()}>
        <header className={`sq-sheet-head sq-tone--${tone}`}>
          <span className="sq-cat"><Icon size={34} strokeWidth={1.8} /><small>{short}</small></span>
          <div>
            <div className="sq-stand">Stand {q.stand}</div>
            <div className="sq-sheet-sub">{exhibitor?.logo_url && <img src={exhibitor.logo_url} alt="" />}{q.exhibitor} · <code>{q.id}</code></div>
          </div>
          <button type="button" className="sq-icon-btn" onClick={onClose} aria-label="Close"><X size={22} /></button>
        </header>

        <div className="sq-sheet-body">
          <p className="sq-sheet-desc">{q.description}</p>

          <div className="sq-contact">
            {phone && <a className="sq-pill" href={`tel:${phone}`}><Phone size={16} /> Call</a>}
            {wa && <a className="sq-pill sq-pill--wa" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>}
            {q.contact && <span className="sq-contact-name">{q.contact}</span>}
          </div>

          <div className="sq-photos">
            <PhotoGallery urls={q.photo_urls} size={88} />
            <EvidenceUploader query={q} photoUrls={q.photo_urls || []} onAdded={onPhotos} />
          </div>

          <dl className="sq-facts">
            <div><dt>Logged</dt><dd>{formatDateTime(q.loggedAt)}</dd></div>
            <div><dt>Updated</dt><dd>{formatDateTime(q.updatedAt)}</dd></div>
            {q.est && <div><dt>Estimate</dt><dd>{q.est}</dd></div>}
          </dl>

          {lane !== 'done' && (
            <div className="sq-flags" aria-label="Flag this job">
              <span className="sq-flags-label"><Flag size={14} /> Flag</span>
              {Object.entries(FLAGS).map(([status, f]) => (
                <button key={status} type="button" disabled={busy}
                  className={`sq-flag-btn sq-flag--${f.tone}${q.status === status ? ' is-on' : ''}`}
                  onClick={() => onMove(q.status === status ? 'IN PROGRESS' : status)}>
                  <f.Icon size={16} /> {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="sq-sheet-foot">
          {lane === 'new' && <button type="button" className="sq-action sq-action--start sq-action--wide" disabled={busy} onClick={() => onMove('IN PROGRESS')}><Play size={20} /> Start job</button>}
          {lane === 'busy' && <button type="button" className="sq-action sq-action--done sq-action--wide" disabled={busy} onClick={() => { onMove('COMPLETED'); onClose(); }}><Check size={22} strokeWidth={3} /> Mark done</button>}
          {lane === 'done' && <button type="button" className="sq-action sq-action--ghost sq-action--wide" disabled={busy} onClick={() => onMove('IN PROGRESS')}><Undo2 size={18} /> Reopen</button>}
        </footer>
      </div>
    </div>
  );
}
