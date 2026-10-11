import { readFileSync } from 'node:fs';

const REPO = new URL('../../', import.meta.url);
/** Read a file from the repository root (the published data mirror lives there). */
export const readRepo = (path) => readFileSync(new URL(path, REPO));

/** Any attempt to use the network from worker code fails the test that made it. */
export function blockNetwork() {
  globalThis.fetch = async (input) => {
    throw new Error(`Network access attempted: ${input?.url ?? input}`);
  };
}

/**
 * Stand-in for the Pages static asset binding (env.ASSETS). Serves an in-memory map of
 * pathname -> { body, type } (or { redirect }) and records every read as "METHOD /path?query".
 * `body` may be a function of the request, to simulate failures.
 */
export function createAssets(files = {}) {
  const log = [];
  return {
    log,
    async fetch(input) {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      log.push(`${request.method} ${url.pathname}${url.search}`);
      const file = files[url.pathname];
      if (typeof file === 'function') return file(request);
      if (!file) return new Response(request.method === 'HEAD' ? null : 'Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      if (file.redirect) return new Response(null, { status: 308, headers: { Location: file.redirect } });
      return new Response(request.method === 'HEAD' ? null : file.body, {
        status: 200,
        headers: { 'Content-Type': file.type, 'Cache-Control': 'public, max-age=0, must-revalidate' },
      });
    },
  };
}

export const json = (value) => ({ body: JSON.stringify(value), type: 'application/json' });

/** Stand-in for a D1 binding that records every successful write. */
export function createClicks() {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      return { bind(...values) { return { async run() { writes.push({ sql, values }); return { success: true }; } }; } };
    },
  };
}
