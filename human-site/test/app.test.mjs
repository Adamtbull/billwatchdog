import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleHumanRequest } from '../src/app.mjs';
import { normalizeDeals } from '../src/data.mjs';
import { homePage, planPage, productSchema } from '../src/render.mjs';
const now=new Date('2026-10-10T06:00:00Z');
// Deliberately synthetic, isolated test data. Never used by the running site.
const plan={id:'nordvpn-test-plan',provider:'NordVPN',category:'vpn',plan:'Test plan',price_usd_monthly:3.14159,billing:'$75.39816 billed upfront for 24 months; renewal not supplied',url:'https://nordvpn.com/?ref=tracking',source_url:'https://nordvpn.com/pricing/',status:'active',verified:true,affiliate:false,checked_at:'2026-10-09',check_cadence_days:7,last_check_status:'ok',next_check:'2026-10-16',promo_ends:null};
const envelope={meta:{updated:'2026-10-09',currency:'USD'},deals:[plan,{...plan,id:'surfshark-test-plan',provider:'Surfshark',price_usd_monthly:2.9,url:'https://surfshark.com',source_url:'https://surfshark.com/pricing'},{...plan,id:'netflix-test-plan',provider:'Netflix',category:'streaming',price_usd_monthly:8.12345,billing:'monthly',url:'https://www.netflix.com',source_url:'https://www.netflix.com/ads-plan'},{...plan,id:'hulu-test-plan',provider:'Hulu',category:'streaming',price_usd_monthly:12,billing:'monthly',url:'https://www.hulu.com',source_url:'https://help.hulu.com/article/test'}]};
const calls=[];
const fetcher=async url=>{calls.push(url);return new Response(JSON.stringify(url.includes('price-history')?{plan_id:plan.id,history:[{date:'2026-10-08',price_usd_monthly:3.5},{date:'2026-10-09',price_usd_monthly:3.14159}]}:envelope),{headers:{'Content-Type':'application/json'}});};
const request=path=>new Request('https://getbillwatchdog.com'+path);
const get=path=>handleHumanRequest(request(path),{}, {fetcher,now});

