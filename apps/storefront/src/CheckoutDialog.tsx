/**
 * Mock checkout.
 *
 * One screen: contact details, a fake card (never sent anywhere, only the last
 * four digits are kept for the invoice note), then a receipt with the order
 * number, the configuration summary and the invoice download.
 *
 * Each cart line is a separate order because each design has its own print
 * file: checkout posts them one after another and shows every invoice.
 */
import { useEffect, useState } from 'react';
import { API_BASE, checkout, downloadUrl, ApiError, type OrderResult } from './api';
import type { CartLine } from './CartDrawer';

type Step = 'details' | 'paying' | 'done';

export function CheckoutDialog({ open, lines, onClose, onComplete }: {
  open: boolean;
  lines: CartLine[];
  onClose: () => void;
  onComplete: (orderId: string, lineIds: string[]) => void;
}) {
  const [step, setStep] = useState<Step>('details');
  const [orders, setOrders] = useState<OrderResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', company: '', address: '' });
  const [card, setCard] = useState({ number: '4242 4242 4242 4242', expiry: '12/29', cvc: '123' });

  useEffect(() => {
    if (open) {
      setStep('details');
      setOrders([]);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const subtotal = lines.reduce((sum, l) => sum + l.quote.total, 0);
  const currency = lines[0]?.quote.currency ?? 'USD';

  async function pay() {
    if (!form.name.trim() || !/.+@.+\..+/.test(form.email)) {
      setError('Add a name and a valid email for the receipt');
      return;
    }
    setStep('paying');
    setError(null);
    const placed: OrderResult[] = [];
    try {
      for (const line of lines) {
        const order = await checkout({
          lines: [{ config: line.config, quoteId: line.quote.quoteId, quantity: 1 }],
          customer: form,
          paymentMethod: `card •••• ${card.number.replace(/\s+/g, '').slice(-4)}`,
        });
        placed.push(order);
      }
      setOrders(placed);
      setStep('done');
      onComplete(placed.map((o) => o.orderId).join(', '), lines.map((l) => l.id));
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? 'Prices changed while you were checking out. Close this and add the design again.'
          : (e as Error).message || 'Checkout failed',
      );
      setStep('details');
      if (placed.length) {
        setOrders(placed);
        onComplete(placed.map((o) => o.orderId).join(', '), lines.slice(0, placed.length).map((l) => l.id));
      }
    }
  }

  return (
    <div className="modal-scrim" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Checkout">
        <header className="modal-head">
          <div>
            <p className="eyebrow">{step === 'done' ? 'Order confirmed' : 'Secure checkout'}</p>
            <h2>{step === 'done' ? 'Thank you for your order' : 'Checkout'}</h2>
          </div>
          <button type="button" className="link" onClick={onClose}>{step === 'done' ? 'Close' : 'Cancel'}</button>
        </header>

        {step !== 'done' && (
          <div className="modal-body checkout-grid">
            <form
              className="checkout-form"
              onSubmit={(e) => {
                e.preventDefault();
                void pay();
              }}
            >
              <fieldset>
                <legend>Contact</legend>
                <label className="field">
                  <span>Full name</span>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required />
                </label>
                <label className="field">
                  <span>Company (optional)</span>
                  <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} autoComplete="organization" />
                </label>
                <label className="field">
                  <span>Shipping address</span>
                  <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} autoComplete="street-address" />
                </label>
              </fieldset>

              <fieldset>
                <legend>Payment</legend>
                <p className="field-note">Test card — nothing is charged.</p>
                <label className="field">
                  <span>Card number</span>
                  <input value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} inputMode="numeric" />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Expiry</span>
                    <input value={card.expiry} onChange={(e) => setCard({ ...card, expiry: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>CVC</span>
                    <input value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} inputMode="numeric" />
                  </label>
                </div>
              </fieldset>

              {error && <p className="form-error" role="alert">{error}</p>}

              <button type="submit" className="btn btn-dark btn-lg btn-block" disabled={step === 'paying'}>
                {step === 'paying' ? 'Processing…' : `Pay ${currency} ${(subtotal + tax(subtotal)).toFixed(2)}`}
              </button>
            </form>

            <aside className="checkout-summary">
              <h3>Order summary</h3>
              {lines.map((line) => (
                <div className="summary-line" key={line.id}>
                  {line.previewUrl ? <img src={line.previewUrl} alt="" /> : <div className="cart-thumb-empty" />}
                  <div>
                    <strong>{line.title}</strong>
                    <span>
                      {line.config.size.label} · {line.variant}
                    </span>
                    <span className="summary-id">{line.designId}</span>
                  </div>
                  <em>{currency} {line.quote.total.toFixed(2)}</em>
                </div>
              ))}
              <dl className="summary-totals">
                <dt>Subtotal</dt><dd>{currency} {subtotal.toFixed(2)}</dd>
                <dt>Shipping</dt><dd>Included</dd>
                <dt>Tax</dt><dd>{currency} {tax(subtotal).toFixed(2)}</dd>
                <dt className="total">Total</dt><dd className="total">{currency} {(subtotal + tax(subtotal)).toFixed(2)}</dd>
              </dl>
            </aside>
          </div>
        )}

        {step === 'done' && (
          <div className="modal-body">
            <p className="receipt-lede">
              We emailed a confirmation to <strong>{form.email}</strong>. Your artwork is queued for preflight; production starts within
              2 business days.
            </p>
            {orders.map((order) => (
              <div className="receipt" key={order.orderId}>
                <div>
                  <p className="eyebrow">Order</p>
                  <h3>{order.orderId}</h3>
                  <p className="receipt-meta">
                    {order.currency} {order.total.toFixed(2)} · {order.paymentMethod ?? 'card'} · {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="receipt-actions">
                  <button
                    type="button"
                    className="btn btn-dark"
                    onClick={() => downloadUrl(`${API_BASE}${order.invoiceUrl}`, `${order.orderId}-invoice.pdf`)}
                  >
                    Download invoice
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => window.open(`${API_BASE}${order.pdfUrl}`, '_blank', 'noopener')}
                  >
                    Configuration PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function tax(subtotal: number) {
  return 0 * subtotal;
}

