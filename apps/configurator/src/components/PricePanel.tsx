import { useEffect, useMemo, useState } from 'react';
import type { Quote } from '@tent/core';
import { fetchQuote } from '../api';
import { useConfigurator } from '../store';

/**
 * Server-priced quote for the current design. `immediate` skips the debounce
 * for actions that must not use a stale price (save, add to cart, PDF).
 */
export function useQuote(immediate = false) {
  const config = useConfigurator((s) => s.config);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Serialise the design without object URLs so the effect only re-runs on real
  // changes (src values are stable per upload). Text content is part of it,
  // otherwise editing a headline would not re-price... or re-render.
  const signature = useMemo(
    () =>
      JSON.stringify({
        tier: config.tierId,
        addons: config.selectedAddons,
        parts: Object.values(config.parts).map((p) => ({
          id: p.partId,
          color: p.color.pantone,
          mode: p.printMode,
          layers: p.layers.map((l) => ({
            id: l.id,
            t: l.type,
            text: l.type === 'text' ? l.text : undefined,
            fill: l.type === 'text' ? l.fill : undefined,
            x: Math.round(l.x),
            y: Math.round(l.y),
            s: l.type === 'image' ? Math.round(l.width) : l.fontSize,
            on: l.visible,
          })),
        })),
      }),
    [config],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const run = () => {
      fetchQuote(config)
        .then(({ quote: q }) => {
          if (controller.signal.aborted) return;
          setQuote(q);
          setError(null);
        })
        .catch((e: Error) => {
          if (controller.signal.aborted) return;
          setError(e.message);
        })
        .finally(() => !controller.signal.aborted && setLoading(false));
    };
    const timer = immediate ? window.setTimeout(run, 0) : window.setTimeout(run, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return { quote, error, loading };
}

export function PricePanel({ onSave, saving, saveLabel, onPreviewPdf, onAddToCart }: {
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
  onPreviewPdf?: () => void;
  onAddToCart?: () => void;
}) {
  const { quote, error, loading } = useQuote();
  const config = useConfigurator((s) => s.config);

  return (
    <div className="price-panel">
      <div className="price-head">
        <span>Your build</span>
        {loading && <span className="spinner" aria-label="Updating price" />}
      </div>

      <div className="price-body">
        {error && <p className="hint error">Pricing unavailable: {error}</p>}
        {!error && !quote && <p className="hint">Getting your price…</p>}
        {quote && (
          <ul className="quote-lines">
            {quote.lines.filter((l) => l.kind !== 'shipping').map((l) => (
              <li key={l.code} data-kind={l.kind}>
                <span>{l.label}</span>
                <span>{l.amount === 0 ? 'Included' : `${quote.currency} ${l.amount.toFixed(2)}`}</span>
              </li>
            ))}
            <li data-kind="shipping">
              <span>{quote.lines.find((l) => l.kind === 'shipping')?.label ?? 'Shipping'}</span>
            </li>
          </ul>
        )}
      </div>

      <div className="price-foot">
        <div className="total-row">
          <span>Total</span>
          <strong>{quote ? `${quote.currency} ${quote.total.toFixed(2)}` : '—'}</strong>
        </div>
        {quote && (
          <p className="design-meta">
            Design <code>{config.designId}</code> · quote {quote.quoteId}
          </p>
        )}
        <button type="button" className="btn btn-primary btn-block" disabled={saving || !quote} onClick={onSave}>
          {saving ? 'Saving…' : saveLabel}
        </button>
        {onAddToCart && (
          <button type="button" className="btn btn-outline btn-block" disabled={saving || !quote} onClick={onAddToCart}>
            Add to cart
          </button>
        )}
        {onPreviewPdf && (
          <button type="button" className="btn btn-outline btn-block" onClick={onPreviewPdf}>
            Preview configuration PDF
          </button>
        )}
      </div>
    </div>
  );
}
