// ─── Data catalog and query store ────────────────────────────────────────────
import { supabase } from './supabase';
import { DEMO_MODE, getAppStorage, getDemoCollection, setDemoCollection } from './demoStore';
import { getActiveEventCode, getActiveEventId, getEventSlug } from './eventScope';

function eventCacheKey(key) {
  return `${key}:${getEventSlug()}`;
}

function eventRow(row) {
  return { ...row, event_id:getActiveEventId() };
}

export function readableError(error, fallback = 'Something went wrong.') {
  if (typeof error === 'string') return error;
  return error?.message || error?.details || error?.hint || fallback;
}

export const CATEGORIES = [
  "Stand Builder",
  "Graphics & Branding",
  "Electrical",
  "Furniture",
  "AV / Technical",
  "Internet / Wi-Fi",
  "Logistics / Freight / Loading Bay",
  "Storage",
  "Cleaning & Waste",
  "Security",
  "H&S / Medics",
  "Organiser",
];

const STAFF_FALLBACK = [];
const DEMO_STAFF = [
  { id:'demo-staff-stand', name:'Taylor Reed', supplier_name:'Summit Stand Services', email:'taylor@example.test', category:'Stand Builder', mobile:'555-0101', role:'staff' },
  { id:'demo-staff-electrical', name:'Morgan Vale', supplier_name:'Brightline Electrical', email:'morgan@example.test', category:'Electrical', mobile:'555-0102', role:'staff' },
  { id:'demo-staff-organiser', name:'Jamie Quinn', supplier_name:'APEXOPS Demo Team', email:'jamie@example.test', category:'Organiser', mobile:'555-0103', role:'staff' },
];
const DEMO_SUPPLIERS = [
  { id:'demo-supplier-stand', name:'Summit Stand Services', category:'Stand Builder', contact:'Taylor Reed', mobile:'555-0101', email:'taylor@example.test' },
  { id:'demo-supplier-electrical', name:'Brightline Electrical', category:'Electrical', contact:'Morgan Vale', mobile:'555-0102', email:'morgan@example.test' },
];
const STAFF_CONTACT_CACHE_KEY = 'apexops.staff-contact-overrides';
const SUPPLIER_LOGO_CACHE_KEY = 'apexops.supplier-logo-overrides';
const EXHIBITOR_LOGO_CACHE_KEY = 'apexops.exhibitor-logo-overrides';
const EXHIBITOR_SCANNER_CACHE_KEY = 'apexops.exhibitor-scanner-overrides';
const EVENT_BANNER_CACHE_KEY = 'apexops.event-banner';

export function normalizeCategory(category) {
  const value = String(category || '').trim();
  const aliases = {
    'Stand Construction': 'Stand Builder',
    'H & S': 'H&S / Medics',
    'Medics': 'H&S / Medics',
    'Loading Bay': 'Logistics / Freight / Loading Bay',
    'Logistics / Freight': 'Logistics / Freight / Loading Bay',
    'Other': 'Organiser',
  };
  return aliases[value] || value;
}

export function normalizeDepartments(departments, fallbackCategory) {
  const values = Array.isArray(departments) && departments.length
    ? departments
    : String(fallbackCategory || departments || '').split(/[;,]/);
  return [...new Set(values.map(normalizeCategory).filter(Boolean))];
}

function departmentsMigrationError(error) {
  const message = String(error?.message || '').toLowerCase();
  return /departments/.test(message) && /(column|schema cache|does not exist|could not find)/.test(message);
}

function missingDepartmentsMigrationError() {
  return new Error('Staff departments are not enabled in Supabase yet. Run supabase/staff-departments-migration.sql in the Supabase SQL Editor, then try again.');
}

export function canViewDepartment(member, category) {
  const memberCategory = normalizeCategory(member?.category);
  const targetCategory = normalizeCategory(category);

  if (!memberCategory || !targetCategory) return false;
  if (memberCategory === 'Organiser' || memberCategory === 'Stand Builder') return true;
  return memberCategory === targetCategory;
}

function readStaffContactOverrides() {
  try { return JSON.parse(getAppStorage().getItem(eventCacheKey(STAFF_CONTACT_CACHE_KEY)) || '{}'); }
  catch { return {}; }
}

function cacheStaffContact(member) {
  try {
    const overrides = readStaffContactOverrides();
    overrides[member.id] = { supplier_name: member.supplier_name || '', email: member.email || '', photo_url: member.photo_url || overrides[member.id]?.photo_url || '' };
    getAppStorage().setItem(eventCacheKey(STAFF_CONTACT_CACHE_KEY), JSON.stringify(overrides));
  } catch { /* local storage may be unavailable */ }
}

function readSupplierLogoOverrides() {
  try { return JSON.parse(getAppStorage().getItem(eventCacheKey(SUPPLIER_LOGO_CACHE_KEY)) || '{}'); }
  catch { return {}; }
}

function cacheSupplierLogo(memberId, logoUrl) {
  try {
    const overrides = readSupplierLogoOverrides();
    overrides[String(memberId || '')] = logoUrl || '';
    getAppStorage().setItem(eventCacheKey(SUPPLIER_LOGO_CACHE_KEY), JSON.stringify(overrides));
  } catch { /* local storage may be unavailable */ }
}

