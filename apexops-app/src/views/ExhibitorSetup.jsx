import { useEffect, useRef, useState } from 'react';
import { addExhibitor, getExhibitors, removeExhibitor, updateExhibitor, upsertExhibitorRecords, readableError } from '../lib/mock';
import { downloadWorkbook, readWorkbookRows } from '../lib/workbook';
import { NAVY, NAVY_DEEP, GOLD_PALE, BLUE, TEAL, CORAL, BG, FONT } from '../theme';

export default function ExhibitorSetup({ onBack }) {
  const [exhibitors, setExhibitors] = useState([]);
  const [form, setForm] = useState(createExhibitorForm());
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [exhibitorSearch, setExhibitorSearch] = useState('');
  const exhibitorRefs = useRef({});

  async function refresh() { setExhibitors(await getExhibitors()); }
  useEffect(() => { refresh(); }, []);

  const searchNeedle = exhibitorSearch.trim().toLowerCase();
  const filteredExhibitors = searchNeedle
    ? exhibitors.filter(exhibitor => `${exhibitor.name} ${exhibitor.stand}`.toLowerCase().includes(searchNeedle))
    : exhibitors;

  useEffect(() => {
    if (!searchNeedle || !filteredExhibitors.length) return undefined;
    const match = filteredExhibitors.find(exhibitor => exhibitor.name.toLowerCase().startsWith(searchNeedle) || exhibitor.stand.toLowerCase().startsWith(searchNeedle)) || filteredExhibitors[0];
    const frame = window.requestAnimationFrame(() => exhibitorRefs.current[match.stand]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return () => window.cancelAnimationFrame(frame);
  }, [exhibitorSearch, exhibitors]);

  function downloadTemplate() {
    downloadWorkbook('APEXOPS-exhibitors-template.xlsx', [{ name:'Exhibitors', rows:[
      { Company: 'Example Exhibitor Ltd', Stand: 'A01', Contact: 'Example Contact', Email: 'contact@example.com', 'Work No.': '+27 00 000 0000', 'Cell No.': '+27 00 000 0000' },
    ] }]);
  }

  function downloadReport() {
    downloadWorkbook('APEXOPS-exhibitor-report.xlsx', [{ name:'Exhibitors', rows: exhibitors.map(exhibitor => ({
      Stand: exhibitor.stand,
      Exhibitor: exhibitor.name,
      Contact: exhibitor.contact || '',
      Phone: exhibitor.phone || '',
      Email: exhibitor.email || '',
      'Exhibitor pack received': exhibitor.pack_collected ? 'Yes' : 'No',
      'Pack received by': exhibitor.pack_collected_by || '',
      'Day 1 booked out': exhibitor.scanner_day1_booked_out ? 'Yes' : 'No',
      'Day 1 out at': exhibitor.scanner_day1_booked_out_at || '',
      'Day 1 booked in': exhibitor.scanner_day1_booked_in ? 'Yes' : 'No',
      'Day 1 in at': exhibitor.scanner_day1_booked_in_at || '',
      'Day 2 booked out': exhibitor.scanner_day2_booked_out ? 'Yes' : 'No',
      'Day 2 out at': exhibitor.scanner_day2_booked_out_at || '',
      'Day 2 booked in': exhibitor.scanner_day2_booked_in ? 'Yes' : 'No',
      'Day 2 in at': exhibitor.scanner_day2_booked_in_at || '',
    })) }]);
  }

  async function importWorkbook(event) {
    const file = event.target.files[0];
    if (!file) return;
    setError(''); setMessage('');
    try {
      const rows = await readWorkbookRows(await file.arrayBuffer());
      const normalized = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, '_'), String(value).trim()])));
      const imported = normalized.map(row => ({
        stand: row.stand || row.stand_number,
        name: row.name || row.exhibitor || row.company,
        contact: row.contact || row.contact_name,
        phone: row.phone || row.mobile || row.contact_number,
        email: row.email,
      })).filter(row => row.stand && row.name);
      if (!imported.length) throw new Error('No rows with Stand and Exhibitor/Company columns were found.');
      await upsertExhibitorRecords(imported);
      setMessage(`Imported ${imported.length} exhibitor records.`);
      await refresh();
    } catch (importError) { setError(readableError(importError, 'Could not import this workbook.')); }
    event.target.value = '';
  }

  function edit(exhibitor) {
    setEditing(exhibitor.stand);
    setForm({ ...exhibitor, ...phoneFields(exhibitor.phone), ...emailFields(exhibitor.email), logo_url: exhibitor.logo_url || '' });
    setError('');
  }

  function handleLogoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(current => ({ ...current, logo_url: String(reader.result || ''), logo_file: file }));
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  async function save(event) {
    event.preventDefault();
    try {
      const payload = {
        stand: form.stand,
        name: form.name,
        contact: form.contact,
        phone: [form.phone1, form.phone2, form.phone3, form.phone4].map(value => value.trim()).filter(Boolean).join('; '),
        email: [form.email1, form.email2, form.email3, form.email4].map(value => value.trim()).filter(Boolean).join('; '),
        logo_url: form.logo_url || null,
        logo_file: form.logo_file || null,
      };
      if (editing) await updateExhibitor(editing, payload);
      else await addExhibitor(payload);
      setEditing(null);
      setForm(createExhibitorForm());
      await refresh();
    } catch (saveError) { setError(saveError.message); }
  }

  async function remove(exhibitor) {
    if (!window.confirm(`Remove ${exhibitor.name} (${exhibitor.stand})?`)) return;
    try { await removeExhibitor(exhibitor.stand); await refresh(); }
    catch (removeError) { setError(removeError.message); }
  }

  return (
    <div className="apex-service-screen exhibitor-directory-screen" style={{ fontFamily: FONT, minHeight: '100vh', background: BG, color:NAVY }}>
      <header className="apex-service-header" style={{ background:`linear-gradient(110deg, ${NAVY_DEEP}, ${NAVY})`, color:'#fff', padding:'18px 32px', display:'flex', alignItems:'center', justifyContent:'space-between', boxShadow:'0 2px 14px rgba(13,26,50,.16)' }}>
        <div><div style={{ color:GOLD_PALE, fontWeight:700, fontSize:18, letterSpacing:2 }}>APEXOPS™</div><div style={{ color:'rgba(255,255,255,.58)', fontSize:10, letterSpacing:1.6, textTransform:'uppercase', marginTop:4 }}>Exhibitor directory</div></div>
        <div style={{ fontSize:12, color:'rgba(255,255,255,.72)' }}>Stand &amp; contact management</div>
        <button onClick={onBack} style={secondaryButton}>Back</button>
      </header>
      <main className="apex-service-main directory-main" style={{ maxWidth: 1500, width:'calc(100% - 48px)', margin: '0 auto', padding:'34px 0 64px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'end', gap:20, marginBottom:22 }}><div><div style={eyebrow}>Event directory</div><h2 style={{ color: NAVY, margin:'6px 0 0', fontSize:28 }}>Exhibitors <span style={{ color:'#718089', fontSize:16, fontWeight:600 }}>({exhibitors.length})</span></h2><div style={{ color:'#687780', fontSize:13, marginTop:6 }}>The master stand list used by Ops and Check My Status.</div></div><div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}><button type="button" onClick={downloadReport} style={secondaryButton}>Export exhibitor report</button><button type="button" onClick={downloadTemplate} style={secondaryButton}>Download Excel template</button><label style={{ ...primaryButton, cursor:'pointer', whiteSpace:'nowrap' }}>Import CSV / Excel<input type="file" accept=".csv,.xlsx,.xls" onChange={importWorkbook} style={{ display:'none' }} /></label></div></div>
        <form className="directory-form" onSubmit={save} style={{ background:'#fff', padding:20, borderRadius:8, marginBottom:22, border:'1px solid #e1e6e5', borderTop:`3px solid ${BLUE}`, boxShadow:'0 4px 16px rgba(13,26,50,.05)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <input required disabled={Boolean(editing)} placeholder="Stand (e.g. A09/A10)" value={form.stand} onChange={e => setForm({ ...form, stand: e.target.value })} />
            <input required placeholder="Exhibitor name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Contact name" value={form.contact || ''} onChange={e => setForm({ ...form, contact: e.target.value })} />
            {[1, 2, 3, 4].map(number => <input key={number} type="tel" placeholder={`Mobile ${number}${number === 1 ? ' (primary)' : ''}`} value={form[`phone${number}`] || ''} onChange={e => setForm({ ...form, [`phone${number}`]: e.target.value })} />)}
            {[1, 2, 3, 4].map(number => <input key={`email-${number}`} type="email" placeholder={`Email ${number}${number === 1 ? ' (primary)' : ''}`} value={form[`email${number}`] || ''} onChange={e => setForm({ ...form, [`email${number}`]: e.target.value })} />)}
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: '#f9fafb', border: '1px solid #dfe5e7', borderRadius: 6, padding: '9px 12px', cursor: 'pointer', fontSize: 13, color: NAVY }}>
              <span>Upload logo</span>
              <input type="file" accept="image/*" onChange={handleLogoChange} style={{ display: 'none' }} />
            </label>
            <span style={{ color:'#718089', fontSize:11 }}>PNG, JPG or WebP · recommended 800 × 800 px · max 2 MB</span>
            {form.logo_url && <img src={form.logo_url} alt="Stand logo preview" style={{ width: 64, height: 64, objectFit: 'contain', border: '1px solid #dfe5e7', borderRadius: 8, background: '#fff' }} />}
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}><button type="submit" style={primaryButton}>{editing ? 'Save changes' : 'Add exhibitor'}</button>{editing && <button type="button" onClick={() => { setEditing(null); setForm(createExhibitorForm()); }} style={secondaryButton}>Cancel</button>}</div>
          {error && <div style={{ color: '#C0392B', marginTop: 10, fontSize: 13 }}>{error}</div>}
        </form>
        <div className="directory-search" style={directorySearchStyle}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, marginBottom:8 }}>
            <label htmlFor="exhibitor-directory-search" style={{ color:NAVY, fontSize:12, fontWeight:800 }}>Find an exhibitor or stand</label>
            <span style={{ color:'#718089', fontSize:11 }}>{searchNeedle ? `${filteredExhibitors.length} match${filteredExhibitors.length === 1 ? '' : 'es'}` : `${exhibitors.length} stands`}</span>
          </div>
          <input id="exhibitor-directory-search" value={exhibitorSearch} onChange={event => setExhibitorSearch(event.target.value)} placeholder="Type a company name or stand number, e.g. Nedbank or A01" style={directorySearchInputStyle} />
        </div>
        {message && <div style={{ color:'#1E8449', marginBottom:12 }}>{message}</div>}
        {filteredExhibitors.map(exhibitor => <div key={exhibitor.stand} ref={element => { exhibitorRefs.current[exhibitor.stand] = element; }} className="exhibitor-card directory-row" style={rowStyle}>
          <div style={{ width: 86, fontWeight: 800, color: BLUE, fontSize:14, letterSpacing:.6 }}>{exhibitor.stand}</div>
          <LogoTile exhibitor={exhibitor} onSaved={refresh} onError={setError} />
          <div style={{ flex:'0 0 260px', minWidth:0, overflowWrap:'anywhere' }}><strong style={{ display:'block', color:NAVY, fontSize:14 }}>{exhibitor.name}</strong><div style={{ color: '#596a73', fontSize: 12, marginTop:5 }}>{exhibitor.contact || 'No contact recorded'}</div><div style={{ marginTop:3, display:'grid', gap:2 }}>{splitEmailAddresses(exhibitor.email).length ? splitEmailAddresses(exhibitor.email).slice(0, 4).map((email, index) => <a key={`${email}-${index}`} href={`mailto:${email}`} style={{ ...contactLink, fontSize:12, fontWeight:600 }}>Email {index + 1}: {email}</a>) : <span style={{ color:'#78858b', fontSize:12 }}>Email not recorded</span>}</div><div style={{ marginTop:3, display:'grid', gap:2 }}>{splitPhoneNumbers(exhibitor.phone).length ? splitPhoneNumbers(exhibitor.phone).slice(0, 4).map((phone, index) => <a key={`${phone}-${index}`} href={whatsappLink(phone)} target="_blank" rel="noreferrer" style={{ ...contactLink, fontSize:12, fontWeight:600 }}>WhatsApp {index + 1}: {phone}</a>) : <span style={{ color:'#78858b', fontSize:12 }}>Mobile not recorded</span>}</div></div>
          <PackCollection exhibitor={exhibitor} onSaved={refresh} onError={setError} />
          <ScannerCheckout exhibitor={exhibitor} onSaved={refresh} onError={setError} />
          <div style={{ display:'flex', alignItems:'center', gap:12, marginLeft:'auto' }}>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => edit(exhibitor)} style={secondaryButton}>Edit</button>
              <button onClick={() => remove(exhibitor)} style={deleteButton}>Remove</button>
            </div>
          </div>
        </div>)}
        {searchNeedle && !filteredExhibitors.length && <div style={emptySearchStyle}>No exhibitor or stand matches “{exhibitorSearch}”.</div>}
      </main>
    </div>
  );
}

