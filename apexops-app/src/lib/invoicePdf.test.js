const { TextDecoder, TextEncoder } = require('node:util');

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;

const { createInvoicePdf } = require('./invoicePdf');

test('creates a valid PDF for an issued invoice', () => {
  const pdf = createInvoicePdf({
      invoice_number:'ECE-2026-000001',
      status:'issued',
      currency:'ZAR',
      invoice_date:'2026-11-15',
      due_date:'2026-11-30',
      billed_to_name:'Northstar Events',
      billed_to_email:'billing@example.test',
      description:'Conference operations',
      subtotal_cents:10000,
      line_discount_cents:0,
      invoice_discount_cents:0,
      tax_label:'VAT',
      tax_cents:1500,
      total_cents:11500,
      payment_instructions:'Pay by EFT using the invoice number as reference.',
  }, [{
      description:'Conference operations',
      quantity:1,
      unit_price_cents:10000,
      discount_cents:0,
      line_total_cents:10000,
  }]);

  const signature = String.fromCharCode(...new Uint8Array(pdf.output('arraybuffer')).slice(0, 4));
  expect(signature).toBe('%PDF');
});