test('all requested human routes server-render without JavaScript and link disclosure',async()=>{
 for(const path of ['/','/vpn/','/streaming/','/plans/nordvpn-test-plan/','/compare/nordvpn-vs-surfshark/','/compare/netflix-vs-hulu/','/affiliate-disclosure/']){
  const response=await get(path);assert.equal(response.status,200,path);const text=await response.text();assert.match(text,/<!doctype html>/);assert.match(text,/href="\/affiliate-disclosure\/"/);assert.match(text,/<html lang="en-US">/);
 }
});
test('preserved API and agent routes are never fetched, mutated or replaced',async()=>{
 calls.length=0;
 for(const path of ['/v1/deals.json','/v1/deals/vpn.json','/v1/price-history/test.json','/mcp','/llms.txt','/agent.json','/.well-known/agent.json','/api','/privacy','/disclosure','/styles.css'])assert.equal(await get(path),null,path);
 assert.equal(calls.length,0);
});
test('unknown plans and comparisons get an honest 404',async()=>{for(const path of ['/plans/unknown/','/compare/unknown/','/compare/constructor/','/compare/toString/'])assert.equal((await get(path)).status,404);});
test('source failures never silently substitute sample or stale data',async()=>{
 const result=await handleHumanRequest(request('/vpn/'),{}, {now,fetcher:async()=>new Response('fail',{status:500})});assert.equal(result.status,503);assert.match(await result.text(),/haven’t substituted old or estimated prices/);
});
test('bad source schema produces a useful 503',async()=>{assert.equal((await handleHumanRequest(request('/'),{}, {now,fetcher:async()=>new Response('{}')})).status,503);});
test('HTML source never rounds exact API price and shows full upfront billing',async()=>{const text=await(await get('/plans/nordvpn-test-plan/')).text();assert.match(text,/\$3\.14159/);assert.match(text,/\$75\.39816 billed upfront for 24 months/);});
test('all get-deal CTAs use measurable /go IDs and not raw provider URLs',async()=>{
 for(const path of ['/','/vpn/','/streaming/','/compare/nordvpn-vs-surfshark/','/plans/nordvpn-test-plan/']){const text=await(await get(path)).text();for(const match of text.matchAll(/<a[^>]*href="([^"]+)"[^>]*>Get deal/g))assert.match(match[1],/^\/go\/[a-z0-9-]+$/);assert.ok(text.includes('/go/'),path);}
});
test('offers are structured without calling prepaid equivalent a checkout price',()=>{
 const data=normalizeDeals(envelope,now), prepaid=productSchema(data.deals[0],now), monthly=productSchema(data.deals[2],now);
 assert.equal(prepaid['@type'],'Product');assert.equal(prepaid.offers['@type'],'Offer');assert.equal(prepaid.offers.price,undefined);assert.equal(prepaid.offers.priceSpecification.price,'3.14159');assert.equal(monthly.offers.price,'8.12345');
});
test('unverified entries have no current offer schema or lowest-price eligibility',()=>{
 const data=normalizeDeals({...envelope,deals:[{...plan,verified:false}]},now);assert.equal(productSchema(data.deals[0],now).offers,undefined);assert.match(homePage(data,now),/No verified offer available/);
});
test('source strings and JSON-LD cannot break out into executable markup',()=>{
 const evil={...plan,plan:'</script><img src=x onerror=alert(1)>',billing:'<script>alert(1)</script>',source_url:'javascript:alert(1)'};
 const deal=normalizeDeals({...envelope,deals:[evil]},now).deals[0];const text=planPage(deal,null,now);
 assert.ok(!text.includes('<img src=x'));assert.ok(!text.includes('href="javascript:'));assert.ok(!text.includes('<script>alert(1)'));assert.ok(!text.includes('>Get deal'));
 const schema=JSON.parse(text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);assert.equal(schema.name,`NordVPN ${evil.plan}`);
});
test('history failure has no fabricated graph; no data and one point are explicit',()=>{
 const deal=normalizeDeals(envelope,now).deals[0];assert.match(planPage(deal,null,now,true),/history is temporarily unavailable/);assert.ok(!planPage(deal,null,now,true).includes('<svg'));
 assert.match(planPage(deal,{points:[]},now),/No recorded price history yet/);
 const one=planPage(deal,{points:[{date:'2026-10-09',price_usd_monthly:3.14159}]},now);assert.match(one,/One point is not a trend/);assert.ok(!one.includes('<polyline'));
});
test('history route uses requested plan ID and graph includes exact accessible table',async()=>{calls.length=0;const text=await(await get('/plans/nordvpn-test-plan/')).text();assert.ok(calls.some(u=>u.endsWith('/v1/price-history/nordvpn-test-plan.json')));assert.match(text,/Exact recorded prices/);assert.match(text,/<svg/);});
test('sort links work through server-side query parameters',async()=>{const text=await(await get('/vpn/?sort=price&direction=desc')).text();assert.ok(text.indexOf('data-price="3.14159"')<text.indexOf('data-price="2.9"'));assert.match(text,/aria-sort="descending"/);assert.match(text,/data-sort="billing"/);});
test('canonical trailing slash, HEAD and supported method behavior',async()=>{const redirect=await get('/vpn');assert.equal(redirect.status,308);assert.equal(redirect.headers.get('Location'),'/vpn/');const head=await handleHumanRequest(new Request('https://getbillwatchdog.com/',{method:'HEAD'}),{}, {fetcher,now});assert.equal(await head.text(),'');assert.equal(head.status,200);const post=await handleHumanRequest(new Request('https://getbillwatchdog.com/',{method:'POST'}));assert.equal(post.status,405);});
test('security headers prohibit executable inline script and price pages never cache',async()=>{const res=await get('/');assert.equal(res.headers.get('Cache-Control'),'no-store');assert.match(res.headers.get('Content-Security-Policy'),/script-src 'self'/);assert.equal(res.headers.get('Referrer-Policy'),'no-referrer');});
test('current affiliate disclosure is truthful, future paid links fail closed',()=>{const deal=normalizeDeals({...envelope,deals:[{...plan,affiliate:true}]},now).deals[0];const text=planPage(deal,null,now);assert.ok(!text.includes('>Get deal'));assert.match(text,/Provider link unavailable/);});
test('small client enhancement has no hardcoded prices, libraries or outbound requests',async()=>{const js=await readFile(new URL('../public/billwatch-human.js',import.meta.url),'utf8');assert.ok(js.length<4000);assert.ok(!/fetch\(|https?:|eval\(|innerHTML/.test(js));});

test('source promotion and eligibility wording is visible beside plan prices and CTAs',()=>{
 const deal=normalizeDeals({...envelope,deals:[{...plan,promo:'Intro offer for new subscribers only; then regular price',promo_last_seen:'2026-10-09'}]},now).deals[0];
 const text=planPage(deal,null,now);assert.match(text,/Intro offer for new subscribers only; then regular price/);assert.match(text,/Last seen: 2026-10-09/);assert.match(text,/End date not supplied/);assert.match(homePage({meta:envelope.meta,deals:[deal]},now),/new subscribers only/);
});
