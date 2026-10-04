import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardPlus } from 'lucide-react';
import QueryForm from '../components/QueryForm';
import { getPublicExhibitors, submitClientQuery, readableError } from '../lib/mock';
import { supabase } from '../lib/supabase';
import { NAVY, NAVY_DEEP, GOLD_PALE, BLUE, TEAL, FONT } from '../theme';

export default function ClientQuery() {
  const [exhibitors, setExhibitors] = useState([]);
  const [savedQuery, setSavedQuery] = useState(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getPublicExhibitors().then(setExhibitors).catch(loadError => setError(readableError(loadError, 'Exhibitors are temporarily unavailable.')));
  }, []);

  async function submit(query) {
    try {
      const result = await submitClientQuery(query);
      setSavedQuery(result.query);
      setAlreadySubmitted(result.duplicate);
    } catch (saveError) {
      throw new Error(readableError(saveError, 'Could not send this query to the Ops Desk.'));
    }
  }

  return <div className="apex-service-screen client-query-screen" style={pageStyle}>
    <header className="apex-service-header" style={headerStyle}>
      <div><div style={{ color: GOLD_PALE, fontWeight: 700, fontSize: 20, letterSpacing: 2 }}>APEXOPS™</div><div style={eyebrowStyle}>Exhibitor service desk</div></div>
      <div style={{ color: 'rgba(255,255,255,.66)', fontSize: 12 }}>Send a request to the Ops Desk</div>
    </header>
    <main className="apex-service-main" style={mainStyle}>
      {savedQuery ? <section className="apex-service-panel" style={cardStyle}>
        <CheckCircle2 size={40} color={TEAL} />
        <div style={eyebrowStyle}>{alreadySubmitted ? 'Already submitted' : 'Query sent to Ops'}</div>
        <h1 style={headingStyle}>{alreadySubmitted ? 'This issue is already logged.' : 'Your request is in the queue.'}</h1>
        <p style={copyStyle}>{alreadySubmitted ? 'We did not create another query. Use this existing reference if you contact the Ops Desk:' : 'Reference'} <strong>{savedQuery.id}</strong> for Stand {savedQuery.stand}. {!alreadySubmitted && 'The Ops Desk will assign the right team.'}</p>
        {!supabase && <p style={{ color: '#922B21', fontSize: 12 }}>Demo mode: Supabase is not connected, so this query is only saved in this browser.</p>}
      </section> : <section className="apex-service-panel" style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}><div style={iconBox}><ClipboardPlus size={20} /></div><div><div style={eyebrowStyle}>Client request</div><h1 style={headingStyle}>Log a query</h1></div></div>
        <p style={copyStyle}>Share the issue at your stand. Your request will be sent to the Ops Desk, where a team member will assign staff.</p>
        {error && <div role="alert" style={{ color: '#922B21', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <QueryForm exhibitors={exhibitors} onSubmit={submit} clientMode />
      </section>}
    </main>
  </div>;
}

const pageStyle = { fontFamily: FONT, minHeight: '100vh', background: `linear-gradient(120deg, ${NAVY_DEEP}, ${NAVY})`, color: NAVY };
const headerStyle = { color: '#fff', padding: '30px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 16 };
const mainStyle = { maxWidth: 760, margin: '0 auto', padding: '14px 20px 64px' };
const cardStyle = { background: '#fff', borderTop: `3px solid ${BLUE}`, padding: '28px clamp(20px, 4vw, 36px)', boxShadow: '0 16px 38px rgba(0,0,0,.24)' };
const eyebrowStyle = { color: '#627481', fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: 700, marginTop: 7 };
const headingStyle = { color: NAVY, fontSize: 28, lineHeight: 1.08, margin: '6px 0 8px' };
const copyStyle = { color: '#61727b', fontSize: 13, lineHeight: 1.6, margin: '0 0 18px' };
const iconBox = { width: 38, height: 38, display: 'grid', placeItems: 'center', background: '#D9EAF6', color: BLUE, borderRadius: 5 };
