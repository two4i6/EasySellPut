import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from '@playwright/test';

// Loopback fixture only: tests the private rendered channel, not a public market connection.
const root=path.resolve(new URL('../dist/',import.meta.url).pathname);
const evidence=path.resolve(new URL('../test-results/',import.meta.url).pathname);
let streamState="active";let revision=1,price=501,at=new Date().toISOString(),quoteRequests=0,analysisRequests=0,prefsRevision=0;
const preferences={};
const palette={dark:true,reducedMotion:true,background:'#262624',control:'#30302E',text:'#FAF9F6',muted:'#B8B7B4',border:'#41413E',accent:'#D97757',up:'#70A580',down:'#D16C65'};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=createServer(async(req,res)=>{
 const json=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(req.url==='/session/presentation')return json(palette);
 if(req.url==='/session/preferences'){
  if(req.method==='POST'){let body='';for await(const part of req)body+=part;Object.assign(preferences,JSON.parse(body).changes);prefsRevision++;}
  return json({revision:String(prefsRevision),values:preferences});
 }
 if(req.url.startsWith('/session/quotes?')){
  quoteRequests++;const after=Number(new URL(req.url,'http://local').searchParams.get('after'));
  for(let i=0;i<20&&revision===after&&!res.destroyed;i++)await pause(50);
  if(!res.destroyed)json({revision,quote:{Symbol:'QQQ',Price:price,Source:'yahoo',Delivery:'websocket',StreamState:streamState,AsOf:at,FetchedAt:at,IsRealtime:false,DelayMinutes:null}});return;
 }
 if(req.url.startsWith('/session/events?')){await pause(200);if(!res.destroyed)json({version:'fixed-history',presentation:palette,quote:null,latestDate:null});return;}
 if(req.url.includes('/api/')){analysisRequests++;res.writeHead(503,{'content-type':'application/json'});res.end('{"code":"LOCAL_CACHE_MISS","offline":true}');return;}
 try{const file=path.join(root,req.url.replace(/^\/session\//,'').split('?')[0]);const body=await readFile(file);res.writeHead(200,{'content-type':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html'});res.end(body);}
 catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1920,height:1080}});let navigations=0,websockets=0;
 page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});page.on('websocket',()=>websockets++);
 await page.goto(`http://127.0.0.1:${server.address().port}/session/index.html`);
 await page.getByRole('button',{name:'实时观察',exact:true}).click();
 const badge=page.getByTestId('qqq-live-quote');await badge.filter({hasText:'501.00'}).waitFor();assert.match(await badge.textContent(),/推送/);
 await pause(300);const before=analysisRequests;price=502;revision++;at=new Date().toISOString();
 await badge.filter({hasText:'502.00'}).waitFor();assert.equal(analysisRequests,before,'A quote must not trigger historical GEX or PCS recalculation');
 price=1;revision++;at=new Date(Date.now()-86400000).toISOString();await pause(250);assert.match(await badge.textContent(),/502.00/,'Older response must not roll back the price');
 price=503;revision++;at=new Date().toISOString();await badge.filter({hasText:'503.00'}).waitFor();
 streamState='reconnecting';revision++;await badge.filter({hasText:'重连中'}).waitFor();assert.match(await badge.textContent(),/503.00/);
 streamState='active';price=504;revision++;at=new Date().toISOString();await badge.filter({hasText:'504.00'}).waitFor();
 await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'live-qqq-1080p.png'),fullPage:false});
 await page.getByRole('button',{name:'历史回放',exact:true}).click();await pause(200);const stopped=quoteRequests;await pause(500);assert.equal(quoteRequests,stopped,'History must stop the quote channel');
 assert.equal(navigations,1);assert.equal(websockets,0,'The WebView must reuse native quotes, not open a public socket');
 await writeFile(path.join(evidence,'live-quote.json'),JSON.stringify({fixture:true,viewport:[1920,1080],quoteRequests,navigations,websockets,historicalRecalculationOnQuote:false}));
 console.log('PASS: rendered QQQ live prices, no stale rollback or GEX recalculation, one navigation, history cancellation, no browser WebSocket');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
