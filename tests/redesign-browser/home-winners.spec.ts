import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {richFinalResult} from '../result-fixtures';
import {bidAuction} from '../bid-fixtures';
import {verifyFixtureContact} from '../contact-fixtures';
import {signedLaunch} from '../helpers';
import {reconcile} from '../../src/modules/wallet/ledger';

test('homepage, final results, nested Back, live batches and Winners navigation',async({page},info)=>{
 page.setDefaultTimeout(30000);const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const root=process.env.HOME_CAPTURE_DIR??'test-results/home-winners';mkdirSync(root,{recursive:true});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const fixture=await richFinalResult(db),marker='QA live '+randomUUID().slice(0,7),id=randomInt(8000000000,8900000000);
  for(let index=0;index<12;index++){const auction=await bidAuction(db,{fee:index+1,isDemo:false,ruleVersion:'lowest-unique-v4',endDelayMs:3600000});await db.product.update({where:{id:auction.productId!},data:{title:`${marker} item ${index+1}`,titleAm:`የሙከራ ዕቃ ${index+1}`,images:{create:{path:'/catalog/accessory.svg',alt:'QA illustration',sourceType:'ORIGINAL'}}}})}
  await verifyFixtureContact(db,id);await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(({launch})=>{
   let handlers:Array<()=>void>=[];
   const back={isVisible:false,show(){this.isVisible=true},hide(){this.isVisible=false},onClick(handler:()=>void){handlers.push(handler)},offClick(handler:()=>void){handlers=handlers.filter(value=>value!==handler)}};
   (window as unknown as {__sheetBackPress:()=>void}).__sheetBackPress=()=>[...handlers].forEach(handler=>handler());
   window.Telegram={WebApp:{initData:launch,BackButton:back,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};
  },{launch:signedLaunch({user:JSON.stringify({id,first_name:'Homepage QA'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/telegram?next='+encodeURIComponent('/?q='+encodeURIComponent(marker)));
  const navigation=page.getByRole('navigation',{name:'Your navigation'});await expect(navigation).toBeVisible();await expect(navigation.getByRole('link')).toHaveCount(4);
  await expect(navigation.getByRole('link',{name:'Home',exact:true})).toHaveAttribute('aria-current','page');
  const cards=page.locator('#discover-auctions .auction-card');await expect(cards).toHaveCount(10);
  const sortLinks=page.getByRole('navigation',{name:'Auction sorting'}).getByRole('link');await expect(sortLinks).toHaveCount(5);
  const checkSortFit=async()=>{const boxes=await sortLinks.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,height:r.height,overflow:node.scrollWidth>node.clientWidth+1}}));for(const box of boxes){expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(Number(info.project.name));expect(box.height).toBeGreaterThanOrEqual(44);expect(box.overflow).toBe(false);expect(Math.abs(box.top-boxes[0].top)).toBeLessThan(1)}};await checkSortFit();
  const firstCard=cards.first(),art=await firstCard.locator('.auction-card-art').boundingBox();expect(art!.width/art!.height).toBeCloseTo(2.3,1);await expect(firstCard.locator('.auction-card-win')).toHaveText('Win');
  const bidAction=firstCard.getByRole('button',{name:'Pay ETB 1.00 & bid',exact:true});expect((await bidAction.boundingBox())!.height).toBeGreaterThanOrEqual(46);await bidAction.click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  const selection=await page.locator('#recent-winners,nav[aria-label="Auction categories"],#discover-auctions').evaluateAll(nodes=>nodes.map(node=>node.id||node.getAttribute('aria-label')));expect(selection).toEqual(['Auction categories','discover-auctions','recent-winners']);
  await page.getByRole('button',{name:'Load more',exact:true}).click();await expect(cards).toHaveCount(12);expect(new Set(await cards.locator('h3').allTextContents()).size).toBe(12);
  await page.getByRole('navigation',{name:'Auction sorting'}).getByRole('link',{name:'Lowest fee',exact:true}).click();await expect(cards).toHaveCount(10);await expect(page).toHaveURL(/sort=fee-low/);expect(new URL(page.url()).searchParams.get('q')).toBe(marker);
  await page.locator('#home-headline').scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/home-${info.project.name}-en.png`});
  await cards.first().scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/auction-card-${info.project.name}-en.png`});
  await page.locator('#recent-winners').scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/recent-winners-${info.project.name}-en.png`});
  const winner=page.locator('#recent-winners').getByRole('button',{name:`Result: ${fixture.title}`,exact:true});await winner.click();
  const result=page.getByRole('dialog',{name:'Final result',exact:true});await expect(result.locator('[data-result-amount]')).toHaveCount(20);
  expect(JSON.stringify(await page.evaluate(async code=>{const r=await fetch(`/api/results/${code}/breakdown`);return r.json()},fixture.code))).not.toContain(fixture.phone);
  await result.getByRole('button',{name:'Most picked',exact:true}).click();await expect(result.locator('[data-result-amount]').first()).toHaveAttribute('data-result-amount','50');
  await result.locator('[data-result-amount="50"]').click();const people=page.getByRole('dialog',{name:'Bid details',exact:true});await expect(people.locator('li')).toHaveCount(20);await people.getByRole('button',{name:'Next',exact:true}).click();await expect(people.locator('li')).toHaveCount(1);
  await page.screenshot({path:`${root}/participants-${info.project.name}-en.png`});await page.evaluate(()=>(window as unknown as {__sheetBackPress:()=>void}).__sheetBackPress());await expect(people).toHaveCount(0);await expect(result).toBeVisible();await expect(result.locator('[data-result-amount="50"]')).toBeFocused();
  await result.getByRole('button',{name:'Winning number',exact:true}).click();await expect(result.locator('[data-result-amount="100"]')).toBeVisible();await expect(result.getByRole('navigation',{name:'Result pages'})).toContainText('2 / 2');await page.screenshot({path:`${root}/result-${info.project.name}-en.png`});
  await page.goBack();await expect(result).toHaveCount(0);await expect(winner).toBeFocused();expect(await page.evaluate(()=>window.Telegram?.WebApp?.BackButton?.isVisible)).toBe(false);
  await page.locator('#recent-winners').getByRole('link',{name:'View all',exact:true}).click();await expect(page).toHaveURL(/\/winners$/);await expect(page.getByRole('heading',{name:'Winners',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Upcoming',exact:true})).toHaveCount(0);await expect(navigation.getByRole('link',{name:'Winners',exact:true})).toHaveAttribute('aria-current','page');await page.screenshot({path:`${root}/winners-${info.project.name}-en.png`});
  await page.getByRole('banner',{name:'Mini App header'}).getByRole('link',{name:'Browse auctions',exact:true}).click();await expect(page.getByRole('navigation',{name:'Auction status'}).getByRole('link')).toHaveCount(2);
  await page.getByRole('textbox',{name:'Search auctions'}).fill(marker);await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('navigation',{name:'Auction status'}).getByRole('link',{name:'Upcoming',exact:true}).click();await expect(page.locator('.auction-card')).toHaveCount(0);
  await navigation.getByRole('link',{name:'My Bids',exact:true}).click();await expect(page).toHaveURL(/\/my-bids$/);await navigation.getByRole('link',{name:'Profile',exact:true}).click();await expect(page).toHaveURL(/\/profile$/);
  await page.goto('/?q='+encodeURIComponent(marker));const header=page.getByRole('banner',{name:'Mini App header'});await header.getByRole('button',{name:'Language: English',exact:true}).click();await page.getByRole('menuitemradio',{name:'አማርኛ',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('lang','am');await expect(page.getByRole('navigation',{name:'Your navigation'})).toContainText('አሸናፊዎች');
  await checkSortFit();await cards.first().scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/auction-card-${info.project.name}-am.png`});
  await page.locator('#home-headline').scrollIntoViewIfNeeded();await page.screenshot({path:`${root}/home-${info.project.name}-am.png`});
  await page.locator('section[aria-labelledby="home-headline"]').getByRole('button',{name:'ተጨማሪ ይወቁ',exact:true}).click();const learn=page.getByRole('dialog');await expect(learn.locator('ol>li')).toHaveCount(3);await expect(learn.locator('iframe,video')).toHaveCount(0);await page.screenshot({path:`${root}/learn-more-${info.project.name}-am.png`});await page.goBack();await expect(learn).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);expect(await reconcile(db)).toEqual([]);
 }finally{await db.$disconnect()}
});

