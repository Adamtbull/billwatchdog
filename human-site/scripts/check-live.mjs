import { loadDeals, loadHistory, isVerified } from '../src/data.mjs';
const now=new Date();
const data=await loadDeals();
console.log(JSON.stringify({checkedAt:now.toISOString(),source:'https://getbillwatchdog.com/v1/deals.json',feedUpdated:data.meta.updated,count:data.deals.length,verified:data.deals.filter(d=>isVerified(d)).length,safeProviderUrls:data.deals.filter(d=>d.plainProviderUrl).length},null,2));
const plan=data.deals.find(d=>d.id==='nordvpn-basic-2-year-term')||data.deals[0];
try{const history=await loadHistory(plan.id);console.log(JSON.stringify({historyPlan:plan.id,points:history.points.length},null,2));}catch(error){console.error('Live history check failed:',error.message);process.exitCode=1;}
// No /go route is requested, so this check does not change production click counters.
