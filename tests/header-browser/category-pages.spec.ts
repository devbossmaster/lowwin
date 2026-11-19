import {expect,test} from '@playwright/test';

test('a category deep link sends guests Home and keeps its filters for sign-in',async({page})=>{
 const path='/categories/watches?status=live&sort=ending',response=await page.request.get(path,{maxRedirects:0});
 expect(response.status()).toBe(307);
 const destination=new URL(response.headers().location,response.url());
 expect(destination.pathname).toBe('/');
 expect(destination.searchParams.get('next')).toBe(path);
 await page.goto('/?category=watches&sort=ending');
 await expect(page).toHaveURL(/\/\?category=watches&sort=ending$/);
 const categories=page.getByRole('navigation',{name:'Auction categories'});
 await expect(categories.locator('[aria-current="page"]')).toContainText('Watches');
 await expect(page.locator('#discover-auctions')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
