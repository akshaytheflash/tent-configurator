/**
 * Embedding bridge.
 *
 * The configurator runs in an iframe on another site (Shopify). The two sides
 * talk over postMessage with a small, versioned protocol. Both directions are
 * origin-checked, and the storefront never trusts a price sent by the iframe:
 * it receives the configuration, asks the pricing API itself, then adds to cart.
 */
import type { CustomerConfiguration, Quote } from './types';

export const BRIDGE_SOURCE = 'tent-configurator';
export const BRIDGE_VERSION = 1;

/** Messages the storefront sends *into* the iframe. */
export type HostMessage =
  | { type: 'INIT'; payload: { config?: CustomerConfiguration; variantId?: string } }
  | { type: 'SET_ADDONS'; selectedAddons: string[] }
  | { type: 'SET_TIER'; tierId: string }
  | { type: 'REQUEST_SAVE' }
  | { type: 'REQUEST_ADD_TO_CART' }
  | { type: 'RESET' }
  | { type: 'CLOSE' };

/** Messages the iframe sends *out* to the storefront. */
/**
 * `renders` are the print/preview PNG data URLs the configurator produced for
 * this save. They can be large, so the host should treat them as optional and
 * be able to ask for a fresh export on demand.
 */
export type DesignRenders = Record<string, string>;

export type ClientMessage =
  | { type: 'READY' }
  | { type: 'AUTO_SAVE'; config: CustomerConfiguration }
  | { type: 'SAVED'; config: CustomerConfiguration; quote: Quote; renders?: DesignRenders; pdf?: string }
  | { type: 'ADD_TO_CART'; config: CustomerConfiguration; quote: Quote; renders?: DesignRenders; pdf?: string }
  | { type: 'CLOSE' }
  | { type: 'ERROR'; message: string };

const HOST_TYPES = new Set(['INIT', 'SET_ADDONS', 'SET_TIER', 'REQUEST_SAVE', 'REQUEST_ADD_TO_CART', 'RESET', 'CLOSE']);
const CLIENT_TYPES = new Set(['READY', 'AUTO_SAVE', 'SAVED', 'ADD_TO_CART', 'CLOSE', 'ERROR']);

function envelopeOf(data: unknown): { type: string; rest: Record<string, unknown> } | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.source !== BRIDGE_SOURCE || typeof d.type !== 'string') return null;
  return { type: d.type, rest: d };
}

export function isHostMessage(data: unknown): data is HostMessage & { source: string; version: number } {
  const env = envelopeOf(data);
  return env !== null && HOST_TYPES.has(env.type);
}

export function isClientMessage(data: unknown): data is ClientMessage & { source: string; version: number } {
  const env = envelopeOf(data);
  return env !== null && CLIENT_TYPES.has(env.type);
}

function post(target: Window, targetOrigin: string, msg: HostMessage | ClientMessage) {
  target.postMessage({ source: BRIDGE_SOURCE, version: BRIDGE_VERSION, ...msg }, targetOrigin);
}

/** Transport for the configurator running inside the iframe. */
export function createChildTransport(parent: Window, parentOrigin: string) {
  const listeners = new Set<(m: HostMessage) => void>();
  const onMessage = (e: MessageEvent) => {
    if (e.source !== parent) return;
    if (parentOrigin !== '*' && e.origin !== parentOrigin) return;
    if (!isHostMessage(e.data)) return;
    listeners.forEach((fn) => fn(e.data));
  };
  window.addEventListener('message', onMessage);
  return {
    send(msg: ClientMessage) {
      post(parent, parentOrigin, msg);
    },
    subscribe(fn: (m: HostMessage) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      window.removeEventListener('message', onMessage);
      listeners.clear();
    },
  };
}

/** Transport for the storefront hosting the iframe. */
export function createHostTransport(
  iframe: HTMLIFrameElement,
  configuratorOrigin: string,
) {
  const listeners = new Set<(m: ClientMessage) => void>();
  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    if (e.origin !== configuratorOrigin) return;
    if (!isClientMessage(e.data)) return;
    listeners.forEach((fn) => fn(e.data));
  };
  window.addEventListener('message', onMessage);
  return {
    send(msg: HostMessage) {
      iframe.contentWindow?.postMessage(
        { source: BRIDGE_SOURCE, version: BRIDGE_VERSION, ...msg },
        configuratorOrigin,
      );
    },
    subscribe(fn: (m: ClientMessage) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      window.removeEventListener('message', onMessage);
      listeners.clear();
    },
  };
}
