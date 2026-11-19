import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildCartPayload,
  createConfiguration,
  createHostTransport,
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
import { CheckoutDialog } from './CheckoutDialog';

/**
 * Relative URLs (`/designer`) are resolved against this page so the designer
 * can also be served same-origin, which is how production runs.
 */
const CONFIGURATOR_URL = new URL(
  import.meta.env.VITE_CONFIGURATOR_URL ?? 'http://localhost:5174',
  window.location.href,
).href.replace(/\/+$/, '');
const DRAFT_PREFIX = 'tent-draft-v1:';

function readDraft(productId: string): CustomerConfiguration | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + productId);
    return raw ? (JSON.parse(raw) as CustomerConfiguration) : null;
  } catch {
    return null;
  }
}

function productFromHash(): string {
  const candidate = /product=([a-z0-9-]+)/i.exec(window.location.hash)?.[1];
  return candidate && getProduct(candidate) ? candidate : 'tent-10x10';
}

/** "10x10" -> "10x10", from the product name. */
function sizeLabelOf(id: string) {
  const p = getProduct(id);
  return p?.name.match(/^([\d.]+x[\d.]+)/)?.[1] ?? '10x10';
}

/**
 * Mock Shopify storefront.
 *
 * Plays the role of the Shopify theme: shows the product, opens the
 * configurator in an iframe, listens for the bridge events, verifies pricing
 * with the API (never trusting the iframe) and only then adds the configured
 * line item to a local cart. Swap the mock `addToCart` for `/cart/add.js`.
 */
