import {expect,test,type Locator} from '@playwright/test';
import {inlineFixture,selectBids,wakePayment} from './fixtures';

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
  quoteReads++;
  if(quoteReads===1)return route.fulfill({status:503,json:{code:'UNAVAILABLE',error:'Synthetic quote preparation interruption'}});
  await new Promise(resolve=>setTimeout(resolve,quoteHoldMs));await quoteGate;return route.fallback();
 });
 await page.route(/\/api\/payments\/chapa\/direct\/current$/,async route=>{dispatched=true;await dispatchGate;return route.fallback()});
 try{
  let dialog:Locator;
  if(purpose==='BID'){await page.goto('/telegram?next='+encodeURIComponent(f.home));dialog=await selectBids(page,f.title)}
  else{await page.goto('/payments');await page.getByRole('button',{name:text('Top up','ገንዘብ ያስገቡ'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('[data-wallet-top-up] input[inputmode=decimal]').fill('35');await dialog.locator('[data-payment-action]').click();await expect(dialog.locator('[data-top-up-step=payment]')).toBeVisible()}
  await dialog.getByRole('radio',{name:otp?'CBE Birr':'telebirr',exact:true}).check();
  if(timedQuote){await expect.poll(()=>quoteReads).toBe(1);await expect(dialog.locator('[data-payment-action]')).toBeEnabled();await dialog.locator('[data-sheet-notices] [data-sonner-toast][data-type=error] [data-close-button]').click()}
  const originalDialog=await dialog.elementHandle();
  await dialog.locator('[data-payment-action]').click();
  const panel=dialog.locator('[data-payment-panel=persistent]'),heading=panel.getByRole('heading',{name:text('Processing payment…','ክፍያዎ በመካሄድ ላይ ነው…'),exact:true});
  await expect(heading).toBeVisible();await expect(dialog).toHaveAttribute('data-presentation','centered');const originalPanel=await panel.elementHandle();
  const samePanel=async()=>{await expect(page.getByRole('dialog')).toHaveCount(1);expect(await dialog.evaluate((node,original)=>node===original,originalDialog)).toBe(true);expect(await originalPanel!.evaluate(node=>node.isConnected)).toBe(true);await expect(panel).toHaveCount(1)};
  if(timedQuote){expect(dispatched).toBe(false);releaseQuote()}
  await expect.poll(()=>dispatched).toBe(true);
  if(timedQuote){expect(quoteReads).toBe(2);expect(await page.evaluate(()=>performance.getEntriesByName('lowwin:payment:tap-to-request','measure').at(-1)?.duration??0)).toBeGreaterThanOrEqual(quoteHoldMs)}
  await samePanel();expect(f.commands).toHaveLength(0);release();await expect.poll(()=>f.commands.length).toBe(1);await expect(panel).toHaveAttribute('data-payment-progress','authorization');await samePanel();await expect(heading).toBeVisible();
  await dialog.screenshot({path:info.outputPath(`persistent-${purpose}-${otp?'otp':'ussd'}-${am?'am':'en'}-pending.png`)});
  if(otp){
   const code=panel.getByLabel(text('One-time code','የአንድ ጊዜ ኮድ'),{exact:true});await code.fill('123456');f.rejectNextOtp();await dialog.getByRole('button',{name:text('Confirm code','ኮዱን ያረጋግጡ'),exact:true}).click();await expect(panel.locator('[data-payment-inline-error]')).toBeVisible();await samePanel();await expect(heading).toBeVisible();
   await code.fill('654321');await dialog.getByRole('button',{name:text('Confirm code','ኮዱን ያረጋግጡ'),exact:true}).click();await expect.poll(()=>f.authorizations.length).toBe(2);await expect(panel.locator('[data-payment-inline-error]')).toHaveCount(0);
  }
  f.setOrder({status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await wakePayment(page);await expect(panel).toHaveAttribute('data-payment-progress','confirming');await samePanel();await expect(heading).toBeVisible();await expect(dialog.getByRole('button',{name:text('Done','ተጠናቋል'),exact:true})).toHaveCount(0);
  if(purpose==='BID')f.acceptBids();else{f.setBalance('60.00');f.setOrder({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'})}
  await wakePayment(page);await expect(dialog.getByRole('button',{name:text('Done','ተጠናቋል'),exact:true})).toBeVisible();await samePanel();await expect(panel).toHaveAttribute('data-payment-state','confirmed');await expect(heading).toHaveCount(0);
  await dialog.screenshot({path:info.outputPath(`persistent-${purpose}-${otp?'otp':'ussd'}-${am?'am':'en'}-result.png`)});
  expect(f.commands).toHaveLength(1);expect(f.unexpected).toHaveLength(0);expect(f.sdkLoads).toHaveLength(0);expect(await f.db.chapaCheckout.count({where:{userId:f.user.id}})).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }finally{releaseQuote();release();await f.cleanup()}
});

test('embedded top-up keeps its credited result until Done restores the original bid draft without paying it',async({page})=>{
 const f=await inlineFixture(page);
 try{
  await page.goto('/telegram?next='+encodeURIComponent(f.home));const dialog=await selectBids(page,f.title,['4.25','5.50']);await dialog.getByRole('radio',{name:'LowWin Wallet',exact:true}).check();await dialog.getByRole('button',{name:'Add funds',exact:true}).first().click();
  await dialog.locator('[data-wallet-top-up] input[inputmode=decimal]').fill('35');await dialog.locator('[data-payment-action]').click();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.locator('[data-payment-action]').click();
  const panel=dialog.locator('[data-payment-panel=persistent]');await expect(panel).toHaveAttribute('data-payment-progress','authorization');const originalDialog=await dialog.elementHandle(),originalPanel=await panel.elementHandle();
  f.setBalance('60.00');f.setOrder({status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED'});await wakePayment(page);
  const done=dialog.getByRole('button',{name:'Done',exact:true});await expect(done).toBeVisible();await expect(panel).toContainText('Wallet credited');await expect(dialog.locator('[data-bid-step=payment]')).toHaveCount(0);expect(await originalPanel!.evaluate(node=>node.isConnected)).toBe(true);await expect(page.getByRole('dialog')).toHaveCount(1);expect(f.commands).toHaveLength(1);
  await done.click();await expect(dialog.locator('[data-bid-step=payment]')).toBeVisible();await expect(dialog.locator('[data-bid-payment-summary]')).toContainText('4.25');await expect(dialog.locator('[data-bid-payment-summary]')).toContainText('5.50');await expect(dialog.getByRole('radio',{name:'LowWin Wallet',exact:true})).toBeChecked();expect(await dialog.evaluate((node,original)=>node===original,originalDialog)).toBe(true);
  expect(f.commands).toHaveLength(1);expect(f.commands[0].purpose).toBe('TOP_UP');expect(await f.db.bid.count({where:{auctionId:f.auction.id,userId:f.user.id}})).toBe(0);expect(f.unexpected).toHaveLength(0);
 }finally{await f.cleanup()}
});
