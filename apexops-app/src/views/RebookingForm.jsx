import { useEffect, useState } from 'react';
import { CheckCircle2, Send, Sparkles } from 'lucide-react';
import { getPublicExhibitors, readableError, submitRebookingRequest } from '../lib/mock';
import { getActiveEvent } from '../lib/eventScope';
import { NAVY, NAVY_DEEP, GOLD_PALE, BLUE, TEAL, CORAL, FONT } from '../theme';

const emptyForm = {
  company: '',
  contact_person: '',
  contact_title: '',
  email: '',
  mobile: '',
  current_stand: '',
  interest: 'Rebook current stand',
  preferred_stand: '',
  stand_size: '6 sqm',
  booth_type: 'Shell scheme',
  sponsorship_interest: 'No',
  discussion_topics: [],
  notes: '',
};

const topics = ['Rebook current stand', 'Different stand/location', 'Larger stand', 'Sponsorship', 'Speaking opportunity', 'Other'];
const standSizeOptions = ['6 sqm', '9 sqm', '18 sqm'];
const boothTypeOptions = ['Shell scheme', 'Custom build', 'Corner stand', 'Island stand', 'Not sure yet'];
const sponsorshipOptions = ['No', 'Yes, I would like to discuss', 'Maybe / not sure'];

export default function RebookingForm() {
  const event = getActiveEvent();
  const nextEventName = event?.next_event_name || 'the next event';
  const [form, setForm] = useState(emptyForm);
  const [exhibitors, setExhibitors] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPublicExhibitors()
      .then((items) => setExhibitors(items || []))
      .catch(() => setExhibitors([]));
  }, []);

  function update(field, value) {
    setForm(current => ({ ...current, [field]: value }));
  }

  function toggleTopic(topic) {
    setForm(current => ({
      ...current,
      discussion_topics: current.discussion_topics.includes(topic)
        ? current.discussion_topics.filter(item => item !== topic)
        : [...current.discussion_topics, topic],
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await submitRebookingRequest(form);
      setSubmitted(true);
    } catch (submitError) {
      setError(readableError(submitError, 'Could not submit your rebooking request.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="apex-service-screen rebooking-screen" style={pageStyle}>
      <header className="apex-service-header" style={headerStyle}>
        <div>
          <div style={{ color: GOLD_PALE, fontWeight: 700, fontSize: 20, letterSpacing: 2 }}>APEXOPS™</div>
          <div style={eyebrowStyle}>Exhibitor rebooking</div>
        </div>
        <div style={{ color: 'rgba(255,255,255,.66)', fontSize: 12 }}>{event?.name || 'Exhibitor rebooking'}</div>
      </header>

      <main className="apex-service-main rebooking-main" style={mainStyle}>
        {submitted ? (
          <section className="apex-service-panel" style={cardStyle}>
            <CheckCircle2 size={42} color={TEAL} />
            <div style={eyebrowStyle}>Request received</div>
            <h1 style={headingStyle}>Thank you for your interest.</h1>
            <p style={copyStyle}>Your rebooking request has been recorded. Our team will review your preferences and contact you to discuss availability, stand options, and next steps.</p>
            <p style={finePrintStyle}>Submitting this form does not constitute a binding booking or confirmation of stand allocation.</p>
          </section>
        ) : (
          <section className="apex-service-panel" style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={eyebrowStyle}>{nextEventName}</div>
                <h1 style={headingStyle}>Rebook your stand</h1>
              </div>
              <div style={trustBadge}><Sparkles size={14} /> Expression of interest</div>
            </div>

            <p style={copyStyle}>Secure your preferred position early and let our team know how you would like to participate in {nextEventName}.</p>

            <div style={layoutGrid}>
              <form className="rebooking-form" onSubmit={submit} style={{ display: 'grid', gap: 18 }}>
                <div className="rebooking-section" style={panelStyle}>
                  <div style={sectionTitle}>Company &amp; contact details</div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>Select your company from the exhibitor list
                      <select
                        value={exhibitors.find(item => item.name === form.company)?.name || ''}
                        onChange={event => {
                          const selectedName = event.target.value;
                          const selected = exhibitors.find(item => item.name === selectedName);
                          update('company', selected ? selected.name : '');
                          if (selected) update('current_stand', selected.stand || '');
                        }}
                        style={inputStyle}
                      >
                        <option value="">Choose an exhibitor</option>
                        {exhibitors.map(item => <option key={`${item.stand}-${item.name}`} value={item.name}>{item.name} — Stand {item.stand}</option>)}
                      </select>
                    </label>
                    {exhibitors.find(item => item.name === form.company)?.logo_url && (
                      <img
                        src={exhibitors.find(item => item.name === form.company).logo_url}
                        alt={`${form.company} logo`}
                        style={selectedLogoStyle}
                      />
                    )}
                  </div>
                  <div style={fieldGrid}>
                    <Field label="Company" value={form.company} onChange={value => update('company', value)} required />
                    <Field label="Job title" value={form.contact_title} onChange={value => update('contact_title', value)} placeholder="e.g. Marketing Manager" />
                    <Field label="Primary contact" value={form.contact_person} onChange={value => update('contact_person', value)} required />
                    <Field label="Mobile" value={form.mobile} onChange={value => update('mobile', value)} required />
                    <Field label="Email" type="email" value={form.email} onChange={value => update('email', value)} required />
                    <Field label="Current stand number" value={form.current_stand} onChange={value => update('current_stand', value.toUpperCase())} placeholder="e.g. A01" required />
                  </div>
                </div>

                <div className="rebooking-section" style={panelStyle}>
                  <div style={sectionTitle}>Stand preferences</div>
                  <div style={fieldGrid}>
                    <label style={labelStyle}>Rebooking intent
                      <select value={form.interest} onChange={event => update('interest', event.target.value)} style={inputStyle}>
                        <option>Rebook current stand</option>
                        <option>Please contact me to discuss options</option>
                        <option>Maybe - I would like more information</option>
                        <option>No, not at this stage</option>
                      </select>
                    </label>
                    <Field label="Preferred stand" value={form.preferred_stand} onChange={value => update('preferred_stand', value.toUpperCase())} placeholder="e.g. B05 or any nearby option" />
                    <label style={labelStyle}>Stand size
                      <select value={form.stand_size} onChange={event => update('stand_size', event.target.value)} style={inputStyle}>
                        {standSizeOptions.map(option => <option key={option}>{option}</option>)}
                      </select>
                    </label>
                    <label style={labelStyle}>Preferred stand type
                      <select value={form.booth_type} onChange={event => update('booth_type', event.target.value)} style={inputStyle}>
                        {boothTypeOptions.map(option => <option key={option}>{option}</option>)}
                      </select>
                    </label>
                    <label style={labelStyle}>Sponsorship / speaking interest
                      <select value={form.sponsorship_interest} onChange={event => update('sponsorship_interest', event.target.value)} style={inputStyle}>
                        {sponsorshipOptions.map(option => <option key={option}>{option}</option>)}
                      </select>
                    </label>
                  </div>
                </div>

                <div className="rebooking-section" style={panelStyle}>
                  <div style={sectionTitle}>What would you like to discuss?</div>
                  <fieldset style={fieldsetStyle}>
                    <legend style={labelStyle}>Topics</legend>
                    <div style={topicGrid}>{topics.map(topic => <label key={topic} style={checkLabel}><input type="checkbox" style={topicCheckboxStyle} checked={form.discussion_topics.includes(topic)} onChange={() => toggleTopic(topic)} /> <span>{topic}</span></label>)}</div>
                  </fieldset>

                  <label style={{ ...labelStyle, marginTop: 16 }}>Additional notes
                    <textarea value={form.notes} onChange={event => update('notes', event.target.value)} style={textareaStyle} rows={5} placeholder="Tell us about your preferred location, booth requirements, sponsorship ideas, or any other considerations." />
                  </label>
                </div>

                {error && <div style={{ color: CORAL, fontSize: 13 }}>{error}</div>}
                <button type="submit" disabled={saving} style={submitButton}><Send size={16} /> {saving ? 'Submitting...' : 'Submit rebooking request'}</button>
              </form>

              <aside className="rebooking-summary" style={summaryCard}>
                <div style={summaryTitle}>Request summary</div>
                <div style={summaryItem}><span style={summaryLabel}>Company</span><strong>{form.company || 'Pending'}</strong></div>
                <div style={summaryItem}><span style={summaryLabel}>Contact</span><strong>{form.contact_person || 'Pending'}</strong></div>
                <div style={summaryItem}><span style={summaryLabel}>Current stand</span><strong>{form.current_stand || 'Not supplied'}</strong></div>
                <div style={summaryItem}><span style={summaryLabel}>Interest</span><strong>{form.interest}</strong></div>
                <div style={summaryItem}><span style={summaryLabel}>Preferred stand</span><strong>{form.preferred_stand || 'Open to options'}</strong></div>
                <div style={summaryItem}><span style={summaryLabel}>Stand size</span><strong>{form.stand_size}</strong></div>
                <div style={summaryItem}><span style={summaryLabel}>Booth type</span><strong>{form.booth_type}</strong></div>
                <div style={summaryNote}>This form records your expression of interest only and does not constitute a binding booking or stand allocation.</div>
              </aside>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, required }) {
  return <label style={labelStyle}>{label}<input required={required} type={type} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} style={inputStyle} /></label>;
}

const pageStyle = { fontFamily: FONT, minHeight: '100vh', background: `linear-gradient(120deg, ${NAVY_DEEP}, ${NAVY})`, color: NAVY };
const headerStyle = { color: '#fff', padding: '30px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 16 };
const mainStyle = { maxWidth: 1100, margin: '0 auto', padding: '14px 20px 64px' };
const cardStyle = { background: '#fff', borderRadius: 18, padding: '32px clamp(22px, 4vw, 40px)', boxShadow: '0 20px 50px rgba(0,0,0,.22)' };
const eyebrowStyle = { color: GOLD_PALE, fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase', fontWeight: 700, marginTop: 8 };
const headingStyle = { color: NAVY, fontSize: 34, lineHeight: 1.05, margin: '8px 0 10px' };
const copyStyle = { color: '#61727b', fontSize: 14, lineHeight: 1.7, margin: '0 0 24px' };
const finePrintStyle = { color: '#819098', fontSize: 11, lineHeight: 1.5, margin: '18px 0 0' };
const layoutGrid = { display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(260px, 0.8fr)', gap: 18, alignItems: 'start' };
const panelStyle = { background: '#f7fafb', border: '1px solid #e7eef0', borderRadius: 12, padding: 18 };
const sectionTitle = { fontSize: 14, fontWeight: 800, color: NAVY, marginBottom: 14, letterSpacing: 0.4 };
const fieldGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 };
const labelStyle = { display: 'grid', gap: 6, color: NAVY, fontSize: 12, fontWeight: 700 };
const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8e1e5', borderRadius: 8, padding: '11px 12px', color: NAVY, fontSize: 14, fontFamily: FONT, background: '#fff' };
const selectedLogoStyle = { width: 44, height: 44, objectFit: 'contain', borderRadius: 6, border: '1px solid #dfe7eb', background: '#fff', padding: 4, marginTop: 8 };
const textareaStyle = { ...inputStyle, resize: 'vertical', minHeight: 110 };
const fieldsetStyle = { border: '1px solid #dfe7e8', borderRadius: 8, padding: '14px 16px', margin: 0 };
const topicGrid = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 10 };
const checkLabel = { display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10, minHeight: 48, boxSizing: 'border-box', textAlign: 'left', fontSize: 12, color: NAVY, border: '1px solid #dfe7e8', borderRadius: 999, background: '#fff', padding: '8px 16px', fontWeight: 600 };
const topicCheckboxStyle = { width: 16, height: 16, flex:'0 0 16px', margin: 0, accentColor: BLUE };
const submitButton = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: `linear-gradient(135deg, ${BLUE}, ${TEAL})`, color: '#fff', border: 'none', borderRadius: 10, padding: '14px 18px', fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: '0 14px 26px rgba(27, 92, 138, 0.22)' };
const trustBadge = { display: 'inline-flex', alignItems: 'center', gap: 8, background: '#eefaf8', color: '#1d6d60', border: '1px solid #cceae4', borderRadius: 999, padding: '8px 12px', fontSize: 12, fontWeight: 700 };
const summaryCard = { background: 'linear-gradient(180deg, #f5f9fb 0%, #edf5ff 100%)', border: '1px solid #dfeaf2', borderRadius: 14, padding: 18, position: 'sticky', top: 18 };
const summaryTitle = { fontSize: 15, fontWeight: 800, color: NAVY, marginBottom: 12 };
const summaryItem = { display: 'grid', gap: 4, padding: '10px 0', borderBottom: '1px solid #e0e9ef', color: NAVY };
const summaryLabel = { color: '#5e6c73', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 };
const summaryNote = { marginTop: 16, color: '#607178', fontSize: 11, lineHeight: 1.6 };
