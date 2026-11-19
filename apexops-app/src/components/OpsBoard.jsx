// ─── Ops control room: live board + area heat-strip ───────────────────────────
// Used inside OpsPortal. The existing list view, filters, reports and the
// edit panel all stay; this adds a visual board view on top of them.
//
//   Needs assigning → Assigned → On it → Done today
//
// • Drag a card to another column (desktop) or use the big buttons.
// • Assign straight from the card. Department staff are listed first.
// • One tap to WhatsApp the exhibitor or the technician.
// • Overdue (past SLA) cards turn red and jump to the top.
// All styling lives in OpsBoard.css.

import { useMemo, useState } from 'react';
import { AlertTriangle, Camera, Check, Clock, Hourglass, MessageCircle, Play, Siren, UserPlus } from 'lucide-react';
import { CATEGORIES } from '../lib/mock';
import { categoryVisual } from '../lib/categoryIcons';
import './OpsBoard.css';

const COLUMNS = [
  { id:'new',      label:'Needs assigning' },
  { id:'assigned', label:'Assigned' },
  { id:'busy',     label:'On it' },
  { id:'done',     label:'Done today' },
];
const FLAGS = {
  'PENDING':        { label:'Waiting',   Icon:Hourglass,     tone:'amber' },
  'ISSUES/DELAYED': { label:'Delayed',   Icon:AlertTriangle, tone:'red' },
  'ESCALATED':      { label:'Escalated', Icon:Siren,         tone:'red' },
};

function columnOf(q) {
  if (q.status === 'COMPLETED') return 'done';
  if (['IN PROGRESS', 'ISSUES/DELAYED', 'ESCALATED'].includes(q.status)) return 'busy';
  if (!q.assignedTo) return 'new';
  return 'assigned';
}