function PackCollection({ exhibitor, onSaved, onError }) {
  const [collectedBy, setCollectedBy] = useState(exhibitor.pack_collected_by || '');
  const collected = Boolean(exhibitor.pack_collected);

  useEffect(() => {
    setCollectedBy(exhibitor.pack_collected_by || '');
  }, [exhibitor.pack_collected_by]);

  async function save(patch) {
    try {
      await updateExhibitor(exhibitor.stand, patch);
      await onSaved();
    } catch (saveError) {
      onError(readableError(saveError, 'Could not update pack collection details.'));
    }
  }

  return <div className="pack-collection-panel" style={packPanelStyle} onClick={event => event.stopPropagation()}>
    <div style={packHeaderStyle}>Exhibitor pack</div>
    <label style={packCheckStyle}>
      <input type="checkbox" checked={collected} onChange={event => save({ pack_collected: event.target.checked, pack_collected_at: event.target.checked ? new Date().toISOString() : null })} />
      <span>{collected ? 'Collected' : 'Not collected'}</span>
    </label>
    <input value={collectedBy} onChange={event => setCollectedBy(event.target.value)} onBlur={() => save({ pack_collected_by: collectedBy.trim() || null })} placeholder="Received by" style={packInputStyle} aria-label={`Person who received pack for ${exhibitor.stand}`} />
    {exhibitor.pack_collected_at && <div style={packStampStyle}>Recorded {formatScannerStamp(exhibitor.pack_collected_at)}</div>}
  </div>;
}