function isUploadFile(value) {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

async function uploadPublicImage(bucket, prefix, file) {
  if (file.size > 2 * 1024 * 1024) throw new Error('Please choose an image smaller than 2 MB.');
  if (file.type && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Please choose a PNG, JPG, or WebP image.');
  }
  if (!supabase) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read the selected image.'));
      reader.readAsDataURL(file);
    });
  }
  const fileName = String(file.name || 'image').replace(/[^a-zA-Z0-9._-]/g, '-');
  const path = `${getActiveEventId()}/${prefix}/${Date.now()}-${fileName}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) {
    if (error.message?.toLowerCase().includes('bucket not found')) {
      throw new Error(`Photo storage bucket '${bucket}' is missing. Run supabase/media-buckets.sql in the Supabase SQL editor, then try again.`);
    }
    if (error.message?.toLowerCase().includes('row-level security') || error.statusCode === '403' || error.statusCode === 403) {
      throw new Error('Photo upload was blocked by Supabase Storage policies. Confirm you are signed in and that the media bucket policies allow authenticated uploads.');
    }
    throw error;
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function readExhibitorLogoOverrides() {
  try { return JSON.parse(getAppStorage().getItem(eventCacheKey(EXHIBITOR_LOGO_CACHE_KEY)) || '{}'); }
  catch { return {}; }
}

function cacheExhibitorLogo(stand, logoUrl) {
  try {
    const overrides = readExhibitorLogoOverrides();
    overrides[normalizeStand(stand)] = logoUrl || '';
    getAppStorage().setItem(eventCacheKey(EXHIBITOR_LOGO_CACHE_KEY), JSON.stringify(overrides));
  } catch { /* local storage may be unavailable */ }
}

function readScannerOverrides() {
  try { return JSON.parse(getAppStorage().getItem(eventCacheKey(EXHIBITOR_SCANNER_CACHE_KEY)) || '{}'); }
  catch { return {}; }
}

function cacheScannerOverride(stand, patch) {
  try {
    const overrides = readScannerOverrides();
    overrides[normalizeStand(stand)] = { ...(overrides[normalizeStand(stand)] || {}), ...patch };
    getAppStorage().setItem(eventCacheKey(EXHIBITOR_SCANNER_CACHE_KEY), JSON.stringify(overrides));
  } catch { /* local storage may be unavailable */ }
}

export function getEventBanner() {
  try { return getAppStorage().getItem(eventCacheKey(EVENT_BANNER_CACHE_KEY)) || ''; }
  catch { return ''; }
}

export function saveEventBanner(bannerUrl) {
  try {
    if (bannerUrl) getAppStorage().setItem(eventCacheKey(EVENT_BANNER_CACHE_KEY), bannerUrl);
    else getAppStorage().removeItem(eventCacheKey(EVENT_BANNER_CACHE_KEY));
  } catch { /* local storage may be unavailable */ }
  return bannerUrl || '';
}

export const STAFF = STAFF_FALLBACK;

export async function getStaff() {
  const supplierLogoOverrides = readSupplierLogoOverrides();
  const withSupplierLogos = rows => (rows || []).map(member => ({
    ...member,
    supplier_logo_url: member.supplier_logo_url || supplierLogoOverrides[String(member.id)] || '',
  }));
  if (supabase) {
    const { data, error } = await supabase
      .from('staff')
      .select('id, name, supplier_name, supplier_logo_url, email, category, departments, role, mobile, photo_url')
      .eq('event_id', getActiveEventId())
      .order('supplier_name');
    if (!error) {
      const overrides = readStaffContactOverrides();
      return withSupplierLogos((data || []).map(member => {
        const departments = normalizeDepartments(member.departments, member.category);
        return { ...member, category: departments[0] || normalizeCategory(member.category), departments, ...(overrides[member.id] || {}) };
      }));
    }

    // Keep the app usable while an existing Supabase project is waiting for the
    // supplier fields or departments migrations.
    let departmentsAvailable = true;
    let legacy = await supabase.from('staff').select('id, name, category, departments, role, mobile, photo_url').eq('event_id', getActiveEventId()).order('name');
    if (legacy.error && departmentsMigrationError(legacy.error)) {
      departmentsAvailable = false;
      legacy = await supabase.from('staff').select('id, name, category, role, mobile, photo_url').eq('event_id', getActiveEventId()).order('name');
    }
    if (legacy.error) {
      throw error;
    }
    const overrides = readStaffContactOverrides();
    return withSupplierLogos((legacy.data || []).map(member => {
      const departments = normalizeDepartments(departmentsAvailable ? member.departments : [], member.category);
      return { ...member, category: departments[0] || normalizeCategory(member.category), departments, ...(!departmentsAvailable && { departmentsMigrationPending: true }), ...(overrides[member.id] || {}), supplier_name: overrides[member.id]?.supplier_name || '', email: overrides[member.id]?.email || '' };
    }));
  }
  const rows = DEMO_MODE ? getDemoCollection('staff', DEMO_STAFF) : STAFF_FALLBACK;
  return withSupplierLogos([...rows].map(member => {
    const departments = normalizeDepartments(member.departments, member.category);
    return { ...member, category: departments[0] || normalizeCategory(member.category), departments };
  }));
}

export async function updateSupplierLogo(memberId, logoUrl) {
  const persistedUrl = isUploadFile(logoUrl)
    ? await uploadPublicImage('supplier-logos', String(memberId), logoUrl)
    : logoUrl;
  cacheSupplierLogo(memberId, persistedUrl);
  if (supabase) {
    const { data, error } = await supabase
      .from('staff')
      .update({ supplier_logo_url: persistedUrl || null })
      .eq('id', memberId)
      .eq('event_id', getActiveEventId())
      .select();
    if (!error) return data || [];
    // Only tolerate a missing supplier_logo_url column (pending migration); surface any other error.
    if (error.message?.includes('supplier_logo_url') || error.message?.includes('Could not find the')) return getStaff();
    throw error;
  }
  const staffRows = DEMO_MODE ? getDemoCollection('staff', DEMO_STAFF) : STAFF_FALLBACK;
  staffRows.forEach(member => {
    if (String(member.id) === String(memberId)) member.supplier_logo_url = persistedUrl || '';
  });
  if (DEMO_MODE) setDemoCollection('staff', staffRows);
  return getStaff();
}

export async function submitRebookingRequest(request) {
  const row = {
    id: `rebook-${Date.now()}`,
    ...(supabase && { event_id:getActiveEventId() }),
    company: request.company.trim(),
    contact_person: request.contact_person.trim(),
    contact_title: request.contact_title?.trim() || '',
    email: request.email.trim(),
    mobile: request.mobile.trim(),
    current_stand: request.current_stand.trim().toUpperCase(),
    interest: request.interest,
    preferred_stand: request.preferred_stand?.trim().toUpperCase() || '',
    stand_size: request.stand_size || '6 sqm',
    booth_type: request.booth_type || 'Shell scheme',
    sponsorship_interest: request.sponsorship_interest || 'No',
    discussion_topics: request.discussion_topics || [],
    notes: request.notes?.trim() || '',
    created_at: new Date().toISOString(),
  };
  if (supabase) {
    const { data, error } = await supabase.rpc('submit_public_rebooking', {
      requested_event_slug:getEventSlug(),
      requested_code:getActiveEventCode(),
      request_payload:row,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }
  if (DEMO_MODE) {
    const rows = getDemoCollection('rebookings', DEMO_REBOOKINGS);
    setDemoCollection('rebookings', [row, ...rows]);
    addDemoNotification('REBOOKING', 'New stand rebooking request', `${row.company} · Current stand ${row.current_stand} · ${row.interest}`, { rebooking_id: row.id });
  }
  return row;
}

export async function getRebookingRequests() {
  if (!supabase) return DEMO_MODE ? getDemoCollection('rebookings', DEMO_REBOOKINGS) : [];
  const { data, error } = await supabase
    .from('rebooking_requests')
    .select('*')
    .eq('event_id', getActiveEventId())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getOpsNotifications() {
  if (!supabase) return DEMO_MODE ? getDemoCollection('notifications', DEMO_NOTIFICATIONS) : [];
  const { data, error } = await supabase
    .from('ops_notifications')
    .select('*')
    .eq('event_id', getActiveEventId())
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

export async function markOpsNotificationRead(id) {
  if (!supabase) {
    if (DEMO_MODE) {
      const notifications = getDemoCollection('notifications', DEMO_NOTIFICATIONS).map(item => item.id === id ? { ...item, read_at: new Date().toISOString() } : item);
      setDemoCollection('notifications', notifications);
    }
    return;
  }
  const { error } = await supabase
    .from('ops_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('event_id', getActiveEventId());
  if (error) throw error;
}

export async function escalatePublicQuery({ queryId, stand, message = '' }) {
  if (!supabase) {
    if (!DEMO_MODE) throw new Error('Client escalation requires the live service to be connected.');
    const normalizedStand = normalizeStand(stand);
    const query = (await getPublicStatus(normalizedStand)).find(item => item.id === queryId && item.status !== 'COMPLETED');
    if (!query) throw new Error('This query could not be escalated. Check the stand and query status.');
    await updateQuery(queryId, { status:'ESCALATED', notes:message.trim() ? `Client escalation: ${message.trim()}` : query.notes });
    addDemoNotification('CLIENT_ESCALATION', 'Client escalated a query', `${query.exhibitor} · Stand ${query.stand} · ${query.category}`, { query_id: query.id });
    return queryId;
  }
  const { data, error } = await supabase.rpc('escalate_public_query', {
    requested_event_slug: getEventSlug(),
    requested_code: getActiveEventCode(),
    requested_query_id: queryId,
    requested_stand: normalizeStand(stand),
    escalation_message: message.trim(),
  });
  if (error) throw error;
  return data;
}

export async function upsertStaffRecords(records) {
  const rows = records.map((record, index) => {
    const departments = normalizeDepartments(record.departments, record.category);
    if (!departments.length) departments.push('Other');
    return {
      id: record.id || `s-import-${Date.now()}-${index}`,
      name: record.name,
      supplier_name: record.supplier_name || record.supplier || record.company || null,
      email: record.email || null,
      category: departments[0] || normalizeCategory(record.category) || 'Other',
      departments,
      mobile: record.mobile || null,
      role: record.role || 'staff',
      ...(supabase && { event_id:getActiveEventId() }),
    };
  });
  if (supabase) {
    const { data, error } = await supabase.from('staff').upsert(rows, { onConflict:'id' }).select();
    if (!error) return data || [];
    const legacyRows = rows.map(({ supplier_name, email, ...legacy }) => legacy);
    const legacy = await supabase.from('staff').upsert(legacyRows, { onConflict:'id' }).select();
    if (legacy.error) throw error;
    const cachedRows = (legacy.data || []).map((member, index) => ({ ...member, supplier_name: rows[index]?.supplier_name || '', email: rows[index]?.email || '' }));
    cachedRows.forEach(cacheStaffContact);
    return cachedRows;
  }
  const staffRows = DEMO_MODE ? getDemoCollection('staff', DEMO_STAFF) : STAFF_FALLBACK;
  rows.forEach(row => { const index = staffRows.findIndex(staff => staff.id === row.id); if (index >= 0) staffRows[index] = row; else staffRows.push(row); });
  if (DEMO_MODE) setDemoCollection('staff', staffRows);
  rows.forEach(cacheStaffContact);
  return rows;
}

export async function getSuppliers() {
  if (supabase) {
    const { data, error } = await supabase.from('suppliers').select('*').eq('event_id', getActiveEventId()).order('name');
    if (error) throw error;
    return data || [];
  }
  return DEMO_MODE ? getDemoCollection('suppliers', DEMO_SUPPLIERS) : [];
}

export async function upsertSuppliers(records) {
  const rows = records.map((record, index) => ({
    id: record.id || `supplier-${Date.now()}-${index}`,
    name: record.name,
    contact: record.contact || null,
    mobile: record.mobile || null,
    email: record.email || null,
    category: record.category || 'Other',
    ...(supabase && { event_id:getActiveEventId() }),
  }));
  if (supabase) {
    const { data, error } = await supabase.from('suppliers').upsert(rows, { onConflict:'id' }).select();
    if (error) throw error;
    return data || [];
  }
  if (DEMO_MODE) {
    const current = getDemoCollection('suppliers', DEMO_SUPPLIERS);
    const merged = [...current];
    rows.forEach(row => {
      const index = merged.findIndex(item => item.id === row.id || item.name === row.name);
      if (index >= 0) merged[index] = { ...merged[index], ...row };
      else merged.push(row);
    });
    setDemoCollection('suppliers', merged);
    return merged;
  }
  return rows;
}

export async function upsertExhibitorRecords(records) {
  const rows = records.map((record, index) => ({
    stand: String(record.stand || record.stand_number || '').trim().toUpperCase(),
    name: String(record.name || record.exhibitor || record.company || '').trim(),
    contact: record.contact || record.contact_name || null,
    phone: record.phone || record.mobile || record.contact_number || null,
    email: record.email || null,
    ...(supabase && { event_id:getActiveEventId() }),
  })).filter(record => record.stand && record.name);
  if (supabase) {
    const { data, error } = await supabase.from('exhibitors').upsert(rows, { onConflict:'event_id,stand' }).select();
    if (error) throw error;
    return data || [];
  }
  const exhibitors = DEMO_MODE ? getDemoCollection('exhibitors', DEMO_EXHIBITORS) : EXHIBITORS;
  rows.forEach(row => {
    const index = exhibitors.findIndex(exhibitor => exhibitor.stand === row.stand);
    if (index >= 0) exhibitors[index] = { ...exhibitors[index], ...row };
    else exhibitors.push(row);
  });
  if (DEMO_MODE) setDemoCollection('exhibitors', exhibitors);
  return rows;
}

export async function addStaff({ name, supplier_name, email, category, departments, mobile, photo }) {
  const normalizedDepartments = normalizeDepartments(departments, category);
  const member = { id: `s-${Date.now()}`, name: name.trim(), supplier_name: supplier_name?.trim() || null, email: email?.trim() || null, category: normalizedDepartments[0] || normalizeCategory(category), departments: normalizedDepartments, mobile: mobile || null, role: 'staff', ...(supabase && { event_id:getActiveEventId() }) };
  if (supabase) {
    const { data, error } = await supabase.from('staff').insert(member).select().single();
    if (!error) {
      cacheStaffContact(data);
      if (photo) return uploadStaffPhoto(data, photo);
      return data;
    }
    if (departmentsMigrationError(error)) throw missingDepartmentsMigrationError();
    const { supplier_name, email, ...legacyMember } = member;
    const legacy = await supabase.from('staff').insert(legacyMember).select().single();
    if (legacy.error) {
      if (departmentsMigrationError(legacy.error)) throw missingDepartmentsMigrationError();
      throw error;
    }
    if (photo) return uploadStaffPhoto({ ...legacy.data, supplier_name, email }, photo);
    const cached = { ...legacy.data, supplier_name, email };
    cacheStaffContact(cached);
    return cached;
  }
  if (DEMO_MODE) setDemoCollection('staff', [...getDemoCollection('staff', DEMO_STAFF), member]);
  else STAFF_FALLBACK.push(member);
  return member;
}

export async function updateStaff(id, patch) {
  const photo = patch.photo;
  const supplierName = patch.supplier_name || '';
  const email = patch.email || '';
  const dbPatch = { ...patch };
  delete dbPatch.photo;
  if (patch.departments) {
    dbPatch.departments = normalizeDepartments(patch.departments, patch.category);
    dbPatch.category = dbPatch.departments[0] || normalizeCategory(patch.category);
  }
  if (supabase) {
    const { data, error } = await supabase.from('staff').update(dbPatch).eq('id', id).eq('event_id', getActiveEventId()).select().single();
    if (!error) {
      cacheStaffContact(data);
      if (photo) return uploadStaffPhoto(data, photo);
      return data;
    }
    if (departmentsMigrationError(error)) throw missingDepartmentsMigrationError();
    delete dbPatch.supplier_name;
    delete dbPatch.email;
    const legacy = await supabase.from('staff').update(dbPatch).eq('id', id).eq('event_id', getActiveEventId()).select().single();
    if (legacy.error) {
      if (departmentsMigrationError(legacy.error)) throw missingDepartmentsMigrationError();
      throw error;
    }
    if (photo) return uploadStaffPhoto({ ...legacy.data, supplier_name: supplierName, email }, photo);
    const cached = { ...legacy.data, supplier_name: supplierName, email };
    cacheStaffContact(cached);
    return cached;
  }
  const staffRows = DEMO_MODE ? getDemoCollection('staff', DEMO_STAFF) : STAFF_FALLBACK;
  const index = staffRows.findIndex(staff => staff.id === id);
  if (index >= 0) staffRows[index] = { ...staffRows[index], ...patch };
  if (DEMO_MODE) setDemoCollection('staff', staffRows);
  return staffRows[index];
}

async function uploadStaffPhoto(member, photo) {
  const path = `${getActiveEventId()}/staff-photos/${member.id}-${Date.now()}-${photo.name}`;
  const { error: uploadError } = await supabase.storage.from('staff-photos').upload(path, photo, { upsert: false, contentType: photo.type || 'application/octet-stream' });
  if (uploadError) {
    if (uploadError.message?.toLowerCase().includes('bucket not found')) {
      // Surface this instead of silently caching the photo in this browser only.
      throw new Error("Photo storage bucket 'staff-photos' is missing. Run supabase/staff-photos-bucket.sql in the Supabase SQL editor, then try again.");
    }
    if (uploadError.message?.toLowerCase().includes('row-level security') || uploadError.statusCode === '403' || uploadError.statusCode === 403) {
      throw new Error('Photo upload was blocked by Supabase Storage policies. Confirm you are signed in and that the three staff photo policies allow authenticated uploads.');
    }
    throw uploadError;
  }
  const { data: publicFile } = supabase.storage.from('staff-photos').getPublicUrl(path);
  const { data, error } = await supabase.from('staff').update({ photo_url: publicFile.publicUrl }).eq('id', member.id).eq('event_id', getActiveEventId()).select().single();
  if (error) throw error;
  cacheStaffContact(data);
  return data;
}

export async function removeStaff(id) {
  if (supabase) {
    const { error } = await supabase.from('staff').delete().eq('id', id).eq('event_id', getActiveEventId());
    if (error) throw error;
    return;
  }
  const staffRows = DEMO_MODE ? getDemoCollection('staff', DEMO_STAFF) : STAFF_FALLBACK;
  const nextStaff = staffRows.filter(staff => staff.id !== id);
  if (DEMO_MODE) setDemoCollection('staff', nextStaff);
  else STAFF_FALLBACK.splice(0, STAFF_FALLBACK.length, ...nextStaff);
}

export const EST_OPTIONS = [
  "15 min", "30 min", "1 hour", "2 hours", "3 hours", "4 hours", "Half day", "Full day",
];

export const STATUS_FLOW = [
  "LOGGED", "ASSIGNED", "PENDING", "IN PROGRESS", "ISSUES/DELAYED", "ESCALATED", "COMPLETED",
];

export const STATUS_COLORS = {
  "LOGGED":         { bg: "#E7F0F7", text: "#315C78", badge: "#5B87A8" },
  "ASSIGNED":       { bg: "#D6EAF8", text: "#1A5276", badge: "#2E86C1" },
  "PENDING":        { bg: "#FDEBD0", text: "#784212", badge: "#E67E22" },
  "IN PROGRESS":    { bg: "#D5F5E3", text: "#1E8449", badge: "#27AE60" },
  "ISSUES/DELAYED": { bg: "#F9EBEA", text: "#922B21", badge: "#E74C3C" },
  "ESCALATED":      { bg: "#FCE4E1", text: "#A33B32", badge: "#D95C52" },
  "COMPLETED":      { bg: "#DDF3EF", text: "#176C67", badge: "#238F8A" },
};

// ── Exhibitor master list (matches APEXOPS™ Excel SOURCE tab) ─────────────────
export const EXHIBITORS = [
  { stand:"A01", name:"Nedbank", contact:"Lorna Louw", phone:"Siphumelele: +27 10 234 3380 / Edith: 083 700 0399 / Lorna: +27 83 325 0283", email:"LornaL@Nedbank.co.za; edith@edithventerpromo.com; SiphumeleleS@Nedbank.co.za" },
  { stand:"A02", name:"Henley Business", contact:"Mamodise Mailula", phone:"0118080860", email:"mamodisem2henleysa.ac.za" },
  { stand:"A03", name:"Compliance Centre", contact:"Caylin Swanepoel", phone:"+27125432971", email:"caylin@rmgirs.com" },
  { stand:"A04", name:"Nerdma Systems", contact:"Thamsanqa Moyo", phone:"083 779 3979", email:"thamsanqa.moyo@nerdma.co.za" },
  { stand:"A05", name:"LAB17", contact:"Lesego Mautloa", phone:"27 73 336 5845", email:"lesego@leapco.co.za" },
  { stand:"A06", name:"MARSH (PTY) LTD", contact:"Nobubele Mkwananzi-Ngwenya", phone:"+27 71 350 7703", email:"Nobubele.Mkwananzi-Ngwenya@marsh.com, Gift.Nke@marsh.com" },
  { stand:"A07", name:"NxGN (Pty) Ltd", contact:"Bonita Field", phone:"082 451 2802", email:"bfield@nxgn.co.za; dkok@nxgn.co.za" },
  { stand:"A08", name:"YES", contact:"Reba Hlabangane", phone:"+27 76 980 6029", email:"Rebaona@yes4youth.co.za; rahiwamashudu@yes4youth.co.za" },
  { stand:"A9/A10", name:"SGS", contact:"Tracy Simone", phone:"Tracy: 27 71 366 7814 / Rifiloe: 066-275-3408", email:"Tracy.Simone@sgs.com; khanyisile.zulu@sgs.com; refiloe.morobane@sgs.com" },
  { stand:"A11", name:"Kenya Airways", contact:"Wycliff Mwangi", phone:"+254740754694", email:"Wycliff.Mwangi@kenya-airways.com" },
  { stand:"A12", name:"Gordon Carbon Solutions", contact:"Prakshna Velter", phone:"27 82 617 8683", email:"prakshna@gordoncarbonsolutions.com; info@gordoncarbonsolutions.com" },
  { stand:"A13", name:"Corporate Traveller", contact:"Kelebetsing Scheppers; Kirsten van Deventer", phone:"067 375 3628 / 079 132 6216", email:"kelebetsing.scheppers@fctg.co.za; kirsten.vandeventer@flightcentre.co.za" },
  { stand:"A14", name:"The Gordon Group", contact:"Prakshna Velter", phone:"27 82 617 8683", email:"prakshna@gordongroup.co.za" },
  { stand:"A15/A16", name:"Dis-Chem Pharmacies", contact:"Zama Pila", phone:"079 498 9921", email:"zama.pila@dischem.co.za; ashwarya.suradin@dischem.co.za" },
  { stand:"A21", name:"Zenith Car Rental (Pty) Ltd T/A Avis", contact:"Tiisetso Ramagoshi", phone:"078 035 8691", email:"tiisetso.ramagoshi@avisbudget.co.za; Mandisa.Mncwango@avisbudget.co.za; mary.thipe@zeda.co.za" },
  { stand:"B01", name:"Sari for Change", contact:"Rayana Edwards", phone:"+2782 568 7757", email:"rayanaedwards@gmail.com" },
  { stand:"B02", name:"LEZA & Co", contact:"Jodi Leza / Thurtell", phone:"+27 76 898 7411", email:"lezaandco@gmail.com" },
  { stand:"B03", name:"TDS Energies (Pty) Ltd", contact:"Oletta Ntshane", phone:"+27 60 554 2025", email:"oletta@techniquedrillingservices.co.za; vusi@techniquedrillingservices.co.za" },
  { stand:"B04", name:"TUV Rheinland", contact:"Gloria Tererai", phone:"060 345 2789", email:"gloria.tererai@za.tuv.com" },
  { stand:"B06", name:"Ukusimama Foundation", contact:"Thobekile Gambu", phone:"079 965 3491", email:"Thobekile@ukusimama.co.za; info@ukusimama.co.za" },
  { stand:"B07", name:"Good Governance Academy / ESG Exchange", contact:"Carolynn Chalmers", phone:"27 83 300 1309", email:"carolynn@candorgovernance.co.za" },
  { stand:"B08", name:"IAIAsa", contact:"Sue George", phone:"27 82 961 5750", email:"operations@iaiasa.co.za" },
  { stand:"B09", name:"Klein Muis", contact:"Aiden Peters", phone:"+27 67 324 6739", email:"aidanjpeters@gmail.com" },
  { stand:"B10", name:"Khumo Morojele", contact:"", phone:"", email:"" },
];

const DEMO_EXHIBITORS = [
  { stand:'D01', name:'Northstar Demo Co', contact:'Avery Sample', phone:'555-0101', email:'avery@example.test' },
  { stand:'D02', name:'Blue Peak Sample Group', contact:'Jordan Example', phone:'555-0102', email:'jordan@example.test' },
  { stand:'D03', name:'Cedar Works Demo', contact:'Casey Example', phone:'555-0103', email:'casey@example.test' },
];

const DEMO_QUERIES = [
  { id:'Q-DEMO-1001', stand:'D01', exhibitor:'Northstar Demo Co', contact:'Avery Sample', phone:'555-0101', category:'Stand Builder', description:'Stand fascia needs adjustment', est:'1 hour', status:'LOGGED', assignedTo:'demo-staff-stand', sourceTab:'CLIENT', loggedAt:new Date(Date.now() - 24 * 60000).toISOString(), updatedAt:new Date(Date.now() - 24 * 60000).toISOString(), completedAt:null, notes:'' },
  { id:'Q-DEMO-1002', stand:'D02', exhibitor:'Blue Peak Sample Group', contact:'Jordan Example', phone:'555-0102', category:'Electrical', description:'Demo power outlet check', est:'30 min', status:'IN PROGRESS', assignedTo:'demo-staff-electrical', sourceTab:'CLIENT', loggedAt:new Date(Date.now() - 42 * 60000).toISOString(), updatedAt:new Date(Date.now() - 18 * 60000).toISOString(), completedAt:null, notes:'' },
  { id:'Q-DEMO-1003', stand:'D03', exhibitor:'Cedar Works Demo', contact:'Casey Example', phone:'555-0103', category:'Graphics & Branding', description:'Demo fascia graphic needs review', est:'1 hour', status:'ESCALATED', assignedTo:null, sourceTab:'CLIENT', loggedAt:new Date(Date.now() - 60 * 60000).toISOString(), updatedAt:new Date(Date.now() - 10 * 60000).toISOString(), completedAt:null, notes:'Demo escalation' },
  { id:'Q-DEMO-1004', stand:'D01', exhibitor:'Northstar Demo Co', contact:'Avery Sample', phone:'555-0101', category:'Organiser', description:'Demo registration badge question', est:'15 min', status:'COMPLETED', assignedTo:'demo-staff-organiser', sourceTab:'CLIENT', loggedAt:new Date(Date.now() - 150 * 60000).toISOString(), updatedAt:new Date(Date.now() - 90 * 60000).toISOString(), completedAt:new Date(Date.now() - 90 * 60000).toISOString(), notes:'' },
];

const DEMO_REBOOKINGS = [
  { id:'demo-rebook-1001', company:'Northstar Demo Co', contact_person:'Avery Sample', contact_title:'Event Lead', email:'avery@example.test', mobile:'555-0101', current_stand:'D01', interest:'Rebook current stand', preferred_stand:'D01', stand_size:'9 sqm', booth_type:'Shell scheme', sponsorship_interest:'No', discussion_topics:['Rebook current stand'], notes:'Demo request only', created_at:new Date(Date.now() - 2 * 60 * 60000).toISOString() },
];

const DEMO_NOTIFICATIONS = [
  { id:'demo-notification-1001', kind:'CLIENT_QUERY', title:'New client query', message:'Northstar Demo Co · Stand D01 · Stand Builder', query_id:'Q-DEMO-1001', created_at:new Date(Date.now() - 24 * 60000).toISOString(), read_at:null },
  { id:'demo-notification-1002', kind:'CLIENT_ESCALATION', title:'Client escalated a query', message:'Cedar Works Demo · Stand D03 · Graphics & Branding', query_id:'Q-DEMO-1003', created_at:new Date(Date.now() - 10 * 60000).toISOString(), read_at:null },
  { id:'demo-notification-1003', kind:'REBOOKING', title:'New stand rebooking request', message:'Northstar Demo Co · Current stand D01 · Rebook current stand', rebooking_id:'demo-rebook-1001', created_at:new Date(Date.now() - 2 * 60 * 60000).toISOString(), read_at:null },
];

function addDemoNotification(kind, title, message, related = {}) {
  const notifications = getDemoCollection('notifications', DEMO_NOTIFICATIONS);
  const notification = {
    id:`demo-notification-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    title,
    message,
    ...related,
    created_at:new Date().toISOString(),
    read_at:null,
  };
  setDemoCollection('notifications', [notification, ...notifications]);
}

