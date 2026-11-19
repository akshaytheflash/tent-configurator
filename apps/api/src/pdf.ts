/**
 * Production summary PDF.
 *
 * The PDF is built server-side from the same configuration document and Quote
 * the cart uses, so what the customer approved is exactly what production sees.
 * It is deliberately self-contained: if images are missing it still renders a
 * valid document with a placeholder box, because a missing file should never
 * block an order.
 *
 * The output embeds a machine-readable block (`TentConfigurator/1` JSON between
 * markers) so it can be re-parsed later and attached to the Shopify order.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { CustomerConfiguration, ProductDefinition, Quote } from '@tent/core';

export interface PdfAssets {
  /** PNG/JPEG data URLs or raw bytes keyed by the file name used in the PDF. */
  [name: string]: Uint8Array;
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 40;
const INK = rgb(0.1, 0.1, 0.11);
const MUTED = rgb(0.45, 0.46, 0.48);
const RULE = rgb(0.85, 0.85, 0.86);
const ACCENT = rgb(0.95, 0.66, 0.1);

export async function buildConfigurationPdf(opts: {
  config: CustomerConfiguration;
  product: ProductDefinition;
  quote: Quote;
  assets: PdfAssets;
  customer?: { name?: string; email?: string; company?: string };
}): Promise<Uint8Array> {
  const { config, product, quote, assets, customer } = opts;
  const doc = await PDFDocument.create();
  doc.setTitle(`Configuration ${config.designId}`);
  doc.setSubject('Custom canopy tent production summary');
  doc.setProducer('Tent Configurator');
  doc.setCreator('Tent Configurator');
  doc.setCreationDate(new Date());

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  y = drawHeader(page, bold, regular, product.name, config.designId);
  y = drawCustomerBlock(page, regular, bold, customer, config, y);

  // Preview image (the 3D hero render) on the right of the first block.
  const preview = await embedImage(doc, assets['design-preview.png'] ?? assets['design-preview.jpg']);
  if (preview) {
    const w = 240;
    const h = (preview.height / preview.width) * w;
    page.drawImage(preview, { x: PAGE_W - MARGIN - w, y: y - h + 6, width: w, height: h });
  }

  // Specification table.
  y = sectionTitle(page, bold, 'Configuration', y);
  y = keyValueRows(page, regular, bold, y, [
    ['Canopy size', `${config.size.label} (${product.canopy.width} x ${product.canopy.depth} mm)`],
    ['Base setup', product.tiers.find((t) => t.id === config.tierId)?.label ?? config.tierId],
    ['Add-ons', config.selectedAddons.join(', ') || 'None'],
    ['Parts customised', String(Object.values(config.parts).filter((p) => p.layers.length).length)],
    ['Double-sided parts', String(Object.values(config.parts).filter((p) => p.printMode === 'double').length)],
    ['Schema', `v${config.schemaVersion}`],
  ]);

  // Fabric colours per part.
  y = sectionTitle(page, bold, 'Fabric colours', y);
  for (const [partId, part] of Object.entries(config.parts)) {
    if (y < MARGIN + 120) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    const swatch = hexToRgb(part.color.hex);
    page.drawRectangle({ x: MARGIN, y: y - 8, width: 11, height: 11, color: swatch, borderColor: RULE, borderWidth: 0.5 });
    page.drawText(partId, { x: MARGIN + 18, y, size: 9, font: bold, color: INK });
    page.drawText(part.color.pantone, { x: MARGIN + 150, y, size: 9, font: regular, color: INK });
    page.drawText(`${part.layers.length} element(s)`, { x: MARGIN + 330, y, size: 9, font: regular, color: MUTED });
    y -= 15;
  }

  // Artwork: one sheet per customised part so the customer sees exactly what
  // is going on the fabric (text, colour and placement) before approving.
  const artworkParts = Object.entries(config.parts).filter(([, p]) => p.layers.length);
  if (artworkParts.length) {
    for (const [partId, part] of artworkParts) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = drawHeader(page, bold, regular, `Artwork - ${partLabel(product, partId)}`, config.designId);

      const tile = await embedImage(doc, assets[`part-${partId}.png`]);
      if (tile) {
        const w = PAGE_W - MARGIN * 2;
        const h = Math.min((tile.height / tile.width) * w, 250);
        page.drawImage(tile, { x: MARGIN, y: y - 16 - h, width: w, height: h });
        y -= h + 28;
      } else {
        page.drawRectangle({ x: MARGIN, y: y - 120, width: PAGE_W - MARGIN * 2, height: 100, borderColor: RULE, borderWidth: 0.7 });
        page.drawText('Sheet preview not captured for this design.', { x: MARGIN + 10, y: y - 70, size: 8, font: regular, color: MUTED });
        y -= 132;
      }

      y = keyValueRows(page, regular, bold, y, [
        ['Fabric', part.color.pantone],
        ['Print', part.printMode === 'double' ? 'Double sided' : 'Single sided'],
        ['Elements', String(part.layers.length)],
      ]);

      y = sectionTitle(page, bold, 'Elements', y);
      for (const layer of part.layers) {
        if (y < MARGIN + 40) {
          page = doc.addPage([PAGE_W, PAGE_H]);
          y = PAGE_H - MARGIN;
        }
        const desc =
          layer.type === 'image'
            ? `Image "${layer.asset?.name ?? 'uploaded'}"  x ${Math.round(layer.x)}  y ${Math.round(layer.y)}  ${Math.round(layer.width)}x${Math.round(layer.height)} mm  rot ${Math.round(layer.rotation)}°`
            : `Text "${layer.text.replace(/\n/g, ' / ')}"  ${Math.round(layer.fontSize)} mm  rot ${Math.round(layer.rotation)}°  ${layer.fill}`;
        page.drawText(truncate(desc, 110), { x: MARGIN, y, size: 8.5, font: regular, color: MUTED });
        y -= 12;
      }
    }
  }

  // Price breakdown.
  if (y < MARGIN + 160) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }
  y = sectionTitle(page, bold, 'Pricing', y);
  for (const line of quote.lines) {
    page.drawText(line.label, { x: MARGIN, y, size: 9, font: regular, color: INK });
    const value = `${line.amount < 0 ? '-' : ''}${quote.currency} ${Math.abs(line.amount).toFixed(2)}`;
    page.drawText(value, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(value, 9), y, size: 9, font: regular, color: INK });
    y -= 14;
  }
  page.drawLine({ start: { x: MARGIN, y: y + 5 }, end: { x: PAGE_W - MARGIN, y: y + 5 }, color: RULE, thickness: 0.7 });
  const total = `${quote.currency} ${quote.total.toFixed(2)}`;
  page.drawText('Total', { x: MARGIN, y: y - 8, size: 12, font: bold, color: INK });
  page.drawText(total, { x: PAGE_W - MARGIN - bold.widthOfTextAtSize(total, 12), y: y - 8, size: 12, font: bold, color: INK });
  y -= 34;

  // Production views (only the angles that were actually captured).
  const views = ['view-front', 'view-back', 'view-left', 'view-right'] as const;
  page = doc.addPage([PAGE_W, PAGE_H]);
  y = PAGE_H - MARGIN;
  y = drawHeader(page, bold, regular, `${product.name} - production views`, config.designId);
  let x = MARGIN;
  const cellW = (PAGE_W - MARGIN * 2 - 24) / 2;
  let rowY = y - 10;
  for (let i = 0; i < views.length; i++) {
    const img = await embedImage(doc, assets[`${views[i]}.png`] ?? assets[`${views[i]}.jpg`]);
    const label = views[i].replace('view-', '').toUpperCase();
    page.drawText(label, { x, y: rowY, size: 8, font: bold, color: MUTED });
    if (img) {
      const w = cellW;
      const h = Math.min((img.height / img.width) * w, 260);
      page.drawImage(img, { x, y: rowY - h - 8, width: w, height: h });
    } else {
      page.drawRectangle({ x, y: rowY - 180, width: cellW, height: 172, borderColor: RULE, borderWidth: 0.7 });
    }
    x += cellW + 24;
    if (i % 2 === 1) {
      x = MARGIN;
      rowY -= 300;
    }
  }

  // Print file (the flat-lay). One per page so the printer can scale to size.
  const print = await embedImage(doc, assets['print-file.png'] ?? assets['print-file.jpg']);
  if (print) {
    const p = doc.addPage([PAGE_W, PAGE_H]);
    let py = PAGE_H - MARGIN;
    py = drawHeader(p, bold, regular, 'Print file - flat lay', config.designId);
    const w = PAGE_W - MARGIN * 2;
    const h = Math.min((print.height / print.width) * w, PAGE_H - MARGIN * 2 - 90);
    p.drawImage(print, { x: MARGIN, y: py - 10 - h, width: w, height: h });
    p.drawText(
      `Flat-lay ${Math.round(print.width)}px wide. Include ${product.printMarginMm} mm bleed.`,
      { x: MARGIN, y: MARGIN, size: 8, font: regular, color: MUTED },
    );
  }

  // Embedded machine-readable block, attached to the PDF file itself (standard
  // `EmbeddedFile` annotation) so it survives downloads and can be re-parsed.
  const json = JSON.stringify({ kind: 'tent-configuration', version: 1, config, quoteId: quote.quoteId });
  await doc.attach(
    new TextEncoder().encode(json),
    `${config.designId}.json`,
    {
      mimeType: 'application/json',
      description: 'Machine-readable tent configuration',
      creationDate: new Date(),
      modificationDate: new Date(),
    },
  );

  const footerPages = doc.getPages();
  for (let i = 0; i < footerPages.length; i++) {
    footerPages[i].drawText(
      `Tent Configurator - ${config.designId} - page ${i + 1} of ${footerPages.length}`,
      { x: MARGIN, y: 18, size: 7, font: regular, color: MUTED },
    );
  }

  return doc.save();
}

