import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

function formatCurrency(cents, currency) {
  return new Intl.NumberFormat('en-ZA', { style:'currency', currency })
    .format(Number(cents || 0) / 100)
    .replace(/\u00a0/g, ' ');
}

export function downloadExhibitorInvoicePdf(invoice) {
  const pdf = new jsPDF({ format:'a4', unit:'mm' });
  const margin = 18;
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const rightEdge = pageWidth - margin;
  const currency = invoice.currency || 'ZAR';

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text(invoice.supplier_name || 'Exhibitor services', margin, 20);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text('FURNITURE ORDER INVOICE', rightEdge, 20, { align:'right' });

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(14);
  pdf.text(invoice.invoice_number || 'Invoice', margin, 32);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.text(`Invoice date: ${invoice.invoice_date || '—'}`, rightEdge, 31, { align:'right' });
  pdf.text(`Due date: ${invoice.due_date || 'Not set'}`, rightEdge, 37, { align:'right' });

  pdf.setFont('helvetica', 'bold');
  pdf.text('BILLED TO', margin, 52);
  pdf.setFont('helvetica', 'normal');
  pdf.text(invoice.billed_to_name || 'Exhibitor', margin, 58);
  if (invoice.billed_to_email) pdf.text(invoice.billed_to_email, margin, 64);
  pdf.text(`Stand: ${invoice.stand || '—'}`, rightEdge, 58, { align:'right' });

  autoTable(pdf, {
    startY:72,
    margin:{ left:margin, right:margin },
    head:[['Item', 'Quantity', 'Unit price', 'Line total']],
    body:(invoice.items || []).map(item => [
      [item.code, item.description].filter(Boolean).join(' · '),
      String(item.quantity ?? ''),
      formatCurrency(item.unit_price_cents, currency),
      formatCurrency(item.line_total_cents, currency),
    ]),
    styles:{ font:'helvetica', fontSize:8, cellPadding:2.5, overflow:'linebreak' },
    headStyles:{ fillColor:[32, 50, 70], textColor:255 },
    columnStyles:{ 0:{ cellWidth:'auto' }, 1:{ halign:'right' }, 2:{ halign:'right' }, 3:{ halign:'right' } },
  });

  let y = pdf.lastAutoTable.finalY + 9;
  if (y > pageHeight - margin) {
    pdf.addPage();
    y = margin;
  }
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('Total due', rightEdge - 55, y);
  pdf.text(formatCurrency(invoice.total_cents, currency), rightEdge, y, { align:'right' });

  if (invoice.payment_methods?.eft && invoice.bank_details) {
    const bank = invoice.bank_details;
    const instructions = [
      bank.account_name && `Account name: ${bank.account_name}`,
      bank.bank_name && `Bank: ${bank.bank_name}`,
      bank.account_number && `Account number: ${bank.account_number}`,
      bank.branch_code && `Branch code: ${bank.branch_code}`,
      bank.account_type && `Account type: ${bank.account_type}`,
      bank.reference_prefix && `Payment reference: ${bank.reference_prefix}${invoice.invoice_number || ''}`,
    ].filter(Boolean);
    if (instructions.length) {
      if (y + 13 + instructions.length * 5 > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      y += 12;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.text('Bank transfer details', margin, y);
      pdf.setFont('helvetica', 'normal');
      pdf.text(instructions, margin, y + 6);
    }
  }

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text('Unit prices include applicable supplier VAT.', margin, pageHeight - 10);
  const filename = `${invoice.invoice_number || 'furniture-invoice'}.pdf`.replace(/[^A-Za-z0-9._-]+/g, '_');
  pdf.save(filename);
}
