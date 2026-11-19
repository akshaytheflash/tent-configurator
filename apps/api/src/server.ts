/**
 * Local entry point: opens an HTTP listener. Serverless deployments import
 * `app.ts` directly instead.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import app from './app.js';

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.data');

await mkdir(join(DATA_DIR, 'uploads'), { recursive: true });
await mkdir(join(DATA_DIR, 'orders'), { recursive: true });

app.listen(PORT, () => {
  console.log(`Mock pricing/CRM API on http://localhost:${PORT} (data: ${DATA_DIR})`);
});
