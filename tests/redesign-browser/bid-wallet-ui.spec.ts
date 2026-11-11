import {test,expect} from '../isolated-browser';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
import {creditDevelopmentPoints,reconcile} from '../../src/modules/wallet/ledger';

test('Wallet/Chapa bid and top-up UI stays read-only in both languages',async({page},info)=>{
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL}),root=process.env.BID_WALLET_CAPTURE_DIR??'test-results/bid-wallet-ui';mkdirSync(root,{recursive:true});
 const errors:string[]=[],mutations:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&!new URL(request.url()).pathname.endsWith('/batches/quote')&&/\/api\/(?:auctions\/[^/]+\/bids|payments\/(?:chapa|arifpay)|wallet\/top-ups)/.test(request.url()))mutations.push(request.url())});
 const sheetMarker=()=>page.evaluate(()=>typeof history.state?.lowwinSheet==='string'?history.state.lowwinSheet as string:null);
 // useSheetBack commits its own history entry on the next animation frame.
 // A visible dialog alone cannot prove that browser Back owns that entry yet.
 const registeredSheet=async(previous:string|null)=>{await expect.poll(async()=>{const marker=await sheetMarker();return marker!==null&&marker!==previous}).toBe(true);return (await sheetMarker())!};
 try{
  const id=randomInt(8000000000,8900000000),auction=await bidAuction(db,{fee:10,ruleVersion:'lowest-unique-v4',isDemo:false,endDelayMs:3600000}),title='QA headphones '+randomUUID().slice(0,7);
  await db.product.update({where:{id:auction.productId!},data:{title,titleAm:'የሙከራ ማዳመጫ',description:'Clearly labeled QA product. Read the terms and choose your bid number.',descriptionAm:'ለሙከራ የቀረበ ዕቃ። ውሎቹን ያንብቡና የጨረታ መጠንዎን ይምረጡ።',images:{create:{path:'/images/lowwin-demo-headphones.webp',alt:'QA headphones photo',sourceType:'ORIGINAL'}}}});
  await verifyFixtureContact(db,id);await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));

  await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Wallet UI QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/?q='+encodeURIComponent(title)));await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  const user=await db.user.findUniqueOrThrow({where:{telegramId:String(id)}});Object.assign(process.env,{DEV_POINTS_ENABLED:'true',NODE_ENV:'test'});await creditDevelopmentPoints(db,user.id,'250','bid-wallet-ui-'+randomUUID());await page.evaluate(()=>window.dispatchEvent(new Event('lowin-wallet-updated')));
  for(const language of ['en','am'] as const){
   const am=language==='am';if(am){await page.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click()}
   const homeUrl=page.url();await expect.poll(sheetMarker).toBeNull();
   const bid=page.locator('#discover-auctions .auction-card').first().getByRole('button');await bid.click();const sheet=page.getByRole('dialog',{name:am?'ጨረታዎን ያቅርቡ':'Place your bid',exact:true});await expect(sheet).toBeVisible();await expect(sheet.locator('.customer-loading,.loading-spinner-ring')).toHaveCount(0);await expect(sheet.locator('[data-sheet-details-ready=true]')).toBeVisible();await sheet.evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})))});expect((await sheet.boundingBox())!.height).toBeLessThanOrEqual(page.viewportSize()!.height);expect(await sheet.evaluate(element=>{const body=element.querySelector(':scope>header+div')!;return {scroll:body.scrollHeight,visible:body.clientHeight}})).toEqual(expect.objectContaining({scroll:expect.any(Number),visible:expect.any(Number)}));await expect(sheet.locator('[data-sheet-body]')).toBeVisible();
   const input=sheet.getByRole('textbox',{name:am?'የጨረታ መጠንዎ':'Your bid amount',exact:true});await input.fill('4.25');
   await expect(sheet.getByRole('radio')).toHaveCount(0);await expect(sheet.locator('[data-bid-total]')).toContainText('10.00');await expect(sheet.locator('[data-bid-continue]')).toBeDisabled();await expect(sheet.locator('[data-bid-continue]')).toContainText(am?'በChapa ይክፈሉ':'Pay with Chapa');
   await sheet.getByRole('button',{name:am?'የጨረታ መጠን ጨምር':'Add bid amount',exact:true}).click();await expect(input).toHaveValue('');const remove=sheet.getByRole('button',{name:am?'4.25 ያስወግዱ':'Remove 4.25',exact:true});await expect(remove).toBeVisible();await remove.click();await input.fill('4.25');
   await sheet.evaluate(async element=>{const body=element.querySelector(':scope>header+div');if(body)body.scrollTop=0;await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})))});await page.screenshot({path:`${root}/bid-${info.project.name}-${language}.png`});
   await input.fill('0');await expect(sheet.getByRole('alert')).toHaveText(am?'በሚታየው ክልል እና ልዩነት ውስጥ መጠን ይምረጡ።':'Choose an amount within the displayed range and step.');await input.fill('4.25');const bidMarker=await registeredSheet(null);await page.goBack();await expect(sheet).toHaveCount(0);await expect.poll(sheetMarker).toBeNull();await expect(page).toHaveURL(homeUrl);await expect(bid).toBeFocused();
   const header=page.getByRole('banner',{name:'Mini App header'});await expect(header.getByRole('link',{name:am?'ዋሌት, 250.00 ETB':'Wallet, 250.00 ETB',exact:true})).toBeVisible();const headerTrigger=header.getByRole('link',{name:am?'ገንዘብ ያስገቡ':'Deposit',exact:true});await headerTrigger.click();const topUp=page.getByRole('dialog',{name:am?'ገንዘብ ያስገቡ':'Top up wallet',exact:true});await expect(topUp).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(1);await expect(topUp.locator('[data-wallet-top-up-balance]')).toHaveText('250.00 ETB');
   const topUpMarker=await registeredSheet(bidMarker);
   const amount=topUp.getByRole('textbox',{name:am?'የሚያስገቡት መጠን':'Amount to top up',exact:true});await topUp.getByRole('button',{name:'500',exact:true}).click();await expect(amount).toHaveValue('500');await amount.fill('150.50');await expect(topUp.getByRole('radio')).toHaveCount(0);await expect(topUp.locator('[data-top-up-continue]')).toContainText(am?'ወደ Chapa ቀጥል':'Continue to Chapa');await expect(topUp.locator('[data-top-up-continue]')).toBeDisabled();
   const viewport=page.viewportSize()!;await page.setViewportSize({...viewport,height:500});await expect(topUp).toHaveAttribute('data-keyboard-open','true');await expect.poll(async()=>{const box=await amount.boundingBox();return !!box&&box.y>=0&&box.y+box.height<=500}).toBe(true);await page.setViewportSize(viewport);await expect(topUp).toHaveAttribute('data-keyboard-open','false');expect((await topUp.boundingBox())!.height).toBeLessThanOrEqual(viewport.height);await expect(topUp.locator('[data-sheet-body]')).toBeVisible();
   await topUp.evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})))});await page.screenshot({path:`${root}/top-up-${info.project.name}-${language}.png`});expect(await topUp.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
   await page.keyboard.press('Escape');await expect(topUp).toHaveCount(0);await expect.poll(sheetMarker).toBeNull();await expect(page).toHaveURL(homeUrl);await expect(headerTrigger).toBeFocused();await headerTrigger.click();await expect(topUp).toBeVisible();await registeredSheet(topUpMarker);await page.goBack();await expect(topUp).toHaveCount(0);await expect.poll(sheetMarker).toBeNull();await expect(page).toHaveURL(homeUrl);await expect(headerTrigger).toBeFocused();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.goto('/wallet/deposit');await expect(page.getByRole('heading',{name:'ገንዘብ ያስገቡ',exact:true})).toBeVisible();await expect(page.locator('[data-top-up-continue]')).toBeDisabled();expect(mutations).toEqual([]);expect(errors).toEqual([]);expect(await db.bid.count({where:{userId:user.id}})).toBe(0);expect((await db.ledgerAccount.findUniqueOrThrow({where:{name:`user:${user.id}:available`}})).balance.toString()).toBe('250');expect(await reconcile(db)).toEqual([]);
 }finally{await db.$disconnect()}
});
