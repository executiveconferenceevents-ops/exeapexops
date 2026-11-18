import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decryptPaymentSecrets, encryptPaymentSecrets } from '../_shared/exhibitor-payments.mjs';

function respond(status:number, body:Record<string,unknown>, origin:string) {
  return new Response(JSON.stringify(body), { status, headers:{
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Content-Type':'application/json',
    'Cache-Control':'no-store',
    'Vary':'Origin',
  } });
}

function text(value:unknown, maxLength:number, label:string) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw new TypeError(`${label} must be text.`);
  }
  const result=String(value ?? '').trim();
  if (result.length>maxLength) throw new RangeError(`${label} must be ${maxLength} characters or fewer.`);
  return result;
}

Deno.serve(async request => {
  const appUrl=Deno.env.get('APP_URL')||'';
  let origin='';
  try { const appOrigin=new URL(appUrl); if (appOrigin.protocol==='https:') origin=appOrigin.origin; } catch { /* configuration error handled below */ }
  if (!origin) return respond(503,{message:'Payment settings are not configured.'},'*');
  if (request.method==='OPTIONS') return new Response('ok',{headers:{
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Vary':'Origin',
  }});
  if (request.method!=='POST') return respond(405,{message:'Method not allowed.'},origin);
  if (request.headers.get('origin')!==origin) return respond(403,{message:'Request origin is not allowed.'},origin);

  const supabaseUrl=Deno.env.get('SUPABASE_URL');
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey=Deno.env.get('EXHIBITOR_PAYMENT_ENCRYPTION_KEY');
  if (!supabaseUrl||!anonKey||!serviceRoleKey||!encryptionKey) return respond(503,{message:'Payment settings are not configured.'},origin);

  const authorization=request.headers.get('Authorization');
  if (!authorization) return respond(401,{message:'Sign in to manage payment settings.'},origin);
  const caller=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await caller.auth.getUser();
  if (userError||!userData.user) return respond(401,{message:'Your session is invalid or expired.'},origin);

  let input:Record<string,unknown>;
  try { input=await request.json(); } catch { return respond(400,{message:'Provide a valid payment settings request.'},origin); }
  const action=String(input.action||'');
  const clientId=String(input.clientId||'');
  if (!['read','save'].includes(action)||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) {
    return respond(400,{message:'Choose a valid organisation and action.'},origin);
  }

  const {data:isPlatformAdmin,error:adminError}=await caller.rpc('is_platform_admin');
  if (adminError) return respond(500,{message:'Could not verify payment settings access.'},origin);
  if (!isPlatformAdmin) {
    const service=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:membership,error:membershipError}=await service.from('client_event_memberships')
      .select('id').eq('user_id',userData.user.id).eq('client_id',clientId)
      .eq('role','client_admin').is('event_id',null).maybeSingle();
    if (membershipError) return respond(500,{message:'Could not verify organisation access.'},origin);
    if (!membership) return respond(403,{message:'Only an organisation administrator can manage its payment settings.'},origin);
  }

  const service=createClient(supabaseUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:stored,error:storedError}=await service.from('client_exhibitor_payment_settings')
    .select('eft_enabled,payfast_enabled,yoco_enabled,bank_account_name,bank_name,bank_account_number,bank_branch_code,bank_account_type,eft_reference_prefix,encrypted_provider_secrets,updated_at')
    .eq('client_id',clientId).maybeSingle();
  if (storedError) return respond(500,{message:'Could not load organisation payment settings.'},origin);

  let secrets:Record<string,Record<string,unknown>>={};
  if (stored?.encrypted_provider_secrets) {
    try { secrets=await decryptPaymentSecrets(stored.encrypted_provider_secrets,encryptionKey); }
    catch { return respond(500,{message:'Stored payment credentials cannot be decrypted. Check EXHIBITOR_PAYMENT_ENCRYPTION_KEY.'},origin); }
  }
  const payfast=secrets.payfast||{};
  const yoco=secrets.yoco||{};
  const responseSettings={
    eft_enabled:Boolean(stored?.eft_enabled),
    payfast_enabled:Boolean(stored?.payfast_enabled),
    yoco_enabled:Boolean(stored?.yoco_enabled),
    bank_account_name:stored?.bank_account_name||'',
    bank_name:stored?.bank_name||'',
    bank_account_number:stored?.bank_account_number||'',
    bank_branch_code:stored?.bank_branch_code||'',
    bank_account_type:stored?.bank_account_type||'cheque',
    eft_reference_prefix:stored?.eft_reference_prefix||'',
    payfast_configured:Boolean(payfast.merchantId&&payfast.merchantKey&&payfast.passphrase),
    payfast_mode:payfast.mode==='live'?'live':'sandbox',
    yoco_configured:Boolean(yoco.apiKey&&yoco.webhookSecret),
    updated_at:stored?.updated_at||null,
  };
  if (action==='read') return respond(200,{settings:responseSettings},origin);

  const body=(input.settings&&typeof input.settings==='object'?input.settings:{}) as Record<string,unknown>;
  const eftEnabled=body.eft_enabled===true;
  const payfastEnabled=body.payfast_enabled===true;
  const yocoEnabled=body.yoco_enabled===true;
  let bankAccountName:string,bankName:string,bankAccountNumber:string,bankBranchCode:string,bankAccountType:string,eftReferencePrefix:string;
  try {
    bankAccountName=text(body.bank_account_name,120,'Account holder');
    bankName=text(body.bank_name,120,'Bank name');
    bankAccountNumber=text(body.bank_account_number,40,'Account number');
    bankBranchCode=text(body.bank_branch_code,20,'Branch code');
    bankAccountType=text(body.bank_account_type,20,'Account type');
    eftReferencePrefix=text(body.eft_reference_prefix,40,'EFT reference prefix');
  } catch (validationError) {
    return respond(400,{message:validationError instanceof Error?validationError.message:'Invalid bank details.'},origin);
  }
  if (eftEnabled&&(!bankAccountName||!bankName||!bankAccountNumber)) {
    return respond(400,{message:'Add the account holder, bank, and account number before enabling EFT.'},origin);
  }
  if (bankAccountType&&!['cheque','savings','transmission'].includes(bankAccountType)) {
    return respond(400,{message:'Choose a valid bank account type.'},origin);
  }

  const payfastInput=(input.payfast&&typeof input.payfast==='object'?input.payfast:{}) as Record<string,unknown>;
  const yocoInput=(input.yoco&&typeof input.yoco==='object'?input.yoco:{}) as Record<string,unknown>;
  let merchantId:string,merchantKey:string,passphrase:string,apiKey:string,webhookSecret:string;
  try {
    merchantId=text(payfastInput.merchantId,100,'PayFast merchant ID');
    merchantKey=text(payfastInput.merchantKey,200,'PayFast merchant key');
    passphrase=text(payfastInput.passphrase,200,'PayFast passphrase');
    apiKey=text(yocoInput.apiKey,300,'Yoco API key');
    webhookSecret=text(yocoInput.webhookSecret,300,'Yoco webhook secret');
  } catch (validationError) {
    return respond(400,{message:validationError instanceof Error?validationError.message:'Invalid provider credentials.'},origin);
  }
  const payfastChanged=Boolean(merchantId||merchantKey||passphrase);
  if (input.clearPayfast===true) delete secrets.payfast;
  else if (payfastChanged) {
    if (!merchantId||!merchantKey||!passphrase) return respond(400,{message:'Enter all PayFast merchant credentials together.'},origin);
    const mode=String(payfastInput.mode||'sandbox');
    if (!['sandbox','live'].includes(mode)) return respond(400,{message:'Choose PayFast sandbox or live mode.'},origin);
    secrets.payfast={merchantId,merchantKey,passphrase,mode};
  }
  const yocoChanged=Boolean(apiKey||webhookSecret);
  if (input.clearYoco===true) delete secrets.yoco;
  else if (yocoChanged) {
    if (!apiKey||!webhookSecret) return respond(400,{message:'Enter both Yoco credentials together.'},origin);
    secrets.yoco={apiKey,webhookSecret};
  }
  if (payfastEnabled&&!(secrets.payfast?.merchantId&&secrets.payfast?.merchantKey&&secrets.payfast?.passphrase)) {
    return respond(400,{message:'Configure PayFast credentials before enabling PayFast.'},origin);
  }
  if (yocoEnabled&&!(secrets.yoco?.apiKey&&secrets.yoco?.webhookSecret)) {
    return respond(400,{message:'Configure Yoco credentials before enabling Yoco.'},origin);
  }

  let encryptedProviderSecrets:string|null=null;
  if (Object.keys(secrets).length) {
    try { encryptedProviderSecrets=await encryptPaymentSecrets(secrets,encryptionKey); }
    catch { return respond(500,{message:'Could not encrypt payment credentials.'},origin); }
  }
  const {data:updated,error:updateError}=await service.from('client_exhibitor_payment_settings').upsert({
    client_id:clientId,
    eft_enabled:eftEnabled,
    payfast_enabled:payfastEnabled,
    yoco_enabled:yocoEnabled,
    bank_account_name:bankAccountName||null,
    bank_name:bankName||null,
    bank_account_number:bankAccountNumber||null,
    bank_branch_code:bankBranchCode||null,
    bank_account_type:bankAccountType||null,
    eft_reference_prefix:eftReferencePrefix||null,
    encrypted_provider_secrets:encryptedProviderSecrets,
    updated_at:new Date().toISOString(),
  },{onConflict:'client_id'})
    .select('eft_enabled,payfast_enabled,yoco_enabled,bank_account_name,bank_name,bank_account_number,bank_branch_code,bank_account_type,eft_reference_prefix,updated_at')
    .single();
  if (updateError||!updated) return respond(500,{message:'Could not save organisation payment settings.'},origin);
  return respond(200,{message:'Payment settings saved securely.',settings:{
    ...updated,
    payfast_configured:Boolean(secrets.payfast?.merchantId&&secrets.payfast?.merchantKey&&secrets.payfast?.passphrase),
    payfast_mode:secrets.payfast?.mode==='live'?'live':'sandbox',
    yoco_configured:Boolean(secrets.yoco?.apiKey&&secrets.yoco?.webhookSecret),
  }},origin);
});
