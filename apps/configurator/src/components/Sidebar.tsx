/**
 * Sidebar: per-section customisation.
 *
 * "Sections" are printable parts. Selecting a wall in the 2D canvas or the part
 * list focuses it here, and each part owns its own colour, artwork and print
 * mode - which is what makes sections independently customisable.
 */
import { useRef, useState } from 'react';
import { SWATCHES, type ImageLayer, type ProductDefinition } from '@tent/core';
import { useConfigurator } from '../store';
import { loadImage } from '../rendering/assets';
import { uploadImage } from '../api';
import { CheckIcon, ChevronIcon, CloseIcon, LayersIcon, PaletteIcon, TextIcon, TrashIcon, UploadIcon } from './icons';

type Tab = 'uploads' | 'text' | 'background' | 'layers';
const MAX_BYTES = 10 * 1024 * 1024;

export function Sidebar({ product }: { product: ProductDefinition }) {
  const config = useConfigurator((s) => s.config);
  const layout = useConfigurator((s) => s.layout)!;
  const focusPartId = useConfigurator((s) => s.focusPartId);
  const focusedPart = config.parts[focusPartId] ?? Object.values(config.parts)[0];
  const setFocusPart = useConfigurator((s) => s.setFocusPart);
  const [tab, setTab] = useState<Tab>('uploads');
  const [open, setOpen] = useState(true);

  const partDef = product.parts.find((p) => p.id === focusedPart?.partId);
  const title = partDef ? `${partDef.label} configuration` : 'Configuration';
  const isWall = partDef?.kind === 'wall' || partDef?.kind === 'half-wall';
  const setPrintMode = useConfigurator((s) => s.setPrintMode);

  return (
    <div className="sidebar">
      <div className="section-rail">
        <button type="button" className="rail-btn" data-active={tab === 'uploads'} onClick={() => { setTab('uploads'); setOpen(true); }}>
          <UploadIcon /> <span>Uploads</span>
        </button>
        <button type="button" className="rail-btn" data-active={tab === 'text'} onClick={() => { setTab('text'); setOpen(true); }}>
          <TextIcon /> <span>Text</span>
        </button>
        <button type="button" className="rail-btn" data-active={tab === 'background'} onClick={() => { setTab('background'); setOpen(true); }}>
          <PaletteIcon /> <span>Background</span>
        </button>
        <button type="button" className="rail-btn" data-active={tab === 'layers'} onClick={() => { setTab('layers'); setOpen(true); }}>
          <LayersIcon /> <span>Layers</span>
        </button>
      </div>

      {open && (
        <div className="panel">
          <div className="panel-head">
            <span>{title}</span>
            <button type="button" className="icon-btn" aria-label="Close panel" onClick={() => setOpen(false)}>
              <CloseIcon />
            </button>
          </div>

          <div className="part-tabs" role="tablist" aria-label="Product sections">
            {Object.keys(config.parts).map((id) => {
              const def = product.parts.find((p) => p.id === id);
              return (
                <button
                  key={id}
                  role="tab"
                  aria-selected={focusedPart?.partId === id}
                  className="part-tab"
                  data-active={focusedPart?.partId === id}
                  onClick={() => setFocusPart(id)}
                >
                  {def?.label ?? id}
                </button>
              );
            })}
          </div>

          {focusedPart && tab === 'uploads' && <UploadsPanel partId={focusedPart.partId} layout={layout} />}
          {focusedPart && tab === 'text' && <TextPanel partId={focusedPart.partId} />}
          {focusedPart && tab === 'background' && <BackgroundPanel partId={focusedPart.partId} />}
          {focusedPart && tab === 'layers' && <LayersPanel partId={focusedPart.partId} />}

          {isWall && focusedPart && (
            <div className="field-row" style={{ marginTop: 14 }}>
              <span className="field-label">Print sides</span>
              <div className="segmented">
                <button
                  type="button"
                  data-active={focusedPart.printMode !== 'double'}
                  onClick={() => setPrintMode(focusedPart.partId, 'single')}
                >
                  Single
                </button>
                <button
                  type="button"
                  data-active={focusedPart.printMode === 'double'}
                  onClick={() => setPrintMode(focusedPart.partId, 'double')}
                >
                  Double
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function UploadsPanel({ partId, layout }: { partId: string; layout: NonNullable<ReturnType<typeof useConfigurator.getState>['layout']> }) {
  const addImage = useConfigurator((s) => s.addImage);
  const selectedLayerId = useConfigurator((s) => s.selectedLayerId);
  const part = useConfigurator((s) => s.config.parts[partId]);
  const updateLayer = useConfigurator((s) => s.updateLayer);
  const removeLayer = useConfigurator((s) => s.removeLayer);
  const moveLayer = useConfigurator((s) => s.moveLayer);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = part?.layers.find((l) => l.id === selectedLayerId && l.type === 'image') as ImageLayer | undefined;

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    try {
      const box = layout.partBoxes[partId];
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          setError(`${file.name} is over 10 MB`);
          continue;
        }
        if (!/^image\/(png|jpe?g|svg\+xml|webp)$/.test(file.type)) {
          setError(`${file.name} is not a supported image type`);
          continue;
        }
        const dataUrl = await fileToDataUrl(file);
        // Try the server first (durable storage); fall back to a local blob so
        // the tool still works offline.
        let asset: ImageLayer['asset'];
        let src = dataUrl;
        try {
          const up = await uploadImage(dataUrl, file.name);
          asset = { id: up.id, name: up.name, mime: up.mime, width: 0, height: 0 };
          src = up.url;
          await loadImage(up.id, up.url);
        } catch {
          const localId = `local-${file.name}-${file.lastModified}`;
          asset = { id: localId, name: file.name, mime: file.type, width: 0, height: 0 };
          await loadImage(localId, dataUrl);
        }
        const natural = await new Promise<{ w: number; h: number }>((resolve) => {
          const im = new Image();
          im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
          im.onerror = () => resolve({ w: 1, h: 1 });
          im.src = dataUrl;
        });
        const targetWidth = box.width * 0.45;
        const targetHeight = (natural.h / natural.w) * targetWidth;
        addImage(partId, {
          id: crypto.randomUUID(),
          src,
          x: (box.width - targetWidth) / 2,
          y: (box.height - targetHeight) / 2,
          width: targetWidth,
          height: Math.min(targetHeight, box.height * 0.6),
          rotation: 0,
          opacity: 1,
          visible: true,
          clipToPart: true,
          asset: asset ? { ...asset, width: natural.w, height: natural.h } : undefined,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-body">
      <button type="button" className="btn btn-primary btn-block" onClick={() => inputRef.current?.click()} disabled={busy}>
        <UploadIcon /> {busy ? 'Uploading…' : 'Add images'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        multiple
        hidden
        onChange={(e) => void onFiles(e.target.files)}
      />
      <p className="hint">Supports JPG, PNG, SVG formats · max 10MB</p>
      {error && <p className="hint error">{error}</p>}

      {!selected && <p className="hint">Select an image layer on the canvas to configure arrangement, depth or delete it.</p>}

      {selected && (
        <div className="layer-editor">
          <div className="field-row">
            <span className="field-label">Size</span>
            <RangeField
              value={selected.width}
              max={layout.partBoxes[partId]!.width * 1.5}
              onChange={(v) => {
                const ratio = selected.height / selected.width;
                updateLayer(partId, selected.id, { width: v, height: v * ratio });
              }}
            />
          </div>
          <div className="field-row">
            <span className="field-label">Rotation</span>
            <RangeField value={selected.rotation} min={-180} max={180} step={1} suffix="°" onChange={(v) => updateLayer(partId, selected.id, { rotation: v })} />
          </div>
          <div className="field-row">
            <span className="field-label">Opacity</span>
            <RangeField value={Math.round(selected.opacity * 100)} min={10} max={100} onChange={(v) => updateLayer(partId, selected.id, { opacity: v / 100 })} />
          </div>
          <div className="field-row">
            <span className="field-label">Arrangement</span>
            <div className="segmented">
              <button type="button" onClick={() => moveLayer(partId, selected.id, -1)} title="Send backward">Back</button>
              <button type="button" onClick={() => moveLayer(partId, selected.id, 1)} title="Bring forward">Front</button>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => removeLayer(partId, selected.id)}>
            <TrashIcon /> Remove layer
          </button>
        </div>
      )}
    </div>
  );
}

function TextPanel({ partId }: { partId: string }) {
  const addText = useConfigurator((s) => s.addText);
  const selectedLayerId = useConfigurator((s) => s.selectedLayerId);
  const part = useConfigurator((s) => s.config.parts[partId]);
  const updateLayer = useConfigurator((s) => s.updateLayer);
  const removeLayer = useConfigurator((s) => s.removeLayer);
  const layer = part?.layers.find((l) => l.id === selectedLayerId && l.type === 'text');

  if (!layer || layer.type !== 'text') {
    return (
      <div className="panel-body">
        <button type="button" className="btn btn-primary btn-block" onClick={() => addText(partId)}>
          <TextIcon /> Add text
        </button>
        <p className="hint">Add text, then drag it on the canvas. Select it again to edit.</p>
      </div>
    );
  }

  return (
    <div className="panel-body layer-editor">
      <label className="field">
        <span className="field-label">Content</span>
        <textarea value={layer.text} rows={2} onChange={(e) => updateLayer(partId, layer.id, { text: e.target.value })} />
      </label>
      <div className="field-row">
        <span className="field-label">Size</span>
        <RangeField value={layer.fontSize} min={20} max={800} onChange={(v) => updateLayer(partId, layer.id, { fontSize: v })} />
      </div>
      <div className="field-row">
        <span className="field-label">Tracking</span>
        <RangeField value={layer.letterSpacing} min={0} max={40} onChange={(v) => updateLayer(partId, layer.id, { letterSpacing: v })} />
      </div>
      <div className="field-row">
        <span className="field-label">Rotation</span>
        <RangeField value={layer.rotation} min={-180} max={180} suffix="°" onChange={(v) => updateLayer(partId, layer.id, { rotation: v })} />
      </div>
      <div className="field-row">
        <span className="field-label">Colour</span>
        <input type="color" value={layer.fill} onChange={(e) => updateLayer(partId, layer.id, { fill: e.target.value })} />
      </div>
      <button type="button" className="btn btn-ghost btn-block" onClick={() => removeLayer(partId, layer.id)}>
        <TrashIcon /> Remove text
      </button>
    </div>
  );
}

function BackgroundPanel({ partId }: { partId: string }) {
  const part = useConfigurator((s) => s.config.parts[partId]);
  const setPartColor = useConfigurator((s) => s.setPartColor);
  const [custom, setCustom] = useState('#f4f4f2');

  return (
    <div className="panel-body">
      <p className="hint">Fabric base colour for this panel. Printed via dye sublimation; Pantone references are sent to production.</p>
      <div className="swatches">
        {SWATCHES.map((s) => (
          <button
            key={s.id}
            type="button"
            className="swatch"
            title={s.pantone}
            data-active={part?.color.pantone === s.pantone}
            style={{ background: s.hex }}
            onClick={() => setPartColor(partId, { hex: s.hex, pantone: s.pantone })}
          >
            {part?.color.pantone === s.pantone && <CheckIcon />}
          </button>
        ))}
      </div>
      <div className="field-row" style={{ marginTop: 14 }}>
        <span className="field-label">Custom</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button type="button" className="btn btn-outline" onClick={() => setPartColor(partId, { hex: custom, pantone: `Custom ${custom.toUpperCase()}` })}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function LayersPanel({ partId }: { partId: string }) {
  const part = useConfigurator((s) => s.config.parts[partId]);
  const selectedLayerId = useConfigurator((s) => s.selectedLayerId);
  const selectLayer = useConfigurator((s) => s.selectLayer);
  const updateLayer = useConfigurator((s) => s.updateLayer);
  const removeLayer = useConfigurator((s) => s.removeLayer);
  const moveLayer = useConfigurator((s) => s.moveLayer);

  if (!part) return null;
  if (!part.layers.length) return <div className="panel-body"><p className="hint">No artwork on this panel yet.</p></div>;

  return (
    <div className="panel-body">
      {[...part.layers].reverse().map((layer) => (
        <div key={layer.id} className="layer-row" data-active={selectedLayerId === layer.id}>
          <button type="button" className="layer-name" onClick={() => selectLayer(partId, layer.id)}>
            {layer.type === 'image' ? <UploadIcon /> : <TextIcon />}
            <span>{layer.type === 'image' ? layer.asset?.name ?? 'Image' : `"${layer.text}"`}</span>
          </button>
          <div className="layer-actions">
            <button type="button" className="icon-btn" aria-label="Toggle visibility" onClick={() => updateLayer(partId, layer.id, { visible: !layer.visible })}>
              {layer.visible ? '👁' : '⃠'}
            </button>
            <button type="button" className="icon-btn" aria-label="Move up" onClick={() => moveLayer(partId, layer.id, 1)}><ChevronIcon direction="up" /></button>
            <button type="button" className="icon-btn" aria-label="Move down" onClick={() => moveLayer(partId, layer.id, -1)}><ChevronIcon direction="down" /></button>
            <button type="button" className="icon-btn" aria-label="Delete" onClick={() => removeLayer(partId, layer.id)}><TrashIcon /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RangeField(props: { value: number; min?: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void }) {
  return (
    <div className="range">
      <input
        type="range"
        min={props.min ?? 0}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span>{Math.round(props.value)}{props.suffix}</span>
    </div>
  );
}