function ScannerCheckout({ exhibitor, onSaved, onError }) {
  const [outStaffName, setOutStaffName] = useState(exhibitor.scanner_out_staff_name || exhibitor.scanner_staff_name || '');
  const [outStaffContact, setOutStaffContact] = useState(exhibitor.scanner_out_staff_contact || exhibitor.scanner_staff_contact || '');
  const [inStaffName, setInStaffName] = useState(exhibitor.scanner_in_staff_name || '');
  const [inStaffContact, setInStaffContact] = useState(exhibitor.scanner_in_staff_contact || '');

  useEffect(() => {
    setOutStaffName(exhibitor.scanner_out_staff_name || exhibitor.scanner_staff_name || '');
    setOutStaffContact(exhibitor.scanner_out_staff_contact || exhibitor.scanner_staff_contact || '');
    setInStaffName(exhibitor.scanner_in_staff_name || '');
    setInStaffContact(exhibitor.scanner_in_staff_contact || '');
  }, [exhibitor.scanner_out_staff_name, exhibitor.scanner_out_staff_contact, exhibitor.scanner_in_staff_name, exhibitor.scanner_in_staff_contact, exhibitor.scanner_staff_name, exhibitor.scanner_staff_contact]);

  async function save(patch) {
    try {
      await updateExhibitor(exhibitor.stand, patch);
      await onSaved();
    } catch (saveError) {
      onError(readableError(saveError, 'Could not update scanner details.'));
    }
  }

  function toggle(day, action, checked) {
    const prefix = `scanner_day${day}_booked_${action}`;
    const timestamp = checked ? new Date().toISOString() : null;
    save({ [prefix]: checked, [`${prefix}_at`]: timestamp });
  }

  const day1Out = Boolean(exhibitor.scanner_day1_booked_out || exhibitor.scanner_booked_out);
  const day1In = Boolean(exhibitor.scanner_day1_booked_in || exhibitor.scanner_booked_in);
  const day2Out = Boolean(exhibitor.scanner_day2_booked_out);
  const day2In = Boolean(exhibitor.scanner_day2_booked_in);
  const day1OutAt = exhibitor.scanner_day1_booked_out_at || exhibitor.scanner_booked_out_at;
  const day1InAt = exhibitor.scanner_day1_booked_in_at || exhibitor.scanner_booked_in_at;
  const day2OutAt = exhibitor.scanner_day2_booked_out_at;
  const day2InAt = exhibitor.scanner_day2_booked_in_at;
  const returnOverdue = (day1Out && !day1In && day1OutAt && Date.now() > new Date(day1OutAt).getTime() + 24 * 60 * 60 * 1000) || (day2Out && !day2In && day2OutAt && Date.now() > new Date(day2OutAt).getTime() + 24 * 60 * 60 * 1000);
  const fullyReturned = day1In && (!day2Out || day2In);

  return <div className="scanner-control-panel" style={{ ...scannerPanelStyle, ...(returnOverdue ? scannerOverduePanelStyle : {}) }} onClick={event => event.stopPropagation()}>
    <div style={scannerHeaderStyle}><div><div style={{ color:returnOverdue ? '#9f2d2d' : NAVY, fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:.8 }}>Scanner custody · 2 days</div><div style={{ color:returnOverdue ? '#b24b4b' : '#7a8a94', fontSize:10, marginTop:2 }}>{returnOverdue ? 'A scanner return is overdue' : 'Record each daily handover'}</div></div><span style={{ ...scannerStatusStyle, ...(returnOverdue ? scannerOverdueStatusStyle : {}) }}>{returnOverdue ? 'Return overdue' : fullyReturned ? 'Returned' : day1Out || day2Out ? 'With stand' : 'Not issued'}</span></div>
    <div style={scannerColumnsStyle}>
      <ScannerDay day="Day 1" out={day1Out} in={day1In} outAt={day1OutAt} inAt={day1InAt} onToggle={toggle.bind(null, 1)} overdue={returnOverdue && day1Out && !day1In} staffName={outStaffName} staffContact={outStaffContact} onStaffNameChange={setOutStaffName} onStaffContactChange={setOutStaffContact} onStaffNameSave={() => save({ scanner_out_staff_name: outStaffName })} onStaffContactSave={() => save({ scanner_out_staff_contact: outStaffContact })} />
      <ScannerDay day="Day 2" out={day2Out} in={day2In} outAt={day2OutAt} inAt={day2InAt} onToggle={toggle.bind(null, 2)} overdue={returnOverdue && day2Out && !day2In} staffName={inStaffName} staffContact={inStaffContact} onStaffNameChange={setInStaffName} onStaffContactChange={setInStaffContact} onStaffNameSave={() => save({ scanner_in_staff_name: inStaffName })} onStaffContactSave={() => save({ scanner_in_staff_contact: inStaffContact })} />
    </div>
  </div>;
}

