/**
 * Product catalogue.
 *
 * A product is a data record. Adding a new printable product means adding an
 * entry here plus a 3D model asset - no component changes. The configurator only
 * ever talks to these ids.
 */
import type { AddonDefinition, PartDefinition, ProductDefinition } from './types';

const MM_PER_INCH = 25.4;

const PANTONES: Record<string, string> = {
  white: 'Pantone 11-0601 TCX',
  black: 'Pantone 19-4007 TCX',
  red: 'Pantone 186 C',
  navy: 'Pantone 295 C',
  royal: 'Pantone 293 C',
  orange: 'Pantone 143 C',
  gold: 'Pantone 130 C',
  green: 'Pantone 348 C',
  teal: 'Pantone 320 C',
  purple: 'Pantone 2685 C',
  grey: 'Pantone 423 C',
  sand: 'Pantone 465 C',
};

export const SWATCHES = [
  { id: 'white', hex: '#f4f4f2', pantone: PANTONES.white },
  { id: 'black', hex: '#1c1c1e', pantone: PANTONES.black },
  { id: 'red', hex: '#c8102e', pantone: PANTONES.red },
  { id: 'navy', hex: '#1b2a49', pantone: PANTONES.navy },
  { id: 'royal', hex: '#1d4f91', pantone: PANTONES.royal },
  { id: 'orange', hex: '#f2a900', pantone: PANTONES.orange },
  { id: 'green', hex: '#0f7c4d', pantone: PANTONES.green },
  { id: 'teal', hex: '#00857d', pantone: PANTONES.teal },
  { id: 'purple', hex: '#5b2c83', pantone: PANTONES.purple },
  { id: 'grey', hex: '#5f6368', pantone: PANTONES.grey },
  { id: 'sand', hex: '#d6c3a1', pantone: PANTONES.sand },
] as const;

function swatch(id: string) {
  const s = SWATCHES.find((x) => x.id === id) ?? SWATCHES[0];
  return { hex: s.hex, pantone: s.pantone };
}

