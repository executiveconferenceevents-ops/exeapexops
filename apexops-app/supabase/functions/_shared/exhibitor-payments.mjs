const encoder = new TextEncoder();

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encryptionKey(value) {
  const bytes = fromBase64(String(value || ''));
  if (bytes.length !== 32) throw new Error('EXHIBITOR_PAYMENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptPaymentSecrets(value, keyValue) {
  const key = await encryptionKey(keyValue);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptPaymentSecrets(value, keyValue) {
  const [ivValue, encryptedValue, ...extra] = String(value || '').split('.');
  if (!ivValue || !encryptedValue || extra.length) throw new Error('Stored payment credentials are invalid.');
  const key = await encryptionKey(keyValue);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivValue) }, key, fromBase64(encryptedValue));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyYocoWebhook(rawBody, headers, secret, now = Date.now()) {
  try {
    const webhookId = headers.get('webhook-id') || '';
    const timestamp = headers.get('webhook-timestamp') || '';
    const timestampSeconds = Number(timestamp);
    const signatures = (headers.get('webhook-signature') || '').split(/\s+/).filter(Boolean);
    if (!webhookId || !/^\d+$/.test(timestamp) || !signatures.length
      || Math.abs(Math.floor(now / 1000) - timestampSeconds) > 180) return false;
    const secretValue = String(secret || '').replace(/^whsec_/, '');
    const keyBytes = fromBase64(secretValue);
    if (!keyBytes.length) return false;
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signedContent = `${webhookId}.${timestamp}.${rawBody}`;
    const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(signedContent)));
    return signatures.some(value => {
      const [version, signature] = value.split(',', 2);
      if (version !== 'v1' || !signature) return false;
      try { return constantTimeEqual(expected, fromBase64(signature)); } catch { return false; }
    });
  } catch {
    return false;
  }
}