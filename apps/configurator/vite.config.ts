import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@tent/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    // The storefront embeds this app in an iframe during development.
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
  preview: { port: 5174, headers: { 'Access-Control-Allow-Origin': '*' } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          konva: ['konva', 'react-konva'],
        },
      },
    },
  },
});
