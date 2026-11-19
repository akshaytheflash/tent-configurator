/**
 * Flat-lay layout generator.
 *
 * A dye-sublimation canopy is printed as flat pieces of fabric that are later
 * sewn into a pyramid. The 2D editor therefore shows the *unfolded* pattern: the
 * four roof triangles (peak) and the printed valance strips, followed by the
 * wall panels laid out straight.
 *
 * The 3D preview does not duplicate this geometry. It reuses the same piece
 * list to build its meshes and derives UVs from the same polygons, and it
 * paints the roof and walls from the 2D layers rendered to texture. One source
 * of truth, so the 2D and 3D views cannot drift apart.
 */
import type {
  PartDefinition,
  PartSide,
  PrintPiece,
  ProductDefinition,
  Rect,
  Vec2,
} from './types';

export interface PrintPieceGeometry {
  partId: string;
  piece: PrintPiece;
  /** Canvas-space polygon in mm. */
  points: Vec2[];
  /** Bounding box in canvas space. */
  box: Rect;
  label: string;
}

export interface Layout {
  /** Total flat-lay size in mm. */
  widthMm: number;
  heightMm: number;
  /** Canvas-space rect (mm) for each part. */
  partBoxes: Record<string, Rect>;
  pieces: PrintPieceGeometry[];
  /** Dashed separators between parts on the canvas. */
  seams: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

export const SIDES: PartSide[] = ['front', 'back', 'left', 'right'];

/** Slant height of one roof face, from the canopy dimensions. */
export function roofSlant(product: ProductDefinition): number {
  const { width, depth, peakHeight, legHeight } = product.canopy;
  return Math.hypot(Math.hypot(width, depth) / 2, peakHeight - legHeight);
}

export function valanceHeight(product: ProductDefinition): number {
  return product.canopy.valanceHeight ?? 250;
}

export function partEaveWidth(product: ProductDefinition, side: PartSide): number {
  return side === 'front' || side === 'back' ? product.canopy.width : product.canopy.depth;
}

export function partLabel(product: ProductDefinition, partId: string): string {
  return product.parts.find((p) => p.id === partId)?.label ?? partId;
}

/** Wall panel height: full walls reach the valance, half walls sit at half. */
export function wallHeightFor(product: ProductDefinition, part: PartDefinition): number {
  if (part.wallHeightMm) return part.wallHeightMm;
  const side = part.side ?? 'front';
  const eave = partEaveWidth(product, side);
  return part.kind === 'half-wall' ? eave * 0.45 : eave;
}

/**
 * Build the complete flat-lay. Parts are stacked in a stable order so canvas
 * coordinates stay deterministic between sessions - saved configurations store
 * coordinates in part-local space and depend on that stability.
 */
export function buildLayout(product: ProductDefinition, partIds: string[]): Layout {
  const bleed = product.canopy.bleedMm ?? 40;
  const gap = bleed * 2;
  const slant = roofSlant(product);
  const valance = valanceHeight(product);

  const parts = orderParts(product.parts.filter((p) => partIds.includes(p.id)));
  // The roof strip (4 triangles side by side) is the widest piece on every
  // product: width + depth + width + depth.
  const roofStripWidth = (product.canopy.width + product.canopy.depth) * 2;
  const widest = Math.max(
    roofStripWidth,
    ...parts.map((p) => partEaveWidth(product, p.side ?? 'front')),
    1,
  );
  const widthMm = widest + bleed * 2;

  const partBoxes: Record<string, Rect> = {};
  const pieces: PrintPieceGeometry[] = [];
  let y = bleed;

  for (const part of parts) {
    const eave = partEaveWidth(product, part.side ?? 'front');
    const pieceSpecs = pieceSpecsFor(product, part, eave, slant, valance);
    let height = 0;
    let pieceY = y;

    for (const spec of pieceSpecs) {
      const x = (widthMm - spec.width) / 2;
      const box: Rect = { x, y: pieceY, width: spec.width, height: spec.height };
      pieces.push({
        partId: part.id,
        piece: spec.piece,
        label: spec.label,
        box,
        points: spec.points.map((p) => ({ x: p.x + x, y: p.y + pieceY })),
      });
      pieceY += spec.height + gap;
      height = pieceY - y - gap;
    }

    partBoxes[part.id] = { x: (widthMm - eave) / 2, y, width: eave, height };
    y = pieceY;
  }

  return { widthMm, heightMm: y + bleed, partBoxes, pieces, seams: buildSeams(parts, partBoxes) };
}

interface PieceSpec {
  piece: PrintPiece;
  label: string;
  width: number;
  height: number;
  /** Points relative to the piece's top-left. */
  points: Vec2[];
}

function pieceSpecsFor(
  product: ProductDefinition,
  part: PartDefinition,
  eave: number,
  slant: number,
  valance: number,
): PieceSpec[] {
  const specs: PieceSpec[] = [];

  if (part.kind === 'roof' && part.hasOuterPiece) {
    /**
     * Four roof faces printed side by side as a sawtooth: front, right, back,
     * left. Front/back span the canopy width, left/right span the depth, so a
     * 10x20 artboard differs from a 10x10 automatically. The sawtooth is one
     * closed polygon alternating between the eave line (y = slant) and the two
     * apex lines (y = 0 and y = 2*slant).
     *
     * The face order is shared with the 3D UV layout: face i reads triangle i,
     * so artwork cannot land on the wrong face.
     */
    const widths = [product.canopy.width, product.canopy.depth, product.canopy.width, product.canopy.depth];
    const total = widths.reduce((sum, w) => sum + w, 0);
    // Apex-up faces rise to slant, apex-down faces drop to slant, so the strip
    // is exactly `slant` tall with the eave line at mid-height.
    const mid = slant / 2;
    const points: Vec2[] = [{ x: 0, y: mid }];
    let cursor = 0;
    widths.forEach((w, i) => {
      const apexY = i % 2 === 0 ? 0 : slant;
      points.push({ x: cursor + w, y: apexY }, { x: cursor + w, y: mid });
      cursor += w;
    });
    specs.push({ piece: 'outer', label: `${part.label} - peaks`, width: total, height: slant, points });
  }

  if (part.kind === 'roof' && part.hasInnerPiece) {
    specs.push({
      piece: 'inner',
      label: `${part.label} - valance`,
      width: eave,
      height: valance,
      points: rectPoints(eave, valance),
    });
  }

  if (part.kind === 'valance') {
    // The printed skirt strip: full eave width, production valance height.
    specs.push({
      piece: 'outer',
      label: part.label,
      width: eave,
      height: valance,
      points: rectPoints(eave, valance),
    });
  }

  if (part.kind === 'wall' || part.kind === 'half-wall') {
    const height = wallHeightFor(product, part);
    specs.push({
      piece: 'outer',
      label: part.label,
      width: eave,
      height,
      points: rectPoints(eave, height),
    });
  }

  return specs;
}

function rectPoints(w: number, h: number): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function orderParts(parts: PartDefinition[]): PartDefinition[] {
  const rank = (p: PartDefinition) =>
    p.kind === 'roof' ? 0 : p.kind === 'valance' ? 1 : p.kind === 'wall' ? 2 : 3;
  return [...parts].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      SIDES.indexOf(a.side ?? 'front') - SIDES.indexOf(b.side ?? 'front'),
  );
}

function buildSeams(parts: PartDefinition[], boxes: Record<string, Rect>) {
  return parts.flatMap((p) => {
    const b = boxes[p.id];
    return [
      { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y },
      { x1: b.x, y1: b.y + b.height, x2: b.x + b.width, y2: b.y + b.height },
    ];
  });
}

/** Corners of a rotated image/text box in part-local mm. */
export function layerCorners(x: number, y: number, w: number, h: number, rotation: number): Vec2[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }));
}

export function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
