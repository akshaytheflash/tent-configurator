/**
 * Bundles the API into a single file. `@tent/core` is inlined so the deployment
 * is one artefact. Format follows SERVERLESS=1: serverless platforms load the
 * function as CJS, while local dev/start use ESM.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const serverless = process.env.SERVERLESS === '1';

await build({
  entryPoints: [fileURLToPath(new URL('./src/server.ts', import.meta.url))],
  outfile: fileURLToPath(new URL(serverless ? './dist/server.cjs' : './dist/server.js', import.meta.url)),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: serverless ? 'cjs' : 'esm',
  sourcemap: !serverless,
  packages: 'external',
  logLevel: 'info',
});