function ScannerDay({ day, out, in: bookedIn, outAt, inAt, onToggle, overdue, staffName, staffContact, onStaffNameChange, onStaffContactChange, onStaffNameSave, onStaffContactSave }) {
  return <div style={{ ...scannerLaneStyle, ...(out ? scannerLaneActiveStyle : {}), ...(overdue ? scannerOverdueLaneStyle : {}) }}>
    <div style={{ color:NAVY, fontSize:10, fontWeight:800, marginBottom:5 }}>{day}</div>
    <label style={scannerCheckStyle}><input type="checkbox" checked={out} onChange={event => onToggle('out', event.target.checked)} /> <span>Booked out</span></label>
    {outAt && <div style={scannerStampStyle}>Out: {formatScannerStamp(outAt)}</div>}
    <label style={{ ...scannerCheckStyle, marginTop:4 }}><input type="checkbox" checked={bookedIn} onChange={event => onToggle('in', event.target.checked)} /> <span>Booked in</span></label>
    {inAt && <div style={scannerStampStyle}>In: {formatScannerStamp(inAt)}</div>}
    <div style={scannerDayFieldsStyle}>
      <input value={staffName} onChange={event => onStaffNameChange(event.target.value)} onBlur={onStaffNameSave} placeholder="Staff name" style={scannerInputStyle} />
      <input value={staffContact} onChange={event => onStaffContactChange(event.target.value)} onBlur={onStaffContactSave} placeholder="Staff number" style={scannerInputStyle} />
    </div>
  </div>;
}

