import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function respond(status:number,body:Record<string,unknown>,origin:string) {
  return new Response(JSON.stringify(body),{status,headers:{
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Content-Type':'application/json',
    'Cache-Control':'no-store',
    'Vary':'Origin',
  }});
}

function escapeHtml(value:unknown) {
  return String(value??'').replace(/[&<>"']/g,character=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  })[character]||character);
}

function decodeInvoicePdf(value:unknown) {
  if (typeof value!=='string'||value.length<16||value.length>14_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    const binary=atob(value);
    if (binary.length>10*1024*1024||!binary.startsWith('%PDF-')) return null;
    return binary;
  } catch { return null; }
}

function formatCurrency(cents:number,currency:string) {
  try { return new Intl.NumberFormat('en-ZA',{style:'currency',currency}).format(Number(cents||0)/100); }
  catch { return `${currency} ${(Number(cents||0)/100).toFixed(2)}`; }
}

Deno.serve(async request=>{
  const appUrl=Deno.env.get('APP_URL')||'';
  let appOrigin='';
  try { const parsed=new URL(appUrl); if(parsed.protocol==='https:') appOrigin=parsed.origin; } catch { /* configuration error handled below */ }
  if (!appOrigin) return respond(503,{message:'Invoice email is not configured.'},'*');
  if (request.method==='OPTIONS') return new Response('ok',{headers:{'Access-Control-Allow-Origin':appOrigin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'}});
  if (request.method!=='POST') return respond(405,{message:'Method not allowed.'},appOrigin);
  if (request.headers.get('origin')!==appOrigin) return respond(403,{message:'Invoice email origin is not allowed.'},appOrigin);

  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey=Deno.env.get('RESEND_API_KEY');
  const resendFrom=Deno.env.get('RESEND_FROM');
  if (!supabaseUrl||!anonKey||!serviceRoleKey||!resendApiKey||!resendFrom) return respond(503,{message:'Invoice email is not configured.'},appOrigin);
  const authorization=request.headers.get('Authorization');
  if (!authorization) return respond(401,{message:'Sign in before sending invoices.'},appOrigin);
  const caller=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await caller.auth.getUser();
  if (userError||!userData.user) return respond(401,{message:'Your session is invalid or expired.'},appOrigin);
  const {data:isPlatformAdmin,error:permissionError}=await caller.rpc('is_platform_admin');
  if (permissionError||!isPlatformAdmin) return respond(403,{message:'Only a Platform Owner can email client invoices.'},appOrigin);

  let input:Record<string,unknown>;
  try { input=await request.json(); } catch { return respond(400,{message:'Provide a valid invoice email request.'},appOrigin); }
  const invoiceId=String(input.invoiceId||'');
  const pdfBinary=decodeInvoicePdf(input.pdfBase64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)||!pdfBinary) {
    return respond(400,{message:'Provide a valid issued invoice and PDF document.'},appOrigin);
  }
  const service=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:invoice,error:invoiceError}=await service.from('client_invoices')
    .select('id,invoice_number,client_id,status,billed_to_name,billed_to_email,description,currency,total_cents,due_date,payment_instructions')
    .eq('id',invoiceId).maybeSingle();
  if (invoiceError||!invoice) return respond(404,{message:'Invoice not found.'},appOrigin);
  if (invoice.status==='draft'||!invoice.billed_to_email) return respond(409,{message:'Issue the invoice and add a billing email before sending.'},appOrigin);
  const {data:items,error:itemsError}=await service.from('client_invoice_items')
    .select('description,quantity,unit_price_cents,discount_cents,line_total_cents')
    .eq('invoice_id',invoiceId).order('line_number');
  if (itemsError) return respond(500,{message:'Could not load invoice line items.'},appOrigin);

  const itemRows=(items||[]).map(item=>`<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)}</td><td>${escapeHtml(formatCurrency(item.line_total_cents,invoice.currency))}</td></tr>`).join('');
  const total=formatCurrency(invoice.total_cents,invoice.currency);
  const html=`<div style="font-family:Arial,sans-serif;color:#203247;max-width:640px;margin:auto"><h1>APEX OPS invoice ${escapeHtml(invoice.invoice_number)}</h1><p>Hello ${escapeHtml(invoice.billed_to_name)},</p><p>Your invoice is attached as a PDF.</p><table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Item</th><th align="left">Quantity</th><th align="right">Amount</th></tr></thead><tbody>${itemRows}</tbody></table><p><strong>Total: ${escapeHtml(total)}</strong></p><p>Due date: ${escapeHtml(invoice.due_date||'Not set')}</p>${invoice.payment_instructions?`<p>Payment instructions: ${escapeHtml(invoice.payment_instructions)}</p>`:''}<p>If you have already paid, please reply with the transfer reference.</p></div>`;
  const filename=`${String(invoice.invoice_number||'invoice').replace(/[^A-Za-z0-9._-]+/g,'_')}.pdf`;
  let resendResponse:Response;
  try {
    resendResponse=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':`Bearer ${resendApiKey}`,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},
      body:JSON.stringify({
        from:resendFrom,
        to:[invoice.billed_to_email],
        subject:`APEX OPS invoice ${invoice.invoice_number}`,
        html,
        text:`Invoice ${invoice.invoice_number}\nTotal: ${total}\nDue date: ${invoice.due_date||'Not set'}\nYour invoice is attached as a PDF.`,
        attachments:[{filename,content:btoa(pdfBinary),content_type:'application/pdf'}],
      }),
      signal:AbortSignal.timeout(15000),
    });
  } catch { return respond(502,{message:'Email provider is temporarily unavailable.'},appOrigin); }
  if (!resendResponse.ok) return respond(502,{message:'Email provider rejected the invoice message.'},appOrigin);
  const providerResult=await resendResponse.json().catch(()=>({}));
  await service.from('platform_audit_log').insert({
    actor_user_id:userData.user.id,
    client_id:invoice.client_id,
    action:'invoice.email_sent',
    entity_type:'client_invoices',
    entity_id:invoice.id,
    new_values:{recipient:invoice.billed_to_email,provider:'resend',provider_message_id:providerResult.id||null},
    reason:'Issued invoice PDF emailed by Platform Owner',
  });
  return respond(200,{message:`Invoice ${invoice.invoice_number} sent to ${invoice.billed_to_email}.`},appOrigin);
});
