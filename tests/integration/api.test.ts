/**
 * Integration test: the full customer journey against the real mock API.
 *
 * Start the API (`npm run dev -w @tent/api`) then run `npm run test:integration`.
 * It exercises the same calls the iframe and storefront make, so a green run
 * means quote -> save -> PDF -> cart payload works end to end.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCartPayload,
  createConfiguration,
  designStatsFor,
  getProduct,
  quoteFromRequest,
  DEFAULT_RULES,
  type CustomerConfiguration,
} from '../../packages/core/src/index';

const API = process.env.API_BASE ?? 'http://localhost:8787';
const product = getProduct('tent-10x10')!;

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
}

function designed(): CustomerConfiguration {
  const config = createConfiguration({ productId: product.id, tierId: 'with-frame', selectedAddons: ['wall-double-1'] });
  config.parts['roof']!.layers.push({
    id: 'text-1', type: 'text', partId: 'roof', text: 'ACME', x: 900, y: 800,
    fontSize: 320, fontFamily: 'Inter', fill: '#ffffff', rotation: 0, opacity: 1,
    visible: true, align: 'center', letterSpacing: 0,
  });
  return config;
}

describe('API integration', () => {
  it('serves the catalogue and per-product pricing rules', async () => {
    const health = await fetch(`${API}/health`).then((r) => r.json());
    expect(health.ok).toBe(true);
    const rules = await fetch(`${API}/pricing/${product.id}`).then((r) => r.json());
    expect(rules.rules.customizationPerPart).toBe(DEFAULT_RULES.customizationPerPart);
  });

  it('quotes a design server-side, matching local rules', async () => {
    const config = designed();
    const { status, json } = await post('/quote', { config, quantity: 1 });
    expect(status).toBe(200);
    const local = quoteFromRequest(product, {
      productId: product.id, tierId: config.tierId, sizeLabel: config.size.label,
      selectedAddons: config.selectedAddons, designStats: designStatsFor(config), quantity: 1,
    });
    expect(json.quote.totalCents).toBe(local.totalCents);
    expect(json.quote.lines.some((l: { code: string }) => l.code === 'custom:double-sided')).toBe(true);
  });

  it('ignores add-ons the product does not offer (tampered client)', async () => {
    const config = designed();
    config.selectedAddons = ['wall-double-1', 'not-a-real-addon'];
    const { json } = await post('/quote', { config, quantity: 1 });
    expect(json.quote.lines.some((l: { code: string }) => l.code.includes('not-a-real-addon'))).toBe(false);
    expect(json.config.selectedAddons).toEqual(['wall-double-1']);
  });

  it('rejects a cart quote mismatch (price tampering)', async () => {
    const config = designed();
    const { status, json } = await post('/orders', {
      config,
      renders: {},
      quoteId: 'q_fake',
      customer: { name: 'Test' },
    });
    expect(status).toBe(409);
    expect(json.error).toMatch(/Quote expired/);
  });

  it('stores a design and returns a valid PDF', async () => {
    const config = designed();
    const stored = await post(`/designs/${config.designId}/renders`, { config, renders: {} });
    expect(stored.status).toBe(200);

    const res = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, renders: {}, customer: { name: 'Test' } }),
    });
    expect(res.status).toBe(200);
    const order = await res.json();
    expect(order.totalCents).toBeGreaterThan(0);

    const pdf = await fetch(`${API}/orders/${order.orderId}/pdf`);
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    // PDF magic number + non-trivial size.
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it('builds a Shopify cart payload from the saved design', async () => {
    const config = designed();
    const res = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, renders: {}, customer: { name: 'Test' } }),
    });
    const order = await res.json();
    const quote = quoteFromRequest(product, {
      productId: product.id, tierId: config.tierId, sizeLabel: config.size.label,
      selectedAddons: config.selectedAddons, designStats: designStatsFor(config), quantity: 1,
    });
    const payload = buildCartPayload(config, quote, 'gid://shopify/ProductVariant/123', {
      files: [{ kind: 'configuration-pdf', name: 'c.pdf', url: order.pdfUrl, bytes: 1, mime: 'application/pdf' }],
    });
    expect(payload.items[0]!.properties['Design ID']).toBe(config.designId);
    expect(payload.items[0]!.properties['Configuration PDF']).toContain('/pdf');
    expect(payload.attributes.design_id).toBe(config.designId);
    expect(payload.addonLines.length).toBeGreaterThan(0);
  });
});
