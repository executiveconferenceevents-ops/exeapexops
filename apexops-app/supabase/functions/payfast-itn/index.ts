import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isPayfastSourceIp, payfastAmountToCents, verifyPayfastSignature } from '../_shared/payfast.mjs';

function respond(status: number, body: string) {
  return new Response(body,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
}

function requiredSingle(form: URLSearchParams, name: string) {
  const values=form.getAll(name);
  return values.length===1?values[0]:null;
}

Deno.serve(async request=>{
  if (request.method!=='POST') return respond(405,'Method not allowed.');
  const merchantId=Deno.env.get('PAYFAST_MERCHANT_ID');
  const passphrase=Deno.env.get('PAYFAST_PASSPHRASE');
  const mode=Deno.env.get('PAYFAST_MODE')||'sandbox';
  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!merchantId||!passphrase||!supabaseUrl||!serviceRoleKey||!['sandbox','live'].includes(mode)) return respond(503,'ITN receiver is not configured.');
  const clientIp=request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ||request.headers.get('cf-connecting-ip')?.trim()
    ||request.headers.get('x-real-ip')?.trim()||'';
  if (!isPayfastSourceIp(clientIp)) return respond(403,'Invalid ITN source.');
  const contentLength=Number(request.headers.get('content-length')||0);
  if (contentLength>16384) return respond(413,'ITN request is too large.');
  let rawBody='';
  try { rawBody=await request.text(); } catch { return respond(400,'Invalid ITN body.'); }
  if (rawBody.length>16384) return respond(413,'ITN request is too large.');
  const form=new URLSearchParams(rawBody);
  const required=['merchant_id','m_payment_id','pf_payment_id','payment_status','amount_gross','signature'];
  if (required.some(key=>requiredSingle(form,key)===null)) return respond(400,'Required ITN field is missing or duplicated.');
  if (form.get('merchant_id')!==merchantId||!verifyPayfastSignature(form,passphrase)) return respond(403,'ITN signature or merchant check failed.');
  if (form.get('payment_status')!=='COMPLETE') return respond(200,'IGNORED');
  const checkoutId=form.get('m_payment_id')||'';
  const providerTransactionId=form.get('pf_payment_id')||'';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkoutId)
    || !/^\d{1,30}$/.test(providerTransactionId)) return respond(400,'Invalid checkout or provider transaction ID.');

  const service=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const { data:checkout,error:checkoutError }=await service.from('client_payment_checkout_sessions')
    .select('id,amount_cents,currency,status,expires_at,provider_transaction_id')
    .eq('id',checkoutId).maybeSingle();
  if (checkoutError||!checkout) return respond(404,'Checkout session not found.');
  if (checkout.status==='settled'&&checkout.provider_transaction_id===providerTransactionId) return respond(200,'OK');
  if (checkout.status!=='pending'||new Date(checkout.expires_at).getTime()<=Date.now()) return respond(409,'Checkout session is no longer active.');
  const grossCents=payfastAmountToCents(requiredSingle(form,'amount_gross')||'');
  if (checkout.currency!=='ZAR'||grossCents===null||grossCents!==Number(checkout.amount_cents)) return respond(400,'ITN amount does not match the invoice balance.');

  const host=mode==='sandbox'?'sandbox.payfast.co.za':'www.payfast.co.za';
  let validationResponse: Response;
  try {
    validationResponse=await fetch(`https://${host}/eng/query/validate`,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams([...form.entries()].filter(([key])=>key!=='signature')),
      signal:AbortSignal.timeout(10000),
    });
  } catch { return respond(502,'PayFast validation service is unavailable.'); }
  if (!validationResponse.ok||(await validationResponse.text()).trim()!=='VALID') return respond(400,'PayFast server validation failed.');

  const { error:settlementError }=await service.rpc('record_verified_payfast_payment',{
    target_checkout_session_id:checkoutId,
    provider_transaction_id:providerTransactionId,
    payment_date:new Date().toISOString().slice(0,10),
  });
  if (settlementError) return respond(409,'Verified payment requires reconciliation.');
  return respond(200,'OK');
});
