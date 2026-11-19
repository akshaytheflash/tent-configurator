/**
 * Configurator store.
 *
 * One configuration document lives here. Every UI surface (2D canvas, 3D scene,
 * sidebar, price panel) reads from it, so there is no state to synchronise and
 * no way for the views to disagree. Mutations are small and explicit.
 */
import { create } from 'zustand';
import {
  buildLayout,
  createConfiguration,
  getProduct,
  reconcileParts,
  type CustomerConfiguration,
  type ImageLayer,
  type Layer,
  type Layout,
  type ProductDefinition,
  type TextLayer,
} from '@tent/core';

export type FocusPart = string | null;
export type ViewMode = '2d' | '3d';

interface ConfiguratorState {
  product: ProductDefinition;
  config: CustomerConfiguration;
  layout: Layout | null;
  mode: ViewMode;
  selectedLayerId: string | null;
  /** Which part the sidebar is configuring. */
  focusPartId: string;
  zoom: { scale: number; x: number; y: number };
  dirty: boolean;

  init(config?: CustomerConfiguration): void;
  setMode(mode: ViewMode): void;
  selectLayer(partId: string, layerId: string | null): void;
  setFocusPart(partId: string): void;
  setZoom(z: { scale: number; x: number; y: number }): void;

  setTier(tierId: string): void;
  setAddons(addons: string[]): void;
  setPartColor(partId: string, color: CustomerConfiguration['parts'][string]['color']): void;
  addImage(partId: string, layer: Omit<ImageLayer, 'partId' | 'type'>): void;
  addText(partId: string): void;
  updateLayer(partId: string, layerId: string, patch: Partial<Layer>): void;
  removeLayer(partId: string, layerId: string): void;
  moveLayer(partId: string, layerId: string, direction: -1 | 1): void;
  setPrintMode(partId: string, mode: 'single' | 'double'): void;

  replaceConfig(config: CustomerConfiguration): void;
}

/** Initial product + config + matching layout, computed together. */
function bootstrapState() {
  const product = getProduct('tent-10x10')!;
  const config = createConfiguration({ productId: product.id });
  return { product, config, layout: buildLayout(product, Object.keys(config.parts)) };
}

function withLayout(config: CustomerConfiguration, product: ProductDefinition) {
  return {
    config,
    layout: buildLayout(product, Object.keys(config.parts)),
    dirty: true,
  };
}

