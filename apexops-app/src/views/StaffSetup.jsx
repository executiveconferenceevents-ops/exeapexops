import { useEffect, useRef, useState } from 'react';
import { addStaff, CATEGORIES, getQueries, getStaff, getSuppliers, normalizeDepartments, readableError, removeStaff, removeSupplier, updateStaff, updateSupplierLogo, upsertStaffRecords, upsertSuppliers } from '../lib/mock';
import { downloadWorkbook, readWorkbookRows } from '../lib/workbook';
import { NAVY, NAVY_DEEP, GOLD_PALE, BLUE, TEAL, CORAL, BG, FONT } from '../theme';
import StaffQuickTabs from '../components/StaffQuickTabs';
import './StaffSetup.css';

export default function StaffSetup({ onViewJobs }) {
  const [staff, setStaff] = useState([]);
  const [queries, setQueries] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [directoryTab, setDirectoryTab] = useState('staff');
  const [staffFilter, setStaffFilter] = useState('ALL');
  const formRef = useRef(null);
  const supplierFormRef = useRef(null);
  const emptyForm = { supplier_name: '', name: '', email: '', category: '', departments: [], mobile: '', photo: null };
  const emptySupplierForm = { name:'', contact:'', email:'', mobile:'', category:'Other' };
  const [form, setForm] = useState(emptyForm);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [editing, setEditing] = useState(null);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function refresh() {
    try {
      const [rows, supplierRows] = await Promise.all([getStaff(), getSuppliers()]);
      setStaff(rows);
      setSuppliers(supplierRows);
      setError(rows.some(member => member.departmentsMigrationPending)
        ? 'Existing staff are shown, but multiple departments cannot be saved until you run supabase/staff-departments-migration.sql in the Supabase SQL Editor.'
        : '');
      try {
        setQueries(await getQueries());
      } catch (queryError) {
        setError(readableError(queryError, 'Staff loaded, but assigned jobs could not be loaded.'));
      }
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
    setDirectoryTab('staff');
    setStaffFilter('ALL');
    const departments = normalizeDepartments(member.departments, member.category);
    setForm({ supplier_name: member.supplier_name || '', name: member.name, email: member.email || '', category: departments[0] || '', departments, mobile: member.mobile || '', photo: null });
    setError('');
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior:'smooth', block:'start' }));
  }

  async function save(event) {
    event.preventDefault();
    if (!form.supplier_name.trim()) {
      setError('Enter the supplier or company name.');
      return;
    }
    if (!form.name.trim()) {
      setError('Enter the staff member’s name.');
      return;
    }
    if (!form.departments.length) {
      setError('Select at least one department.');
      return;
    }
    setError('');
    setMessage('');
    try {
      if (editing) await updateStaff(editing.id, form);
      else await addStaff(form);
      setEditing(null);
      setForm(emptyForm);
      await refresh();
      setMessage(editing ? 'Staff member updated.' : 'Staff member added.');
    } catch (saveError) {
        setError(readableError(saveError, 'Could not save staff member.'));
    }
  }

  async function saveSupplier(event) {
    event.preventDefault();
    const newName = String(supplierForm.name || '').trim();
    if (!newName) {
      setError('Enter a supplier company name.');
      return;
    }
    setError('');
    setMessage('');
    try {
      const oldName = editingSupplier?.name || '';
      const duplicate = supplierEntries.find(supplier => supplier.name.toLowerCase() === newName.toLowerCase() && supplier.id !== editingSupplier?.id);
      if (duplicate) throw new Error('A supplier with that name already exists.');
      const affected = oldName && oldName.toLowerCase() !== newName.toLowerCase()
        ? staff.filter(member => String(member.supplier_name || '').toLowerCase() === oldName.toLowerCase())
        : [];
      if (affected.length) await upsertStaffRecords(affected.map(member => ({ ...member, supplier_name:newName })));
      await upsertSuppliers([{ ...supplierForm, id:editingSupplier?.id, name:newName }]);
      setSupplierForm(emptySupplierForm);
      setEditingSupplier(null);
      setMessage(editingSupplier ? `${newName} updated.` : `${newName} added to suppliers.`);
      await refresh();
    } catch (saveError) {
      setError(readableError(saveError, 'Could not save the supplier.'));
    }
  }

  async function removeSupplierFromDirectory(supplier) {
    const supplierName = supplier.name;
    const affected = staff.filter(member => String(member.supplier_name || '').toLowerCase() === supplierName.toLowerCase());
    if (!window.confirm(`Remove ${supplierName} from the supplier list? Its ${affected.length} linked staff record${affected.length === 1 ? '' : 's'} will be kept without a supplier assignment.`)) return;
    try {
      if (affected.length) await upsertStaffRecords(affected.map(member => ({ ...member, supplier_name:'' })));
      if (supplier.id) await removeSupplier(supplier.id);
      setSupplierForm(emptySupplierForm);
      setEditingSupplier(null);
      setMessage(`${supplierName} removed. Staff records were kept.`);
      await refresh();
    } catch (removeError) {
      setError(readableError(removeError, 'Could not remove the supplier.'));
    }
  }

  async function remove(member) {
    if (!window.confirm(`Remove ${member.name} from the staff list?`)) return;
    try {
      await removeStaff(member.id);
      await refresh();
      setMessage(`${member.name} removed from the staff list.`);
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

  const supplierGroups = [...staff.reduce((groups, member) => {
    const name = String(member.supplier_name || '').trim();
    if (!name) return groups;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, members:[] });
    groups.get(key).members.push(member);
    return groups;
  }, new Map()).values()];
  const supplierEntries = [
    ...suppliers.map(supplier => ({
      ...supplier,
      members:staff.filter(member => String(member.supplier_name || '').toLowerCase() === String(supplier.name || '').toLowerCase()),
    })),
    ...supplierGroups
      .filter(group => !suppliers.some(supplier => String(supplier.name || '').toLowerCase() === group.name.toLowerCase()))
      .map(group => ({ ...group, category:'Other', members:group.members })),
  ].sort((first, second) => first.name.localeCompare(second.name));
  const visibleStaff = staffFilter === 'ALL' ? staff : staff.filter(member => String(member.id) === String(staffFilter));

  return (
    <div className="apex-service-screen staff-directory-screen" style={{ fontFamily: FONT, minHeight: '100vh', background:'linear-gradient(180deg, #e6eff5 0%, #f3f4f2 54%, #e9f0f4 100%)', color:NAVY }}>
      <header className="apex-service-header" style={{ background:`linear-gradient(110deg, ${NAVY_DEEP}, ${NAVY})`, color:'#fff', padding:'18px 32px', display:'flex', alignItems:'center', justifyContent:'space-between', boxShadow:'0 2px 14px rgba(13,26,50,.16)' }}>
        <div><div style={{ color:GOLD_PALE, fontWeight:700, fontSize:18, letterSpacing:2 }}>APEXOPS™</div><div style={{ color:'rgba(255,255,255,.58)', fontSize:10, letterSpacing:1.6, textTransform:'uppercase', marginTop:4 }}>People &amp; suppliers</div></div>
        <div style={{ fontSize:12, color:'rgba(255,255,255,.72)' }}>People &amp; delivery partners</div>
      </header>
      <main className="apex-service-main directory-main" style={{ maxWidth: 1280, width:'calc(100% - 48px)', margin: '0 auto', padding:'34px 0 64px' }}>
        <div className="staff-directory-heading"><div><div style={eyebrow}>Operations directory</div><h2 style={{ color:NAVY, margin:'6px 0 0', fontSize:28 }}>People &amp; suppliers</h2><div style={{ color:'#687780', fontSize:13, marginTop:6 }}>Keep supplier companies and their assigned staff easy to find.</div></div><div className="staff-directory-actions"><button type="button" onClick={downloadReport} style={secondaryButton}>Export directory</button><button type="button" onClick={downloadTemplate} style={secondaryButton}>Download template</button><label style={{ ...primaryButton, cursor:'pointer', whiteSpace:'nowrap' }}>Import CSV / Excel<input type="file" accept=".csv,.xlsx,.xls" onChange={importWorkbook} style={{ display:'none' }} /></label></div></div>
        <div className="staff-directory-tabs" role="tablist" aria-label="Directory sections">
          <button type="button" role="tab" aria-selected={directoryTab==='staff'} className={directoryTab==='staff'?'is-active':''} onClick={()=>setDirectoryTab('staff')}>Staff <span>{staff.length}</span></button>
          <button type="button" role="tab" aria-selected={directoryTab==='suppliers'} className={directoryTab==='suppliers'?'is-active':''} onClick={()=>setDirectoryTab('suppliers')}>Suppliers <span>{supplierEntries.length}</span></button>
        </div>
        {message && <div className="staff-directory-message" role="status">{message}</div>}
        {error && <div className="staff-directory-error" role="alert">{error}</div>}
        {directoryTab==='staff' && <>
          <StaffQuickTabs staff={staff} selectedId={staffFilter} onSelect={setStaffFilter} rows={queries} label="Filter staff directory" selectLabel="Jump to staff member" />
          <form className="directory-form" ref={formRef} onSubmit={save} style={{ background:'linear-gradient(135deg, #fff 0%, #f8fbfd 100%)', padding:22, borderRadius:14, marginBottom:22, border:'1px solid #dce7ed', borderTop:`3px solid ${TEAL}`, boxShadow:'0 10px 26px rgba(13,26,50,.08)', scrollMarginTop:20 }}>
            <h3 className="staff-form-title">{editing ? 'Edit staff member' : 'Add staff member'}</h3>
            <div className="staff-form-fields">
              <input required value={form.name} placeholder="Staff member name" aria-label="Staff member name" onChange={e => setForm({ ...form, name:e.target.value })} style={inputStyle} />
              <input required value={form.supplier_name} placeholder="Supplier / company" aria-label="Supplier or company" onChange={e => setForm({ ...form, supplier_name:e.target.value })} style={inputStyle} />
              <input type="email" value={form.email} placeholder="Email address (optional)" aria-label="Email address" onChange={e => setForm({ ...form, email:e.target.value })} style={inputStyle} />
              <input value={form.mobile} placeholder="Mobile (optional)" aria-label="Mobile number" onChange={e => setForm({ ...form, mobile:e.target.value })} style={inputStyle} />
            </div>
            <fieldset className="staff-departments">
              <legend>Departments <small>Select all that apply</small></legend>
              <div className="staff-dept-grid">
                {CATEGORIES.map(category => <label className={`staff-dept-option${form.departments.includes(category)?' is-selected':''}`} key={category}>
                  <input type="checkbox" checked={form.departments.includes(category)} onChange={event => {
                    setForm(current => {
                      const departments = event.target.checked
                        ? [...current.departments, category]
                        : current.departments.filter(item => item !== category);
                      return { ...current, departments, category:departments[0] || '' };
                    });
                  }} />
                  <span>{category}</span>
                </label>)}
              </div>
            </fieldset>
            <label className="staff-photo-field">Profile photo <input type="file" accept="image/*" onChange={e => setForm({ ...form, photo:e.target.files[0] || null })} /></label>
            <div className="staff-form-actions"><button type="submit" style={primaryButton}>{editing ? 'Save changes' : 'Add staff member'}</button>{editing && <button type="button" onClick={() => { setEditing(null); setForm(emptyForm); }} style={secondaryButton}>Cancel</button>}</div>
          </form>
          {visibleStaff.map(member => (
            <div key={member.id} className="directory-row" style={rowStyle}>
              {member.photo_url ? <img src={member.photo_url} alt={`${member.name} profile`} style={photoStyle} /> : <div style={photoFallback}>{initials(member.name)}</div>}
              <div className="staff-directory-member"><strong>{member.name}</strong><span>{member.supplier_name || 'Supplier not assigned'}</span><small>{(member.departments || [member.category]).filter(Boolean).join(', ')}</small><div className="staff-contact-links">{member.email ? <a href={`mailto:${firstContact(member.email)}`} style={contactLink}>Email</a> : <span>Email not recorded</span>}{member.mobile ? <a href={whatsappLink(member.mobile)} target="_blank" rel="noreferrer" style={contactLink}>Mobile</a> : <span>Mobile not recorded</span>}</div></div>
              <div className="staff-directory-logo"><SupplierLogoTile member={member} onSaved={refresh} onError={setError} /><button type="button" onClick={() => clearSupplierLogo(member)} style={clearLogoButton}>Clear logo</button></div>
              <div className="staff-directory-row-actions">{onViewJobs && <button type="button" onClick={()=>onViewJobs(member.id)} style={secondaryButton}>View jobs</button>}<button type="button" onClick={() => edit(member)} style={secondaryButton}>Edit</button><button type="button" onClick={() => remove(member)} style={deleteButton}>Remove</button></div>
            </div>
          ))}
          {!visibleStaff.length && <p className="tenant-empty">{staff.length ? 'No staff member matches this filter.' : 'No staff members yet. Add the first staff member above.'}</p>}
        </>}
        {directoryTab==='suppliers' && <section className="staff-supplier-list" aria-label="Supplier companies">
          <div className="staff-supplier-intro"><p>Manage supplier companies here, separately from staff records. Adding a supplier stays on this tab; staff can be added independently and linked to a company.</p><button type="button" onClick={()=>{setEditingSupplier(null);setSupplierForm(emptySupplierForm);window.requestAnimationFrame(()=>supplierFormRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));}}>Add supplier</button></div>
          <form className="staff-supplier-form" ref={supplierFormRef} onSubmit={saveSupplier}>
            <h3>{editingSupplier ? 'Edit supplier' : 'Add supplier company'}</h3>
            <div className="staff-supplier-fields">
              <label>Supplier name<input required value={supplierForm.name} onChange={event=>setSupplierForm(current=>({...current,name:event.target.value}))}/></label>
              <label>Contact name<input value={supplierForm.contact} onChange={event=>setSupplierForm(current=>({...current,contact:event.target.value}))}/></label>
              <label>Email<input type="email" value={supplierForm.email} onChange={event=>setSupplierForm(current=>({...current,email:event.target.value}))}/></label>
              <label>Mobile<input value={supplierForm.mobile} onChange={event=>setSupplierForm(current=>({...current,mobile:event.target.value}))}/></label>
              <label>Department / service<input value={supplierForm.category} onChange={event=>setSupplierForm(current=>({...current,category:event.target.value}))}/></label>
            </div>
            <div className="staff-form-actions"><button type="submit" style={primaryButton}>{editingSupplier ? 'Save supplier' : 'Add supplier'}</button>{editingSupplier && <button type="button" style={secondaryButton} onClick={()=>{setEditingSupplier(null);setSupplierForm(emptySupplierForm);}}>Cancel</button>}</div>
          </form>
          {supplierEntries.map(supplier=>{
            const representative=supplier.members.find(member=>member.supplier_logo_url)||supplier.members[0];
            return <article className="staff-supplier-card" key={supplier.id || supplier.name.toLowerCase()}>
              <div className="staff-supplier-card-head">{representative?.supplier_logo_url?<img src={representative.supplier_logo_url} alt={`${supplier.name} logo`}/>:<div className="staff-supplier-initials">{initials(supplier.name)}</div>}<div><h3>{supplier.name}</h3><span>{supplier.category || 'Supplier'} · {supplier.members.length} linked staff member{supplier.members.length===1?'':'s'}</span></div><div className="staff-supplier-actions"><button type="button" style={secondaryButton} onClick={()=>{setEditingSupplier(supplier.id ? supplier : null);setSupplierForm({name:supplier.name,contact:supplier.contact||'',email:supplier.email||'',mobile:supplier.mobile||'',category:supplier.category||'Other'});window.requestAnimationFrame(()=>supplierFormRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));}}>{supplier.id ? 'Edit supplier' : 'Add supplier record'}</button><button type="button" style={secondaryButton} onClick={()=>{setDirectoryTab('staff');setForm({...emptyForm,supplier_name:supplier.name});setEditing(null);window.requestAnimationFrame(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));}}>Add staff</button><button type="button" style={deleteButton} onClick={()=>removeSupplierFromDirectory(supplier)}>Remove supplier</button></div></div>
              {(supplier.contact || supplier.email || supplier.mobile) && <div className="staff-supplier-contact">{supplier.contact && <span>{supplier.contact}</span>}{supplier.email && <a href={`mailto:${supplier.email}`}>{supplier.email}</a>}{supplier.mobile && <span>{supplier.mobile}</span>}</div>}
              <div className="staff-supplier-members">{supplier.members.map(member=><span key={member.id}>{member.name} <small>{(member.departments||[member.category]).filter(Boolean).join(', ')}</small></span>)}</div>
            </article>;
          })}
          {!supplierEntries.length && <p className="tenant-empty">No supplier companies yet. Add the first supplier above.</p>}
        </section>}
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
