import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../../src/server/app';

/**
 * Vercel Function entry for the BuildLog API (/api/*).
 *
 * scripts/build-vercel.mjs bundles this file (and all dependencies) into
 * .vercel/output/functions/api.func/index.mjs. It runs with Vercel's Node.js helpers turned off,
 * so the request body stream is untouched and GitHub webhook signatures can be verified on the
 * raw bytes.
 *
 * The routing rule in .vercel/output/config.json sends /api/<path> to this function as
 * /api?__bl_path=<path>; the original path is restored here before Express routes it.
 */
const app = createApp();

export const FORWARDED_PATH_PARAM = '__bl_path';

export function restoreOriginalUrl(rawUrl: string | undefined): string {
  const url = new URL(rawUrl || '/', 'http://localhost');
  const forwarded = url.searchParams.get(FORWARDED_PATH_PARAM);
  url.searchParams.delete(FORWARDED_PATH_PARAM);
  const query = url.searchParams.toString();
  const pathname =
    forwarded !== null && !url.pathname.startsWith('/api/')
      ? `/api/${forwarded.replace(/^\/+/, '')}`
      : url.pathname;
  return `${pathname}${query ? `?${query}` : ''}`;
}

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  req.url = restoreOriginalUrl(req.url);
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
