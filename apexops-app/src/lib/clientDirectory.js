export async function loadClientDirectory(database) {
  const { data, error } = await database.from('clients')
    .select('id, name, slug, event_limit, billing_mode, billing_status, billing_plan, paid_through, term_started_at, term_ends_at, committed_events, prepaid_event_credits, trial_started_at, trial_ends_at')
    .order('name');
  if (error) throw error;
  return data || [];
}
