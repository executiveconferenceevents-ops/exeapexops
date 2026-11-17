import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TERMS_VERSION='registration-request-v1';
const slugPattern=/^[a-z0-9]+(-[a-z0-9]+)*$/;

function respond(status:number,body:Record<string,unknown>,origin:string) {
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      'Access-Control-Allow-Origin':origin,
      'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Content-Type':'application/json',
      'Cache-Control':'no-store',
      'Vary':'Origin',
    },
  });
}

function clean(value:unknown,limit:number) {
  return String(value||'').trim().slice(0,limit);
}

function slugify(value:string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,72).replace(/-+$/g,'');
}

async function hashIp(ip:string,key:string) {
  const data=new TextEncoder().encode(`${key}:${ip}`);
  const digest=await crypto.subtle.digest('SHA-256',data);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

Deno.serve(async request=>{
  const appUrl=Deno.env.get('APP_URL')||'';
  let appOrigin='';
  try { const parsed=new URL(appUrl); if(parsed.protocol==='https:') appOrigin=parsed.origin; } catch { /* configuration error handled below */ }
  if (!appOrigin) return respond(503,{message:'Registration is not configured.'},'*');
  if (request.method==='OPTIONS') return new Response('ok',{headers:{'Access-Control-Allow-Origin':appOrigin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'}});
  if (request.method!=='POST') return respond(405,{message:'Method not allowed.'},appOrigin);
  if (request.headers.get('origin')!==appOrigin) return respond(403,{message:'Registration origin is not allowed.'},appOrigin);

  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl||!serviceRoleKey) return respond(503,{message:'Registration is not configured.'},appOrigin);
  const contentLength=Number(request.headers.get('content-length')||0);
  if (contentLength>8192) return respond(413,{message:'Registration request is too large.'},appOrigin);
  let input:Record<string,unknown>;
  try {
    const body=await request.text();
    if (new TextEncoder().encode(body).length>8192) return respond(413,{message:'Registration request is too large.'},appOrigin);
    input=JSON.parse(body);
  } catch { return respond(400,{message:'Provide a valid registration request.'},appOrigin); }

  const registrationRequestId=clean(input.registrationRequestId,64);
  const businessName=clean(input.businessName,200);
  const primaryContactName=clean(input.primaryContactName,160);
  const primaryContactEmail=clean(input.primaryContactEmail,254).toLowerCase();
  const billingContactEmail=clean(input.billingContactEmail,254).toLowerCase();
  const companyRegistrationNumber=clean(input.companyRegistrationNumber,100);
  const contactPhone=clean(input.contactPhone,40);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registrationRequestId)
    ||businessName.length<2||primaryContactName.length<2
    ||!/^\S+@\S+\.\S+$/.test(primaryContactEmail)
    ||(billingContactEmail&&!/^\S+@\S+\.\S+$/.test(billingContactEmail))
    ||input.acknowledged!==true) {
    return respond(400,{message:'Complete the organisation, contact details, and request acknowledgement.'},appOrigin);
  }
  const ip=request.headers.get('cf-connecting-ip')?.trim()
    ||request.headers.get('x-real-ip')?.trim()
    ||request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'';
  if (!ip) return respond(400,{message:'Could not verify the request source.'},appOrigin);
  const client=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const subjectHash=await hashIp(ip,serviceRoleKey);
  const { data:allowed,error:rateLimitError }=await client.rpc('consume_client_registration_rate_limit',{request_subject_hash:subjectHash});
  if (rateLimitError) return respond(503,{message:'Registration is temporarily unavailable.'},appOrigin);
  if (!allowed) return respond(429,{message:'Too many registration requests. Try again in about an hour.'},appOrigin);

  const baseSlug=slugify(businessName);
  if (!slugPattern.test(baseSlug)) return respond(400,{message:'Enter a valid organization name.'},appOrigin);
  const slug=`${baseSlug}-${crypto.randomUUID().slice(0,8)}`;
  const registration={
    registration_request_id:registrationRequestId,
    registered_business_name:businessName,
    slug,
    company_registration_number:companyRegistrationNumber,
    primary_contact_name:primaryContactName,
    primary_contact_email:primaryContactEmail,
    billing_contact_email:billingContactEmail,
    contact_phone:contactPhone,
    terms_version:TERMS_VERSION,
    terms_accepted_at:new Date().toISOString(),
  };
  const { data:submissionId,error:submitError }=await client.rpc('submit_client_registration',{registration_request:registration});
  if (submitError) {
    const duplicate=submitError.code==='23505';
    return respond(duplicate?409:400,{message:duplicate?'A request from this email is already awaiting review.':'Could not submit this registration request.'},appOrigin);
  }
  return respond(200,{submissionId,message:'Registration request received. A platform administrator will review it; this request does not create access or a service agreement.'},appOrigin);
});
