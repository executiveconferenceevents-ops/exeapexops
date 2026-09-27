// ─── Mock data & in-memory store ─────────────────────────────────────────────
// Replace this file's exports with Supabase calls once you have your account.

export const CATEGORIES = [
  "Stand Construction",
  "Graphics & Branding",
  "Electrical",
  "Furniture",
  "AV / Technical",
  "Internet / Wi-Fi",
  "Logistics / Freight",
  "Loading Bay",
  "Storage",
  "Cleaning & Waste",
  "Security",
  "Other",
];

let _staff = [
  { id: "s1",  name: "Sipho Nkosi",      category: "Stand Construction" },
  { id: "s2",  name: "Thabo Dlamini",    category: "Electrical" },
  { id: "s3",  name: "Anika van Wyk",    category: "Furniture" },
  { id: "s4",  name: "Ruan Erasmus",     category: "AV / Technical" },
  { id: "s5",  name: "Mike Adams",       category: "Logistics / Freight" },
  { id: "s6",  name: "Zanele Mokoena",   category: "Security" },
  { id: "s7",  name: "Lerato Khumalo",   category: "Graphics & Branding" },
  { id: "s8",  name: "Pieter Botha",     category: "Internet / Wi-Fi" },
  { id: "s9",  name: "Nomsa Dube",       category: "Cleaning & Waste" },
  { id: "s10", name: "Johan van Zyl",    category: "Loading Bay" },
];

// Keep STAFF as a getter so components always get live data
export const STAFF = new Proxy([], {
  get(_, prop) { return _staff[prop]; },
  has(_, prop) { return prop in _staff; },
});

export function getStaff()                    { return [..._staff]; }
export function getStaffByCategory(cat)       { return _staff.filter(s => s.category === cat); }

let _staffCounter = 11;
export function addStaff({ name, category }) {
  const id = `s${_staffCounter++}`;
  const member = { id, name: name.trim(), category };
  _staff = [..._staff, member];
  return member;
}
export function updateStaff(id, patch) {
  _staff = _staff.map(s => s.id === id ? { ...s, ...patch } : s);
  return _staff.find(s => s.id === id);
}
export function removeStaff(id) {
  _staff = _staff.filter(s => s.id !== id);
}

export const EST_OPTIONS = [
  "15 min", "30 min", "1 hour", "2 hours", "3 hours", "4 hours", "Half day", "Full day",
];

export const STATUS_FLOW = [
  "LOGGED", "ASSIGNED", "PENDING", "IN PROGRESS", "ISSUES/DELAYED", "COMPLETED",
];

export const STATUS_COLORS = {
  "LOGGED":         { bg: "#EBF5FB", text: "#5D6D7E", badge: "#AEB6BF" },
  "ASSIGNED":       { bg: "#D6EAF8", text: "#1A5276", badge: "#2E86C1" },
  "PENDING":        { bg: "#FDEBD0", text: "#784212", badge: "#E67E22" },
  "IN PROGRESS":    { bg: "#D5F5E3", text: "#1E8449", badge: "#27AE60" },
  "ISSUES/DELAYED": { bg: "#F9EBEA", text: "#922B21", badge: "#E74C3C" },
  "COMPLETED":      { bg: "#EAECEE", text: "#566573", badge: "#7F8C8D" },
};

// ── Exhibitor master list (matches APEXOPS™ Excel SOURCE tab) ─────────────────
export const EXHIBITORS = [
  { stand:"A01", name:"Nedbank",          contact:"Lorna Louw",      phone:"+27 83 325 0283", email:"LornaL@Nedbank.co.za" },
  { stand:"A02", name:"Absa Group",       contact:"Linda Botha",     phone:"+27 82 201 0002", email:"linda@absa.co.za" },
  { stand:"A03", name:"Standard Bank",    contact:"Thandi Moyo",     phone:"+27 82 201 0003", email:"thandi@standardbank.co.za" },
  { stand:"B01", name:"Capitec Bank",     contact:"Reza Patel",      phone:"+27 82 201 0004", email:"reza@capitec.co.za" },
  { stand:"B02", name:"Eskom",            contact:"Willem Smit",     phone:"+27 82 201 0005", email:"willem@eskom.co.za" },
  { stand:"B03", name:"PPC Cement",       contact:"Maria Fernandez", phone:"+27 82 201 0006", email:"maria@ppc.co.za" },
  { stand:"C01", name:"Sasol",            contact:"Peter van Dyk",   phone:"+27 82 201 0007", email:"peter@sasol.co.za" },
  { stand:"C02", name:"Telkom SA",        contact:"Yolanda Dube",    phone:"+27 82 201 0008", email:"yolanda@telkom.co.za" },
  { stand:"C03", name:"MTN Group",        contact:"Kabelo Sithole",  phone:"+27 82 201 0009", email:"kabelo@mtn.co.za" },
  { stand:"D01", name:"Vodacom",          contact:"Anri du Plessis", phone:"+27 82 201 0010", email:"anri@vodacom.co.za" },
  { stand:"D02", name:"Discovery Ltd",    contact:"Sam Olivier",     phone:"+27 82 201 0011", email:"sam@discovery.co.za" },
  { stand:"D03", name:"Old Mutual",       contact:"Fiona Steyn",     phone:"+27 82 201 0012", email:"fiona@oldmutual.co.za" },
  { stand:"E01", name:"Anglo American",   contact:"Dawit Haile",     phone:"+27 82 201 0013", email:"dawit@angloamerican.com" },
  { stand:"E02", name:"Glencore",         contact:"Simone Koch",     phone:"+27 82 201 0014", email:"simone@glencore.com" },
  { stand:"E03", name:"Sappi",            contact:"Nhlanhla Zulu",   phone:"+27 82 201 0015", email:"nhlanhla@sappi.com" },
  { stand:"F01", name:"Mondi Group",      contact:"Carla Venter",    phone:"+27 82 201 0016", email:"carla@mondi.com" },
  { stand:"F02", name:"Implats",          contact:"Thandeka Cele",   phone:"+27 82 201 0017", email:"thandeka@implats.co.za" },
  { stand:"F03", name:"Harmony Gold",     contact:"Johan Louw",      phone:"+27 82 201 0018", email:"johan@harmonygold.co.za" },
  { stand:"G01", name:"Bidvest",          contact:"Phumza Ngcobo",   phone:"+27 82 201 0019", email:"phumza@bidvest.co.za" },
  { stand:"G02", name:"Tsogo Sun",        contact:"Brendan Nel",     phone:"+27 82 201 0020", email:"brendan@tsogosun.co.za" },
  { stand:"G03", name:"Sun International",contact:"Dineo Radebe",    phone:"+27 82 201 0021", email:"dineo@suninternational.com" },
  { stand:"H01", name:"Tsogo Hotels",     contact:"Marco Ferreira",  phone:"+27 82 201 0022", email:"marco@tsogo.co.za" },
];

