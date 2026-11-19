/**
 * Invoice PDF for a placed (mock) order.
 *
 * Same visual language as the configuration summary so an order looks like a
 * real document: bill-to block, line items with quantities, tax, total and a
 * payment status. All money comes from the server-side quote that created the
 * order - the invoice never recomputes a price.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { CustomerConfiguration, ProductDefinition, Quote } from '@tent/core';

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 48;
const INK = rgb(0.1, 0.1, 0.11);
const MUTED = rgb(0.45, 0.46, 0.48);
const RULE = rgb(0.85, 0.85, 0.86);
const ACCENT = rgb(0.95, 0.66, 0.1);

export interface InvoiceData {
  orderId: string;
  issuedAt: Date;
  customer?: { name?: string; email?: string; company?: string; address?: string };
  config: CustomerConfiguration;
  product: ProductDefinition;
  quote: Quote;
  quantity: number;
  /** Tax rate applied on top of the design subtotal. */
  taxRate: number;
  paymentRef: string;
}

export async function buildInvoicePdf(data: InvoiceData): Promise<Uint8Array> {
  const { orderId, issuedAt, customer, config, product, quote, quantity, taxRate, paymentRef } = data;
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${orderId}`);
  doc.setSubject('Canopy tent order invoice');
  doc.setProducer('Tent Configurator');
  doc.setCreator('Tent Configurator');
  doc.setCreationDate(issuedAt);

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  // Masthead.
  page.drawRectangle({ x: 0, y: PAGE_H - 96, width: PAGE_W, height: 96, color: rgb(0.98, 0.98, 0.98) });
  page.drawRectangle({ x: 0, y: PAGE_H - 99, width: PAGE_W, height: 3, color: ACCENT });
  page.drawText('MVP', { x: MARGIN, y: PAGE_H - 44, size: 18, font: bold, color: INK });
  page.drawText('Visuals', { x: MARGIN, y: PAGE_H - 60, size: 9, font: regular, color: MUTED });

  const title = 'INVOICE';
  page.drawText(title, { x: PAGE_W - MARGIN - bold.widthOfTextAtSize(title, 18), y: PAGE_H - 44, size: 18, font: bold, color: INK });
  const numberText = orderId;
  page.drawText(numberText, {
    x: PAGE_W - MARGIN - regular.widthOfTextAtSize(numberText, 9),
    y: PAGE_H - 60,
    size: 9,
    font: regular,
    color: MUTED,
  });

  let y = PAGE_H - 130;
  const colRight = PAGE_W - MARGIN;

  // Meta + bill to, two columns.
  page.drawText('BILLED TO', { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  page.drawText('DETAILS', { x: PAGE_W / 2 + 10, y, size: 8, font: bold, color: MUTED });
  y -= 14;
  const billTo = [customer?.name || 'Guest customer', customer?.company, customer?.email, customer?.address].filter(Boolean) as string[];
  const details: Array<[string, string]> = [
    ['Invoice number', orderId],
    ['Issue date', issuedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })],
    ['Design', config.designId],
    ['Quote', quote.quoteId],
    ['Payment', `Paid - ${paymentRef}`],
  ];
  const rows = Math.max(billTo.length, details.length);
  for (let i = 0; i < rows; i++) {
    if (billTo[i]) page.drawText(truncate(billTo[i], 40), { x: MARGIN, y, size: 9.5, font: i === 0 ? bold : regular, color: INK });
    const d = details[i];
    if (d) {
      page.drawText(d[0], { x: PAGE_W / 2 + 10, y, size: 9, font: regular, color: MUTED });
      page.drawText(truncate(d[1] ?? '', 34), { x: PAGE_W / 2 + 120, y, size: 9, font: bold, color: INK });
    }
    y -= 14;
  }

  y -= 18;
  // Line-item table.
  page.drawRectangle({ x: MARGIN, y: y - 4, width: PAGE_W - MARGIN * 2, height: 20, color: rgb(0.96, 0.96, 0.97) });
  page.drawText('DESCRIPTION', { x: MARGIN + 8, y: y + 2, size: 8, font: bold, color: MUTED });
  page.drawText('QTY', { x: colRight - 190, y: y + 2, size: 8, font: bold, color: MUTED });
  page.drawText('UNIT', { x: colRight - 135, y: y + 2, size: 8, font: bold, color: MUTED });
  page.drawText('AMOUNT', { x: colRight - 55, y: y + 2, size: 8, font: bold, color: MUTED });
  y -= 24;

  const tier = product.tiers.find((t) => t.id === config.tierId)?.label ?? config.tierId;
  const addonLabels = config.selectedAddons.map((id) => product.addons.find((a) => a.id === id)?.label ?? id);
  const description = [
    `${product.name} (${config.size.label})`,
    tier,
    addonLabels.length ? `Add-ons: ${addonLabels.join(', ')}` : 'No add-ons',
  ];

  const unit = quote.total / quantity;
  description.forEach((line, i) => {
    page.drawText(truncate(line, 62), { x: MARGIN + 8, y, size: i === 0 ? 10 : 8.5, font: i === 0 ? bold : regular, color: i === 0 ? INK : MUTED });
    y -= 13;
  });
  const firstRowY = y + 13;
  page.drawText(String(quantity), { x: colRight - 188, y: firstRowY, size: 9.5, font: regular, color: INK });
  page.drawText(money(quote.currency, unit), { x: colRight - 135, y: firstRowY, size: 9.5, font: regular, color: INK });
  page.drawText(money(quote.currency, quote.total), { x: colRight - 55, y: firstRowY, size: 9.5, font: bold, color: INK });
  y -= 14;

  // Charge breakdown straight from the quote.
  page.drawLine({ start: { x: MARGIN, y }, end: { x: colRight, y }, color: RULE, thickness: 0.6 });
  y -= 14;
  for (const line of quote.lines.filter((l) => l.kind !== 'shipping' && l.amount !== 0)) {
    page.drawText(truncate(line.label, 60), { x: MARGIN + 8, y, size: 9, font: regular, color: MUTED });
    const value = money(quote.currency, Math.abs(line.amount) * quantity);
    page.drawText(value, { x: colRight - regular.widthOfTextAtSize(value, 9), y, size: 9, font: regular, color: INK });
    y -= 13;
  }

  const subtotal = quote.total;
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  const grand = Math.round((subtotal + tax) * 100) / 100;

  y -= 4;
  const totals: Array<[string, string, boolean]> = [
    ['Subtotal', money(quote.currency, subtotal), false],
    [`Tax (${(taxRate * 100).toFixed(1)}%)`, money(quote.currency, tax), false],
    ['Total due', money(quote.currency, grand), true],
  ];
  for (const [label, value, strong] of totals) {
    const font = strong ? bold : regular;
    const size = strong ? 12 : 9.5;
    page.drawText(label, { x: PAGE_W / 2 + 10, y: y - (strong ? 2 : 0), size, font, color: strong ? INK : MUTED });
    page.drawText(value, { x: colRight - font.widthOfTextAtSize(value, size), y: y - (strong ? 2 : 0), size, font, color: INK });
    y -= strong ? 20 : 14;
  }

  // Footer notes.
  page.drawRectangle({ x: MARGIN, y: MARGIN + 60, width: PAGE_W - MARGIN * 2, height: 0.6, color: RULE });
  page.drawText('Mock invoice generated by the tent configurator demo. No payment was taken.', {
    x: MARGIN,
    y: MARGIN + 40,
    size: 8,
    font: regular,
    color: MUTED,
  });
  page.drawText(`Production: 2 business days after artwork approval  |  Design ${config.designId}`, {
    x: MARGIN,
    y: MARGIN + 26,
    size: 8,
    font: regular,
    color: MUTED,
  });
  footer(page, regular, orderId);

  return doc.save();
}

function footer(page: PDFPage, font: PDFFont, orderId: string) {
  page.drawText(`${orderId}  |  Page 1 of 1`, { x: MARGIN, y: 20, size: 7, font, color: MUTED });
}

function money(currency: string, amount: number) {
  return `${currency} ${amount.toFixed(2)}`;
}

function truncate(text: string, max: number) {
  const clean = text.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}
