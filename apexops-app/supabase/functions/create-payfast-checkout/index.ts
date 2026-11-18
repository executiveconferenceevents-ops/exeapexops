import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createPayfastSignature, payfastBuyerEmailField } from '../_shared/payfast.mjs';

function respond(status: number, body: Record<string, unknown>, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Content-Type':'application/json',
      'Cache-Control':'no-store',
    },
  });
}

Deno.serve(async request => {
  const appUrl=Deno.env.get('APP_URL')||'';
  let origin='https://invalid.local';
  try { origin=new URL(appUrl).origin; } catch { /* configuration error is returned below */ }
  if (request.method==='OPTIONS') return new Response('ok',{headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}});
  if (request.method!=='POST') return respond(405,{message:'Method not allowed.'},origin);

  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
  const merchantId=Deno.env.get('PAYFAST_MERCHANT_ID');
  const merchantKey=Deno.env.get('PAYFAST_MERCHANT_KEY');
  const passphrase=Deno.env.get('PAYFAST_PASSPHRASE');
  const mode=Deno.env.get('PAYFAST_MODE')||'sandbox';
  if (!supabaseUrl||!anonKey||!merchantId||!merchantKey||!passphrase||!appUrl||!['sandbox','live'].includes(mode)) {
    return respond(503,{message:'Online payment checkout is not configured.'},origin);
  }
  const authorization=request.headers.get('Authorization');
  if (!authorization) return respond(401,{message:'Sign in before starting checkout.'},origin);
  const caller=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const { data:userData,error:userError }=await caller.auth.getUser();
  if (userError||!userData.user) return respond(401,{message:'Your session is invalid or expired.'},origin);

  let input: {invoiceId?:string;idempotencyKey?:string};
  try { input=await request.json(); } catch { return respond(400,{message:'Provide a valid checkout request.'},origin); }
  const invoiceId=String(input.invoiceId||'');
  const idempotencyKey=String(input.idempotencyKey||'');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
    return respond(400,{message:'Choose an invoice and provide a valid request ID.'},origin);
  }
  const { data:checkoutRows,error:checkoutError }=await caller.rpc('create_client_payfast_checkout',{
    target_invoice_id:invoiceId,requested_idempotency_key:idempotencyKey,
  });
  if (checkoutError) return respond(400,{message:checkoutError.message||'Could not start checkout.'},origin);
  const checkout=Array.isArray(checkoutRows)?checkoutRows[0]:checkoutRows;
  if (!checkout?.checkout_session_id||!Number.isSafeInteger(Number(checkout.amount_cents))) return respond(500,{message:'Checkout session could not be created.'},origin);
  if (mode==='live'&&Number(checkout.amount_cents)<500) return respond(400,{message:'PayFast live transactions must be at least R5.00.'},origin);

  const { data:invoice,error:invoiceError }=await caller.from('client_invoices')
    .select('invoice_number,billed_to_name,billed_to_email,description')
    .eq('id',invoiceId).single();
  if (invoiceError||!invoice) return respond(404,{message:'Invoice not found.'},origin);
  const names=String(invoice.billed_to_name||'').trim().split(/\s+/);
  const notifyUrl=`${supabaseUrl.replace(/\/$/,'')}/functions/v1/payfast-itn`;
  const params:Record<string,string>={
    merchant_id:merchantId,
    merchant_key:merchantKey,
    return_url:`${appUrl.replace(/\/$/,'')}/?billing=success`,
    cancel_url:`${appUrl.replace(/\/$/,'')}/?billing=cancelled`,
    notify_url:notifyUrl,
    name_first:names.shift()||'Client',
    name_last:names.join(' '),
    ...payfastBuyerEmailField(mode,invoice.billed_to_email,userData.user.email),
    m_payment_id:checkout.checkout_session_id,
    amount:(Number(checkout.amount_cents)/100).toFixed(2),
    item_name:String(invoice.invoice_number).slice(0,100),
    item_description:String(invoice.description||'APEX Ops invoice').slice(0,255),
  };
  const signature=createPayfastSignature(params,passphrase);
  return respond(200,{
    actionUrl:mode==='sandbox'?'https://sandbox.payfast.co.za/eng/process':'https://www.payfast.co.za/eng/process',
    fields:{...params,signature},
  },origin);
});