function drawHeader(page: PDFPage, bold: PDFFont, regular: PDFFont, title: string, designId: string) {
  page.drawRectangle({ x: 0, y: PAGE_H - 64, width: PAGE_W, height: 64, color: rgb(0.98, 0.98, 0.98) });
  page.drawRectangle({ x: 0, y: PAGE_H - 66, width: PAGE_W, height: 2, color: ACCENT });
  page.drawText('CONFIGURATION SUMMARY', { x: MARGIN, y: PAGE_H - 30, size: 8, font: bold, color: MUTED });
  page.drawText(title, { x: MARGIN, y: PAGE_H - 46, size: 13, font: bold, color: INK });
  const idText = `Design ${designId}`;
  page.drawText(idText, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(idText, 8), y: PAGE_H - 30, size: 8, font: regular, color: MUTED });
  return PAGE_H - 90;
}

function drawCustomerBlock(
  page: PDFPage, regular: PDFFont, bold: PDFFont,
  customer: { name?: string; email?: string; company?: string } | undefined,
  config: CustomerConfiguration,
  y: number,
) {
  page.drawText('CUSTOMER', { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  y -= 13;
  if (customer?.name) { page.drawText(customer.name, { x: MARGIN, y, size: 10, font: bold, color: INK }); y -= 13; }
  if (customer?.company) { page.drawText(customer.company, { x: MARGIN, y, size: 9, font: regular, color: INK }); y -= 12; }
  if (customer?.email) { page.drawText(customer.email, { x: MARGIN, y, size: 9, font: regular, color: INK }); y -= 12; }
  page.drawText(`Prepared ${new Date(config.updatedAt).toLocaleDateString()}`, { x: MARGIN, y, size: 9, font: regular, color: MUTED });
  return y - 26;
}

function sectionTitle(page: PDFPage, bold: PDFFont, title: string, y: number) {
  page.drawText(title.toUpperCase(), { x: MARGIN, y, size: 8, font: bold, color: MUTED });
  page.drawLine({ start: { x: MARGIN, y: y - 5 }, end: { x: PAGE_W - MARGIN, y: y - 5 }, color: RULE, thickness: 0.6 });
  return y - 20;
}

function keyValueRows(page: PDFPage, regular: PDFFont, bold: PDFFont, y: number, rows: Array<[string, string]>) {
  for (const [k, v] of rows) {
    page.drawText(k, { x: MARGIN, y, size: 9, font: regular, color: MUTED });
    page.drawText(v, { x: MARGIN + 150, y, size: 9, font: bold, color: INK });
    y -= 15;
  }
  return y - 8;
}

async function embedImage(doc: PDFDocument, data: Uint8Array | undefined): Promise<PDFImage | null> {
  if (!data) return null;
  try {
    // detect JPEG magic to pick the right embedder
    if (data[0] === 0xff && data[1] === 0xd8) return await doc.embedJpg(data);
    return await doc.embedPng(data);
  } catch {
    return null;
  }
}

function partLabel(product: ProductDefinition, partId: string) {
  return product.parts.find((p) => p.id === partId)?.label ?? partId;
}

/** Standard fonts are Latin-1 only; keep long strings inside the page too. */
function truncate(text: string, max: number) {
  const clean = text.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
  return clean.length > max ? `${clean.slice(0, max - 1)}…`.replace('…', '...') : clean;
}

function hexToRgb(hex: string) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
