const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

let payfast;
async function helpers() {
  if (!payfast) payfast = await import('../supabase/functions/_shared/payfast.mjs');
  return payfast;
}

test('PayFast custom signature uses ordered PHP-style URL encoding and ignores the signature field', async () => {
  const { createPayfastSignature, payfastParameterString, verifyPayfastSignature } = await helpers();
  const fields = new URLSearchParams([
    ['merchant_id','10000100'],
    ['item_name','Event & Operations'],
    ['amount','120.00'],
    ['signature','ignored'],
  ]);
  const parameterString=payfastParameterString(fields,'Pass phrase!');
  assert.equal(parameterString,'merchant_id=10000100&item_name=Event+%26+Operations&amount=120.00&passphrase=Pass+phrase%21');
  const expected=createHash('md5').update(parameterString,'utf8').digest('hex');
  assert.equal(createPayfastSignature(fields,'Pass phrase!'),expected);
  fields.set('signature',expected);
  assert.equal(verifyPayfastSignature(fields,'Pass phrase!'),true);
  fields.set('amount','120.01');
  assert.equal(verifyPayfastSignature(fields,'Pass phrase!'),false);
});

test('PayFast amount parsing is exact and source IP filtering follows published IPv4 ranges', async () => {
  const { isPayfastSourceIp, payfastAmountToCents } = await helpers();
  assert.equal(payfastAmountToCents('120.00'),12000);
  assert.equal(payfastAmountToCents('0.5'),50);
  assert.equal(payfastAmountToCents('120.001'),null);
  assert.equal(payfastAmountToCents('1e2'),null);
  assert.equal(isPayfastSourceIp('197.97.145.150'),true);
  assert.equal(isPayfastSourceIp('41.74.179.200'),true);
  assert.equal(isPayfastSourceIp('8.8.8.8'),false);
  assert.equal(isPayfastSourceIp('not-an-ip'),false);
});
