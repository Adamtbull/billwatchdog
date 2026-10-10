import { loadDeals, loadHistory } from './data.mjs';
import { handleGo } from './redirect.mjs';
import { homePage, categoryPage, planPage, comparisonPage, disclosurePage, errorPage, COMPARISONS } from './render.mjs';
import { matchHumanRoute } from './routes.mjs';

export const SECURITY_HEADERS = {
 'Content-Type':'text/html; charset=utf-8',
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};
function html(body, status=200) { return new Response(body,{status,headers:SECURITY_HEADERS}); }

/**
 * Worker entry point for the human pages. The live _worker.js calls it first:
 *   const humanResponse = await BillWatchHuman.handleHumanRequest(request, env, ctx, { homepage: HUMAN_HOMEPAGE });
 *   if (humanResponse) return humanResponse;
 * For any path it does not own it returns null straight away: no I/O, no bindings touched,
 * request body unread. The existing dispatch then handles that request exactly as before.
 * Options: homepage (true serves the human homepage at "/"; anything else leaves "/" alone),
 * now (a fixed clock for tests).
 */
export async function handleHumanRequest(request, env = {}, ctx = undefined, options = {}) {
 const url = new URL(request.url);
 const route = matchHumanRoute(url.pathname, { homepage: options?.homepage === true });
 if (!route) return null;
 try {
   return await respond(request, url, route, env, options?.now ?? new Date());
 } catch {
   // A bug on a human route must not fall through to another handler or leak details.
   return new Response('BillWatch could not show this page. Please try again later.',{status:500,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
}

async function respond(request, url, route, env, now) {
 const path = url.pathname;
 if (route.kind==='go') return handleGo(request, env, {now});
 if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
 if (route.kind==='compare' && !Object.hasOwn(COMPARISONS, route.param)) return html(errorPage(404,'Comparison not found','Choose one of our published provider comparisons.'),404);
 if (path!=='/' && !path.endsWith('/')) return new Response(null,{status:308,headers:{Location:path+'/'+url.search,'Cache-Control':'no-store'}});
 if (request.method==='HEAD') {
   const result = await respond(new Request(request.url,{method:'GET'}),url,route,env,now);
   return new Response(null,{status:result.status,headers:result.headers});
 }
 if (route.kind==='disclosure') return html(disclosurePage(now));
 try {
   const data=await loadDeals(env?.ASSETS, request.url, now);
   const sort=['price','provider','plan','billing'].includes(url.searchParams.get('sort'))?url.searchParams.get('sort'):'price';
   const direction=url.searchParams.get('direction')==='desc'?'desc':'asc';
   const options={sort,direction};
   if (route.kind==='home') return html(homePage(data,now));
   if (route.kind==='category') return html(categoryPage(data,route.param,now,options));
   if (route.kind==='compare') return html(comparisonPage(data,route.param,now,options));
   if (route.kind==='plan') {
     const deal=data.deals.find(d=>d.id===route.param);
     if (!deal) return html(errorPage(404,'Plan not found','This plan ID is not in the current source feed.'),404);
     let history=null, historyProblem=false;
     try { history=await loadHistory(deal.id, env?.ASSETS, request.url); } catch { historyProblem=true; }
     return html(planPage(deal,history,now,historyProblem));
   }
 } catch {
   return html(errorPage(503,'Prices are temporarily unavailable','The live price source could not be loaded or validated. We haven’t substituted old or estimated prices.',path),503);
 }
 // An owned route must never fall through to the existing dispatch.
 throw new Error(`Unhandled human route: ${route.kind}`);
}
