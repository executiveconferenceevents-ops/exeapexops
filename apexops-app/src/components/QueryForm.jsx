import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, ChevronDown, Send, X } from 'lucide-react';
import { CATEGORIES, EST_OPTIONS, prepareQueryPhoto, QUERY_PHOTO_LIMIT } from '../lib/mock';
import { categoryVisual } from '../lib/categoryIcons';
import './QueryForm.css';

const DEPARTMENT_ISSUES = {
  'Stand Builder': ['Stand not ready', 'Stand build delayed', 'Incorrect stand number', 'Missing walls', 'Carpet missing/damaged', 'Fascia missing/incorrect', 'Furniture/stand items missing', 'Builder still working'],
  'Graphics & Branding': ['Graphics missing', 'Graphics incorrect', 'Graphics damaged', 'Graphics not installed', 'Fascia branding incorrect', 'Sponsor branding missing', 'Signage missing'],
  Electrical: ['No power', 'Power not installed', 'Power point incorrect', 'Additional power required', 'Power not working', 'Power tripping', 'Cable/trip hazard'],
  Furniture: ['Furniture missing', 'Incorrect quantity', 'Incorrect furniture', 'Furniture damaged', 'Furniture dirty', 'Additional furniture required'],
  'AV / Technical': ['AV equipment missing', 'Screen/monitor issue', 'Microphone issue', 'Sound issue', 'Presentation issue', 'Technical setup delayed', 'Technician required'],
  'Internet / Wi-Fi': ['No Wi-Fi', 'Wi-Fi not working', 'Slow connection', 'Cannot connect', 'Registration/payment connection issue', 'Additional internet required'],
  'Logistics / Freight / Loading Bay': ['Delivery not received', 'Freight missing', 'Freight damaged', 'Freight delivered to wrong stand', 'Loading bay congested', 'Vehicle/access issue', 'Delivery delayed'],
  Storage: ['No storage space', 'Storage full', 'Boxes/crates require removal', 'Freight requires storage', 'Item cannot be located'],
  'Cleaning & Waste': ['Stand dirty', 'Carpet dirty', 'Construction waste', 'Packaging/waste not removed', 'Bin required/overflowing', 'Exhibition area requires cleaning'],
  Security: ['Access issue', 'Contractor/supplier access issue', 'Vehicle access issue', 'Missing item/equipment', 'Security assistance required'],
  'H&S / Medics': ['Trip hazard', 'Blocked aisle/exit', 'Unsafe construction', 'Electrical safety issue', 'Injury/medical assistance', 'Other safety concern'],
  Organiser: ['Exhibitor requires assistance', 'Stand/location query', 'Registration/badge issue', 'Sponsor deliverable issue', 'Supplier issue', 'Last-minute request', 'Client escalation'],
  Other: ['Venue issue', 'Parking/access issue', 'Air-conditioning issue', 'Toilet issue', 'Catering issue', 'Noise issue', 'Other'],
};

const blank = { stand: '', exhibitor: '', contact: '', phone: '', category: '', est: '1 hour' };

