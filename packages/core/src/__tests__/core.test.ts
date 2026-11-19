import { describe, expect, it } from 'vitest';
import {
  buildLayout,
  createConfiguration,
  DEFAULT_RULES,
  designStatsFor,
  getProduct,
  quoteFromRequest,
  reconcileParts,
  roofSlant,
  visiblePartIds,
  buildCartPayload,
  buildLineItemProperties,
  propertiesToObject,
} from '../index';

const product = getProduct('tent-10x10')!;

describe('layout', () => {
  it('is deterministic for the same inputs', () => {
    const a = buildLayout(product, ['roof', 'wall-front']);
    const b = buildLayout(product, ['roof', 'wall-front']);
    expect(a).toEqual(b);
  });

  it('prints four roof faces side by side on one strip', () => {
    const layout = buildLayout(product, ['roof']);
    const peak = layout.pieces.find((p) => p.partId === 'roof')!;
    // width + depth + width + depth, each face spanning the full slant.
    expect(peak.box.width).toBeCloseTo((product.canopy.width + product.canopy.depth) * 2);
    expect(peak.box.height).toBeCloseTo(roofSlant(product));
    // Sawtooth outline: start corner + apex/eave pairs for each of the 4 faces.
    expect(peak.points).toHaveLength(9);
    // Three distinct heights: apex row, eave row, opposite apex row.
    const ys = [...new Set(peak.points.map((p) => Math.round(p.y)))];
    expect(ys).toHaveLength(3);
    // Ordered front, right, back, left with matching spans.
    const cornerXs = peak.points.map((p) => p.x);
    const spans = [1, 3, 5, 7].map((i) => Math.round(cornerXs[i]! - cornerXs[i - 1]!));
    expect(spans).toEqual([
      Math.round(product.canopy.width),
      Math.round(product.canopy.depth),
      Math.round(product.canopy.width),
      Math.round(product.canopy.depth),
    ]);
  });

  it('prints one valance strip per side', () => {
    const layout = buildLayout(product, ['valance-front', 'valance-left']);
    const front = layout.pieces.find((p) => p.partId === 'valance-front')!;
    const left = layout.pieces.find((p) => p.partId === 'valance-left')!;
    expect(front.box.width).toBeCloseTo(product.canopy.width);
    expect(left.box.width).toBeCloseTo(product.canopy.depth);
  });

  it('grows the flat lay for wider tents', () => {
    const ten = buildLayout(product, ['roof', 'wall-front']);
    const twenty = buildLayout(getProduct('tent-10x20')!, ['roof', 'wall-front']);
    // The roof strip and the longer wall both grow the artboard.
    expect(twenty.widthMm).toBeGreaterThan(ten.widthMm);
    expect(twenty.heightMm).toBeGreaterThan(ten.heightMm);
  });

  it('keeps every piece inside the canvas', () => {
    const layout = buildLayout(product, ['roof', 'wall-front', 'halfwall-front']);
    for (const piece of layout.pieces) {
      for (const pt of piece.points) {
        expect(pt.x).toBeGreaterThanOrEqual(0);
        expect(pt.x).toBeLessThanOrEqual(layout.widthMm + 0.001);
        expect(pt.y).toBeGreaterThanOrEqual(0);
        expect(pt.y).toBeLessThanOrEqual(layout.heightMm + 0.001);
      }
    }
  });
});

describe('config reconciliation', () => {
  it('adds and removes parts as add-ons change, preserving artwork', () => {
    let config = createConfiguration({ productId: 'tent-10x10', selectedAddons: ['wall-single-1'] });
    expect(Object.keys(config.parts)).toContain('wall-front');
    config.parts['wall-front']!.layers.push({
      id: 't1', type: 'text', partId: 'wall-front', text: 'ACME', x: 10, y: 10,
      fontSize: 100, fontFamily: 'Inter', fill: '#000', rotation: 0, opacity: 1, visible: true, align: 'center', letterSpacing: 0,
    });

    config = reconcileParts({ ...config, selectedAddons: ['wall-single-3'] }, product);
    expect(Object.keys(config.parts)).toEqual(expect.arrayContaining(['wall-front', 'wall-left', 'wall-back']));
    expect(config.parts['wall-front']!.layers).toHaveLength(1);

    config = reconcileParts({ ...config, selectedAddons: [] }, product);
    // Only the always-present roof + valance strips remain.
    expect(Object.keys(config.parts).sort()).toEqual(
      ['roof', 'valance-back', 'valance-front', 'valance-left', 'valance-right'].sort(),
    );
  });

  it('maps add-ons to visible parts without duplicates', () => {
    expect(visiblePartIds(product, ['wall-single-1', 'wall-single-3'])).toEqual([
      'roof', 'valance-front', 'valance-right', 'valance-back', 'valance-left',
      'wall-front', 'wall-left', 'wall-back',
    ]);
  });

  it('applies double-sided print mode from add-ons', () => {
    const config = createConfiguration({ productId: 'tent-10x10', selectedAddons: ['wall-double-1'] });
    expect(config.parts['wall-front']!.printMode).toBe('double');
  });
});

