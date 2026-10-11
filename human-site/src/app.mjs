import { loadDeals, loadHistory } from './data.mjs';
import { handleGo } from './redirect.mjs';
import { homePage, categoryPage, planPage, comparisonPage, disclosurePage, errorPage, COMPARISONS } from './render.mjs';

export const SECURITY_HEADERS = {
 'Content-Type':'text/html; charset=utf-8',
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};
function html(body, status=200) { return new Response(body,{status,headers:SECURITY_HEADERS}); }
/** Return null for unowned routes. The existing site remains the route owner. */
export async function handleHumanRequest(request, env = {}, { fetcher = fetch, now = new Date() } = {}) {
 const url = new URL(request.url), path = url.pathname;
 const plan = /^\/plans\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(path);
 const comparison = /^\/compare\/([A-Za-z0-9_-]+)\/?$/.exec(path);
 const category = /^\/(vpn|streaming)\/?$/.exec(path);
 const disclosure = /^\/affiliate-disclosure\/?$/.test(path);
 const owned = path==='/' || plan || comparison || category || disclosure || path.startsWith('/go/');
 if (!owned) return null;
 if (path.startsWith('/go/')) return handleGo(request, env, {fetcher, now});
 if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
 if (comparison && !Object.hasOwn(COMPARISONS, comparison[1])) return html(errorPage(404,'Comparison not found','Choose one of our published provider comparisons.'),404);
 if (path!=='/' && !path.endsWith('/')) return new Response(null,{status:308,headers:{Location:path+'/'+url.search,'Cache-Control':'no-store'}});
 if (request.method==='HEAD') {
   const result = await handleHumanRequest(new Request(request.url,{method:'GET'}),env,{fetcher,now});
   return new Response(null,{status:result.status,headers:result.headers});
 }
 if (disclosure) return html(disclosurePage(now));
 try {
   const data=await loadDeals(fetcher, undefined, now);
   const sort=['price','provider','plan','billing'].includes(url.searchParams.get('sort'))?url.searchParams.get('sort'):'price';
   const direction=url.searchParams.get('direction')==='desc'?'desc':'asc';
   const options={sort,direction};
   if (path==='/') return html(homePage(data,now));
   if (category) return html(categoryPage(data,category[1],now,options));
   if (comparison) return html(comparisonPage(data,comparison[1],now,options));
   if (plan) {
     const deal=data.deals.find(d=>d.id===plan[1]);
     if (!deal) return html(errorPage(404,'Plan not found','This plan ID is not in the current source feed.'),404);
     let history=null, historyProblem=false;
     try { history=await loadHistory(deal.id,fetcher); } catch { historyProblem=true; }
     return html(planPage(deal,history,now,historyProblem));
   }
 } catch {
   return html(errorPage(503,'Prices are temporarily unavailable','The live price source could not be loaded or validated. We haven’t substituted old or estimated prices.',path),503);
 }
 return null;
}
