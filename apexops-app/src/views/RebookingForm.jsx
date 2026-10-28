import { useEffect, useState } from 'react';
import { CheckCircle2, Send, Sparkles } from 'lucide-react';
import { getPublicExhibitors, readableError, submitRebookingRequest } from '../lib/mock';
import { getActiveEvent } from '../lib/eventScope';
import { StatusBadge } from '../components/AppShell';

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
  const selectedExhibitor = exhibitors.find(item => item.name === form.company);

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

  async function submit(submitEvent) {
    submitEvent.preventDefault();
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

  if (submitted) {
    return (
      <>
        <Header nextEventName={nextEventName} />
        <section className="shell-panel" role="status">
          <CheckCircle2 size={40} color="#17724a" aria-hidden="true" />
          <h2 style={{ marginTop: 12 }}>Thank you for your interest</h2>
          <p>Your rebooking request has been recorded. Our team will review your preferences and contact you to discuss availability, stand options and next steps.</p>
          <p className="shell-note">Submitting this form does not constitute a binding booking or confirmation of stand allocation.</p>
        </section>
      </>
    );
  }

  return (
    <>
      <Header nextEventName={nextEventName} />
      <div className="form-layout">
        <form className="form-main" onSubmit={submit}>
          <section className="fm-section" aria-labelledby="company-details">
            <h2 id="company-details">Company &amp; contact details</h2>
            <p>Choose your company to fill in your stand automatically, then confirm your contact details.</p>
            <label className="fm-field" style={{ marginBottom: 16 }}>
              <span>Select your company from the exhibitor list</span>
              <select
                value={selectedExhibitor?.name || ''}
                onChange={event => {
                  const selected = exhibitors.find(item => item.name === event.target.value);
                  update('company', selected ? selected.name : '');
                  if (selected) update('current_stand', selected.stand || '');
                }}
              >
                <option value="">Choose an exhibitor</option>
                {exhibitors.map(item => <option key={`${item.stand}-${item.name}`} value={item.name}>{item.name} — Stand {item.stand}</option>)}
              </select>
              {selectedExhibitor?.logo_url && <img src={selectedExhibitor.logo_url} alt={`${form.company} logo`} className="fm-logo" />}
            </label>
            <div className="fm-grid">
              <Field label="Company" value={form.company} onChange={value => update('company', value)} required />
              <Field label="Job title" value={form.contact_title} onChange={value => update('contact_title', value)} placeholder="e.g. Marketing Manager" />
              <Field label="Primary contact" value={form.contact_person} onChange={value => update('contact_person', value)} required />
              <Field label="Mobile" value={form.mobile} onChange={value => update('mobile', value)} required />
              <Field label="Email" type="email" value={form.email} onChange={value => update('email', value)} required />
              <Field label="Current stand number" value={form.current_stand} onChange={value => update('current_stand', value.toUpperCase())} placeholder="e.g. A01" required />
            </div>
          </section>

          <section className="fm-section" aria-labelledby="stand-preferences">
            <h2 id="stand-preferences">Stand preferences</h2>
            <p>Tell us what you are looking for. Nothing here is binding.</p>
            <div className="fm-grid">
              <label className="fm-field"><span>Rebooking intent</span>
                <select value={form.interest} onChange={event => update('interest', event.target.value)}>
                  <option>Rebook current stand</option>
                  <option>Please contact me to discuss options</option>
                  <option>Maybe - I would like more information</option>
                  <option>No, not at this stage</option>
                </select>
              </label>
              <Field label="Preferred stand" value={form.preferred_stand} onChange={value => update('preferred_stand', value.toUpperCase())} placeholder="e.g. B05 or any nearby option" />
              <Select label="Stand size" value={form.stand_size} onChange={value => update('stand_size', value)} options={standSizeOptions} />
              <Select label="Preferred stand type" value={form.booth_type} onChange={value => update('booth_type', value)} options={boothTypeOptions} />
              <Select label="Sponsorship / speaking interest" value={form.sponsorship_interest} onChange={value => update('sponsorship_interest', value)} options={sponsorshipOptions} />
            </div>
          </section>

          <section className="fm-section" aria-labelledby="discussion-topics">
            <h2 id="discussion-topics">What would you like to discuss?</h2>
            <p>Select any topics that apply.</p>
            <div className="fm-chips" role="group" aria-labelledby="discussion-topics">
              {topics.map(topic => (
                <label key={topic} className="fm-chip">
                  <input type="checkbox" checked={form.discussion_topics.includes(topic)} onChange={() => toggleTopic(topic)} />
                  <span>{topic}</span>
                </label>
              ))}
            </div>
            <label className="fm-field" style={{ marginTop: 16 }}><span>Additional notes</span>
              <textarea value={form.notes} onChange={event => update('notes', event.target.value)} rows={5} placeholder="Tell us about your preferred location, booth requirements, sponsorship ideas, or any other considerations." />
            </label>
          </section>

          {error && <div className="shell-alert" role="alert">{error}</div>}
          <div className="fm-actions">
            <button type="submit" className="shell-primary" disabled={saving}><Send size={16} aria-hidden="true" /> {saving ? 'Submitting...' : 'Submit rebooking request'}</button>
          </div>
        </form>

        <aside className="summary-card" aria-label="Request summary">
          <h2>Request summary</h2>
          <dl>
            <SummaryRow label="Company" value={form.company || 'Pending'} />
            <SummaryRow label="Contact" value={form.contact_person || 'Pending'} />
            <SummaryRow label="Current stand" value={form.current_stand || 'Not supplied'} />
            <SummaryRow label="Interest" value={form.interest} />
            <SummaryRow label="Preferred stand" value={form.preferred_stand || 'Open to options'} />
            <SummaryRow label="Stand size" value={form.stand_size} />
            <SummaryRow label="Booth type" value={form.booth_type} />
          </dl>
          <p className="summary-note">This form records your expression of interest only and does not constitute a binding booking or stand allocation.</p>
        </aside>
      </div>
    </>
  );
}

function Header({ nextEventName }) {
  return (
    <div className="page-header with-badge">
      <div>
        <div className="crumbs">Exhibitors <span aria-hidden="true">/</span> Rebooking</div>
        <h1>Rebook your stand</h1>
        <p>Secure your preferred position early and let our team know how you would like to participate in {nextEventName}.</p>
      </div>
      <StatusBadge icon={Sparkles}>Expression of interest</StatusBadge>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, required }) {
  return (
    <label className="fm-field">
      <span>{label}{required && <span className="req" aria-hidden="true"> *</span>}</span>
      <input required={required} type={type} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    </label>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="fm-field"><span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)}>
        {options.map(option => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function SummaryRow({ label, value }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
