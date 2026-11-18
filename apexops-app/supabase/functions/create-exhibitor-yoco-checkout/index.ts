import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptPaymentSecrets } from '../_shared/exhibitor-payments.mjs';

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
  if (request.method==='OPTIONS') return new Response('ok',{headers:{'Access-Control-Allow-Origin':origin}});
  if (request.method!=='POST') return respond(405,{message:'Method not allowed.'},origin);
  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey=Deno.env.get('EXHIBITOR_PAYMENT_ENCRYPTION_KEY');
  if (!supabaseUrl||!serviceRoleKey||!encryptionKey||!appUrl) return respond(503,{message:'Online payment checkout is not configured.'},origin);

  let input:{invoiceId?:string;portalToken?:string;idempotencyKey?:string};
  try { input=await request.json(); } catch { return respond(400,{message:'Provide a valid checkout request.'},origin); }
  const invoiceId=String(input.invoiceId||'');
  const portalToken=String(input.portalToken||'');
  const idempotencyKey=String(input.idempotencyKey||'');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(invoiceId)||!uuid.test(portalToken)||!uuid.test(idempotencyKey)) return respond(400,{message:'Provide a valid invoice, private link, and request ID.'},origin);

  const service=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:checkoutId,error:checkoutError}=await service.rpc('create_exhibitor_payment_checkout',{
    target_invoice_id:invoiceId,requested_portal_token:portalToken,
    requested_provider:'yoco',requested_idempotency_key:idempotencyKey,
  });
  if (checkoutError||!checkoutId) return respond(400,{message:checkoutError?.message||'Could not start checkout.'},origin);
  const [{data:checkout},{data:invoice}] = await Promise.all([
    service.from('exhibitor_payment_checkouts').select('id,amount_cents,status').eq('id',checkoutId).single(),
    service.from('exhibitor_invoices').select('client_id,invoice_number').eq('id',invoiceId).single(),
  ]);
  if (!checkout||!invoice) return respond(404,{message:'Checkout could not be loaded.'},origin);
  const {data:settings,error:settingsError}=await service.from('client_exhibitor_payment_settings')
    .select('encrypted_provider_secrets').eq('client_id',invoice.client_id).single();
  if (settingsError||!settings?.encrypted_provider_secrets) return respond(503,{message:'Yoco is not configured for this organisation.'},origin);
  let secrets;
  try { secrets=await decryptPaymentSecrets(settings.encrypted_provider_secrets,encryptionKey); }
  catch { return respond(500,{message:'Stored Yoco credentials are invalid.'},origin); }
  const yoco=secrets?.yoco||{};
  if (!yoco.apiKey) return respond(503,{message:'Yoco is not configured for this organisation.'},origin);

  let yocoResponse:Response;
  try {
    yocoResponse=await fetch('https://payments.yoco.com/api/checkouts',{
      method:'POST',
      headers:{Authorization:`Bearer ${yoco.apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        amount:Number(checkout.amount_cents),
        currency:'ZAR',
        successUrl:`${appUrl.replace(/\/$/,'')}/?exhibitor-payment=success`,
        cancelUrl:`${appUrl.replace(/\/$/,'')}/?exhibitor-payment=cancelled`,
        failureUrl:`${appUrl.replace(/\/$/,'')}/?exhibitor-payment=failed`,
        metadata:{invoiceId,checkoutId:String(checkout.id),invoiceNumber:invoice.invoice_number},
      }),
      signal:AbortSignal.timeout(15000),
    });
  } catch { return respond(502,{message:'Yoco is temporarily unavailable.'},origin); }
  const result=await yocoResponse.json().catch(()=>({}));
  if (!yocoResponse.ok) return respond(502,{message:'Yoco rejected the checkout.'},origin);
  const providerCheckoutId=String(result.id||result.checkoutId||'');
  const redirectUrl=String(result.redirectUrl||result.redirect_url||'');
  if (!providerCheckoutId||!redirectUrl) return respond(502,{message:'Yoco returned an invalid checkout.'},origin);
  await service.from('exhibitor_payment_checkouts').update({
    provider_checkout_id:providerCheckoutId,redirect_url:redirectUrl,status:'pending',
  }).eq('id',checkout.id);
  return respond(200,{redirectUrl,providerCheckoutId},origin);
});
