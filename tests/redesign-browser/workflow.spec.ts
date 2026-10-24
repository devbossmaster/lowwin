import {test,expect} from '@playwright/test';
import {PrismaClient} from '@prisma/client';
import {randomInt,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {signedLaunch} from '../helpers';
import {verifyFixtureContact} from '../contact-fixtures';
import {bidAuction} from '../bid-fixtures';

test('browse filters survive navigation and private screens reuse a fresh read',async({page},info)=>{
 const client=new PrismaClient({datasourceUrl:process.env.TEST_DATABASE_URL});
 const root='docs/redesign/screenshots/workflow';mkdirSync(root,{recursive:true});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const marker=`Workflow ${randomUUID().slice(0,8)}`;
 try{
  const id=randomInt(9100000000,9400000000);await verifyFixtureContact(client,id);
  for(const [name,fee] of [['Speaker',30],['Camera',70],['Headphones',15]] as const){
   const auction=await bidAuction(client,{fee,ruleVersion:'lowest-unique-v4',endDelayMs:7200000});
   await client.product.update({where:{id:auction.productId!},data:{title:`${marker} · ${name}`,images:{create:{path:'/catalog/accessory.svg',alt:'Local fixture product',sourceType:'ORIGINAL'}}}});
  }
  await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
  await page.addInitScript(({data})=>{window.Telegram={WebApp:{initData:data,ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}}};},{data:signedLaunch({user:JSON.stringify({id,first_name:'Workflow fixture'})},process.env.TELEGRAM_BOT_TOKEN)});
  await page.goto(`/auctions/all?q=${encodeURIComponent(marker)}&status=live&sort=fee-low`);
  await expect(page.getByRole('navigation',{name:'Your navigation'})).toBeVisible();
  const sorts=page.getByRole('navigation',{name:'Sort auctions'}),statuses=page.getByRole('navigation',{name:'Auction status'}),categories=page.getByRole('navigation',{name:'Auction categories'});
  await expect(sorts.getByRole('link',{name:'Lowest fee',exact:true})).toHaveAttribute('aria-current','page');
  for(const link of await sorts.getByRole('link').all()){
   const box=await link.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);
   const url=new URL((await link.getAttribute('href'))!,'http://localhost');
   expect(url.searchParams.get('q')).toBe(marker);expect(url.searchParams.get('status')).toBe('live');
  }
  const cards=page.locator('article').filter({has:page.getByRole('heading',{name:new RegExp(marker)})});
  await expect(cards).toHaveCount(3);await expect(cards.first()).toContainText('Headphones');
  await sorts.getByRole('link',{name:'Highest fee',exact:true}).click();
  await expect(sorts.getByRole('link',{name:'Highest fee',exact:true})).toHaveAttribute('aria-current','page');
  await expect(cards.first()).toContainText('Camera');
  await page.screenshot({path:`${root}/browse-${info.project.name}-en.png`,fullPage:true});
  await statuses.getByRole('link',{name:'Upcoming',exact:true}).click();await expect(page.getByText('Nothing here just yet',{exact:true})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('sort')).toBe('fee-high');
  await page.goBack();await expect(cards).toHaveCount(3);
  const category=categories.getByRole('link').nth(1),categoryHref=(await category.getAttribute('href'))!;
  expect(new URL(categoryHref,'http://localhost').searchParams.get('q')).toBe(marker);
  await category.click();expect(new URL(page.url()).searchParams.get('sort')).toBe('fee-high');
  await page.getByRole('textbox',{name:'Search auctions'}).fill('no-result-fixture');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await expect(page.getByText('Nothing here just yet',{exact:true})).toBeVisible();
  const query=new URL(page.url()).searchParams;expect(query.get('sort')).toBe('fee-high');expect(query.get('status')).toBe('live');expect(query.get('category')).toBeTruthy();
  await page.goto('/draws?tab=upcoming');await expect(page.getByRole('timer').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${root}/draws-${info.project.name}-en.png`});
  // Compile first, then count real requests within the profile freshness window.
  await page.goto('/my-bids');await expect(page.getByRole('heading',{name:'My Bids',exact:true})).toBeVisible();
  let reads=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/profile')reads++});
  const nav=page.getByRole('navigation',{name:'Your navigation'});
  await nav.getByRole('link',{name:'Profile',exact:true}).click();await expect(page.getByRole('button',{name:'Edit',exact:true})).toBeVisible();
  const initial=reads;expect(initial).toBe(1);
  const began=performance.now();await nav.getByRole('link',{name:'My Bids',exact:true}).click();await expect(page.getByRole('heading',{name:'My Bids',exact:true})).toBeVisible();
  await nav.getByRole('link',{name:'Profile',exact:true}).click();await expect(page.getByRole('button',{name:'Edit',exact:true})).toBeVisible();
  expect(reads).toBe(initial);
  const roundTripMs=Math.round(performance.now()-began);
  await page.context().addCookies([{name:'lowwin-language',value:'am',domain:'localhost',path:'/'}]);
  await page.goto('/draws?tab=upcoming');await expect(page.getByRole('timer').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${root}/draws-${info.project.name}-am.png`});
  const samples:number[]=[];
  for(let index=0;index<20;index++){const start=performance.now();const response=await page.request.get(`/api/catalog/auctions?q=${encodeURIComponent(marker)}&status=live&sort=fee-low`);expect(response.status()).toBe(200);await response.body();samples.push(performance.now()-start)}
  samples.sort((a,b)=>a-b);
  writeFileSync(`${root}/cache-${info.project.name}.json`,JSON.stringify({mode:`${process.env.REDESIGN_PRODUCTION==='1'?'optimized':'development'} Chromium on loopback; not Telegram device timing`,initialProfileReads:initial,profileReadsAfterRoundTrip:reads,roundTripMs,feeSortedCatalogApi:{n:20,p50Ms:Math.round(samples[9]),p95Ms:Math.round(samples[18])},browserErrors:errors},null,2));
  expect(errors).toEqual([]);
 }finally{await client.$disconnect()}
});
