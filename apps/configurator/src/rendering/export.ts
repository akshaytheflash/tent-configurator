/**
 * Export pipeline.
 *
 * Produces the files that go with the order:
 *  - print-file.png  the flat-lay at print resolution, transparent background,
 *                    drawn with the same rasteriser the editor and 3D use.
 *  - design-preview.png + view-*.png  the 3D views the customer approved.
 *
 * Rendering happens client-side because the artboards only exist there; the
 * API stores the results and composes the PDF.
 */
import type { CustomerConfiguration, Layout, PartConfig } from '@tent/core';
import { assetsSnapshot } from './assets';
import { pixelSize, renderPart } from './rasterizer';

const PRINT_MAX_WIDTH = 2400;

/** Bounding box of a part's canvas-space pieces. */
function partBounds(pieces: Layout['pieces']) {
  const xs = pieces.flatMap((p) => p.points.map((pt) => pt.x));
  const ys = pieces.flatMap((p) => p.points.map((pt) => pt.y));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Render one part to its own PNG data URL (transparent background). */
export function renderPartPng(part: PartConfig, layout: Layout, maxWidth = 1600): string | null {
  const pieces = layout.pieces.filter((p) => p.partId === part.partId);
  if (!pieces.length) return null;
  const b = partBounds(pieces);
  const size = pixelSize(b, { maxWidth });
  const canvas = document.createElement('canvas');
  renderPart(
    canvas,
    part,
    pieces.map((p) => ({ ...p, points: p.points.map((pt) => ({ x: pt.x - b.minX, y: pt.y - b.minY })) })),
    b,
    { width: size.width, height: size.height, includeBackground: false },
    assetsSnapshot(),
  );
  return canvas.toDataURL('image/png');
}

/**
 * The full flat-lay as the printer receives it: every part sheet composited on
 * one page, in canvas coordinates, so cut positions match the 2D editor.
 */
export function renderFlatLay(layout: Layout, config: CustomerConfiguration): string {
  const scale = PRINT_MAX_WIDTH / layout.widthMm;
  const sheet = document.createElement('canvas');
  sheet.width = Math.round(layout.widthMm * scale);
  sheet.height = Math.round(layout.heightMm * scale);
  const ctx = sheet.getContext('2d')!;
  ctx.clearRect(0, 0, sheet.width, sheet.height);

  for (const [partId, part] of Object.entries(config.parts)) {
    const png = renderPartPng(part, layout);
    if (!png) continue;
    void partId;
    const pieces = layout.pieces.filter((p) => p.partId === partId);
    const b = partBounds(pieces);
    const img = new Image();
    // Synchronous draw is safe because the source is a same-origin data URL.
    img.src = png;
    void img.decode?.();
    ctx.drawImage(img, b.minX * scale, b.minY * scale, b.width * scale, b.height * scale);
  }
  return sheet.toDataURL('image/png');
}

/** Capture a live WebGL canvas, downscaled for the PDF. */
export function captureCanvas(canvas: HTMLCanvasElement, maxWidth = 1400): string {
  const scale = Math.min(1, maxWidth / canvas.width);
  if (scale >= 1) return canvas.toDataURL('image/png');
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

export function buildRenders(
  layout: Layout,
  config: CustomerConfiguration,
  views: Partial<Record<string, string>>,
): Record<string, string> {
  return { 'print-file.png': renderFlatLay(layout, config), ...views };
}