function mergeExhibitorRows(rows) {
  if (supabase) return [...(rows || [])];
  const byStand = new Map((rows || []).map(row => [normalizeStand(row.stand), row]));
  return EXHIBITORS.map(master => ({ ...master, ...(byStand.get(normalizeStand(master.stand)) || {}) }))
    .concat((rows || []).filter(row => !EXHIBITORS.some(master => normalizeStand(master.stand) === normalizeStand(row.stand))));
}

export async function getExhibitors() {
  const logoOverrides = readExhibitorLogoOverrides();
  const scannerOverrides = readScannerOverrides();
  const withOverrides = rows => (rows || []).map(row => ({
    ...row,
    logo_url: row.logo_url || logoOverrides[normalizeStand(row.stand)] || '',
    ...(scannerOverrides[normalizeStand(row.stand)] || {}),
  }));
  if (DEMO_MODE) return withOverrides(getDemoCollection('exhibitors', DEMO_EXHIBITORS));
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('exhibitors')
        .select('stand, name, contact, phone, email, logo_url, pack_collected, pack_collected_by, pack_collected_at, scanner_booked_out, scanner_booked_out_at, scanner_due_at, scanner_booked_in, scanner_booked_in_at, scanner_day1_booked_out, scanner_day1_booked_out_at, scanner_day1_booked_in, scanner_day1_booked_in_at, scanner_day2_booked_out, scanner_day2_booked_out_at, scanner_day2_booked_in, scanner_day2_booked_in_at, scanner_staff_name, scanner_staff_contact, scanner_out_staff_name, scanner_out_staff_contact, scanner_in_staff_name, scanner_in_staff_contact')
        .eq('event_id', getActiveEventId())
        .order('stand');
      if (!error) return withOverrides(mergeExhibitorRows(data));
      if (error.message?.includes('logo_url') || error.message?.includes('scanner_') || error.message?.includes('Could not find the')) {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('exhibitors')
          .select('stand, name, contact, phone, email, logo_url')
          .eq('event_id', getActiveEventId())
          .order('stand');
        if (!fallbackError) return withOverrides(mergeExhibitorRows(fallbackData));
      }
    } catch (schemaError) {
      // Gracefully ignore newer schema fields that are not available in the active cache.
    }
    return withOverrides(mergeExhibitorRows([]));
  }
  return withOverrides(mergeExhibitorRows([]));
}

