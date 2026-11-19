/**
 * API client for the pricing/CRM service.
 *
 * The base URL is injected at build time so the same bundle can point at a
 * staging or production service. All money questions go to the server; the
 * client only ever displays what it gets back.
 */
import type { CustomerConfiguration, ProductDefinition, Quote } from '@tent/core';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8787';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? 'Request failed', res.status);
  }
  return (await res.json()) as T;
}

export function fetchQuote(config: CustomerConfiguration, quantity = 1): Promise<{ quote: Quote; config: CustomerConfiguration }> {
  return request('/quote', { method: 'POST', body: JSON.stringify({ config, quantity }) });
}

/** Returns a blob URL for the generated PDF. */
export async function fetchPdf(
  config: CustomerConfiguration,
  renders: Record<string, string>,
  quantity = 1,
): Promise<{ url: string; blob: Blob }> {
  const res = await fetch(`${API_BASE}/designs/${encodeURIComponent(config.designId)}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, renders, quantity }),
  });
  if (!res.ok) throw new ApiError('PDF generation failed', res.status);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), blob };
}

/**
 * Persist the renders server-side so they survive the iframe and can be
 * attached to the Shopify order later.
 */
export async function storeRenders(designId: string, renders: Record<string, string>) {
  return request<{ ok: boolean; designId: string; files: string[] }>(
    `/designs/${encodeURIComponent(designId)}/renders`,
    { method: 'POST', body: JSON.stringify({ renders }) },
  );
}

export async function uploadImage(dataUrl: string, name: string) {
  return request<{ id: string; url: string; mime: string; bytes: number; name: string }>('/uploads', {
    method: 'POST',
    body: JSON.stringify({ dataUrl, name }),
  });
}

export function absoluteAssetUrl(path: string) {
  if (/^(blob:|data:)/.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}

export type { ProductDefinition };
