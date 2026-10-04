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
  const headerStyle = 'background:#1c2b3a;color:#fff;text-align:left;font-size:7pt;font-weight:600;text-transform:uppercase;letter-spacing:.6px;border:1px solid #1c2b3a;padding:7px 6px;';
  const cellStyle = 'border:1px solid #d5dae0;padding:6px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;';
  return `<table style="width:100%;max-width:100%;table-layout:fixed;border-collapse:collapse;margin:8px 0 0;page-break-inside:auto;font-family:Inter,'Avenir Next',Arial,sans-serif;font-size:8pt;"><thead><tr>${headers.map(header => `<th style="${headerStyle}">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row, index) => `<tr style="background:${index % 2 ? '#f8f7f3' : '#fff'};page-break-inside:avoid;">${row.map(cell => `<td style="${cellStyle}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="20" style="${cellStyle}color:#64778a;">No records found.</td></tr>`}</tbody></table>`;
}

export function buildOperationsReport({ queries = [], rebookings = [], eventName = '', generatedAt = new Date() }) {
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
    <section class="hero"><div class="eyebrow">Executive Conference Events · APEXOPS™</div><h1>Operations Activity Report</h1><div class="meta">${eventName ? `${escapeHtml(eventName)} · ` : ''}Generated ${escapeHtml(formatDate(generatedAt))}</div><div class="metrics"><div class="metric"><strong>${queries.length}</strong><span>Total queries</span></div><div class="metric"><strong>${active.length}</strong><span>Open queries</span></div><div class="metric"><strong>${completed.length}</strong><span>Completed</span></div><div class="metric"><strong>${overdue.length}</strong><span>SLA overdue</span></div><div class="metric"><strong>${rebookings.length}</strong><span>Rebooking requests</span></div></div></section>
    <h2>Query Status Summary</h2>${table(['Status', 'Count'], statusCounts)}
    <h2>Query Activity</h2>${table(['Reference', 'Stand', 'Exhibitor', 'Department', 'Description', 'Status', 'Assigned', 'Logged'], queries.map(query => [query.id, query.stand, query.exhibitor, query.category, query.description, query.status, query.assignedTo || 'Unassigned', formatDate(query.loggedAt || query.logged_at)]))}
    <h2>Rebooking Requests</h2><p class="note">Expressions of interest received through the exhibitor rebooking form. These are not confirmed bookings.</p>${rebookingCards}
  </body></html>`;
}

export function buildTaskReport({ queries = [], title = 'Filtered Task Report', eventName = '', generatedAt = new Date(), filters = '' }) {
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
    <section class="hero"><h1>${escapeHtml(title)}</h1><div class="meta">${eventName ? `${escapeHtml(eventName)} · ` : ''}Generated ${escapeHtml(formatDate(generatedAt))}${filters ? ` · ${escapeHtml(filters)}` : ''}</div></section>
    <div class="metrics"><div class="metric"><strong>${queries.length}</strong><span>Visible tasks</span></div><div class="metric"><strong>${active.length}</strong><span>Open</span></div><div class="metric"><strong>${completed.length}</strong><span>Completed</span></div></div>
    ${table(['Reference', 'Stand', 'Exhibitor', 'Department', 'Issue', 'Status', 'Assigned to', 'Estimate', 'Logged'], rows)}
  </body></html>`;
}

