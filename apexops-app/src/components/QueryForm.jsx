import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ClipboardPlus, X } from 'lucide-react';
import { CATEGORIES, EST_OPTIONS, QUERY_PHOTO_LIMIT } from '../lib/mock';
import { BLUE } from '../theme';

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
  const photoPreviews = useMemo(() => photos.map(file => URL.createObjectURL(file)), [photos]);
  useEffect(() => () => photoPreviews.forEach(url => URL.revokeObjectURL(url)), [photoPreviews]);
  const submissionInProgress = useRef(false);
  const selectedExhibitor = exhibitors.find(item => item.name === form.exhibitor);

  function selectExhibitor(name) {
    const exhibitor = exhibitors.find(item => item.name === name);
    setForm(current => ({ ...current, exhibitor: name, stand: exhibitor?.stand || '', contact: exhibitor?.contact || '', phone: exhibitor?.phone || '' }));
  }

  function addPhotos(fileList) {
    const incoming = [...fileList];
    if (photos.length + incoming.length > QUERY_PHOTO_LIMIT) setError(`You can attach up to ${QUERY_PHOTO_LIMIT} photos.`);
    else setError('');
    setPhotos(current => [...current, ...incoming].slice(0, QUERY_PHOTO_LIMIT));
  }

  async function submit(event) {
    event.preventDefault();
    if (submissionInProgress.current) return;
    const details = [...quickIssues].sort((left, right) => left.localeCompare(right)).concat(customIssue.trim()).filter(Boolean).join('; ');
    if (!details) {
      setError('Please select an issue or describe the problem.');
      return;
    }
    submissionInProgress.current = true;
    setSaving(true);
    setError('');
    try {
      await onSubmit({ ...form, description: details, sourceTab: clientMode ? 'CLIENT' : form.category, ...(clientMode && photos.length && { photos }) });
    } catch (submitError) {
      setError(submitError?.message || 'Could not save this query. Please try again.');
    } finally {
      submissionInProgress.current = false;
      setSaving(false);
    }
  }

  return (
    <form className="apex-query-form" onSubmit={submit}>
      <div style={introStyle}><ClipboardPlus size={18} color={BLUE} /><span>Capture the request details so the right team can resolve it quickly.</span></div>
      <div style={gridStyle}>
        <Field label="Exhibitor / Stand" required>
          <select aria-label="Exhibitor / Stand" required value={form.exhibitor} onChange={event => selectExhibitor(event.target.value)} style={inputStyle}>
            <option value="">Select exhibitor and stand...</option>
            {exhibitors.map(item => <option key={`${item.stand}-${item.name}`} value={item.name}>{item.name} - Stand {item.stand}</option>)}
          </select>
          {selectedExhibitor?.logo_url && <img src={selectedExhibitor.logo_url} alt={`${selectedExhibitor.name} logo`} style={selectedLogoStyle} />}
        </Field>
        <Field label="Department" required>
          <select aria-label="Department" required value={form.category} onChange={event => { setForm(current => ({ ...current, category: event.target.value })); setQuickIssues([]); setCustomIssue(''); }} style={inputStyle}>
            <option value="">Select department...</option>
            {CATEGORIES.map(category => <option key={category}>{category}</option>)}
          </select>
        </Field>
        <Field label="Contact Name"><input aria-label="Contact Name" value={form.contact} onChange={event => setForm(current => ({ ...current, contact: event.target.value }))} style={inputStyle} /></Field>
        <Field label="Phone"><input aria-label="Phone" value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} style={inputStyle} /></Field>
      </div>
      {form.category && <Field label="Issue selection">
        <div style={issuesStyle}>
          {(DEPARTMENT_ISSUES[form.category] || []).map(issue => {
            const checked = quickIssues.includes(issue);
            return <label key={issue} style={{ ...issueStyle, borderColor: checked ? '#bfdcff' : '#dfe4e6', background: checked ? '#f4faff' : '#fff' }}>
              <input type="checkbox" checked={checked} onChange={() => setQuickIssues(current => checked ? current.filter(item => item !== issue) : [...current, issue])} style={issueCheckboxStyle} />
              <span>{issue}</span>
            </label>;
          })}
        </div>
      </Field>}
      <Field label="Issue details / free text">
        <textarea aria-label="Issue details / free text" rows={3} value={customIssue} onChange={event => setCustomIssue(event.target.value)} placeholder="Add details about the problem..." style={{ ...inputStyle, minHeight: 92, resize: 'vertical' }} />
      </Field>
      {clientMode && <Field label={`Photos of the issue (optional, up to ${QUERY_PHOTO_LIMIT})`}>
        <div style={photoRowStyle}>
          {photoPreviews.map((url, index) => <div key={url} style={thumbWrapStyle}>
            <img src={url} alt={`Attached photo ${index + 1}`} style={thumbStyle} />
            <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos(current => current.filter((_, i) => i !== index))} style={thumbRemoveStyle}><X size={12} /></button>
          </div>)}
          {photos.length < QUERY_PHOTO_LIMIT && <label style={addPhotoStyle}>
            <Camera size={20} /><span>Add photo</span>
            <input type="file" accept="image/*" multiple aria-label="Add photos of the issue" onChange={event => { addPhotos(event.target.files); event.target.value = ''; }} style={{ display: 'none' }} />
          </label>}
        </div>
      </Field>}
      {!clientMode && <Field label="Estimated Fix Time">
        <select aria-label="Estimated Fix Time" value={form.est} onChange={event => setForm(current => ({ ...current, est: event.target.value }))} style={inputStyle}>
          {EST_OPTIONS.map(option => <option key={option}>{option}</option>)}
        </select>
      </Field>}
      {clientMode && <p style={{ color: '#687780', fontSize: 12, margin: '4px 0 0' }}>Your query goes to the Ops Desk. The operations team will assign the appropriate staff member.</p>}
      {error && <div role="alert" style={/already logged|already been submitted/i.test(error) ? duplicateWarningStyle : formErrorStyle}>{error}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
        {onCancel && <button type="button" onClick={onCancel} style={secondaryButton}>Cancel</button>}
        <button type="submit" disabled={saving} style={primaryButton}>{saving ? 'Submitting...' : 'Submit Query'}</button>
      </div>
    </form>
  );
}

