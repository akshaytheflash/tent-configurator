/**
 * Mock Shopify storefront.
 *
 * This plays the role of the Shopify theme: it shows the product, opens the
 * configurator in an iframe, listens for the bridge events, verifies pricing
 * with the API (never trusting the iframe) and only then adds the configured
 * line item to a local cart. The bridge code here is the same code a theme
 * would ship - swap the mock `addToCart` for `/cart/add.js`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCartPayload,
  createHostTransport,
  createConfiguration,
  getProduct,
  reconcileParts,
  type CartPayload,
  type ClientMessage,
  type CustomerConfiguration,
  type Quote,
} from '@tent/core';
import { fetchPdf, fetchQuote } from './api';
import { ProductRail } from './ProductRail';
import { CartDrawer, type CartLine } from './CartDrawer';

const CONFIGURATOR_URL = (import.meta.env.VITE_CONFIGURATOR_URL as string | undefined) ?? 'http://localhost:5174';
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8787';

const product = getProduct('tent-10x10')!;
const DRAFT_KEY = 'tent-draft-v1';

export function ShopifyProductPage() {
  const [open, setOpen] = useState(false);
  const [tierId, setTierId] = useState(product.tiers[0]!.id);
  const [addons, setAddons] = useState<string[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [renders, setRenders] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<CustomerConfiguration | null>(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? (JSON.parse(raw) as CustomerConfiguration) : null;
    } catch {
      return null;
    }
  });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Adding an iframe only after the click keeps the PDP light.
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const transportRef = useRef<ReturnType<typeof createHostTransport> | null>(null);

  const addonTotal = useMemo(
    () => addons.reduce((sum, id) => sum + (product.addons.find((a) => a.id === id)?.price ?? 0), 0),
    [addons],
  );

  const currentConfig = useMemo(() => {
    const base = draft ?? createConfiguration({ productId: product.id, tierId, selectedAddons: addons });
    return reconcileParts({ ...base, tierId, selectedAddons: addons }, product);
  }, [draft, tierId, addons]);

  const designSignature = JSON.stringify(
    Object.values(currentConfig.parts).map((p) => [p.partId, p.color.pantone, p.printMode, p.layers.length]),
  );

  // Preview quote on the PDP (server-priced).
  useEffect(() => {
    fetchQuote({ ...currentConfig, designId: currentConfig.designId })
      .then(({ quote }) => setQuote(quote))
      .catch(() => setQuote(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tierId, addons, designSignature]);

  const openDesigner = useCallback(() => {
    setOpen(true);
  }, []);

  // Wire the bridge once the iframe is mounted.
  useEffect(() => {
    if (!open || !iframeRef.current) return;
    const transport = createHostTransport(iframeRef.current, new URL(CONFIGURATOR_URL).origin);
    transportRef.current = transport;

    const unsubscribe = transport.subscribe(async (msg: ClientMessage) => {
      switch (msg.type) {
        case 'READY':
          // Send the draft + current commerce selections into the app.
          transport.send({ type: 'INIT', payload: { config: draft ?? undefined, variantId: tierId } });
          transport.send({ type: 'SET_TIER', tierId });
          transport.send({ type: 'SET_ADDONS', selectedAddons: addons });
          break;
        case 'AUTO_SAVE':
          setDraft(msg.config);
          localStorage.setItem(DRAFT_KEY, JSON.stringify(msg.config));
          break;
        case 'SAVED': {
          setDraft(msg.config);
          if (msg.renders) setRenders(msg.renders);
          localStorage.setItem(DRAFT_KEY, JSON.stringify(msg.config));
          const checked = await fetchQuote(msg.config);
          setQuote(checked.quote);
          setOpen(false);
          setToast('Design saved - price updated');
          window.setTimeout(() => setToast(null), 2400);
          break;
        }
        case 'CLOSE':
          setOpen(false);
          break;
        case 'ERROR':
          setToast(msg.message);
          break;
      }
    });

    return () => {
      unsubscribe();
      transport.destroy();
    };
  }, [open, tierId, addons, draft]);

  async function addToCart() {
    if (!quote || !draft) return;
    // 1. Re-price server-side from the saved design.
    const { quote: verified, config } = await fetchQuote(draft);
    // 2. Build the print artefacts the order needs (renders came with SAVED).
    const pdf = await fetchPdf(config, renders);
    const artifacts = {
      files: [
        { kind: 'configuration-pdf' as const, name: 'configuration.pdf', url: pdf.url, bytes: pdf.blob.size, mime: 'application/pdf' },
      ],
    };
    const variant = `gid://shopify/ProductVariant/${product.id}-${draft.tierId}`;
    const payload: CartPayload = buildCartPayload(config, verified, variant, artifacts);
    // 3. Mock /cart/add.js - a real theme posts this payload.
    const line: CartLine = {
      id: crypto.randomUUID(),
      title: product.name,
      designId: draft.designId,
      variant: draft.tierId,
      quote: verified,
      pdfUrl: pdf.url,
      payload,
      config,
    };
    setCart((c) => [...c, line]);
    setCartOpen(true);
    setToast('Added to cart');
    window.setTimeout(() => setToast(null), 2400);
  }

  const savedAddonLabels = addons.map((id) => product.addons.find((a) => a.id === id)?.label ?? id);
  const hasDesign = Boolean(draft);

  return (
    <div className="shop">
      <header className="shop-nav">
        <div className="brand">
          <span className="brand-mark">MVP</span>
          <span className="brand-name">Visuals</span>
        </div>
        <nav>
          <a href="#product" className="nav-link">Canopy tents</a>
          <a href="#config" className="nav-link">Customize</a>
          <button type="button" className="cart-btn" onClick={() => setCartOpen(true)}>
            Cart <span className="cart-count">{cart.length}</span>
          </button>
        </nav>
      </header>

      <main className="shop-main">
        <section className="pdp">
          <div className="pdp-gallery">
            <img
              className="pdp-hero"
              src="https://mvpvisuals.com/cdn/shop/files/Untitled-1_0000_1.Canopy_Frame_e5c380a8-8b23-48ea-97e0-63217fe5fb9c.jpg?v=1774630336&width=1080"
              alt="10x10 logo canopy tent"
            />
            <div className="pdp-badge">Dye sublimation · 600D polyester</div>
          </div>

          <div className="pdp-info">
            <p className="eyebrow">Logo canopy tents</p>
            <h1>{product.name}</h1>
            <p className="pdp-lede">
              Custom 10x10 canopy tent with company logo, dye sublimation printing and a lifetime frame warranty.
              2-day production. No minimums, no setup fees.
            </p>

            <div className="price-now">
              {quote ? (
                <>
                  <strong>{`${quote.currency} ${quote.total.toFixed(2)}`}</strong>
                  <span className="price-note">{hasDesign ? 'Including your design' : 'As configured'}</span>
                </>
              ) : (
                <span className="price-note">Pricing unavailable</span>
              )}
            </div>

            <fieldset className="opt-group">
              <legend>Base setup</legend>
              <div className="opt-row">
                {product.tiers.map((t) => (
                  <label key={t.id} className="opt" data-active={tierId === t.id}>
                    <input
                      type="radio"
                      name="tier"
                      checked={tierId === t.id}
                      onChange={() => setTierId(t.id)}
                    />
                    <span>{t.label}</span>
                    <em>${t.price}</em>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="opt-group">
              <legend>Add-ons</legend>
              <div className="opt-row wrap">
                {product.addons.filter((a) => a.group !== 'accessories').map((a) => (
                  <label key={a.id} className="opt" data-active={addons.includes(a.id)}>
                    <input
                      type="checkbox"
                      checked={addons.includes(a.id)}
                      onChange={() => {
                        // Wall options are exclusive within their group.
                        setAddons((prev) => {
                          const group = product.addons.find((x) => x.id === a.id)!.group;
                          const sameGroup = product.addons.filter((x) => x.group === group).map((x) => x.id);
                          const next = prev.filter((id) => !sameGroup.includes(id));
                          return prev.includes(a.id) ? next : [...next, a.id];
                        });
                      }}
                    />
                    <span>{a.label}</span>
                    <em>+${a.price}</em>
                  </label>
                ))}
              </div>
              {addonTotal > 0 && <p className="opt-sum">{savedAddonLabels.length} option(s) · +${addonTotal}</p>}
            </fieldset>

            <div className="pdp-actions">
              <button type="button" className="btn btn-dark btn-lg" onClick={openDesigner}>
                {hasDesign ? 'Continue customizing' : 'Customize your tent'}
              </button>
              <button type="button" className="btn btn-outline btn-lg" disabled={!hasDesign} onClick={() => void addToCart()}>
                Add to cart
              </button>
            </div>
            {hasDesign && (
              <p className="saved-note">
                Design <code>{draft!.designId}</code> saved · <button type="button" className="link" onClick={openDesigner}>edit</button>
              </p>
            )}

            <ul className="pdp-facts">
              <li>Production time: 2 business days</li>
              <li>Delivery: 5-7 business days</li>
              <li>Free layouts &amp; no setup fees</li>
            </ul>
          </div>
        </section>

        <ProductRail />
      </main>

      {open && (
        <div className="designer-shell" role="dialog" aria-modal="true" aria-label="Tent customizer">
          <iframe
            ref={iframeRef}
            title="Tent customizer"
            src={`${CONFIGURATOR_URL}/?size=10x10&variant_id=${tierId}`}
            allow="clipboard-write"
          />
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      <CartDrawer
        open={cartOpen}
        lines={cart}
        onClose={() => setCartOpen(false)}
        onRemove={(id) => setCart((c) => c.filter((l) => l.id !== id))}
        apiBase={API_BASE}
      />
    </div>
  );
}