export default function QueryForm({ exhibitors = [], initialValues = {}, onSubmit, onCancel, clientMode = false }) {
  const [form, setForm] = useState(() => ({ ...blank, ...initialValues }));
  const [quickIssues, setQuickIssues] = useState([]);
  const [customIssue, setCustomIssue] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [showContact, setShowContact] = useState(false);
  const [submissionId] = useState(() => crypto.randomUUID());
  const photoPreviews = useMemo(() => photos.map(file => URL.createObjectURL(file)), [photos]);
  useEffect(() => () => photoPreviews.forEach(url => URL.revokeObjectURL(url)), [photoPreviews]);
  const submissionInProgress = useRef(false);
  const selectedExhibitor = exhibitors.find(item => item.name === form.exhibitor);
  const standLocked = clientMode && Boolean(initialValues.exhibitor);
  const visual = form.category ? categoryVisual(form.category) : null;

  function selectExhibitor(name) {
    const exhibitor = exhibitors.find(item => item.name === name);
    setForm(current => ({ ...current, exhibitor: name, stand: exhibitor?.stand || '', contact: exhibitor?.contact || '', phone: exhibitor?.phone || '' }));
  }

  function pickCategory(category) {
    setForm(current => ({ ...current, category }));
    setQuickIssues([]); setCustomIssue(''); setError('');
  }

  function toggleIssue(issue) {
    setQuickIssues(current => current.includes(issue) ? current.filter(item => item !== issue) : [...current, issue]);
  }

  async function addPhotos(fileList) {
    const incoming = [...fileList];
    if (photos.length + incoming.length > QUERY_PHOTO_LIMIT) {
      setError(`You can attach up to ${QUERY_PHOTO_LIMIT} photos.`);
      return;
    }
    setError('');
    try {
      const prepared = await Promise.all(incoming.map(prepareQueryPhoto));
      setPhotos(current => [...current, ...prepared].slice(0, QUERY_PHOTO_LIMIT));
    } catch (photoError) {
      setError(photoError?.message || 'Could not prepare the selected photo.');
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (submissionInProgress.current) return;
    if (!form.exhibitor) { setError('Choose the exhibitor and stand first.'); return; }
    if (!form.category) { setError('Tap the kind of problem first.'); return; }
    const details = [...quickIssues].sort((left, right) => left.localeCompare(right)).concat(customIssue.trim()).filter(Boolean).join('; ');
    if (!details) {
      setError('Please select an issue or describe the problem.');
      return;
    }
    submissionInProgress.current = true;
    setSaving(true);
    setError('');
    try {
      await onSubmit({ ...form, description: details, sourceTab: clientMode ? 'CLIENT' : form.category, submissionId, ...(photos.length && { photos }) });
    } catch (submitError) {
      setError(submitError?.message || 'Could not save this query. Please try again.');
    } finally {
      submissionInProgress.current = false;
      setSaving(false);
    }
  }

  const ready = Boolean(form.exhibitor && form.category && (quickIssues.length || customIssue.trim()));

  return (
    <form className="qf" onSubmit={submit} noValidate>
      {standLocked ? (
        <div className="qf-who">
          {selectedExhibitor?.logo_url && <img src={selectedExhibitor.logo_url} alt="" />}
          <span><strong>Stand {form.stand}</strong><small>{form.exhibitor}</small></span>
        </div>
      ) : (
        <label className="qf-field">
          <span className="qf-label">Exhibitor / stand</span>
          <select className="qf-input" aria-label="Exhibitor / Stand" value={form.exhibitor} onChange={event => selectExhibitor(event.target.value)}>
            <option value="">Choose exhibitor and stand…</option>
            {exhibitors.map(item => <option key={`${item.stand}-${item.name}`} value={item.name}>{item.name} · Stand {item.stand}</option>)}
          </select>
        </label>
      )}

      {!form.category ? (
        <section className="qf-step">
          <h3 className="qf-q"><span className="qf-num">1</span> What kind of problem?</h3>
          <div className="qf-tiles">
            {CATEGORIES.map(category => {
              const { Icon, tone, short } = categoryVisual(category);
              return <button key={category} type="button" className={`qf-tile qf-tone--${tone}`} onClick={() => pickCategory(category)} title={category}>
                <Icon size={30} strokeWidth={1.8} /><span>{short}</span>
              </button>;
            })}
          </div>
        </section>
      ) : (
        <>
          <div className={`qf-chosen qf-tone--${visual.tone}`}>
            <span className="qf-chosen-icon"><visual.Icon size={26} strokeWidth={1.8} /></span>
            <span className="qf-chosen-text"><small>Problem type</small><strong>{form.category}</strong></span>
            <button type="button" className="qf-change" onClick={() => pickCategory('')}><ArrowLeft size={15} /> Change</button>
          </div>
          <section className="qf-step">
            <h3 className="qf-q"><span className="qf-num">2</span> What's wrong? <small>Tap all that apply</small></h3>
            <div className="qf-chips">
              {(DEPARTMENT_ISSUES[form.category] || []).map(issue => {
                const on = quickIssues.includes(issue);
                return <button key={issue} type="button" className={`qf-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggleIssue(issue)}>
                  {on && <Check size={16} strokeWidth={3} />} {issue}
                </button>;
              })}
            </div>
            <textarea className="qf-input" rows={2} aria-label="More details" value={customIssue} onChange={event => setCustomIssue(event.target.value)} placeholder="Anything else? (optional)" />
          </section>
          <section className="qf-step">
            <div className="qf-photos">
              {photoPreviews.map((url, index) => <div key={url} className="qf-thumb">
                <img src={url} alt={`Photo ${index + 1}`} />
                <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos(current => current.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
              </div>)}
              {photos.length < QUERY_PHOTO_LIMIT && <label className="qf-addphoto">
                <Camera size={24} /><span>{photos.length ? 'Add another' : 'Add a photo'}</span><small>optional</small>
                <input type="file" accept="image/*" capture="environment" multiple aria-label="Add photos of the problem" onChange={event => { addPhotos(event.target.files); event.target.value = ''; }} />
              </label>}
            </div>
          </section>
          {!clientMode && <section className="qf-step">
            <h3 className="qf-q qf-q--small">Estimated fix time</h3>
            <div className="qf-chips qf-chips--tight">{EST_OPTIONS.map(option => <button key={option} type="button" className={`qf-chip${form.est === option ? ' is-on' : ''}`} aria-pressed={form.est === option} onClick={() => setForm(current => ({ ...current, est:option }))}>{option}</button>)}</div>
          </section>}
          <section className="qf-contact">
            <button type="button" className="qf-contact-toggle" aria-expanded={showContact} onClick={() => setShowContact(value => !value)}>
              <span>Contact on the stand: <strong>{form.contact || 'not set'}</strong>{form.phone ? ` · ${form.phone}` : ''}</span>
              <ChevronDown size={18} className={showContact ? 'is-open' : ''} />
            </button>
            {showContact && <div className="qf-contact-fields">
              <input className="qf-input" aria-label="Contact name" placeholder="Contact name" value={form.contact} onChange={event => setForm(current => ({ ...current, contact:event.target.value }))} />
              <input className="qf-input" aria-label="Phone" type="tel" inputMode="tel" placeholder="Mobile number" value={form.phone} onChange={event => setForm(current => ({ ...current, phone:event.target.value }))} />
            </div>}
          </section>
        </>
      )}
      {error && <div role="alert" className={`qf-alert${/already logged|already been submitted/i.test(error) ? ' qf-alert--amber' : ''}`}>{error}</div>}
      <div className="qf-actions">
        {onCancel && <button type="button" className="qf-btn qf-btn--ghost" onClick={onCancel}>Cancel</button>}
        {form.category && <button type="submit" className="qf-btn qf-btn--send" disabled={saving || !ready}><Send size={18} /> {saving ? 'Sending…' : clientMode ? 'Send to Ops Desk' : 'Log query'}</button>}
      </div>
      {clientMode && form.category && <p className="qf-note">The Ops Desk assigns the right technician and you can follow progress on your status page.</p>}
    </form>
  );
}