test('configured tutorial uses a poster before a requested player',async({page})=>{
 test.skip(!process.env.TUTORIAL_TEST_KIND,'Explicit isolated tutorial configuration required');
 const db=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});let playerRequests=0,releaseVideo!:()=>void;const videoResponse=new Promise<void>(resolve=>{releaseVideo=resolve});
 try{
  const id=randomInt(8000000000,8900000000);await verifyFixtureContact(db,id);await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.route('**/videos/qa-tutorial.mp4',async route=>{playerRequests++;await videoResponse;await route.abort()});
  await page.route('https://www.youtube-nocookie.com/**',async route=>{playerRequests++;await route.fulfill({contentType:'text/html',body:'<p>Explicit QA player transport fixture</p>'})});
  await page.addInitScript(({launch})=>{window.Telegram={WebApp:{initData:launch,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{launch:signedLaunch({user:JSON.stringify({id,first_name:'Tutorial fixture'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto('/');await page.getByRole('button',{name:'Learn more',exact:true}).first().click();const dialog=page.getByRole('dialog');await expect(dialog.locator('iframe,video')).toHaveCount(0);expect(playerRequests).toBe(0);
  await dialog.getByRole('button',{name:'Play: How Lowwin works',exact:true}).click();
  if(process.env.TUTORIAL_TEST_KIND==='local'){await expect(dialog.locator('video')).toHaveAttribute('preload','none');await expect.poll(()=>playerRequests).toBe(1);releaseVideo();await expect(dialog).toContainText('The video is unavailable.');await expect(dialog.locator('ol>li')).toHaveCount(3)}
  else{await expect(dialog.locator('iframe')).toHaveAttribute('src',/youtube-nocookie\.com\/embed\//);await expect.poll(()=>playerRequests).toBe(1)}
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 }finally{await db.$disconnect()}
});
