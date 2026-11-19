/**
 * Export pipeline.
 *
 * Produces the files that go with the order:
 *  - print-file.png  the flat-lay at print resolution on the fabric colour,
 *                    drawn with the same rasteriser the editor and 3D use.
 *  - design-preview.png + view-*.png  the 3D views the customer approved.
 *
 * Rendering happens client-side because the artboards only exist there; the
 * API stores the results and composes the PDF. Every image is decoded before it
 * is composed, otherwise the flat-lay comes out blank on a cold canvas.
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

/** Render one part to its own PNG data URL. */
export function renderPartPng(
  part: PartConfig,
  layout: Layout,
  maxWidth = 1600,
  includeBackground = false,
): string | null {
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
    { width: size.width, height: size.height, includeBackground },
    assetsSnapshot(),
  );
  return canvas.toDataURL('image/png');
}

function loadDataUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}

/**
 * The full flat-lay as the printer receives it: every part sheet composited on
 * one page in canvas coordinates, so cut positions match the 2D editor.
 */
export async function renderFlatLay(layout: Layout, config: CustomerConfiguration): Promise<string> {
  const scale = PRINT_MAX_WIDTH / layout.widthMm;
  const sheet = document.createElement('canvas');
  sheet.width = Math.round(layout.widthMm * scale);
  sheet.height = Math.round(layout.heightMm * scale);
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.imageSmoothingQuality = 'high';

  for (const [partId, part] of Object.entries(config.parts)) {
    const png = renderPartPng(part, layout, 2400, true);
    if (!png) continue;
    const pieces = layout.pieces.filter((p) => p.partId === partId);
    const b = partBounds(pieces);
    const img = await loadDataUrl(png);
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

/** Every part rendered on its own sheet, keyed `part-<id>.png`. */
export function buildPartSheets(layout: Layout, config: CustomerConfiguration): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [partId, part] of Object.entries(config.parts)) {
    const png = renderPartPng(part, layout, 1200, true);
    if (png) out[`part-${partId}.png`] = png;
  }
  return out;
}

export async function buildRenders(
  layout: Layout,
  config: CustomerConfiguration,
  views: Partial<Record<string, string>>,
): Promise<Record<string, string>> {
  return { 'print-file.png': await renderFlatLay(layout, config), ...buildPartSheets(layout, config), ...views };
}