// ── Area heat-strip: every department at a glance ───────────────────────────
export function AreaStrip({ queries, activeArea = 'ALL', onPick, isOverdue }) {
  const stats = useMemo(() => {
    const open = queries.filter(q => q.status !== 'COMPLETED');
    return CATEGORIES.map(category => {
      const mine = open.filter(q => q.category === category);
      return { category, open:mine.length, overdue:mine.filter(isOverdue).length, unassigned:mine.filter(q => !q.assignedTo).length };
    });
  }, [queries, isOverdue]);
  const totalOpen = stats.reduce((sum, s) => sum + s.open, 0);

  return (
    <div className="ob-areas" role="toolbar" aria-label="Filter by area">
      <button type="button" className={`ob-area ob-area--all${activeArea === 'ALL' ? ' is-on' : ''}`} onClick={() => onPick('ALL')}>
        <strong>{totalOpen}</strong><span>All areas</span>
      </button>
      {stats.map(s => {
        const { Icon, tone, short } = categoryVisual(s.category);
        const heat = s.overdue ? 'is-hot' : s.unassigned ? 'is-warm' : s.open ? '' : 'is-clear';
        return (
          <button key={s.category} type="button" title={s.category}
            className={`ob-area ob-tone--${tone} ${heat}${activeArea === s.category ? ' is-on' : ''}`}
            onClick={() => onPick(activeArea === s.category ? 'ALL' : s.category)}>
            <Icon size={20} strokeWidth={1.9} />
            <strong>{s.open}</strong>
            <span>{short}</span>
            {s.overdue > 0 && <em className="ob-area-badge">{s.overdue} late</em>}
          </button>
        );
      })}
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────
export default function OpsBoard({ rows, staff, onOpen, onPatch, isOverdue }) {
  const [dragOver, setDragOver] = useState('');
  const [hint, setHint] = useState('');

  const grouped = useMemo(() => {
    const g = { new:[], assigned:[], busy:[], done:[] };
    rows.forEach(q => g[columnOf(q)].push(q));
    const urgency = q => (isOverdue(q) ? 4 : 0) + (q.status === 'ESCALATED' ? 3 : q.status === 'ISSUES/DELAYED' ? 2 : 0);
    ['new', 'assigned', 'busy'].forEach(k => g[k].sort((a, b) => urgency(b) - urgency(a) || new Date(a.loggedAt) - new Date(b.loggedAt)));
    g.done.sort((a, b) => new Date(b.completedAt || b.updatedAt) - new Date(a.completedAt || a.updatedAt));
    return g;
  }, [rows, isOverdue]);

  function moveTo(q, columnId) {
    if (columnOf(q) === columnId) return;
    setHint('');
    if (columnId === 'new') return onPatch(q.id, { assignedTo:null, status:'LOGGED', completedAt:null });
    if (columnId === 'assigned') {
      if (!q.assignedTo) { setHint(`Pick who should handle Stand ${q.stand} first.`); return onOpen(q); }
      return onPatch(q.id, { status:'ASSIGNED', completedAt:null });
    }
    if (columnId === 'busy') return onPatch(q.id, { status:'IN PROGRESS', completedAt:null });
    if (columnId === 'done') return onPatch(q.id, { status:'COMPLETED', completedAt:new Date() });
  }

  function assign(q, staffId) {
    if (!staffId) return;
    onPatch(q.id, { assignedTo:staffId, status:q.status === 'LOGGED' ? 'ASSIGNED' : q.status });
  }

  return (
    <div className="ob">
      {hint && <div className="ob-hint" role="status">{hint}</div>}
      <div className="ob-board">
        {COLUMNS.map(col => (
          <section key={col.id}
            className={`ob-col ob-col--${col.id}${dragOver === col.id ? ' is-drop' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(col.id); }}
            onDragLeave={() => setDragOver('')}
            onDrop={e => {
              e.preventDefault(); setDragOver('');
              const q = rows.find(item => item.id === e.dataTransfer.getData('text/plain'));
              if (q) moveTo(q, col.id);
            }}>
            <h3 className="ob-col-head"><span>{col.label}</span><span className="ob-col-count">{grouped[col.id].length}</span></h3>
            <div className="ob-col-cards">
              {grouped[col.id].map(q => (
                <Card key={q.id} q={q} col={col.id} staff={staff} late={isOverdue(q)}
                  onOpen={() => onOpen(q)} onAssign={id => assign(q, id)}
                  onStart={() => moveTo(q, 'busy')} onDone={() => moveTo(q, 'done')} />
              ))}
              {!grouped[col.id].length && <div className="ob-empty">{col.id === 'new' ? 'Nothing waiting' : 'Empty'}</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Card({ q, col, staff, late, onOpen, onAssign, onStart, onDone }) {
  const { Icon, tone, short } = categoryVisual(q.category);
  const flag = FLAGS[q.status];
  const assignee = staff.find(m => String(m.id) === String(q.assignedTo));
  const deptStaff = staff.filter(m => (m.departments || [m.category]).includes(q.category));
  const otherStaff = staff.filter(m => !deptStaff.includes(m));
  const exhibitorWa = waLink(q.phone);
  const staffWa = assignee ? waLink(assignee.mobile) : '';
  const photos = q.photo_urls?.length || 0;

  return (
    <article className={`ob-card ob-tone--${tone}${late ? ' is-late' : ''}${flag ? ` is-flag-${flag.tone}` : ''}`}
      draggable onDragStart={e => { e.dataTransfer.setData('text/plain', q.id); e.dataTransfer.effectAllowed = 'move'; }}>
      <button type="button" className="ob-card-body" onClick={onOpen} aria-label={`Open ${q.id}, stand ${q.stand}`}>
        <span className="ob-cat" title={q.category}><Icon size={22} strokeWidth={1.9} /><small>{short}</small></span>
        <span className="ob-card-main">
          <span className="ob-card-top">
            <span className="ob-stand">{q.stand}</span>
            <span className={`ob-age${late ? ' is-late' : ''}`}><Clock size={12} /> {late ? 'OVERDUE · ' : ''}{timeAgo(col === 'done' ? q.completedAt || q.updatedAt : q.loggedAt)}</span>
          </span>
          <span className="ob-exhibitor">{q.exhibitor}</span>
          <span className="ob-desc">{q.description}</span>
          {(flag || photos > 0) && (
            <span className="ob-tags">
              {flag && <span className={`ob-flag ob-flag--${flag.tone}`}><flag.Icon size={12} /> {flag.label}</span>}
              {photos > 0 && <span className="ob-tag"><Camera size={12} /> {photos}</span>}
            </span>
          )}
        </span>
      </button>

      <div className="ob-card-foot">
        {assignee ? (
          <span className="ob-who" title={assignee.supplier_name || ''}>
            <span className="ob-avatar">{assignee.photo_url ? <img src={assignee.photo_url} alt="" /> : initials(assignee.name)}</span>
            <span className="ob-who-name">{assignee.name}</span>
            {staffWa && <a className="ob-wa" href={staffWa} target="_blank" rel="noreferrer" title={`WhatsApp ${assignee.name}`} onClick={e => e.stopPropagation()}><MessageCircle size={15} /></a>}
          </span>
        ) : col !== 'done' && (
          <label className="ob-assign">
            <UserPlus size={15} />
            <select value="" onChange={e => onAssign(e.target.value)} aria-label={`Assign stand ${q.stand}`}>
              <option value="">Assign…</option>
              {deptStaff.length > 0 && <optgroup label={q.category}>{deptStaff.map(m => <option key={m.id} value={m.id}>{m.name}{m.supplier_name ? ` · ${m.supplier_name}` : ''}</option>)}</optgroup>}
              {otherStaff.length > 0 && <optgroup label="Other staff">{otherStaff.map(m => <option key={m.id} value={m.id}>{m.name}{m.supplier_name ? ` · ${m.supplier_name}` : ''}</option>)}</optgroup>}
            </select>
          </label>
        )}
        <span className="ob-actions">
          {exhibitorWa && <a className="ob-icon-btn ob-icon-btn--wa" href={exhibitorWa} target="_blank" rel="noreferrer" title={`WhatsApp ${q.contact || 'exhibitor'}`}><MessageCircle size={16} /></a>}
          {col === 'assigned' && <button type="button" className="ob-go ob-go--start" onClick={onStart}><Play size={14} /> Start</button>}
          {col === 'busy' && <button type="button" className="ob-go ob-go--done" onClick={onDone}><Check size={15} strokeWidth={3} /> Done</button>}
        </span>
      </div>
    </article>
  );
}

function initials(name) { return String(name || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase(); }
function waLink(value) {
  const first = String(value || '').split(/[;,/]/)[0].replace(/^[^:\d+]*:\s*/, '').trim();
  let digits = first.replace(/\D/g, '');
  if (/^0[6-8]\d{8}$/.test(digits)) digits = `27${digits.slice(1)}`;
  return digits.length >= 9 ? `https://wa.me/${digits}` : '';
}
function timeAgo(value) {
  if (!value) return '';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d`;
}
