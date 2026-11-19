import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptPaymentSecrets } from '../_shared/exhibitor-payments.mjs';
import { createPayfastSignature } from '../_shared/payfast.mjs';

function respond(status:number, body:Record<string,unknown>, origin:string) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Headers':'authorization, apikey, content-type',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Content-Type':'application/json',
    'Cache-Control':'no-store',
  } });
}

Deno.serve(async request => {
  const appUrl=Deno.env.get('APP_URL')||'';
  let origin='https://invalid.local';
  try { origin=new URL(appUrl).origin; } catch { /* configuration error below */ }
  if (request.method==='OPTIONS') return new Response('ok',{headers:{
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Vary':'Origin',
  }});
  if (request.method!=='POST') return respond(405,{message:'Method not allowed.'},origin);

  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey=Deno.env.get('EXHIBITOR_PAYMENT_ENCRYPTION_KEY');
  if (!supabaseUrl||!serviceRoleKey||!encryptionKey||!appUrl) {
    return respond(503,{message:'Online payment checkout is not configured.'},origin);
  }
  let input:{invoiceId?:string;portalToken?:string;idempotencyKey?:string};
  try { input=await request.json(); } catch { return respond(400,{message:'Provide a valid checkout request.'},origin); }
  const invoiceId=String(input.invoiceId||'');
  const portalToken=String(input.portalToken||'');
  const idempotencyKey=String(input.idempotencyKey||'');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(invoiceId)||!uuid.test(portalToken)||!uuid.test(idempotencyKey)) {
    return respond(400,{message:'Provide a valid invoice, private link, and request ID.'},origin);
  }

  const service=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:checkoutId,error:checkoutError}=await service.rpc('create_exhibitor_payment_checkout',{
    target_invoice_id:invoiceId,
    requested_portal_token:portalToken,
    requested_provider:'payfast',
    requested_idempotency_key:idempotencyKey,
  });
  if (checkoutError||!checkoutId) return respond(400,{message:checkoutError?.message||'Could not start checkout.'},origin);

  const [{data:checkout,error:checkoutReadError},{data:settings,error:settingsError}] = await Promise.all([
    service.from('exhibitor_payment_checkouts').select('id,invoice_id,amount_cents,status').eq('id',checkoutId).single(),
    service.from('exhibitor_invoices').select('client_id,invoice_number').eq('id',invoiceId).single(),
  ]);
  if (checkoutReadError||settingsError||!checkout) return respond(404,{message:'Checkout could not be loaded.'},origin);
  const {data:paymentSettings,error:paymentSettingsError}=await service
    .from('client_exhibitor_payment_settings')
    .select('encrypted_provider_secrets')
    .eq('client_id',settings.client_id)
    .single();
  if (paymentSettingsError||!paymentSettings?.encrypted_provider_secrets) {
    return respond(503,{message:'PayFast is not configured for this organisation.'},origin);
  }
  let secrets;
  try { secrets=await decryptPaymentSecrets(paymentSettings.encrypted_provider_secrets,encryptionKey); }
  catch { return respond(500,{message:'Stored PayFast credentials are invalid.'},origin); }
  const payfast=secrets?.payfast||{};
  if (!payfast.merchantId||!payfast.merchantKey||!payfast.passphrase) {
    return respond(503,{message:'PayFast is not configured for this organisation.'},origin);
  }
  const mode=String(payfast.mode||'sandbox');
  if (!['sandbox','live'].includes(mode)) return respond(503,{message:'PayFast mode is invalid.'},origin);

  const notifyUrl=`${supabaseUrl.replace(/\/$/,'')}/functions/v1/payfast-exhibitor-itn`;
  const params:Record<string,string>={
    merchant_id:payfast.merchantId,
    merchant_key:payfast.merchantKey,
    return_url:`${appUrl.replace(/\/$/,'')}/?exhibitor-payment=success`,
    cancel_url:`${appUrl.replace(/\/$/,'')}/?exhibitor-payment=cancelled`,
    notify_url:notifyUrl,
    name_first:'Exhibitor',
    m_payment_id:checkout.id,
    amount:(Number(checkout.amount_cents)/100).toFixed(2),
    item_name:String(settings.invoice_number).slice(0,100),
  };
  return respond(200,{
    actionUrl:mode==='sandbox'?'https://sandbox.payfast.co.za/eng/process':'https://www.payfast.co.za/eng/process',
    fields:{...params,signature:createPayfastSignature(params,payfast.passphrase)},
  },origin);
});
