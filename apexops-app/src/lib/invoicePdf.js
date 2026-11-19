import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function formatCurrency(cents, currency) {
  return new Intl.NumberFormat('en-ZA', { style:'currency', currency })
    .format(Number(cents || 0) / 100)
    .replace(/\u00a0/g, ' ');
}

export function createInvoicePdf(invoice, items) {
  const pdf = new jsPDF({ format:'a4', unit:'mm' });
  const margin = 18;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const rightEdge = pageWidth - margin;
  const currency = invoice.currency || 'ZAR';

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text('APEX OPS', margin, 20);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text(invoice.tax_cents > 0 ? 'TAX INVOICE' : 'INVOICE', rightEdge, 20, { align:'right' });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(invoice.invoice_number || 'Invoice', margin, 32);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`Status: ${invoice.status}`, margin, 39);
  pdf.text(`Invoice date: ${invoice.invoice_date || '—'}`, rightEdge, 31, { align:'right' });
  pdf.text(`Due date: ${invoice.due_date || 'Not set'}`, rightEdge, 37, { align:'right' });

  pdf.setFont('helvetica', 'bold');
  pdf.text('BILLED TO', margin, 52);
  pdf.setFont('helvetica', 'normal');
  pdf.text(invoice.billed_to_name || '', margin, 58);
  if (invoice.billed_to_email) pdf.text(invoice.billed_to_email, margin, 64);
  if (invoice.description) pdf.text(invoice.description, rightEdge, 58, { align:'right', maxWidth:90 });

  autoTable(pdf, {
    startY:72,
    margin:{ left:margin, right:margin },
    head:[['Item', 'Quantity', 'Unit price', 'Discount', 'Line total']],
    body:(items || []).map(item => [
      item.description || '',
      String(item.quantity ?? ''),
      formatCurrency(item.unit_price_cents, currency),
      formatCurrency(item.discount_cents, currency),
      formatCurrency(item.line_total_cents, currency),
    ]),
    styles:{ font:'helvetica', fontSize:8, cellPadding:2.5, overflow:'linebreak' },
    headStyles:{ fillColor:[32, 50, 70], textColor:255 },
    columnStyles:{ 0:{ cellWidth:'auto' }, 1:{ halign:'right' }, 2:{ halign:'right' }, 3:{ halign:'right' }, 4:{ halign:'right' } },
  });

  let y = pdf.lastAutoTable.finalY + 9;
  const totals = [
    ['Subtotal', invoice.subtotal_cents],
    ['Line discounts', -Number(invoice.line_discount_cents || 0)],
    ['Invoice discount', -Number(invoice.invoice_discount_cents || 0)],
    [invoice.tax_label || 'Tax', invoice.tax_cents],
    ['Total', invoice.total_cents],
  ];
  for (const [label, cents] of totals) {
    if (y > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
    pdf.setFont('helvetica', label === 'Total' ? 'bold' : 'normal');
    pdf.setFontSize(label === 'Total' ? 11 : 9);
    pdf.text(label, rightEdge - 55, y);
    pdf.text(formatCurrency(cents, currency), rightEdge, y, { align:'right' });
    y += label === 'Total' ? 8 : 6;
  }

  if (invoice.payment_instructions) {
    const instructions = pdf.splitTextToSize(invoice.payment_instructions, pageWidth - margin * 2);
    if (y + instructions.length * 4.5 > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
    y += 5;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('Payment instructions', margin, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(instructions, margin, y + 6);
  }

  return pdf;
}

export function downloadInvoicePdf(invoice, items) {
  const pdf = createInvoicePdf(invoice, items);
  const filename = `${invoice.invoice_number || 'invoice'}.pdf`.replace(/[^A-Za-z0-9._-]+/g, '_');
  pdf.save(filename);
}