export async function addExhibitor(exhibitor) {
  const { logo_url, logo_file, ...safeExhibitor } = exhibitor || {};
  const persistedLogoUrl = logo_file
    ? await uploadPublicImage('exhibitor-logos', normalizeStand(exhibitor.stand), logo_file)
    : logo_url;
  if (persistedLogoUrl) cacheExhibitorLogo(exhibitor.stand, persistedLogoUrl);
  if (supabase) {
    const scopedExhibitor = eventRow(safeExhibitor);
    try {
      const { data, error } = await supabase.from('exhibitors').insert({ ...scopedExhibitor, logo_url: persistedLogoUrl || null }).select().single();
      if (!error) return data;
      if (error.message?.includes('logo_url') || error.message?.includes('Could not find the')) {
        const { data: fallbackData, error: fallbackError } = await supabase.from('exhibitors').insert(scopedExhibitor).select().single();
        if (!fallbackError) return fallbackData;
      }
      throw error;
    } catch (saveError) {
      if (saveError?.message?.includes('logo_url') || saveError?.message?.includes('Could not find the')) {
        const fallback = { ...safeExhibitor, logo_url: '' };
        EXHIBITORS.push(fallback);
        return fallback;
      }
      throw saveError;
    }
  }
  const row = { ...safeExhibitor, logo_url: persistedLogoUrl || '' };
  const exhibitors = DEMO_MODE ? getDemoCollection('exhibitors', DEMO_EXHIBITORS) : EXHIBITORS;
  exhibitors.push(row);
  if (DEMO_MODE) setDemoCollection('exhibitors', exhibitors);
  return row;
}

