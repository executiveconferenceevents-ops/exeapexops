const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let payments;
async function helpers() {
  if (!payments) payments = await import('../supabase/functions/_shared/exhibitor-payments.mjs');
  return payments;
}

const base64 = bytes => Buffer.from(bytes).toString('base64');

test('provider credentials are encrypted with an authenticated random IV', async () => {
  const { encryptPaymentSecrets, decryptPaymentSecrets } = await helpers();
  const key = base64(crypto.getRandomValues(new Uint8Array(32)));
  const secrets = { payfast:{ merchantKey:'secret-one' }, yoco:{ apiKey:'secret-two' } };
  const first = await encryptPaymentSecrets(secrets, key);
  const second = await encryptPaymentSecrets(secrets, key);
  assert.notEqual(first, second);
  assert.deepEqual(await decryptPaymentSecrets(first, key), secrets);
  const [iv, encrypted] = first.split('.');
  const bytes = Buffer.from(encrypted, 'base64');
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decryptPaymentSecrets(`${iv}.${bytes.toString('base64')}`, key));
  await assert.rejects(encryptPaymentSecrets(secrets, base64(new Uint8Array(16))), /32-byte key/);
});

test('Yoco webhook verification checks raw body signature and replay window', async () => {
  const { verifyYocoWebhook } = await helpers();
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = `whsec_${base64(secretBytes)}`;
  const now = 1_800_000_000_000;
  const timestamp = String(Math.floor(now / 1000));
  const webhookId = 'msg_fixture_001';
  const rawBody = '{"event_type":"payment.created","payload":{"amount":12500}}';
  const key = await crypto.subtle.importKey('raw', secretBytes, { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const signature = base64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${webhookId}.${timestamp}.${rawBody}`))));
  const headers = new Headers({
    'webhook-id':webhookId,
    'webhook-timestamp':timestamp,
    'webhook-signature':`v1,${signature}`,
  });
  assert.equal(await verifyYocoWebhook(rawBody, headers, secret, now), true);
  assert.equal(await verifyYocoWebhook(`${rawBody} `, headers, secret, now), false);
  assert.equal(await verifyYocoWebhook(rawBody, headers, secret, now + 181_000), false);
});

test('paid invoice fee accrual uses service order total_fee, never gross payment percentage', () => {
  const migrationPath = path.join(__dirname,'..','supabase','migrations','20261118_exhibitor_invoices_payments.sql');
  const sql = fs.readFileSync(migrationPath,'utf8');
  assert.match(sql,/fee_cents:=round\(order_row\.total_fee\*100\)::bigint/);
  assert.doesNotMatch(sql,/round\(requested_amount_cents\*fee_rate\)::bigint/);
});