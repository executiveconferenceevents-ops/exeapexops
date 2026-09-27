import { useEffect, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, ClipboardPlus, Search } from 'lucide-react';
import QueryForm from '../components/QueryForm';
import { escalatePublicQuery, getPublicExhibitors, getPublicStatus, normalizeStand, readableError, STATUS_COLORS, submitClientQuery } from '../lib/mock';
import { NAVY, NAVY_DEEP, GOLD_PALE, BLUE, TEAL, CORAL, FONT } from '../theme';

export default function ExhibitorStatus() {
  const [stand, setStand] = useState('');
  const [searchMode, setSearchMode] = useState('number');
  const [exhibitors, setExhibitors] = useState([]);
  const [resolvedStand, setResolvedStand] = useState('');
  const [searched, setSearched] = useState(false);
  const [queries, setQueries] = useState([]);
  const [showQueryForm, setShowQueryForm] = useState(false);
  const [escalationNotes, setEscalationNotes] = useState({});
  const [escalatingId, setEscalatingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState(false);

  useEffect(() => {
    getPublicExhibitors().then(setExhibitors).catch(loadError => setError(readableError(loadError, 'Stand names are temporarily unavailable.')));
  }, []);

  useEffect(() => {
    if (!searched || !resolvedStand) return undefined;
    let cancelled = false;
    const refreshStatus = async () => {
      try {
        const nextQueries = await getPublicStatus(resolvedStand);
        if (!cancelled) setQueries(deduplicateQueries(nextQueries));
      } catch (statusError) {
        if (!cancelled) setError(readableError(statusError, 'Status is temporarily unavailable.'));
      }
    };
    const timer = window.setInterval(refreshStatus, 10000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [searched, resolvedStand]);

  const normalizedStand = resolvedStand || normalizeStand(stand);
  const matchedExhibitor = exhibitors.find(item => normalizeStand(item.stand) === normalizedStand);
  const uniqueQueries = deduplicateQueries(queries);
  const activeQueries = uniqueQueries.filter(query => query.status !== 'COMPLETED');
  const completedQueries = uniqueQueries.filter(query => query.status === 'COMPLETED');

  async function search(event) {
    event.preventDefault();
    const selected = searchMode === 'name' ? exhibitors.find(item => item.name === stand) : { stand: normalizeStand(stand) };
    if (!selected?.stand) return;
    try {
      setQueries(deduplicateQueries(await getPublicStatus(selected.stand)));
      setResolvedStand(selected.stand);
      setSearched(true);
      setError('');
      setMessage('');
      setDuplicateWarning(false);
    } catch (statusError) {
      setError(readableError(statusError, 'Status is temporarily unavailable.'));
    }
  }

  async function submitQuery(query) {
    setError('');
    try {
      const result = await submitClientQuery({ ...query, sourceTab: 'CLIENT' });
      setShowQueryForm(false);
      setDuplicateWarning(result.duplicate);
      setMessage(result.duplicate
        ? `This issue was already submitted as ${result.query.id}. We did not create another query.`
        : `Query ${result.query.id} was sent to the Ops Desk.`);
      try {
        setQueries(deduplicateQueries(await getPublicStatus(normalizedStand)));
      } catch (refreshError) {
        setError(readableError(refreshError, 'Your query was submitted, but status could not refresh yet.'));
      }
    } catch (submitError) {
      throw new Error(readableError(submitError, 'Could not send your query to the Ops Desk.'));
    }
  }

  async function escalate(query) {
    setEscalatingId(query.id);
    setError('');
    try {
      await escalatePublicQuery({ queryId: query.id, stand: normalizedStand, message: escalationNotes[query.id] || '' });
      setQueries(current => deduplicateQueries(current.map(item => item.id === query.id ? { ...item, status: 'ESCALATED' } : item)));
      setEscalationNotes(current => ({ ...current, [query.id]: '' }));
      setMessage(`${query.id} was escalated to the Ops Desk.`);
      try {
        setQueries(deduplicateQueries(await getPublicStatus(normalizedStand)));
      } catch (refreshError) {
        setError(readableError(refreshError, 'Escalation was submitted, but status could not refresh yet.'));
      }
    } catch (escalationError) {
      const details = readableError(escalationError, 'Could not escalate this query.');
      setError(/schema cache|could not find the function/i.test(details)
        ? 'Escalation is not enabled in Supabase yet. Run supabase/client-ops-notifications-migration.sql in the Supabase SQL Editor, then retry.'
        : details);
    } finally {
      setEscalatingId('');
    }
  }

  const queryInitialValues = { stand: matchedExhibitor?.stand || normalizedStand, exhibitor: matchedExhibitor?.name || '' };

  return <div style={pageStyle}>
    <header style={headerStyle}>
      <div><div style={{ color: GOLD_PALE, fontWeight: 700, fontSize: 20, letterSpacing: 2 }}>APEXOPS™</div><div style={eyebrowStyle}>Exhibitor service desk</div></div>
      <div style={{ color: 'rgba(255,255,255,.66)', fontSize: 12 }}>Live query status</div>
    </header>
    <main style={mainStyle}>
      <section style={cardStyle}>
        <div style={titleRow}><div style={iconBox}><Building2 size={20} /></div><div><h1 style={headingStyle}>Check My Status</h1><p style={copyStyle}>Find live requests for your stand or send a new issue directly to the Ops Desk.</p></div></div>
        <form onSubmit={search}>
          <div style={modeRow}>{[['number', 'Stand number'], ['name', 'Stand name']].map(([mode, label]) => <button type="button" key={mode} onClick={() => { setSearchMode(mode); setStand(''); setResolvedStand(''); setSearched(false); setQueries([]); }} style={{ ...modeButton, borderColor: searchMode === mode ? BLUE : '#dce4e5', color: searchMode === mode ? NAVY : '#687780' }}>{label}</button>)}</div>
          <label style={labelStyle}>{searchMode === 'number' ? 'Your stand number' : 'Your stand name'}
            {searchMode === 'number' ? <input required value={stand} onChange={event => { setStand(event.target.value.toUpperCase()); setResolvedStand(''); setSearched(false); }} placeholder="e.g. A01 or A1" style={inputStyle} /> : <select required value={stand} onChange={event => { setStand(event.target.value); setResolvedStand(''); setSearched(false); }} style={inputStyle}><option value="">Select an exhibitor and stand</option>{exhibitors.map(item => <option key={`${item.stand}-${item.name}`} value={item.name}>{item.name} - Stand {item.stand}</option>)}</select>}
          </label>
          <button type="submit" style={checkButton}><Search size={16} /> Check My Status</button>
        </form>
      </section>

      {error && <div role="alert" style={errorStyle}>{error}</div>}
      {message && <div role="status" style={duplicateWarning ? warningStyle : successStyle}><CheckCircle2 size={16} /> {message}</div>}

      {searched && <section style={resultStyle}>
        <div style={resultHeading}>
          {matchedExhibitor?.logo_url && <img src={matchedExhibitor.logo_url} alt={`${matchedExhibitor.name} logo`} style={resultLogoStyle} />}
          <div><div style={eyebrowStyle}>Stand</div><h2 style={standHeading}>{matchedExhibitor?.name || 'Your stand'} <span>· {matchedExhibitor?.stand || normalizedStand}</span></h2></div>
          <button onClick={() => setShowQueryForm(true)} style={queryButton}><ClipboardPlus size={16} /> Log a Query</button>
        </div>
        {activeQueries.length ? <>
          <div style={activeCountStyle}>OPEN QUERIES ({activeQueries.length})</div>
          {activeQueries.map(query => {
          const statusColor = STATUS_COLORS[query.status] || STATUS_COLORS.LOGGED;
          return <article key={query.id} style={{ ...queryCard, borderLeftColor: statusColor.badge }}>
            <div style={queryTop}><div><div style={smallLabel}>Query reference</div><strong style={reference}>{query.id}</strong></div><span style={{ ...statusPill, background: statusColor.badge }}>{query.status}</span></div>
            <p style={descriptionStyle}>{query.description}</p>
            <div style={queryFooter}><span>{query.category}</span><span>Logged {timeAgo(query.loggedAt)}</span></div>
            {query.status === 'ESCALATED' ? <div style={escalatedStyle}><AlertTriangle size={15} /> Your query has been escalated to the Ops Desk.</div> : <div style={escalationArea}>
              <label style={labelStyle}>Need urgent attention? <textarea rows={2} value={escalationNotes[query.id] || ''} onChange={event => setEscalationNotes(current => ({ ...current, [query.id]: event.target.value }))} placeholder="Optional: tell Ops why this needs attention" style={{ ...inputStyle, resize: 'vertical' }} /></label>
              <button disabled={Boolean(escalatingId)} onClick={() => escalate(query)} style={{ ...escalateButton, opacity: escalatingId ? 0.7 : 1 }}>{escalatingId === query.id ? 'Submitting...' : 'Escalate to Ops Desk'}</button>
            </div>}
          </article>;
          })}
        </> : <div style={emptyStyle}><CheckCircle2 size={25} color={TEAL} /><strong>{completedQueries.length ? 'All current queries are complete' : 'No active queries found'}</strong><span>{completedQueries.length ? `${completedQueries.length} completed ${completedQueries.length === 1 ? 'query' : 'queries'} for this stand.` : 'You can send a new request to the Ops Desk using Log a Query.'}</span></div>}
      </section>}
    </main>

    {showQueryForm && <div style={overlay}>
      <section style={modalStyle}>
        <div style={modalHeader}><strong>Log a Query</strong><button aria-label="Close" onClick={() => setShowQueryForm(false)} style={closeButton}>×</button></div>
        <div style={{ padding: 20 }}><QueryForm exhibitors={exhibitors} initialValues={queryInitialValues} onSubmit={submitQuery} onCancel={() => setShowQueryForm(false)} clientMode /></div>
      </section>
    </div>}
  </div>;
}

function timeAgo(value) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} hr ago`;
}

function deduplicateQueries(items) {
  const uniqueByIssue = new Map();
  const seenIds = new Set();
  for (const query of items) {
    if (seenIds.has(query.id)) continue;
    seenIds.add(query.id);
    if (query.status === 'COMPLETED') {
      uniqueByIssue.set(`completed:${query.id}`, query);
      continue;
    }
    const issueKey = `${normalizeStand(query.stand)}:${String(query.category || '').trim().toLowerCase()}:${normalizeIssue(query.description)}`;
    const existing = uniqueByIssue.get(issueKey);
    if (!existing || statusPriority(query.status) > statusPriority(existing.status)) uniqueByIssue.set(issueKey, query);
  }
  return [...uniqueByIssue.values()];
}

function normalizeIssue(value) {
  return [...new Set(String(value || '')
    .split(';')
    .map(issue => issue.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean))]
    .sort()
    .join(';');
}

function statusPriority(status) {
  return { LOGGED: 1, PENDING: 2, ASSIGNED: 2, 'IN PROGRESS': 3, 'ISSUES/DELAYED': 4, ESCALATED: 5 }[status] || 0;
}

const pageStyle = { fontFamily: FONT, minHeight: '100vh', background: `radial-gradient(circle at 90% 12%, rgba(180,154,106,.14), transparent 28%), linear-gradient(120deg, ${NAVY_DEEP} 0%, ${NAVY} 58%, #273958 100%)`, padding: '0 20px 48px' };
const headerStyle = { width: '100%', maxWidth: 920, margin: '0 auto', padding: '34px 0 30px', display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 16 };
const mainStyle = { width: '100%', maxWidth: 760, margin: '0 auto' };
const cardStyle = { background: '#fff', borderTop: `3px solid ${BLUE}`, padding: 24, boxShadow: '0 12px 34px rgba(0,0,0,.2)' };
const titleRow = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 };
const iconBox = { width: 38, height: 38, borderRadius: 5, background: '#D9EAF6', color: BLUE, display: 'grid', placeItems: 'center', flex: '0 0 38px' };
const eyebrowStyle = { color: '#718089', fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: 700 };
const headingStyle = { color: NAVY, fontSize: 22, margin: '3px 0 0' };
const copyStyle = { color: '#718089', fontSize: 12, lineHeight: 1.5, margin: '4px 0 0' };
const modeRow = { display: 'flex', gap: 8, marginBottom: 14 };
const modeButton = { flex: 1, border: '1px solid', borderRadius: 5, padding: 10, background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const labelStyle = { display: 'grid', gap: 6, color: '#555', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' };
const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #cfdadd', borderRadius: 5, padding: '10px 12px', fontSize: 14, color: NAVY, textTransform: 'none' };
const checkButton = { marginTop: 12, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: BLUE, color: '#fff', border: 0, borderRadius: 5, padding: 12, fontWeight: 800, cursor: 'pointer' };
const queryButton = { display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, borderRadius: 5, padding: '10px 12px', background: NAVY, color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const resultStyle = { marginTop: 14, padding: 20, background: 'rgba(255,255,255,.96)', borderTop: `3px solid ${TEAL}`, boxShadow: '0 12px 34px rgba(0,0,0,.18)' };
const resultHeading = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 };
const resultLogoStyle = { width: 52, height: 52, objectFit: 'contain', borderRadius: 8, border: '1px solid #dfe7eb', background: '#fff', padding: 4, flex: '0 0 52px' };
const standHeading = { margin: '5px 0 0', color: NAVY, fontSize: 18 };
const smallLabel = { color: '#718089', fontSize: 10, textTransform: 'uppercase', letterSpacing: .8 };
const queryCard = { border: '1px solid #e2e9ed', borderLeft: `3px solid ${BLUE}`, padding: 14, marginTop: 10, background: '#fff' };
const queryTop = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 };
const reference = { display: 'block', color: NAVY, fontSize: 15, marginTop: 3 };
const statusPill = { color: '#fff', borderRadius: 4, padding: '5px 8px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' };
const descriptionStyle = { color: '#33454f', fontSize: 13, lineHeight: 1.5, margin: '12px 0' };
const queryFooter = { display: 'flex', justifyContent: 'space-between', gap: 10, color: '#718089', fontSize: 11, borderTop: '1px solid #edf0f1', paddingTop: 9 };
const activeCountStyle = { margin: '0 0 10px', color: '#718089', fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' };
const escalationArea = { display: 'flex', alignItems: 'end', gap: 10, marginTop: 12 };
const escalateButton = { flex: '0 0 auto', border: 0, borderRadius: 5, padding: '10px 12px', background: CORAL, color: '#fff', fontSize: 11, fontWeight: 800, cursor: 'pointer' };
const escalatedStyle = { display: 'flex', alignItems: 'center', gap: 7, color: '#9e3f37', background: '#fff2f0', border: '1px solid #f2d4d1', padding: 10, marginTop: 12, fontSize: 12, fontWeight: 700 };
const emptyStyle = { display: 'grid', justifyItems: 'center', gap: 8, padding: 28, color: '#61727b', textAlign: 'center', fontSize: 12 };
const errorStyle = { marginTop: 12, padding: 12, background: '#FDEDEC', color: '#922B21', fontSize: 13 };
const successStyle = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, background: '#EAF7EF', color: '#1E8449', fontSize: 12, fontWeight: 700 };
const warningStyle = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, background: '#FFF7E8', color: '#805C16', border: '1px solid #F0DCA9', fontSize: 12, fontWeight: 700 };
const overlay = { position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(8,20,34,.58)' };
const modalStyle = { width: 680, maxWidth: '96vw', maxHeight: '90vh', overflowY: 'auto', background: '#fff', boxShadow: '0 18px 48px rgba(0,0,0,.28)' };
const modalHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', color: '#fff', background: NAVY, fontSize: 14 };
const closeButton = { border: 0, background: 'transparent', color: '#fff', fontSize: 22, cursor: 'pointer' };
