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

Deno.serve(async request=>{
  const appUrl=Deno.env.get('APP_URL')||'';
  let appOrigin='';
  try { const parsed=new URL(appUrl); if(parsed.protocol==='https:') appOrigin=parsed.origin; } catch { /* configuration error handled below */ }
  if (!appOrigin) return respond(503,{message:'Exhibitor reminder email is not configured.'},'*');
  if (request.method==='OPTIONS') return new Response('ok',{headers:{
    'Access-Control-Allow-Origin':appOrigin,
    'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Vary':'Origin',
  }});
  if (request.method!=='POST') return respond(405,{message:'Method not allowed.'},appOrigin);
  if (request.headers.get('origin')!==appOrigin) return respond(403,{message:'Email origin is not allowed.'},appOrigin);

  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey=Deno.env.get('RESEND_API_KEY');
  const resendFrom=Deno.env.get('RESEND_FROM');
  if (!supabaseUrl||!anonKey||!serviceRoleKey||!resendApiKey||!resendFrom) {
    return respond(503,{message:'Exhibitor reminder email is not configured.'},appOrigin);
  }
  const authorization=request.headers.get('Authorization');
  if (!authorization) return respond(401,{message:'Sign in before sending exhibitor reminders.'},appOrigin);
  const caller=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await caller.auth.getUser();
  if (userError||!userData.user) return respond(401,{message:'Your session is invalid or expired.'},appOrigin);

  let input:Record<string,unknown>;
  try { input=await request.json(); } catch { return respond(400,{message:'Provide a valid reminder request.'},appOrigin); }
  const eventId=String(input.eventId||'');
  const stand=String(input.stand||'').trim().toUpperCase();
  const missingItems=Array.isArray(input.missingItems)
    ? input.missingItems.filter((item):item is string=>typeof item==='string').map(item=>item.trim()).filter(Boolean).slice(0,20)
    : [];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)
      || !stand || stand.length>40 || !missingItems.length || missingItems.some(item=>item.length>100)) {
    return respond(400,{message:'Choose an exhibitor with outstanding checklist items.'},appOrigin);
  }
  const {data:canOperate,error:permissionError}=await caller.rpc('apex_can_operate_event',{p_event:eventId});
  if (permissionError||!canOperate) return respond(403,{message:'You do not have permission to email exhibitors for this event.'},appOrigin);

  const service=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const [{data:exhibitor,error:exhibitorError},{data:profile,error:profileError},{data:event,error:eventError}]=await Promise.all([
    service.from('exhibitors').select('name,email').eq('event_id',eventId).eq('stand',stand).maybeSingle(),
    service.from('exhibitor_profiles').select('portal_token').eq('event_id',eventId).eq('stand',stand).maybeSingle(),
    service.from('events').select('name').eq('id',eventId).maybeSingle(),
  ]);
  if (exhibitorError||profileError||eventError) return respond(500,{message:'Could not load exhibitor reminder details.'},appOrigin);
  if (!exhibitor||!profile) return respond(404,{message:'Exhibitor contact or portal link not found.'},appOrigin);
  const recipient=String(exhibitor.email||'').split(/[;,]/).map(value=>value.trim()).find(value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  if (!recipient) return respond(409,{message:'Add a valid exhibitor email address before sending a reminder.'},appOrigin);

  const portalUrl=new URL(appUrl);
  portalUrl.searchParams.set('portal',String(profile.portal_token));
  const checklist=missingItems.map(item=>`<li>${escapeHtml(item)}</li>`).join('');
  const company=String(exhibitor.name||'Exhibitor');
  const eventName=String(event?.name||'your event');
  let resendResponse:Response;
  try {
    resendResponse=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':`Bearer ${resendApiKey}`,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},
      body:JSON.stringify({
        from:resendFrom,
        to:[recipient],
        subject:`Items needed for ${eventName} · Stand ${stand}`,
        html:`<div style="font-family:Arial,sans-serif;color:#203247;max-width:640px;margin:auto"><h1>Items needed for ${escapeHtml(eventName)}</h1><p>Hello ${escapeHtml(company)},</p><p>Please provide or confirm the following items for stand ${escapeHtml(stand)}:</p><ul>${checklist}</ul><p><a href="${escapeHtml(portalUrl.toString())}">Open your exhibitor portal</a> to submit the outstanding details and artwork.</p><p>Thank you,<br>Event operations</p></div>`,
        text:`Hello ${company},\n\nPlease provide or confirm the following items for stand ${stand} at ${eventName}:\n${missingItems.map(item=>`- ${item}`).join('\n')}\n\nOpen your exhibitor portal: ${portalUrl.toString()}\n\nThank you,\nEvent operations`,
      }),
      signal:AbortSignal.timeout(15000),
    });
  } catch {
    return respond(502,{message:'Email provider is temporarily unavailable.'},appOrigin);
  }
  if (!resendResponse.ok) return respond(502,{message:'Email provider rejected the reminder message.'},appOrigin);
  return respond(200,{message:`Reminder sent to ${recipient}.`},appOrigin);
});
