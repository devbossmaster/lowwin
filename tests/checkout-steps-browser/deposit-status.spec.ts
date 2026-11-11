import {expect,test,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,pending} from '../chapa-browser/fixtures';
import type {ChapaCheckoutView} from '../../src/lib/chapa-client';
import type {ChapaDirectIntent} from '../../src/lib/bid-batch-client';
import {etbToCents} from '../../src/lib/money';
type DepositIntent=Extract<ChapaDirectIntent,{purpose:'TOP_UP'}>;

async function setup(page:Page,am:boolean){
 const f=await fixture(page,am),commands:DepositIntent[]=[],checks:string[]=[],authorizations:string[]=[];
 let order:ChapaCheckoutView|null=null,unavailable=false,available='25.00',authType:'USSD'|'OTP'='USSD',rejectCode=true,activeChecks=0,maxActiveChecks=0;
 await page.addInitScript(()=>localStorage.setItem('lowwin:introduction:v1','dismissed'));
 await page.route('**/api/wallet',route=>route.fulfill({json:{available,held:'0',currency:'ETB',topUp:{enabled:true,reason:null}}}));
 await page.route('**/api/transactions?*',route=>route.fulfill({json:{items:[],page:1,nextPage:null}}));
 await page.route('**/api/payments/chapa/methods*',route=>route.fulfill({json:{methods:[{name:'telebirr',slug:'telebirr'},{name:'M-Pesa',slug:'mpesa'},{name:'CBE Birr',slug:'cbebirr'}],paymentPhone:'251911652904'}}));
 await page.route('**/api/payments/chapa/direct',route=>{
  const command=route.request().postDataJSON() as DepositIntent;commands.push(command);
  const id=randomUUID();order={...pending({key:command.key,purpose:'TOP_UP',amount:command.amount},id),amountCents:String(etbToCents(command.amount)),chargeType:'DIRECT',authType,authorizationReference:'provider-'+id,checkoutUrl:null,status:'AUTH_NEEDED',providerStatus:'AUTH_NEEDED',verificationState:'VERIFIED',reason:null,paymentMethod:command.paymentMethod,payerPhoneMasked:'251*****2904',pollAfterMs:5000};
  return route.fulfill({json:order});
 });
 await page.route('**/api/payments/chapa/checkouts/**',async route=>{
  const checking=route.request().method()==='POST';if(checking){activeChecks++;maxActiveChecks=Math.max(maxActiveChecks,activeChecks)}
  try{
  await new Promise(resolve=>setTimeout(resolve,40));
  const url=new URL(route.request().url()),id=url.pathname.split('/').at(-1)!;
  if(route.request().method()==='POST')checks.push(id);
  if(unavailable&&route.request().method()==='POST')return await route.fulfill({status:503,json:{error:'Temporary confirmation connection error',code:'UNAVAILABLE'}});
  return await route.fulfill({json:order?{...order,verificationUnavailable:unavailable}:null});
  }finally{if(checking)activeChecks--}
 });
 await page.route('**/api/payments/chapa/checkouts/*/authorize',route=>{
  authorizations.push(route.request().postDataJSON().otp??'');
  if(rejectCode){rejectCode=false;return route.fulfill({status:400,json:{error:'The provider did not accept that code.',code:'INVALID_OTP'}})}
  order={...order!,status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',verificationUnavailable:false};available='60.00';return route.fulfill({json:order});
 });
 return {...f,commands,checks,authorizations,maxActiveChecks:()=>maxActiveChecks,order:()=>order!,setUnavailable:(value:boolean)=>{unavailable=value},setOrder:(patch:Partial<ChapaCheckoutView>)=>{order={...order!,...patch}},setCredit:()=>{order={...order!,status:'CREDITED',providerStatus:'SUCCESS',verificationState:'VERIFIED',verificationUnavailable:false};available='60.00'},nextOtp:()=>{authType='OTP'},cleanup:async()=>{await f.db.product.update({where:{id:f.auction.productId!},data:{visible:false}});await f.db.$disconnect()}};
}

test('late verified wallet credit during retry reconciliation keeps the original success',async({page},info)=>{
 test.skip(info.project.name!=='360','Focused reconciliation regression at 360px.');
 const f=await setup(page,false);
 try{
  await page.goto('/payments');const dialog=await open(page,false),form=dialog.locator('[data-wallet-top-up]');
  await form.locator('input[inputmode=decimal]').fill('35');await dialog.locator('[data-top-up-continue]').click();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.getByRole('textbox',{name:'Payment phone number',exact:true}).fill('0911652904');await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.commands.length).toBe(1);
  const original=f.order().id;f.setOrder({status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_CANCELLED'});await wake(page);await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','terminal');
  f.setCredit();await dialog.getByRole('button',{name:'Try again',exact:true}).click();await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','success');await expect(dialog).toContainText('Wallet credited');await expect(dialog.locator('[data-wallet-top-up]')).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();expect(f.commands).toHaveLength(1);expect(new Set(f.checks)).toEqual(new Set([original]));await expect(page.locator('[data-transactions-balance]')).toHaveText('60.00 ETB');
 }finally{await f.cleanup()}
});
async function open(page:Page,am:boolean){await page.getByRole('button',{name:am?'ገንዘብ ያስገቡ':'Top up',exact:true}).click();return page.getByRole('dialog')}
async function wake(page:Page){await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'))})}

for(const am of [false,true]){
 test(`deposit preserves outstanding USSD beyond five minutes, connection errors, reopen and late credit ${am?'AM':'EN'}`,async({page},info)=>{
  const f=await setup(page,am);
  try{
   await page.goto('/payments');let dialog=await open(page,am);const form=dialog.locator('[data-wallet-top-up]');await expect(form).toBeVisible();await expect(form.getByRole('radio')).toHaveCount(0);await expect(dialog.locator('[data-payment-action]')).toHaveCount(0);
   await form.locator('input[inputmode=decimal]').fill('35');expect(f.commands).toHaveLength(0);await dialog.screenshot({path:info.outputPath(`deposit-amount-${am?'am':'en'}.png`)});await dialog.locator('[data-top-up-continue]').click();await expect(dialog.locator('[data-payment-method-form]')).toBeVisible();await expect(dialog.getByRole('radio')).toHaveCount(3);await expect(dialog.getByRole('radio',{name:am?'Lowwin ዋሌት':'Lowwin Wallet',exact:true})).toHaveCount(0);await expect(dialog.getByRole('textbox',{name:am?'የክፍያ ስልክ ቁጥር':'Payment phone number',exact:true})).toHaveValue('911652904');await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.getByRole('textbox',{name:am?'የክፍያ ስልክ ቁጥር':'Payment phone number',exact:true}).fill('0911652904');await dialog.screenshot({path:info.outputPath(`deposit-form-${am?'am':'en'}.png`)});await dialog.locator('[data-payment-action]').evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click()});await expect.poll(()=>f.commands.length).toBe(1);
   const id=f.order().id;await expect(dialog).toHaveAttribute('data-presentation','centered');await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','authorization');await expect(dialog.locator('ol,input[autocomplete=one-time-code]')).toHaveCount(0);await dialog.evaluate(node=>node.setAttribute('data-stable-status','yes'));
   await expect.poll(()=>f.checks.length).toBeGreaterThan(0);await page.clock.install();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});const before=f.checks.length;await page.clock.runFor(360000);expect(f.checks.length).toBe(before);f.setUnavailable(true);await wake(page);await expect.poll(()=>f.checks.length).toBeGreaterThan(before);
   await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','authorization');await expect(dialog).toContainText(am?'የክፍያ ፈቃድን በመጠባበቅ ላይ':'Waiting for authorization');await expect(dialog.locator('[data-payment-connection]')).toBeVisible();await expect(dialog).toHaveAttribute('data-stable-status','yes');await expect(page.getByRole('dialog')).toHaveCount(1);expect(f.commands).toHaveLength(1);
   await dialog.screenshot({path:info.outputPath(`deposit-waiting-${am?'am':'en'}.png`)});await dialog.getByRole('button',{name:am?'ዝጋ':'Close',exact:true}).first().click();await expect(dialog).toHaveCount(0);dialog=await open(page,am);await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','authorization');await expect(dialog).toContainText('35.00');expect(f.commands).toHaveLength(1);
   f.setUnavailable(false);f.setOrder({status:'PENDING',providerStatus:'SUCCESS',verificationState:'VERIFIED',verificationUnavailable:false});await wake(page);await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','confirming');await expect(page.locator('[data-transactions-balance]')).toHaveText('25.00 ETB');await expect(dialog).not.toContainText(am?'ገንዘቡ በዋሌትዎ ገብቷል':'Wallet credited');
   await expect(dialog.getByRole('button',{name:am?'ክፍያውን ያረጋግጡ':'Check payment',exact:true})).toHaveCount(0);
   f.setCredit();await wake(page);await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','success');await expect(dialog).toContainText(am?'ገንዘቡ በዋሌትዎ ገብቷል':'Wallet credited');await dialog.getByRole('button',{name:am?'ተጠናቋል':'Done',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.locator('[data-transactions-balance]')).toHaveText('60.00 ETB');expect(f.commands).toHaveLength(1);expect(new Set(f.checks)).toEqual(new Set([id]));expect(f.authorizations).toHaveLength(0);expect(f.maxActiveChecks()).toBeLessThanOrEqual(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }finally{await f.cleanup()}
 });
 test(`deposit terminal Close preserves the original outcome and explicit retry preserves details and OTP rules ${am?'AM':'EN'}`,async({page},info)=>{
  const f=await setup(page,am);
  try{
   await page.goto('/payments');let dialog=await open(page,am);let form=dialog.locator('[data-wallet-top-up]');await form.locator('input[inputmode=decimal]').fill('35');await dialog.locator('[data-top-up-continue]').click();await dialog.getByRole('radio',{name:'M-Pesa',exact:true}).check();const phone=dialog.getByRole('textbox',{name:am?'የክፍያ ስልክ ቁጥር':'Payment phone number',exact:true});await phone.fill('0911652904');await expect(dialog.locator('[data-payment-action]')).toBeDisabled();await expect(dialog.locator('[data-payment-phone-error]')).toBeVisible();await dialog.getByRole('radio',{name:'telebirr',exact:true}).check();await dialog.getByRole('button',{name:am?'ተመለስ':'Back',exact:true}).click();await expect(dialog.locator('[data-top-up-step="entry"]')).toBeVisible();await expect(form.locator('input[inputmode=decimal]')).toHaveValue('35');expect(f.commands).toHaveLength(0);await dialog.locator('[data-top-up-continue]').click();await expect(dialog.getByRole('radio',{name:'telebirr',exact:true})).toBeChecked();await expect(phone).toHaveValue('911652904');await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.commands.length).toBe(1);f.setOrder({status:'CANCELLED',providerStatus:'CANCELLED',verificationState:'VERIFIED',providerReasonCode:'PAYMENT_CANCELLED'});await wake(page);await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','terminal');
   await dialog.getByRole('button',{name:am?'ዝጋ':'Close',exact:true}).first().click();await expect(dialog).toHaveCount(0);dialog=await open(page,am);await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','terminal');expect(f.commands).toHaveLength(1);const before=f.checks.length;await dialog.getByRole('button',{name:am?'እንደገና ይሞክሩ':'Try again',exact:true}).click();form=dialog.locator('[data-wallet-top-up]');await expect(form).toBeVisible();await expect(dialog.locator('[data-top-up-step="entry"]')).toBeVisible();await expect(dialog.locator('[data-payment-method-form]')).toHaveCount(0);expect(f.checks.length).toBe(before+1);expect(f.commands).toHaveLength(1);await expect(form.locator('input[inputmode=decimal]')).toHaveValue('35.00');await dialog.locator('[data-top-up-continue]').click();await expect(dialog.getByRole('radio',{name:'telebirr',exact:true})).toBeChecked();await expect(dialog.getByRole('textbox',{name:am?'የክፍያ ስልክ ቁጥር':'Payment phone number',exact:true})).toHaveValue('911652904');expect(f.commands).toHaveLength(1);
   f.nextOtp();await dialog.getByRole('radio',{name:'CBE Birr',exact:true}).check();await dialog.locator('[data-payment-action]').click();await expect.poll(()=>f.commands.length).toBe(2);expect(f.commands[1].key).not.toBe(f.commands[0].key);await expect(dialog.getByLabel(am?'የአንድ ጊዜ ኮድ':'One-time code',{exact:true})).toBeVisible();await dialog.getByLabel(am?'የአንድ ጊዜ ኮድ':'One-time code',{exact:true}).fill('123456');await dialog.getByRole('button',{name:am?'ኮዱን ያረጋግጡ':'Confirm code',exact:true}).click();await expect(dialog.locator('[data-payment-reason]')).toBeVisible();await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','authorization');await dialog.getByLabel(am?'የአንድ ጊዜ ኮድ':'One-time code',{exact:true}).fill('654321');await dialog.getByRole('button',{name:am?'ኮዱን ያረጋግጡ':'Confirm code',exact:true}).click();await expect(dialog.locator('[data-wallet-payment-progress]')).toHaveAttribute('data-wallet-payment-progress','success');expect(f.authorizations).toHaveLength(2);expect(f.commands).toHaveLength(2);expect(f.maxActiveChecks()).toBeLessThanOrEqual(1);await expect(page.getByRole('dialog')).toHaveCount(1);await dialog.screenshot({path:info.outputPath(`deposit-success-${am?'am':'en'}.png`)});expect(await dialog.locator('[data-sheet-body]').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  }finally{await f.cleanup()}
 });
}
