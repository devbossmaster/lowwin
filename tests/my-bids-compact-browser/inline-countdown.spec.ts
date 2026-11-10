import {expect,test,type Page} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture} from '../chapa-browser/fixtures';

const stage=process.env.COUNTDOWN_STAGE==='before'?'before':'after';
async function setup(page:Page,am=false,duration=2*86400000+4*3600000+18*60000+9000){
 const f=await fixture(page,am),now=new Date(),serverNow=now.toISOString(),endsAt=new Date(now.getTime()+duration).toISOString(),requests:string[]=[];
 const item={id:'inline-clock-one',amount:'4.25',acceptedAt:serverNow,outcome:'LIVE',auction:{ruleVersion:'lowest-unique-v4',code:String(f.auction.publicCode),slug:f.auction.slug,title:'Power bank with integrated charging cables',titleAm:'ፓወር ባንክ ከተገጠሙ የኃይል መሙያ ገመዶች ጋር',image:{path:'/images/lowwin-demo-headphones.webp',alt:''},status:'LIVE',startsAt:serverNow,endsAt,isDemo:false}};
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/'))requests.push(request.method()+' '+url.pathname)});
 await page.route('**/api/my-bids?*',route=>route.fulfill({json:{items:[item,{...item,id:'inline-clock-two',amount:'4.26'}],page:1,pageSize:20,hasNext:false,serverNow}}));
 await page.route('**/api/catalog/activity?*',route=>route.fulfill({json:{items:[{code:item.auction.code,status:'live',views:'10',bids:2,bidders:1,startsAt:serverNow,endsAt,resultReady:false}]}}));
 return {...f,requests};
}

for(const am of [false,true])test(`countdown same-condition DOM layout and tick sample ${am?'AM':'EN'}`,async({page},info)=>{
 const f=await setup(page,am);
 try{
  await page.goto('/my-bids');await expect(page.locator('[data-bid-id]')).toHaveCount(2);await page.evaluate(()=>document.fonts.ready);
  const countdown=page.locator('[data-bid-id]').first().getByRole('timer'),row=page.locator('[data-bid-id]').first();
  await expect(countdown).toBeVisible();const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const before=(await cdp.send('Performance.getMetrics')).metrics;
  await countdown.evaluate(node=>{const sample={mutations:0,shifts:0};Reflect.set(window,'countdownSample',sample);new MutationObserver(records=>sample.mutations+=records.length).observe(node,{subtree:true,childList:true,characterData:true,attributes:true});new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!Reflect.get(entry,'hadRecentInput'))sample.shifts+=Number(Reflect.get(entry,'value')??0)}).observe({type:'layout-shift',buffered:false})});
  const start=await countdown.boundingBox(),reads=f.requests.length;
  await page.waitForTimeout(5200);
  const end=await countdown.boundingBox(),after=(await cdp.send('Performance.getMetrics')).metrics,sample=await page.evaluate(()=>Reflect.get(window,'countdownSample'));
  const metrics={stage,width:info.project.name,language:am?'am':'en',durationMs:5200,domElements:await page.locator('*').count(),countdownDescendants:await countdown.locator('*').count(),countdownText:await countdown.innerText(),row:await row.boundingBox(),countdownStart:start,countdownEnd:end,mutations:sample.mutations,layoutShifts:sample.shifts,animations:await countdown.evaluate(node=>node.getAnimations({subtree:true}).length),requestsDuringSample:f.requests.slice(reads),performance:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'].map(name=>[name,(after.find(m=>m.name===name)?.value??0)-(before.find(m=>m.name===name)?.value??0)]))};
  mkdirSync(`test-results/inline-countdown/${stage}`,{recursive:true});writeFileSync(`test-results/inline-countdown/${stage}/${info.project.name}-${am?'am':'en'}.json`,JSON.stringify(metrics,null,2)+'\n');await page.screenshot({path:`test-results/inline-countdown/${stage}/${info.project.name}-${am?'am':'en'}.png`});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(stage==='after'){
   await expect(countdown).toHaveAttribute('data-countdown-inline','true');expect(metrics.countdownDescendants).toBe(0);expect(metrics.animations).toBe(0);expect(metrics.requestsDuringSample).toEqual([]);expect(metrics.layoutShifts).toBe(0);expect(end!.width).toBe(start!.width);expect(end!.height).toBe(start!.height);expect(await countdown.evaluate(node=>getComputedStyle(node).whiteSpace)).toBe('nowrap');expect(await countdown.evaluate(node=>getComputedStyle(node).fontVariantNumeric)).toBe('tabular-nums');await expect(countdown).toHaveText(am?/^2ቀ04:(?:17|18):\d\d$/:/^2d04:(?:17|18):\d\d$/);await expect(row.locator('[data-countdown-unit],[data-countdown-flip],[data-countdown-tile],small')).toHaveCount(0);
  }
 }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});

if(stage==='after')test('server-relative inline clock resumes, clamps at expiry and batches duplicate row refresh',async({page},info)=>{
 test.skip(info.project.name!=='360','Shared timing lifecycle is covered once.');
 const f=await setup(page,false,60000);
 try{
  await page.clock.install();await page.goto('/my-bids');await expect(page.locator('[data-countdown-inline]')).toHaveCount(2);
  // Device wall-clock skew cannot replace the server receipt and monotonic clock.
  await page.clock.setSystemTime(new Date(Date.now()+7*86400000));await page.clock.runFor(1000);await expect(page.locator('[data-countdown-inline]').first()).toHaveText(/^0d00:00:5\d$/);await page.clock.setSystemTime(new Date());
  const reads=f.requests.filter(path=>path==='GET /api/my-bids').length;
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});
  const hidden=await page.locator('[data-countdown-inline]').first().innerText();await page.clock.runFor(10000);await expect(page.locator('[data-countdown-inline]').first()).toHaveText(hidden);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))});
  await expect(page.locator('[data-countdown-inline]').first()).toHaveText(/^0d00:00:4\d$/);
  // My Bids already refreshes once on foreground recovery; expiry is a separate batch.
  await expect.poll(()=>f.requests.filter(path=>path==='GET /api/my-bids').length).toBe(reads+1);const resumedReads=reads+1;
  await page.clock.runFor(60000);await expect(page.locator('[data-countdown-inline]').first()).toHaveText('Auction ended');
  await expect.poll(()=>f.requests.filter(path=>path==='GET /api/my-bids').length).toBe(resumedReads+1);
  await page.clock.runFor(5000);await expect(page.locator('[data-countdown-inline]').first()).toHaveText('Auction ended');expect(f.requests.filter(path=>path==='GET /api/my-bids').length).toBe(resumedReads+1);expect(f.requests.filter(path=>/^POST \/api\/(?:payments|wallet\/top-ups|auctions\/[^/]+\/bids)/.test(path))).toEqual([]);
 }finally{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}
});
