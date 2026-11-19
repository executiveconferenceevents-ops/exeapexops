import { useEffect, useRef, useState } from 'react';
import { addExhibitor, getExhibitors, normalizeStand, removeExhibitor, updateExhibitor, upsertExhibitorRecords, readableError } from '../lib/mock';
import { downloadWorkbook } from '../lib/workbook';
import { applyExhibitorImportExtras, EXHIBITOR_TEMPLATE_COLUMNS, EXHIBITOR_TEMPLATE_EXAMPLE, getExhibitorFileUrl, getExhibitorProfiles, getOrders, getOrderSettings, getPackages, hasLogo, readServiceImportRows, saveExhibitorProfile, saveOrderSettings, sendExhibitorReminder } from '../lib/exhibitorServices';
import { NAVY, NAVY_DEEP, GOLD_PALE, BLUE, CORAL, BG, FONT } from '../theme';

export default function ExhibitorSetup({ onBack }) {
  const [exhibitors, setExhibitors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [packages, setPackages] = useState([]);
  const [checklistItems, setChecklistItems] = useState([]);
  const [checklistLabel, setChecklistLabel] = useState('');
  const [checklistKind, setChecklistKind] = useState('manual');
  const [directoryFilter, setDirectoryFilter] = useState('all');
  const [form, setForm] = useState(createExhibitorForm());
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [exhibitorSearch, setExhibitorSearch] = useState('');
  const exhibitorRefs = useRef({});

  async function refresh() {
    const [exhibitorResult, profilesResult, ordersResult, packagesResult, settingsResult] = await Promise.allSettled([
      getExhibitors(), getExhibitorProfiles(), getOrders(), getPackages(), getOrderSettings(),
    ]);
    if (exhibitorResult.status === 'fulfilled') setExhibitors(exhibitorResult.value);
    else setError(readableError(exhibitorResult.reason, 'Could not load exhibitor records.'));
    if (profilesResult.status === 'fulfilled') setExhibitors(profilesResult.value);
    if (ordersResult.status === 'fulfilled') setOrders(ordersResult.value);
    if (packagesResult.status === 'fulfilled') setPackages(packagesResult.value);
    if (settingsResult.status === 'fulfilled') setChecklistItems(settingsResult.value.exhibitor_checklist_items || []);
    const failedResult = [profilesResult, ordersResult, packagesResult, settingsResult].find(result => result.status === 'rejected');
    if (failedResult) setError(readableError(failedResult.reason, 'Some exhibitor service details are unavailable.'));
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    const refreshOnFocus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, []);

  const searchNeedle = exhibitorSearch.trim().toLowerCase();
  const searchedExhibitors = searchNeedle
    ? exhibitors.filter(exhibitor => `${exhibitor.name} ${exhibitor.stand}`.toLowerCase().includes(searchNeedle))
    : exhibitors;
  const filteredExhibitors = searchedExhibitors.filter(exhibitor => {
    const tasks = getChecklistTasks(exhibitor, { packages, orders, checklistItems });
    const hasMissing = tasks.some(task => task.required && !task.complete);
    return directoryFilter === 'all' || (directoryFilter === 'missing' ? hasMissing : !hasMissing);
  });
  const checklistSummary = getChecklistSummary(exhibitors, { packages, orders, checklistItems });

  useEffect(() => {
    if (!searchNeedle || !filteredExhibitors.length) return undefined;
    const match = filteredExhibitors.find(exhibitor => exhibitor.name.toLowerCase().startsWith(searchNeedle) || exhibitor.stand.toLowerCase().startsWith(searchNeedle)) || filteredExhibitors[0];
    const frame = window.requestAnimationFrame(() => exhibitorRefs.current[match.stand]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    return () => window.cancelAnimationFrame(frame);
  }, [exhibitorSearch, exhibitors]);

  function downloadTemplate() {
    downloadWorkbook('APEXOPS-exhibitors-template.xlsx', [{ name:'Exhibitors', headers:EXHIBITOR_TEMPLATE_COLUMNS, rows:[EXHIBITOR_TEMPLATE_EXAMPLE] }]);
  }

  function downloadReport() {
    downloadWorkbook('APEXOPS-exhibitor-report.xlsx', [{ name:'Exhibitors', headers:['Stand','Exhibitor','Contact','Phone','Email','Missing items'], rows: exhibitors.map(exhibitor => ({
      Stand: exhibitor.stand,
      Exhibitor: exhibitor.name,
      Contact: exhibitor.contact || '',
      Phone: exhibitor.phone || '',
      Email: exhibitor.email || '',
      'Missing items': getChecklistTasks(exhibitor, { packages, orders, checklistItems }).filter(task => task.required && !task.complete).map(task => task.label).join('; '),
    })) }]);
  }

  function downloadMissingReport() {
    const rows = exhibitors.map(exhibitor => ({
      Stand:exhibitor.stand,
      Exhibitor:exhibitor.name,
      Email:splitEmailAddresses(exhibitor.email)[0] || '',
      'Missing items':getChecklistTasks(exhibitor, { packages, orders, checklistItems }).filter(task => task.required && !task.complete).map(task => task.label).join('; '),
    })).filter(row => row['Missing items']);
    downloadWorkbook('APEXOPS-exhibitor-missing-items.xlsx', [{ name:'Missing items', headers:['Stand','Exhibitor','Email','Missing items'], rows }]);
  }

  async function addChecklistItem(event) {
    event.preventDefault();
    const label = checklistLabel.trim();
    if (!label) return;
    const next = [...checklistItems, { id:crypto.randomUUID(), label:label.slice(0, 80), auto_kind:checklistKind }];
    try {
      await saveOrderSettings({ exhibitor_checklist_items:next });
      setChecklistItems(next);
      setChecklistLabel('');
      setMessage(`Checklist item “${label}” added to this event.`);
    } catch (saveError) {
      setError(readableError(saveError, 'Could not add the checklist item.'));
    }
  }

  async function removeChecklistItem(itemId) {
    const next = checklistItems.filter(item => item.id !== itemId);
    try {
      await saveOrderSettings({ exhibitor_checklist_items:next });
      setChecklistItems(next);
    } catch (saveError) {
      setError(readableError(saveError, 'Could not remove the checklist item.'));
    }
  }

  async function toggleChecklistTask(exhibitor, task, checked) {
    try {
      if (task.source === 'pack') {
        await updateExhibitor(exhibitor.stand, { pack_collected:checked, pack_collected_at:checked ? new Date().toISOString() : null });
      } else {
        await saveExhibitorProfile(exhibitor.stand, {
          checklist_status:{ ...(exhibitor.checklist_status || {}), [task.id]:checked },
        });
      }
      await refresh();
    } catch (saveError) {
      setError(readableError(saveError, 'Could not update this checklist item.'));
    }
  }

  async function downloadExhibitorFile(file) {
    try {
      const url = await getExhibitorFileUrl(file);
      if (!url) throw new Error('This file is unavailable in the current demo session.');
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.download = file.file_name || 'exhibitor-artwork';
      link.click();
    } catch (fileError) {
      setError(readableError(fileError, 'Could not download this file.'));
    }
  }

  async function emailReminder(exhibitor) {
    const missing = getChecklistTasks(exhibitor, { packages, orders, checklistItems }).filter(task => task.required && !task.complete).map(task => task.label);
    if (!missing.length) return;
    try {
      const result = await sendExhibitorReminder(exhibitor.stand, missing);
      setMessage(result.message || `Reminder sent to ${exhibitor.name}.`);
    } catch (reminderError) {
      setError(readableError(reminderError, 'Could not send this exhibitor reminder.'));
    }
  }

  async function importWorkbook(event) {
    const file = event.target.files[0];
    if (!file) return;
    setError(''); setMessage('');
    try {
      const rows = await readServiceImportRows(file);
      const normalized = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]/g, '_'), String(value).trim()])));
      const imported = normalized.map(row => ({
        stand: row.stand || row.stand_number,
        name: row.name || row.exhibitor || row.company,
        contact: row.contact || row.contact_name,
        phone: [row.phone, row.mobile, row.cell_no_, row.cell_no, row.work_no_, row.work_no, row.contact_number, row.mobile_2, row.cell_no_2].filter(Boolean).join('; '),
        email: [row.email, row.email_2, row.email_3, row.email_4].filter(Boolean).join('; '),
      })).filter(row => row.stand && row.name);
      if (!imported.length) throw new Error('No rows with Stand and Exhibitor/Company columns were found.');
      const stands = imported.map(row => normalizeStand(row.stand));
      if (new Set(stands).size !== stands.length) throw new Error('This file contains duplicate stand numbers. Remove duplicates and import again.');
      await upsertExhibitorRecords(imported);
      try {
        const extras = await applyExhibitorImportExtras(rows);
        setMessage(`Imported ${imported.length} exhibitor records and ${extras} packages/fascia names.`);
      } catch (extrasError) {
        setMessage(`Imported ${imported.length} exhibitor records. Package and fascia details could not be fully imported: ${readableError(extrasError, 'Exhibitor services are not available yet.')}`);
      }
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
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'end', gap:20, marginBottom:22 }}><div><div style={eyebrow}>Event directory</div><h2 style={{ color: NAVY, margin:'6px 0 0', fontSize:28 }}>Exhibitors <span style={{ color:'#718089', fontSize:16, fontWeight:600 }}>({exhibitors.length})</span></h2><div style={{ color:'#687780', fontSize:13, marginTop:6 }}>The master stand list, artwork, and readiness checklist for this event.</div></div><div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'flex-end' }}><button type="button" onClick={downloadMissingReport} style={secondaryButton}>Export missing items</button><button type="button" onClick={downloadReport} style={secondaryButton}>Export full report</button><button type="button" onClick={downloadTemplate} style={secondaryButton}>Download Excel template</button><label style={{ ...primaryButton, cursor:'pointer', whiteSpace:'nowrap' }}>Import CSV / Excel<input type="file" accept=".csv,.xlsx,.xls" onChange={importWorkbook} style={{ display:'none' }} /></label></div></div>
        <section className="exhibitor-checklist-summary">
          <div className="exhibitor-checklist-stat"><strong>{checklistSummary.complete}/{checklistSummary.total}</strong><span>Required items complete</span></div>
          <div className="exhibitor-checklist-bars">{checklistSummary.byLabel.map(item => <div key={item.label}><span>{item.label}</span><progress value={item.complete} max={Math.max(item.total, 1)} /><small>{item.complete}/{item.total}</small></div>)}</div>
          <form className="exhibitor-checklist-add" onSubmit={addChecklistItem}>
            <input aria-label="New checklist item" placeholder="Add an event checklist item" maxLength={80} value={checklistLabel} onChange={event => setChecklistLabel(event.target.value)} />
            <select aria-label="Checklist completion rule" value={checklistKind} onChange={event => setChecklistKind(event.target.value)}>
              <option value="manual">Manual tick</option><option value="artwork_vinyl">Vinyl artwork upload</option><option value="artwork_fabric">Fabric artwork upload</option><option value="logo">Logo upload</option>
            </select>
            <button type="submit" style={primaryButton}>Add item</button>
          </form>
          {!!checklistItems.length && <div className="exhibitor-checklist-custom">{checklistItems.map(item => <span key={item.id}>{item.label}<button type="button" aria-label={`Remove ${item.label}`} onClick={() => removeChecklistItem(item.id)}>×</button></span>)}</div>}
        </section>
        <form className="directory-form" onSubmit={save} style={{ background:'#fff', padding:20, borderRadius:8, marginBottom:22, border:'1px solid #e1e6e5', borderTop:`3px solid ${BLUE}`, boxShadow:'0 4px 16px rgba(13,26,50,.05)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
            <input required disabled={Boolean(editing)} placeholder="Stand (e.g. A09/A10)" value={form.stand} onChange={e => setForm({ ...form, stand: e.target.value })} />
            <input required placeholder="Exhibitor name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input placeholder="Contact name" value={form.contact || ''} onChange={e => setForm({ ...form, contact: e.target.value })} />
            <input type="tel" placeholder="Primary mobile" value={form.phone1 || ''} onChange={e => setForm({ ...form, phone1: e.target.value })} />
            <input type="email" placeholder="Primary email" value={form.email1 || ''} onChange={e => setForm({ ...form, email1: e.target.value })} />
            <details className="exhibitor-extra-contacts">
              <summary>Additional contacts</summary>
              <div>{[2, 3, 4].map(number => <input key={number} type="tel" placeholder={`Mobile ${number}`} value={form[`phone${number}`] || ''} onChange={e => setForm({ ...form, [`phone${number}`]: e.target.value })} />)}
                {[2, 3, 4].map(number => <input key={`email-${number}`} type="email" placeholder={`Email ${number}`} value={form[`email${number}`] || ''} onChange={e => setForm({ ...form, [`email${number}`]: e.target.value })} />)}</div>
            </details>
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
          <div className="exhibitor-directory-filters" role="group" aria-label="Filter exhibitors by checklist">
            {[['all','All stands'],['missing','Needs attention'],['complete','Checklist complete']].map(([value,label]) => <button key={value} type="button" className={directoryFilter === value ? 'is-active' : ''} onClick={() => setDirectoryFilter(value)}>{label}</button>)}
          </div>
        </div>
        {message && <div style={{ color:'#1E8449', marginBottom:12 }}>{message}</div>}
        {filteredExhibitors.map(exhibitor => <div key={exhibitor.stand} ref={element => { exhibitorRefs.current[exhibitor.stand] = element; }} className="exhibitor-card directory-row" style={rowStyle}>
          <div style={{ width: 86, fontWeight: 800, color: BLUE, fontSize:14, letterSpacing:.6 }}>{exhibitor.stand}</div>
          <LogoTile exhibitor={exhibitor} onSaved={refresh} onError={setError} />
          <ExhibitorContacts exhibitor={exhibitor} />
          <ChecklistPanel exhibitor={exhibitor} packages={packages} orders={orders} checklistItems={checklistItems} onToggle={toggleChecklistTask} onDownload={downloadExhibitorFile} />
          <div className="exhibitor-card-actions">
            <button type="button" onClick={() => emailReminder(exhibitor)} disabled={!getChecklistTasks(exhibitor, { packages, orders, checklistItems }).some(task => task.required && !task.complete)} style={secondaryButton}>Email missing items</button>
            <button type="button" onClick={() => edit(exhibitor)} style={secondaryButton}>Edit</button>
            <button type="button" onClick={() => remove(exhibitor)} style={deleteButton}>Remove</button>
          </div>
        </div>)}
        {!filteredExhibitors.length && <div style={emptySearchStyle}>{searchNeedle ? `No exhibitor or stand matches “${exhibitorSearch}”.` : directoryFilter === 'missing' ? 'All exhibitors have completed their required checklist items.' : 'No exhibitors match this filter.'}</div>}
      </main>
    </div>
  );
}

