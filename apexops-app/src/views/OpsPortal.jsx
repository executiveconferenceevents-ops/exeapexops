import { useState, useEffect } from 'react';
import {
  getQueries, addQuery, updateQuery,
  CATEGORIES, getExhibitors, getStaff, getRebookingRequests, getOpsNotifications, markOpsNotificationRead, readableError, STATUS_FLOW, STATUS_COLORS,
} from '../lib/mock';
import StatusBadge from '../components/StatusBadge';
import QueryForm from '../components/QueryForm';
import { Activity, AlertTriangle, Archive, Bell, Building2, Check, CheckCircle2, ClipboardList, ClipboardPlus, FileText, Hammer, HeartPulse, LayoutDashboard, Monitor, MoreHorizontal, Package, Palette, Plus, Printer, Shield, Sparkles, Truck, Users, Wifi, X, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getActiveEvent } from '../lib/eventScope';
import { NAVY, NAVY_DEEP, GOLD, GOLD_PALE, BG, BLUE, TEAL, CORAL, GREEN, FONT, DISPLAY_FONT } from '../theme';
import { buildOperationsReport, buildTaskReport, downloadWordReport, printPdfReport } from '../lib/reporting';

const DEPARTMENT_ISSUES = {
  'Stand Builder': [
    'Stand not ready',
    'Stand build delayed',
    'Incorrect stand number',
    'Missing walls',
    'Carpet missing/damaged',
    'Fascia missing/incorrect',
    'Furniture/stand items missing',
    'Builder still working',
  ],
  'Graphics & Branding': [
    'Graphics missing',
    'Graphics incorrect',
    'Graphics damaged',
    'Graphics not installed',
    'Fascia branding incorrect',
    'Sponsor branding missing',
    'Signage missing',
  ],
  Electrical: [
    'No power',
    'Power not installed',
    'Power point incorrect',
    'Additional power required',
    'Power not working',
    'Power tripping',
    'Cable/trip hazard',
  ],
  Furniture: [
    'Furniture missing',
    'Incorrect quantity',
    'Incorrect furniture',
    'Furniture damaged',
    'Furniture dirty',
    'Additional furniture required',
  ],
  'AV / Technical': [
    'AV equipment missing',
    'Screen/monitor issue',
    'Microphone issue',
    'Sound issue',
    'Presentation issue',
    'Technical setup delayed',
    'Technician required',
  ],
  'Internet / Wi-Fi': [
    'No Wi-Fi',
    'Wi-Fi not working',
    'Slow connection',
    'Cannot connect',
    'Registration/payment connection issue',
    'Additional internet required',
  ],
  'Logistics / Freight / Loading Bay': [
    'Delivery not received',
    'Freight missing',
    'Freight damaged',
    'Freight delivered to wrong stand',
    'Loading bay congested',
    'Vehicle/access issue',
    'Delivery delayed',
  ],
  Storage: [
    'No storage space',
    'Storage full',
    'Boxes/crates require removal',
    'Freight requires storage',
    'Item cannot be located',
  ],
  'Cleaning & Waste': [
    'Stand dirty',
    'Carpet dirty',
    'Construction waste',
    'Packaging/waste not removed',
    'Bin required/overflowing',
    'Exhibition area requires cleaning',
  ],
  Security: [
    'Access issue',
    'Contractor/supplier access issue',
    'Vehicle access issue',
    'Missing item/equipment',
    'Security assistance required',
  ],
  'H&S / Medics': [
    'Trip hazard',
    'Blocked aisle/exit',
    'Unsafe construction',
    'Electrical safety issue',
    'Injury/medical assistance',
    'Other safety concern',
  ],
  Organiser: [
    'Exhibitor requires assistance',
    'Stand/location query',
    'Registration/badge issue',
    'Sponsor deliverable issue',
    'Supplier issue',
    'Last-minute request',
    'Client escalation',
    'Venue issue',
    'Parking/access issue',
    'Air-conditioning issue',
    'Toilet issue',
    'Catering issue',
    'Noise issue',
  ],
};

const DEPARTMENT_ICONS = {
  'Stand Builder': Hammer,
  'Graphics & Branding': Palette,
  Electrical: Zap,
  Furniture: Package,
  'AV / Technical': Monitor,
  'Internet / Wi-Fi': Wifi,
  'Logistics / Freight / Loading Bay': Truck,
  Storage: Archive,
  'Cleaning & Waste': Sparkles,
  Security: Shield,
  'H&S / Medics': HeartPulse,
  Organiser: Users,
};

