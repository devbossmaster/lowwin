import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {signedLaunch,ENGLISH_UI_STATE} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';

test('launch transport, fonts and measured account latency',async({browser,extraHTTPHeaders},info)=>{
 const database=process.env.TEST_DATABASE_URL!,target=new URL(database);
 if(target.hostname!=='127.0.0.1'||!target.pathname.endsWith('_test'))throw Error('Disposable loopback database required');
 const db=new PrismaClient({datasourceUrl:database}),phase=process.env.LAUNCH_PHASE??'after';
 const root=process.env.LAUNCH_REPORT_DIR??'test-results/launch-performance';mkdirSync(root,{recursive:true});
 const report:Record<string,unknown>={phase,width:info.project.name,mode:process.env.REDESIGN_PRODUCTION==='1'?'optimized production build on loopback':'development build on loopback',sdkFixtureDelayMs:250};
 try{
  const id=randomInt(9100000000,9200000000);await verifyFixtureContact(db,id);
  const initData=signedLaunch({user:JSON.stringify({id,first_name:'Launch performance fixture'})},process.env.TELEGRAM_BOT_TOKEN);
  const script=`window.Telegram={WebApp:{initData:${JSON.stringify(initData)},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};`;
  const anonymous=await browser.newContext({baseURL:process.env.BETTER_AUTH_URL,ignoreHTTPSErrors:true});
  const fontResponses=[];
  for(const path of ['/fonts/sora-latin-800.woff2','/fonts/noto-serif-ethiopic-banner.woff2']){
   const began=performance.now(),response=await anonymous.request.get(path,{maxRedirects:0});
   fontResponses.push({path,status:response.status(),cacheControl:response.headers()['cache-control']??'',elapsedMs:Math.round(performance.now()-began)});
   if(phase!=='before'){expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toContain('public')}
  }
  expect((await anonymous.request.get('/api/me')).status()).toBe(401);
  await anonymous.close();report.anonymousFonts=fontResponses;
  for(const slow of [false,true]){
   const context=await browser.newContext({baseURL:process.env.BETTER_AUTH_URL,ignoreHTTPSErrors:true,viewport:info.project.use.viewport,storageState:ENGLISH_UI_STATE,extraHTTPHeaders});
   const page=await context.newPage();page.setDefaultTimeout(45000);
   if(slow){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:125000,uploadThroughput:64000})}
   await page.route('https://telegram.org/js/telegram-web-app.js',async route=>{await new Promise(resolve=>setTimeout(resolve,250));await route.fulfill({contentType:'application/javascript',body:script})});
   const errors:string[]=[],signins:string[]=[],documents:string[]=[],apiTiming:Promise<string|undefined>[]=[];
   let signInStartedMs:number|undefined;
   page.on('pageerror',error=>errors.push(error.message));
   page.on('request',request=>{if(new URL(request.url()).pathname==='/api/auth/telegram/miniapp/signin'){signins.push(request.method());signInStartedMs=Math.round(performance.now()-started)}if(request.resourceType()==='document')documents.push(new URL(request.url()).pathname)});
   page.on('response',response=>{if(new URL(response.url()).pathname==='/api/auth/telegram/miniapp/signin')apiTiming.push(response.headerValue('server-timing').then(value=>value??undefined))});
   const started=performance.now();await page.goto('/telegram',{waitUntil:'domcontentloaded'});
   await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
   const homeReadyMs=Math.round(performance.now()-started);
   const scripts=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/_next/static/')&&new URL(entry.name).pathname.endsWith('.js')).map(entry=>({asset:new URL(entry.name).pathname,transferBytes:(entry as PerformanceResourceTiming).transferSize,endMs:Math.round(entry.startTime+entry.duration)})));
   await page.evaluate(()=>document.fonts.ready);const fontsReadyMs=Math.round(performance.now()-started);
   await expect(page.locator('#home-headline')).toBeVisible();
   const fonts=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/fonts/')||entry.name.includes('telegram-web-app.js')).map(entry=>({asset:new URL(entry.name).pathname,startMs:Math.round(entry.startTime),durationMs:Math.round(entry.duration),transferBytes:(entry as PerformanceResourceTiming).transferSize})));
   if(phase!=='before'){expect(signins).toHaveLength(1);expect(documents).toEqual(['/telegram'])}
   const accountMs:number[]=[];
   if(!slow){for(let sample=0;sample<20;sample++){const began=performance.now();expect((await page.request.get('/api/me')).status()).toBe(200);accountMs.push(Math.round(performance.now()-began))}}
   accountMs.sort((a,b)=>a-b);
   report[slow?'slow':'normal']={homeReadyMs,fontsReadyMs,signInStartedMs,signInRequests:signins.length,documentRequests:documents,serverTiming:await Promise.all(apiTiming),initialScriptTransferBytes:scripts.reduce((sum,item)=>sum+item.transferBytes,0),scripts,fonts,accountApiSamples:accountMs.length,accountApiP95Ms:accountMs.length?accountMs[Math.ceil(accountMs.length*.95)-1]:null};
   await page.screenshot({path:`${root}/${phase}-${info.project.name}-${slow?'slow':'normal'}.png`});
   expect(errors).toEqual([]);await context.close();
  }
  writeFileSync(`${root}/${phase}-${info.project.name}.json`,JSON.stringify(report,null,2)+'\n');
 }finally{await db.$disconnect()}
});