const now = new Date();
const ago = (h, m = 0) => new Date(now - h * 3600000 - m * 60000);

let _queries = [
  { id:"Q-001", stand:"A01", exhibitor:"Nedbank",        contact:"Lorna Louw",      phone:"+27 83 325 0283", category:"Stand Construction",  description:"Back wall panels not aligned",       est:"2 hours", status:"IN PROGRESS",    assignedTo:"s1", loggedAt:ago(3) },
  { id:"Q-002", stand:"B02", exhibitor:"Eskom",          contact:"Willem Smit",     phone:"+27 82 201 0005", category:"Electrical",           description:"Main DB board tripping – no power",  est:"30 min",  status:"ASSIGNED",       assignedTo:"s2", loggedAt:ago(2,30) },
  { id:"Q-003", stand:"A03", exhibitor:"Standard Bank",  contact:"Thandi Moyo",     phone:"+27 82 201 0003", category:"Graphics & Branding",  description:"Logo printed wrong colour",          est:"3 hours", status:"PENDING",        assignedTo:"s7", loggedAt:ago(2) },
  { id:"Q-004", stand:"B01", exhibitor:"Capitec Bank",   contact:"Reza Patel",      phone:"+27 82 201 0004", category:"Furniture",            description:"Two bar stools missing",             est:"4 hours", status:"COMPLETED",      assignedTo:"s3", loggedAt:ago(5) },
  { id:"Q-005", stand:"C03", exhibitor:"MTN Group",      contact:"Kabelo Sithole",  phone:"+27 82 201 0009", category:"AV / Technical",       description:"LED screen flickering",              est:"1 hour",  status:"IN PROGRESS",    assignedTo:"s4", loggedAt:ago(1,45) },
  { id:"Q-006", stand:"D02", exhibitor:"Discovery Ltd",  contact:"Sam Olivier",     phone:"+27 82 201 0011", category:"Internet / Wi-Fi",     description:"Wi-Fi password not working",         est:"30 min",  status:"COMPLETED",      assignedTo:"s8", loggedAt:ago(4) },
  { id:"Q-007", stand:"E01", exhibitor:"Anglo American", contact:"Dawit Haile",     phone:"+27 82 201 0013", category:"Logistics / Freight",  description:"Crate not delivered to stand",       est:"2 hours", status:"ASSIGNED",       assignedTo:"s5", loggedAt:ago(1) },
  { id:"Q-008", stand:"C02", exhibitor:"Telkom SA",      contact:"Yolanda Dube",    phone:"+27 82 201 0008", category:"Security",             description:"Badge lost – replacement needed",    est:"30 min",  status:"LOGGED",         assignedTo:null, loggedAt:ago(0,20) },
  { id:"Q-009", stand:"H01", exhibitor:"Tsogo Hotels",   contact:"Marco Ferreira",  phone:"+27 82 201 0022", category:"Security",             description:"Unauthorised person in build area",  est:"15 min",  status:"LOGGED",         assignedTo:null, loggedAt:ago(0,5) },
];

let _nextNum = 10;

export function getQueries() { return [..._queries]; }

export function addQuery(q) {
  const id = `Q-${String(_nextNum++).padStart(3,"0")}`;
  const entry = {
    ...q,
    id,
    loggedAt: new Date(),
    status: "LOGGED",
    assignedTo: null,
    queuePos: _queries.filter(x => x.status !== "COMPLETED").length + 1,
  };
  _queries = [entry, ..._queries];
  return entry;
}

export function updateQuery(id, patch) {
  _queries = _queries.map(q => q.id === id ? { ...q, ...patch } : q);
  return _queries.find(q => q.id === id);
}

export function getQueuePosition(id, category) {
  const active = _queries
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
