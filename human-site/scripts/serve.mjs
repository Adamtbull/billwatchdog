import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { handleHumanRequest } from '../src/app.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const port=Number(process.env.PORT||8788);
const dataPath=process.env.BILLWATCH_PREVIEW_SNAPSHOT;
const snapshot=dataPath?await readFile(dataPath,'utf8'):null;
// Local preview shows the human homepage at "/" unless BILLWATCH_HUMAN_HOMEPAGE=0.
const homepage=process.env.BILLWATCH_HUMAN_HOMEPAGE!=='0';
await mkdir(root+'.local',{recursive:true});
const db=new DatabaseSync(root+'.local/clicks.sqlite');
db.exec(await readFile(root+'migrations/0001_clicks.sql','utf8'));
// Local stand-in for env.ASSETS. In production the worker reads its own static /v1 files.
// Here, from your machine, it reads the live site's public /v1 files (read-only GETs) or a
// captured snapshot. This is preview tooling only and is not part of the worker bundle.
const ASSETS={async fetch(request){
 const path=new URL(request.url).pathname;
 if(snapshot && path==='/v1/deals.json')return new Response(snapshot,{headers:{'Content-Type':'application/json'}});
 if(snapshot && path.startsWith('/v1/price-history/'))return new Response('No history snapshot supplied',{status:503});
 return fetch('https://getbillwatchdog.com'+path,{headers:{Accept:'application/json','User-Agent':'billwatch-local-preview'}});
}};
const env={ASSETS,BILLWATCH_CLICKS:{prepare(sql){return{bind(...params){return{async run(){db.prepare(sql).run(...params);return{success:true};}};}};}}};
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,`http://127.0.0.1:${port}`);
 if(url.pathname==='/assets/billwatch-human.css'||url.pathname==='/assets/billwatch-human.js'){
   const ext=url.pathname.endsWith('.css')?'css':'js';
   res.writeHead(200,{'Content-Type':ext==='css'?'text/css':'text/javascript','X-Content-Type-Options':'nosniff'});res.end(await readFile(root+`public/assets/billwatch-human.${ext}`));return;
 }
 // A fixture preview never sends the visitor to production and never writes production counts.
 if(snapshot&&url.pathname.startsWith('/go/')){res.writeHead(409,{'Content-Type':'text/plain'});res.end('Snapshot preview: outbound redirects disabled. Start without BILLWATCH_PREVIEW_SNAPSHOT to exercise local aggregate click counts.');return;}
 const request=new Request(url,{method:req.method});
 const response=await handleHumanRequest(request,env,undefined,{homepage});
 if(response){
   let text=await response.text();
   if(snapshot&&response.headers.get('Content-Type')?.includes('text/html'))text=text.replace('<body>','<body><div class="preview-banner">Local preview using a real captured API response. Source-check dates shown below. Outbound redirects disabled.</div>');
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(req.method==='HEAD'?'':text);return;
 }
 // Existing live routes are intentionally not emulated or replaced by this new package.
 res.writeHead(404,{'Content-Type':'text/plain'});res.end('This route belongs to the existing BillWatch site and is intentionally not implemented by the human-site package.');
 }catch(error){console.error(error.message);res.writeHead(500);res.end('Local preview failed. Check the terminal.');}
});
server.listen(port,'127.0.0.1',()=>console.log(`BillWatch local preview: http://127.0.0.1:${port}${snapshot?' (captured live data; redirects disabled)':''}`));
