/**
 * Mock pricing / CRM service.
 *
 * Everything the UI needs to know about money goes through here, so the UI has
 * no price literals. Rules live in a JSON-shaped store that a real deployment
 * would load from a pricing admin or ERP; `GET /pricing/:productId` exposes it
 * so a merchant can see (and later edit) the rule set.
 *
 * Endpoints
 *   GET  /health
 *   GET  /products                    catalogue (public subset)
 *   GET  /products/:id                full definition incl. tiers/addons
 *   GET  /pricing/:id                 active pricing rules + addon prices
 *   POST /quote                       { config, quantity } -> Quote (authoritative)
 *   POST /orders                      persist configuration + attach PDF (CRM mock)
 *   GET  /orders/:id                  retrieve
 *   POST /designs/:id/pdf             build the production PDF from stored renders
 *   POST /uploads                     image upload (returns asset id)
 *   GET  /uploads/:id                 serve the uploaded image
 */
import express from 'express';
import cors from 'cors';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_RULES,
  PRODUCTS,
  designStatsFor,
  getProduct,
  quoteFromRequest,
  visiblePartIds,
  type CustomerConfiguration,
  type PriceRequest,
  type PricingRules,
} from '@tent/core';
import { buildConfigurationPdf, type PdfAssets } from './pdf.js';

/**
 * Serverless platforms mount the app read-only, so storage falls back to a
 * writable temp directory when no DATA_DIR is provided.
 */
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/tent-data' : join(process.cwd(), '.data'));
const UPLOAD_DIR = join(DATA_DIR, 'uploads');

export const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? true }));
// Renders arrive as base64 PNGs, so allow larger bodies than a normal JSON API.
app.use(express.json({ limit: '40mb' }));

// Serverless imports never call start(), so create storage lazily on first use.
const ready = Promise.all([mkdir(UPLOAD_DIR, { recursive: true }), mkdir(join(DATA_DIR, 'orders'), { recursive: true })]);
app.use((_req, _res, next) => {
  void ready.then(() => next());
});

/** Per-product rule overrides; falls back to defaults. */
const RULES_BY_PRODUCT: Record<string, Partial<PricingRules>> = {
  'tent-10x20': { customizationPerPart: 16, doubleSidedSurcharge: 24 },
  'tent-5x5': { customizationPerPart: 9, doubleSidedSurcharge: 14 },
};

function rulesFor(productId: string): PricingRules {
  return { ...DEFAULT_RULES, ...RULES_BY_PRODUCT[productId] };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, products: PRODUCTS.length, now: new Date().toISOString() });
});

app.get('/products', (_req, res) => {
  res.json(
    PRODUCTS.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      canopy: p.canopy,
      tiers: p.tiers,
      addons: p.addons,
    })),
  );
});

app.get('/products/:id', (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Unknown product' });
  res.json(product);
});

app.get('/pricing/:id', (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Unknown product' });
  res.json({ productId: product.id, currency: product.currency, rules: rulesFor(product.id), addons: product.addons });
});

/**
 * Authoritative quote. The client's `designStats` is recomputed from the
 * configuration so a tampered client cannot fake a cheaper design.
 */
app.post('/quote', (req, res) => {
  const body = req.body as { config?: CustomerConfiguration; quantity?: number };
  const config = body.config;
  if (!config || config.schemaVersion !== 1) return res.status(400).json({ error: 'Invalid configuration' });
  const product = getProduct(config.productId);
  if (!product) return res.status(404).json({ error: 'Unknown product' });

  // Only add-ons that the product actually offers are priced.
  const allowedAddons = config.selectedAddons.filter((id) => product.addons.some((a) => a.id === id));
  // Only parts exposed by the current add-ons contribute design charges.
  const visible = new Set(visiblePartIds(product, allowedAddons));
  const scoped: CustomerConfiguration = {
    ...config,
    selectedAddons: allowedAddons,
    parts: Object.fromEntries(Object.entries(config.parts).filter(([id]) => visible.has(id))),
  };

  const priceRequest: PriceRequest = {
    productId: product.id,
    tierId: product.tiers.some((t) => t.id === config.tierId) ? config.tierId : product.tiers[0].id,
    sizeLabel: config.size.label,
    selectedAddons: allowedAddons,
    designStats: designStatsFor(scoped),
    quantity: Math.max(1, Math.min(99, Math.floor(body.quantity ?? 1))),
  };
  const quote = quoteFromRequest(product, priceRequest, rulesFor(product.id));
  res.json({ quote, config: scoped });
});

