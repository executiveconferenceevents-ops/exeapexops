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

test('PayFast server validation payload preserves the original signature and field order', async () => {
  const { payfastValidationBody } = await helpers();
  const fields = new URLSearchParams([
    ['merchant_id','10000100'],
    ['amount_gross','10.00'],
    ['signature','0123456789abcdef0123456789abcdef'],
  ]);
  assert.equal(payfastValidationBody(fields).toString(),'merchant_id=10000100&amount_gross=10.00&signature=0123456789abcdef0123456789abcdef');
});

test('sandbox checkout leaves buyer identity to PayFast while live checkout uses verified billing email', async () => {
  const { payfastBuyerEmailField } = await helpers();
  assert.deepEqual(payfastBuyerEmailField('sandbox','merchant@example.test','buyer@example.test'),{});
  assert.deepEqual(payfastBuyerEmailField('live','billing@example.test','buyer@example.test'),{email_address:'billing@example.test'});
  assert.deepEqual(payfastBuyerEmailField('live','','buyer@example.test'),{email_address:'buyer@example.test'});
});

test('PayFast ITN form parser accepts URL-encoded and multipart requests without dropping repeated fields', async () => {
  const { parsePayfastForm } = await helpers();
  const urlEncoded = new Request('https://example.test/itn', {
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams([['merchant_id','10000100'],['payment_status','COMPLETE'],['tag','one'],['tag','two']]),
  });
  const encoded = await parsePayfastForm(urlEncoded);
  assert.equal(encoded.form.get('merchant_id'),'10000100');
  assert.deepEqual(encoded.form.getAll('tag'),['one','two']);

  const fields = new FormData();
  fields.append('merchant_id','10000100');
  fields.append('payment_status','COMPLETE');
  fields.append('tag','one');
  fields.append('tag','two');
  const multipart = await parsePayfastForm(new Request('https://example.test/itn',{method:'POST',body:fields}));
  assert.equal(multipart.form.get('merchant_id'),'10000100');
  assert.deepEqual(multipart.form.getAll('tag'),['one','two']);

  const tooLarge = await parsePayfastForm(new Request('https://example.test/itn',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'x'.repeat(20),
  }),10);
  assert.equal(tooLarge.error,'too_large');
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
