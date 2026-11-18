import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptPaymentSecrets } from '../_shared/exhibitor-payments.mjs';
import { isPayfastSourceIp, parsePayfastForm, payfastAmountToCents, verifyPayfastSignature } from '../_shared/payfast.mjs';

function respond(status:number, body:string) {
  return new Response(body,{status,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
}

Deno.serve(async request => {
  if (request.method!=='POST') return respond(405,'Method not allowed.');
  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey=Deno.env.get('EXHIBITOR_PAYMENT_ENCRYPTION_KEY');
  if (!supabaseUrl||!serviceRoleKey||!encryptionKey) return respond(503,'ITN receiver is not configured.');
  const clientIp=request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ||request.headers.get('cf-connecting-ip')?.trim()
    ||request.headers.get('x-real-ip')?.trim()||'';
  if (!isPayfastSourceIp(clientIp)) return respond(403,'Invalid ITN source.');
  const parsed=await parsePayfastForm(request,16384);
  if (!parsed.form) return parsed.error==='too_large'?respond(413,'ITN request is too large.'):respond(400,'Invalid ITN body.');
  const form=parsed.form;
  const checkoutId=form.get('m_payment_id')||'';
  const providerTransactionId=form.get('pf_payment_id')||'';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutId)
    ||!/^\d{1,30}$/.test(providerTransactionId)||form.get('payment_status')!=='COMPLETE') {
    return respond(400,'Invalid PayFast transaction.');
  }
  const service=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:checkout,error:checkoutError}=await service
    .from('exhibitor_payment_checkouts')
    .select('id,invoice_id,client_id,amount_cents,status,expires_at,provider_transaction_id')
    .eq('id',checkoutId).maybeSingle();
  if (checkoutError||!checkout) return respond(404,'Checkout session not found.');
  if (checkout.status==='settled'&&checkout.provider_transaction_id===providerTransactionId) return respond(200,'OK');
  if (checkout.status!=='pending'||new Date(checkout.expires_at).getTime()<=Date.now()) return respond(409,'Checkout session is no longer active.');

  const {data:settings,error:settingsError}=await service
    .from('client_exhibitor_payment_settings')
    .select('encrypted_provider_secrets')
    .eq('client_id',checkout.client_id).maybeSingle();
  if (settingsError||!settings?.encrypted_provider_secrets) return respond(503,'PayFast is not configured.');
  let secrets;
  try { secrets=await decryptPaymentSecrets(settings.encrypted_provider_secrets,encryptionKey); }
  catch { return respond(500,'Stored PayFast credentials are invalid.'); }
  const payfast=secrets?.payfast||{};
  if (!payfast.merchantId||!payfast.merchantKey||!payfast.passphrase) return respond(503,'PayFast is not configured.');
  if (form.get('merchant_id')!==payfast.merchantId||!verifyPayfastSignature(form,payfast.passphrase)) {
    return respond(403,'PayFast signature or merchant check failed.');
  }
  const grossCents=payfastAmountToCents(form.get('amount_gross')||'');
  if (grossCents!==Number(checkout.amount_cents)) return respond(400,'ITN amount does not match the invoice.');

  const {error:settlementError}=await service.rpc('settle_exhibitor_invoice_payment',{
    target_invoice_id:checkout.invoice_id,
    requested_method:'payfast',
    requested_transaction_id:providerTransactionId,
    requested_amount_cents:grossCents,
    requested_paid_at:new Date().toISOString(),
    requested_idempotency_key:crypto.randomUUID(),
  });
  if (settlementError) return respond(409,'Verified payment requires reconciliation.');
  await service.from('exhibitor_payment_checkouts').update({
    status:'settled',provider_transaction_id:providerTransactionId,completed_at:new Date().toISOString(),
  }).eq('id',checkoutId);
  return respond(200,'OK');
});