function getChecklistTasks(exhibitor, { packages, orders, checklistItems }) {
  const pkg = packages.find(item => item.code === exhibitor.package_code);
  const packageHasFascia = !pkg || (pkg.features || []).some(feature => feature.key === 'fascia_name');
  const files = exhibitor.files || [];
  const standOrders = orders.filter(order => normalizeStand(order.stand) === normalizeStand(exhibitor.stand));
  const filesOf = kind => files.filter(file => file.kind === kind);
  const tasks = [];
  if (packageHasFascia) tasks.push({
    id:'fascia', label:'Fascia name', required:true, automatic:true,
    complete:Boolean(exhibitor.fascia_name && exhibitor.fascia_status !== 'pending'),
    hint:exhibitor.fascia_name ? `Submitted: ${exhibitor.fascia_name}` : 'Waiting for fascia wording',
  });
  const logoFiles = filesOf('logo');
  const logoRequired = hasLogo(pkg) || Boolean(exhibitor.logo_paid);
  tasks.push({
    id:'logo', label:'Logo artwork', required:logoRequired, automatic:true,
    complete:Boolean(exhibitor.logo_url || logoFiles.length), hint:logoFiles.length ? `${logoFiles.length} file${logoFiles.length === 1 ? '' : 's'} uploaded` : exhibitor.logo_url ? 'Logo added to directory' : logoRequired ? 'Logo required by package' : 'Optional',
    files:logoFiles,
  });
  [
    { feature:'vinyl', kind:'artwork_vinyl', label:'Vinyl graphics artwork' },
    { feature:'fabric_wall', kind:'artwork_fabric', label:'Fabric banner artwork' },
  ].filter(task => (pkg?.features || []).some(item => item.key === task.feature)).forEach(task => {
    const artworkFiles = filesOf(task.kind);
    tasks.push({
      id:task.kind, label:task.label, required:true, automatic:true,
      complete:artworkFiles.length > 0,
      hint:artworkFiles.length ? `${artworkFiles.length} file${artworkFiles.length === 1 ? '' : 's'} uploaded` : 'Required by package',
      files:artworkFiles,
    });
  });
  tasks.push({
    id:'welcome-pack', source:'pack', label:'Welcome pack collected', required:true, automatic:false,
    complete:Boolean(exhibitor.pack_collected), hint:exhibitor.pack_collected_by ? `Received by ${exhibitor.pack_collected_by}` : 'Not collected',
  });
  tasks.push({
    id:'furniture-order', label:'Furniture order', required:false, automatic:true,
    complete:standOrders.length > 0, hint:standOrders.length ? `${standOrders.length} order${standOrders.length === 1 ? '' : 's'} submitted` : 'No additional order',
  });
  checklistItems.forEach(item => {
    const linkedFiles = item.auto_kind && item.auto_kind !== 'manual' ? filesOf(item.auto_kind) : [];
    const automatic = item.auto_kind && item.auto_kind !== 'manual';
    tasks.push({
      id:item.id, label:item.label, required:true, automatic,
      complete:automatic ? linkedFiles.length > 0 : Boolean(exhibitor.checklist_status?.[item.id]),
      hint:automatic ? (linkedFiles.length ? `${linkedFiles.length} file${linkedFiles.length === 1 ? '' : 's'} uploaded` : 'Waiting for upload') : 'Manual check',
      files:linkedFiles,
    });
  });
  return tasks;
}

