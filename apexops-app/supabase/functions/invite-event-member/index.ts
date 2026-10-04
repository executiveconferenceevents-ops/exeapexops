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

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers:corsHeaders });
  if (request.method !== 'POST') return respond(405, { message:'Method not allowed.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond(500, { message:'Invitation service is not configured.' });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) return respond(401, { message:'Sign in before inviting team members.' });

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization:authorization } },
    auth: { persistSession:false, autoRefreshToken:false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession:false, autoRefreshToken:false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return respond(401, { message:'Your session is invalid or expired.' });

  let input: { clientId?:string; eventId?:string|null; email?:string; role?:string };
  try { input = await request.json(); }
  catch { return respond(400, { message:'Provide a valid invitation request.' }); }

  const clientId = String(input.clientId || '');
  const eventId = input.eventId ? String(input.eventId) : null;
  const email = String(input.email || '').trim().toLowerCase();
  const role = String(input.role || '');
  const allowedRoles = ['client_admin', 'event_admin', 'ops', 'staff'];
  if (!clientId || !email.includes('@') || !allowedRoles.includes(role)) {
    return respond(400, { message:'Choose a client, a valid email, and a supported role.' });
  }
  if (!eventId && role !== 'client_admin') {
    return respond(400, { message:'Organization-wide access is only available to client admins.' });
  }

  let eventSlug: string | null = null;
  if (eventId) {
    const { data: event, error: eventError } = await adminClient
      .from('events')
      .select('id, client_id, slug')
      .eq('id', eventId)
      .eq('client_id', clientId)
      .maybeSingle();
    if (eventError) return respond(500, { message:'Could not verify the event.' });
    if (!event) return respond(404, { message:'That event does not belong to the selected client.' });
    eventSlug = event.slug;
  } else {
    const { data: client, error: clientError } = await adminClient
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .maybeSingle();
    if (clientError || !client) return respond(404, { message:'Client organization not found.' });
  }

  const { data: platformAdmin, error: platformError } = await adminClient
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', callerData.user.id)
    .maybeSingle();
  if (platformError) return respond(500, { message:'Could not verify platform permissions.' });

  let authorized = Boolean(platformAdmin);
  if (!authorized && eventId) {
    const { data: membership, error: membershipError } = await adminClient
      .from('client_event_memberships')
      .select('id')
      .eq('user_id', callerData.user.id)
      .eq('client_id', clientId)
      .eq('role', 'client_admin')
      .or(`event_id.is.null,event_id.eq.${eventId}`)
      .limit(1)
      .maybeSingle();
    if (membershipError) return respond(500, { message:'Could not verify client permissions.' });
    authorized = Boolean(membership);
  } else if (!authorized) {
    const { data: membership, error: membershipError } = await adminClient
      .from('client_event_memberships')
      .select('id')
      .eq('user_id', callerData.user.id)
      .eq('client_id', clientId)
      .eq('role', 'client_admin')
      .is('event_id', null)
      .limit(1)
      .maybeSingle();
    if (membershipError) return respond(500, { message:'Could not verify client permissions.' });
    authorized = Boolean(membership);
  }
  if (!authorized) return respond(403, { message:'Only a platform or client administrator can invite users to this scope.' });

  let invitedUser = null;
  let existingUser = false;
  for (let page = 1; page <= 20 && !invitedUser; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage:1000 });
    if (error) return respond(500, { message:'Could not look up the invitee.' });
    invitedUser = data.users.find(user => user.email?.toLowerCase() === email) || null;
    if (data.users.length < 1000) break;
  }
  existingUser = Boolean(invitedUser);

  if (!invitedUser) {
    const redirectTo = eventSlug && Deno.env.get('APP_URL')
      ? `${Deno.env.get('APP_URL')}/?event=${encodeURIComponent(eventSlug)}`
      : undefined;
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error || !data.user) return respond(400, { message:error?.message || 'Could not send the invitation.' });
    invitedUser = data.user;
  }

  const membershipQuery = adminClient.from('client_event_memberships')
    .select('id, role')
    .eq('user_id', invitedUser.id)
    .eq('client_id', clientId);
  const existingMembershipQuery = eventId ? membershipQuery.eq('event_id', eventId) : membershipQuery.is('event_id', null);
  const { data: existingMembership, error: existingMembershipError } = await existingMembershipQuery.maybeSingle();
  if (existingMembershipError) return respond(500, { message:'Could not check existing event access.' });
  if (existingMembership) {
    const { error: membershipUpdateError } = await adminClient
      .from('client_event_memberships')
      .update({ role })
      .eq('id', existingMembership.id);
    if (membershipUpdateError) return respond(500, { message:'Could not update the user’s event access.' });
  } else {
    const { error: membershipInsertError } = await adminClient.from('client_event_memberships').insert({
      user_id:invitedUser.id,
      client_id:clientId,
      event_id:eventId,
      role,
    });
    if (membershipInsertError) return respond(500, { message:'Invitation exists, but event access could not be assigned.' });
  }

  return respond(200, {
    message:existingUser ? `Access granted to ${email}.` : `Invitation sent to ${email}.`,
    invitedUserId:invitedUser.id,
  });
});