export function ShopifyProductPage() {
  const [productId, setProductId] = useState(productFromHash);
  const product = useMemo(() => getProduct(productId) ?? getProduct('tent-10x10')!, [productId]);

  const [open, setOpen] = useState(false);
  const [tierId, setTierId] = useState(product.tiers[0]!.id);
  const [addons, setAddons] = useState<string[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [renders, setRenders] = useState<Record<string, string>>({});
  const [pdfDataUrl, setPdfDataUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomerConfiguration | null>(() => readDraft(product.id));
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const transportRef = useRef<ReturnType<typeof createHostTransport> | null>(null);
  // Latest values for the bridge callback, which must not re-subscribe on
  // every design change (that would drop messages mid-save).
  const latest = useRef({ draft, tierId, addons, product });
  latest.current = { draft, tierId, addons, product };

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2600);
  }, []);

  // Switching products resets the page to that product's own working state.
  // Hash navigation (e.g. the product rail) switches products in place.
  useEffect(() => {
    const onHash = () => {
      const next = productFromHash();
      setProductId((current) => (current === next ? current : next));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setTierId(product.tiers[0]!.id);
    setAddons([]);
    setDraft(readDraft(product.id));
    setRenders({});
    setPdfDataUrl(null);
    setOpen(false);
    setError(null);
    window.history.replaceState(null, '', `#product=${product.id}`);
  }, [product]);

  const currentConfig = useMemo(() => {
    const base = draft ?? createConfiguration({ productId: product.id, tierId, selectedAddons: addons });
    return reconcileParts({ ...base, productId: product.id, tierId, selectedAddons: addons }, product);
  }, [draft, product, tierId, addons]);

  const designSignature = JSON.stringify(
    Object.values(currentConfig.parts).map((p) => [p.partId, p.color.pantone, p.printMode, p.layers.length]),
  );

  // Preview quote on the PDP (server-priced).
  useEffect(() => {
    let alive = true;
    fetchQuote(currentConfig)
      .then(({ quote: q }) => alive && setQuote(q))
      .catch(() => alive && setQuote(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, tierId, addons, designSignature]);

  const addToCartFrom = useCallback(
    async (config: CustomerConfiguration, _liveQuote: Quote, designRenders?: Record<string, string>, pdf?: string) => {
      setAdding(true);
      setError(null);
      try {
        // 1. Re-price server-side from the design being added.
        const { quote: verified, config: priced } = await fetchQuote(config);
        // 2. The PDF: reuse the one the designer just built, else make it now.
        const finalPdf = pdf
          ? { dataUrl: pdf }
          : await fetchPdf(priced, designRenders ?? renders).then((p) => ({ dataUrl: URL.createObjectURL(p.blob) }));
        const pdfUrl = finalPdf.dataUrl;
        setPdfDataUrl(pdfUrl);
        const head = designRenders?.['print-file.png'];
        const artifacts = {
          files: [
            { kind: 'configuration-pdf' as const, name: 'configuration.pdf', url: `${window.location.origin}/#design=${config.designId}`, bytes: Math.round((pdfUrl.length * 3) / 4), mime: 'application/pdf' },
          ],
        };
        const variant = `gid://shopify/ProductVariant/${config.productId}-${config.tierId}`;
        const payload: CartPayload = buildCartPayload(priced, verified, variant, artifacts);
        const line: CartLine = {
          id: crypto.randomUUID(),
          title: (getProduct(config.productId) ?? product).name,
          designId: config.designId,
          variant: config.tierId,
          quote: verified,
          pdfUrl,
          previewUrl: head,
          payload,
          config: priced,
        };
        setCart((c) => [...c, line]);
        setCartOpen(true);
        notify(`Added ${line.title} to cart`);
      } catch (e) {
        setError((e as Error).message || 'Could not add this design to the cart');
      } finally {
        setAdding(false);
      }
    },
    [product, renders, notify],
  );

  // Wire the bridge once the iframe is mounted. Deliberately depends only on
  // `open`: re-subscribing would miss the READY a lazy iframe sends late.
  useEffect(() => {
    if (!open || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const transport = createHostTransport(iframe, new URL(CONFIGURATOR_URL).origin);
    transportRef.current = transport;

    const unsubscribe = transport.subscribe(async (msg: ClientMessage) => {
      const { draft: currentDraft, tierId: currentTier, addons: currentAddons, product: currentProduct } = latest.current;
      switch (msg.type) {
        case 'READY': {
          const base = currentDraft ?? createConfiguration({ productId: currentProduct.id, tierId: currentTier, selectedAddons: currentAddons });
          transport.send({ type: 'INIT', payload: { config: { ...base, productId: currentProduct.id }, variantId: currentTier } });
          transport.send({ type: 'SET_TIER', tierId: currentTier });
          transport.send({ type: 'SET_ADDONS', selectedAddons: currentAddons });
          break;
        }
        case 'AUTO_SAVE':
          setDraft(msg.config);
          setRenders({});
          localStorage.setItem(DRAFT_PREFIX + msg.config.productId, JSON.stringify(msg.config));
          break;
        case 'SAVED': {
          setDraft(msg.config);
          localStorage.setItem(DRAFT_PREFIX + msg.config.productId, JSON.stringify(msg.config));
          if (msg.renders) setRenders(msg.renders);
          if (msg.pdf) setPdfDataUrl(msg.pdf);
          fetchQuote(msg.config)
            .then(({ quote: q }) => setQuote(q))
            .catch(() => undefined);
          setOpen(false);
          notify('Design saved — price updated');
          break;
        }
        case 'ADD_TO_CART': {
          setDraft(msg.config);
          localStorage.setItem(DRAFT_PREFIX + msg.config.productId, JSON.stringify(msg.config));
          if (msg.renders) setRenders(msg.renders);
          setQuote(msg.quote);
          setOpen(false);
          await addToCartFrom(msg.config, msg.quote, msg.renders, msg.pdf);
          break;
        }
        case 'CLOSE':
          setOpen(false);
          break;
        case 'ERROR':
          setError(msg.message);
          break;
      }
    });

    return () => {
      unsubscribe();
      transport.destroy();
    };
  }, [open, addToCartFrom, notify]);

  const savedAddonLabels = addons.map((id) => product.addons.find((a) => a.id === id)?.label ?? id);
  const hasDesign = Boolean(draft);

  return (
    <div className="shop">
      <header className="shop-nav">
        <a className="brand" href="#product">
          <span className="brand-mark">MVP</span>
          <span className="brand-name">Visuals</span>
        </a>
        <nav>
          <a href="#product" className="nav-link">Canopy tents</a>
          <button type="button" className="nav-link nav-link-btn" onClick={() => setOpen(true)}>Customize</button>
          <button type="button" className="cart-btn" onClick={() => setCartOpen(true)} aria-label={`Cart, ${cart.length} item(s)`}>
            Cart <span className="cart-count">{cart.length}</span>
          </button>
        </nav>
      </header>

      <main className="shop-main" id="product">
        <section className="pdp">
          <div className="pdp-gallery">
            <img className="pdp-hero" src={PRODUCT_IMAGES[product.id] ?? PRODUCT_IMAGES['tent-10x10']} alt={`${product.name} frame`} />
            <div className="pdp-badge">Dye sublimation · 600D polyester</div>
            {renders['design-preview.png'] && (
              <div className="pdp-design">
                <img src={renders['design-preview.png']} alt="Your design on the 3D tent" />
                <span>Your design</span>
              </div>
            )}
          </div>

          <div className="pdp-info">
            <p className="eyebrow">Logo canopy tents</p>
            <h1>{product.name}</h1>
            <p className="pdp-lede">
              Custom {sizeLabelOf(product.id)} canopy tent with company logo, dye sublimation printing and a lifetime frame
              warranty. 2-day production. No minimums, no setup fees.
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
                    <input type="radio" name="tier" checked={tierId === t.id} onChange={() => setTierId(t.id)} />
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
                        setAddons((prev) => {
                          const sameGroup = product.addons.filter((x) => x.group === a.group).map((x) => x.id);
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
              {addons.length > 0 && <p className="opt-sum">{savedAddonLabels.length} option(s) selected</p>}
            </fieldset>

            <div className="pdp-actions">
              <button type="button" className="btn btn-dark btn-lg" onClick={() => setOpen(true)}>
                {hasDesign ? 'Continue customizing' : 'Customize your tent'}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-lg"
                disabled={adding || !quote}
                title={hasDesign ? undefined : 'Start customizing to add your own artwork'}
                onClick={() => void addToCartFrom(currentConfig, quote!)}
              >
                {adding ? 'Adding…' : hasDesign ? 'Add to cart' : 'Add without artwork'}
              </button>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error} <button type="button" className="link" onClick={() => setError(null)}>Dismiss</button>
              </p>
            )}
            {hasDesign && (
              <p className="saved-note">
                Design <code>{draft!.designId}</code> saved · <button type="button" className="link" onClick={() => setOpen(true)}>edit</button>
                {pdfDataUrl && (
                  <>
                    {' · '}
                    <a className="link" href={pdfDataUrl} target="_blank" rel="noreferrer">Preview PDF</a>
                  </>
                )}
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
          <button type="button" className="designer-close" onClick={() => setOpen(false)} aria-label="Close customizer">×</button>
          <iframe
            ref={iframeRef}
            title="Tent customizer"
            src={`${CONFIGURATOR_URL}/?size=${sizeLabelOf(product.id)}&variant_id=${tierId}&product=${product.id}`}
            allow="clipboard-write"
          />
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}

      <CartDrawer
        open={cartOpen}
        lines={cart}
        onClose={() => setCartOpen(false)}
        onRemove={(id) => setCart((c) => c.filter((l) => l.id !== id))}
        onCheckout={() => {
          setCartOpen(false);
          setCheckoutOpen(true);
        }}
      />

      <CheckoutDialog
        open={checkoutOpen}
        lines={cart}
        onClose={() => setCheckoutOpen(false)}
        onComplete={(orderId, keepIds) => {
          setCart((c) => c.filter((l) => !keepIds.includes(l.id)));
          notify(`Order ${orderId} placed`);
        }}
      />
    </div>
  );
}

const PRODUCT_IMAGES: Record<string, string> = {
  'tent-10x10': 'https://mvpvisuals.com/cdn/shop/files/Untitled-1_0000_1.Canopy_Frame_e5c380a8-8b23-48ea-97e0-63217fe5fb9c.jpg?v=1774630336&width=1080',
  'tent-10x20': 'https://mvpvisuals.com/cdn/shop/files/Untitled-1_0003_4.Canopy_Frame_with_Full_Wall.jpg?v=1774630812&width=1080',
  'tent-8x8': 'https://mvpvisuals.com/cdn/shop/files/venture_outdoors_10x10_18e0df97-c359-4bfd-97a9-4f9dd14d79cf_800x.jpg?v=1691515919',
  'tent-65x65': 'https://mvpvisuals.com/cdn/shop/files/5x5_1wall_a671e2c8-2d24-485b-9f65-1abeec3b74b9.jpg?v=1764960129&width=720',
  'tent-5x5': 'https://mvpvisuals.com/cdn/shop/files/5x5_1wall_a671e2c8-2d24-485b-9f65-1abeec3b74b9.jpg?v=1764960129&width=720',
};