// --- uploads ---------------------------------------------------------------
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const MAX_UPLOAD = 10 * 1024 * 1024;

app.post('/uploads', async (req, res) => {
  const { dataUrl, name } = req.body as { dataUrl?: string; name?: string };
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'Expected a base64 data URL' });
  const mime = m[1];
  if (!IMAGE_MIME.has(mime)) return res.status(415).json({ error: `Unsupported type ${mime}` });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.byteLength > MAX_UPLOAD) return res.status(413).json({ error: 'File over 10 MB' });
  const id = createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const ext = mime === 'image/svg+xml' ? 'svg' : mime.split('/')[1];
  const file = join(UPLOAD_DIR, `${id}.${ext}`);
  await writeFile(file, buf);
  res.json({ id, url: `/uploads/${id}.${ext}`, mime, bytes: buf.byteLength, name: name ?? `${id}.${ext}` });
});

app.get('/uploads/:id', async (req, res) => {
  const safe = req.params.id.replace(/[^a-f0-9.]+/gi, '');
  const file = join(UPLOAD_DIR, safe);
  try {
    const data = await readFile(file);
    const ext = safe.split('.').pop();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(data);
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// --- designs + orders ------------------------------------------------------
interface StoredDesign {
  designId: string;
  config: CustomerConfiguration;
  renders: Record<string, string>; // data URLs
  createdAt: string;
}
const designs = new Map<string, StoredDesign>();
interface StoredOrder {
  orderId: string;
  shopifyOrderId?: string;
  customer?: { name?: string; email?: string; company?: string };
  quoteId: string;
  totalCents: number;
  currency: string;
  pdfPath: string;
  config: CustomerConfiguration;
  createdAt: string;
}
const orders = new Map<string, StoredOrder>();

app.post('/designs/:id/renders', async (req, res) => {
  const { config, renders } = req.body as { config?: CustomerConfiguration; renders?: Record<string, string> };
  if (!config) return res.status(400).json({ error: 'Missing config' });
  const design: StoredDesign = {
    designId: req.params.id,
    config,
    renders: sanitizeRenders(renders ?? {}),
    createdAt: new Date().toISOString(),
  };
  designs.set(design.designId, design);
  await writeFile(join(DATA_DIR, 'orders', `${design.designId}.design.json`), JSON.stringify(design));
  res.json({ ok: true, designId: design.designId, files: Object.keys(design.renders) });
});

function sanitizeRenders(renders: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(renders)) {
    if (/^[a-z0-9-]+\.(png|jpe?g)$/i.test(k) && typeof v === 'string' && /^data:image\/(png|jpeg);base64,/.test(v)) {
      out[k] = v;
    }
  }
  return out;
}

app.get('/designs/:id', async (req, res) => {
  const id = req.params.id;
  if (designs.has(id)) return res.json(designs.get(id));
  try {
    const raw = await readFile(join(DATA_DIR, 'orders', `${id}.design.json`), 'utf8');
    res.json(JSON.parse(raw));
  } catch {
    res.status(404).json({ error: 'Unknown design' });
  }
});

/**
 * Builds the PDF. Accepts the config + renders in the body (the configurator's
 * normal flow, where images live client-side) or falls back to a stored design.
 */
app.post('/designs/:id/pdf', async (req, res) => {
  try {
    const body = req.body as {
      config?: CustomerConfiguration;
      renders?: Record<string, string>;
      customer?: { name?: string; email?: string; company?: string };
      quantity?: number;
    };
    let config = body.config;
    let renders = body.renders;
    if (!config) {
      const stored = designs.get(req.params.id) ?? JSON.parse(await readFile(join(DATA_DIR, 'orders', `${req.params.id}.design.json`), 'utf8'));
      config = stored.config;
      renders = stored.renders;
    }
    if (!config) return res.status(400).json({ error: 'Missing config' });
    const product = getProduct(config.productId);
    if (!product) return res.status(404).json({ error: 'Unknown product' });

    const quote = quoteFromRequest(product, {
      productId: product.id,
      tierId: config.tierId,
      sizeLabel: config.size.label,
      selectedAddons: config.selectedAddons,
      designStats: designStatsFor(config),
      quantity: Math.max(1, Math.floor(body.quantity ?? 1)),
    }, rulesFor(product.id));

    const assets: PdfAssets = {};
    for (const [name, dataUrl] of Object.entries(sanitizeRenders(renders ?? {}))) {
      assets[name] = Buffer.from(dataUrl.split(',')[1], 'base64');
    }

    const pdf = await buildConfigurationPdf({ config, product, quote, assets, customer: body.customer });
    await writeFile(join(DATA_DIR, 'orders', `${config.designId}.pdf`), pdf);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${config.designId}-configuration.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF generation failed', detail: String((err as Error).message) });
  }
});

app.post('/orders', async (req, res) => {
  const body = req.body as {
    config?: CustomerConfiguration;
    renders?: Record<string, string>;
    quoteId?: string;
    totalCents?: number;
    currency?: string;
    customer?: { name?: string; email?: string; company?: string };
    shopifyOrderId?: string;
    quantity?: number;
  };
  if (!body.config) return res.status(400).json({ error: 'Missing config' });
  const product = getProduct(body.config.productId);
  if (!product) return res.status(404).json({ error: 'Unknown product' });

  // Re-price server-side: the cart never decides the amount.
  const quote = quoteFromRequest(product, {
    productId: product.id,
    tierId: body.config.tierId,
    sizeLabel: body.config.size.label,
    selectedAddons: body.config.selectedAddons,
    designStats: designStatsFor(body.config),
    quantity: Math.max(1, Math.floor(body.quantity ?? 1)),
  }, rulesFor(product.id));
  if (body.quoteId && body.quoteId !== quote.quoteId) {
    return res.status(409).json({ error: 'Quote expired or does not match this design', expected: quote.quoteId });
  }

  const assets: PdfAssets = {};
  for (const [name, dataUrl] of Object.entries(sanitizeRenders(body.renders ?? {}))) {
    assets[name] = Buffer.from(dataUrl.split(',')[1], 'base64');
  }
  const pdf = await buildConfigurationPdf({ config: body.config, product, quote, assets, customer: body.customer });
  const orderId = `CRM-${randomUUID().slice(0, 8).toUpperCase()}`;
  const pdfPath = join(DATA_DIR, 'orders', `${body.config.designId}.pdf`);
  await writeFile(pdfPath, pdf);

  const order: StoredOrder = {
    orderId,
    shopifyOrderId: body.shopifyOrderId,
    customer: body.customer,
    quoteId: quote.quoteId,
    totalCents: quote.totalCents,
    currency: quote.currency,
    pdfPath,
    config: body.config,
    createdAt: new Date().toISOString(),
  };
  orders.set(orderId, order);
  await writeFile(join(DATA_DIR, 'orders', `${orderId}.json`), JSON.stringify(order, null, 2));
  res.json({ ...order, total: quote.total, pdfUrl: `/orders/${orderId}/pdf` });
});

app.get('/orders', (_req, res) => {
  res.json([...orders.values()].map(({ config: _c, ...rest }) => rest));
});

app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Unknown order' });
  res.json({ ...order, total: order.totalCents / 100, pdfUrl: `/orders/${order.orderId}/pdf` });
});

app.get('/orders/:id/pdf', async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Unknown order' });
  const info = await stat(order.pdfPath);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(info.size));
  res.setHeader('Content-Disposition', `attachment; filename="${order.config.designId}-configuration.pdf"`);
  res.send(await readFile(order.pdfPath));
});

// A webhook stub showing where Shopify order data would arrive.
app.post('/webhooks/shopify/orders-create', async (req, res) => {
  const order = req.body as { id?: number; note_attributes?: Array<{ name: string; value: string }> };
  const designId = order.note_attributes?.find((a) => a.name === 'design_id')?.value;
  console.log(`[shopify] order ${order.id} created - design ${designId ?? 'unknown'}`);
  if (designId) {
    try {
      const raw = await readFile(join(DATA_DIR, 'orders', `${designId}.design.json`), 'utf8');
      await writeFile(join(DATA_DIR, 'orders', `shopify-${order.id}.json`), raw);
    } catch {
      /* design may not have been synced; nothing to attach */
    }
  }
  res.json({ received: true });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

export default app;