export async function updateExhibitor(stand, patch) {
  const { logo_url, logo_file, ...safePatch } = patch || {};
  const persistedLogoUrl = logo_file
    ? await uploadPublicImage('exhibitor-logos', normalizeStand(stand), logo_file)
    : logo_url;
  if (persistedLogoUrl !== undefined) cacheExhibitorLogo(stand, persistedLogoUrl);
  const scannerPatch = Object.fromEntries(Object.entries(safePatch).filter(([key]) => key.startsWith('scanner_')));
  if (Object.keys(scannerPatch).length) cacheScannerOverride(stand, scannerPatch);
  if (supabase) {
    try {
      const { data, error } = await supabase.from('exhibitors').update({ ...safePatch, ...(persistedLogoUrl !== undefined && { logo_url: persistedLogoUrl || null }) }).eq('stand', stand).eq('event_id', getActiveEventId()).select().single();
      if (!error) return data;
      if (error.message?.includes('logo_url') || error.message?.includes('Could not find the')) {
        const { data: fallbackData, error: fallbackError } = await supabase.from('exhibitors').update(safePatch).eq('stand', stand).eq('event_id', getActiveEventId()).select().single();
        if (!fallbackError) return fallbackData;
      }
      throw error;
    } catch (saveError) {
      if (saveError?.message?.includes('logo_url') || saveError?.message?.includes('scanner_') || saveError?.message?.includes('Could not find the')) {
        const index = EXHIBITORS.findIndex(exhibitor => exhibitor.stand === stand);
        if (index >= 0) EXHIBITORS[index] = { ...EXHIBITORS[index], ...safePatch, logo_url: EXHIBITORS[index].logo_url || '' };
        return (await getExhibitors()).find(exhibitor => normalizeStand(exhibitor.stand) === normalizeStand(stand));
      }
      throw saveError;
    }
  }
  const exhibitors = DEMO_MODE ? getDemoCollection('exhibitors', DEMO_EXHIBITORS) : EXHIBITORS;
  const index = exhibitors.findIndex(exhibitor => exhibitor.stand === stand);
  if (index >= 0) exhibitors[index] = { ...exhibitors[index], ...safePatch, ...(persistedLogoUrl !== undefined && { logo_url: persistedLogoUrl || '' }) };
  if (DEMO_MODE) setDemoCollection('exhibitors', exhibitors);
  return exhibitors[index];
}

