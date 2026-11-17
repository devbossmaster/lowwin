import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';

let html='';
test.beforeAll(async()=>{
 const query=`import{useCallback,useEffect,useState}from'react';export function usePrivateQuery(path,options){const[,render]=useState(0);const load=useCallback(()=>fetch(path).then(r=>r.json()).then(value=>{window.__refundCache[path]=value;render(n=>n+1)}),[path]);useEffect(()=>{void load()},[load]);useEffect(()=>{if(!options.pollMs)return;const timer=setInterval(()=>void load(),options.pollMs);return()=>clearInterval(timer)},[load,options.pollMs]);window.__refundOptions.push({path,pollMs:options.pollMs,freshnessMs:options.freshnessMs});return{data:window.__refundCache[path]??null,error:''}}`;
 const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AuctionRefundNotice}from'./src/components/auction-refund-notice';function Fixture(){const[code,setCode]=useState('42');return <><button onClick={()=>setCode('43')}>Next auction</button><AuctionRefundNotice code={code}/></>}createRoot(document.getElementById('root')).render(<Fixture/>);`;
 const bundled=await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'refund-notice-watch-entry.tsx',loader:'tsx'},outfile:'refund-notice-watch.js',bundle:true,write:false,platform:'browser',jsx:'automatic',logLevel:'silent',plugins:[{name:'refund-hook-fixture',setup(b){
  b.onLoad({filter:/private-query\.tsx$/},()=>({contents:query,loader:'jsx',resolveDir:process.cwd()}));
  b.onLoad({filter:/mini-locale\.tsx$/},()=>({contents:"export const useMiniLocale=()=>({language:'en'});",loader:'jsx'}));
  b.onLoad({filter:/\.module\.css$/},a=>({contents:readFileSync(a.path,'utf8'),loader:'local-css'}));
 }}]});
 const js=bundled.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=bundled.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
 const cache=Object.fromEntries(['42','43'].map(code=>['/api/my-bids/refunds?auction='+code,{refund:null}]));
 html='<!doctype html><html><meta charset="utf-8"><style>'+css+'</style><div id="root"></div><script>window.__refundCache='+JSON.stringify(cache)+';window.__refundOptions=[];</script><script>'+js.replaceAll('</script','<\\/script')+'</script></html>';
});

test('cached absence keeps watching until committed completion and a new auction restarts watching',async({page})=>{
 const reads=new Map<string,number>(),unexpected:string[]=[],pending={status:'pending',cash:'0',bonus:'0',bonusExpired:'0',pending:1,completed:0},completed={status:'completed',cash:'12.50',bonus:'0',bonusExpired:'0',pending:0,completed:1};
 await page.route('https://refund-notice.test/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/my-bids/refunds'){
   const code=url.searchParams.get('auction')!,count=(reads.get(code)??0)+1;reads.set(code,count);
   return route.fulfill({json:{refund:count===1?null:count===2?pending:completed}});
  }
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
  unexpected.push(url.pathname);return route.abort();
 });
 await page.clock.install();await page.goto('https://refund-notice.test/');await expect.poll(()=>reads.get('42')).toBe(1);await expect(page.locator('[data-auction-refund]')).toHaveCount(0);
 const latest=()=>page.evaluate(()=>(window as unknown as {__refundOptions:Array<{path:string;pollMs:number;freshnessMs:number}>}).__refundOptions.at(-1));
 await expect.poll(latest).toMatchObject({pollMs:3000,freshnessMs:2000});
 await page.clock.fastForward(3000);await expect(page.locator('[data-auction-refund="pending"]')).toBeVisible();expect(reads.get('42')).toBe(2);
 await page.clock.fastForward(3000);await expect(page.locator('[data-auction-refund="completed"]')).toContainText('Cash returned: ETB 12.50');await expect.poll(latest).toMatchObject({pollMs:0,freshnessMs:300000});
 const stopped=reads.get('42');await page.clock.fastForward(12000);expect(reads.get('42')).toBe(stopped);
 await page.getByRole('button',{name:'Next auction'}).click();await expect.poll(()=>reads.get('43')).toBe(1);await expect(page.locator('[data-auction-refund]')).toHaveCount(0);await expect.poll(latest).toMatchObject({path:'/api/my-bids/refunds?auction=43',pollMs:3000,freshnessMs:2000});
 await page.clock.fastForward(3000);await expect(page.locator('[data-auction-refund="pending"]')).toBeVisible();await page.clock.fastForward(3000);await expect(page.locator('[data-auction-refund="completed"]')).toBeVisible();await expect.poll(latest).toMatchObject({pollMs:0});
 expect(reads.get('43')).toBe(3);expect(unexpected).toEqual([]);
 await page.screenshot({path:test.info().outputPath('refund-watch-completed-390.png')});
});
