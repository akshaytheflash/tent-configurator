/**
 * Bundles the API into a single ESM file. Keeping `@tent/core` inlined means a
 * single deployable artefact and no cross-package emit problems.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('./src/server.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./dist/server.js', import.meta.url)),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  logLevel: 'info',
});
