import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type':'application/json' },
  });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Creates a client organisation (platform admins only) and optionally invites its first client admin.
// Safe to retry: the caller supplies the client id, so replays from the offline queue do not duplicate.
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers:corsHeaders });
  if (request.method !== 'POST') return respond(405, { message:'Method not allowed.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return respond(500, { message:'Client service is not configured.' });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return respond(401, { message:'Sign in before creating clients.' });

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization:authorization } },
    auth: { persistSession:false, autoRefreshToken:false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession:false, autoRefreshToken:false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return respond(401, { message:'Your session is invalid or expired.' });

  const { data: platformAdmin, error: platformError } = await adminClient
    .from('platform_admins').select('user_id').eq('user_id', callerData.user.id).maybeSingle();
  if (platformError) return respond(500, { message:'Could not verify platform permissions.' });
  if (!platformAdmin) return respond(403, { message:'Only platform administrators can create client organizations.' });

  let input: { id?:string; name?:string; slug?:string; adminEmail?:string };
  try { input = await request.json(); }
  catch { return respond(400, { message:'Provide a valid client request.' }); }

  const id = String(input.id || crypto.randomUUID());
  const name = String(input.name || '').trim();
  const slug = String(input.slug || '').trim().toLowerCase();
  const adminEmail = String(input.adminEmail || '').trim().toLowerCase();
  if (!uuidPattern.test(id) || name.length < 2 || name.length > 160 || !slugPattern.test(slug)) {
    return respond(400, { message:'Provide a client name and a URL-safe slug.' });
  }
  if (adminEmail && !adminEmail.includes('@')) return respond(400, { message:'Provide a valid admin email.' });

  const { data: existing, error: existingError } = await adminClient
    .from('clients').select('id, slug').or(`id.eq.${id},slug.eq.${slug}`).limit(1).maybeSingle();
  if (existingError) return respond(500, { message:'Could not check existing clients.' });
  if (existing && existing.id !== id) return respond(409, { message:'That organization URL slug is already in use.' });

  if (!existing) {
    const { error: insertError } = await adminClient.from('clients').insert({ id, name, slug });
    if (insertError) return respond(500, { message:'Could not create the client organization.' });
  }

  let invited = false;
  if (adminEmail) {
    let user = null;
    for (let page = 1; page <= 20 && !user; page += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage:1000 });
      if (error) return respond(500, { message:'Client created, but the admin could not be looked up.', clientId:id });
      user = data.users.find(item => item.email?.toLowerCase() === adminEmail) || null;
      if (data.users.length < 1000) break;
    }
    if (!user) {
      const redirectTo = Deno.env.get('APP_URL') || undefined;
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(adminEmail, redirectTo ? { redirectTo } : undefined);
      if (error || !data.user) return respond(400, { message:`Client created, but the invitation failed: ${error?.message || 'unknown error'}`, clientId:id });
      user = data.user;
      invited = true;
    }
    const { data: membership } = await adminClient.from('client_event_memberships')
      .select('id').eq('user_id', user.id).eq('client_id', id).is('event_id', null).maybeSingle();
    if (!membership) {
      const { error } = await adminClient.from('client_event_memberships')
        .insert({ user_id:user.id, client_id:id, event_id:null, role:'client_admin' });
      if (error) return respond(500, { message:'Client created, but admin access could not be assigned.', clientId:id });
    }
  }

  return respond(200, {
    clientId:id,
    message:adminEmail ? (invited ? `Client created. Invitation sent to ${adminEmail}.` : `Client created. ${adminEmail} is now its admin.`) : 'Client created.',
  });
});
