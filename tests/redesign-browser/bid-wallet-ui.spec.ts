import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
import {creditDevelopmentPoints,reconcile} from '../../src/modules/wallet/ledger';

test('bid and embedded top-up keep the same draft and make no financial mutation in both languages',async({page},info)=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL}),root=process.env.BID_WALLET_CAPTURE_DIR??'test-results/bid-wallet-ui';mkdirSync(root,{recursive:true});
 const errors:string[]=[],mutations:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.method()==='POST'&&!path.endsWith('/batches/quote')&&/\/api\/(?:auctions\/[^/]+\/bids|payments\/|wallet\/top-ups)/.test(path))mutations.push(path)});
 try{
  const id=randomInt(8000000000,8900000000),auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v5',isDemo:false,endDelayMs:3600000}),title='QA headphones '+randomUUID().slice(0,7);
  await db.product.update({where:{id:auction.productId!},data:{title,titleAm:'የሙከራ ማዳመጫ',images:{create:{path:'/images/lowwin-demo-headphones.webp',alt:'QA headphones photo',sourceType:'ORIGINAL'}}}});
  await verifyFixtureContact(db,id);await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(({launch})=>{localStorage.setItem('lowwin:introduction:v1','dismissed');window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Wallet UI QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/?q='+encodeURIComponent(title)));await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  const user=await db.user.findUniqueOrThrow({where:{telegramId:String(id)}});Object.assign(process.env,{DEV_POINTS_ENABLED:'true',NODE_ENV:'test'});await creditDevelopmentPoints(db,user.id,'250','bid-wallet-ui-'+randomUUID());await page.evaluate(()=>window.dispatchEvent(new Event('lowin-wallet-updated')));
  for(const language of ['en','am'] as const){
   const am=language==='am';if(am){await page.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click()}
   const bid=page.locator('#discover-auctions .auction-card').first().getByRole('button',{name:am?'ይጫረቱ':'Place a bid',exact:true});await bid.click();
   const sheet=page.locator('dialog[open]');await expect(sheet).toHaveCount(1);await expect(sheet.locator('[data-bid-entry]')).toBeVisible();
   const clear=sheet.getByRole('button',{name:am?'ሁሉንም አጽዳ':'Clear all',exact:true});if(await clear.isVisible())await clear.click();
   const input=sheet.getByRole('textbox',{name:am?'የጨረታ ቁጥርዎ':'Your bid number',exact:true});await input.fill('4.25');await sheet.locator('[data-bid-add]').click();await sheet.locator('[data-payment-action]').click();
   await expect(sheet.locator('[data-bid-step=payment]')).toBeVisible();await sheet.getByRole('radio',{name:'LowWin Wallet',exact:true}).check();await expect(sheet.getByRole('radio',{name:'LowWin Wallet',exact:true})).toBeChecked();await expect(sheet.locator('[data-wallet-methods]')).toContainText(/250(?:\.00)? ETB/);await expect(sheet.locator('[data-bid-payment-summary]')).toContainText('4.25');
   await sheet.getByRole('button',{name:am?'ገንዘብ ያስገቡ':'Add funds',exact:true}).click();await expect(sheet.locator('[data-top-up-submit]')).toBeVisible();await expect(page.locator('dialog[open]')).toHaveCount(1);
   const amount=sheet.getByRole('textbox',{name:am?'የሚያስገቡት መጠን':'Amount to add',exact:true});await amount.fill('1.00');await expect(sheet.locator('[data-top-up-submit]')).toHaveText(am?'ወደ ክፍያ ይቀጥሉ':'Continue to payment');
   const viewport=page.viewportSize()!;await amount.focus();await page.setViewportSize({...viewport,height:500});await expect(sheet).toHaveAttribute('data-keyboard-open','true');await expect.poll(async()=>{const box=await amount.boundingBox();return !!box&&box.y>=0&&box.y+box.height<=500}).toBe(true);await page.setViewportSize(viewport);await expect(sheet).toHaveAttribute('data-keyboard-open','false');
   await page.screenshot({path:root+'/top-up-'+info.project.name+'-'+language+'.png'});await page.goBack();await expect(sheet.locator('[data-bid-step=payment]')).toBeVisible();await expect(sheet.locator('[data-bid-payment-summary]')).toContainText('4.25');
   await sheet.getByRole('button',{name:am?'ያስተካክሉ':'Edit',exact:true}).click();await expect(input).toBeVisible();await expect(sheet.getByRole('button',{name:am?'4.25 ያስተካክሉ':'Edit 4.25',exact:true})).toBeVisible();await page.screenshot({path:root+'/bid-'+info.project.name+'-'+language+'.png'});
   await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);await expect(bid).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(mutations).toEqual([]);expect(errors).toEqual([]);expect(await db.bid.count({where:{userId:user.id}})).toBe(0);expect(await db.chapaCheckout.count({where:{userId:user.id}})).toBe(0);expect((await db.ledgerAccount.findUniqueOrThrow({where:{name:'user:'+user.id+':available'}})).balance.toString()).toBe('250');expect(await reconcile(db)).toEqual([]);
 }finally{await db.$disconnect()}
});