describe('pricing', () => {
  it('prices the tier, add-ons and per-part customisation', () => {
    const config = createConfiguration({ productId: 'tent-10x10', tierId: 'with-frame', selectedAddons: ['wall-double-1'] });
    config.parts['wall-front']!.layers.push({
      id: 'i1', type: 'image', partId: 'wall-front', src: 'blob:x', x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, visible: true, clipToPart: true,
    });
    const quote = quoteFromRequest(product, {
      productId: product.id, tierId: config.tierId, sizeLabel: config.size.label,
      selectedAddons: config.selectedAddons, designStats: designStatsFor(config), quantity: 1,
    });
    const tier = product.tiers.find((t) => t.id === 'with-frame')!.price;
    const addon = product.addons.find((a) => a.id === 'wall-double-1')!.price;
    expect(quote.lines.find((l) => l.kind === 'base')!.amount).toBe(tier);
    expect(quote.lines.find((l) => l.kind === 'addon')!.amount).toBe(addon);
    expect(quote.lines.some((l) => l.code === 'custom:print-setup' && l.amount === DEFAULT_RULES.customizationPerPart)).toBe(true);
    expect(quote.lines.some((l) => l.code === 'custom:double-sided')).toBe(true);
    expect(quote.totalCents).toBe(Math.round(quote.total * 100));
  });

  it('is deterministic for identical requests (cacheable quote ids)', () => {
    const req = {
      productId: product.id, tierId: 'with-frame', sizeLabel: '10x10', selectedAddons: ['weight-bags'],
      designStats: { uploadedImages: 0, textLayers: 0, printedParts: 0, doubleSidedParts: 0 }, quantity: 1,
    };
    expect(quoteFromRequest(product, req).quoteId).toBe(quoteFromRequest(product, req).quoteId);
  });

  it('applies volume discounts above 3 units', () => {
    const base = {
      productId: product.id, tierId: 'with-frame', sizeLabel: '10x10', selectedAddons: [],
      designStats: { uploadedImages: 0, textLayers: 0, printedParts: 0, doubleSidedParts: 0 },
    };
    const one = quoteFromRequest(product, { ...base, quantity: 1 });
    const five = quoteFromRequest(product, { ...base, quantity: 5 });
    expect(five.lines.some((l) => l.kind === 'discount')).toBe(true);
    expect(five.total).toBeLessThan(one.total * 5);
  });

  it('charges a light-up surcharge for the light-up tier', () => {
    const config = createConfiguration({ productId: 'tent-10x10', tierId: 'light-up' });
    const quote = quoteFromRequest(product, {
      productId: product.id, tierId: config.tierId, sizeLabel: config.size.label, selectedAddons: [],
      designStats: designStatsFor(config), quantity: 1,
    });
    expect(quote.lines.some((l) => l.code === 'custom:light-up')).toBe(true);
  });
});

describe('shopify payload', () => {
  it('carries design identity, colours and files as line-item properties', () => {
    const config = createConfiguration({ productId: 'tent-10x10', selectedAddons: ['wall-single-1'] });
    const quote = quoteFromRequest(product, {
      productId: product.id, tierId: config.tierId, sizeLabel: config.size.label,
      selectedAddons: config.selectedAddons, designStats: designStatsFor(config), quantity: 1,
    });
    const artifacts = {
      files: [
        { kind: 'print-file' as const, name: 'print-file.png', url: 'https://x/print.png', bytes: 10, mime: 'image/png' },
        { kind: 'configuration-pdf' as const, name: 'c.pdf', url: 'https://x/c.pdf', bytes: 10, mime: 'application/pdf' },
      ],
    };
    const payload = buildCartPayload(config, quote, 'gid://shopify/ProductVariant/1', artifacts);
    expect(payload.items[0]!.variantId).toBe('gid://shopify/ProductVariant/1');
    const props = payload.items[0]!.properties;
    expect(props['Design ID']).toBe(config.designId);
    expect(props['Print File']).toBe('https://x/print.png');
    expect(props['Configuration PDF']).toBe('https://x/c.pdf');
    expect(JSON.parse(props['Panel Colors']!).roof).toBeTruthy();
    expect(payload.attributes.design_id).toBe(config.designId);
  });

  it('keeps duplicate property keys from clobbering each other', () => {
    const lines = buildLineItemProperties(
      createConfiguration({ productId: 'tent-10x10' }),
      { currency: 'USD', subtotal: 0, lines: [], total: 0, totalCents: 0, quoteId: 'q', generatedAt: '' },
      { files: [] },
    );
    const keys = lines.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(propertiesToObject(lines)).length).toBe(keys.length);
  });
});
