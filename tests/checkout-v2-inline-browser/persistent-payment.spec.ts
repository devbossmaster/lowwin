import {expect,test,type Locator} from '@playwright/test';
import {inlineFixture,selectBids,wakePayment} from './fixtures';

async function authorizationView(dialog:Locator,panel:Locator,am=false,otp=false){
 await expect(panel).toHaveAttribute('data-payment-view','authorization');
 await expect(panel.getByRole('heading',{name:am?'የክፍያ ፈቃድ በመጠባበቅ ላይ…':'Waiting for authorization…',exact:true})).toBeVisible();
 const activity=panel.locator('[data-payment-activity]');await expect(activity).toBeVisible();
 const line=await activity.evaluate(node=>{const segment=node.firstElementChild!,track=getComputedStyle(node),color=getComputedStyle(segment).backgroundColor.match(/\d+/g)!.map(Number);return {height:node.getBoundingClientRect().height,ratio:segment.getBoundingClientRect().width/node.getBoundingClientRect().width,track:track.backgroundColor,color,loop:segment.getAnimations().some(animation=>animation.playState==='running'&&animation.effect?.getTiming().iterations===Infinity)}});
 expect(line.height).toBeGreaterThanOrEqual(3);expect(line.height).toBeLessThanOrEqual(8);expect(line.ratio).toBeGreaterThan(.25);expect(line.ratio).toBeLessThan(.5);expect(line.color[0]).toBeGreaterThan(line.color[1]);expect(line.color[1]).toBeGreaterThan(line.color[2]);expect(line.track).not.toBe('rgba(0, 0, 0, 0)');expect(line.loop).toBe(true);
 await expect(dialog.locator('[data-payment-result-actions],[data-payment-support-reference],[data-payment-connection]')).toHaveCount(0);
 await expect(dialog.locator('[data-sheet-footer] button')).toHaveCount(otp?1:0);
 if(otp)await expect(dialog.locator('[data-sheet-footer] button')).toHaveText(am?'ኮዱን ያረጋግጡ':'Confirm code');
}

