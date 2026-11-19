import type { CartPayload, CustomerConfiguration, Quote } from '@tent/core';

export interface CartLine {
  id: string;
  title: string;
  designId: string;
  variant: string;
  quote: Quote;
  pdfUrl: string;
  payload: CartPayload;
  config: CustomerConfiguration;
}

export function CartDrawer({ open, lines, onClose, onRemove }: {
  open: boolean;
  lines: CartLine[];
  onClose: () => void;
  onRemove: (id: string) => void;
  apiBase: string;
}) {
  const subtotal = lines.reduce((sum, l) => sum + l.quote.total, 0);
  return (
    <>
      {open && <button type="button" className="scrim" aria-label="Close cart" onClick={onClose} />}
      <aside className="cart" data-open={open} aria-hidden={!open}>
        <header className="cart-head">
          <h2>Your cart</h2>
          <button type="button" className="link" onClick={onClose}>Close</button>
        </header>
        <div className="cart-body">
          {!lines.length && <p className="cart-empty">Nothing here yet. Customize a tent to see the full line-item payload here.</p>}
          {lines.map((line) => (
            <article key={line.id} className="cart-line">
              <div className="cart-line-head">
                <strong>{line.title}</strong>
                <span>{`${line.quote.currency} ${line.quote.total.toFixed(2)}`}</span>
              </div>
              <dl>
                <dt>Design</dt><dd><code>{line.designId}</code></dd>
                <dt>Variant</dt><dd><code>{line.variant}</code></dd>
                <dt>Parts</dt><dd>{Object.keys(line.config.parts).join(', ')}</dd>
              </dl>
              <details>
                <summary>Line-item properties ({Object.keys(line.payload.items[0]?.properties ?? {}).length})</summary>
                <pre>{JSON.stringify(line.payload, null, 2)}</pre>
              </details>
              <div className="cart-line-actions">
                <a href={line.pdfUrl} target="_blank" rel="noreferrer" className="link">Configuration PDF</a>
                <button type="button" className="link danger" onClick={() => onRemove(line.id)}>Remove</button>
              </div>
            </article>
          ))}
        </div>
        {lines.length > 0 && (
          <footer className="cart-foot">
            <div><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div>
            <button type="button" className="btn btn-dark btn-lg btn-block">Checkout</button>
          </footer>
        )}
      </aside>
    </>
  );
}