function LogoTile({ exhibitor, onSaved, onError }) {
  function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    updateExhibitor(exhibitor.stand, { logo_file: file }).then(onSaved).catch(error => onError(readableError(error, 'Could not upload the logo.')));
    event.target.value = '';
  }

  return <label title={`Upload ${exhibitor.name} logo · PNG/JPG/WebP · max 2 MB`} style={{ width:64, height:64, flex:'0 0 64px', borderRadius:8, border:'1px solid #dfe5e7', background:'#f7f9fa', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', cursor:'pointer' }}>
    {exhibitor.logo_url ? <img src={exhibitor.logo_url} alt={`${exhibitor.name} logo`} style={{ width:'100%', height:'100%', objectFit:'contain' }} /> : <span style={{ fontSize:11, color:'#7a8a94', textAlign:'center', padding:6 }}>Logo</span>}
    <input type="file" accept="image/*" onChange={upload} style={{ display:'none' }} />
  </label>;
}

const eyebrow = { color:GOLD_PALE, fontSize:10, letterSpacing:1.8, textTransform:'uppercase', fontWeight:700 };
const primaryButton = { background: BLUE, color: '#fff', border: 'none', borderRadius: 5, padding: '10px 16px', fontWeight: 700, cursor: 'pointer' };
const secondaryButton = { background: '#fff', color: NAVY, border: '1px solid #d6dfdf', borderRadius: 5, padding: '10px 14px', fontWeight: 600, cursor: 'pointer' };
const deleteButton = { background: '#fff7f6', color: CORAL, border: '1px solid #f1cfcb', borderRadius: 5, padding: '8px 12px', cursor: 'pointer' };
const directorySearchStyle = { background:'#f7fafc', border:'1px solid #dce7ed', borderRadius:10, padding:'14px 16px', marginBottom:16 };
const directorySearchInputStyle = { border:'1px solid #cbdbe4', borderRadius:8, padding:'12px 14px', fontSize:13, color:NAVY, background:'#fff' };
const emptySearchStyle = { background:'#fff', border:'1px dashed #cbdbe4', borderRadius:8, color:'#718089', textAlign:'center', padding:'28px 20px', marginBottom:10, fontSize:13 };
const rowStyle = { background:'linear-gradient(135deg, #ffffff 0%, #f8fbfd 100%)', border:'1px solid #dce7ed', borderLeft:`4px solid ${BLUE}`, borderRadius:14, padding:'20px 24px', marginBottom:12, display:'flex', alignItems:'center', justifyContent:'space-between', gap:20, boxShadow:'0 8px 22px rgba(13,26,50,.07)', transition:'transform .18s ease, box-shadow .18s ease' };
const packPanelStyle = { width:190, flex:'0 0 190px', padding:'11px', border:'1px solid #dce8ee', borderRadius:9, background:'#f7fbfd' };
const packHeaderStyle = { color:NAVY, fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:.8, marginBottom:8 };
const packCheckStyle = { display:'flex', alignItems:'center', gap:7, color:'#304653', fontSize:11, fontWeight:700, cursor:'pointer' };
const packInputStyle = { width:'100%', boxSizing:'border-box', marginTop:9, padding:'7px 8px', border:'1px solid #d5e1e6', borderRadius:5, color:NAVY, fontSize:11, background:'#fff' };
const packStampStyle = { color:'#718089', fontSize:10, marginTop:7 };
const scannerCheckStyle = { display:'flex', alignItems:'center', gap:7, color:'#304653', fontSize:11, fontWeight:700, cursor:'pointer' };
const scannerStampStyle = { color:'#718089', fontSize:10, paddingLeft:22 };
const scannerContactTitle = { color:'#718089', fontSize:10, fontWeight:700, marginTop:3 };
const scannerPanelStyle = { width:560, flex:'0 0 560px', maxWidth:'46vw', padding:'12px', border:'1px solid #dfe7ec', borderRadius:10, background:'#fff', boxShadow:'0 2px 8px rgba(13,26,50,.05)' };
const scannerHeaderStyle = { display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, paddingBottom:9, marginBottom:9, borderBottom:'1px solid #edf1f3' };
const scannerStatusStyle = { color:'#536a76', background:'#f0f4f6', border:'1px solid #dfe7eb', borderRadius:999, padding:'4px 7px', fontSize:9, fontWeight:800, whiteSpace:'nowrap' };
const scannerLaneStyle = { minWidth:0, padding:'8px', border:'1px solid #edf1f3', borderRadius:7, background:'#fbfcfd' };
const scannerLaneActiveStyle = { borderColor:'#b9d9cb', background:'#f5fbf7' };
const scannerOverduePanelStyle = { borderColor:'#efb4b4', background:'#fff7f7', boxShadow:'0 2px 10px rgba(192,57,43,.12)' };
const scannerOverdueStatusStyle = { color:'#9f2d2d', background:'#fde8e8', borderColor:'#efb4b4' };
const scannerOverdueLaneStyle = { borderColor:'#efc2c2', background:'#fffafa' };
const scannerColumnsStyle = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 };
const scannerDayFieldsStyle = { display:'grid', gap:6, marginTop:10, paddingTop:9, borderTop:'1px solid #e8eef0' };
const scannerInputStyle = { minWidth:0, padding:'6px 7px', fontSize:10, borderRadius:5 };
const contactLink = { color:BLUE, textDecoration:'none' };
function createExhibitorForm() { return { stand:'', name:'', contact:'', phone1:'', phone2:'', phone3:'', phone4:'', email1:'', email2:'', email3:'', email4:'', logo_url:'', logo_file:null }; }
function splitPhoneNumbers(value) { return String(value || '').split(/\s*;\s*|\s*,\s*|\s+\/\s+/).map(phone => phone.trim()).filter(Boolean); }
function splitEmailAddresses(value) { return String(value || '').split(/\s*;\s*|\s*,\s*/).map(email => email.trim()).filter(Boolean); }
function phoneFields(value) {
  const phones = splitPhoneNumbers(value);
  return { phone1: phones[0] || '', phone2: phones[1] || '', phone3: phones[2] || '', phone4: phones[3] || '' };
}
function emailFields(value) {
  const emails = splitEmailAddresses(value);
  return { email1: emails[0] || '', email2: emails[1] || '', email3: emails[2] || '', email4: emails[3] || '' };
}
function firstContact(value) { return String(value).split(/[;,]/)[0].trim(); }
function whatsappLink(value) {
  const digits = whatsappDigits(firstContact(value));
  return digits ? `https://wa.me/${digits}` : `tel:${encodeURIComponent(value)}`;
}
function whatsappDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^0[6-8]\d{8}$/.test(digits) ? `27${digits.slice(1)}` : digits;
}
function formatScannerStamp(value) { return new Date(value).toLocaleString([], { dateStyle:'short', timeStyle:'short' }); }
