import { useEffect, useRef, useState } from 'react';
import { addStaff, CATEGORIES, getStaff, normalizeDepartments, readableError, removeStaff, updateStaff, updateSupplierLogo, upsertStaffRecords } from '../lib/mock';
import { downloadWorkbook, readWorkbookRows } from '../lib/workbook';
import { NAVY, NAVY_DEEP, GOLD_PALE, BLUE, TEAL, CORAL, BG, FONT } from '../theme';

export default function StaffSetup() {
  const [staff, setStaff] = useState([]);
  const formRef = useRef(null);
  const emptyForm = { supplier_name: '', name: '', email: '', category: '', departments: [], mobile: '', photo: null };
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function refresh() {
    try {
      const rows = await getStaff();
      setStaff(rows);
      setError(rows.some(member => member.departmentsMigrationPending)
        ? 'Existing staff are shown, but multiple departments cannot be saved until you run supabase/staff-departments-migration.sql in the Supabase SQL Editor.'
        : '');
    } catch (loadError) {
      setError(readableError(loadError, 'Could not load staff members.'));
    }
  }

  useEffect(() => { refresh(); }, []);

  function downloadTemplate() {
    const supplierRows = [
      { Supplier: 'Example Supplier Ltd', 'Staff Name': 'Example Contact', Email: 'contact@example.com', Mobile: '+27 00 000 0000', Department: 'Stand Builder' },
    ];
    downloadWorkbook('APEXOPS-suppliers-template.xlsx', [
      { name:'Suppliers', rows:supplierRows },
      { name:'Departments', rows:CATEGORIES.map(category => ({ 'Allowed department values': category })) },
    ]);
  }

  function downloadReport() {
    downloadWorkbook('APEXOPS-suppliers-staff-report.xlsx', [{ name:'Suppliers and Staff', rows: staff.map(member => ({
      Supplier: member.supplier_name || '',
      'Staff name': member.name,
      Email: member.email || '',
      Mobile: member.mobile || '',
      Department: (member.departments || [member.category]).filter(Boolean).join(', '),
      Role: member.role || 'staff',
    })) }]);
  }

  async function importWorkbook(event) {
    const file = event.target.files[0];
    if (!file) return;
    setError(''); setMessage('');
    try {
      const rows = await readWorkbookRows(await file.arrayBuffer());
      const normalized = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, '_'), String(value).trim()])));
      const imported = normalized.map(row => {
        const departments = normalizeDepartments(row.departments || row.department || row.category);
        return { id: row.id, supplier_name: row.supplier || row.supplier_name || row.company, name: row.staff_name || row.contact || row.contact_name || row.name || row.full_name, email: row.email, category: departments[0] || '', departments, mobile: row.mobile || row.cellphone || row.phone, role: row.role };
      }).filter(row => row.supplier_name && row.name);
      if (!imported.length) throw new Error('No rows with Supplier and Staff Name columns were found.');
      await upsertStaffRecords(imported);
      setMessage(`Imported ${imported.length} supplier records.`);
      await refresh();
    } catch (importError) { setError(readableError(importError, 'Could not import this workbook.')); }
    event.target.value = '';
  }

  function edit(member) {
    setEditing(member);
    const departments = normalizeDepartments(member.departments, member.category);
    setForm({ supplier_name: member.supplier_name || '', name: member.name, email: member.email || '', category: departments[0] || '', departments, mobile: member.mobile || '', photo: null });
    setError('');
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior:'smooth', block:'start' }));
  }

  async function save(event) {
    event.preventDefault();
    if (!form.name.trim() || !form.departments.length) return;
    try {
      if (editing) await updateStaff(editing.id, form);
      else await addStaff(form);
      setEditing(null);
      setForm(emptyForm);
      await refresh();
    } catch (saveError) {
        setError(readableError(saveError, 'Could not save staff member.'));
    }
  }

  async function remove(member) {
    if (!window.confirm(`Remove ${member.name} from the staff list?`)) return;
    try {
      await removeStaff(member.id);
      await refresh();
    } catch (removeError) {
        setError(readableError(removeError, 'Could not remove staff member.'));
    }
  }

  async function clearSupplierLogo(member) {
    try {
      await updateSupplierLogo(member.id, '');
      await refresh();
    } catch (clearError) {
      setError(readableError(clearError, 'Could not remove the supplier logo.'));
    }
  }

  return (
    <div className="apex-service-screen staff-directory-screen" style={{ fontFamily: FONT, minHeight: '100vh', background:'linear-gradient(180deg, #e6eff5 0%, #f3f4f2 54%, #e9f0f4 100%)', color:NAVY }}>
      <header className="apex-service-header" style={{ background:`linear-gradient(110deg, ${NAVY_DEEP}, ${NAVY})`, color:'#fff', padding:'18px 32px', display:'flex', alignItems:'center', justifyContent:'space-between', boxShadow:'0 2px 14px rgba(13,26,50,.16)' }}>
        <div><div style={{ color:GOLD_PALE, fontWeight:700, fontSize:18, letterSpacing:2 }}>APEXOPS™</div><div style={{ color:'rgba(255,255,255,.58)', fontSize:10, letterSpacing:1.6, textTransform:'uppercase', marginTop:4 }}>Supplier directory</div></div>
        <div style={{ fontSize:12, color:'rgba(255,255,255,.72)' }}>People &amp; delivery partners</div>
      </header>
      <main className="apex-service-main directory-main" style={{ maxWidth: 1280, width:'calc(100% - 48px)', margin: '0 auto', padding:'34px 0 64px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'end', gap:20, marginBottom:22 }}><div><div style={eyebrow}>Operations directory</div><h2 style={{ color: NAVY, margin:'6px 0 0', fontSize:28 }}>Suppliers</h2><div style={{ color:'#687780', fontSize:13, marginTop:6 }}>Manage the operational supplier team and their direct contacts.</div></div><div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}><button type="button" onClick={downloadReport} style={secondaryButton}>Export supplier report</button><button type="button" onClick={downloadTemplate} style={secondaryButton}>Download Excel template</button><label style={{ ...primaryButton, cursor:'pointer', whiteSpace:'nowrap' }}>Import CSV / Excel<input type="file" accept=".csv,.xlsx,.xls" onChange={importWorkbook} style={{ display:'none' }} /></label></div></div>
        <form className="directory-form" ref={formRef} onSubmit={save} style={{ background:'linear-gradient(135deg, #fff 0%, #f8fbfd 100%)', padding:22, borderRadius:14, marginBottom:22, border:'1px solid #dce7ed', borderTop:`3px solid ${TEAL}`, boxShadow:'0 10px 26px rgba(13,26,50,.08)', scrollMarginTop:20 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input required value={form.supplier_name} placeholder="Supplier name" onChange={e => setForm({ ...form, supplier_name: e.target.value })} style={inputStyle} />
            <input required value={form.name} placeholder="Staff name" onChange={e => setForm({ ...form, name: e.target.value })} style={inputStyle} />
            <input type="email" value={form.email} placeholder="Email address" onChange={e => setForm({ ...form, email: e.target.value })} style={inputStyle} />
            <input value={form.mobile} placeholder="Mobile / cellphone" onChange={e => setForm({ ...form, mobile: e.target.value })} style={inputStyle} />
            <button type="submit" style={primaryButton}>{editing ? 'Save changes' : 'Add supplier'}</button>
            {editing && <button type="button" onClick={() => { setEditing(null); setForm(emptyForm); }} style={secondaryButton}>Cancel</button>}
          </div>
          <fieldset style={{ border:'1px solid #dce7ed', borderRadius:6, margin:'14px 0 0', padding:'10px 12px' }}>
            <legend style={{ fontSize:12, fontWeight:700, color:NAVY, padding:'0 5px' }}>Departments</legend>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(190px, 1fr))', gap:'8px 14px' }}>
              {CATEGORIES.map(category => <label key={category} style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, color:'#40515b' }}>
                <input type="checkbox" checked={form.departments.includes(category)} onChange={event => {
                  setForm(current => {
                    const departments = event.target.checked
                      ? [...current.departments, category]
                      : current.departments.filter(item => item !== category);
                    return { ...current, departments, category: departments[0] || '' };
                  });
                }} />
                {category}
              </label>)}
            </div>
          </fieldset>
          <label style={{ display:'block', marginTop:10, fontSize:12, color:'#555' }}>
            Supplier/staff photo <input type="file" accept="image/*" onChange={e => setForm({ ...form, photo: e.target.files[0] || null })} />
          </label>
          {message && <div style={{ color:'#1E8449', marginTop:10, fontSize:13 }}>{message}</div>}
          {error && <div style={{ color: '#C0392B', marginTop: 10, fontSize: 13 }}>{error}</div>}
        </form>
        {staff.map(member => (
          <div key={member.id} className="directory-row" style={rowStyle}>
            {member.photo_url ? <img src={member.photo_url} alt={`${member.name} profile`} style={photoStyle} /> : <div style={photoFallback}>{initials(member.name)}</div>}
            <div style={{ flex:'0 0 420px', minWidth:0 }}><strong style={{ display:'block', color:NAVY }}>{member.supplier_name || 'Supplier not assigned'}</strong><div style={{ color:'#40515b', fontSize:13, marginTop:4, fontWeight:600 }}>{member.name}</div><div style={{ color:'#78858b', fontSize:12, marginTop:5 }}>{(member.departments || [member.category]).filter(Boolean).join(', ')}</div><div style={{ fontSize:12, marginTop:3 }}>{member.email ? <a href={`mailto:${firstContact(member.email)}`} style={contactLink}>Email: {member.email}</a> : <span style={{ color:'#78858b' }}>Email not recorded</span>}</div><div style={{ fontSize:12, marginTop:3, fontWeight:600 }}>{member.mobile ? <a href={whatsappLink(member.mobile)} target="_blank" rel="noreferrer" style={contactLink}>Mobile: {member.mobile}</a> : <span style={{ color:'#78858b' }}>Mobile not recorded</span>}</div></div>
            <div style={{ marginLeft:'auto', marginRight:'auto', display:'grid', justifyItems:'center', gap:5 }}><SupplierLogoTile member={member} onSaved={refresh} onError={setError} /><button type="button" onClick={() => clearSupplierLogo(member)} style={clearLogoButton}>Clear logo</button></div>
            <button onClick={() => edit(member)} style={secondaryButton}>Edit</button>
            <button onClick={() => remove(member)} style={deleteButton}>Remove</button>
          </div>
        ))}
      </main>
    </div>
  );
}

