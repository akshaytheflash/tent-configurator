/**
 * Configurator shell.
 *
 * Owns the two views (2D editor / 3D preview), the persistence flow and the
 * host bridge. When embedded in Shopify the host sends INIT with any saved
 * draft; when running standalone the app boots with a default configuration.
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

  // Ensure the store holds a layout that matches the active configuration
  // before anything renders (the bootstrap state is kept in sync too).
  useEffect(() => {
    init(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [embedded, setEmbedded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const transportRef = useRef<ReturnType<typeof createChildTransport> | null>(null);
  const sceneRef = useRef<HTMLDivElement>(null);

  // Bridge: only active when the page is framed by a real host.
  useEffect(() => {
    const parent = window.parent;
    if (parent === window) return;
    const origin = new URL(document.referrer).origin;
    const transport = createChildTransport(parent, origin);
    transportRef.current = transport;
    setEmbedded(true);

    let lastAutoSave = 0;
    const unsub = transport.subscribe((msg: HostMessage) => {
      switch (msg.type) {
        case 'INIT':
          if (msg.payload.config) init(msg.payload.config);
          break;
        case 'SET_ADDONS':
          setAddons(msg.selectedAddons);
          break;
        case 'SET_TIER':
          setTier(msg.tierId);
          break;
        case 'REQUEST_SAVE':
          void save();
          break;
        case 'RESET':
          init(undefined);
          break;
        case 'CLOSE':
          break;
      }
    });

    // Auto-save the draft (debounced) so a refresh never loses work.
    const unsubStore = useConfigurator.subscribe((state) => {
      if (state.dirty && Date.now() - lastAutoSave > 900) {
        lastAutoSave = Date.now();
        transport.send({ type: 'AUTO_SAVE', config: state.config });
      }
    });

    transport.send({ type: 'READY' });
    return () => {
      unsub();
      unsubStore();
      transport.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture3D = useCallback(() => {
    const canvas = sceneRef.current?.querySelector('canvas');
    return canvas ? { 'design-preview.png': captureCanvas(canvas, 1400) } : {};
  }, []);

  async function save() {
    setSaving(true);
    try {
      const { quote } = await fetchQuote(config);
      // Produce the artefacts the order needs while we still have the scene.
      const renders = buildRenders(layout, config, capture3D());
      await storeRenders(config, renders);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      transportRef.current?.send({ type: 'SAVED', config, quote, renders });
    } finally {
      setSaving(false);
    }
  }

  async function previewPdf() {
    setBusy('Rendering views…');
    try {
      const renders = buildRenders(layout, config, capture3D());
      setBusy('Building PDF…');
      const { url } = await fetchPdf(config, renders);
      window.open(url, '_blank');
    } finally {
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
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saved ? <><CheckIcon /> Saved</> : saving ? 'Saving…' : 'Save & Exit'}
        </button>
      </header>

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
          <PricePanel onSave={() => void save()} saving={saving} saveLabel={saveLabel} onPreviewPdf={previewPdf} />
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