/** The roof + valance + side parts every canopy shares. */
function canopyParts(): PartDefinition[] {
  const parts: PartDefinition[] = [
    {
      id: 'roof',
      label: 'Canopy top',
      kind: 'roof',
      hasOuterPiece: true,
      hasInnerPiece: false,
      printable: true,
      defaultColor: 'orange',
    },
  ];
  const wallSides = ['front', 'left', 'back', 'right'] as const;
  // One printed valance strip per eave edge, each independently colourable.
  for (const side of wallSides) {
    parts.push({
      id: `valance-${side}`,
      label: `${cap(side)} valance`,
      kind: 'valance',
      side,
      hasOuterPiece: true,
      hasInnerPiece: false,
      printable: true,
      defaultColor: 'orange',
    });
  }
  for (const side of wallSides) {
    parts.push({
      id: `wall-${side}`,
      label: `${cap(side)} wall`,
      kind: 'wall',
      side,
      hasOuterPiece: true,
      hasInnerPiece: false,
      printable: true,
      defaultColor: 'white',
    });
    parts.push({
      id: `halfwall-${side}`,
      label: `${cap(side)} half wall`,
      kind: 'half-wall',
      side,
      hasOuterPiece: true,
      hasInnerPiece: false,
      printable: true,
      defaultColor: 'white',
    });
  }
  return parts;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Add-on prices are the *deltas* taken from the reference store's variant
 * table for a 10x10 canopy with frame (e.g. no walls $950 -> 3 double-sided
 * walls $2,195), so the configured total matches the storefront.
 */
const ADDONS: AddonDefinition[] = [
  { id: 'wall-single-1', label: '1 × 10ft wall - single sided', group: 'walls', price: 186, printMode: 'single' },
  { id: 'wall-single-3', label: '3 × 10ft walls - single sided', group: 'walls', price: 556, printMode: 'single' },
  { id: 'wall-double-1', label: '1 × 10ft wall - double sided', group: 'walls', price: 284, printMode: 'double' },
  { id: 'wall-double-3', label: '3 × 10ft walls - double sided', group: 'walls', price: 885, printMode: 'double' },
  { id: 'halfwall-single', label: 'Half walls (set of 2) - single sided', group: 'halfWalls', price: 325, printMode: 'single' },
  { id: 'halfwall-double', label: 'Half walls (set of 2) - double sided', group: 'halfWalls', price: 414, printMode: 'double' },
  { id: 'weight-bags', label: 'Weight bags (set of 4)', group: 'accessories', price: 55 },
  { id: 'banner', label: 'Valance banner', group: 'accessories', price: 110 },
];

function tent(opts: {
  id: string;
  feet: [number, number];
  model: string;
  legHeight: number;
  /** Height of the fabric eave (top of the legs). */
  eaveHeight: number;
  prices: [number, number, number];
}): ProductDefinition {
  const [fw, fd] = opts.feet;
  const shortSpan = Math.min(fw, fd) * 12 * MM_PER_INCH;
  return {
    id: opts.id,
    slug: `${opts.id}-custom-canopy-tent`,
    name: `${label(opts.feet)} Logo Canopy Tent`,
    currency: 'USD',
    canopy: {
      width: fw * 12 * MM_PER_INCH,
      depth: fd * 12 * MM_PER_INCH,
      // The frame legs stop at the eave; the fabric peak rises above it.
      legHeight: opts.eaveHeight,
      peakHeight: opts.eaveHeight + shortSpan * 0.23,
      valanceHeight: 250,
      bleedMm: 40,
    },
    model: opts.model,
    tiers: [
      { id: 'with-frame', label: 'Canopy with frame', variantId: `${opts.id}-with-frame`, price: opts.prices[0] },
      { id: 'canopy-only', label: 'Canopy only (no frame)', variantId: `${opts.id}-canopy-only`, price: opts.prices[1] },
      {
        id: 'light-up',
        label: 'Canopy with light-up frame',
        variantId: `${opts.id}-light-up`,
        price: opts.prices[2],
        features: ['light-up'],
      },
    ],
    parts: canopyParts(),
    addons: ADDONS,
    layout: 'canopy-flat-lay',
    printMarginMm: 40,
  };
}

function label(feet: [number, number]) {
  return `${feet[0]}x${feet[1]}`;
}

/**
 * Dimensions use real pop-up canopy proportions: ~2.1 m eave height with the
 * peak rising a further ~22% of the shorter span. Prices follow the reference
 * store's USD variant table (base / canopy-only / light-up frame).
 */
export const PRODUCTS: ProductDefinition[] = [
  tent({ id: 'tent-5x5', feet: [5, 5], model: 'tent-5x5.glb', legHeight: 1950, eaveHeight: 1950, prices: [465, 300, 725] }),
  tent({ id: 'tent-65x65', feet: [6.5, 6.5], model: 'tent-65x65.glb', legHeight: 2050, eaveHeight: 2050, prices: [615, 405, 890] }),
  tent({ id: 'tent-8x8', feet: [8, 8], model: 'tent-8x8.glb', legHeight: 2100, eaveHeight: 2100, prices: [795, 525, 1185] }),
  tent({ id: 'tent-10x10', feet: [10, 10], model: 'tent-10x10.glb', legHeight: 2150, eaveHeight: 2150, prices: [950, 620, 1380] }),
  tent({ id: 'tent-10x20', feet: [10, 20], model: 'tent-10x20.glb', legHeight: 2150, eaveHeight: 2150, prices: [1720, 1150, 2350] }),
];

export function getProduct(id: string): ProductDefinition | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function defaultColorFor(part: PartDefinition) {
  return swatch(part.defaultColor);
}

export function swatchById(id: string) {
  return SWATCHES.find((s) => s.id === id);
}

export { swatch };
