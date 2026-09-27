function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function table(headers, rows) {
  return `<table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="20">No records found.</td></tr>'}</tbody></table>`;
}

export function buildOperationsReport({ queries = [], rebookings = [], generatedAt = new Date() }) {
  const active = queries.filter(query => query.status !== 'COMPLETED');
  const completed = queries.filter(query => query.status === 'COMPLETED');
  const overdue = active.filter(query => {
    const deadline = query.slaDeadline || query.sla_deadline;
    return deadline && new Date(deadline) < new Date();
  });
  const statusCounts = ['LOGGED', 'ASSIGNED', 'PENDING', 'IN PROGRESS', 'ISSUES/DELAYED', 'ESCALATED', 'COMPLETED']
    .map(status => [status, queries.filter(query => query.status === status).length]);
  const rebookingCards = rebookings.length
    ? rebookings.map(request => {
      const topics = Array.isArray(request.discussion_topics) ? request.discussion_topics.join(', ') : request.discussion_topics;
      const details = [
        ['Received', formatDate(request.created_at)],
        ['Contact', `${request.contact_person}${request.contact_title ? ` · ${request.contact_title}` : ''}`],
        ['Email', request.email],
        ['Mobile', request.mobile],
        ['Current stand', request.current_stand],
        ['Interest', request.interest],
        ['Preferred stand', request.preferred_stand],
        ['Stand size', request.stand_size],
        ['Booth type', request.booth_type],
        ['Sponsorship', request.sponsorship_interest],
        ['Topics', topics],
        ['Notes', request.notes],
      ];
      return `<article class="rebooking-card"><div class="rebooking-company">${escapeHtml(request.company)}</div><div class="rebooking-grid">${details.map(([label, value]) => `<div class="rebooking-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`).join('')}</div></article>`;
    }).join('')
    : '<div class="empty-report">No rebooking requests found.</div>';

  return `<!doctype html><html><head><meta charset="utf-8"><title>APEXOPS Operations Report</title><style>
    @page { size: A4 landscape; margin: 12mm; } html, body { width: 100%; max-width: 100%; margin: 0; padding: 0; } body { font-family: Arial, sans-serif; color: #172746; font-size: 9pt; text-align: left; } h1 { font-size: 24pt; margin: 0 0 4px; } h2 { font-size: 14pt; color: #172746; border-bottom: 2px solid #d7c5a0; padding-bottom: 6px; margin: 24px 0 10px; } .eyebrow { color: #b49a6a; text-transform: uppercase; letter-spacing: 2px; font-size: 8pt; font-weight: bold; } .meta { color: #667784; font-size: 9pt; margin-bottom: 20px; } .hero { width: 100%; box-sizing: border-box; background: #0d1a32; color: white; padding: 22px 24px; margin: 0 0 18px; } .hero h1 { color: white; } .hero .meta { color: #d7c5a0; } .metrics { display: table; width: 100%; table-layout: fixed; } .metric { display: table-cell; border: 1px solid #dce7ed; padding: 10px; background: #f7fafc; } .metric strong { display: block; font-size: 18pt; color: #172746; } .metric span { font-size: 8pt; color: #667784; text-transform: uppercase; letter-spacing: .8px; } table { width: 100%; max-width: 100%; table-layout: fixed; border-collapse: collapse; margin: 8px 0 0; page-break-inside: auto; mso-table-lspace: 0pt; mso-table-rspace: 0pt; } th { background: #172746; color: white; text-align: left; font-size: 7pt; text-transform: uppercase; letter-spacing: .2px; } th, td { border: 1px solid #dce7ed; padding: 5px; vertical-align: top; overflow-wrap: anywhere; word-wrap: break-word; word-break: break-word; } tr { page-break-inside: avoid; } .note { color: #667784; font-size: 9pt; margin-top: 6px; } .rebooking-card { border: 1px solid #dce7ed; border-left: 4px solid #d7c5a0; padding: 10px 12px; margin: 9px 0; page-break-inside: avoid; } .rebooking-company { color: #172746; font-size: 12pt; font-weight: bold; margin-bottom: 8px; } .rebooking-grid { display: table; width: 100%; table-layout: fixed; } .rebooking-item { display: inline-block; width: 32%; box-sizing: border-box; padding: 4px 10px 4px 0; vertical-align: top; overflow-wrap: anywhere; } .rebooking-item span { display: block; color: #667784; font-size: 7pt; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 2px; } .rebooking-item strong { color: #172746; font-size: 8.5pt; font-weight: normal; } .empty-report { border: 1px dashed #cbd6dd; padding: 18px; color: #667784; }
  </style></head><body>
    <section class="hero"><div class="eyebrow">Executive Conference Events · APEXOPS</div><h1>Operations Activity Report</h1><div class="meta">Generated ${escapeHtml(formatDate(generatedAt))}</div><div class="metrics"><div class="metric"><strong>${queries.length}</strong><span>Total queries</span></div><div class="metric"><strong>${active.length}</strong><span>Open queries</span></div><div class="metric"><strong>${completed.length}</strong><span>Completed</span></div><div class="metric"><strong>${overdue.length}</strong><span>SLA overdue</span></div><div class="metric"><strong>${rebookings.length}</strong><span>Rebooking requests</span></div></div></section>
    <h2>Query Status Summary</h2>${table(['Status', 'Count'], statusCounts)}
    <h2>Query Activity</h2>${table(['Reference', 'Stand', 'Exhibitor', 'Department', 'Description', 'Status', 'Assigned', 'Logged'], queries.map(query => [query.id, query.stand, query.exhibitor, query.category, query.description, query.status, query.assignedTo || 'Unassigned', formatDate(query.loggedAt || query.logged_at)]))}
    <h2>Rebooking Requests</h2><p class="note">Expressions of interest received through the exhibitor rebooking form. These are not confirmed bookings.</p>${rebookingCards}
  </body></html>`;
}