function Field({ label, required, children }) {
  return <div style={fieldStyle}><div>{label}{required && <strong style={{ color: '#C0392B' }}> *</strong>}</div>{children}</div>;
}

const introStyle = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, color: '#5d6d7a', fontSize: 13, background: '#f3f8ff', border: '1px solid #dfeaf8', borderRadius: 6, padding: '10px 12px' };
const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 };
const fieldStyle = { display: 'grid', gap: 6, marginBottom: 12, color: '#555', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' };
const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #cfdadd', borderRadius: 5, padding: '9px 10px', color: '#172746', fontSize: 13, fontWeight: 500, textTransform: 'none' };
const selectedLogoStyle = { width: 44, height: 44, objectFit: 'contain', borderRadius: 6, border: '1px solid #dfe7eb', background: '#fff', padding: 4, marginTop: 8 };
const issuesStyle = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 };
const issueStyle = { display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 9, minHeight: 42, padding: '8px 10px', border: '1px solid', borderRadius: 5, color: '#2d3c44', fontSize: 12, fontWeight: 500, textAlign: 'left', textTransform: 'none', cursor: 'pointer' };
const issueCheckboxStyle = { width: 16, height: 16, flex: '0 0 16px', margin: 0, padding: 0, accentColor: BLUE };
const formErrorStyle = { color: '#922B21', fontSize: 13, marginTop: 10 };
const photoRowStyle = { display: 'flex', flexWrap: 'wrap', gap: 10 };
const thumbWrapStyle = { position: 'relative', width: 84, height: 84 };
const thumbStyle = { width: 84, height: 84, objectFit: 'cover', borderRadius: 6, border: '1px solid #cfdadd' };
const thumbRemoveStyle = { position: 'absolute', top: -6, right: -6, width: 22, height: 22, display: 'grid', placeItems: 'center', border: 'none', borderRadius: '50%', background: '#172746', color: '#fff', cursor: 'pointer', padding: 0 };
const addPhotoStyle = { width: 84, height: 84, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 4, border: '1px dashed #9fb0b6', borderRadius: 6, color: '#5d6d7a', fontSize: 11, fontWeight: 600, textTransform: 'none', cursor: 'pointer', background: '#f7fafb' };
const duplicateWarningStyle = { color: '#805C16', fontSize: 13, marginTop: 10, padding: '10px 12px', background: '#FFF7E8', border: '1px solid #F0DCA9', borderRadius: 5 };
const primaryButton = { border: 'none', borderRadius: 5, padding: '10px 16px', background: '#172746', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' };
const secondaryButton = { border: '1px solid #d6dfdf', borderRadius: 5, padding: '10px 16px', background: '#fff', color: '#172746', fontSize: 12, fontWeight: 700, cursor: 'pointer' };