for(const scenario of [
 {purpose:'BID',am:false,otp:false},
 {purpose:'TOP_UP',am:true,otp:false},
 {purpose:'BID',am:true,otp:true},
 {purpose:'TOP_UP',am:false,otp:true},
] as const)test(`one payment panel persists through dispatch, ${scenario.otp?'OTP':'phone'} authorization and committed ${scenario.purpose} result ${scenario.am?'AM':'EN'}`,async({page},info)=>{
 const {purpose,am,otp}=scenario,f=await inlineFixture(page,am),text=(en:string,translated:string)=>am?translated:en;
 if(otp)f.setAuthType('OTP');
 let release!:()=>void,dispatched=false;
 const dispatchGate=new Promise<void>(resolve=>{release=resolve});
 let releaseQuote!:()=>void,quoteReads=0;
 const timedQuote=purpose==='BID'&&!otp,quoteHoldMs=150,quoteGate=new Promise<void>(resolve=>{releaseQuote=resolve});
 if(timedQuote)await page.route('**/api/payments/chapa/batches/quote',async route=>{
  quoteReads++;await quoteGate;return route.fallback();
 });
 await page.route(/\/api\/payments\/chapa\/direct\/current$/,async route=>{dispatched=true;await dispatchGate;return route.fallback()});
 try{
  let dialog:Locator;
  if(purpose==='BID'){await page.goto('/telegram?next='+encodeURIComponent(f.home));dialog=await selectBids(page,f.title)}
  else{await page.goto('/payments');await page.getByRole('button',{name:text('Top up','ገንዘብ ያስገቡ'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('[data-wallet-top-up] input[inputmode=decimal]').fill('35');await dialog.locator('[data-payment-action]').click();await expect(dialog.locator('[data-top-up-step=payment]')).toBeVisible()}
  await dialog.getByRole('radio',{name:otp?'CBE Birr':'telebirr',exact:true}).check();
  if(timedQuote){await expect.poll(()=>quoteReads).toBe(1);await expect(dialog.locator('[data-payment-action]')).toBeEnabled()}
  const originalDialog=await dialog.elementHandle();
  await dialog.locator('[data-payment-action]').click();
  const panel=dialog.locator('[data-payment-panel=persistent]'),heading=panel.getByRole('heading',{name:text('Waiting for authorization…','የክፍያ ፈቃድ በመጠባበቅ ላይ…'),exact:true});
  await expect(heading).toBeVisible();await expect(dialog).toHaveAttribute('data-presentation','centered');const originalPanel=await panel.elementHandle();
  const samePanel=async()=>{await expect(page.getByRole('dialog')).toHaveCount(1);expect(await dialog.evaluate((node,original)=>node===original,originalDialog)).toBe(true);expect(await originalPanel!.evaluate(node=>node.isConnected)).toBe(true);await expect(panel).toHaveCount(1)};
  await authorizationView(dialog,panel,am);
  if(timedQuote){expect(dispatched).toBe(false);await page.waitForTimeout(quoteHoldMs);expect(dispatched).toBe(false);releaseQuote()}
  await expect.poll(()=>dispatched).toBe(true);
  if(timedQuote){expect(quoteReads).toBe(1);expect(await page.evaluate(()=>performance.getEntriesByName('lowwin:payment:tap-to-request','measure').at(-1)?.duration??0)).toBeGreaterThanOrEqual(quoteHoldMs)}
  await samePanel();expect(f.commands).toHaveLength(0);release();await expect.poll(()=>f.commands.length).toBe(1);await expect(panel).toHaveAttribute('data-payment-progress','authorization');await samePanel();await authorizationView(dialog,panel,am,otp);
  await dialog.screenshot({path:info.outputPath(`persistent-${purpose}-${otp?'otp':'ussd'}-${am?'am':'en'}-pending.png`)});
  if(otp){
   const code=panel.getByLabel(text('One-time code','የአንድ ጊዜ ኮድ'),{exact:true});await code.fill('123456');f.rejectNextOtp();await dialog.getByRole('button',{name:text('Confirm code','ኮዱን ያረጋግጡ'),exact:true}).click();await expect(panel.locator('[data-payment-inline-error]')).toBeVisible();await samePanel();await authorizationView(dialog,panel,am,true);
   await code.fill('654321');await dialog.getByRole('button',{name:text('Confirm code','ኮዱን ያረጋግጡ'),exact:true}).click();await expect.poll(()=>f.authorizations.length).toBe(2);await expect(panel.locator('[data-payment-inline-error]')).toHaveCount(0);
  }
  f.setOrder({status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await wakePayment(page);await expect(panel).toHaveAttribute('data-payment-progress','confirming');await samePanel();await authorizationView(dialog,panel,am);await expect(panel.locator('[data-payment-inline-error]')).toHaveCount(0);
  if(purpose==='BID')f.acceptBids();else{f.setBalance('60.00');f.setOrder({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'})}
  await wakePayment(page);const actions=dialog.locator('[data-payment-result-actions]');await expect(actions.getByRole('button',{name:text('Close','ዝጋ'),exact:true})).toBeVisible();await expect(actions.locator('button,a')).toHaveText([text('Close','ዝጋ')]);await samePanel();await expect(panel).toHaveAttribute('data-payment-state','confirmed');await expect(panel).toHaveAttribute('data-payment-view','result');await expect(heading).toHaveCount(0);await expect(panel.locator('[data-payment-activity]')).toHaveCount(0);
  await dialog.screenshot({path:info.outputPath(`persistent-${purpose}-${otp?'otp':'ussd'}-${am?'am':'en'}-result.png`)});
  expect(f.commands).toHaveLength(1);expect(f.unexpected).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{releaseQuote();release();await f.cleanup()}
});

test('embedded top-up keeps its credited result until Close restores the original bid draft without paying it',async({page})=>{
 const f=await inlineFixture(page);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title,['4.25','5.50']);await dialog.getByRole('radio',{name:'LowWin Wallet',exact:true}).check();await dialog.getByRole('button',{name:'Add funds',exact:true}).first().click();
  await dialog.locator('[data-wallet-top-up] input[inputmode=decimal]').fill('35');await dialog.locator('[data-payment-action]').click();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();
  const panel=dialog.locator('[data-payment-panel=persistent]');await expect(panel).toHaveAttribute('data-payment-progress','authorization');const originalDialog=await dialog.elementHandle(),originalPanel=await panel.elementHandle();
  f.setBalance('60.00');f.setOrder({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await wakePayment(page);
  const actions=dialog.locator('[data-payment-result-actions]'),close=actions.getByRole('button',{name:'Close',exact:true});await expect(close).toBeVisible();await expect(actions.locator('button,a')).toHaveText(['Close']);await expect(panel).toContainText('Wallet credited');await expect(panel).toHaveAttribute('data-payment-view','result');await expect(dialog.locator('[data-bid-step=payment]')).toHaveCount(0);expect(await originalPanel!.evaluate(node=>node.isConnected)).toBe(true);await expect(page.getByRole('dialog')).toHaveCount(1);expect(f.commands).toHaveLength(1);
  await close.click();await expect(dialog.locator('[data-bid-step=payment]')).toBeVisible();await expect(dialog.locator('[data-bid-payment-summary]')).toContainText('4.25');await expect(dialog.locator('[data-bid-payment-summary]')).toContainText('5.50');await expect(dialog.getByRole('radio',{name:'LowWin Wallet',exact:true})).toBeChecked();expect(await dialog.evaluate((node,original)=>node===original,originalDialog)).toBe(true);
  expect(f.commands).toHaveLength(1);expect(f.commands[0].purpose).toBe('TOP_UP');expect(await f.db.bid.count({where:{auctionId:f.auction.id,userId:f.user.id}})).toBe(0);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

for(const scenario of [{purpose:'BID',am:false},{purpose:'TOP_UP',am:true}] as const)test(`only a verified failed ${scenario.purpose} changes authorization into Try again and Close`,async({page},info)=>{
 const {purpose,am}=scenario,f=await inlineFixture(page,am),text=(en:string,translated:string)=>am?translated:en;
 try{
  let dialog:Locator;
  if(purpose==='BID'){await page.goto('/telegram?next='+encodeURIComponent(f.home));dialog=await selectBids(page,f.title)}
  else{await page.goto('/payments');await page.getByRole('button',{name:text('Top up','ገንዘብ ያስገቡ'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('[data-wallet-top-up] input[inputmode=decimal]').fill('35');await dialog.locator('[data-payment-action]').click();await expect(dialog.locator('[data-top-up-step=payment]')).toBeVisible()}
  await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();
  const panel=dialog.locator('[data-payment-panel=persistent]');await expect(panel).toHaveAttribute('data-payment-progress','authorization');await authorizationView(dialog,panel,am);const originalPanel=await panel.elementHandle(),original=f.order().id;
  // An unverified failure hint cannot expose a new payment attempt.
  f.setOrder({status:'PENDING',providerStatus:'FAILED',verificationState:'UNVERIFIED'});const hintRead=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/payments/chapa/checkouts/${original}`&&response.request().method()==='GET'&&response.status()===200);await wakePayment(page);await hintRead;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await authorizationView(dialog,panel,am);
  f.setOrder({status:'FAILED',providerStatus:'FAILED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_FAILED'});await wakePayment(page);
  await expect(panel).toHaveAttribute('data-payment-view','result');await expect(panel).toHaveAttribute('data-payment-state','failed');await expect(panel.getByRole('heading',{name:text('Payment not completed','ክፍያው አልተጠናቀቀም'),exact:true})).toBeVisible();
  const actions=dialog.locator('[data-payment-result-actions]');await expect(actions.locator('button,a')).toHaveText([text('Try again','እንደገና ይሞክሩ'),text('Close','ዝጋ')]);await expect(panel.locator('[data-payment-activity],[data-payment-inline-error],[data-payment-support-reference]')).toHaveCount(0);expect(await originalPanel!.evaluate(node=>node.isConnected)).toBe(true);await expect(page.getByRole('dialog')).toHaveCount(1);
  // The provider reason appears once, rather than as both body text and alert.
  await expect(panel.getByText(text('Your provider could not complete this payment.','የክፍያ አቅራቢዎ ይህን ክፍያ ማጠናቀቅ አልቻለም።'),{exact:true})).toHaveCount(1);
  await dialog.screenshot({path:info.outputPath(`persistent-${purpose}-${am?'am':'en'}-failed.png`)});
  await actions.getByRole('button',{name:text('Try again','እንደገና ይሞክሩ'),exact:true}).click();
  await expect(dialog.locator(purpose==='BID'?'[data-bid-step=payment]':'[data-top-up-step=payment]')).toBeVisible();await expect(dialog.getByRole('radio',{name:'telebirr',exact:true})).toBeChecked();
  if(purpose==='BID')await expect(dialog.locator('[data-bid-payment-summary]')).toContainText('4.25');
  await expect(dialog.locator('[data-payment-action]')).toBeEnabled();expect(f.commands).toHaveLength(1);expect(new Set(f.checks)).toEqual(new Set([original]));expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect(await f.db.bid.count({where:{auctionId:f.auction.id,userId:f.user.id}})).toBe(0);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});

test('background pause, network failure and review keep the same authorization geometry without recovery actions',async({page})=>{
 const f=await inlineFixture(page);await page.addInitScript(()=>Reflect.set(window,'EventSource',undefined));await page.clock.install();
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title);await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();
  const firstCheck=page.waitForResponse(response=>response.request().method()==='POST'&&/\/api\/payments\/chapa\/checkouts\/[0-9a-f-]+$/.test(new URL(response.url()).pathname)&&response.status()===200);
  await dialog.locator('[data-payment-action]').click();const panel=dialog.locator('[data-payment-panel=persistent]');await expect(panel).toHaveAttribute('data-payment-progress','authorization');await firstCheck;await authorizationView(dialog,panel);
  const originalPanel=await panel.elementHandle(),originalDialog=await dialog.elementHandle(),original=f.order().id,path=`/api/payments/chapa/checkouts/${original}`,baseline=(await dialog.boundingBox())!;
  const sameGeometry=async()=>{await authorizationView(dialog,panel);await expect(panel.locator('[data-payment-inline-error]')).toHaveCount(0);expect(await originalPanel!.evaluate(node=>node.isConnected)).toBe(true);expect(await dialog.evaluate((node,original)=>node===original,originalDialog)).toBe(true);const box=(await dialog.boundingBox())!;for(const key of ['x','y','width','height'] as const)expect(Math.abs(box[key]-baseline[key])).toBeLessThan(1);await expect(page.getByRole('dialog')).toHaveCount(1)};
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});const count=f.checks.length;
  f.setUnavailable(true);await page.clock.fastForward(360000);expect(f.checks).toHaveLength(count);
  const failedRead=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='GET'&&response.status()===503);await wakePayment(page);await failedRead;await sameGeometry();expect(f.commands).toHaveLength(1);
  f.setUnavailable(false);f.setOrder({status:'NEEDS_REVIEW',providerStatus:'FAILED',verificationState:'MISMATCH'});await page.clock.fastForward(1000);const review=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='GET'&&response.status()===200);await wakePayment(page);await review;await expect(panel).toHaveAttribute('data-payment-progress','uncertain');await sameGeometry();
  f.acceptBids();await page.clock.fastForward(1000);await wakePayment(page);await expect(panel).toHaveAttribute('data-payment-state','confirmed');await expect(dialog.locator('[data-payment-result-actions] button')).toHaveText(['Close']);expect(f.commands).toHaveLength(1);expect(new Set(f.checks)).toEqual(new Set([original]));expect(f.maxActiveChecks()).toBeLessThanOrEqual(1);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});
