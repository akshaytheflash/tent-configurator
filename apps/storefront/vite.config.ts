import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Local dev serves the configurator build through the same origin under
 * `/designer/`, mirroring production. Testing through a cross-origin iframe on
 * localhost lets a preview popup adopt this tab's browsing context group, which
 * makes the embed unreliable in a shared browser.
 */
const CONFIGURATOR = process.env.CONFIGURATOR_ORIGIN ?? 'http://localhost:5174';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/designer': { target: CONFIGURATOR, changeOrigin: false },
      '/models': { target: CONFIGURATOR, changeOrigin: false },
    },
  },
});
