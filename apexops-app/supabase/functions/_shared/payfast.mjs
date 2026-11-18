import { createHash } from 'node:crypto';

const PAYFAST_IPV4_RANGES = [
  ['197.97.145.144', 28],
  ['41.74.179.192', 27],
  ['102.216.36.0', 28],
  ['102.216.36.128', 28],
  ['144.126.193.139', 32],
];

function encodePayfastValue(value) {
  return encodeURIComponent(String(value).trim())
    .replace(/[!'()*~]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

export function payfastParameterString(parameters, passphrase = '') {
  const entries = parameters instanceof URLSearchParams
    ? [...parameters.entries()]
    : Object.entries(parameters || {});
  const encoded = entries
    .filter(([key, value]) => key !== 'signature' && value !== null && value !== undefined && String(value) !== '')
    .map(([key, value]) => `${key}=${encodePayfastValue(value)}`);
  if (passphrase) encoded.push(`passphrase=${encodePayfastValue(passphrase)}`);
  return encoded.join('&');
}

export function createPayfastSignature(parameters, passphrase = '') {
  const parameterString = payfastParameterString(parameters, passphrase);
  return createHash('md5').update(parameterString, 'utf8').digest('hex');
}

export function payfastBuyerEmailField(mode, invoiceEmail, accountEmail) {
  if (mode === 'sandbox') return {};
  const email = String(invoiceEmail || accountEmail || '').trim();
  return email ? { email_address:email } : {};
}

export async function parsePayfastForm(request, maxBytes = 16384) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(contentLength) || contentLength > maxBytes) return { error:'too_large' };
  let rawBody;
  try { rawBody = await request.clone().text(); }
  catch { return { error:'invalid_body' }; }
  if (new TextEncoder().encode(rawBody).byteLength > maxBytes) return { error:'too_large' };
  try {
    const data = await request.formData();
    const form = new URLSearchParams();
    for (const [name,value] of data.entries()) {
      if (typeof value !== 'string') return { error:'invalid_body' };
      form.append(name,value);
    }
    return { form };
  } catch {
    return { error:'invalid_body' };
  }
}

export function verifyPayfastSignature(parameters, passphrase = '') {
  const supplied = parameters instanceof URLSearchParams
    ? parameters.get('signature')
    : parameters?.signature;
  if (typeof supplied !== 'string' || !/^[a-f0-9]{32}$/i.test(supplied)) return false;
  const expected = createPayfastSignature(parameters, passphrase);
  const candidate = supplied.toLowerCase();
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export function payfastValidationBody(parameters) {
  const entries = parameters instanceof URLSearchParams
    ? [...parameters.entries()]
    : Object.entries(parameters || {});
  return new URLSearchParams(entries);
}

export function payfastAmountToCents(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

function ipv4ToInteger(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

export function isPayfastSourceIp(ip) {
  const value = ipv4ToInteger(String(ip || '').trim().replace(/^::ffff:/i, ''));
  if (value === null) return false;
  return PAYFAST_IPV4_RANGES.some(([network, prefix]) => {
    const base = ipv4ToInteger(network);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (base & mask);
  });
}