export function buildTaskReport({ queries = [], title = 'Filtered Task Report', generatedAt = new Date(), filters = '' }) {
  const active = queries.filter(query => query.status !== 'COMPLETED');
  const completed = queries.filter(query => query.status === 'COMPLETED');
  const rows = queries.map(query => [
    query.id,
    query.stand,
    query.exhibitor,
    query.category,
    query.description,
    query.status,
    query.assignedName || query.assignedTo || 'Unassigned',
    query.est,
    formatDate(query.loggedAt || query.logged_at),
  ]);

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: A4 landscape; margin: 12mm; } body { font-family: Arial, sans-serif; color: #172746; font-size: 9pt; margin: 0; } h1 { font-size: 21pt; margin: 0 0 6px; } .hero { background: #0d1a32; color: #fff; padding: 18px 20px; margin-bottom: 16px; } .meta { color: #d7c5a0; font-size: 9pt; margin-top: 5px; } .metrics { display: flex; gap: 8px; margin: 12px 0 16px; } .metric { flex: 1; border: 1px solid #dce7ed; background: #f7fafc; padding: 9px; } .metric strong { display: block; font-size: 16pt; } .metric span { color: #667784; text-transform: uppercase; font-size: 7pt; } table { width: 100%; border-collapse: collapse; table-layout: fixed; } th { background: #172746; color: #fff; text-align: left; font-size: 7pt; text-transform: uppercase; } th, td { border: 1px solid #dce7ed; padding: 5px; vertical-align: top; overflow-wrap: anywhere; } tr { page-break-inside: avoid; }
  </style></head><body>
    <section class="hero"><h1>${escapeHtml(title)}</h1><div class="meta">Generated ${escapeHtml(formatDate(generatedAt))}${filters ? ` · ${escapeHtml(filters)}` : ''}</div></section>
    <div class="metrics"><div class="metric"><strong>${queries.length}</strong><span>Visible tasks</span></div><div class="metric"><strong>${active.length}</strong><span>Open</span></div><div class="metric"><strong>${completed.length}</strong><span>Completed</span></div></div>
    ${table(['Reference', 'Stand', 'Exhibitor', 'Department', 'Issue', 'Status', 'Assigned to', 'Estimate', 'Logged'], rows)}
  </body></html>`;
}

export function downloadWordReport(filename, html) {
  const blob = new Blob([html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function printPdfReport(html) {
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) throw new Error('The report window was blocked. Please allow pop-ups and try again.');
  reportWindow.document.write(html);
  reportWindow.document.close();
  reportWindow.document.title = 'APEXOPS Operations Report';
  reportWindow.focus();
  reportWindow.onafterprint = () => reportWindow.close();
  window.setTimeout(() => reportWindow.print(), 300);
}
