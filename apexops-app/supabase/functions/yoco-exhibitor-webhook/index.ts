import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptPaymentSecrets, verifyYocoWebhook } from '../_shared/exhibitor-payments.mjs';

function respond(status:number, body:string) {
  return new Response(body,{status,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
}

Deno.serve(async request => {
  if (request.method!=='POST') return respond(405,'Method not allowed.');
  const rawBody=await request.text();
  const deliveryId=request.headers.get('webhook-id')||request.headers.get('x-yoco-signature')||'';
  if (!deliveryId||rawBody.length>16384) return respond(400,'Invalid Yoco webhook.');
  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey=Deno.env.get('EXHIBITOR_PAYMENT_ENCRYPTION_KEY');
  if (!supabaseUrl||!serviceRoleKey||!encryptionKey) return respond(503,'Webhook receiver is not configured.');

  let payload;
  try { payload=JSON.parse(rawBody); } catch { return respond(400,'Invalid webhook body.'); }
  const metadata=payload?.payload?.metadata||payload?.metadata||{};
  const checkoutId=String(metadata.checkoutId||metadata.checkout_id||payload?.payload?.checkoutId||'');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutId)) {
    return respond(400,'Invalid checkout identifier.');
  }
  const service=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:checkout,error:checkoutError}=await service
    .from('exhibitor_payment_checkouts')
    .select('id,invoice_id,client_id,amount_cents,status,expires_at,provider_transaction_id')
    .eq('id',checkoutId).maybeSingle();
  if (checkoutError||!checkout) return respond(404,'Checkout session not found.');
  const {data:settings,error:settingsError}=await service
    .from('client_exhibitor_payment_settings')
    .select('encrypted_provider_secrets')
    .eq('client_id',checkout.client_id).maybeSingle();
  if (settingsError||!settings?.encrypted_provider_secrets) return respond(503,'Yoco is not configured.');
  let secrets;
  try { secrets=await decryptPaymentSecrets(settings.encrypted_provider_secrets,encryptionKey); }
  catch { return respond(500,'Stored Yoco credentials are invalid.'); }
  const yoco=secrets?.yoco||{};
  if (!yoco.webhookSecret||!await verifyYocoWebhook(rawBody,request.headers,yoco.webhookSecret)) {
    return respond(403,'Yoco webhook signature is invalid.');
  }
  const eventType=String(payload?.type||payload?.event_type||'');
  if (!['payment.succeeded','checkout.completed'].includes(eventType)) return respond(200,'IGNORED');
  const providerTransactionId=String(payload?.payload?.id||payload?.id||payload?.payload?.paymentId||deliveryId);
  const amount=Number(payload?.payload?.amount||payload?.amount||0);
  if (amount!==Number(checkout.amount_cents)||checkout.status==='settled') return checkout.status==='settled'?respond(200,'OK'):respond(400,'Yoco amount does not match the invoice.');
  const currency=String(payload?.payload?.currency||payload?.currency||'ZAR').toUpperCase();
  if (currency!=='ZAR') return respond(400,'Yoco currency does not match the invoice.');
  if (new Date(checkout.expires_at).getTime()<=Date.now()) return respond(409,'Checkout session is no longer active.');

  const {error:settlementError}=await service.rpc('settle_exhibitor_invoice_payment',{
    target_invoice_id:checkout.invoice_id,
    requested_method:'yoco',
    requested_transaction_id:providerTransactionId,
    requested_amount_cents:Number(checkout.amount_cents),
    requested_paid_at:new Date().toISOString(),
    requested_idempotency_key:crypto.randomUUID(),
  });
  if (settlementError) return respond(409,'Verified payment requires reconciliation.');
  const {error:checkoutUpdateError}=await service.from('exhibitor_payment_checkouts').update({
    status:'settled',provider_transaction_id:providerTransactionId,completed_at:new Date().toISOString(),
  }).eq('id',checkoutId);
  if (checkoutUpdateError) return respond(500,'Payment settled; checkout status requires reconciliation.');
  const {error:deliveryError}=await service.from('exhibitor_webhook_deliveries').insert({provider:'yoco',delivery_id:deliveryId});
  if (deliveryError&&deliveryError.code!=='23505') return respond(500,'Payment settled; webhook delivery could not be recorded.');
  return respond(200,'OK');
});
