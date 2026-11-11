import {test,expect} from '../isolated-browser';

test('quick auction browsing commits client navigation without a cache-observer render loop',async({page})=>{
 const documents:string[]=[],errors:string[]=[],financialWrites:string[]=[];
 page.on('request',request=>{const path=new URL(request.url()).pathname;if(request.resourceType()==='document')documents.push(path);if(request.method()==='POST'&&/\/api\/(?:payments\/|auctions\/[^/]+\/bids)/.test(path))financialWrites.push(path)});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://telegram.org/**',route=>route.fulfill({body:''}));
 await page.addInitScript(()=>{localStorage.setItem('lowwin:introduction:v1','dismissed');localStorage.setItem('lowwin-language','en')});
 await page.goto('/');await expect(page.locator('#home-headline')).toBeVisible();
 for(const mode of ['live','upcoming'] as const){
  await page.getByRole('banner',{name:'Mini App header'}).getByRole('button',{name:/^Browse auctions/}).click();
  const sheet=page.getByRole('dialog',{name:'Auctions',exact:true});await expect(sheet).toBeVisible();
  const selected=sheet.getByRole('tab',{name:mode==='live'?/^Live/:/^Upcoming/});await selected.click();await expect(selected).toHaveAttribute('aria-selected','true');
  await sheet.getByRole('link',{name:'Browse all auctions',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('/auctions/all\\?status='+mode+'$'));
  const status=page.getByRole('navigation',{name:'Auction status',exact:true});await expect(status).toBeVisible();await expect(status.getByRole('link',{name:mode==='live'?'Live':'Upcoming',exact:true})).toHaveAttribute('aria-current','page');
  await expect(sheet).toHaveCount(0);
  await page.goBack();await expect(page.locator('#home-headline')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
 }
 expect(documents).toEqual(['/']);expect(financialWrites).toEqual([]);expect(errors).toEqual([]);
});
