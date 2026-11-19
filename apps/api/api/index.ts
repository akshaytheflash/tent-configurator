/**
 * Vercel entry point for the mock pricing/CRM service.
 *
 * Imports the Express app from source (relative paths only, because serverless
 * builders do not always honour tsconfig path aliases) so the platform bundles
 * the whole dependency graph.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const mod = await import('../src/app.js');
  return mod.default(req, res);
}
