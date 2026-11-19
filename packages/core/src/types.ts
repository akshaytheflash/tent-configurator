/**
 * Shared domain types for the configurator engine.
 *
 * Two layers matter here:
 *  - Catalogue types (ProductDefinition, PartDefinition...) live on the server
 *    and drive both the UI and the 3D scene. They are *data*, so a new product
 *    is a new JSON file, not a new code path.
 *  - Configuration (CustomerConfiguration) is the document we persist, price,
 *    print and hand to Shopify. It is versioned and self-contained: given only
 *    this object plus the catalogue, any renderer can rebuild the exact design.
 */

/** Decimeters are the storage unit for geometry; everything else is derived. */
export type Vec2 = { x: number; y: number };
export type Size = { width: number; height: number };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Sides of a canopy a printable panel can belong to. */
export type PartSide = 'front' | 'back' | 'left' | 'right';

/**
 * A printable shape on the flat (2D) layout. Every part has an outline piece
 * ("outer") and, for parts with a cut-out (the roof skirt), an inner piece.
 * Polygon coordinates are in part-local millimetres with origin at top-left.
 */
export type PrintPiece = 'outer' | 'inner';

export interface PartDefinition {
  id: string;
  /** Human label used in the 2D sidebar and the PDF. */
  label: string;
  kind: 'roof' | 'valance' | 'wall' | 'half-wall' | 'frame';
  /** Seams shown to the customer as print area separators. */
  hasOuterPiece: boolean;
  hasInnerPiece: boolean;
  /** Whether the part accepts artwork (frame does not). */
  printable: boolean;
  /** Default dye-sublimation base colour (Pantone reference resolved by the API). */
  defaultColor: string;
  /** 3D placement. `side` is ignored for roof pieces. */
  side?: PartSide;
  /** Explicit wall height in mm; derived from the eave when omitted. */
  wallHeightMm?: number;
}

export interface ProductTier {
  id: string;
  label: string;
  /** Commerce variant key: matches Shopify variant for the base setup. */
  variantId: string;
  price: number;
  /** Optional capabilities unlocked by the tier (e.g. light-up frame). */
  features?: string[];
}

export interface ProductDefinition {
  id: string;
  slug: string;
  name: string;
  currency: string;
  /** Physical canopy dimensions in millimetres (post feet, top frame). */
  canopy: {
    width: number;
    depth: number;
    legHeight: number;
    peakHeight: number;
    /** Printed skirt height in mm; also the header strip height on the canvas. */
    valanceHeight: number;
    /** Print bleed around each piece, in mm. */
    bleedMm: number;
  };
  /** GLB asset id in the asset map (see rsync `public/models`). */
  model: string;
  tiers: ProductTier[];
  parts: PartDefinition[];
  /** Wall add-ons available for this product, used by pricing + UI. */
  addons: AddonDefinition[];
  /** Panel geometry is computed by a named layout, not hard-coded. */
  layout: 'canopy-flat-lay';
  /** How many pieces the printer receives per part. */
  printMarginMm: number;
}

export interface AddonDefinition {
  id: string;
  label: string;
  group: 'walls' | 'halfWalls' | 'frame' | 'accessories';
  price: number;
  /** Optional per-unit label, e.g. "Single sided print". */
  printMode?: PrintMode;
}

export type PrintMode = 'single' | 'double' | 'none';

// ---------------------------------------------------------------------------
// Design document
// ---------------------------------------------------------------------------

export interface ColorValue {
  /** Resolved hex used for rendering; pantone kept for production. */
  hex: string;
  pantone: string;
}

export interface BaseLayer {
  id: string;
  type: 'base';
  partId: string;
  color: ColorValue;
}

export interface ImageLayer {
  id: string;
  type: 'image';
  partId: string;
  /** Object URL at authoring time; replaced by an upload id when saved. */
  src: string;
  /** Placement in part-local mm (top-left of the image box). */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  /** Hides a layer during authoring without losing placement. */
  visible: boolean;
  /** Original file metadata, kept so the server can re-render print files. */
  asset?: { id: string; name: string; mime: string; width: number; height: number };
  /** Clip artwork to the printable polygon of the part. */
  clipToPart: boolean;
}

export interface TextLayer {
  id: string;
  type: 'text';
  partId: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  fill: string;
  rotation: number;
  opacity: number;
  visible: boolean;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
}

export type Layer = ImageLayer | TextLayer;

export interface PartConfig {
  partId: string;
  color: ColorValue;
  /** Artwork layers for this part, ordered back-to-front. */
  layers: Layer[];
  /** Single/double sided printing for walls. */
  printMode?: PrintMode;
}

export interface CustomerConfiguration {
  schemaVersion: 1;
  designId: string;
  productId: string;
  tierId: string;
  size: { widthMm: number; depthMm: number; label: string };
  selectedAddons: string[];
  parts: Record<string, PartConfig>;
  notes?: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// API contracts (pricing + Shopify cart)
// ---------------------------------------------------------------------------

export interface PriceRequest {
  productId: string;
  tierId: string;
  sizeLabel: string;
  selectedAddons: string[];
  /** Derived facts so pricing does not need to re-inspect the artwork. */
  designStats: {
    uploadedImages: number;
    textLayers: number;
    printedParts: number;
    doubleSidedParts: number;
  };
  quantity: number;
}

export interface QuoteLine {
  code: string;
  label: string;
  amount: number;
  kind: 'base' | 'addon' | 'customization' | 'discount' | 'shipping' | 'tax';
}

export interface Quote {
  currency: string;
  subtotal: number;
  lines: QuoteLine[];
  total: number;
  /** Total in minor units, what Shopify expects. */
  totalCents: number;
  /** Server-computed hash so the cart request can be verified. */
  quoteId: string;
  generatedAt: string;
}

export interface ShopifyPropertyLine {
  /** Cart line-item property name (Shopify supports nested keys with dots). */
  key: string;
  value: string;
}

export interface CartPayload {
  items: Array<{
    variantId: string;
    quantity: number;
    properties: Record<string, string>;
  }>;
  attributes: Record<string, string>;
  /** Customisation surcharges added as a separate CartTransform-ish line. */
  addonLines: Array<{ title: string; priceCents: number; quantity: number }>;
  quoteId: string;
}