function getChecklistSummary(exhibitors, context) {
  const byLabel = new Map();
  let total = 0;
  let complete = 0;
  exhibitors.forEach(exhibitor => getChecklistTasks(exhibitor, context).filter(task => task.required).forEach(task => {
    total += 1;
    if (task.complete) complete += 1;
    const value = byLabel.get(task.label) || { label:task.label, complete:0, total:0 };
    value.total += 1;
    if (task.complete) value.complete += 1;
    byLabel.set(task.label, value);
  }));
  return { complete, total, byLabel:[...byLabel.values()] };
}

function ExhibitorContacts({ exhibitor }) {
  const emails = splitEmailAddresses(exhibitor.email);
  const phones = splitPhoneNumbers(exhibitor.phone);
  return <div className="exhibitor-contact-summary">
    <strong>{exhibitor.name}</strong>
    <small>{exhibitor.contact || 'No primary contact recorded'}</small>
    {emails[0] && <a href={`mailto:${emails[0]}`}>{emails[0]}</a>}
    {phones[0] && <a href={whatsappLink(phones[0])} target="_blank" rel="noreferrer">{phones[0]}</a>}
    {(emails.length > 1 || phones.length > 1) && <details>
      <summary>+{Math.max(emails.length - 1, 0) + Math.max(phones.length - 1, 0)} more contacts</summary>
      {emails.slice(1).map((email, index) => <a key={`email-${index}`} href={`mailto:${email}`}>{email}</a>)}
      {phones.slice(1).map((phone, index) => <a key={`phone-${index}`} href={whatsappLink(phone)} target="_blank" rel="noreferrer">{phone}</a>)}
    </details>}
  </div>;
}