function applyApexReportTheme(html) {
  const reportDocument = new DOMParser().parseFromString(html, 'text/html');
  const hero = reportDocument.querySelector('.hero');
  if (hero) {
    const eyebrow = hero.querySelector('.eyebrow');
    if (eyebrow) eyebrow.textContent = 'Executive Conference Events · APEXOPS™';
    else {
      const brand = reportDocument.createElement('div');
      brand.className = 'report-brand';
      brand.innerHTML = '<strong>APEXOPS™</strong><span>by Executive Conference Events</span>';
      hero.insertBefore(brand, hero.firstChild);
    }

    const heroTable = reportDocument.createElement('table');
    heroTable.setAttribute('width', '100%');
    heroTable.setAttribute('cellspacing', '0');
    heroTable.setAttribute('cellpadding', '0');
    const heroBody = reportDocument.createElement('tbody');
    const heroRow = reportDocument.createElement('tr');
    const heroCell = reportDocument.createElement('td');
    heroCell.className = 'hero';
    heroCell.setAttribute('bgcolor', '#1c2b3a');
    heroCell.setAttribute('valign', 'top');
    heroCell.style.cssText = 'background-color:#1c2b3a;color:#fff;padding:20px 22px;border-top:4px solid #c4ad82;';
    while (hero.firstChild) heroCell.appendChild(hero.firstChild);
    heroRow.appendChild(heroCell);
    heroBody.appendChild(heroRow);
    heroTable.appendChild(heroBody);
    hero.replaceWith(heroTable);
  }

  reportDocument.querySelectorAll('.metrics').forEach(metrics => {
    const items = [...metrics.querySelectorAll(':scope > .metric')];
    if (!items.length) return;
    const table = reportDocument.createElement('table');
    table.className = 'metrics report-metrics';
    table.setAttribute('width', '100%');
    table.setAttribute('cellspacing', '8');
    table.setAttribute('cellpadding', '0');
    table.style.cssText = 'width:100%;table-layout:fixed;border-collapse:separate;border-spacing:8px 0;margin:12px 0 18px;';
    const row = reportDocument.createElement('tr');
    const body = reportDocument.createElement('tbody');
    items.forEach(item => {
      const cell = reportDocument.createElement('td');
      cell.className = 'metric';
      cell.setAttribute('width', `${Math.floor(100 / items.length)}%`);
      cell.setAttribute('valign', 'top');
      cell.setAttribute('bgcolor', '#f3f1ec');
      cell.style.cssText = 'padding:12px 10px;border:1px solid #d5dae0;background-color:#f3f1ec;vertical-align:top;';
      const value = reportDocument.createElement('p');
      value.textContent = item.querySelector('strong')?.textContent || '';
      value.style.cssText = 'margin:0 0 5px;font-size:18pt;line-height:1.1;font-weight:bold;color:#1c2b3a;';
      const label = reportDocument.createElement('p');
      label.textContent = item.querySelector('span')?.textContent || '';
      label.style.cssText = 'margin:0;font-size:7pt;line-height:1.3;color:#64778a;text-transform:uppercase;';
      cell.appendChild(value);
      cell.appendChild(label);
      row.appendChild(cell);
    });
    body.appendChild(row);
    table.appendChild(body);
    metrics.replaceWith(table);
  });

  reportDocument.querySelectorAll('.rebooking-grid').forEach(grid => {
    const items = [...grid.querySelectorAll(':scope > .rebooking-item')];
    if (!items.length) return;
    const table = reportDocument.createElement('table');
    table.className = 'rebooking-grid';
    table.setAttribute('width', '100%');
    table.setAttribute('cellspacing', '6');
    table.setAttribute('cellpadding', '0');
    const body = reportDocument.createElement('tbody');
    for (let index = 0; index < items.length; index += 3) {
      const row = reportDocument.createElement('tr');
      items.slice(index, index + 3).forEach(item => {
        const cell = reportDocument.createElement('td');
        cell.className = 'rebooking-item';
        cell.setAttribute('width', '33%');
        cell.setAttribute('valign', 'top');
        cell.style.cssText = 'width:33%;padding:7px;border:1px solid #d5dae0;background-color:#fbfaf7;vertical-align:top;';
        const label = reportDocument.createElement('p');
        label.textContent = item.querySelector('span')?.textContent || '';
        label.style.cssText = 'margin:0 0 3px;font-size:7pt;line-height:1.2;color:#64778a;text-transform:uppercase;';
        const value = reportDocument.createElement('p');
        value.textContent = item.querySelector('strong')?.textContent || '';
        value.style.cssText = 'margin:0;font-size:8.5pt;line-height:1.3;color:#1c2b3a;';
        cell.appendChild(label);
        cell.appendChild(value);
        row.appendChild(cell);
      });
      while (row.children.length < 3) {
        const spacer = reportDocument.createElement('td');
        spacer.setAttribute('width', '33%');
        spacer.style.cssText = 'width:33%;border:0;';
        row.appendChild(spacer);
      }
      body.appendChild(row);
    }
    table.appendChild(body);
    grid.replaceWith(table);
  });

  reportDocument.querySelectorAll('table').forEach(table => {
    if (table.classList.contains('report-metrics') || table.classList.contains('rebooking-grid')) return;
    const headers = [...table.querySelectorAll('thead th')].map(cell => cell.textContent.trim());
    const widths = headers.length === 8 && headers[0] === 'Reference'
      ? ['7%', '7%', '15%', '12%', '24%', '10%', '14%', '11%']
      : headers.length === 9 && headers[0] === 'Reference'
        ? ['7%', '6%', '15%', '12%', '23%', '10%', '13%', '6%', '8%']
        : null;
    if (!widths) return;
    const columnGroup = reportDocument.createElement('colgroup');
    widths.forEach(width => {
      const column = reportDocument.createElement('col');
      column.setAttribute('width', width);
      column.style.width = width;
      columnGroup.appendChild(column);
    });
    table.insertBefore(columnGroup, table.firstChild);
  });

  const theme = reportDocument.createElement('style');
  theme.textContent = `
    @page { size:A4 landscape; margin:12mm; }
    * { box-sizing:border-box; }
    body { margin:0!important; color:#1c2b3a!important; font-family:Arial,Aptos,sans-serif!important; font-size:9pt; line-height:1.4; }
    .hero { margin:0 0 16px!important; padding:20px 22px!important; border-top:4px solid #b09060; background:#1c2b3a!important; color:#fff!important; }
    .hero h1 { margin:0 0 5px!important; color:#fff!important; font-family:Georgia,serif; font-size:23pt; }
    .eyebrow,.report-brand { margin-bottom:9px; color:#d6b77e!important; font-size:8pt; font-weight:bold; letter-spacing:1.2px; text-transform:uppercase; }
    .report-brand strong { color:#fff; font-size:11pt; }
    .report-brand span { margin-left:8px; color:#d6b77e; font-size:8pt; font-weight:normal; }
    .meta,.hero .meta { margin-top:5px; color:#e4d8c2!important; font-size:8.5pt; }
    h2 { margin:20px 0 8px!important; padding:0 0 5px; border-bottom:2px solid #b09060!important; color:#1c2b3a!important; font-family:Georgia,serif; font-size:14pt; }
    .metrics { width:100%; margin:12px 0 18px; table-layout:fixed; border-collapse:separate; border-spacing:6px 0; }
    .metric { padding:10px!important; border:1px solid #d5dae0!important; background:#f3f1ec!important; vertical-align:top; }
    .metric strong { display:block; color:#1c2b3a!important; font-size:17pt; }
    .metric span { color:#64778a!important; font-size:7pt; letter-spacing:.5px; text-transform:uppercase; }
    table { width:100%; max-width:100%; margin:8px 0 0; border-collapse:collapse; table-layout:fixed; mso-table-lspace:0pt; mso-table-rspace:0pt; }
    th { padding:7px 6px!important; border:1px solid #1c2b3a!important; background:#1c2b3a!important; color:#fff!important; text-align:left; font-size:7pt; }
    td { padding:6px!important; border:1px solid #d5dae0!important; color:#1c2b3a; vertical-align:top; overflow-wrap:anywhere; word-break:break-word; }
    tr { page-break-inside:avoid; }
    .note { margin-top:5px; color:#64778a!important; font-size:8.5pt; }
    .rebooking-card { margin:10px 0; padding:10px 12px; border:1px solid #d5dae0; border-left:3px solid #b09060; page-break-inside:avoid; }
    .rebooking-company { margin-bottom:7px; color:#1c2b3a!important; font-size:12pt; font-weight:bold; }
    .rebooking-grid { margin-top:6px; border-collapse:collapse; }
    .rebooking-item { width:33.33%; padding:6px!important; background:#fbfaf7; }
    .rebooking-item span { display:block; margin-bottom:2px; color:#64778a!important; font-size:7pt; text-transform:uppercase; }
    .rebooking-item strong { color:#1c2b3a!important; font-size:8.5pt; font-weight:normal; }
    .empty-report { padding:14px; border:1px dashed #c6c4bc; color:#64778a; }
    .report-footer { margin-top:18px; padding-top:7px; border-top:1px solid #d5dae0; color:#64778a; font-size:7pt; }
    @media print { thead { display:table-header-group; } .hero,.metric,th { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
  `;
  reportDocument.head.appendChild(theme);
  const footer = reportDocument.createElement('footer');
  footer.className = 'report-footer';
  footer.textContent = 'APEXOPS™ · Executive Conference Events';
  footer.style.cssText = 'margin-top:18px;padding-top:7px;border-top:1px solid #d5dae0;color:#64778a;font-size:7pt;';
  reportDocument.body.appendChild(footer);
  return `<!doctype html>${reportDocument.documentElement.outerHTML}`;
}

export function downloadWordReport(filename, html) {
  const blob = new Blob([applyApexReportTheme(html)], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printPdfReport(html) {
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) throw new Error('The report window was blocked. Please allow pop-ups and try again.');
  reportWindow.document.write(applyApexReportTheme(html));
  reportWindow.document.close();
  reportWindow.document.title = 'APEXOPS Operations Report';
  reportWindow.focus();
  reportWindow.onafterprint = () => reportWindow.close();
  const printScript = reportWindow.document.createElement('script');
  printScript.textContent = 'window.setTimeout(function () { window.print(); }, 300);';
  reportWindow.document.body.appendChild(printScript);
}
