import { useEffect, useState } from 'react';
import { CATEGORIES, getStaff, getSuppliers, readableError, upsertStaffRecords, upsertSuppliers } from '../lib/mock';
import { readWorkbookRows } from '../lib/workbook';
import { NAVY, NAVY_DEEP, GOLD_PALE, BLUE, BG, FONT } from '../theme';

export default function PeopleSetup({ onBack }) {
  const [tab, setTab] = useState('staff');
  const [staff, setStaff] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const [nextStaff, nextSuppliers] = await Promise.all([getStaff(), getSuppliers()]);
      setStaff(nextStaff); setSuppliers(nextSuppliers);
    } catch (loadError) { setError(readableError(loadError, 'Could not load people.')); }
  }
  useEffect(() => { refresh(); }, []);

  async function importWorkbook(event) {
    const file = event.target.files[0];
    if (!file) return;
    setError(''); setMessage('');
    try {
      const rows = await readWorkbookRows(await file.arrayBuffer());
      const normalized = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, '_'), String(value).trim()])));
      const people = normalized.filter(row => row.name || row.full_name || row.staff_name || row.supplier || row.supplier_name);
      if (!people.length) throw new Error('No rows with a Name or Supplier column were found.');
      if (tab === 'staff') {
        await upsertStaffRecords(people.map(row => ({ id: row.id, name: row.name || row.full_name || row.staff_name, category: row.category || row.department, mobile: row.mobile || row.cellphone || row.phone, role: row.role })));
      } else {
        await upsertSuppliers(people.map(row => ({ id: row.id, name: row.supplier || row.supplier_name || row.name, category: row.category, contact: row.contact || row.contact_name, mobile: row.mobile || row.cellphone || row.phone, email: row.email })));
      }
      setMessage(`Imported ${people.length} ${tab} records.`); await refresh();
    } catch (importError) { setError(readableError(importError, 'Could not import this workbook.')); }
    event.target.value = '';
  }

  return <div style={{ fontFamily: FONT, minHeight:'100vh', background:`radial-gradient(circle at 90% 10%, rgba(180,154,106,.12), transparent 28%), linear-gradient(135deg, ${NAVY_DEEP} 0%, ${NAVY} 56%, #273958 100%)`, color:NAVY }}>
    <header style={{ background:'transparent', color:'#fff', padding:'28px 32px 22px', display:'flex', justifyContent:'space-between', alignItems:'end' }}>
      <div><div style={{ color:GOLD_PALE, fontWeight:700, fontSize:19, letterSpacing:2 }}>APEXOPS™</div><div style={{ color:'rgba(255,255,255,.58)', fontSize:10, letterSpacing:1.8, textTransform:'uppercase', marginTop:4 }}>People &amp; supplier setup</div></div>
      <button onClick={onBack} style={secondaryButton}>Back</button>
    </header>
    <main style={{ maxWidth:1120, margin:'0 auto', padding:'18px 32px 64px' }}>
      <div style={{ marginBottom:18 }}><div style={eyebrowStyle}>Operations directory</div><h1 style={{ color:'#fff', fontSize:30, margin:'7px 0 0' }}>People &amp; suppliers</h1><p style={{ color:'rgba(255,255,255,.66)', fontSize:13, margin:'7px 0 0' }}>Manage the people and partners who keep every event request moving.</p></div>
      <div style={tabShellStyle}>
        <div style={{ display:'flex', gap:8 }}>
          {['staff', 'suppliers'].map(item => <button key={item} onClick={()=>setTab(item)} style={{ ...tabButton, background:tab === item ? `linear-gradient(135deg, ${BLUE}, #238f8a)` : '#fff', color:tab === item ? '#fff' : NAVY, boxShadow:tab === item ? '0 8px 16px rgba(23,39,70,.16)' : 'none' }}>{item === 'staff' ? `Staff (${staff.length})` : `Suppliers (${suppliers.length})`}</button>)}
        </div>
        <label style={{ ...secondaryButton, cursor:'pointer' }}>Import Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={importWorkbook} style={{ display:'none' }} /></label>
      </div>
      <div style={{ background:'#fff', borderRadius:12, padding:'16px 18px', marginBottom:16, color:'#586b75', fontSize:13, border:'1px solid #e1e9ed', borderTop:`3px solid ${GOLD_PALE}`, boxShadow:'0 10px 24px rgba(0,0,0,.12)' }}>Upload an Excel file with headers such as <strong style={{ color:NAVY }}>Name, Department, Mobile</strong> for staff, or <strong style={{ color:NAVY }}>Supplier, Contact, Mobile, Email</strong> for suppliers.</div>
      {message && <div style={{ color:'#1E8449', marginBottom:12 }}>{message}</div>}
      {error && <div style={{ background:'#FDEDEC', color:'#922B21', padding:10, borderRadius:6, marginBottom:12 }}>{error}</div>}
      {(tab === 'staff' ? staff : suppliers).map(person => <div key={person.id} style={rowStyle}><div style={{ flex:1 }}><strong style={{ color:NAVY }}>{person.name}</strong><div style={{ color:'#687780', fontSize:12, marginTop:4 }}>{person.category || 'Other'} {person.mobile ? `· ${person.mobile}` : ''} {person.email ? `· ${person.email}` : ''}</div></div></div>)}
    </main>
  </div>;
}

const tabButton = { border:'none', borderRadius:6, padding:'9px 16px', fontWeight:700, cursor:'pointer' };
const eyebrowStyle = { color:GOLD_PALE, fontSize:10, letterSpacing:2, textTransform:'uppercase', fontWeight:700 };
const tabShellStyle = { display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, padding:10, marginBottom:14, background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.22)', borderRadius:12 };
const secondaryButton = { background:'#fff', color:NAVY, border:'1px solid #d6dfdf', borderRadius:6, padding:'9px 14px', fontWeight:700, cursor:'pointer', boxShadow:'0 3px 10px rgba(0,0,0,.12)' };
const rowStyle = { background:'#fff', border:'1px solid #e1e9ed', borderLeft:`3px solid ${BLUE}`, borderRadius:9, padding:'15px 17px', marginBottom:8, display:'flex', boxShadow:'0 5px 14px rgba(0,0,0,.1)' };
