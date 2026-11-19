/**
 * Pricing rules.
 *
 * The UI never computes money itself: it asks the pricing service (see
 * apps/api) and renders whatever the service returns. These helpers encode the
 * *rules* so the mock API and the tests share one implementation, and a real
 * backend can port them or replace them wholesale.
 */
import type {
  AddonDefinition,
  CustomerConfiguration,
  PriceRequest,
  ProductDefinition,
  Quote,
  QuoteLine,
} from './types';

export interface PricingRules {
  currency: string;
  /** Surcharge applied per distinguishable customised part (setup + labour). */
  customizationPerPart: number;
  /** Extra surcharge for double-sided walls (second print run). */
  doubleSidedSurcharge: number;
  /** Extra surcharge for light-up frames (LED kit + wiring). */
  lightUpSurcharge: number;
  /** Free shipping above this subtotal; otherwise flat rate applies. */
  freeShippingAbove: number;
  shippingFlat: number;
}

export const DEFAULT_RULES: PricingRules = {
  currency: 'USD',
  customizationPerPart: 12,
  doubleSidedSurcharge: 18,
  lightUpSurcharge: 95,
  freeShippingAbove: 600,
  shippingFlat: 39,
};

/** Describe the customisation facts a pricing request needs from a configuration. */
export function designStatsFor(config: CustomerConfiguration) {
  const parts = Object.values(config.parts);
  let uploadedImages = 0;
  let textLayers = 0;
  let printedParts = 0;
  let doubleSidedParts = 0;
  for (const p of parts) {
    if (p.layers.length > 0) printedParts += 1;
    for (const l of p.layers) {
      if (l.type === 'image') uploadedImages += 1;
      if (l.type === 'text') textLayers += 1;
    }
    if (p.printMode === 'double') doubleSidedParts += 1;
  }
  return { uploadedImages, textLayers, printedParts, doubleSidedParts };
}

export function quoteFromRequest(
  product: ProductDefinition,
  req: PriceRequest,
  rules: PricingRules = DEFAULT_RULES,
): Quote {
  const lines: QuoteLine[] = [];
  const tier = product.tiers.find((t) => t.id === req.tierId) ?? product.tiers[0];
  lines.push({ code: `tier:${tier.id}`, label: tier.label, amount: tier.price, kind: 'base' });

  for (const addonId of req.selectedAddons) {
    const addon = product.addons.find((a: AddonDefinition) => a.id === addonId);
    if (!addon) continue;
    lines.push({ code: `addon:${addon.id}`, label: addon.label, amount: addon.price, kind: 'addon' });
  }

  if (tier.features?.includes('light-up')) {
    lines.push({
      code: 'custom:light-up',
      label: 'Light-up frame kit',
      amount: rules.lightUpSurcharge,
      kind: 'customization',
    });
  }

  const { printedParts, doubleSidedParts, uploadedImages, textLayers } = req.designStats;
  if (printedParts > 0) {
    lines.push({
      code: 'custom:print-setup',
      label: `Artwork setup - ${printedParts} part${printedParts > 1 ? 's' : ''}`,
      amount: printedParts * rules.customizationPerPart,
      kind: 'customization',
    });
  }
  if (doubleSidedParts > 0) {
    lines.push({
      code: 'custom:double-sided',
      label: `Double-sided printing - ${doubleSidedParts} part${doubleSidedParts > 1 ? 's' : ''}`,
      amount: doubleSidedParts * rules.doubleSidedSurcharge,
      kind: 'customization',
    });
  }
  if (uploadedImages > 0) {
    lines.push({
      code: 'custom:artwork-review',
      label: `Artwork review - ${uploadedImages} uploaded file${uploadedImages > 1 ? 's' : ''}`,
      amount: 0,
      kind: 'customization',
    });
  }
  if (uploadedImages === 0 && textLayers === 0) {
    lines.push({
      code: 'custom:blank',
      label: 'Blank canopy - no custom artwork',
      amount: 0,
      kind: 'customization',
    });
  }

  const qty = Math.max(1, Math.floor(req.quantity || 1));
  const perUnit = lines.reduce((sum, l) => sum + l.amount, 0);
  if (qty > 1) {
    // Quantity discounts step down over 3 / 10 units.
    const rate = qty >= 10 ? 0.12 : qty >= 3 ? 0.06 : 0;
    if (rate > 0) {
      lines.push({
        code: `discount:qty-${qty}`,
        label: `Volume discount (${Math.round(rate * 100)}%)`,
        amount: -Math.round(perUnit * rate * qty),
        kind: 'discount',
      });
    }
  }
  for (const line of lines) {
    if (line.kind === 'customization' || line.kind === 'base' || line.kind === 'addon') {
      line.amount = line.amount * qty;
    }
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const shipping = subtotal >= rules.freeShippingAbove ? 0 : rules.shippingFlat;
  lines.push({ code: 'shipping', label: shipping === 0 ? 'Shipping (free)' : 'Shipping', amount: shipping, kind: 'shipping' });

  const total = subtotal + shipping;
  return {
    currency: rules.currency,
    subtotal,
    lines,
    total,
    totalCents: Math.round(total * 100),
    quoteId: quoteIdFor(product.id, req, total),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic id so an identical request yields an identical quote - useful
 * for caching in front of the pricing service and for cart verification.
 */
export function quoteIdFor(productId: string, req: PriceRequest, total: number): string {
  const sig = [
    productId,
    req.tierId,
    req.sizeLabel,
    [...req.selectedAddons].sort().join(','),
    Object.values(req.designStats).join(','),
    req.quantity,
    total,
  ].join('|');
  return `q_${hash32(sig).toString(36)}`;
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