export async function removeExhibitor(stand) {
  if (supabase) {
    const { error } = await supabase.from('exhibitors').delete().eq('stand', stand).eq('event_id', getActiveEventId());
    if (error) throw error;
    return;
  }
  const exhibitors = DEMO_MODE ? getDemoCollection('exhibitors', DEMO_EXHIBITORS) : EXHIBITORS;
  const remaining = exhibitors.filter(exhibitor => normalizeStand(exhibitor.stand) !== normalizeStand(stand));
  if (DEMO_MODE) setDemoCollection('exhibitors', remaining);
  else EXHIBITORS.splice(0, EXHIBITORS.length, ...remaining);
}

export async function getPublicStatus(stand) {
  const normalizedStand = normalizeStand(stand);
  if (supabase) {
    const { data, error } = await supabase.rpc('get_public_stand_status', { requested_event_slug:getEventSlug(), requested_code:getActiveEventCode(), requested_stand:normalizedStand });
    if (error) throw error;
    return (data || []).map(fromRow);
  }
  return getQueries().then(queries => queries.filter(query => normalizeStand(query.stand) === normalizedStand));
}

export async function getPublicExhibitors() {
  const logoOverrides = readExhibitorLogoOverrides();
  const publicRow = row => ({ stand: row.stand, name: row.name, logo_url: row.logo_url || logoOverrides[normalizeStand(row.stand)] || '' });
  if (DEMO_MODE) return getDemoCollection('exhibitors', DEMO_EXHIBITORS).map(publicRow);
  if (supabase) {
    const { data, error } = await supabase.rpc('get_public_exhibitors', { requested_event_slug:getEventSlug(), requested_code:getActiveEventCode() });
    if (error) throw error;
    return (data || []).map(publicRow);
  }
  return mergeExhibitorRows([]).map(publicRow);
}

