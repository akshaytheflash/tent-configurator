/**
 * Storefront-side API client. Deliberately separate from the configurator's:
 * the host site (a Shopify theme) must be able to price, generate PDFs and
 * place orders without loading the configurator bundle.
 */
import type { CustomerConfiguration, Quote } from '@tent/core';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:8787';

export { API_BASE };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new ApiError(body.error ?? 'Request failed', res.status);
  }
  return (await res.json()) as T;
}

export async function fetchQuote(config: CustomerConfiguration, quantity = 1): Promise<{ quote: Quote; config: CustomerConfiguration }> {
  return json('/quote', { method: 'POST', body: JSON.stringify({ config, quantity }) });
}

export async function fetchPdf(config: CustomerConfiguration, renders: Record<string, string> = {}) {
  const res = await fetch(`${API_BASE}/designs/${encodeURIComponent(config.designId)}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, renders }),
  });
  if (!res.ok) throw new ApiError('Could not build the configuration PDF', res.status);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), blob };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'application/octet-stream';
  const bin = atob(body ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function downloadUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface CheckoutLine {
  config: CustomerConfiguration;
  /** Live quote id; the server re-prices and rejects a mismatch. */
  quoteId: string;
  quantity: number;
  paymentMethod?: string;
}

export interface CheckoutRequest {
  lines: CheckoutLine[];
  customer: { name: string; email: string; company?: string; address?: string };
  paymentMethod: string;
}

export interface OrderResult {
  orderId: string;
  invoiceNumber: string;
  invoiceUrl: string;
  pdfUrl: string;
  total: number;
  currency: string;
  paidAt: string;
  createdAt: string;
  quoteId: string;
  quantity: number;
  paymentMethod?: string;
}

/**
 * Mock checkout: the cart sends one line at a time (each design is its own
 * order) so every configuration gets its own summary PDF and invoice.
 */
export async function checkout(req: CheckoutRequest): Promise<OrderResult> {
  return json('/checkout', {
    method: 'POST',
    body: JSON.stringify({
      ...req.lines[0],
      customer: req.customer,
      paymentMethod: req.paymentMethod,
    }),
  });
}