export default function OpsPortal({ onOpenStaff, onOpenExhibitors }) {
  const eventName = getActiveEvent()?.name || 'Event workspace';
  const [queries, setQueries]   = useState([]);
  const [staff, setStaff]       = useState([]);
  const [exhibitors, setExhibitors] = useState([]);
  const [rebookings, setRebookings] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [toast, setToast] = useState(null);
  const [tab, setTab]           = useState('DASHBOARD');
  const [filter, setFilter]     = useState('ALL');
  const [staffFilter, setStaffFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      setQueries(await getQueries());
    } catch (queryError) {
      setError(readableError(queryError, 'Could not refresh live query status.'));
    }
  };

  const refreshNotifications = async () => {
    try {
      setNotifications(await getOpsNotifications());
    } catch (notificationError) {
      const details = readableError(notificationError, 'Could not load Ops Desk notifications.');
      setError(/ops_notifications.*(schema cache|could not find|does not exist)/i.test(details)
        ? 'Ops notifications are not set up in Supabase yet. Run supabase/client-ops-notifications-migration.sql in the Supabase SQL Editor, then refresh the Ops app.'
        : details);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadInitialData = async () => {
      const [queryResult, staffResult, exhibitorResult, rebookingResult] = await Promise.allSettled([
        getQueries(),
        getStaff(),
        getExhibitors(),
        getRebookingRequests().catch(() => []),
      ]);
      if (cancelled) return;

      if (queryResult.status === 'fulfilled') setQueries(queryResult.value);
      else setError(readableError(queryResult.reason, 'Could not load live query status.'));
      if (staffResult.status === 'fulfilled') setStaff(staffResult.value);
      else setError(readableError(staffResult.reason, 'Could not load staff.'));
      if (exhibitorResult.status === 'fulfilled') setExhibitors(exhibitorResult.value);
      else setError(readableError(exhibitorResult.reason, 'Could not load exhibitors.'));
      if (rebookingResult.status === 'fulfilled') setRebookings(rebookingResult.value);
      setInitialLoading(false);
    };

    loadInitialData();
    refreshNotifications();
    const timer = window.setInterval(refresh, 15000);
    let toastTimeout;
    const channel = supabase?.channel('live-query-status')
      .on('postgres_changes', { event:'*', schema:'public', table:'queries' }, refresh)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'ops_notifications' }, event => {
        setToast(event.new);
        window.clearTimeout(toastTimeout);
        toastTimeout = window.setTimeout(() => setToast(null), 8000);
        refreshNotifications();
      })
      .subscribe();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(toastTimeout);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  function exportOperationsReport(format) {
    try {
      const html = buildOperationsReport({ queries, rebookings, eventName });
      if (format === 'word') downloadWordReport('APEXOPS-operations-report.doc', html);
      else printPdfReport(html);
    } catch (reportError) {
      setError(reportError.message || 'Could not create the operations report.');
    }
  }

  function exportTaskReport(format) {
    try {
      const scope = tab === 'DASHBOARD'
        ? (activeStatusLabel || (filter === 'ALL' ? 'Dashboard Tasks' : filter))
        : tab === 'COMPLETED' ? 'Completed Tasks' : tab === 'ESCALATIONS' ? 'Escalations' : tab;
      const staffLabel = staffFilter === 'ALL'
        ? 'All staff'
        : staffFilter === 'UNASSIGNED'
          ? 'Unassigned'
          : staff.find(member => String(member.id) === String(staffFilter))?.name || 'Selected staff';
      const title = `${scope} Task Report`;
      const html = buildTaskReport({
        queries: visibleTaskRows.map(query => ({
          ...query,
          assignedName: staff.find(member => String(member.id) === String(query.assignedTo))?.name || 'Unassigned',
        })),
        title,
        eventName,
        filters: `Staff: ${staffLabel}`,
      });
      const filename = `APEXOPS-${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
      if (format === 'word') downloadWordReport(`${filename}.doc`, html);
      else printPdfReport(html);
    } catch (reportError) {
      setError(reportError.message || 'Could not create the filtered task report.');
    }
  }

  // ── New query form state ───────────────────────────────────────────────────
  async function submitQuery(query) {
    setError('');
    try {
      await addQuery(query);
      setShowForm(false);
      await refresh();
    } catch (queryError) {
      throw new Error(readableError(queryError, 'Could not save this query. Please sign in and try again.'));
    }
  }

  async function markNotificationRead(notification) {
    try {
      await markOpsNotificationRead(notification.id);
      setNotifications(current => current.map(item => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
      if (notification.query_id) {
        setTab('DASHBOARD');
        setStatusFilter(null);
        setSelected(queries.find(query => query.id === notification.query_id) || null);
      }
    } catch (notificationError) {
      setError(readableError(notificationError, 'Could not update this notification.'));
    }
  }

  // ── Edit / assign panel ────────────────────────────────────────────────────
  async function saveEdit(id, patch) {
    const previousQueries = queries;
    setSelected(null);
    setQueries(current => current.map(query => query.id === id ? { ...query, ...patch } : query));
    try {
      await updateQuery(id, patch);
      await refresh();
    } catch (queryError) {
      setQueries(previousQueries);
      setError(readableError(queryError, 'Could not update this query.'));
    }
  }

  const active   = queries.filter(q => q.status !== 'COMPLETED');
  const complete = queries.filter(q => q.status === 'COMPLETED');
  const overdue = active.filter(isOverdue);
  const escalated = active.filter(q => q.status === 'ESCALATED' || q.status === 'ISSUES/DELAYED' || isOverdue(q));

  const matchesStatusFilter = (q) => {
    if (!statusFilter) return true;
    if (statusFilter === 'OPEN') return q.status !== 'COMPLETED';
    if (statusFilter === 'IN_PROGRESS') return q.status === 'IN PROGRESS';
    if (statusFilter === 'COMPLETED_TODAY') return q.status === 'COMPLETED' && isSameDay(q.completedAt || q.updatedAt || q.loggedAt);
    if (statusFilter === 'OVERDUE') return isOverdue(q);
    return true;
  };

  const dashboardPool = filter === 'ALL' ? queries : queries.filter(q => q.category === filter);
  const tabBase = tab === 'DASHBOARD'
    ? dashboardPool
    : tab === 'COMPLETED'
      ? queries.filter(q => q.status === 'COMPLETED')
    : tab === 'ESCALATIONS'
      ? escalated
      : tab === 'NOTIFICATIONS' ? [] : queries.filter(q => q.category === tab);
  const shown = tabBase.filter(matchesStatusFilter);
  const dashboardRows = tab === 'DASHBOARD' && statusFilter !== 'COMPLETED_TODAY'
    ? shown.filter(q => q.status !== 'COMPLETED')
    : shown;
  const taskRows = tab === 'DASHBOARD' ? dashboardRows : shown;
  const visibleTaskRows = taskRows.filter(query => staffFilter === 'ALL'
    || (staffFilter === 'UNASSIGNED' ? !query.assignedTo : String(query.assignedTo || '') === String(staffFilter)));

  const toggleStatusFilter = (nextFilter) => {
    setTab('DASHBOARD');
    setStatusFilter(current => current === nextFilter ? null : nextFilter);
  };

  const activeStatusLabel = {
    OPEN: 'Open queries',
    IN_PROGRESS: 'In progress',
    COMPLETED_TODAY: 'Completed today',
    OVERDUE: 'SLA overdue',
  }[statusFilter];

  const tabKpis = [
    { label:'OPEN QUERIES', value:dashboardPool.filter(q => q.status !== 'COMPLETED').length, color:NAVY, filterKey:'OPEN' },
    { label:'IN PROGRESS', value:dashboardPool.filter(q => q.status === 'IN PROGRESS').length, color:'#27AE60', filterKey:'IN_PROGRESS' },
    { label:'COMPLETED TODAY', value:dashboardPool.filter(q => q.status === 'COMPLETED' && isSameDay(q.completedAt || q.updatedAt || q.loggedAt)).length, color:'#2E86AB', filterKey:'COMPLETED_TODAY' },
    { label:'SLA OVERDUE', value:dashboardPool.filter(isOverdue).length, color:'#C0392B', filterKey:'OVERDUE' },
  ];

  const kpis = [
    { label: 'TOTAL',       value: queries.length,                                color: BLUE, accent: '#D9EAF6', icon: ClipboardList },
    { label: 'LOGGED',      value: queries.filter(q=>q.status==='LOGGED').length,     color: '#6C7E91', accent: '#E2E7E8', icon: Activity },
    { label: 'IN PROGRESS', value: queries.filter(q=>q.status==='IN PROGRESS').length,color: GREEN, accent: '#D8EFE3', icon: Activity },
    { label: 'ISSUES',      value: queries.filter(q=>q.status==='ISSUES/DELAYED').length,color: CORAL, accent: '#F2D9D7', icon: AlertTriangle },
    { label: 'COMPLETED',   value: complete.length,                               color: TEAL, accent: '#D5EEEC', icon: CheckCircle2 },
  ];
  const pageTitle = tab === 'DASHBOARD' ? 'Operations overview'
    : tab === 'COMPLETED' ? 'Completed tasks'
      : tab === 'ESCALATIONS' ? 'Escalations'
        : tab === 'NOTIFICATIONS' ? 'Notifications'
          : tab;

    if (initialLoading) return (
      <div className="ops-loading-screen" role="status" aria-live="polite">
        <div className="ops-loading-panel">
          <div className="ops-loading-brand">APEXOPS™</div>
          <div className="ops-loading-content">
            <span className="ops-loading-spinner" aria-hidden="true" />
            <div>
              <h1>Preparing your workspace</h1>
              <p>Loading requests, staff and exhibitors...</p>
            </div>
          </div>
        </div>
      </div>
    );

  return (
    <div className="ops-app-shell">
      <aside className="ops-sidebar">
        <div className="ops-brand-lockup">
          <div className="ops-brand-mark">AP</div>
          <div><div className="ops-brand-name">APEXOPS™</div><div className="ops-brand-byline">by Executive Conference Events</div></div>
        </div>
        <div className="ops-sidebar-event">
          <div className="ops-sidebar-label">Operations workspace</div>
          <div className="ops-sidebar-event-name">{eventName}</div>
          <div className="ops-sidebar-event-meta">Exhibitor service &amp; delivery</div>
        </div>
        <nav className="ops-sidebar-nav" aria-label="Operations navigation">
          <div className="ops-nav-group-label">Work queue</div>
          {[
            ['DASHBOARD', 'Dashboard', LayoutDashboard, dashboardPool.filter(query => query.status !== 'COMPLETED').length],
            ['COMPLETED', 'Completed tasks', CheckCircle2, complete.length],
            ['ESCALATIONS', 'Escalations', AlertTriangle, escalated.length],
            ['NOTIFICATIONS', 'Notifications', Bell, notifications.filter(item => !item.read_at).length],
          ].map(([value, label, Icon, count]) => (
            <button key={value} className={`ops-nav-item${tab === value ? ' active' : ''}`} aria-current={tab === value ? 'page' : undefined} onClick={()=>{ setStatusFilter(null); setTab(value); }}>
              <Icon size={15} /><span>{label}</span>{count > 0 && <span className="ops-nav-badge">{count}</span>}
            </button>
          ))}
          <div className="ops-nav-group-label">Directories</div>
          <button className="ops-nav-item" onClick={onOpenStaff}><Users size={15} /><span>Suppliers &amp; staff</span></button>
          <button className="ops-nav-item" onClick={onOpenExhibitors}><Building2 size={15} /><span>Exhibitors</span></button>
          <div className="ops-nav-group-label">Departments</div>
          {CATEGORIES.map(category => {
            const Icon = DEPARTMENT_ICONS[category] || ClipboardList;
            const count = dashboardPool.filter(query => query.category === category && query.status !== 'COMPLETED').length;
            return <button key={category} className={`ops-nav-item ops-department-item${tab === category ? ' active' : ''}`} aria-current={tab === category ? 'page' : undefined} onClick={()=>{ setStatusFilter(null); setTab(category); }}>
              <Icon size={15} /><span>{category}</span>{count > 0 && <span className="ops-nav-badge">{count}</span>}
            </button>;
          })}
        </nav>
        <div className="ops-sidebar-footer"><span className="ops-live-pip" /> Ops Desk <span className="ops-footer-org">Executive Conference Events</span></div>
      </aside>

      <main className="ops-main">
        <header className="ops-topbar">
          <div className="ops-page-heading">
            <div className="ops-breadcrumb">{eventName} <span>/</span> OPERATIONS</div>
            <h1>{pageTitle}</h1>
            <p>Live exhibitor requests, service delivery and team assignments.</p>
          </div>
          <div className="ops-top-actions">
            <button className="ops-quiet-action" title="Export operations report as PDF" onClick={()=>exportOperationsReport('pdf')}><Printer size={15} /><span>PDF report</span></button>
            <button className="ops-quiet-action" title="Export operations report as Word" onClick={()=>exportOperationsReport('word')}><FileText size={15} /><span>Word report</span></button>
            <button className="ops-new-query" onClick={()=>setShowForm(true)}><Plus size={15} /><span>Log query</span></button>
          </div>
        </header>

        <div className="ops-content">
          <div className="ops-kpi-bar">
            {kpis.map(k => (
              <div key={k.label} className="ops-kpi-card" style={{ '--kpi-color':k.color }}>
                <div className="ops-kpi-label">{k.label}</div>
                <div className="ops-kpi-value">{k.value}</div>
                <k.icon size={16} className="ops-kpi-icon" />
              </div>
            ))}
          </div>

          {overdue.length > 0 && <div className="ops-alert-bar">
            <div className="ops-alert-inner"><span className="ops-alert-copy"><span className="ops-alert-icon"><AlertTriangle size={15} /></span><span><strong>{overdue.length}</strong> overdue {overdue.length === 1 ? 'query needs' : 'queries need'} escalation</span></span><button onClick={()=>setTab('ESCALATIONS')} className="ops-alert-link">Review escalations <span aria-hidden="true">→</span></button></div>
          </div>}
          {error && <div className="ops-error-banner">{error}</div>}

          <div className="ops-primary-tabs" role="tablist" aria-label="Query views">
            {[
              ['DASHBOARD', 'Dashboard', LayoutDashboard],
              ['COMPLETED', `Completed (${complete.length})`, CheckCircle2],
              ['ESCALATIONS', `Escalations${escalated.length ? ` · ${escalated.length}` : ''}`, AlertTriangle],
              ['NOTIFICATIONS', `Notifications${notifications.filter(item => !item.read_at).length ? ` · ${notifications.filter(item => !item.read_at).length}` : ''}`, Bell],
            ].map(([value, label, Icon]) => (
              <button className={`ops-primary-tab${tab===value ? ' active' : ''}`} role="tab" aria-selected={tab===value} key={value} onClick={()=>{ setStatusFilter(null); setTab(value); }}><Icon size={15} /><span>{label}</span></button>
            ))}
          </div>

      {activeStatusLabel && (
        <div className="ops-filter-summary">
          <span>Showing: {activeStatusLabel}</span>
          <button onClick={()=>setStatusFilter(null)}>Clear filter</button>
        </div>
      )}

      <div className="ops-workspace-kpis">
        <div className="ops-quick-filters">
        {tabKpis.map(kpi => {
          const active = statusFilter === kpi.filterKey;
          return (
            <button key={kpi.label} className={`ops-filter-card${active ? ' active' : ''}`} onClick={()=>toggleStatusFilter(kpi.filterKey)} style={{ '--filter-color':kpi.color }}>
              <span className="ops-filter-label">{kpi.label}</span>
              <span className="ops-filter-value">{kpi.value}</span>
            </button>
          );
        })}
        </div>
      </div>

      {/* Query list */}
      <div className="ops-query-workspace">
        <div className="ops-workspace-toolbar">
          <div className="ops-workspace-heading"><span>Request queue</span><label>Department <select value={filter} onChange={e=>setFilter(e.target.value)}><option value="ALL">All departments</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></label></div>
          <div className="ops-workspace-controls">
            <label>Assigned to <select aria-label="Filter tasks by staff member" value={staffFilter} onChange={event=>setStaffFilter(event.target.value)}>
              <option value="ALL">All staff</option><option value="UNASSIGNED">Unassigned</option>
              {staff.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}
            </select></label>
            <button disabled={tab === 'NOTIFICATIONS'} title="Export only the tasks currently shown as PDF" onClick={()=>exportTaskReport('pdf')} style={{ ...viewExportButton, opacity:tab === 'NOTIFICATIONS' ? .5 : 1 }}><Printer size={14} /> View PDF</button>
            <button disabled={tab === 'NOTIFICATIONS'} title="Export only the tasks currently shown as Word" onClick={()=>exportTaskReport('word')} style={{ ...viewExportButton, opacity:tab === 'NOTIFICATIONS' ? .5 : 1 }}><FileText size={14} /> View Word</button>
            <button onClick={()=>setShowForm(true)} style={{ ...btnPrimary, display:'inline-flex', alignItems:'center', gap:7 }}><Plus size={15} /> Log Query</button>
          </div>
        </div>
        {tab === 'NOTIFICATIONS' ? <div style={{ display:'grid', gap:10 }}>
          {notifications.map(notification => <div key={notification.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px', background:notification.read_at ? '#fff' : '#f3f8ff', border:'1px solid #dfe7eb', borderLeft:`4px solid ${notification.kind === 'CLIENT_ESCALATION' ? CORAL : BLUE}`, borderRadius:5 }}>
            <Bell size={17} color={notification.kind === 'CLIENT_ESCALATION' ? CORAL : BLUE} />
            <div style={{ flex:1 }}><div style={{ color:NAVY, fontSize:13, fontWeight:800 }}>{notification.title}</div><div style={{ color:'#586973', fontSize:12, marginTop:3 }}>{notification.message}</div><div style={{ color:'#839098', fontSize:10, marginTop:5 }}>{timeAgo(notification.created_at)}</div></div>
            {!notification.read_at && <button title="Mark as read" onClick={()=>markNotificationRead(notification)} style={iconButton}><Check size={16} /></button>}
            {notification.query_id && <button onClick={()=>markNotificationRead(notification)} style={btnSecondary}>Open query</button>}
          </div>)}
          {notifications.length === 0 && <div style={{ textAlign:'center', color:'#6f7b82', padding:40 }}>No notifications yet.</div>}
        </div> : <>
          {visibleTaskRows.length > 0 && <QueryHeadings />}
          {visibleTaskRows.map(q => (
            <QueryRow key={q.id} q={q} staff={staff} onSelect={()=>setSelected(q)} />
          ))}
          {tab==='DASHBOARD' && visibleTaskRows.length===0 &&
            <div style={{ background:'#fff', border:'1px dashed #cbd2d0', borderRadius:8, textAlign:'center', color:'#6f7b82', padding:'44px 24px', marginTop:12 }}>
              <ClipboardList size={30} color="#9aa6ad" strokeWidth={1.6} />
              <div style={{ color:NAVY, fontSize:16, fontWeight:700, marginTop:12 }}>{staffFilter === 'ALL' ? 'No active queries' : 'No matching tasks'}</div>
              <div style={{ fontSize:13, marginTop:6 }}>{staffFilter === 'ALL' ? 'Your live queue is clear. Log a new exhibitor request to get started.' : 'Try another staff member or clear the staff filter.'}</div>
              <button onClick={()=>setShowForm(true)} style={{ ...btnPrimary, marginTop:18, display:'inline-flex', alignItems:'center', gap:7 }}><Plus size={15} /> Log Query</button>
            </div>
          }
          {tab !== 'DASHBOARD' && tab !== 'NOTIFICATIONS' && visibleTaskRows.length === 0 && <div style={{ textAlign:'center', color:'#6f7b82', padding:40, fontSize:14 }}>{tab === 'ESCALATIONS' ? 'No escalated, delayed, or overdue tasks match these filters.' : 'No tasks match these filters.'}</div>}
        </>}
      </div>

      {/* Log new query modal */}
      {showForm && (
        <Modal title="Log New Query" onClose={()=>setShowForm(false)} wide>
          <QueryForm exhibitors={exhibitors} onSubmit={submitQuery} onCancel={()=>setShowForm(false)} />
        </Modal>
      )}

      {/* Edit / assign modal */}
      {selected && (
        <EditPanel q={selected} staff={staff} onSave={saveEdit} onClose={()=>setSelected(null)} />
      )}
      {toast && <div role="status" style={toastStyle}>
        <span style={{ width:34, height:34, display:'grid', placeItems:'center', background:toast.kind === 'CLIENT_ESCALATION' ? '#FCE4E1' : '#D9EAF6', color:toast.kind === 'CLIENT_ESCALATION' ? CORAL : BLUE, borderRadius:6 }}><Bell size={17} /></span>
        <div style={{ flex:1 }}><div style={{ color:NAVY, fontSize:12, fontWeight:800 }}>{toast.title}</div><div style={{ color:'#586973', fontSize:11, marginTop:3 }}>{toast.message}</div></div>
        {toast.query_id && <button onClick={()=>{ setTab('NOTIFICATIONS'); setToast(null); }} style={toastAction}>View</button>}
        <button aria-label="Dismiss notification" onClick={()=>setToast(null)} style={{ border:0, background:'transparent', color:'#718089', cursor:'pointer', padding:4 }}><X size={15} /></button>
      </div>}
        </div>
      </main>
    </div>
  );
}

function EventBanner({ banner, onChange }) {
  function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      window.alert('Please choose an image smaller than 2 MB.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ''));
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  return <div className="event-banner" style={{ maxWidth: 1100, margin:'0 auto 18px', position:'relative', overflow:'hidden', borderRadius:6, border:'1px solid #dce5eb', background: banner ? '#102544' : '#f5f8fa', minHeight:72 }}>
    {banner ? <img src={banner} alt="Event banner" style={{ display:'block', width:'100%', maxHeight:150, objectFit:'cover' }} /> : <div style={{ padding:'18px 24px', color:NAVY }}><div style={{ fontWeight:700, fontSize:18 }}>Your event name</div><div style={{ color:'#718089', fontSize:12, marginTop:4 }}>Upload a banner to brand the dashboard tabs.</div></div>}
    <label style={{ position:'absolute', right:12, bottom:12, background:'rgba(255,255,255,.95)', color:NAVY, border:'1px solid #d6dfdf', borderRadius:4, padding:'7px 10px', fontSize:11, fontWeight:700, cursor:'pointer', boxShadow:'0 2px 8px rgba(13,26,50,.14)' }}>
      {banner ? 'Replace banner' : 'Upload event banner'}
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} style={{ display:'none' }} />
    </label>
    <div style={{ position:'absolute', left:12, bottom:8, color: banner ? 'rgba(255,255,255,.84)' : '#718089', fontSize:10, background: banner ? 'rgba(16,37,68,.72)' : 'transparent', padding:'3px 5px', borderRadius:3 }}>Recommended 1400 × 180 px · PNG, JPG or WebP · max 2 MB</div>
  </div>;
}

function QueryHeadings() {
  return <div className="query-headings" style={{
    display:'grid', gridTemplateColumns:'minmax(150px, 1.1fr) minmax(220px, 2fr) minmax(150px, 1.2fr) minmax(145px, 1.2fr) minmax(150px, 1.2fr)',
    gap:18, padding:'0 18px 10px 20px', color:'#61707b', fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:1.2,
  }}>
    <span>Query · Stand · Exhibitor</span><span>Description</span><span>Category · Assigned To</span><span>Logged · Estimate</span><span>SLA · Status</span>
  </div>;
}

function QueryRow({ q, staff, onSelect }) {
  const c = STATUS_COLORS[q.status] || STATUS_COLORS['LOGGED'];
  const staffName = q.assignedTo ? staff.find(s=>s.id===q.assignedTo)?.name : '—';
  const mins = { "15 min":15,"30 min":30,"1 hour":60,"2 hours":120,"3 hours":180,"4 hours":240,"Half day":240,"Full day":480 };
  const eta = mins[q.est] ? `~${q.est}` : q.est;
  const overdue = isOverdue(q);

  return (
    <div className="query-row" onClick={onSelect} style={{
      background:'#fff', borderRadius:12, marginBottom:10,
      border:`1px solid ${c.bg}`, borderLeft:`4px solid ${c.badge}`,
      minHeight:110, padding:'18px 18px 16px', cursor:'pointer', display:'grid',
      gridTemplateColumns:'minmax(150px, 1.1fr) minmax(220px, 2fr) minmax(150px, 1.2fr) minmax(145px, 1.2fr) minmax(150px, 1.2fr)',
      alignItems:'start', gap:18, lineHeight:1.35,
      transition:'box-shadow .15s ease, transform .15s ease',
    }}
    onMouseEnter={e=>{ e.currentTarget.style.boxShadow='0 10px 22px rgba(13,26,50,.08)'; e.currentTarget.style.transform='translateY(-1px)'; }}
    onMouseLeave={e=>{ e.currentTarget.style.boxShadow='none'; e.currentTarget.style.transform='translateY(0)'; }}
    >
      <div><div style={{ fontWeight:800, color:NAVY, fontSize:13 }}>{q.id}</div><div style={{ fontSize:12, color:'#6b7d88', marginTop:5 }}>Stand {q.stand}</div><div style={{ fontWeight:700, fontSize:13, color:'#1a1a1a', marginTop:5 }}>{q.exhibitor}</div></div>
      <div style={{ fontSize:13, color:'#485a64', whiteSpace:'normal', overflowWrap:'anywhere', lineHeight:1.5 }}>{q.description}</div>
      <div><div style={{ fontSize:12, color:'#5d6e78', fontWeight:700 }}>{q.category}</div><div style={{ fontSize:12, color:'#556b77', marginTop:7 }}>Assigned: {staffName}</div></div>
      <div><div style={{ fontSize:11, color:'#697d86' }}>Logged {q.loggedAt ? formatDate(q.loggedAt) : '—'}</div><div style={{ fontSize:12, color:'#687a86', marginTop:7 }}>Estimate {eta}</div></div>
      <div><div style={{ fontSize:11, color:overdue ? '#C0392B' : '#687a86', fontWeight:overdue ? 800 : 600 }}>{q.slaDeadline ? `${overdue ? 'OVERDUE' : 'SLA'} ${formatDate(q.slaDeadline)}` : 'No SLA'}</div><div style={{ marginTop:8 }}><StatusBadge status={q.status} /></div>{q.notes && <div title={q.notes} style={{ fontSize:12, color:'#6C3483', marginTop:8 }}>Notes</div>}</div>
    </div>
  );
}

function EditPanel({ q, staff, onSave, onClose }) {
  const [status, setStatus]     = useState(q.status);
  const [assignedTo, setAssigned] = useState(q.assignedTo || '');
  const [notes, setNotes]       = useState(q.notes || '');
  const [noteError, setNoteError] = useState('');
  const staffForCat = staff.filter(member => (member.departments || [member.category]).includes(q.category));
  const currentAssignee = staff.find(member => String(member.id) === String(assignedTo));

  return (
    <Modal title={`${q.id} — ${q.exhibitor}`} onClose={onClose} wide>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
        <InfoBlock label="Stand" value={`Stand ${q.stand}`} />
        <InfoBlock label="Contact" value={`${q.contact}  ${q.phone}`} />
        <InfoBlock label="Category" value={q.category} />
        <InfoBlock label="Est. Fix" value={q.est} />
      </div>
      <Field label="Description">
        <div style={{ background:'#F8F8F8', border:'1px solid #E0E0E0', borderRadius:6, padding:'8px 10px', fontSize:13, color:'#333' }}>{q.description}</div>
      </Field>
      <Field label={`Assign To — ${q.category} department`}>
        <select value={assignedTo} onChange={e=>setAssigned(e.target.value)}>
          <option value="">— Unassigned —</option>
          {currentAssignee && !staffForCat.some(member => String(member.id) === String(currentAssignee.id)) && <option value={currentAssignee.id}>{currentAssignee.name} (currently assigned — {currentAssignee.category})</option>}
          {staffForCat.map(member=><option key={member.id} value={member.id}>{member.name} ({member.supplier_name || member.category})</option>)}
          {staffForCat.length === 0 && <option disabled>No staff allocated to this department</option>}
        </select>
        <div style={{ marginTop:5, fontSize:11, color:'#687780' }}>Only staff allocated to this department can be newly assigned.</div>
        {currentAssignee && <AssigneeContactCard member={currentAssignee} />}
      </Field>
      <Field label="Status">
        <select value={status} onChange={e=>setStatus(e.target.value)}>
          {STATUS_FLOW.map(s=><option key={s}>{s}</option>)}
        </select>
      </Field>
      <Field label={status === 'ESCALATED' ? 'Escalation note' : 'Notes'} required={status === 'ESCALATED'}>
        <textarea rows={3} value={notes} onChange={e=>{ setNotes(e.target.value); setNoteError(''); }} placeholder={status === 'ESCALATED' ? 'Explain the risk, blocker, owner, or next action…' : 'Internal notes…'} />
        {status === 'ESCALATED' && <div style={{ marginTop:6, fontSize:11, color:'#A33B32' }}>A note is required so the escalation can be acted on.</div>}
        {noteError && <div style={{ marginTop:6, fontSize:12, color:'#C0392B', fontWeight:600 }}>{noteError}</div>}
      </Field>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={()=>{
          if (status === 'ESCALATED' && !notes.trim()) { setNoteError('Add an escalation note before saving.'); return; }
          onSave(q.id,{ status, assignedTo: assignedTo||null, notes });
        }} style={btnPrimary}>Save Changes</button>
      </div>
    </Modal>
  );
}

function AssigneeContactCard({ member }) {
  return (
    <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:12, background:'#f8fafb', border:'1px solid #dfe7eb', borderRadius:8, padding:'10px 12px' }}>
      {member.supplier_logo_url && <img src={member.supplier_logo_url} alt={`${member.supplier_name || 'Supplier'} logo`} title={member.supplier_name || 'Supplier'} style={{ width:38, height:38, objectFit:'contain', borderRadius:6, border:'1px solid #dfe7eb', background:'#fff', padding:3 }} />}
      <div style={{ width:38, height:38, borderRadius:'50%', background:NAVY, display:'flex', alignItems:'center', justifyContent:'center', color:GOLD_PALE, fontWeight:700, fontSize:13, overflow:'hidden', flex:'0 0 38px' }}>
        {member.photo_url ? <img src={member.photo_url} alt={`${member.name} profile`} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : initials(member.name)}
      </div>
      <div style={{ minWidth:0 }}>
        <div style={{ fontWeight:700, fontSize:13, color:NAVY }}>{member.name}</div>
        <div style={{ fontSize:11, color:'#687780' }}>{member.supplier_name || 'Supplier not assigned'}</div>
        <div style={{ fontSize:11, marginTop:3, display:'flex', gap:10, flexWrap:'wrap' }}>
          {member.email ? <a href={`mailto:${firstContact(member.email)}`} style={{ color:BLUE, fontWeight:600, textDecoration:'none' }}>Email</a> : <span style={{ color:'#8a97a0' }}>No email</span>}
          {member.mobile ? <a href={whatsappLink(member.mobile)} target="_blank" rel="noreferrer" style={{ color:BLUE, fontWeight:600, textDecoration:'none' }}>WhatsApp</a> : <span style={{ color:'#8a97a0' }}>No mobile</span>}
        </div>
      </div>
    </div>
  );
}

function initials(name) { return String(name || '?').split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase(); }
function firstContact(value) { return String(value).split(/[;,]/)[0].trim(); }
function whatsappLink(value) {
  const digits = whatsappDigits(firstContact(value));
  return digits ? `https://wa.me/${digits}` : `tel:${encodeURIComponent(value)}`;
}
function whatsappDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^0[6-8]\d{8}$/.test(digits) ? `27${digits.slice(1)}` : digits;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(13,26,50,.58)',backdropFilter:'blur(3px)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center',padding:20 }}>
      <div style={{ background:'#f8fafb',borderRadius:16,width:wide?920:640,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 22px 62px rgba(13,26,50,.22)',border:'1px solid rgba(255,255,255,.7)' }}>
        <div style={{ background:`linear-gradient(110deg, ${NAVY_DEEP}, ${NAVY})`,borderTop:`3px solid ${BLUE}`,padding:'16px 22px',borderRadius:'16px 16px 0 0',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}><ClipboardPlus size={18} color={GOLD_PALE} /><span style={{ color:'#fff',fontWeight:700,fontSize:15 }}>{title}</span></div>
          <button onClick={onClose} aria-label="Close dialog" style={{ background:'rgba(255,255,255,.1)',border:'1px solid rgba(255,255,255,.2)',borderRadius:8,color:'#fff',fontSize:18,width:30,height:30,cursor:'pointer',lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:'24px 24px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block',fontSize:10,fontWeight:800,color:'#475b67',marginBottom:7,textTransform:'uppercase',letterSpacing:1.2 }}>
        {label}{required&&<span style={{color:'#E74C3C'}}>*</span>}
      </label>
      <div style={{ display:'contents' }}>
        {children}
      </div>
    </div>
  );
}

function InfoBlock({ label, value }) {
  return (
    <div>
      <div style={{ fontSize:10,color:'#888',textTransform:'uppercase',letterSpacing:.5,marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:13,fontWeight:600,color:'#1A1A1A' }}>{value}</div>
    </div>
  );
}

function formatDate(value) {
  return new Date(value).toLocaleString([], { dateStyle:'short', timeStyle:'short' });
}

function isOverdue(query) {
  return query.status !== 'COMPLETED' && query.slaDeadline && new Date(query.slaDeadline) < new Date();
}

function isSameDay(value) {
  if (!value) return false;
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

function timeAgo(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} hr ago`;
}

const inputBase = {
  width:'100%', border:'1px solid #dfe5e9', borderRadius:10,
  padding:'10px 12px', fontSize:14, boxSizing:'border-box',
  fontFamily:FONT, color:NAVY, background:'#fff', boxShadow:'inset 0 1px 2px rgba(15, 23, 42, 0.02)',
};
// Apply styles via global CSS in index.css instead of inline for inputs
const btnPrimary   = { background:BLUE, color:'#fff', border:'1px solid rgba(15, 89, 209, 0.35)', borderRadius:10, padding:'11px 22px', fontWeight:700, fontSize:14, cursor:'pointer', boxShadow:'0 8px 16px rgba(37, 99, 235, 0.14)' };
const btnSecondary = { background:'#F3F6F8', color:'#233646', border:'1px solid #dfe5e9', borderRadius:10, padding:'11px 22px', fontWeight:600, fontSize:14, cursor:'pointer' };
const viewExportButton = { display:'inline-flex', alignItems:'center', gap:6, background:'#fff', color:NAVY, border:'1px solid #cfdadd', borderRadius:5, padding:'8px 10px', fontSize:11, fontWeight:800, cursor:'pointer' };
const reportButton = { background:'rgba(255,255,255,.08)', color:GOLD_PALE, border:'1px solid rgba(255,255,255,.24)', borderRadius:4, padding:'10px 14px', fontWeight:800, fontSize:11, cursor:'pointer', boxShadow:'0 2px 8px rgba(0,0,0,.2)' };
const alertButton = { background:NAVY, color:'#fff', border:`1px solid ${NAVY}`, borderRadius:7, padding:'7px 12px', fontSize:11, fontWeight:800, cursor:'pointer', boxShadow:'0 3px 8px rgba(13,26,50,.16)' };
const iconButton = { width:34, height:34, display:'grid', placeItems:'center', border:'1px solid #d6dfdf', borderRadius:5, background:'#fff', color:NAVY, cursor:'pointer' };
const toastStyle = { position:'fixed', right:22, bottom:22, zIndex:300, width:'min(440px, calc(100vw - 32px))', display:'flex', alignItems:'center', gap:12, padding:14, background:'#fff', border:'1px solid #dce5e9', borderLeft:`4px solid ${BLUE}`, borderRadius:6, boxShadow:'0 12px 34px rgba(13,26,50,.24)', animation:'ops-toast-in .22s ease-out' };
const toastAction = { border:'1px solid #d6dfdf', borderRadius:4, background:'#f5f8fa', color:NAVY, padding:'7px 9px', fontSize:11, fontWeight:800, cursor:'pointer' };

function categoryAccent(category) {
  const accents = {
    'Stand Builder': '#4B83B2',
    'Graphics & Branding': '#8066A5',
    'Electrical': '#A28A5B',
    'Furniture': '#6D9C86',
    'AV / Technical': '#4F91B0',
    'Internet / Wi-Fi': '#4B9C9A',
    'Logistics / Freight / Loading Bay': '#C17C68',
    'Storage': '#82939D',
    'Cleaning & Waste': '#6F8C91',
    'Security': '#C66E68',
    'H&S / Medics': '#A48758',
    'Organiser': '#638EAF',
    'Other': '#71808A',
  };
  return accents[category] || BLUE;
}
