// ─── Exhibitor services: stock list, packages, orders, deliveries, portal ─────
// Talks to the tables / functions in supabase/migrations/20261118_exhibitor_services.sql.
// In DEMO_MODE everything is kept in this browser tab (sessionStorage) so the
// screens can be tried without touching Supabase.
import Papa from 'papaparse';
import { supabase } from './supabase';
import { DEMO_MODE } from './demoStore';
import { getActiveEvent, getActiveEventCode, getActiveEventId, getEventSlug } from './eventScope';
import { getExhibitors, normalizeStand } from './mock';
import { readWorkbookRows } from './workbook';

// ── Pricing (the 3% is internal; exhibitors only ever see `exhibitorPrice`) ──
export const DEFAULT_SETTINGS = {
  supplier_vat_registered: false, prices_exclude_vat: false, vat_rate: 0.15, platform_fee_rate: 0.03,
  orders_open_at: null, orders_close_at: null, supplier_name: '',
  order_terms: 'Orders cannot be cancelled or refunded once confirmed.',
  logo_terms: 'Logos are only printed on fascia boards when included in your package or paid for.',
};

export function priceBreakdown(priceExclVat, settings = DEFAULT_SETTINGS) {
  const base = Number(priceExclVat) || 0;
  const vatRegistered = settings.supplier_vat_registered ?? settings.prices_exclude_vat ?? false;
  const vatRate = vatRegistered ? Number(settings.vat_rate ?? 0.15) : 0;
  const vat = base * vatRate;
  const inclVat = base + vat;
  const fee = inclVat * 0.03;
  return { base, vat, inclVat, fee, exhibitorPrice: Math.round(inclVat + fee) };
}

export const rand = value => `R ${Math.round(Number(value) || 0).toLocaleString('en-ZA').replace(/,/g, ' ')}`;
export const rand2 = value => `R ${(Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ')}`;