function SupplierLogoTile({ member, onSaved, onError }) {
  function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      onError('Please choose a supplier logo smaller than 2 MB.');
      event.target.value = '';
      return;
    }
    updateSupplierLogo(member.id, file).then(onSaved).catch(error => onError(readableError(error, 'Could not upload the supplier logo.')));
    event.target.value = '';
  }

  return <label title={`Upload ${member.supplier_name || 'supplier'} logo · PNG/JPG/WebP · max 2 MB`} style={supplierLogoTileStyle}>
    {member.supplier_logo_url ? <img src={member.supplier_logo_url} alt={`${member.supplier_name || 'Supplier'} logo`} style={{ width:'100%', height:'100%', objectFit:'contain' }} /> : <span style={{ fontSize:10, color:'#718089', textAlign:'center', padding:5 }}>Supplier logo</span>}
    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} style={{ display:'none' }} />
  </label>;
}

const inputStyle = { flex: '1 1 200px', border: '1px solid #ddd', borderRadius: 6, padding: '9px 10px', fontSize: 13, fontFamily: FONT };
const eyebrow = { color:GOLD_PALE, fontSize:10, letterSpacing:1.8, textTransform:'uppercase', fontWeight:700 };
const primaryButton = { background: BLUE, color: '#fff', border: 'none', borderRadius: 5, padding: '10px 16px', fontWeight: 700, cursor: 'pointer' };
const secondaryButton = { background: '#fff', color: NAVY, border: '1px solid #d6dfdf', borderRadius: 5, padding: '10px 14px', fontWeight: 600, cursor: 'pointer' };
const deleteButton = { background: '#fff7f6', color: CORAL, border: '1px solid #f1cfcb', borderRadius: 5, padding: '8px 12px', cursor: 'pointer' };
const rowStyle = { background:'linear-gradient(135deg, #fff 0%, #f8fbfd 100%)', border:'1px solid #dce7ed', borderLeft:`4px solid ${TEAL}`, borderRadius:12, padding:'18px 20px', marginBottom:10, display:'flex', alignItems:'center', gap:16, boxShadow:'0 7px 20px rgba(13,26,50,.06)' };
const photoStyle = { width:52, height:52, objectFit:'cover', borderRadius:'50%', border:'2px solid #D9EAF6', flex:'0 0 auto' };
const photoFallback = { ...photoStyle, display:'grid', placeItems:'center', background:NAVY, color:GOLD_PALE, fontWeight:700, fontSize:15 };
const supplierLogoTileStyle = { width:76, height:58, flex:'0 0 76px', border:'1px solid #dfe7eb', borderRadius:8, background:'#f8fafb', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', cursor:'pointer' };
const clearLogoButton = { border:'none', background:'transparent', color:'#7a8a94', fontSize:10, cursor:'pointer', padding:0 };
const contactLink = { color:BLUE, textDecoration:'none' };
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