export const useConfigurator = create<ConfiguratorState>((set, get) => ({
  ...bootstrapState(),
  mode: '2d',
  selectedLayerId: null,
  focusPartId: 'roof',
  zoom: { scale: 1, x: 0, y: 0 },
  dirty: false,

  init(config) {
    const base = config ?? createConfiguration({ productId: 'tent-10x10' });
    const product = getProduct(base.productId) ?? getProduct('tent-10x10')!;
    const reconciled = reconcileParts({ ...base, productId: product.id }, product);
    set({
      product,
      ...withLayout(reconciled, product),
      focusPartId: 'roof',
      selectedLayerId: null,
      dirty: false,
    });
  },

  setMode: (mode) => set({ mode }),
  selectLayer: (partId, layerId) => set({ selectedLayerId: layerId, focusPartId: partId }),
  setFocusPart: (focusPartId) => set({ focusPartId, selectedLayerId: null }),
  setZoom: (zoom) => set({ zoom }),

  setTier(tierId) {
    const { config, product } = get();
    set(withLayout({ ...config, tierId, updatedAt: new Date().toISOString() }, product));
  },

  setAddons(selectedAddons) {
    const { config, product } = get();
    set(
      withLayout(
        reconcileParts({ ...config, selectedAddons, updatedAt: new Date().toISOString() }, product),
        product,
      ),
    );
  },

  setPartColor(partId, color) {
    const { config, product } = get();
    const part = config.parts[partId];
    if (!part) return;
    set(
      withLayout(
        {
          ...config,
          parts: { ...config.parts, [partId]: { ...part, color } },
          updatedAt: new Date().toISOString(),
        },
        product,
      ),
    );
  },

  addImage(partId, layer) {
    const { config, product } = get();
    const part = config.parts[partId];
    if (!part) return;
    const full: ImageLayer = { ...layer, partId, type: 'image' };
    set({
      ...withLayout(
        {
          ...config,
          parts: { ...config.parts, [partId]: { ...part, layers: [...part.layers, full] } },
          updatedAt: new Date().toISOString(),
        },
        product,
      ),
      selectedLayerId: full.id,
      focusPartId: partId,
    });
  },

  addText(partId) {
    const { config, product, layout } = get();
    const part = config.parts[partId];
    const box = layout?.partBoxes[partId];
    if (!part || !box) return;
    const size = Math.round(Math.min(box.width, box.height) * 0.18);
    const layer: TextLayer = {
      id: crypto.randomUUID(),
      type: 'text',
      partId,
      text: 'YOUR BRAND',
      x: Math.round(box.width * 0.1),
      y: Math.round(box.height / 2 - size / 2),
      fontSize: Math.max(24, size),
      fontFamily: 'Inter',
      fill: '#ffffff',
      rotation: 0,
      opacity: 1,
      visible: true,
      align: 'center',
      letterSpacing: 0,
    };
    set({
      ...withLayout(
        {
          ...config,
          parts: { ...config.parts, [partId]: { ...part, layers: [...part.layers, layer] } },
          updatedAt: new Date().toISOString(),
        },
        product,
      ),
      selectedLayerId: layer.id,
      focusPartId: partId,
    });
  },

  updateLayer(partId, layerId, patch) {
    const { config, product } = get();
    const part = config.parts[partId];
    if (!part) return;
    set(
      withLayout(
        {
          ...config,
          parts: {
            ...config.parts,
            [partId]: {
              ...part,
              layers: part.layers.map((l) => (l.id === layerId ? ({ ...l, ...patch } as Layer) : l)),
            },
          },
          updatedAt: new Date().toISOString(),
        },
        product,
      ),
    );
  },

  removeLayer(partId, layerId) {
    const { config, product } = get();
    const part = config.parts[partId];
    if (!part) return;
    set({
      ...withLayout(
        {
          ...config,
          parts: { ...config.parts, [partId]: { ...part, layers: part.layers.filter((l) => l.id !== layerId) } },
          updatedAt: new Date().toISOString(),
        },
        product,
      ),
      selectedLayerId: get().selectedLayerId === layerId ? null : get().selectedLayerId,
    });
  },

  moveLayer(partId, layerId, direction) {
    const { config, product } = get();
    const part = config.parts[partId];
    if (!part) return;
    const index = part.layers.findIndex((l) => l.id === layerId);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= part.layers.length) return;
    const layers = [...part.layers];
    const [moved] = layers.splice(index, 1);
    layers.splice(target, 0, moved);
    set(
      withLayout(
        {
          ...config,
          parts: { ...config.parts, [partId]: { ...part, layers } },
          updatedAt: new Date().toISOString(),
        },
        product,
      ),
    );
  },

  setPrintMode(partId, mode) {
    const { config, product } = get();
    const part = config.parts[partId];
    if (!part) return;
    // The add-on drives print mode for commerce; here we mirror it onto the part.
    const addons = new Set(config.selectedAddons);
    const def = product.parts.find((p) => p.id === partId);
    if (def?.kind === 'half-wall') {
      addons.delete('halfwall-single');
      addons.delete('halfwall-double');
      addons.add(mode === 'double' ? 'halfwall-double' : 'halfwall-single');
    } else if (def?.kind === 'wall') {
      const count = config.selectedAddons.some((a) => a === 'wall-double-3' || a === 'wall-single-3') ? 3 : 1;
      for (const a of ['wall-single-1', 'wall-double-1', 'wall-single-3', 'wall-double-3']) addons.delete(a);
      addons.add(`wall-${mode}-${count}`);
    }
    const selectedAddons = [...addons];
    set(
      withLayout(
        reconcileParts({ ...config, selectedAddons, updatedAt: new Date().toISOString() }, product),
        product,
      ),
    );
  },

  replaceConfig(config) {
    const { product } = get();
    set(withLayout(config, product));
  },
}));