export function normalizeStand(value) {
  return String(value || '').trim().toUpperCase().split('/').map(part => part.replace(/^([A-Z])(?=\d$)/, (_, letter) => `${letter}0`)).join('/');
}

const now = new Date();
const ago = (h, m = 0) => new Date(now - h * 3600000 - m * 60000);

let _queries = [];

let _nextNum = 10;

function fromRow(row) {
  return {
    ...row,
    category: normalizeCategory(row.category),
    assignedTo: row.assigned_to,
    loggedAt: row.logged_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    sourceTab: row.source_tab,
    slaDeadline: row.sla_deadline,
  };
}

function toRow(query) {
  return {
    id: query.id,
    event_id: getActiveEventId(),
    stand: query.stand,
    exhibitor: query.exhibitor,
    contact: query.contact,
    phone: query.phone,
    category: query.category,
    description: query.description,
    est: query.est,
    status: query.status,
    assigned_to: query.assignedTo || null,
    logged_at: query.loggedAt,
    completed_at: query.completedAt || null,
    source_tab: query.sourceTab || null,
    sla_deadline: query.slaDeadline || null,
    notes: query.notes || null,
  };
}

export async function getQueries() {
  if (supabase) {
    const { data, error } = await supabase
      .from('queries')
      .select('*')
      .eq('event_id', getActiveEventId())
      .order('logged_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(fromRow).map(query => ({ ...query, slaDeadline: query.slaDeadline || deriveSlaDeadline(query, data || []) }));
  }
  const queries = DEMO_MODE ? getDemoCollection('queries', DEMO_QUERIES) : _queries;
  return recalculateSlaDeadlines(queries.map(query => ({ ...query, category: normalizeCategory(query.category) })));
}

export function deriveSlaDeadline(query, allQueries) {
  const baseQuery = query || {};
  const category = baseQuery.category || 'Other';
  const loggedAt = new Date(baseQuery.loggedAt || Date.now());
  const queue = (allQueries || []).filter(item => String(item.category || 'Other') === String(category) && item.status !== 'COMPLETED' && item.id !== baseQuery.id).sort((a, b) => new Date(a.loggedAt) - new Date(b.loggedAt));
  const backlogMinutes = queue.reduce((sum, item) => sum + estMinutes(item.est || '1 hour'), 0);
  const ownMinutes = estMinutes(baseQuery.est || '1 hour');
  return new Date(loggedAt.getTime() + (backlogMinutes + ownMinutes) * 60000);
}

export function recalculateSlaDeadlines(queries) {
  const active = (queries || []).filter(q => q.status !== 'COMPLETED').sort((a, b) => new Date(a.loggedAt) - new Date(b.loggedAt));
  const perCategory = new Map();
  active.forEach(query => {
    const current = perCategory.get(query.category) || [];
    current.push(query);
    perCategory.set(query.category, current);
  });

  const updated = (queries || []).map(query => {
    if (query.status === 'COMPLETED') return query;
    const sameCategory = perCategory.get(query.category) || [];
    const queueIndex = sameCategory.findIndex(item => item.id === query.id);
    const queuedBefore = sameCategory.slice(0, queueIndex).reduce((sum, item) => sum + estMinutes(item.est || '1 hour'), 0);
    const qMinutes = estMinutes(query.est || '1 hour');
    const nextDeadline = new Date(new Date(query.loggedAt).getTime() + (queuedBefore + qMinutes) * 60000);
    return { ...query, slaDeadline: nextDeadline };
  });

  return updated;
}

export async function addQuery(q) {
  const normalizedQuery = {
    ...q,
    stand: normalizeStand(q.stand),
    category: normalizeCategory(q.category),
  };
  const existingQueries = supabase ? await getQueries() : await getPublicStatus(normalizedQuery.stand);
  const duplicate = findDuplicateQuery(existingQueries, normalizedQuery);
  if (duplicate) throw duplicateQueryError(duplicate);

  const id = `Q-${Date.now()}`;
  const loggedAt = new Date();
  const baseQuery = {
    ...normalizedQuery,
    id,
    loggedAt,
    status: "LOGGED",
    assignedTo: null,
    sourceTab: q.sourceTab || q.category,
    queuePos: (DEMO_MODE ? getDemoCollection('queries', DEMO_QUERIES) : _queries).filter(x => x.status !== "COMPLETED").length + 1,
  };
  const existingRows = DEMO_MODE ? getDemoCollection('queries', DEMO_QUERIES) : _queries;
  const queue = recalculateSlaDeadlines([...existingRows, { ...baseQuery, est: q.est || '1 hour' }]);
  const entry = { ...baseQuery, slaDeadline: queue.find(item => item.id === id)?.slaDeadline || new Date(loggedAt.getTime() + estMinutes(q.est || '1 hour') * 60000) };
  if (supabase) {
    const { error } = await supabase.from('queries').insert(toRow(entry));
    if (error) throw error;
    return entry;
  }
  if (DEMO_MODE) {
    setDemoCollection('queries', [entry, ...getDemoCollection('queries', DEMO_QUERIES)]);
    if (entry.sourceTab === 'CLIENT') addDemoNotification('CLIENT_QUERY', 'New client query', `${entry.exhibitor} · Stand ${entry.stand} · ${entry.category}`, { query_id:entry.id });
  } else {
    _queries = [entry, ..._queries];
  }
  return entry;
}

export async function submitClientQuery(query) {
  const stand = normalizeStand(query.stand);

  try {
    let saved;
    if (supabase) {
      const { data, error } = await supabase.rpc('submit_public_query', {
        requested_event_slug:getEventSlug(),
        requested_code:getActiveEventCode(),
        query_payload:{ ...query, stand, sourceTab:'CLIENT' },
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      saved = fromRow(row);
    } else {
      saved = await addQuery({ ...query, stand, sourceTab:'CLIENT' });
    }
    return { query: saved, duplicate: false };
  } catch (error) {
    if (error.duplicateQuery) return { query: error.duplicateQuery, duplicate: true };
    if (!/already been submitted/i.test(readableError(error, ''))) throw error;
    const latest = await getPublicStatus(stand);
    const alreadySubmitted = findDuplicateQuery(latest, { ...query, stand });
    if (!alreadySubmitted) throw error;
    return { query: alreadySubmitted, duplicate: true };
  }
}

function findDuplicateQuery(items, query) {
  const normalizedStand = normalizeStand(query.stand);
  const normalizedExhibitor = normalizeIdentity(query.exhibitor);
  const normalizedCategory = normalizeCategory(query.category);
  const normalizedDescription = normalizeIssueDescription(query.description);
  return (items || []).find(item => normalizeStand(item.stand) === normalizedStand
    && normalizeIdentity(item.exhibitor) === normalizedExhibitor
    && normalizeCategory(item.category) === normalizedCategory
    && normalizeIssueDescription(item.description) === normalizedDescription);
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function duplicateQueryError(query) {
  const error = new Error(`This issue is already logged as ${query.id}. No duplicate query was created.`);
  error.code = 'DUPLICATE_QUERY';
  error.duplicateQuery = query;
  return error;
}

function normalizeIssueDescription(value) {
  return [...new Set(String(value || '')
    .split(';')
    .map(issue => issue.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean))]
    .sort()
    .join(';');
}

export async function updateQuery(id, patch) {
  const nextPatch = { ...patch };
  if (supabase) {
    const current = await getQueries();
    const existing = current.find(q => q.id === id);
    if (existing) {
      const merged = { ...existing, ...nextPatch };
      const recalculated = recalculateSlaDeadlines(current.map(q => q.id === id ? { ...q, ...nextPatch } : q));
      const updated = recalculated.find(q => q.id === id) || merged;
      const slaDeadline = updated.slaDeadline ? new Date(updated.slaDeadline) : null;
      const dbPatch = {
        ...(nextPatch.assignedTo !== undefined && { assigned_to: nextPatch.assignedTo || null }),
        ...(nextPatch.status !== undefined && { status: nextPatch.status }),
        ...(nextPatch.notes !== undefined && { notes: nextPatch.notes || null }),
        ...(nextPatch.completedAt !== undefined && { completed_at: nextPatch.completedAt || null }),
        ...(slaDeadline && !Number.isNaN(slaDeadline.getTime()) && { sla_deadline: slaDeadline.toISOString() }),
      };
      const { data, error } = await supabase
        .from('queries')
        .update(dbPatch)
        .eq('id', id)
        .eq('event_id', getActiveEventId())
        .select()
        .single();
      if (error) throw error;
      return fromRow(data);
    }
  }
  const queries = DEMO_MODE ? getDemoCollection('queries', DEMO_QUERIES) : _queries;
  const updatedQueries = recalculateSlaDeadlines(queries.map(q => q.id === id ? { ...q, ...nextPatch } : q));
  if (DEMO_MODE) setDemoCollection('queries', updatedQueries);
  else _queries = updatedQueries;
  return updatedQueries.find(q => q.id === id);
}

export function getQueuePosition(id, category) {
  const queries = DEMO_MODE ? getDemoCollection('queries', DEMO_QUERIES) : _queries;
  const active = queries
    .filter(q => q.category === category && q.status !== "COMPLETED")
    .sort((a, b) => new Date(a.loggedAt) - new Date(b.loggedAt));
  const pos = active.findIndex(q => q.id === id);
  return pos === -1 ? null : pos + 1;
}

export function estMinutes(est) {
  const map = {
    "15 min": 15, "30 min": 30, "1 hour": 60, "2 hours": 120,
    "3 hours": 180, "4 hours": 240, "Half day": 240, "Full day": 480,
  };
  return map[est] || 60;
}
