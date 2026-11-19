/**
 * Storefront-side API client. Deliberately separate from the configurator's:
 * the host site (a Shopify theme) must be able to price and generate PDFs
 * without loading the configurator bundle.
 */
import type { CustomerConfiguration, Quote } from '@tent/core';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || process.env.VITE_API_BASE || 'http://localhost:8787';

export async function fetchQuote(config: CustomerConfiguration, quantity = 1): Promise<{ quote: Quote; config: CustomerConfiguration }> {
  const res = await fetch(`${API_BASE}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, quantity }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: 'Pricing failed' }))).error);
  return res.json();
}

export async function fetchPdf(config: CustomerConfiguration, renders: Record<string, string> = {}) {
  const res = await fetch(`${API_BASE}/designs/${encodeURIComponent(config.designId)}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, renders }),
  });
  if (!res.ok) throw new Error('Could not build the configuration PDF');
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), blob };
}

export { API_BASE };