// ── Event access window: 3 months before → 1 month after, then archived ─────
function addMonths(date, months) { const d = new Date(date); d.setMonth(d.getMonth() + months); return d; }
export function eventAccessWindow(event, settings = {}) {
  if (!event?.event_start_date) return { opensAt: null, closesAt: null, state: 'unknown' };
  const start = new Date(`${event.event_start_date}T00:00:00`);
  const end = new Date(`${event.event_end_date || event.event_start_date}T23:59:59`);
  const opensAt = settings.orders_open_at ? new Date(settings.orders_open_at) : addMonths(start, -3);
  const closesAt = settings.orders_close_at ? new Date(settings.orders_close_at) : addMonths(end, 1);
  const now = new Date();
  const state = now < opensAt ? 'upcoming' : now > closesAt ? 'archived' : 'open';
  return { opensAt, closesAt, state };
}
export const formatDay = d => (d ? new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const formatDayTime = d => (d ? new Date(d).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

// ── Import templates (column order matters, so we ship the template) ─────────
export const STOCK_TEMPLATE_COLUMNS = ['Category', 'Item code', 'Item', 'Options (separate with |)', 'Size / notes', 'Price excl VAT', 'Stock quantity', 'Photo file name'];
export const STOCK_TEMPLATE_EXAMPLE = ['Furniture', 'H133', 'Stella Chair', 'White | Black', 'H 80cm', 472, 120, 'H133.jpg'];
export const PACKAGE_TEMPLATE_COLUMNS = ['Package code', 'Package name', 'Size (m²)', 'Description', 'Features (separate with |)', 'Items (e.g. 2x Chair; 1x Table; 1x Plug point)'];
export const PACKAGE_TEMPLATE_EXAMPLE = ['SHELL9', 'Shell scheme 9m²', 9, '3 × 3 m shell scheme', 'Fascia name board | Logo printed on fascia | Carpet | Spotlights | Plug point', '2x Stella Chair; 1x Table on Milan Base; 1x Plug point; 3x Spotlight'];

export async function readServiceImportRows(file) {
  if (!/\.csv$/i.test(file.name)) return readWorkbookRows(await file.arrayBuffer());
  const result = Papa.parse(await file.text(), { header: true, skipEmptyLines: 'greedy', transformHeader: header => header.trim() });
  if (result.errors.length) throw new Error(`Could not read the CSV file: ${result.errors[0].message}`);
  return result.data;
}

// ── Standard package features (tick boxes) ───────────────────────────────────
// Organisers tick what a package includes. "fascia_logo" decides whether the
// exhibitor's logo is printed. Organisers can also add their own tick options.
export const STANDARD_FEATURES = [
  { key: 'fascia_name', label: 'Fascia name board' },
  { key: 'fascia_logo', label: 'Logo printed on fascia' },
  { key: 'carpet', label: 'Carpet' },
  { key: 'lighting', label: 'Spotlights' },
  { key: 'power', label: 'Plug point (15A)' },
  { key: 'fabric_wall', label: 'Fabric banner wall' },
  { key: 'vinyl', label: 'Vinyl graphics on walls' },
  { key: 'storage', label: 'Lockable storage cupboard' },
  { key: 'counter_branding', label: 'Branded counter front' },
  { key: 'cleaning', label: 'Daily stand cleaning' },
];
const featureKey = label => { const std = STANDARD_FEATURES.find(f => f.label.toLowerCase() === String(label).trim().toLowerCase()); return std ? std.key : `custom_${key(label)}`; };
export const featureFromLabel = label => ({ key: featureKey(label), label: String(label).trim() });
export const hasLogo = pkg => Boolean(pkg?.includes_fascia_logo || (pkg?.features || []).some(f => f.key === 'fascia_logo'));

// ── Standard shell scheme packages (one click to create, then edit) ─────────
export const SHELL_SIZES = [6, 9, 12, 18, 24, 32];
export function standardShellPackage(sqm, sortOrder = 0) {
  const chairs = Math.max(2, Math.ceil(sqm / 4.5));
  const tables = sqm <= 12 ? 1 : sqm <= 24 ? 2 : 3;
  const lights = Math.max(2, Math.ceil(sqm / 3));
  const plugs = sqm <= 12 ? 1 : sqm <= 24 ? 2 : 3;
  const items = [
    { qty: chairs, label: 'Chair' },
    { qty: tables, label: 'Table' },
    { qty: 1, label: 'Info counter' },
    { qty: 1, label: 'Waste bin' },
    ...(sqm >= 12 ? [{ qty: 1, label: 'Brochure stand' }] : []),
    { qty: lights, label: 'Spotlight' },
    { qty: plugs, label: 'Plug point' },
  ];
  const features = STANDARD_FEATURES.filter(f => ['fascia_name', 'carpet', 'lighting', 'power'].includes(f.key));
  return { code: `SHELL${sqm}`, name: `Shell scheme ${sqm}m²`, size_sqm: sqm, description: `Standard shell scheme, ${sqm}m²`, includes_fascia_logo: false, features, items, sort_order: sortOrder };
}

const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function pick(row, ...names) {
  const map = Object.fromEntries(Object.entries(row).map(([k, v]) => [key(k), v]));
  for (const n of names) { const v = map[key(n)]; if (v !== undefined && String(v).trim() !== '') return String(v).trim(); }
  return '';
}
export function parseStockRows(rows) {
  return rows.map((row, i) => ({
    category: pick(row, 'Category') || 'Furniture',
    code: pick(row, 'Item code', 'Code'),
    name: pick(row, 'Item', 'Name', 'Description'),
    options: pick(row, 'Options (separate with |)', 'Options').split(/\s*[|;]\s*/).filter(Boolean),
    size: pick(row, 'Size / notes', 'Size'),
    price_excl_vat: Number(String(pick(row, 'Price excl VAT', 'Price')).replace(/[^0-9.]/g, '')) || 0,
    stock_qty: pick(row, 'Stock quantity', 'Stock') ? Number(pick(row, 'Stock quantity', 'Stock')) : null,
    photo_file: pick(row, 'Photo file name', 'Photo'),
    sort_order: i,
  })).filter(item => item.code && item.name);
}
export function parsePackageItems(text) {
  return String(text || '').split(/\s*[;\n]\s*/).filter(Boolean).map(part => {
    const m = part.match(/^(\d+)\s*[x×]\s*(.+)$/i);
    return m ? { qty: Number(m[1]), label: m[2].trim() } : { qty: 1, label: part.trim() };
  });
}
export function parsePackageRows(rows) {
  return rows.map((row, i) => ({
    code: pick(row, 'Package code', 'Code').toUpperCase(),
    name: pick(row, 'Package name', 'Name'),
    size_sqm: Number(pick(row, 'Size (m²)', 'Size m2', 'Size')) || null,
    features: pick(row, 'Features (separate with |)', 'Features').split(/\s*[|;]\s*/).filter(Boolean).map(featureFromLabel),
    description: pick(row, 'Description'),
    includes_fascia_logo: /^(y|yes|true|1)$/i.test(pick(row, 'Logo on fascia included (Yes/No)', 'Logo included', 'Logo')),
    items: parsePackageItems(pick(row, 'Items (e.g. 2x Chair; 1x Table; 1x Plug point)', 'Items')),
    sort_order: i,
  })).filter(p => p.code && p.name);
}

// ── Demo store ───────────────────────────────────────────────────────────────
const DEMO_KEY = 'apexops-services-demo-v1';
const PHOTO = code => `${process.env.PUBLIC_URL || ''}/demo-furniture/${code}.jpg`;
const DEMO_SEED = {
  settings: {},
  catalogue: [
    ['H01', 'Carlton Office Chair', ['Black'], '', 285], ['H133', 'Stella Chair', ['White'], '', 472],
    ['H33', 'Gelati Barstool', ['Brown & White', 'Red & White'], '', 771], ['H94', 'Cube Ottoman', ['White', 'Red', 'Black'], '', 506],
    ['H42', 'Table on Milan Base', ['Square', 'Round'], 'H710 × D900mm', 462], ['H34', 'Chrome Cocktail Table', [], 'H750 × D900mm', 898],
    ['H68', 'Zig-Zag Brochure Holder', ['Black metal'], '', 708], ['H88', 'Newline Showcase Large', [], 'Lockable · H1980mm', 2831],
    ['H83b', 'Small Refrigerator', [], '150 litres', 2366], ['H86', 'Glass Top Counter', [], 'Lockable · H900mm', 1212],
  ].map(([code, name, options, size, price], i) => ({ id: `demo-cat-${code}`, category: 'Furniture', code, name, options, size, price_excl_vat: price, stock_qty: 40, photo_url: PHOTO(code), active: true, sort_order: i })),
  packages: [
    { id: 'demo-pkg-shell9', code: 'SHELL9', name: 'Shell scheme 9m²', size_sqm: 9, description: '3 × 3 m shell scheme', includes_fascia_logo: false, features: STANDARD_FEATURES.filter(f => ['fascia_name', 'carpet', 'lighting', 'power'].includes(f.key)), items: [{ qty: 2, label: 'Stella Chair' }, { qty: 1, label: 'Table on Milan Base' }, { qty: 1, label: 'Plug point' }, { qty: 3, label: 'Spotlight' }], sort_order: 0 },
    { id: 'demo-pkg-prem18', code: 'PREM18', name: 'Premium 18m²', size_sqm: 18, description: 'Premium shell with branded walls', includes_fascia_logo: true, features: STANDARD_FEATURES.filter(f => ['fascia_name', 'fascia_logo', 'carpet', 'lighting', 'power', 'fabric_wall', 'storage'].includes(f.key)), items: [{ qty: 4, label: 'Stella Chair' }, { qty: 1, label: 'Glass Top Counter' }, { qty: 1, label: 'Small Refrigerator' }, { qty: 2, label: 'Plug point' }, { qty: 6, label: 'Spotlight' }], sort_order: 1 },
  ],
  profiles: {},
  files: [],
  orders: [],
};
function demoRead() {
  try { return { ...DEMO_SEED, ...JSON.parse(window.sessionStorage.getItem(DEMO_KEY) || '{}') }; } catch { return { ...DEMO_SEED }; }
}
function demoWrite(state) { try { window.sessionStorage.setItem(DEMO_KEY, JSON.stringify(state)); } catch { /* ignore */ } }
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

function need(result, fallback = 'Something went wrong. Please try again.') {
  if (result.error) {
    if (/relation .* does not exist|Could not find the function|schema cache/i.test(result.error.message || '')) {
      throw new Error('Exhibitor services are not switched on yet. Run supabase/migrations/20261118_exhibitor_services.sql (after review).');
    }
    throw new Error(result.error.message || fallback);
  }
  return result.data;
}

// ── Settings ─────────────────────────────────────────────────────────────────
export async function getOrderSettings() {
  if (DEMO_MODE) return { ...DEFAULT_SETTINGS, ...demoRead().settings };
  const data = need(await supabase.from('event_order_settings').select('*').eq('event_id', getActiveEventId()).maybeSingle());
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}
export async function saveOrderSettings(patch) {
  if (DEMO_MODE) { const s = demoRead(); s.settings = { ...s.settings, ...patch }; demoWrite(s); return; }
  need(await supabase.from('event_order_settings').upsert({ event_id: getActiveEventId(), ...patch, updated_at: new Date().toISOString() }));
}

// ── Stock list ───────────────────────────────────────────────────────────────
export async function getCatalogue() {
  if (DEMO_MODE) return [...demoRead().catalogue].sort((a, b) => a.sort_order - b.sort_order);
  return need(await supabase.from('catalogue_items').select('*').eq('event_id', getActiveEventId()).order('sort_order').order('name')) || [];
}
export async function saveCatalogueItem(item) {
  const clean = { category: item.category || 'Furniture', code: String(item.code).trim(), name: String(item.name).trim(), options: item.options || [], size: item.size || null, price_excl_vat: Number(item.price_excl_vat) || 0, stock_qty: item.stock_qty === '' || item.stock_qty == null ? null : Number(item.stock_qty), photo_url: item.photo_url || null, active: item.active !== false, sort_order: item.sort_order ?? 0 };
  if (!clean.code || !clean.name) throw new Error('Item code and name are required.');
  if (DEMO_MODE) {
    const s = demoRead(); const i = s.catalogue.findIndex(c => c.id === item.id || c.code === clean.code);
    if (i >= 0) s.catalogue[i] = { ...s.catalogue[i], ...clean }; else s.catalogue.push({ id: uid(), ...clean, sort_order: s.catalogue.length });
    demoWrite(s); return;
  }
  need(await supabase.from('catalogue_items').upsert({ ...(item.id ? { id: item.id } : {}), event_id: getActiveEventId(), ...clean }, { onConflict: 'event_id,code' }));
}
export async function importCatalogue(items) {
  if (DEMO_MODE) { for (const item of items) await saveCatalogueItem(item); return items.length; }
  const rows = items.map(({ photo_file, ...item }) => ({ event_id: getActiveEventId(), ...item }));
  for (let i = 0; i < rows.length; i += 200) need(await supabase.from('catalogue_items').upsert(rows.slice(i, i + 200), { onConflict: 'event_id,code' }));
  return rows.length;
}
export async function removeCatalogueItem(id) {
  if (DEMO_MODE) { const s = demoRead(); s.catalogue = s.catalogue.filter(c => c.id !== id); demoWrite(s); return; }
  need(await supabase.from('catalogue_items').delete().eq('id', id));
}
export async function uploadCataloguePhoto(code, file) {
  if (file.size > 3 * 1024 * 1024) throw new Error('Please choose a photo smaller than 3 MB.');
  if (DEMO_MODE || !supabase) return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
  const path = `${getActiveEventId()}/${String(code).replace(/[^a-zA-Z0-9_-]/g, '')}-${Date.now()}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`;
  need(await supabase.storage.from('catalogue-photos').upload(path, file, { contentType: file.type || 'image/jpeg' }));
  return supabase.storage.from('catalogue-photos').getPublicUrl(path).data.publicUrl;
}

// ── Packages ─────────────────────────────────────────────────────────────────
export async function getPackages() {
  if (DEMO_MODE) return [...demoRead().packages].sort((a, b) => a.sort_order - b.sort_order);
  return need(await supabase.from('event_packages').select('*').eq('event_id', getActiveEventId()).order('sort_order')) || [];
}
export async function savePackage(pkg) {
  const features = (pkg.features || []).filter(f => f && f.label);
  const items = (pkg.items || []).map(it => ({ qty: Math.max(1, Number(it.qty) || 1), label: String(it.label || '').trim(), ...(it.code ? { code: it.code } : {}) })).filter(it => it.label);
  const clean = { code: String(pkg.code || '').trim().toUpperCase(), name: String(pkg.name || '').trim(), size_sqm: pkg.size_sqm ? Number(pkg.size_sqm) : null, description: pkg.description || null, features, includes_fascia_logo: features.some(f => f.key === 'fascia_logo'), items, sort_order: pkg.sort_order ?? 0 };
  if (!clean.code || !clean.name) throw new Error('Package code and name are required.');
  if (DEMO_MODE) {
    const s = demoRead(); const i = s.packages.findIndex(p => p.id === pkg.id || p.code === clean.code);
    if (i >= 0) s.packages[i] = { ...s.packages[i], ...clean }; else s.packages.push({ id: uid(), ...clean, sort_order: s.packages.length });
    demoWrite(s); return;
  }
  need(await supabase.from('event_packages').upsert({ ...(pkg.id ? { id: pkg.id } : {}), event_id: getActiveEventId(), ...clean }, { onConflict: 'event_id,code' }));
}
export async function importPackages(list) { for (const p of list) await savePackage(p); return list.length; }
export async function createStandardPackages(existing = []) {
  const have = new Set(existing.map(p => p.code));
  const todo = SHELL_SIZES.map((sqm, i) => standardShellPackage(sqm, existing.length + i)).filter(p => !have.has(p.code));
  for (const p of todo) await savePackage(p);
  return todo.length;
}
export async function removePackage(id) {
  if (DEMO_MODE) { const s = demoRead(); s.packages = s.packages.filter(p => p.id !== id); demoWrite(s); return; }
  need(await supabase.from('event_packages').delete().eq('id', id));
}

// ── Exhibitor profiles (package, fascia, private link) ──────────────────────
export async function getExhibitorProfiles() {
  const exhibitors = await getExhibitors();
  let profiles = [];
  if (DEMO_MODE) {
    const s = demoRead(); let changed = false;
    exhibitors.forEach(ex => { const st = normalizeStand(ex.stand); if (!s.profiles[st]) { s.profiles[st] = { stand: st, package_code: '', fascia_name: '', fascia_status: 'pending', logo_paid: false, portal_token: uid() }; changed = true; } });
    if (changed) demoWrite(s);
    profiles = Object.values(s.profiles);
  } else {
    profiles = need(await supabase.from('exhibitor_profiles').select('*').eq('event_id', getActiveEventId())) || [];
  }
  const byStand = new Map(profiles.map(p => [normalizeStand(p.stand), p]));
  const files = await getExhibitorFiles();
  return exhibitors.map(ex => {
    const p = byStand.get(normalizeStand(ex.stand)) || { stand: normalizeStand(ex.stand), fascia_status: 'pending' };
    return { ...ex, ...p, name: ex.name, stand: ex.stand, files: files.filter(f => normalizeStand(f.stand) === normalizeStand(ex.stand)) };
  });
}
export async function saveExhibitorProfile(stand, patch) {
  const st = normalizeStand(stand);
  if (DEMO_MODE) { const s = demoRead(); s.profiles[st] = { ...(s.profiles[st] || { stand: st, portal_token: uid() }), ...patch }; demoWrite(s); return; }
  need(await supabase.from('exhibitor_profiles').upsert({ event_id: getActiveEventId(), stand: st, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'event_id,stand' }));
}
export async function getExhibitorFiles() {
  if (DEMO_MODE) return demoRead().files;
  return need(await supabase.from('exhibitor_files').select('*').eq('event_id', getActiveEventId()).order('uploaded_at', { ascending: false })) || [];
}
export async function getExhibitorFileUrl(file) {
  if (DEMO_MODE) return file.data_url || '';
  const { data } = await supabase.storage.from('exhibitor-files').createSignedUrl(file.storage_path, 600);
  return data?.signedUrl || '';
}
export function portalLink(token) {
  return `${window.location.origin}${window.location.pathname}?portal=${token}`;
}

// ── Orders (team) ────────────────────────────────────────────────────────────
export async function getOrders() {
  if (DEMO_MODE) return [...demoRead().orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return need(await supabase.from('service_orders').select('*, items:service_order_items(*)').eq('event_id', getActiveEventId()).order('created_at', { ascending: false })) || [];
}
export async function updateOrder(id, patch) {
  if (DEMO_MODE) { const s = demoRead(); s.orders = s.orders.map(o => (o.id === id ? { ...o, ...patch, updated_at: new Date().toISOString() } : o)); demoWrite(s); return; }
  need(await supabase.from('service_orders').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
}
export async function updateOrderItem(orderId, itemId, patch) {
  if (DEMO_MODE) { const s = demoRead(); s.orders = s.orders.map(o => (o.id === orderId ? { ...o, items: o.items.map(it => (it.id === itemId ? { ...it, ...patch } : it)) } : o)); demoWrite(s); return; }
  need(await supabase.from('service_order_items').update(patch).eq('id', itemId));
}

// ── Public (exhibitor) side ──────────────────────────────────────────────────
function publicArgs() {
  return { requested_event_slug: getEventSlug(), requested_code: getActiveEventCode() };
}
export async function getPublicCatalogue() {
  if (DEMO_MODE) {
    const settings = await getOrderSettings();
    const event = getActiveEvent();
    const win = eventAccessWindow(event, settings);
    return { open: true, demoWindowState: win.state, window: win, order_terms: settings.order_terms, items: (await getCatalogue()).filter(c => c.active).map(c => ({ ...c, price: priceBreakdown(c.price_excl_vat, settings).exhibitorPrice })) };
  }
  const data = need(await supabase.rpc('get_public_order_catalogue', publicArgs()));
  return { ...data, window: eventAccessWindow(getActiveEvent()) };
}
export async function submitPublicOrder(payload) {
  if (DEMO_MODE) {
    const s = demoRead(); const settings = { ...DEFAULT_SETTINGS, ...s.settings };
    if (!payload.accept_terms) throw new Error('Please accept the order terms.');
    const ex = (await getExhibitors()).find(e => normalizeStand(e.stand) === normalizeStand(payload.stand));
    if (!ex) throw new Error('Stand not found for this event.');
    const items = payload.items.map(line => {
      const c = s.catalogue.find(x => x.id === line.id); const b = priceBreakdown(c.price_excl_vat, settings);
      return { id: uid(), code: c.code, name: c.name, option: line.option || null, qty: line.qty, unit_price_excl_vat: c.price_excl_vat, unit_payable: b.exhibitorPrice, photo_url: c.photo_url, picked: false, loaded: false, delivered: false };
    });
    const exVat = items.reduce((t, i) => t + i.unit_price_excl_vat * i.qty, 0);
    const pay = items.reduce((t, i) => t + i.unit_payable * i.qty, 0);
    const vatRegistered = settings.supplier_vat_registered ?? settings.prices_exclude_vat ?? false;
    const vat = vatRegistered ? exVat * settings.vat_rate : 0;
    const fee = (exVat + vat) * 0.03;
    const order = { id: uid(), ref: `FO-${String(s.orders.length + 1).padStart(5, '0')}`, stand: normalizeStand(payload.stand), exhibitor_name: ex.name, contact_name: payload.contact_name, contact_email: payload.contact_email, contact_phone: payload.contact_phone, delivery_at: payload.delivery_at || null, notes: payload.notes || '', status: 'submitted', items, total_excl_vat: exVat, total_vat: vat, total_fee: Number(fee.toFixed(2)), total_payable: pay, edit_token: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    s.orders.push(order); demoWrite(s);
    return { ref: order.ref, edit_token: order.edit_token, total_payable: pay, exhibitor_name: ex.name };
  }
  return need(await supabase.rpc('submit_public_order', { ...publicArgs(), payload }));
}
export async function getExhibitorPortal(token) {
  if (DEMO_MODE) {
    const s = demoRead(); const p = Object.values(s.profiles).find(x => x.portal_token === token);
    if (!p) throw new Error('This link is not valid.');
    const event = getActiveEvent() || { name: 'Demo event' };
    const pkg = s.packages.find(x => x.code === p.package_code);
    const ex = (await getExhibitors()).find(e => normalizeStand(e.stand) === normalizeStand(p.stand));
    const settings = { ...DEFAULT_SETTINGS, ...s.settings };
    return { open: true, event: { name: event.name, start: event.event_start_date, end: event.event_end_date }, stand: p.stand, exhibitor_name: ex?.name, package: pkg || null, logo_included: Boolean(pkg?.includes_fascia_logo || p.logo_paid), logo_terms: settings.logo_terms, fascia_name: p.fascia_name, fascia_status: p.fascia_status, files: s.files.filter(f => normalizeStand(f.stand) === normalizeStand(p.stand)), orders: s.orders.filter(o => o.stand === normalizeStand(p.stand)) };
  }
  return need(await supabase.rpc('get_exhibitor_portal', { requested_token: token }));
}
export async function getExhibitorInvoices(token) {
  if (DEMO_MODE) return [];
  return need(await supabase.rpc('get_exhibitor_portal_invoices', { requested_portal_token: token })) || [];
}
export async function submitExhibitorEftProof(token, invoiceId, reference, file) {
  if (DEMO_MODE) throw new Error('EFT payments are unavailable in demo mode.');
  if (!file || file.size > 10 * 1024 * 1024) throw new Error('Choose a PDF, JPG or PNG no larger than 10 MB.');
  if (!['application/pdf','image/jpeg','image/png'].includes(file.type)) throw new Error('Choose a PDF, JPG or PNG.');
  const extension=file.type==='application/pdf'?'pdf':file.type==='image/jpeg'?'jpg':'png';
  const proofId=crypto.randomUUID();
  const path=`${token}/${invoiceId}/${proofId}.${extension}`;
  need(await supabase.storage.from('exhibitor-payment-proofs').upload(path,file,{contentType:file.type,upsert:false}));
  try {
    return need(await supabase.rpc('submit_exhibitor_eft_proof',{
      target_invoice_id:invoiceId,
      requested_portal_token:token,
      requested_path:path,
      requested_reference:reference,
    }));
  } catch (error) {
    await supabase.storage.from('exhibitor-payment-proofs').remove([path]);
    throw error;
  }
}
export async function startExhibitorPayfastCheckout(token, invoiceId) {
  if (DEMO_MODE) throw new Error('Online payments are unavailable in demo mode.');
  const {data,error}=await supabase.functions.invoke('create-exhibitor-payfast-checkout',{
    body:{invoiceId,portalToken:token,idempotencyKey:crypto.randomUUID()},
  });
  if (error) throw error;
  const actionUrl=new URL(data?.actionUrl||'');
  if (actionUrl.protocol!=='https:'||!['sandbox.payfast.co.za','www.payfast.co.za'].includes(actionUrl.hostname)) throw new Error('The PayFast checkout response is invalid.');
  const form=document.createElement('form');
  form.method='post'; form.action=actionUrl.toString();
  Object.entries(data.fields||{}).forEach(([name,value])=>{
    const input=document.createElement('input');
    input.type='hidden'; input.name=name; input.value=String(value);
    form.appendChild(input);
  });
  document.body.appendChild(form); form.submit(); form.remove();
}
export async function startExhibitorYocoCheckout(token, invoiceId) {
  if (DEMO_MODE) throw new Error('Online payments are unavailable in demo mode.');
  const {data,error}=await supabase.functions.invoke('create-exhibitor-yoco-checkout',{
    body:{invoiceId,portalToken:token,idempotencyKey:crypto.randomUUID()},
  });
  if (error) throw error;
  const redirectUrl=new URL(data?.redirectUrl||'');
  if (redirectUrl.protocol!=='https:') throw new Error('The Yoco checkout response is invalid.');
  window.location.assign(redirectUrl.toString());
}
export async function saveExhibitorFascia(token, fasciaName) {
  if (!String(fasciaName || '').trim()) throw new Error('Enter the fascia name.');
  if (DEMO_MODE) { const s = demoRead(); const p = Object.values(s.profiles).find(x => x.portal_token === token); if (!p) throw new Error('This link is not valid.'); s.profiles[p.stand] = { ...p, fascia_name: fasciaName.trim().slice(0, 40), fascia_status: 'submitted', fascia_submitted_at: new Date().toISOString() }; demoWrite(s); return; }
  need(await supabase.rpc('save_exhibitor_fascia', { requested_token: token, requested_fascia_name: fasciaName }));
}
export async function uploadExhibitorFile(token, kind, file) {
  if (file.size > 50 * 1024 * 1024) throw new Error('Please choose a file smaller than 50 MB.');
  const safe = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '-');
  if (DEMO_MODE) {
    const dataUrl = file.size < 1.5 * 1024 * 1024 ? await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); }) : '';
    const s = demoRead(); const p = Object.values(s.profiles).find(x => x.portal_token === token); if (!p) throw new Error('This link is not valid.');
    s.files.push({ id: uid(), stand: p.stand, kind, file_name: safe, uploaded_at: new Date().toISOString(), data_url: dataUrl }); demoWrite(s); return;
  }
  const path = `${token}/${kind}-${Date.now()}-${safe}`;
  need(await supabase.storage.from('exhibitor-files').upload(path, file, { contentType: file.type || 'application/octet-stream' }));
  need(await supabase.rpc('register_exhibitor_file', { requested_token: token, requested_kind: kind, requested_file_name: safe, requested_path: path }));
}

// ── Exports ──────────────────────────────────────────────────────────────────
export function deliveryRows(orders, { day } = {}) {
  return orders.filter(o => o.status !== 'cancelled' && (!day || (o.delivery_at && new Date(o.delivery_at).toDateString() === new Date(day).toDateString())))
    .flatMap(o => (o.items || []).map(it => ({ 'Order': o.ref, 'Stand': o.stand, 'Exhibitor': o.exhibitor_name, 'Deliver by': o.delivery_at ? formatDayTime(o.delivery_at) : 'Not set', 'Item code': it.code, 'Item': it.name, 'Option': it.option || '', 'Qty': it.qty, 'Picked': it.picked ? 'Yes' : '', 'Loaded': it.loaded ? 'Yes' : '', 'Delivered': it.delivered ? 'Yes' : '' })));
}
export function stockTotals(orders) {
  const totals = new Map();
  orders.filter(o => o.status !== 'cancelled' && o.status !== 'delivered').forEach(o => (o.items || []).forEach(it => {
    const k = `${it.code}|${it.option || ''}`;
    const row = totals.get(k) || { code: it.code, name: it.name, option: it.option || '', qty: 0 };
    row.qty += it.qty; totals.set(k, row);
  }));
  return [...totals.values()].sort((a, b) => a.code.localeCompare(b.code));
}
export function packageInfrastructure(profiles, packages) {
  const byCode = new Map(packages.map(p => [p.code, p]));
  const totals = new Map(); const features = new Map();
  profiles.forEach(ex => {
    const p = byCode.get(ex.package_code); if (!p) return;
    (p.items || []).forEach(it => { totals.set(it.label, (totals.get(it.label) || 0) + Number(it.qty || 1)); });
    (p.features || []).forEach(f => { features.set(f.label, (features.get(f.label) || 0) + 1); });
    if (!hasLogo(p) && ex.logo_paid) features.set('Logo printed on fascia', (features.get('Logo printed on fascia') || 0) + 1);
  });
  const sort = m => [...m.entries()].map(([label, qty]) => ({ label, qty })).sort((a, b) => a.label.localeCompare(b.label));
  return { lines: sort(totals), features: sort(features) };
}

// ── Exhibitor import: extra columns (package, fascia name) ──────────────────
// The exhibitor template gets two optional extra columns at the end. After the
// normal exhibitor import, call applyExhibitorImportExtras(rows) with the same rows.
export const EXHIBITOR_TEMPLATE_COLUMNS = ['Company', 'Stand', 'Contact', 'Email', 'Work No.', 'Cell No.', 'Package code', 'Fascia name'];
export const EXHIBITOR_TEMPLATE_EXAMPLE = ['Acme Mining (Pty) Ltd', 'B12', 'Thandi Mokoena', 'thandi@acme.co.za', '011 555 0101', '082 555 0101', 'SHELL9', 'ACME MINING'];
export async function applyExhibitorImportExtras(rows) {
  let count = 0;
  for (const row of rows) {
    const stand = normalizeStand(pick(row, 'Stand', 'Stand number', 'Stand no'));
    const packageCode = pick(row, 'Package code', 'Package').toUpperCase();
    const fasciaName = pick(row, 'Fascia name', 'Fascia');
    if (!stand || (!packageCode && !fasciaName)) continue;
    await saveExhibitorProfile(stand, { ...(packageCode ? { package_code: packageCode } : {}), ...(fasciaName ? { fascia_name: fasciaName.slice(0, 40), fascia_status: 'approved' } : {}) });
    count += 1;
  }
  return count;
}