function ChecklistPanel({ exhibitor, packages, orders, checklistItems, onToggle, onDownload }) {
  const tasks = getChecklistTasks(exhibitor, { packages, orders, checklistItems });
  const complete = tasks.filter(task => task.complete && task.required).length;
  const required = tasks.filter(task => task.required).length;
  return <section className="exhibitor-checklist">
    <header><strong>Readiness checklist</strong><span>{complete}/{required} complete</span></header>
    {tasks.map(task => <div className="exhibitor-checklist-row" key={task.id}>
      <label>
        <input type="checkbox" checked={task.complete} disabled={task.automatic} onChange={event => onToggle(exhibitor, task, event.target.checked)} />
        <span><strong>{task.label}</strong><small>{task.hint}</small></span>
      </label>
      {task.files?.map(file => <button key={file.id || file.file_name} type="button" onClick={() => onDownload(file)}>Download {file.file_name}</button>)}
      {!task.required && <em>Optional</em>}
    </div>)}
    {exhibitor.pack_collected_at && <small className="exhibitor-checklist-stamp">Pack recorded {formatLocalStamp(exhibitor.pack_collected_at)}</small>}
  </section>;
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
function firstContact(value) { return String(value || '').split(/[;,]/)[0].trim(); }
function whatsappLink(value) {
  const digits = whatsappDigits(firstContact(value));
  return digits ? `https://wa.me/${digits}` : `tel:${encodeURIComponent(value)}`;
}
function whatsappDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^0[6-8]\d{8}$/.test(digits) ? `27${digits.slice(1)}` : digits;
}
function formatLocalStamp(value) { return new Date(value).toLocaleString([], { dateStyle:'short', timeStyle:'short' }); }
