/**
 * Asset cache.
 *
 * Uploaded images are decoded once and referenced by asset id, so dragging a
 * layer does not re-decode the bitmap on every frame. Also resolves relative
 * upload URLs against the API host.
 */
import { absoluteAssetUrl } from '../api';
import type { LoadedAssets } from './rasterizer';

const images = new Map<string, HTMLImageElement | ImageBitmap>();
const pending = new Map<string, Promise<void>>();

export async function loadImage(key: string, src: string): Promise<void> {
  if (images.has(key)) return;
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const res = await fetch(absoluteAssetUrl(src), { mode: 'cors' });
      if (!res.ok) throw new Error(`Image ${key} failed`);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      images.set(key, bitmap);
    } catch {
      // Fall back to an <img> decode so SVG/data URLs still work.
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = absoluteAssetUrl(src);
      await img.decode().catch(() => undefined);
      images.set(key, img);
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, p);
  return p;
}

export function assetsSnapshot(): LoadedAssets {
  return { images };
}

export function imageFor(key: string, fallback?: string) {
  return images.get(key) ?? (fallback ? images.get(fallback) : undefined);
}
