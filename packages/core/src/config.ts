/**
 * Configuration document helpers: creation, defaults, validation and
 * normalisation. Kept pure so the server can revalidate anything the client
 * sends (never trust a client config).
 */
import { defaultColorFor, getProduct } from './catalogue';
import type {
  CustomerConfiguration,
  Layer,
  PartConfig,
  PrintMode,
  ProductDefinition,
} from './types';

export function newDesignId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `T-${s}`;
}

/**
 * Which parts are present for a given set of add-ons. This is the bridge
 * between commerce (what the customer bought) and design (what they can print).
 */
export function visiblePartIds(product: ProductDefinition, selectedAddons: string[]): string[] {
  const offered = (id: string) => product.addons.some((a) => a.id === id);
  const ids = ['roof', 'valance-front', 'valance-right', 'valance-back', 'valance-left'];
  const has = (id: string) => selectedAddons.includes(id);
  if (offered('wall-single-1') && (has('wall-single-1') || has('wall-double-1'))) ids.push('wall-front');
  if (offered('wall-single-3') && (has('wall-single-3') || has('wall-double-3'))) ids.push('wall-front', 'wall-left', 'wall-back');
  if (offered('halfwall-single') && (has('halfwall-single') || has('halfwall-double'))) ids.push('halfwall-front', 'halfwall-back');
  return [...new Set(ids)];
}

export function printModeForPart(
  product: ProductDefinition,
  partId: string,
  selectedAddons: string[],
): PrintMode {
  const part = product.parts.find((p) => p.id === partId);
  if (!part || part.kind !== 'wall' && part.kind !== 'half-wall') return 'single';
  const db = (id: string) => selectedAddons.includes(id);
  if (part.kind === 'wall') return db('wall-double-1') || db('wall-double-3') ? 'double' : 'single';
  return db('halfwall-double') ? 'double' : 'single';
}

export function createConfiguration(opts: {
  productId: string;
  tierId?: string;
  selectedAddons?: string[];
}): CustomerConfiguration {
  const product = getProduct(opts.productId);
  if (!product) throw new Error(`Unknown product ${opts.productId}`);
  const tier = product.tiers.find((t) => t.id === opts.tierId) ?? product.tiers[0];
  const addons = opts.selectedAddons ?? [];
  const parts: Record<string, PartConfig> = {};
  for (const partId of visiblePartIds(product, addons)) {
    const def = product.parts.find((p) => p.id === partId)!;
    parts[partId] = {
      partId,
      color: defaultColorFor(def),
      layers: [],
      printMode: printModeForPart(product, partId, addons),
    };
  }
  return {
    schemaVersion: 1,
    designId: newDesignId(),
    productId: product.id,
    tierId: tier.id,
    size: {
      widthMm: product.canopy.width,
      depthMm: product.canopy.depth,
      label: product.name.match(/^([\d.]+x[\d.]+)/)?.[1] ?? product.id,
    },
    selectedAddons: addons,
    parts,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Reconcile a config against the product after add-ons change: add parts that
 * became visible, drop parts that were deselected, and keep all artwork and
 * colours already placed. This is what makes the product sections
 * "independently customisable" without losing work.
 */
export function reconcileParts(
  config: CustomerConfiguration,
  product: ProductDefinition,
): CustomerConfiguration {
  const wanted = visiblePartIds(product, config.selectedAddons);
  const parts: Record<string, PartConfig> = {};
  for (const partId of wanted) {
    const existing = config.parts[partId];
    const def = product.parts.find((p) => p.id === partId)!;
    parts[partId] = existing
      ? { ...existing, printMode: printModeForPart(product, partId, config.selectedAddons) }
      : {
          partId,
          color: defaultColorFor(def),
          layers: [],
          printMode: printModeForPart(product, partId, config.selectedAddons),
        };
  }
  // Keep designs for hidden parts so re-adding a wall restores its artwork.
  const removed: Record<string, PartConfig> = {};
  for (const [id, part] of Object.entries(config.parts)) {
    if (!parts[id]) removed[id] = part;
  }
  return {
    ...config,
    parts,
    // Stash deselect-ed parts in a non-rendered bucket; pruning happens on save.
    ...(Object.keys(removed).length ? { _inactiveParts: removed } : {}),
    updatedAt: new Date().toISOString(),
  } as CustomerConfiguration;
}

export function layerBounds(layers: Layer[]) {
  if (!layers.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of layers) {
    minX = Math.min(minX, l.x);
    minY = Math.min(minY, l.y);
    maxX = Math.max(maxX, l.x + (l.type === 'image' ? l.width : l.fontSize * l.text.length * 0.6));
    maxY = Math.max(maxY, l.y + (l.type === 'image' ? l.height : l.fontSize));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
