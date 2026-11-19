/**
 * Shopify integration payloads.
 *
 * Two things are built here:
 *  1. A cart request (`/cart/add.js` shape) - variant, quantity, plus line-item
 *     properties carrying the full design. Properties prefixed `_` are hidden
 *     from the storefront cart UI but still reach the order.
 *  2. Order attributes with the design id + quote id, so a webhook or the
 *     fulfilment team can fetch the print files by id.
 *
 * The shape mirrors the reference configurator's payload so this engine can be
 * dropped behind the same Shopify bridge without storefront changes.
 */
import type { CartPayload, CustomerConfiguration, Quote, ShopifyPropertyLine } from './types';

export interface DesignArtifacts {
  /** Signed URLs (or data URLs in local mode) for the generated renders. */
  files: Array<{ kind: 'print-file' | 'design-preview' | 'uv-layout' | 'view-front' | 'view-back' | 'view-left' | 'view-right' | 'configuration-pdf'; name: string; url: string; bytes: number; mime: string }>;
}

export function buildLineItemProperties(
  config: CustomerConfiguration,
  quote: Quote,
  artifacts: DesignArtifacts,
): ShopifyPropertyLine[] {
  const tier = config.tierId;
  const panelColors: Record<string, string> = {};
  for (const [partId, part] of Object.entries(config.parts)) {
    panelColors[partId] = part.color.pantone;
  }
  const textLayers = Object.entries(config.parts).flatMap(([partId, part]) =>
    part.layers
      .filter((l) => l.type === 'text')
      .map((l) => `${partId}: ${(l as { text: string }).text}`),
  );

  const props: ShopifyPropertyLine[] = [
    { key: 'Tent Size', value: config.size.label },
    { key: 'Design ID', value: config.designId },
    { key: 'Quote ID', value: quote.quoteId },
    { key: 'Base Setup', value: tier },
    { key: 'Add-ons', value: config.selectedAddons.join(', ') || 'None' },
    { key: 'Panel Colors', value: JSON.stringify(panelColors) },
    { key: 'Design Text', value: JSON.stringify(textLayers) },
    { key: 'Unit Price', value: `${quote.currency} ${quote.total.toFixed(2)}` },
  ];

  for (const file of artifacts.files) {
    props.push({ key: labelFor(file.kind), value: file.url });
  }
  return props;
}

function labelFor(kind: DesignArtifacts['files'][number]['kind']): string {
  switch (kind) {
    case 'print-file':
      return 'Print File';
    case 'design-preview':
      return 'Design Preview';
    case 'uv-layout':
      return 'UV Layout';
    case 'configuration-pdf':
      return 'Configuration PDF';
    default:
      return kind.replace('view-', '') .replace(/^./, (c) => c.toUpperCase()) + ' View';
  }
}

/** Convert the labelled property list into Shopify's `properties` object. */
export function propertiesToObject(lines: ShopifyPropertyLine[]): Record<string, string> {
  return Object.fromEntries(lines.map((l) => [l.key, l.value]));
}

export function buildCartPayload(
  config: CustomerConfiguration,
  quote: Quote,
  variantId: string,
  artifacts: DesignArtifacts,
  quantity = 1,
): CartPayload {
  const props = propertiesToObject(buildLineItemProperties(config, quote, artifacts));
  return {
    items: [{ variantId, quantity, properties: props }],
    attributes: {
      design_id: config.designId,
      quote_id: quote.quoteId,
      product_id: config.productId,
      configurator: 'tent-configurator@1',
    },
    // Surcharges that are not a variant on the Shopify product. In production
    // these map to hidden "customization" variants; a CartTransform bundles them.
    addonLines: quote.lines
      .filter((l) => l.kind === 'customization' && l.amount > 0)
      .map((l) => ({ title: l.label, priceCents: Math.round(l.amount * 100), quantity })),
    quoteId: quote.quoteId,
  };
}
