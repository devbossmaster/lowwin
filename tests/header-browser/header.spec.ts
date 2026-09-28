import {test,expect,type Page} from '@playwright/test';

async function fixture(page:Page,{available='1234',guest=false,unavailable=false,hold=false,demo=false,photo=null}:{available?:string;guest?:boolean;unavailable?:boolean;hold?:boolean;demo?:boolean;photo?:string|null}={}){
 await page.route('https://telegram.org/**',r=>r.fulfill({body:''}));
 await page.route('**/api/onboarding/contact',r=>r.fulfill({json:{verified:true}}));
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 await page.route('**/api/me',async r=>{if(hold)await gate;await r.fulfill({status:guest?401:200,json:guest?{}:{user:{id:'header-fixture',name:'Header fixture',image:photo},wallet:unavailable?{}:{available,held:'999',demo}}})});
 await page.route('**/api/alerts',r=>r.fulfill({json:{unread:3,items:[],total:0,page:1,totalPages:0,preferences:{}}}));
 await page.route('**/api/profile',r=>r.fulfill({status:503,json:{error:'Header fixture only'}}));
 await page.route('**/api/wallet?*',r=>r.fulfill({json:{page:1,total:0,totalPages:0,wallet:{available,held:'999'},activity:[]}}));
 await page.route('**/api/wallet/top-ups?*',r=>r.fulfill({json:{options:{enabled:false,accounts:[]},items:[],totalPages:0}}));
 await page.route('**/api/wallet/preview',r=>r.fulfill({json:{enabled:false,accounts:[]}}));
 return release;
}
const header=(page:Page)=>page.getByRole('banner',{name:'Mini App header'});
async function geometry(page:Page){
 const boxes=await header(page).getByRole('link').evaluateAll(links=>links.map(a=>{const r=a.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right}}));
 expect(boxes).toHaveLength(5);
 boxes.forEach((b,i)=>{expect(b.w).toBeGreaterThanOrEqual(44);expect(b.h).toBeGreaterThanOrEqual(44);expect(b.x).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(page.viewportSize()!.width);if(i)expect(b.x).toBeGreaterThanOrEqual(boxes[i-1].right)});
 expect(await header(page).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
}
test('real-response balance, unread state, five links, funding restrictions and focus',async({page},info)=>{
 await fixture(page);await page.goto('/profile');
 await expect(header(page).getByRole('link',{name:'ETB 1,234.00 available, open wallet'})).toBeVisible();
 await expect(header(page).getByRole('link',{name:'Alerts, 3 unread'})).toBeVisible();
 await expect(header(page).locator('img')).toHaveCount(0);
 await geometry(page);
 expect((await header(page).getByRole('link',{name:'ETB 1,234.00 available, open wallet'}).boundingBox())!.width).toBeLessThanOrEqual(94);
 const language=await header(page).getByRole('button',{name:'Language'}).boundingBox();expect(language!.width).toBeGreaterThanOrEqual(44);expect(language!.height).toBeGreaterThanOrEqual(44);
 expect(await header(page).getByRole('link').evaluateAll(a=>a.map(el=>el.getAttribute('href')))).toEqual(['/profile','/wallet','/wallet#add-etb','/profile/alerts','/auctions']);
 await header(page).screenshot({path:`docs/screenshots/header-${info.project.name}.png`});
 await page.screenshot({path:`docs/screenshots/header-context-${info.project.name}.png`});
 await header(page).getByRole('link',{name:'Open your profile'}).focus();
 for(const name of ['available, open wallet','Wallet funding and details','Alerts','Browse auctions']){await page.keyboard.press('Tab');await expect(header(page).getByRole('link',{name:new RegExp(name,'i')})).toBeFocused()}
 await header(page).getByRole('link',{name:'Open your profile'}).click();await expect(page).toHaveURL(/\/profile$/);
 await header(page).getByRole('link',{name:'Browse auctions'}).click();await expect(page).toHaveURL(/\/auctions$/);
 await header(page).getByRole('link',{name:/available, open wallet/i}).click();await expect(page).toHaveURL(/\/wallet$/);
 await header(page).getByRole('link',{name:'Wallet funding and details'}).click();await expect(page).toHaveURL(/\/wallet#add-etb$/);
 await expect(page.locator('#add-etb')).toBeVisible();await expect(page.getByRole('button',{name:'Submit for verification'})).toBeDisabled();
 await header(page).getByRole('link',{name:/Alerts/}).click();await expect(page).toHaveURL(/\/profile\/alerts$/);
 await page.route('**/api/alerts',r=>r.fulfill({json:{unread:0,items:[],total:0,page:1,totalPages:0,preferences:{}}}));
 await page.evaluate(()=>window.dispatchEvent(new Event('lowin-alerts')));await expect(header(page).locator('[data-unread-indicator]')).toHaveCount(0);
 await page.route('**/api/alerts',r=>r.fulfill({status:503,json:{}}));await page.evaluate(()=>window.dispatchEvent(new Event('lowin-alerts')));await expect(header(page).getByRole('link',{name:'Alerts',exact:true})).toBeVisible();
});
test('AM and EN change navigation and Home copy and persist after reload',async({page},info)=>{
 await fixture(page);await page.goto('/');
 const language=header(page).getByRole('button',{name:'Language'});
 await expect(language).toHaveAttribute('aria-expanded','false');
 await expect(page.getByText('Start bidding',{exact:true})).toBeVisible();
 await language.click();
 await header(page).getByRole('menuitemradio',{name:'አማ'}).click();
 await expect(page.locator('html')).toHaveAttribute('lang','am');
 await expect(header(page).getByRole('button',{name:'ቋንቋ'})).toContainText('አማ');
 await expect(page.getByText('ጨረታ ጀምር',{exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'ጨረታዎች',exact:true})).toBeVisible();
 await geometry(page);
 await header(page).screenshot({path:`docs/screenshots/header-am-${info.project.name}.png`});
 await page.reload();
 await expect(header(page).getByRole('button',{name:'ቋንቋ'})).toContainText('አማ');
 await expect(page.getByText('ጨረታ ጀምር',{exact:true})).toBeVisible();
 await header(page).getByRole('button',{name:'ቋንቋ'}).click();
 await header(page).getByRole('menuitemradio',{name:'En'}).click();
 await expect(page.locator('html')).toHaveAttribute('lang','en');
 await expect(page.getByText('Start bidding',{exact:true})).toBeVisible();
});
test('signed-in profile photo appears in the avatar; unsupported URL keeps the icon',async({page})=>{
 await fixture(page,{photo:'https://example.test/avatar.png'});
 await page.route('https://example.test/avatar.png',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64')}));
 await page.goto('/profile');
 await expect(header(page).getByRole('link',{name:'Open your profile'}).locator('img')).toHaveAttribute('src','https://example.test/avatar.png');
 await expect.poll(()=>header(page).locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'header-fixture',name:'Header fixture',image:'javascript:alert(1)'},wallet:{available:'1234',held:'999'}}}));
 await page.reload();
 await expect(header(page).locator('img')).toHaveCount(0);
});
test('loading and guest never invent a balance or unread indicator',async({page},info)=>{
 const release=await fixture(page,{guest:true,hold:true});await page.goto('/profile');
 try{await expect(header(page).getByRole('link',{name:'Loading…, open wallet'})).toBeVisible();await geometry(page);await header(page).screenshot({path:`docs/screenshots/header-loading-${info.project.name}.png`})}finally{release()}
 await expect(header(page).getByRole('link',{name:'Sign in, open wallet'})).toBeVisible();await expect(header(page).locator('[data-unread-indicator]')).toHaveCount(0);await geometry(page);await header(page).screenshot({path:`docs/screenshots/header-guest-${info.project.name}.png`});
});
test('missing balance stays unavailable',async({page},info)=>{
 await fixture(page,{unavailable:true});await page.goto('/profile');await expect(header(page).getByRole('link',{name:'Unavailable, open wallet'})).toBeVisible();await geometry(page);await header(page).screenshot({path:`docs/screenshots/header-unavailable-${info.project.name}.png`});
});
test('zero, DEMO and large balance remain accurate with safe areas',async({page},info)=>{
 await fixture(page,{available:'0',demo:true});await page.goto('/profile');await expect(header(page).getByRole('link',{name:'DEMO ETB 0.00 available, open wallet'})).toBeVisible();await geometry(page);
 await page.route('**/api/me',r=>r.fulfill({json:{user:{id:'header-fixture',name:'Fixture'},wallet:{available:'9999999999999999',held:'9',demo:true}}}));await page.reload();
 await expect(header(page).getByRole('link',{name:'DEMO ETB 9,999,999,999,999,999.00 available, open wallet'})).toBeVisible();
 await page.evaluate(()=>{document.documentElement.style.setProperty('--tg-safe-area-inset-top','24px');document.documentElement.style.setProperty('--tg-content-safe-area-inset-top','32px');document.documentElement.style.setProperty('--tg-content-safe-area-inset-right','24px')});
 await geometry(page);expect(await header(page).evaluate(el=>getComputedStyle(el).paddingTop)).toBe('68px');await header(page).screenshot({path:`docs/screenshots/header-long-safe-${info.project.name}.png`});
});
