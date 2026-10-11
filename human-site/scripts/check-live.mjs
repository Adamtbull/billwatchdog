import { loadDeals, loadHistory, isVerified } from '../src/data.mjs';
// Read-only check run from a developer machine. In production the worker reads these files
// through env.ASSETS; here a stand-in reads the live site's public /v1 files instead.
const ORIGIN='https://getbillwatchdog.com';
const assets={fetch:request=>fetch(ORIGIN+new URL(request.url).pathname,{headers:{Accept:'application/json','User-Agent':'billwatch-integration-check'}})};
const now=new Date();
const data=await loadDeals(assets,ORIGIN,now);
console.log(JSON.stringify({checkedAt:now.toISOString(),source:`${ORIGIN}/v1/deals.json`,feedUpdated:data.meta.updated,count:data.deals.length,verified:data.deals.filter(d=>isVerified(d,now)).length,safeProviderUrls:data.deals.filter(d=>d.plainProviderUrl).length},null,2));
const plan=data.deals.find(d=>d.id==='nordvpn-basic-2-year-term')||data.deals[0];
try{const history=await loadHistory(plan.id,assets,ORIGIN);console.log(JSON.stringify({historyPlan:plan.id,points:history.points.length},null,2));}catch(error){console.error('Live history check failed:',error.message);process.exitCode=1;}
// No /go route is requested, so this check does not change production click counters.
