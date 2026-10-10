// Test stand-in for the live Pages _worker.js, reproducing the dispatch shape given in the
// integration brief. The handler bodies are stubs that record what ran. This is NOT the
// production worker and is never deployed. integration.test.mjs applies the RUNBOOK.md
// patch to this file's text and checks the patched worker against the original.
export const calls = [];

async function counted(request, env, ctx) {
  calls.push(`counted ${request.method} ${new URL(request.url).pathname}`);
  const response = await env.ASSETS.fetch(request);
  if (!new URL(request.url).pathname.startsWith('/v1/')) return response;
  const shared = new Response(response.body, response);
  shared.headers.set('Access-Control-Allow-Origin', '*');
  return shared;
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/events") {
      const body = await request.text();
      calls.push(`events ${request.method} ${body}`);
      return new Response(JSON.stringify({ received: body.length }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
    if (pathname === "/api/agent-report" || pathname === "/mcp-log.html") {
      calls.push(`report ${pathname}`);
      return new Response("<!doctype html><p>Agent report</p>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (pathname === "/mcp") {
      calls.push(`mcp ${request.method}`);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
      }
      if (request.method === "POST") {
        const rpc = await request.json();
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { method: rpc.method } }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ name: "BillWatch", transport: "streamable-http" }), { headers: { "Content-Type": "application/json" } });
    }
    return counted(request, env, ctx);
  },
};
