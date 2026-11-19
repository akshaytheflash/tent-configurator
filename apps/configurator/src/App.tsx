/**
 * Configurator shell.
 *
 * Owns the two views (2D editor / 3D preview), the persistence flow and the
 * host bridge. When embedded in Shopify the host sends INIT with any saved
 * draft; when running standalone the app boots with its own working copy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChildTransport, type HostMessage } from '@tent/core';
import { Canvas2D } from './components/Canvas2D';
import { Sidebar } from './components/Sidebar';
import { PricePanel } from './components/PricePanel';
import { TentView } from './three/TentView';
import { useConfigurator } from './store';
import { buildRenders, captureCanvas } from './rendering/export';
import { fetchPdf, fetchQuote, storeRenders } from './api';
import { CheckIcon, CubeIcon } from './components/icons';

export function App() {
  const product = useConfigurator((s) => s.product);
  const config = useConfigurator((s) => s.config);
  const layout = useConfigurator((s) => s.layout)!;
  const mode = useConfigurator((s) => s.mode);
  const setMode = useConfigurator((s) => s.setMode);
  const init = useConfigurator((s) => s.init);
  const setAddons = useConfigurator((s) => s.setAddons);
  const setTier = useConfigurator((s) => s.setTier);

  const [embedded, setEmbedded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transportRef = useRef<ReturnType<typeof createChildTransport> | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<(addToCart?: boolean) => Promise<void>>(() => Promise.resolve());

  // Bridge: only active when the page is framed by a real host. When embedded,
  // the host owns the customer's working copy, so the app must not boot its own
  // default configuration first - that would look like a reset on every open.
  useEffect(() => {
    const parent = window.parent;
    if (parent === window) {
      init(undefined);
      return;
    }
    // Opened as a popup share the frame; a plain tab has no managing host.
    if (window.opener && window.opener === parent && document.referrer === '') {
      init(undefined);
      return;
    }
    let origin: string;
    try {
      origin = document.referrer ? new URL(document.referrer).origin : '*';
    } catch {
      origin = '*';
    }
    const transport = createChildTransport(parent, origin);
    transportRef.current = transport;
    setEmbedded(true);

    let lastAutoSave = 0;
    let initialised = false;
    let readyTimer = 0;
    const stopReady = () => {
      window.clearInterval(readyTimer);
      readyTimer = 0;
    };

    const unsub = transport.subscribe((msg: HostMessage) => {
      switch (msg.type) {
        case 'INIT':
          initialised = true;
          stopReady();
          if (msg.payload.config) init(msg.payload.config);
          break;
        case 'SET_ADDONS':
          setAddons(msg.selectedAddons);
          break;
        case 'SET_TIER':
          setTier(msg.tierId);
          break;
        case 'REQUEST_SAVE':
          void saveRef.current(false);
          break;
        case 'REQUEST_ADD_TO_CART':
          void saveRef.current(true);
          break;
        case 'RESET':
          init(undefined);
          break;
        case 'CLOSE':
          break;
      }
    });

    // Auto-save the draft (debounced) so a refresh never loses work. Only after
    // INIT: before that, the store still holds the bootstrap default.
    const unsubStore = useConfigurator.subscribe((state) => {
      if (!initialised || !state.dirty || Date.now() - lastAutoSave < 900) return;
      lastAutoSave = Date.now();
      transport.send({ type: 'AUTO_SAVE', config: state.config });
    });

    // The host may mount us lazily and miss the first READY, so repeat it until
    // it answers with INIT (then stop - no idle chatter afterwards).
    const announce = () => transport.send({ type: 'READY' });
    announce();
    readyTimer = window.setInterval(() => !initialised && announce(), 1200);
    const readyDeadline = window.setTimeout(stopReady, 60_000);

    return () => {
      stopReady();
      window.clearTimeout(readyDeadline);
      unsub();
      unsubStore();
      transport.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture3D = useCallback(() => {
    const canvas = sceneRef.current?.querySelector('canvas');
    try {
      return canvas ? { 'design-preview.png': captureCanvas(canvas, 1400) } : {};
    } catch {
      return {};
    }
  }, []);

  /**
   * One export for every consumer: the downloadable PDF, the save-and-close
   * flow and add-to-cart. The renders are produced from the configuration that
   * is on screen right now, so text added a second ago is always included.
   */
  async function buildExport() {
    setBusy('Rendering views…');
    const renders = await buildRenders(layout, config, capture3D());
    setBusy('Building PDF…');
    const pdf = await fetchPdf(config, renders);
    await storeRenders(config, renders).catch(() => undefined);
    return { renders, pdf };
  }

  async function save(addToCart = false) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const { renders, pdf } = await buildExport();
      const { quote } = await fetchQuote(config);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      const transport = transportRef.current;
      if (transport) {
        transport.send({
          type: addToCart ? 'ADD_TO_CART' : 'SAVED',
          config,
          quote,
          renders,
          ...(pdf ? { pdf: pdf.dataUrl } : {}),
        });
      } else if (!addToCart) {
        // Standalone: hand the customer the file they just generated.
        downloadDataUrl(pdf.dataUrl, `${config.designId}-configuration.pdf`);
      }
    } catch (e) {
      setError((e as Error).message || 'Could not save this design');
    } finally {
      setBusy(null);
      setSaving(false);
    }
  }
  saveRef.current = save;

  async function previewPdf() {
    setError(null);
    let url = '';
    try {
      const { pdf } = await buildExport();
      url = URL.createObjectURL(pdf.blob);
      const win = window.open(url, '_blank');
      if (!win) throw new Error('PDF ready — allow pop-ups to preview it');
    } catch (e) {
      setError((e as Error).message || 'Could not build the PDF');
    } finally {
      if (url) window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setBusy(null);
    }
  }

  const saveLabel = embedded ? 'Save & add to cart' : 'Save design';
  const views = useMemo(
    () => [
      { id: 'orbit', label: 'Orbit' },
      { id: 'front', label: 'Front' },
      { id: 'back', label: 'Back' },
      { id: 'left', label: 'Left' },
      { id: 'right', label: 'Right' },
      { id: 'top', label: 'Top' },
    ],
    [],
  );
  const [preset, setPreset] = useState<'orbit' | 'front' | 'back' | 'left' | 'right' | 'top'>('orbit');

  return (
    <div className="app">
      <header className="topbar">
        <div className="segmented mode-switch">
          <button type="button" data-active={mode === '3d'} onClick={() => setMode('3d')}>3D</button>
          <button type="button" data-active={mode === '2d'} onClick={() => setMode('2d')}>2D</button>
        </div>
        <span className="topbar-title">
          {mode === '2d' ? 'Customize in 2D' : 'Preview in 3D'} <em>|</em> {mode === '2d' ? 'Preview in 3D' : 'Customize in 2D'}
        </span>
        <div className="topbar-actions">
          {embedded && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => transportRef.current?.send({ type: 'CLOSE' })}
            >
              Cancel
            </button>
          )}
          {embedded ? (
            <button type="button" className="btn btn-primary" onClick={() => void save(true)} disabled={saving}>
              {saving ? 'Saving…' : 'Save & add to cart'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void save(false)} disabled={saving}>
              {saved ? <><CheckIcon /> Saved</> : saving ? 'Saving…' : saveLabel}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <button type="button" className="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <main className="workspace">
        <Sidebar product={product} />

        <section className="stage">
          <div className={mode === '2d' ? 'view view-active' : 'view'} aria-hidden={mode !== '2d'}>
            {mode === '2d' && <Canvas2D product={product} config={config} layout={layout} />}
          </div>

          <div ref={sceneRef} className={mode === '3d' ? 'view view-active' : 'view'} aria-hidden={mode !== '3d'}>
            {mode === '3d' && (
              <>
                <TentView product={product} config={config} layout={layout} cameraPreset={preset} />
                <div className="view-presets">
                  {views.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      data-active={preset === v.id}
                      onClick={() => setPreset(v.id as typeof preset)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="view-hint">Left-click &amp; drag to rotate · scroll to zoom · right-click &amp; drag to pan</p>
              </>
            )}
          </div>
        </section>

        <aside className="pricing">
          <PricePanel
            onSave={() => void save(!embedded)}
            saving={saving}
            saveLabel={embedded ? 'Save & add to cart' : saveLabel}
            onPreviewPdf={previewPdf}
            onAddToCart={embedded ? () => void save(true) : undefined}
          />
        </aside>
      </main>

      {busy && (
        <div className="overlay">
          <div className="overlay-card">
            <CubeIcon />
            <span>{busy}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
