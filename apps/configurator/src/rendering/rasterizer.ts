/**
 * Shared part rasteriser.
 *
 * One function paints a part (base colour + clipping to the print polygon +
 * artwork layers) at a requested pixel density. The Konva 2D editor uses it for
 * thumbnails and the 3D preview uses it for its fabric textures, so what the
 * customer edits and what the tent shows are produced by the same code.
 *
 * The printer export uses a much higher density and omits the transparent
 * background, hence `mode`.
 */
import type { PartConfig, PrintPieceGeometry } from '@tent/core';

export interface RasterOptions {
  width: number;
  height: number;
  /** Rendered at print DPI, no separators - for the production file. */
  kind?: 'screen' | 'print';
  /** Background colour when the part is composited into a page. */
  includeBackground?: boolean;
}

export interface LoadedAssets {
  images: Map<string, HTMLImageElement | ImageBitmap>;
}

export function polygonPath(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>, scale: number) {
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = p.x / scale;
    const y = p.y / scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/**
 * Paint one part into a canvas. `pieces` are the part's polygons in part-local
 * mm; the canvas is sized to the part's bounding box.
 */
export function renderPart(
  canvas: HTMLCanvasElement,
  part: PartConfig,
  pieces: PrintPieceGeometry[],
  partBox: { width: number; height: number },
  opts: RasterOptions,
  assets: LoadedAssets,
) {
  const { width, height } = opts;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';

  // Uniform scale from width; callers size the canvas to the box aspect, so
  // averaging X/Y would silently distort artwork when rounding differs.
  const scale = width / partBox.width;

  ctx.save();
  ctx.scale(scale, scale);

  // Clip to the union of the part's printable polygons.
  ctx.beginPath();
  for (const piece of pieces) {
    const pts = piece.points.map((p) => ({ x: p.x, y: p.y }));
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }
  ctx.clip();

  if (opts.includeBackground !== false) {
    ctx.fillStyle = part.color.hex;
    ctx.fillRect(0, 0, partBox.width, partBox.height);
  }

  for (const layer of part.layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    if (layer.type === 'image') {
      const img = assets.images.get(layer.asset?.id ?? layer.src) ?? assets.images.get(layer.src);
      if (img) {
        ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
      }
    } else {
      ctx.translate(layer.x, layer.y);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      ctx.fillStyle = layer.fill;
      ctx.font = `700 ${layer.fontSize}px ${layer.fontFamily}, Inter, system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = layer.align;
      if ('letterSpacing' in ctx) {
        (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${layer.letterSpacing ?? 0}px`;
      }
      const textX = layer.align === 'center' ? 0 : layer.align === 'right' ? 0 : 0;
      const lines = layer.text.split('\n');
      lines.forEach((line, i) => {
        ctx.fillText(line, textX, i * layer.fontSize * 1.15);
      });
    }
    ctx.restore();
  }

  ctx.restore();
  return canvas;
}

/** Compute a canvas pixel size for a part at a target DPI or max width. */
export function pixelSize(partBox: { width: number; height: number }, opts: { dpi?: number; maxWidth?: number }) {
  if (opts.dpi) {
    const pxPerMm = opts.dpi / 25.4;
    return {
      width: Math.round(partBox.width * pxPerMm),
      height: Math.round(partBox.height * pxPerMm),
    };
  }
  const maxWidth = opts.maxWidth ?? 1024;
  const scale = maxWidth / partBox.width;
  return { width: Math.max(2, Math.round(partBox.width * scale)), height: Math.max(2, Math.round(partBox.height * scale)) };
}
